import {measureCall,decisionStop} from './execution-config.mjs';
/**
 * l0 — L0 原语层(docs/specs/agent-pal.md §4 / §5.4):CMSG 进,SMSG_ACK|REJECT + SMSG 事件出。
 *
 * M0b 仍是「包旧引擎」:每条 CMSG 映射到 tools.mjs 的同一张调度表(按键注入 + 探针),
 * 所以 L0 会话录下来的仍是普通工具调用,golden.mjs from-run 照样能重放。
 * 事件多数不是引擎原生发的:每次指令前后各读一次结构化快照(readState),由 diffState 求差得到。
 * 战斗例外(M5 B3):引擎有战斗事件日志(battleService.battleEventsSince),START / EVENT / PROMPT / END 按它原样
 * 排出来 —— 一条指令里打完一回合甚至连打两场,中间的血量变化与轮次不再被压成一次差分。
 * M3 起对白/选择/商店改成原生 wait 状态后,只换这里的实现,协议不动(§7 绞杀者模式)。
 *
 * 读数刻意不碰 agent.observe():那是给 LLM 的呈现层,会把「新文字」标成已读(同 bench/state-view.mjs)。
 * L0 观测不含 ASCII 图、地图记忆和出口去向推断 —— 那些属于 L1(§5.4);障碍数据要等 M2 的 data dump。
 */
import { parseClientMsg, ack, reject } from '@onchainpal/agent-pal-protocol';
import { runTool } from './tools.mjs';

const DIR_NAME = { 0: 'down', 1: 'left', 2: 'up', 3: 'right' };
const UI_SELECT_MOVE = 1;
const BATTLE_RESULT = { 3: 'won', 1: 'lost', 0xffff: 'fled', 0: 'terminated' };
const STATUS_NAME = ['confused', 'paralyzed', 'asleep', 'silenced', 'puppet', 'bravery', 'protect', 'haste', 'dual-attack'];
const DEFEAT_LINE = /勝敗乃兵家常事|胜败乃兵家常事/;

const big5dec = (() => { try { return new TextDecoder('big5'); } catch { return null; } })();

// ---- 快照 ------------------------------------------------------------------------

/** 读一份 L0 结构化快照。battleMemo 由调用方跨调用保存(敌人初始血量、开战时银两/等级)。 */
export function readState(e, a, battleMemo = {}) {
  const ws = e.worldService;
  const word = (n) => {
    try {
      const w = e.ui.getWord(n);
      if (typeof w === 'string') return w.replace(/ +$/, '').trim();
      if (w && big5dec) return big5dec.decode(new Uint8Array(w)).replace(/ +$/, '').trim();
    } catch { /* */ }
    return '';
  };
  const roleVal = (field, role) => { try { return Number(ws._getPlayerRoleArrayValue(field, role, 0)) || 0; } catch { return 0; } };
  const statusOf = (role) => {
    let row = [];
    try { row = ws.getPlayerStatusMatrix?.()?.[role] || []; } catch { /* */ }
    return STATUS_NAME.filter((_, i) => (row[i] || 0) > 0);
  };

  const mode = a.mode();
  let scene = null;
  try { scene = ws.getSceneId() ?? null; } catch { /* */ }
  const s = { mode, scene, map: null, player: null, objects: [], members: [], items: [], cash: 0, dialog: null, menu: null, battle: null, lastBattleResult: null };
  if (mode === 'crashed') { s.crash = String(e.probes.crash?.message || 'unknown'); return s; }

  if (scene != null) {
    try { s.map = ws.getSceneEntry(scene)?.mapNum ?? null; } catch { /* */ }
    const p = a.playerPos();
    let facing = null;
    try { facing = DIR_NAME[ws.getPartyDirection()] ?? null; } catch { /* */ }
    s.player = { gx: p.gx, gy: p.gy, facing };
    // 物体表与 interact 用同一编号。读脚本推断出来的都不给(那是 L1):dest(出口去向)、battle,
    // 以及 kind 'enemy' / 'ferry'(扫触发脚本认出来的开战/载人)—— L0 只看得到「带精灵的 npc」,碰了才知道会开战。
    s.objects = (a.objects() || [])
      .map(({ id, gx, gy, kind, rawKind, triggerMode, blocking }) => ({ id, gx, gy, kind: kind === 'switch' ? rawKind : kind === 'enemy' || kind === 'ferry' ? 'npc' : kind, triggerMode, blocking }))
      .sort((x, y) => x.id - y.id);
  }

  // 标题画面(还没进游戏)世界表里是占位数据(role0 Lv0),不当成队伍/背包发出去
  const party = scene == null ? [] : (() => { try { return (ws.getParty() || []).slice(0, (ws.getMaxPartyMemberIndex?.() ?? 0) + 1); } catch { return []; } })();
  s.members = party.filter((m) => typeof m?.playerRole === 'number').map((m) => {
    const role = m.playerRole;
    const st = statusOf(role);
    return { roleId: role, name: word(roleVal('name', role)) || `role${role}`, level: roleVal('level', role), hp: roleVal('HP', role), maxHp: roleVal('maxHP', role), mp: roleVal('MP', role), maxMp: roleVal('maxMP', role), ...(st.length ? { status: st } : {}) };
  });
  if (scene != null) try {
    s.items = (ws.getInventory() || []).filter((it) => it && it.item && it.amount > 0).map((it) => ({ id: it.item, name: word(it.item) || `item${it.item}`, amount: it.amount }));
  } catch { /* */ }
  s.cash = Number(ws.getCash?.() ?? 0);

  if (mode === 'dialog') {
    const cur = e.dialogService.getCurrentLine?.();
    if (cur && cur.text) s.dialog = { speaker: cur.source ? String(cur.source).trim() : null, text: String(cur.text).trim() };
  }
  const menu = e.probes.menu;
  if (mode === 'menu' && menu) {
    let items = [];
    try { items = menu.items || []; } catch { /* */ }
    s.menu = {
      kind: menu.kind || 'list',
      title: menu.title || null,
      items: items.map((it) => ({ label: it.label, enabled: !!it.enabled, ...(it.amount > 1 ? { amount: it.amount } : {}), ...(it.price != null ? { price: it.price } : {}) })),
      index: menu.index ?? 0,
      depth: e.probes.menuStack.length
    };
  }

  let bst = null;
  try { bst = e.services.battle.getState?.() || null; } catch { /* */ }
  if (ws.isInBattle?.()) {
    const enemies = (Array.isArray(bst?.enemy) ? bst.enemy : [])
      .map((x, i) => (x && x.objectID ? { index: i, name: word(x.objectID) || `enemy${x.objectID}`, hp: x.e?.health ?? 0 } : null))
      .filter(Boolean);
    if (!battleMemo.active) {
      battleMemo.active = true;
      battleMemo.maxHp = Object.fromEntries(enemies.map((x) => [x.index, x.hp]));   // 引擎不填 maxHealth,开战时的血量即上限
      battleMemo.cash = s.cash;
      battleMemo.levels = s.members.map((m) => ({ name: m.name, level: m.level }));
    }
    const ui = bst?.UI || {};
    const owned = e.services.battleCommandRuntime?.owned;
    const ownedWait = owned ? e.commandWait?.() : null;
    const ownedPrompt = ownedWait?.kind === 'battle.command' && ownedWait.state === 'waiting' ? ownedWait.payload?.prompt : null;
    const turn = owned ? (ownedWait?.kind === 'battle.auto-mode' ? { kind: 'auto' } : ownedPrompt ? { kind: 'command', member: ownedPrompt.member } : { kind: 'acting' }) : ui.autoAttack ? { kind: 'auto' } : ui.state === UI_SELECT_MOVE ? { kind: 'command', member: ui.curPlayerIndex ?? 0 } : { kind: 'acting' };
    // 战斗实例编号与当前开放的提示身份(M5 C2):重建等待提示时凭它回应;旧引擎没有就不带
    let identity = {};
    try {
      const svc = e.services.battle;
      if (typeof svc.getOpenPrompt === 'function') {
        const open = owned ? ownedWait?.payload?.prompt : svc.getOpenPrompt();
        identity = { battleId: svc.battleInstance, prompt: open ? { context: open.context, battle: open.battle, revision: open.revision, member: open.member, role: open.role } : null };
      }
    } catch { /* */ }
    s.battle = {
      ...identity,
      enemies: enemies.map((x) => ({ ...x, maxHp: battleMemo.maxHp?.[x.index] ?? null })),
      party: s.members.map(({ roleId, name, hp, maxHp, mp, maxMp, status }) => ({ roleId, name, hp, maxHp, mp, maxMp, ...(status ? { status } : {}) })),
      turn
    };
  } else if (battleMemo.active) {
    battleMemo.active = false;
    const code = bst?.battleResult;
    s.lastBattleResult = {
      result: BATTLE_RESULT[code] ?? `result-${code}`,
      cashDelta: s.cash - (battleMemo.cash ?? s.cash),
      levelUps: (battleMemo.levels || []).map((b, i) => ({ name: b.name, from: b.level, to: s.members[i]?.level ?? b.level })).filter((x) => x.to > x.from)
    };
  }
  return s;
}

// ---- 求差 ------------------------------------------------------------------------
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const sceneEnter = (s) => ({ op: 'SMSG_SCENE_ENTER', scene: s.scene, map: s.map, player: s.player, objects: s.objects });
const choice = (m) => ({ op: 'SMSG_CHOICE', kind: m.kind, title: m.title, items: m.items, index: m.index, depth: m.depth });
const battleState = (b) => ({ op: 'SMSG_BATTLE_STATE', enemies: b.enemies, party: b.party, turn: b.turn, ...(b.battleId != null ? { battle: b.battleId, prompt: b.prompt } : {}) });

/**
 * 两份快照之间的 SMSG(不含对白:对白按历史条目逐行发,见 createL0)。
 * 顺序:场景 → 主角/物体 → 队伍/背包 → 菜单 → 战斗 → 决策点(MODE 最后:「现在轮到你,处于 X」)。
 * 换场景时发 SCENE_ENTER 全量,不再逐个发 OBJECT/PLAYER 增量(§4.1-3 可重建)。
 */
export function diffState(prev, cur, battleEvents = null) {
  const out = [];
  const p = prev || {};
  if (cur.scene != null && cur.scene !== p.scene) {
    out.push(sceneEnter(cur));
  } else if (cur.scene != null) {
    if (!same(p.player, cur.player)) out.push({ op: 'SMSG_PLAYER_UPDATE', ...cur.player });
    const before = new Map((p.objects || []).map((o) => [o.id, o]));
    const now = new Map(cur.objects.map((o) => [o.id, o]));
    for (const [id, o] of now) if (!same(before.get(id), o)) out.push({ op: 'SMSG_OBJECT_UPDATE', ...o });
    for (const id of before.keys()) if (!now.has(id)) out.push({ op: 'SMSG_OBJECT_UPDATE', id, removed: true });
  }
  if (!same(p.members, cur.members)) out.push({ op: 'SMSG_PARTY_UPDATE', members: cur.members });
  if (!same(p.items, cur.items) || p.cash !== cur.cash) out.push({ op: 'SMSG_INVENTORY_UPDATE', items: cur.items, cash: cur.cash });
  if (cur.menu && !same(p.menu, cur.menu)) out.push(choice(cur.menu));
  if (battleEvents) {
    // 引擎原生的战斗事件(已按发生顺序),再跟一份当前战况
    out.push(...battleEvents);
    if (cur.battle && !same(p.battle, cur.battle)) out.push(battleState(cur.battle));
  } else {
    if (cur.battle && !p.battle) out.push({ op: 'SMSG_BATTLE_START', enemies: cur.battle.enemies });
    if (cur.battle && !same(p.battle, cur.battle)) {
      out.push(battleState(cur.battle));
      if (cur.battle.turn.kind === 'command' && !same(p.battle?.turn, cur.battle.turn)) out.push({ op: 'SMSG_BATTLE_PROMPT', member: cur.battle.turn.member });
    }
    if (cur.lastBattleResult) out.push({ op: 'SMSG_BATTLE_END', ...cur.lastBattleResult });
  }
  if (cur.mode !== p.mode) out.push({ op: 'SMSG_MODE', mode: cur.mode, ...(cur.crash ? { note: cur.crash } : {}) });
  return out;
}

/** 全量重建用的消息集(HELLO 之后、或 observe):有什么发什么。 */
export function fullState(s) {
  const out = [];
  if (s.scene != null) out.push(sceneEnter(s));
  if (s.scene != null) {
    out.push({ op: 'SMSG_PARTY_UPDATE', members: s.members });
    out.push({ op: 'SMSG_INVENTORY_UPDATE', items: s.items, cash: s.cash });
  }
  if (s.dialog) out.push({ op: 'SMSG_DIALOG', speaker: s.dialog.speaker, text: s.dialog.text, waiting: true });
  if (s.menu) out.push(choice(s.menu));
  if (s.battle) out.push(battleState(s.battle));
  out.push({ op: 'SMSG_MODE', mode: s.mode, ...(s.crash ? { note: s.crash } : {}) });
  return out;
}

// ---- CMSG → 工具调用 --------------------------------------------------------------
const NEEDS = {
  CMSG_MOVE: 'control', CMSG_INTERACT: 'control', CMSG_MENU_USE_ITEM: 'control', CMSG_SAVE: 'control', CMSG_LOAD: 'control',
  CMSG_DIALOG_ADVANCE: 'dialog', CMSG_CHOICE: 'menu', CMSG_BATTLE_ACTION: 'battle'
};
const UNSUPPORTED = {
  CMSG_MENU_EQUIP: 'equip through the menu in M0: CMSG_KEY Menu, then CMSG_CHOICE',
  CMSG_MENU_MAGIC: 'cast through the menu in M0: CMSG_KEY Force, then CMSG_CHOICE',
  CMSG_SHOP_BUY: 'shops are plain menus in M0: use CMSG_CHOICE',
  CMSG_SHOP_SELL: 'shops are plain menus in M0: use CMSG_CHOICE',
  CMSG_SHOP_CLOSE: 'shops are plain menus in M0: CMSG_KEY Menu closes them',
  CMSG_TICK: 'lockstep is not available before M4 (the realtime clock only advances while a command runs); use CMSG_WAIT'
};
// CMSG_BATTLE_ACTION.type → battle 工具的 action(M5 B4:仙术 / 物品 / 投掷 / 合擊都接上了;siege 原版没有对应指令)
const BATTLE_TYPE = { attack: 'attack', defend: 'defend', flee: 'flee', repeat: 'repeat', auto: 'auto', magic: 'magic', item: 'item', throw: 'throw', combo: 'coop' };

/** CMSG → [工具名, 参数](tools.mjs 的调度表);不支持的返回 { reject }。 */
export function toToolCall(m, word, owned = false) {
  switch (m.op) {
    case 'CMSG_MOVE': return ['step', { direction: m.dir, n: m.steps ?? 1 }];
    case 'CMSG_INTERACT': return ['search', {}];
    case 'CMSG_DIALOG_ADVANCE': return ['advance', { max: 1 }];
    case 'CMSG_CHOICE': return ['choose', { index: m.index }];
    case 'CMSG_MENU_USE_ITEM': {
      const item = typeof m.item === 'number' ? word(m.item) : m.item;
      if (!item) return { reject: ['not_found', `no item with id ${m.item}`] };
      return ['use_item', { item, target: m.target ?? 0 }];
    }
    case 'CMSG_BATTLE_ACTION': {
      const action = BATTLE_TYPE[m.type];
      if (!action) return { reject: ['unsupported', `battle action "${m.type}" is not supported (${Object.keys(BATTLE_TYPE).join(' / ')} are)`] };
      const args = { action, ...(m.target != null ? { target: m.target } : {}) };
      if (action === 'magic' || action === 'item' || action === 'throw') {
        const ref = action === 'magic' ? m.magic : m.item;
        const name = typeof ref === 'number' ? word(ref) : ref;
        if (owned && typeof ref === 'number') args.referenceID = ref;
        if (!name && args.referenceID == null) return { reject: [ref == null ? 'invalid' : 'not_found', ref == null ? `${m.type} needs ${action === 'magic' ? 'magic' : 'item'} (id or name)` : `no ${action === 'magic' ? 'spell' : 'item'} with id ${ref}`] };
        args.name = name || `id ${ref}`;
      }
      return ['battle', args];
    }
    case 'CMSG_SAVE': return ['save', { slot: m.slot, ...(m.note ? { note: m.note } : {}) }];
    case 'CMSG_LOAD': return ['load', { slot: m.slot }];
    case 'CMSG_KEY': return ['press', { key: m.key, ms: m.ms ?? 100 }];
    case 'CMSG_WAIT': return ['wait', { ms: m.ms ?? 1000 }];
    default: return { reject: ['unsupported', UNSUPPORTED[m.op] || `${m.op} is not supported in M0`] };
  }
}

/** 执行失败(ok:false)的原因归类。 */
function failReason(op, note) {
  const n = String(note || '');
  if (op === 'CMSG_MOVE' && /blocked/.test(n)) return 'blocked';
  if (/empty|not found|no item matching|no living enemy/.test(n)) return 'not_found';
  if (/out of range|disabled|bad /.test(n)) return 'invalid';
  if (/cannot .*: mode is|no menu open|not in battle/.test(n)) return 'wrong_mode';
  return 'failed';
}

/**
 * L0 会话。所有推进游戏的入口都经 send();调用方负责串行(同一时刻只跑一条指令),
 * 并在释放串行队列之后再把返回的事件投给模块(modules.mjs deliver)—— 否则模块在 packet 里再发指令会等死。
 * @param e   bootEngine() 的返回值
 * @param a   createAgent() 的返回值(复用它的按键注入与决策点判定)
 * @param opts.onCall  每条执行了的指令回调 { name, args, result, cmsg, via } —— mcp 用它写 runs/ JSONL
 */
export function createL0(e, a, opts = {}) {
  const onCall = opts.onCall || (() => {});
  const battleMemo = {};
  const seenLines = new WeakSet();
  let last = null;
  let autoSeq = 0;

  const word = (n) => { try { return e.word(n); } catch { return ''; } };
  const snapshot = () => readState(e, a, battleMemo);

  /** 自上次以来的新对白(按历史条目引用判新;说话人名行跳过)。读全量 dialogLog:引擎 history 只留 20 条。 */
  function dialogEvents() {
    const out = [];
    for (const h of e.dialogLog || e.dialogService.getHistory?.() || []) {
      if (!h || seenLines.has(h)) continue;
      seenLines.add(h);
      const text = String(h.text || '').trim();
      if (!text) continue;
      const speaker = h.source ? String(h.source).trim() : null;
      if (speaker && text === speaker) continue;
      out.push({ op: 'SMSG_DIALOG', speaker, text });
      if (DEFEAT_LINE.test(text)) out.push({ op: 'SMSG_GAME_OVER', note: 'the party was defeated; the game reloads the last save (or restarts with none)' });
    }
    return out;
  }

  // ---- 引擎原生战斗事件 → SMSG(M5 B3)--------------------------------------------------
  const battleSvc = e.services?.battle;
  const nativeBattle = typeof battleSvc?.battleEventsSince === 'function';
  let battleSeq = nativeBattle ? battleSvc.lastBattleEventSeq : 0;
  let battleStart = null;      // 当前这场的 start 事件:结束时算银两差与升级
  const roleName = (role) => { try { return word(Number(e.worldService._getPlayerRoleArrayValue('name', role, 0)) || 0) || `role${role}`; } catch { return `role${role}`; } };
  const enemyName = (objectID) => word(objectID) || `enemy${objectID}`;
  /** 取走引擎日志里新的战斗事件,转成 SMSG;没有原生日志(旧引擎)返回 null,由 diffState 求差 */
  function battleEvents() {
    if (!nativeBattle) return null;
    const out = [];
    for (const ev of battleSvc.battleEventsSince(battleSeq)) {
      battleSeq = ev.seq;
      if (ev.type === 'start') {
        battleStart = ev;
        out.push({ op: 'SMSG_BATTLE_START', battle: ev.battle, enemies: ev.enemies.map((x) => ({ index: x.index, name: enemyName(x.objectID), hp: x.hp, maxHp: x.hp })), ...(ev.isBoss ? { boss: true } : {}) });
      } else if (ev.type === 'hp' && ev.side === 'enemy') {
        out.push({ op: 'SMSG_BATTLE_EVENT', battle: ev.battle, kind: 'hp', side: 'enemy', index: ev.index, name: enemyName(ev.objectID), from: ev.from, to: ev.to });
      } else if (ev.type === 'hp') {
        out.push({ op: 'SMSG_BATTLE_EVENT', battle: ev.battle, kind: 'hp', side: 'party', roleId: ev.role, name: roleName(ev.role), from: ev.from, to: ev.to });
      } else if (ev.type === 'gone') {
        out.push({ op: 'SMSG_BATTLE_EVENT', battle: ev.battle, kind: 'enemy_gone', index: ev.index, name: enemyName(ev.objectID), killed: !!ev.killed });
      } else if (ev.type === 'prompt') {
        out.push({ op: 'SMSG_BATTLE_PROMPT', battle: ev.battle, member: ev.member, ...(ev.revision != null ? { revision: ev.revision } : {}) });
      } else if (ev.type === 'end') {
        const before = battleStart;
        const levelUps = ev.party
          .map((m) => ({ name: roleName(m.role), from: before?.party.find((b) => b.role === m.role)?.level ?? m.level, to: m.level }))
          .filter((x) => x.to > x.from);
        out.push({ op: 'SMSG_BATTLE_END', battle: ev.battle, result: ev.error ? 'error' : BATTLE_RESULT[ev.result] ?? `result-${ev.result}`, cashDelta: ev.cash - (before?.cash ?? ev.cash), levelUps, exp: ev.expGained, ...(ev.error ? { error: ev.error } : {}) });
        battleStart = null;
      }
    }
    return out;
  }

  /** 自上次快照以来的增量(含新对白),并把基准挪到现在。 */
  function sync() {
    const events = dialogEvents();
    const cur = snapshot();
    events.push(...diffState(last, cur, battleEvents()));
    last = cur;
    return events;
  }

  const api = {
    /** 当前快照(只读,不产生事件)。用备忘的副本读:否则恰在战斗结束后读一次,BATTLE_END 就被它吞了。 */
    state: () => readState(e, a, { ...battleMemo }),

    /** 握手:HELLO + 全量。之前出现过的对白不再补发(重建靠全量,不靠回放历史)。 */
    hello(layer = 'pure') {
      for (const h of e.dialogLog || e.dialogService.getHistory?.() || []) if (h) seenLines.add(h);
      last = snapshot();
      if (nativeBattle) battleSeq = battleSvc.lastBattleEventSeq;      // 握手之前的战斗事件不补发(重建靠全量)
      let slot = null;
      try { slot = e.worldService.getCurrentSaveSlot?.() ?? null; } catch { /* */ }
      return [{ op: 'SMSG_HELLO', version: 0, mode: 'realtime', layer, seed: e.seed ?? null, slot }, ...fullState(last)];
    },

    /** 运行中热加载模块或初始化内联脚本模型用:生成当前时刻的 HELLO + 全量快照,不改增量基准 last 与已读对白。 */
    helloSnapshot(layer = 'pure') {
      const s = api.state();
      let slot = null;
      try { slot = e.worldService.getCurrentSaveSlot?.() ?? null; } catch { /* */ }
      return [{ op: 'SMSG_HELLO', version: 0, mode: 'realtime', layer, seed: e.seed ?? null, slot }, ...fullState(s)];
    },

    /** 全量(observe):积压的新对白 + 当前全部状态;增量基准挪到现在。 */
    observe() {
      const dlg = dialogEvents();
      const fight = battleEvents() || [];
      last = snapshot();
      return [...dlg, ...fight, ...fullState(last)];
    },

    /** 不经 L0 推进了游戏之后(assist 模式的 L1 工具)补发增量,让模块的世界模型跟上。 */
    sync,

    clock() {
      return { tick: e.probes.frames, vt: e.clock ? Math.round(e.clock.now() * 1000) / 1000 : null };
    },

    /**
     * 执行一条 CMSG。返回 { reply: SMSG_ACK|SMSG_REJECT, events: SMSG[], call }。
     * Preflight refusals do not advance the game. An owned takeover can switch
     * mode off before its fresh actor constraint refuses, returning that live
     * manual wait and any native progress events. meta.via only enters logs.
     */
    async send(input, meta = {}) {
      return measureCall(() => api.sendInner(input,meta), {virtualNow:()=>e.clock?.now()??null, decision:()=>decisionStop(a,e),record:timing=>opts.onTiming?.({name:"send",via:meta.via??null,...timing})});
    },
    async sendInner(input, meta = {}) {
      const parsed = parseClientMsg(input);
      if (!parsed.ok) return { reply: reject(parsed.seq, 'invalid', parsed.error), events: [] };
      const m = parsed.msg;
      const seq = m.seq ?? ++autoSeq;
      if (last == null) last = snapshot();

      const call = toToolCall(m, word, e.services.battleCommandRuntime?.owned === true);
      if (call.reject) return { reply: reject(seq, ...call.reject), events: [] };

      if (m.op === 'CMSG_BATTLE_ACTION' && e.services.battleCommandRuntime?.owned && m.member != null && m.type !== 'auto') {
        const owner = e.commandWait?.(), prompt = owner?.payload?.prompt;
        const progress = owner === null && m.type === 'flee' ? e.battleExecutionContext?.() : null;
        const existingFleeWatch = !!(progress?.flee || progress?.fleeAttempt);
        if ((!prompt && !existingFleeWatch) || (owner?.kind === 'battle.command' && m.member !== prompt.member)) return { reply: reject(seq, 'invalid', 'member does not match the current owned prompt'), events: [] };
        // A commandless native Flee watch commits no actor and returns at the
        // next boundary; it cannot carry this member into a future submission.
        // Mode anchors are not actors. Keep this constraint across asynchronous
        // takeover, then validate against the fresh manual owner before staging.
        call[1].expectedMember = m.member;
      }
      const mode = a.mode();
      if (mode === 'crashed') return { reply: reject(seq, 'failed', `engine crashed: ${e.probes.crash?.message}`), events: [] };
      const need = NEEDS[m.op];
      if (need && mode !== need) {
        const reason = need === 'control' && mode === 'busy' ? 'cutscene' : 'wrong_mode';
        return { reply: reject(seq, reason, `${m.op} needs mode ${need}; mode is ${mode}`), events: [] };
      }

      const [name, args] = call;
      const result = await measureCall(() => e.drive(runTool(a, name, args)), {virtualNow:()=>e.clock?.now()??null, decision:()=>decisionStop(a,e), record:timing=>opts.onTiming?.({name,via:meta.via??null,...timing})});
      onCall({ name, args, result, cmsg: m, via: meta.via ?? null });
      const events = sync();
      const note = result?.note;
      const reply = result && result.ok === false ? reject(seq, m.op === 'CMSG_BATTLE_ACTION' && e.services.battleCommandRuntime?.owned && ['unsupported', 'invalid', 'wrong_mode', 'not_found', 'failed'].includes(result.reason) ? result.reason : failReason(m.op, note), note) : ack(seq, note);
      return { reply, events, call: [name, args] };
    }
  };
  return api;
}
