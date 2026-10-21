/**
 * Agent-PAL 线协议 v0 —— docs/specs/agent-pal.md §4。
 *
 * 信封:{ op, seq?, ...载荷 }。op 可写名字('CMSG_MOVE')也可写数字(0x01),解析后一律归一成名字。
 * 每条 CMSG 带 seq;sim 必回 SMSG_ACK{seq} 或 SMSG_REJECT{seq, reason}(§4.1-2)。
 *
 * v0 相对 spec §4.2 草案的增补(M0 包旧引擎期间需要,写进 spec 的 §4.2 注记):
 *  - SMSG_MODE:决策点(control / dialog / menu / battle / busy / crashed)。M3 之前对白/选择/商店还不是原生
 *    wait 状态,agent 靠它知道「现在该发哪类 CMSG」。
 *  - SMSG_PLAYER_UPDATE:主角位置/朝向。草案把位置放在 SCENE_ENTER 全量里,走一步的增量没有归属。
 *  - CMSG_KEY / CMSG_WAIT:过渡用。§5.4 把「原始按键」列为 L0;WAIT 在锁步(M4)之后由 CMSG_TICK 取代。
 * 草案里尚未在 M0 发出的消息(SHOP_OPEN、FX、CUTSCENE_*、ENDING)先定义好编号,实现时不改协议。
 */

export const PROTOCOL_VERSION = 0;

export const DIRECTIONS = ['up', 'down', 'left', 'right'];
/** §11-3:上限很小,防止 MOVE 变成「走到某处」。初定 4。 */
export const MOVE_MAX_STEPS = 4;
export const BATTLE_ACTIONS = ['attack', 'magic', 'item', 'throw', 'defend', 'flee', 'combo', 'siege', 'auto', 'repeat'];
export const KEYS = ['Up', 'Down', 'Left', 'Right', 'Search', 'Menu', 'UseItem', 'ThrowItem', 'Force', 'Status', 'Auto', 'Defend', 'Flee', 'Repeat', 'PageUp', 'PageDown'];
export const MODES = ['control', 'dialog', 'menu', 'battle', 'busy', 'crashed'];
export const REJECT_REASONS = [
  'invalid',        // 载荷不合法
  'wrong_mode',     // 当前决策点不接受这类指令(如对白中发 MOVE)
  'cutscene',       // 脚本接管中(mode = busy),不接受移动类指令
  'blocked',        // 走不动
  'not_found',      // 物品 / 存档槽 / 目标不存在
  'unsupported',    // 协议里有、M0 包裹层还不支持(用 CMSG_CHOICE / CMSG_KEY 代替)
  'failed'          // 其他执行失败,原因见 note
];

// ---- opcode 表 --------------------------------------------------------------------
// 客户端 → sim:0x01 起;sim → 客户端:0x81 起。数字一旦发布不再改。
export const CMSG = Object.freeze({
  CMSG_MOVE: 0x01,
  CMSG_INTERACT: 0x02,
  CMSG_DIALOG_ADVANCE: 0x03,
  CMSG_CHOICE: 0x04,
  CMSG_MENU_USE_ITEM: 0x05,
  CMSG_MENU_EQUIP: 0x06,
  CMSG_MENU_MAGIC: 0x07,
  CMSG_SHOP_BUY: 0x08,
  CMSG_SHOP_SELL: 0x09,
  CMSG_SHOP_CLOSE: 0x0a,
  CMSG_BATTLE_ACTION: 0x0b,
  CMSG_SAVE: 0x0c,
  CMSG_LOAD: 0x0d,
  CMSG_TICK: 0x0e,
  CMSG_KEY: 0x0f,
  CMSG_WAIT: 0x10
});

export const SMSG = Object.freeze({
  SMSG_HELLO: 0x81,
  SMSG_CLOCK: 0x82,
  SMSG_MODE: 0x83,
  SMSG_SCENE_ENTER: 0x84,
  SMSG_PLAYER_UPDATE: 0x85,
  SMSG_OBJECT_UPDATE: 0x86,
  SMSG_PARTY_UPDATE: 0x87,
  SMSG_INVENTORY_UPDATE: 0x88,
  SMSG_DIALOG: 0x89,
  SMSG_CHOICE: 0x8a,
  SMSG_SHOP_OPEN: 0x8b,
  SMSG_BATTLE_START: 0x8c,
  SMSG_BATTLE_STATE: 0x8d,
  SMSG_BATTLE_PROMPT: 0x8e,
  SMSG_BATTLE_EVENT: 0x8f,
  SMSG_BATTLE_END: 0x90,
  SMSG_FX: 0x91,
  SMSG_CUTSCENE_BEGIN: 0x92,
  SMSG_CUTSCENE_END: 0x93,
  SMSG_ACK: 0x94,
  SMSG_REJECT: 0x95,
  SMSG_GAME_OVER: 0x96,
  SMSG_ENDING: 0x97
});

const NAME_BY_NUM = new Map([...Object.entries(CMSG), ...Object.entries(SMSG)].map(([k, v]) => [v, k]));

/** 名字或数字 → 名字;认不出返回 null。 */
export function opName(op) {
  if (typeof op === 'string') return op in CMSG || op in SMSG ? op : null;
  if (typeof op === 'number') return NAME_BY_NUM.get(op) ?? null;
  return null;
}
export const opNumber = (op) => { const n = opName(op); return n ? (CMSG[n] ?? SMSG[n]) : null; };
export const isClientOp = (op) => { const n = opName(op); return !!n && n in CMSG; };
export const isServerOp = (op) => { const n = opName(op); return !!n && n in SMSG; };

// ---- 载荷校验 ----------------------------------------------------------------------
// 迷你 schema:{ field: [type, required, extra] }。只校验协议层面的形状,不校验游戏语义(那归 sim)。
const int = (min, max) => ({ type: 'int', min, max });
const oneOf = (values) => ({ type: 'enum', values });
const str = { type: 'string' };
const intOrStr = { type: 'int|string' };

const CLIENT_FIELDS = {
  CMSG_MOVE: { dir: [oneOf(DIRECTIONS), true], steps: [int(1, MOVE_MAX_STEPS), false] },
  CMSG_INTERACT: {},
  CMSG_DIALOG_ADVANCE: {},
  CMSG_CHOICE: { index: [int(0, 255), true] },
  CMSG_MENU_USE_ITEM: { item: [intOrStr, true], target: [int(0, 5), false] },
  CMSG_MENU_EQUIP: { item: [intOrStr, true], target: [int(0, 5), false] },
  CMSG_MENU_MAGIC: { magic: [intOrStr, true], target: [int(0, 5), false] },
  CMSG_SHOP_BUY: { item: [intOrStr, true], amount: [int(1, 99), false] },
  CMSG_SHOP_SELL: { item: [intOrStr, true], amount: [int(1, 99), false] },
  CMSG_SHOP_CLOSE: {},
  CMSG_BATTLE_ACTION: { type: [oneOf(BATTLE_ACTIONS), true], member: [int(0, 5), false], target: [int(0, 9), false], magic: [intOrStr, false], item: [intOrStr, false] },
  CMSG_SAVE: { slot: [int(1, 99), true], note: [str, false] },
  CMSG_LOAD: { slot: [int(1, 99), true] },
  CMSG_TICK: { n: [int(1, 100000), false] },
  CMSG_KEY: { key: [oneOf(KEYS), true], ms: [int(16, 2000), false] },
  CMSG_WAIT: { ms: [int(0, 15000), false] }
};

// 服务端消息只校验必填字段存在(sim 自己产出,形状由测试保证;客户端解析时宽松,便于后续加字段)
const SERVER_REQUIRED = {
  SMSG_HELLO: ['version', 'mode', 'layer'],
  SMSG_CLOCK: ['tick'],
  SMSG_MODE: ['mode'],
  SMSG_SCENE_ENTER: ['scene', 'player', 'objects'],
  SMSG_PLAYER_UPDATE: ['gx', 'gy', 'facing'],
  SMSG_OBJECT_UPDATE: ['id'],
  SMSG_PARTY_UPDATE: ['members'],
  SMSG_INVENTORY_UPDATE: ['items', 'cash'],
  SMSG_DIALOG: ['text'],
  SMSG_CHOICE: ['kind', 'items', 'index'],
  SMSG_SHOP_OPEN: ['items'],
  SMSG_BATTLE_START: ['enemies'],
  SMSG_BATTLE_STATE: ['enemies', 'party', 'turn'],
  SMSG_BATTLE_PROMPT: ['member'],
  SMSG_BATTLE_EVENT: ['kind'],
  SMSG_BATTLE_END: ['result'],
  SMSG_FX: ['kind'],
  SMSG_CUTSCENE_BEGIN: [],
  SMSG_CUTSCENE_END: [],
  SMSG_ACK: ['seq'],
  SMSG_REJECT: ['seq', 'reason'],
  SMSG_GAME_OVER: [],
  SMSG_ENDING: []
};

function checkField(name, v, spec) {
  switch (spec.type) {
    case 'int':
      if (!Number.isInteger(v)) return `${name} must be an integer`;
      if (spec.min != null && v < spec.min) return `${name} must be ≥ ${spec.min}`;
      if (spec.max != null && v > spec.max) return `${name} must be ≤ ${spec.max}`;
      return null;
    case 'enum': return spec.values.includes(v) ? null : `${name} must be one of ${spec.values.join(' / ')}`;
    case 'string': return typeof v === 'string' ? null : `${name} must be a string`;
    case 'int|string': return Number.isInteger(v) || (typeof v === 'string' && v.length > 0) ? null : `${name} must be an id or a name`;
    default: return null;
  }
}

/**
 * 解析客户端消息(字符串或对象)。成功:{ ok: true, msg }(op 已归一成名字);失败:{ ok: false, error, seq }。
 * 未知字段一律拒绝:协议面要窄,写错字段名应该当场报错而不是被静默忽略。
 */
export function parseClientMsg(input) {
  let m = input;
  if (typeof input === 'string') {
    try { m = JSON.parse(input); } catch { return { ok: false, error: 'not valid JSON', seq: null }; }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'message must be an object', seq: null };
  const seq = Number.isInteger(m.seq) ? m.seq : null;
  const name = opName(m.op);
  if (!name || !(name in CMSG)) return { ok: false, error: `unknown client op ${JSON.stringify(m.op)}`, seq };
  if (m.seq != null && !Number.isInteger(m.seq)) return { ok: false, error: 'seq must be an integer', seq: null };
  const fields = CLIENT_FIELDS[name];
  const out = { op: name };
  if (seq != null) out.seq = seq;
  for (const [k, v] of Object.entries(m)) {
    if (k === 'op' || k === 'seq') continue;
    if (!(k in fields)) return { ok: false, error: `${name} has no field "${k}"`, seq };
    const err = checkField(k, v, fields[k][0]);
    if (err) return { ok: false, error: `${name}: ${err}`, seq };
    out[k] = v;
  }
  for (const [k, [, required]] of Object.entries(fields)) {
    if (required && !(k in out)) return { ok: false, error: `${name} needs "${k}"`, seq };
  }
  return { ok: true, msg: out };
}

/** 解析服务端消息:op 合法 + 必填字段齐;多余字段放行(向前兼容)。 */
export function parseServerMsg(input) {
  let m = input;
  if (typeof input === 'string') {
    try { m = JSON.parse(input); } catch { return { ok: false, error: 'not valid JSON' }; }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'message must be an object' };
  const name = opName(m.op);
  if (!name || !(name in SMSG)) return { ok: false, error: `unknown server op ${JSON.stringify(m.op)}` };
  for (const k of SERVER_REQUIRED[name]) if (!(k in m)) return { ok: false, error: `${name} needs "${k}"` };
  return { ok: true, msg: { ...m, op: name } };
}

/** 编码:op 一律写名字(可读;二进制编码等协议稳定后再说,§4.3)。 */
export function serialize(msg) {
  const name = opName(msg?.op);
  if (!name) throw new Error(`cannot serialize: unknown op ${JSON.stringify(msg?.op)}`);
  return JSON.stringify({ ...msg, op: name });
}

/** 便捷构造:ack / reject。 */
export const ack = (seq, note) => ({ op: 'SMSG_ACK', seq: seq ?? null, ...(note ? { note } : {}) });
export const reject = (seq, reason, note) => ({ op: 'SMSG_REJECT', seq: seq ?? null, reason, ...(note ? { note } : {}) });

/** 协议自描述(module list / 调试用)。 */
export function describe() {
  return {
    version: PROTOCOL_VERSION,
    client: Object.fromEntries(Object.entries(CLIENT_FIELDS).map(([k, f]) => [k, { opcode: CMSG[k], fields: Object.fromEntries(Object.entries(f).map(([n, [s, req]]) => [n, { ...s, required: req }])) }])),
    server: Object.fromEntries(Object.entries(SERVER_REQUIRED).map(([k, req]) => [k, { opcode: SMSG[k], required: req }]))
  };
}

