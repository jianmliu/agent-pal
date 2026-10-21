/**
 * code-runner — `--pure` 模式下的内联 JS 脚本执行器(Code-as-Action,对标 arXiv:2610.22319 §2.1 & §4):
 *
 * Agent 直接写一段异步 JavaScript 函数体操作 `pal`,严格只走 L0 协议(`CMSG_*` / `SMSG_*`):
 *  - `pal.send(cmsg)` 及薄封装(`pal.step` / `pal.interact` / `pal.advance` / `pal.choose` / `pal.battle` …):
 *    经会话串行队列发 CMSG,生成的 SMSG 同步更新 `pal.world`、触发 `pal.on` 监听器并投递给所有 L2 模块。
 *  - `pal.world`:完全由收到的 SMSG 消息流构建的世界模型(不碰引擎内部),含 scene / map / mode / player /
 *    objects(Map) / objectList(数组) / members / items / cash / dialog / menu / battle / lastBattleResult。
 *  - `global`(同 `pal.global` / `pal.shared`):跨 `run_code` 调用持久保留的对象 —— Agent 可在上面沉淀自己的
 *    寻路函数、已探明的墙壁表、战斗策略与笔记(对应论文中跨程序存活的 42 个 helper 函数与 146 项状态)。
 *  - `pal.registerTool(name, spec, handler)`:把自写的 JS 函数当场注册成一等 MCP 工具,立即可被后续 `tools/call` 调用。
 *  - 超时与残留循环防护(对应论文 §4 的超时计数器):每次执行分配递增 `runId`;一旦超时或本次 `run_code` 已返回,
 *    残留后台循环再调 `pal.send()` 会立即被拦截并抛 `RunCodeAbortedError`,绝不污染后续回合。
 */
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { SMSG } from '@onchainpal/agent-pal-protocol';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,60}$/;
const capturedSetTimeout = globalThis.__agentPalRealSetTimeout || globalThis.setTimeout;
const capturedClearTimeout = globalThis.clearTimeout;

export class RunCodeAbortedError extends Error {
  constructor(runId, reason = 'run_code execution already finished or timed out') {
    super(`[run_code #${runId}] aborted: ${reason}`);
    this.name = 'RunCodeAbortedError';
    this.runId = runId;
  }
}

function createEmptyWorld() {
  return {
    hello: null,
    scene: null,
    map: null,
    mode: null,
    player: null,
    get gx() { return this.player?.gx ?? null; },
    get gy() { return this.player?.gy ?? null; },
    get facing() { return this.player?.facing ?? null; },
    objects: new Map(),
    get objectList() { return [...this.objects.values()]; },
    members: [],
    items: [],
    cash: 0,
    dialog: null,
    recentDialogs: [],
    menu: null,
    battle: null,
    lastBattleResult: null,
    gameOver: false
  };
}

/** 用一条 SMSG 更新纯协议世界模型。 */
export function applyServerMsg(world, ev) {
  if (!ev || typeof ev !== 'object') return;
  switch (ev.op) {
    case 'SMSG_HELLO':
      world.hello = { version: ev.version, mode: ev.mode, layer: ev.layer, seed: ev.seed ?? null, slot: ev.slot ?? null };
      break;
    case 'SMSG_SCENE_ENTER':
      world.scene = ev.scene;
      world.map = ev.map ?? null;
      world.player = ev.player ? { ...ev.player } : (ev.gx != null ? { gx: ev.gx, gy: ev.gy, facing: ev.facing ?? null } : null);
      world.objects = new Map((ev.objects || []).map((o) => [o.id, { ...o }]));
      world.dialog = null;
      world.menu = null;
      break;
    case 'SMSG_PLAYER_UPDATE':
      world.player = { gx: ev.gx, gy: ev.gy, facing: ev.facing };
      break;
    case 'SMSG_OBJECT_UPDATE':
      if (ev.removed) world.objects.delete(ev.id);
      else {
        const prev = world.objects.get(ev.id) || {};
        world.objects.set(ev.id, { ...prev, ...ev });
      }
      break;
    case 'SMSG_PARTY_UPDATE':
      world.members = (ev.members || []).map((m) => ({ ...m }));
      if (world.battle) world.battle.party = world.members.map((m) => ({ ...m }));
      break;
    case 'SMSG_INVENTORY_UPDATE':
      world.items = (ev.items || []).map((it) => ({ ...it }));
      if (ev.cash != null) world.cash = ev.cash;
      break;
    case 'SMSG_DIALOG':
      world.dialog = { speaker: ev.speaker ?? null, text: ev.text };
      world.recentDialogs.push({ speaker: ev.speaker ?? null, text: ev.text });
      if (world.recentDialogs.length > 50) world.recentDialogs.shift();
      break;
    case 'SMSG_CHOICE':
      world.menu = { kind: ev.kind, title: ev.title ?? null, items: (ev.items || []).map((it) => ({ ...it })), index: ev.index ?? 0, depth: ev.depth ?? 1 };
      break;
    case 'SMSG_BATTLE_START':
      world.battle = {
        battle: ev.battle ?? null,
        boss: !!ev.boss,
        enemies: (ev.enemies || []).map((x) => ({ ...x })),
        party: world.members.map((m) => ({ ...m })),
        turn: null,
        events: []
      };
      world.lastBattleResult = null;
      break;
    case 'SMSG_BATTLE_STATE':
      world.battle = {
        ...(world.battle || { events: [] }),
        battle: ev.battle ?? world.battle?.battle ?? null,
        prompt: ev.prompt ?? world.battle?.prompt ?? null,
        enemies: (ev.enemies || []).map((x) => ({ ...x })),
        party: (ev.party || []).map((x) => ({ ...x })),
        turn: ev.turn ? { ...ev.turn } : null
      };
      break;
    case 'SMSG_BATTLE_PROMPT':
      if (world.battle) world.battle.turn = { kind: 'command', member: ev.member, ...(ev.revision != null ? { revision: ev.revision } : {}) };
      break;
    case 'SMSG_BATTLE_EVENT':
      if (world.battle) {
        if (!Array.isArray(world.battle.events)) world.battle.events = [];
        world.battle.events.push({ ...ev });
        if (world.battle.events.length > 40) world.battle.events.shift();
        if (ev.kind === 'hp' && ev.side === 'enemy') {
          const en = world.battle.enemies?.find((x) => x.index === ev.index);
          if (en) en.hp = ev.to;
        } else if (ev.kind === 'hp' && ev.side === 'party') {
          const pm = world.battle.party?.find((x) => x.roleId === ev.roleId);
          if (pm) pm.hp = ev.to;
        } else if (ev.kind === 'enemy_gone' && Array.isArray(world.battle.enemies)) {
          world.battle.enemies = world.battle.enemies.filter((x) => x.index !== ev.index);
        }
      }
      break;
    case 'SMSG_BATTLE_END':
      world.lastBattleResult = {
        battle: ev.battle ?? null,
        result: ev.result,
        cashDelta: ev.cashDelta ?? 0,
        levelUps: ev.levelUps || [],
        ...(ev.exp != null ? { exp: ev.exp } : {})
      };
      world.battle = null;
      break;
    case 'SMSG_MODE':
      world.mode = ev.mode;
      if (ev.mode !== 'dialog') world.dialog = null;
      if (ev.mode !== 'menu') world.menu = null;
      if (ev.mode === 'control') world.battle = null;
      break;
    case 'SMSG_GAME_OVER':
      world.gameOver = true;
      break;
    default:
      break;
  }
}

function summarizeWorld(world, shared, customTools) {
  return {
    mode: world.mode,
    scene: world.scene,
    map: world.map,
    player: world.player,
    objectsCount: world.objects.size,
    party: world.members.map((m) => `${m.name} Lv${m.level} HP:${m.hp}/${m.maxHp} MP:${m.mp}/${m.maxMp}`),
    cash: world.cash,
    ...(world.dialog ? { dialog: world.dialog } : {}),
    ...(world.menu ? { menu: { title: world.menu.title, index: world.menu.index, items: world.menu.items.map((it, i) => `[${i}] ${it.label}${it.enabled === false ? ' (disabled)' : ''}`) } } : {}),
    ...(world.battle ? { battle: { turn: world.battle.turn, enemies: world.battle.enemies } } : {}),
    ...(world.lastBattleResult ? { lastBattleResult: world.lastBattleResult } : {}),
    globalKeys: Object.keys(shared),
    registeredTools: [...customTools.keys()]
  };
}

/**
 * 创建会话级内联脚本运行器。
 * @param {object} opts
 * @param {() => Promise<{l0: object, run: (fn: () => Promise<any>) => Promise<any>}>} opts.getSession
 * @param {() => object|null} [opts.getModules]
 * @param {(events: object[]) => Promise<void>} [opts.onEvents] 把脚本产生的 SMSG 投给外部模块
 * @param {() => Promise<string>} [opts.ensureDataDump] 按需生成并返回 data dump 目录
 * @param {( toolName: string ) => boolean} [opts.isReservedTool] 检查工具名是否与内置工具重名
 * @param {() => void} [opts.onToolsChanged] 动态工具注册/卸载时触发(通知 MCP tools/list_changed)
 * @param {(ev: object) => void} [opts.logEvent] 写运行日志
 */
export function createCodeRunner(opts = {}) {
  const world = createEmptyWorld();
  const shared = Object.create(null);
  const listeners = new Map();               // op ('*' or SMSG_*) -> Set<fn>
  const customTools = new Map();             // name -> { name, description, inputSchema, handler }
  let hydrated = false;
  let runSeq = 0;

  async function deliver(events) {
    if (!Array.isArray(events) || !events.length) return;
    hydrated = true;
    for (const ev of events) {
      applyServerMsg(world, ev);
      const exact = listeners.get(ev.op);
      const wild = listeners.get('*');
      for (const set of [exact, wild]) {
        if (!set) continue;
        for (const fn of [...set]) {
          try { await fn(ev, world); } catch { /* 监听器异常不中断投递 */ }
        }
      }
    }
  }

  function on(op, fn) {
    if (op !== '*' && !(op in SMSG)) throw new Error(`unknown server op ${op}`);
    if (typeof fn !== 'function') throw new Error('listener must be a function');
    if (!listeners.has(op)) listeners.set(op, new Set());
    listeners.get(op).add(fn);
    return () => off(op, fn);
  }

  function off(op, fn) {
    if (!fn) { listeners.delete(op); return; }
    listeners.get(op)?.delete(fn);
  }

  function registerTool(name, specOrFn, maybeFn) {
    const clean = String(name || '').trim();
    if (!TOOL_NAME_RE.test(clean)) throw new Error(`invalid tool name "${clean}" (must match ${TOOL_NAME_RE})`);
    if (opts.isReservedTool?.(clean)) throw new Error(`cannot override built-in tool "${clean}"`);
    const handler = typeof specOrFn === 'function' ? specOrFn : maybeFn;
    const spec = typeof specOrFn === 'function' ? {} : (specOrFn || {});
    if (typeof handler !== 'function') throw new Error(`registerTool("${clean}"): handler function is required`);
    customTools.set(clean, {
      name: clean,
      description: `[custom] ${spec.description || clean}`,
      inputSchema: spec.inputSchema || spec.input || { type: 'object', properties: {}, additionalProperties: true },
      handler
    });
    try { opts.onToolsChanged?.(); } catch { /* */ }
    return clean;
  }

  function unregisterTool(name) {
    const existed = customTools.delete(String(name || '').trim());
    if (existed) { try { opts.onToolsChanged?.(); } catch { /* */ } }
    return existed;
  }

  /** 确保 world 已经从 L0 同步过初始状态。 */
  async function ensureHydrated() {
    if (hydrated && world.mode != null) return;
    const { l0 } = await opts.getSession();
    if (l0?.helloSnapshot) {
      await deliver(l0.helloSnapshot('pure'));
    }
  }

  const activeRuns = [];

  const realNowMs = () => Number(process.hrtime.bigint() / 1000000n);

  function createPalContext(ctx) {
    const checkDeadline = (c) => {
      if (c && !c.finished && !c.timedOut && c.deadline && realNowMs() > c.deadline) {
        c.timedOut = true;
      }
    };
    const resolveCtx = () => {
      const target = !ctx.finished ? ctx : activeRuns.at(-1);
      if (!target) throw new RunCodeAbortedError(ctx.runId);
      checkDeadline(target);
      if (target.timedOut) throw new RunCodeAbortedError(target.runId, `run_code #${target.runId} timed out after ${target.timeoutMs} ms`);
      return target;
    };
    const isAborted = () => {
      const target = !ctx.finished ? ctx : activeRuns.at(-1);
      if (!target) return true;
      checkDeadline(target);
      return !!target.timedOut;
    };
    const guard = () => { resolveCtx(); };
    const fmt = (...a) => a.map((x) => (typeof x === 'string' ? x : util.inspect(x, { depth: 3, breakLength: 120 }))).join(' ');
    const log = (...a) => {
      const targetLogs = (!ctx.finished ? ctx : (activeRuns.at(-1) || ctx)).logs;
      if (targetLogs.length < 200) targetLogs.push(fmt(...a));
      else if (targetLogs.length === 200) targetLogs.push('... (log output truncated at 200 lines)');
    };

    async function send(cmsg) {
      const active = resolveCtx();
      const { l0, run } = await opts.getSession();
      const r = await run(async () => {
        resolveCtx();
        return l0.send(cmsg, { via: 'run_code' });
      });
      active.counter.commandsSent++;
      const evs = [r.reply, ...r.events];
      await deliver(evs);
      if (opts.onEvents) await opts.onEvents(evs);
      resolveCtx();
      return { reply: r.reply, events: r.events, ok: r.reply.op === 'SMSG_ACK', world };
    }

    async function observe() {
      resolveCtx();
      const { l0, run } = await opts.getSession();
      const events = await run(async () => {
        resolveCtx();
        return l0.observe();
      });
      await deliver(events);
      if (opts.onEvents) await opts.onEvents(events);
      resolveCtx();
      return events;
    }

    async function clock() {
      resolveCtx();
      const { l0 } = await opts.getSession();
      return l0.clock();
    }

    async function invoke(method, params = {}) {
      resolveCtx();
      const m = String(method || '');
      if (customTools.has(m)) {
        return customTools.get(m).handler(params, pal);
      }
      const mods = await opts.getModules?.();
      const rpcName = m.includes('__') ? m.replace('__', '.') : m;
      if (mods && rpcName.includes('.')) {
        return mods.invoke(rpcName, params);
      }
      throw new Error(`unknown module or custom tool: ${m}`);
    }

    async function ensureDataDump() {
      resolveCtx();
      if (process.env.AGENT_PAL_DATA_DIR && fs.existsSync(path.join(process.env.AGENT_PAL_DATA_DIR, 'manifest.json'))) {
        return process.env.AGENT_PAL_DATA_DIR;
      }
      if (!opts.ensureDataDump) throw new Error('data dump is not available in this session');
      return opts.ensureDataDump();
    }

    async function readData(relPath) {
      const dir = await ensureDataDump();
      const target = path.resolve(dir, String(relPath || '').replace(/^[/\\]+/, ''));
      if (!target.startsWith(path.resolve(dir))) throw new Error('readData path must stay inside dataDir');
      return JSON.parse(fs.readFileSync(target, 'utf8'));
    }

    const pal = {
      get runId() { return (!ctx.finished ? ctx : (activeRuns.at(-1) || ctx)).runId; },
      isAborted,
      world,
      global: shared,
      shared,
      get dataDir() { return process.env.AGENT_PAL_DATA_DIR || null; },
      ensureDataDump,
      readData,
      fs,
      path,
      log,
      sleep: (ms = 10) => new Promise((r) => (globalThis.__agentPalRealSetTimeout || capturedSetTimeout)(r, ms)),
      send,
      observe,
      clock,
      invoke,
      on,
      off,
      clearListeners: (op) => (op ? listeners.delete(op) : listeners.clear()),
      registerTool,
      unregisterTool,
      listRegisteredTools: () => [...customTools.keys()],
      // L0 便捷封装(内部全部是标准 CMSG,不越界)
      step: (dir, steps = 1) => send({ op: 'CMSG_MOVE', dir, ...(steps > 1 ? { steps } : {}) }),
      interact: () => send({ op: 'CMSG_INTERACT' }),
      advance: async (max = 40) => {
        const events = [];
        let reply = null;
        for (let i = 0; i < max; i++) {
          const r = await send({ op: 'CMSG_DIALOG_ADVANCE' });
          reply = r.reply;
          events.push(...r.events);
          if (r.reply.op === 'SMSG_REJECT' || world.mode !== 'dialog') break;
        }
        return { reply, events, ok: reply ? reply.op === 'SMSG_ACK' : true, world };
      },
      choose: (index) => send({ op: 'CMSG_CHOICE', index }),
      battle: (type = 'attack', extra = {}) => send({ op: 'CMSG_BATTLE_ACTION', type, ...extra }),
      useItem: (item, target = 0) => send({ op: 'CMSG_MENU_USE_ITEM', item, target }),
      press: (key, ms = 100) => send({ op: 'CMSG_KEY', key, ms }),
      wait: (ms = 1000) => send({ op: 'CMSG_WAIT', ms }),
      save: (slot, note) => send({ op: 'CMSG_SAVE', slot, ...(note ? { note } : {}) }),
      load: (slot) => send({ op: 'CMSG_LOAD', slot })
    };
    return pal;
  }

  async function executeFunction(fn, args = {}, timeoutMs = 30000) {
    await ensureHydrated();
    const runId = ++runSeq;
    const tMs = Math.max(10, Number(timeoutMs) || 30000);
    const ctx = { runId, finished: false, timedOut: false, timeoutMs: tMs, deadline: realNowMs() + tMs, logs: [], counter: { commandsSent: 0 } };
    activeRuns.push(ctx);
    const pal = createPalContext(ctx);
    const consoleProxy = {
      log: (...a) => pal.log(...a),
      info: (...a) => pal.log(...a),
      warn: (...a) => pal.log('[warn]', ...a),
      error: (...a) => pal.log('[error]', ...a)
    };
    const realTimer = globalThis.__agentPalRealSetTimeout || capturedSetTimeout;
    let timer = null;
    try {
      const work = Promise.resolve(fn(pal, consoleProxy, shared, args)).then((v) => {
        if (ctx.timedOut) throw new RunCodeAbortedError(runId, `timed out after ${timeoutMs} ms`);
        return v;
      });
      const timeoutP = new Promise((_, reject) => {
        timer = realTimer(() => {
          ctx.timedOut = true;
          reject(new Error(`run_code #${runId} timed out after ${timeoutMs} ms`));
        }, Math.max(10, Number(timeoutMs) || 30000));
      });
      const value = await Promise.race([work, timeoutP]);
      ctx.finished = true;
      return {
        ok: true,
        runId,
        commandsSent: ctx.counter.commandsSent,
        logs: ctx.logs,
        result: value === undefined ? null : value,
        world: summarizeWorld(world, shared, customTools)
      };
    } catch (err) {
      ctx.finished = true;
      return {
        ok: false,
        runId,
        commandsSent: ctx.counter.commandsSent,
        logs: ctx.logs,
        error: String(err?.message || err),
        stack: String(err?.stack || '').split('\n').slice(0, 5).join('\n'),
        world: summarizeWorld(world, shared, customTools)
      };
    } finally {
      ctx.finished = true;
      const idx = activeRuns.lastIndexOf(ctx);
      if (idx >= 0) activeRuns.splice(idx, 1);
      if (timer != null) capturedClearTimeout(timer);
    }
  }

  async function invokeTool(name, args = {}) {
    const t = customTools.get(name);
    if (!t) throw new Error(`no custom tool named ${name}`);
    opts.logEvent?.({ type: 'custom_tool_call', name, args });
    const res = await executeFunction((pal, con, g, a) => t.handler(a, pal, con, g), args, 60000);
    opts.logEvent?.({ type: 'custom_tool_result', name, ok: res.ok, commandsSent: res.commandsSent });
    if (!res.ok) throw new Error(res.error || `custom tool ${name} failed`);
    return res.result !== null ? res.result : { ok: true, logs: res.logs, commandsSent: res.commandsSent, world: res.world };
  }

  return {
    world,
    global: shared,
    deliver,
    hasTool: (name) => customTools.has(name),
    tools: () => [...customTools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async runCode({ code, args = {}, timeout_ms, timeoutMs } = {}) {
      const effectiveTimeout = timeoutMs ?? timeout_ms ?? 30000;
      if (typeof code !== 'string' || !code.trim()) {
        return { ok: false, error: 'code must be a non-empty string', logs: [], commandsSent: 0, world: summarizeWorld(world, shared, customTools) };
      }
      let fn;
      try {
        fn = new AsyncFunction('pal', 'console', 'global', 'args', code);
      } catch (err) {
        return { ok: false, error: `SyntaxError: ${err.message}`, logs: [], commandsSent: 0, world: summarizeWorld(world, shared, customTools) };
      }
      opts.logEvent?.({ type: 'code_call', code, args, timeout_ms: effectiveTimeout });
      const res = await executeFunction((pal, con, g, a) => fn(pal, con, g, a), args, effectiveTimeout);
      opts.logEvent?.({ type: 'code_result', ok: res.ok, runId: res.runId, commandsSent: res.commandsSent, ...(res.error ? { error: res.error } : {}) });
      return res;
    },
    invokeTool,
    async callTool(name, args = {}) {
      const r = await invokeTool(name, args);
      return { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2) }] };
    }
  };
}
