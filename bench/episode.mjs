/**
 * episode — 一局的环境(docs/specs/agent-pal-bench.md §7):起点、按档位过滤的工具、每次调用后判分、
 * 预算 / 卡死 / 日志。内置循环(loop.mjs)和外部 agent 用的 MCP 服务(mcp-episode.mjs)共用它,
 * 所以两条路的判分与模型看到的东西完全一样。
 *
 * 引擎是全局状态 → 一个进程只跑一局。
 *
 *   const ep = await createEpisode({ task, seed, tier, logFile });
 *   ep.tools                       // 本档可用工具(MCP 定义:name / description / inputSchema)
 *   ep.intro / ep.introImage       // 开局观察(交给模型的第一段);A 像素档是一段提示 + 当前画面
 *   const r = await ep.call(name, args)   // { text, isError, done, image? }(A 档:只给成败 + 调用后的画面,没有 observe 文字)
 *   ep.addUsage({ tokensIn, tokensOut, cacheRead, cacheWrite, cost })   // 由模型侧(循环 / 外部 CLI)报告;tokensIn 含缓存读写
 *   ep.finish(reason) → result     // 写 result 并返回
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { evaluate } from './predicates.mjs';
import { createStateTracker } from './state-view.mjs';
import { initializeTask, taskFingerprint, engineOptions, executeTaskTool } from './start.mjs';
import { createBattleMetrics, actionError, winningRounds } from './battle-metrics.mjs';
import { isSoftStop, resultLabel } from '../src/tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentSrc = path.resolve(here, '..', 'src');
const startSaves = path.join(here, 'saves');   // 题目起点存档(start.saves)

/** 档位 → 可用工具(spec §5; P = Pure 编程档:L0 原语 + run_code 内联 JS 沙盒)。 */
export const TIER_TOOLS = {
  A: ['screenshot', 'press', 'wait'],
  B: ['observe', 'walk_to', 'step', 'interact', 'search', 'advance', 'choose', 'use_item', 'equip', 'cast', 'battle', 'map', 'save', 'load', 'list_saves', 'press', 'wait'],
  C: ['observe', 'walk_to', 'step', 'interact', 'search', 'advance', 'choose', 'use_item', 'equip', 'cast', 'battle', 'map', 'save', 'load', 'list_saves', 'press', 'wait', 'guide', 'atlas'],
  P: ['observe', 'step', 'search', 'advance', 'choose', 'battle', 'use_item', 'press', 'wait', 'save', 'load', 'list_saves', 'run_code']
};
const STUCK_K = 20;           // 连续这么多次推进游戏的调用状态视图毫无变化 → 判卡死(spec §6)
/** A 像素档只看画面:工具结果只给成败(去掉「mode now …」这类结构化提示),画面随结果附上。 */
export const PIXEL_TIERS = new Set(['A']);
export function pixelResult(r, name = null) {
  if (!r) return 'ok';
  return r.ok ? 'ok' : `${name ? resultLabel(name, r) : 'FAILED'} — ${String(r.note || '').replace(/;?\s*mode now .*$/s, '')}`;
}
/** 一次工具调用的 MCP content:文字,A 像素档另附画面(外部 agent 通道用)。 */
export function toolContent(r) {
  return [{ type: 'text', text: r.text }, ...(r.image ? [{ type: 'image', data: r.image.data, mimeType: r.image.mimeType }] : [])];
}
/** 像素档的开局提示:画面随第一条消息附上;外部 agent 拿不到附图时先调 screenshot。 */
/** C 开卷档的查资料工具:不是游戏动作(runTool 里没有),不推进游戏,在这里单独接。 */
export const BOOK_TOOLS = new Set(['guide', 'atlas']);
/**
 * 查资料工具的结果 { r, text, image? }:guide 回攻略 / 剧本文本,atlas 回标注全图(画面随结果附上)。
 * guide 为 loadGuide() 的结果,atlasFor 为 agent.atlasFor。纯函数,不碰引擎。
 */
export function bookTool(name, args, { guide, atlasFor, guideText }) {
  if (name === 'guide') return { r: { ok: true, note: 'guide' }, text: guideText(guide, args || {}) };
  const a = atlasFor(args?.place);
  if (a.error) return { r: { ok: false, note: a.error }, text: `result: FAILED — ${a.error}` };
  return {
    r: { ok: true, note: a.entry.name },
    text: `${a.entry.name} — fan-made annotated map (labels mark exits, houses, shops, items). It is drawn from the 98 version, so building colors may differ slightly from the game.`,
    image: { mimeType: a.image.mimeType, data: a.image.data }
  };
}
/** 不推进游戏的工具:只看画面 / 查资料。它们不计入卡死(spec §6),调用数与预算照算。 */
export const NON_ADVANCING = new Set(['screenshot', ...BOOK_TOOLS]);
/**
 * 卡死计数:连续 k 次推进游戏的调用后状态指纹都没变 → 卡死。不推进游戏的调用既不加一也不清零
 * (读攻略 / 截图之间夹着的原地踏步照样累计)。step(fp, advancing) 返回是否已卡死。
 */
export function createStuckCounter(k = STUCK_K) {
  let last = null, same = 0;
  return {
    step(fp, advancing = true) {
      if (!advancing) return same >= k;
      same = fp === last ? same + 1 : 0;
      last = fp;
      return same >= k;
    },
    reset() { same = 0; }
  };
}
export const PIXEL_INTRO = '当前画面见附图(没有附图就先调用 screenshot)。之后每次工具调用的结果都会附上调用后的画面。';

/** 把题目起点写进本局存档文件(引擎启动时读)。 */
function prepareSaves(start) {
  if (start.rpg) {
    const raw = fs.readFileSync(path.join(process.env.AGENT_PAL_CLASSIC_SAVES || '', start.rpg));
    const payload = { version: 1, savedTimes: raw.readUInt16LE(0), timestamp: 0, bytes: Array.from(raw) };
    fs.writeFileSync(process.env.AGENT_PAL_SAVES, JSON.stringify({ 'PAL-SAVE-1': JSON.stringify(payload) }));
  } else if (start.saves) {
    fs.writeFileSync(process.env.AGENT_PAL_SAVES, zlib.gunzipSync(fs.readFileSync(path.join(startSaves, start.saves))));
  }
}

/** 这道题在这一档能用的工具名:档位清单减去题目的 disallowTools(挑战题用,比如一条命题禁存读档)。 */
export function toolNames(task, tier) {
  const banned = new Set(task.disallowTools || []);
  for (const n of banned) if (!Object.values(TIER_TOOLS).some((ts) => ts.includes(n))) throw new Error(`task ${task.id}: disallowTools has unknown tool "${n}"`);
  return TIER_TOOLS[tier].filter((n) => !banned.has(n));
}

/**
 * 参考解能用的工具:本题开放的结构化档位(B / C;只开 A 时就是 A)都能用的工具,扣掉 disallowTools。
 * bench check 直接调 runTool 回放参考解、不经档位过滤 —— 参考解若用了模型拿不到的工具(grind / panorama…),
 * 照样能过 check 并定出模型追不上的 par。
 */
export function referenceTools(task) {
  const open = task.tiers.filter((t) => t !== 'A' && t !== 'P');
  return (open.length ? open : task.tiers).map((t) => toolNames(task, t)).reduce((a, b) => a.filter((n) => b.includes(n)));
}
/**
 * 回放参考解的一步(bench check 用):游戏动作走 runTool;只看画面 / 查资料的工具(screenshot / guide / atlas)
 * 不推进游戏,回放时只计步 —— 与正式对局一致(那里它们计入调用数、不碰引擎)。
 */
export async function replayReferenceStep({ drive, runTool, agent }, tool, args = {}) {
  if (NON_ADVANCING.has(tool)) return { ok: true, note: `${tool} (not replayed: does not advance the game)` };
  return drive(runTool(agent, tool, args));
}
/** 参考解里模型用不了的工具:每个工具报第一次出现的步号;空数组 = 合法。 */
export function referenceToolErrors(task, steps) {
  const ok = new Set(referenceTools(task));
  const bad = new Map();
  steps.forEach(([tool, args], i) => { if (!ok.has(tool) && !bad.has(tool)) bad.set(tool, i + 1); const why = actionError(task, tool, args); if(why)bad.set(why,i+1); });
  return [...bad].map(([tool, at]) => `step ${at}: tool "${tool}" is not available to models on this task`);
}

export async function createEpisode({ task, seed, tier = 'B', logFile = null, meta = {} }) {
  // 提示档位(agent-pal AGENT_PAL_HINTS):bench 默认 standard —— 开关效果 / 道具该对谁用这类「读脚本得来的答案」不给,考摸索能力
  meta = { ...meta, hints: meta.hints ?? 'standard' };
  const taskOpens = task.tiers.includes(tier) || (tier === 'P' && task.tiers.includes('B'));
  if (!taskOpens) throw new Error(`task ${task.id} does not open tier ${tier}`);
  prepareSaves(task.start);
  const { bootEngine } = await import(path.join(agentSrc, 'engine.mjs'));
  const { createAgent } = await import(path.join(agentSrc, 'agent.mjs'));
  const { runTool } = await import(path.join(agentSrc, 'tools.mjs'));
  const { TOOLS, ensureDataDump } = await import(path.join(agentSrc, 'mcp.mjs'));
  const { PURE_TOOLS, callPure, render: renderPure } = await import(path.join(agentSrc, 'pure.mjs'));
  const { createL0 } = await import(path.join(agentSrc, 'l0.mjs'));
  const { createCodeRunner } = await import(path.join(agentSrc, 'code-runner.mjs'));
  const { loadGuide, guideText } = await import(path.join(agentSrc, 'guide.mjs'));
  const { loadAtlas } = await import(path.join(agentSrc, 'atlas.mjs'));
  // C 档的意义就是能查资料:没配好就不开局,免得跑出一份「其实没资料」的 C 档成绩
  const guide = tier === 'C' ? loadGuide() : null;
  if (tier === 'C' && (!guide || !loadAtlas())) {
    throw new Error('tier C needs the walkthrough and the map atlas: set AGENT_PAL_GUIDE and AGENT_PAL_ATLAS_INDEX (see bench/README.md)');
  }

  const e = await bootEngine({ seed, log: () => {}, ...engineOptions(task) });
  const a = createAgent(e, { memoryFile: null, hints: meta.hints });
  const battleMetrics = task.scoring?.secondary === 'battleRounds' ? createBattleMetrics(e) : null;
  const tracker = createStateTracker(e, a, { battleMetrics });
  const allow = new Set(toolNames(task, tier));
  const baseTools = tier === 'P' ? PURE_TOOLS : TOOLS;
  const staticTools = baseTools.filter((t) => allow.has(t.name)).map(t=>{
    if(t.name !== 'battle' || !task.battlePolicy) return t;
    const action = t.inputSchema.properties.action;
    const forbidden = new Set(task.battlePolicy.forbiddenActions);
    if (forbidden.has('coop')) forbidden.add('combo');
    return {...t, description: t.description + ' Task restrictions: forbidden actions ' + task.battlePolicy.forbiddenActions.join(', ') + '.', inputSchema: {...t.inputSchema, properties: {...t.inputSchema.properties, action: {...action, enum: action.enum.filter(x=>!forbidden.has(x))}}}};
  });
  const log = (ev) => { if (logFile) fs.appendFileSync(logFile, JSON.stringify(ev) + '\n'); };

  const initial = await initializeTask({ e, a, task, runTool, tracker });
  const handoffTime = task.start.setup ? e.clock.now() : 0;

  // Tier P (Pure 编程档):初始化 L0 与 CodeRunner,使 pal.world 与题目起点完全对齐
  let l0 = null, codeRunner = null;
  if (tier === 'P') {
    const rawL0 = createL0(e, a);
    l0 = {
      ...rawL0,
      async send(cmsg, sendMeta) {
        if (cmsg && typeof cmsg === 'object' && cmsg.op === 'CMSG_BATTLE_ACTION') {
          const why = actionError(task, 'battle', cmsg);
          if (why) return { reply: { op: 'SMSG_REJECT', seq: cmsg.seq ?? 0, reason: 'invalid', note: why }, events: [] };
        }
        return rawL0.send(cmsg, sendMeta);
      }
    };
    codeRunner = createCodeRunner({
      getSession: async () => ({ l0, run: (fn) => fn() }),
      ensureDataDump,
      isReservedTool: (n) => allow.has(n)
    });
    await codeRunner.deliver(l0.hello('pure'));
  }

  const budget = task.budget;
  const res = {
    task: task.id, taskVersion: task.version, seed, tier, ...meta,
    success: false, successAt: null, failed: false, failAt: null, stuck: false, crashed: false,
    endReason: null, milestones: Object.fromEntries((task.milestones || []).map((m) => [m.id, null])),
    toolCalls: 0, invalidCalls: 0, softStops: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, tokensCacheWrite: 0, cost: 0, virtualSeconds: 0,
    ...(battleMetrics ? { battleRounds: null } : {}),
    battles: [], progress: 0
  };
  let done = false;
  const stuck = createStuckCounter();
  const fingerprint = (v) => JSON.stringify([v.scene, v.pos, v.mode, v.inBattle, v.textLog.length, v.inventory, v.cash, v.party.map((m) => [m.hp, m.level]), v.battles.length, ...(battleMetrics ? [v.battleTelemetry, v.enemies, v.party.map(m=>m.mp)] : [])]);

  const judge = (advancing = true) => {
    const v = tracker.view();
    const at = res.toolCalls;
    for (const m of task.milestones || []) if (res.milestones[m.id] == null && evaluate(m.when, v)) res.milestones[m.id] = at;
    if (!res.failed && task.fail && evaluate(task.fail, v)) { res.failed = true; res.failAt = at; }
    if (!res.success && evaluate(task.goal, v)) { res.success = true; res.successAt = at; }
    if (stuck.step(fingerprint(v), advancing)) res.stuck = true;
    if (v.mode === 'crashed') res.crashed = true;
    res.virtualSeconds = Math.round(e.clock.now() - handoffTime) / 1000;
    if (battleMetrics) res.battleRounds = winningRounds(v.battles);
    return v;
  };
  const v0 = judge();
  stuck.reset();
  const pixel = PIXEL_TIERS.has(tier);
  const { framePng } = await import(path.join(agentSrc, 'png.mjs'));
  /** 当前画面(PNG base64);还没有帧时为 null。 */
  const frame = () => {
    const sf = e.probes.surface;
    return sf && sf.byteBuffer && sf.palette ? { mimeType: 'image/png', data: framePng(sf.byteBuffer, sf.palette) } : null;
  };
  const intro = pixel ? PIXEL_INTRO : (tier === 'P' ? renderPure(null, l0.observe(), 'full state') : a.observe());
  const introImage = pixel ? frame() : null;
  log({ type: 'start', task: task.id, taskVersion: task.version, seed, tier, scene: v0.scene, ...meta, ...(battleMetrics ? { fingerprint: taskFingerprint(task), initial: initial.view, setup: initial.setup } : {}) });

  const stopReason = () => {
    if (res.success) return 'success';
    if (res.failed) return 'fail-condition';
    if (res.crashed) return 'crashed';
    if (res.stuck) return 'stuck';
    if (res.toolCalls >= budget.toolCalls) return 'budget-toolCalls';
    if (budget.tokens && res.tokensIn + res.tokensOut >= budget.tokens) return 'budget-tokens';
    if (budget.virtualSeconds && res.virtualSeconds >= budget.virtualSeconds) return 'budget-virtualSeconds';
    return null;
  };

  async function call(name, args = {}) {
    if (done) return { text: 'The episode is over.', isError: true, done: true };
    res.toolCalls++;
    let text, isError = false, r = null, image = null;
    const forbidden = actionError(task, name, args);
    const isCustom = tier === 'P' && codeRunner?.hasTool(name);
    if ((!allow.has(name) && !isCustom) || forbidden) {
      res.invalidCalls++;
      isError = true;
      text = forbidden || `tool "${name}" is not available in this task (tier ${tier}). Available: ${[...allow, ...(codeRunner ? codeRunner.tools().map((t) => t.name) : [])].join(', ')}`;
    } else {
      try {
        if (tier === 'P') {
          if (name === 'run_code') {
            const cr = await codeRunner.runCode(args || {});
            r = { ok: !!cr.ok, note: cr.error || `commandsSent=${cr.commandsSent}` };
            if (!cr.ok) { isError = true; res.invalidCalls++; }
            text = JSON.stringify(cr, null, 2);
          } else if (isCustom) {
            const cr = await codeRunner.invokeTool(name, args || {});
            r = { ok: true, note: name };
            text = typeof cr === 'string' ? cr : JSON.stringify(cr, null, 2);
          } else {
            const pr = await callPure(name, args || {}, { l0, a, run: (fn) => fn() });
            await codeRunner.deliver(pr.events);
            const rej = pr.events.find((ev) => ev.op === 'SMSG_REJECT');
            r = rej ? { ok: false, note: rej.note || rej.reason || 'rejected' } : { ok: true, note: pr.events[0]?.note || name };
            if (!r.ok) res.invalidCalls++;
            text = pr.text;
          }
        } else if (BOOK_TOOLS.has(name)) {
          // 查资料不推进游戏:结果就是资料本身,不再附 observe
          ({ r, text, image = null } = bookTool(name, args, { guide, atlasFor: a.atlasFor, guideText }));
          if (!r.ok) res.invalidCalls++;
        } else {
          // screenshot 不推进游戏,只回画面(runTool 里没有它:不是游戏动作)
          r = name === 'screenshot' ? { ok: true, note: 'screenshot' } : await executeTaskTool({e,a,task,runTool}, name, args || {});
          if (r && r.unknown) { isError = true; res.invalidCalls++; text = `unknown tool ${name}`; }
          else {
            // 走到半路遇敌 / 进剧情是预期内的「提前停下」,不是无效调用(单独计数)
            if (isSoftStop(name, r)) res.softStops++;
            else if (r && r.ok === false) res.invalidCalls++;
            if (pixel) { text = pixelResult(r, name); image = frame(); }
            else text = (r ? `result: ${resultLabel(name, r)} — ${r.note}\n\n` : '') + a.observe();
          }
        }
      } catch (err) {
        isError = true; res.invalidCalls++;
        text = `error: ${err?.message || err}`;
      }
    }
    tracker.update();
    const v = judge(!(allow.has(name) && NON_ADVANCING.has(name)));   // 只看画面 / 查资料不计入卡死;不在本档的调用照算
    const reason = stopReason();
    log({ type: 'call', i: res.toolCalls, name, args, ok: isError ? false : (r ? !!r.ok : null), note: r?.note ?? (isError ? text : null),
      scene: v.scene, pos: v.pos, mode: v.mode, vt: res.virtualSeconds, ...(battleMetrics ? { battleRounds: res.battleRounds, battleTelemetry: v.battleTelemetry, combat: { enemies: v.enemies, party: v.party, inventory: v.inventory, cash: v.cash, rng: e.services.random.getState().draws } } : {}), success: res.success, milestones: res.milestones, stop: reason });
    if (reason) {
      done = true;
      res.endReason = reason;
      text += reason === 'success' ? '\n\n[bench] TASK COMPLETE — the goal has been reached. Stop here.' : `\n\n[bench] Episode ended (${reason}). Stop here.`;
    }
    return { text, isError, done, ...(image ? { image } : {}) };
  }

  function addUsage({ tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0, cost = 0 } = {}) {
    res.tokensIn += tokensIn; res.tokensOut += tokensOut; res.cost += cost;
    res.tokensCached += cacheRead; res.tokensCacheWrite += cacheWrite;
    if (!done && budget.tokens && res.tokensIn + res.tokensOut >= budget.tokens) { done = true; res.endReason = 'budget-tokens'; }
    return done;
  }

  function finish(reason = null) {
    if (!res.endReason) res.endReason = reason || stopReason() || 'agent-stopped';
    const total = (task.milestones || []).length;
    res.progress = res.success ? 1 : total ? Object.values(res.milestones).filter((x) => x != null).length / (total + 1) : 0;
    const v = tracker.view();
    res.battles = v.battles;
    if (battleMetrics) res.battleRounds = winningRounds(v.battles);
    res.final = { scene: v.scene, pos: v.pos, mode: v.mode, visitedScenes: v.visitedScenes };
    log({ type: 'end', ...res });
    return res;
  }

  /** 模型侧的一轮(内置循环):文字与调用名进日志,方便事后看模型在想什么。 */
  function logTurn({ text = '', calls = [], usage = null } = {}) {
    log({ type: 'turn', atCall: res.toolCalls, text: text.slice(0, 2000), calls: calls.map((c) => c.name), usage });
  }

  return { view: () => tracker.view(), get tools() { return codeRunner ? [...staticTools, ...codeRunner.tools()] : staticTools; }, intro, introImage, call, addUsage, logTurn, finish, get done() { return done; }, result: res, tier, task };
}
