/**
 * pure — `--pure` 会话的 MCP 工具面:只有 L0 原语(§5.4),每个工具就是一条(或一串)CMSG,
 * 返回 ACK/REJECT 与这条指令产生的 SMSG 原文。没有寻路、没有 ASCII 图、没有地图记忆、没有攻略 ——
 * 那些要 agent 自己写成 L2 模块,或在 `--assist` 下用官方 L1。
 *
 * 工具名沿用 MVP(step / search / advance …),参数是同名 L1 工具的子集,
 * 所以 runs/ 日志里的调用在 golden.mjs from-run 里照样能重放。
 */
import { MOVE_MAX_STEPS, DIRECTIONS, KEYS } from '@onchainpal/agent-pal-protocol';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

export const PURE_TOOLS = [
  {
    name: 'observe',
    description: 'Full state as Agent-PAL protocol messages (SMSG_SCENE_ENTER with every visible object, party, inventory, open menu, battle, and SMSG_MODE = the current decision point: control / dialog / menu / battle / busy). Build your own world model from these; there is no map image and no pathfinding in this mode. Coordinates: a rotated grid where up = y-1, down = y+1, left = x-1, right = x+1.',
    inputSchema: obj()
  },
  {
    name: 'step',
    description: `CMSG_MOVE: walk 1-${MOVE_MAX_STEPS} cells in one direction (mode control). REJECT blocked = a wall; watch SMSG_PLAYER_UPDATE for where you ended up, and SMSG_SCENE_ENTER when you walked onto an exit.`,
    inputSchema: obj({ direction: { type: 'string', enum: [...DIRECTIONS] }, n: { type: 'integer', minimum: 1, maximum: MOVE_MAX_STEPS, default: 1 } }, ['direction'])
  },
  { name: 'search', description: 'CMSG_INTERACT: press the search/talk key toward the cell you are facing (mode control).', inputSchema: obj() },
  {
    name: 'advance',
    description: 'CMSG_DIALOG_ADVANCE, repeated while the mode stays dialog (up to max). Every line of text comes back as SMSG_DIALOG.',
    inputSchema: obj({ max: { type: 'integer', minimum: 1, maximum: 200, default: 40 } })
  },
  { name: 'choose', description: 'CMSG_CHOICE: pick option `index` of the open menu (SMSG_CHOICE lists them).', inputSchema: obj({ index: { type: 'integer', minimum: 0 } }, ['index']) },
  {
    name: 'battle',
    description: 'CMSG_BATTLE_ACTION for the party member whose turn it is (SMSG_BATTLE_PROMPT). attack / combo (joint attack) take an optional enemy `target` index (from SMSG_BATTLE_STATE); magic needs `magic` (spell id or name), item / throw need `item` (id or name) — target is an enemy index for attack spells and thrown items, a party member index for healing.',
    inputSchema: obj({ action: { type: 'string', enum: ['attack', 'defend', 'flee', 'repeat', 'auto', 'magic', 'item', 'throw', 'combo'], default: 'attack' }, target: { type: 'integer', minimum: 0 }, magic: { type: ['string', 'integer'] }, item: { type: ['string', 'integer'] } })
  },
  {
    name: 'use_item',
    description: 'CMSG_MENU_USE_ITEM: use an item by name or id on party member `target` (mode control). It acts on what you are facing, so turn toward an object first if the item is meant for it.',
    inputSchema: obj({ item: { type: ['string', 'integer'] }, target: { type: 'integer', minimum: 0, default: 0 } }, ['item'])
  },
  {
    name: 'press',
    description: `CMSG_KEY: press a raw game key (${KEYS.join(' ')}). Menu opens the system menu / cancels; Search confirms.`,
    inputSchema: obj({ key: { type: 'string', enum: [...KEYS] }, ms: { type: 'integer', minimum: 16, maximum: 2000, default: 100 } }, ['key'])
  },
  { name: 'wait', description: 'CMSG_WAIT: let the game run for ms milliseconds (e.g. while a cutscene plays — mode busy).', inputSchema: obj({ ms: { type: 'integer', minimum: 0, maximum: 15000, default: 1000 } }) },
  { name: 'save', description: 'CMSG_SAVE: save to slot 1-99 (mode control).', inputSchema: obj({ slot: { type: 'integer', minimum: 1, maximum: 99 }, note: { type: 'string' } }, ['slot']) },
  { name: 'load', description: 'CMSG_LOAD: load a slot (mode control).', inputSchema: obj({ slot: { type: 'integer', minimum: 1, maximum: 99 } }, ['slot']) },
  { name: 'list_saves', description: 'List save slots (does not advance the game).', inputSchema: obj() },
  {
    name: 'run_code',
    description: 'Execute an async JavaScript function body (`pal`, `console`, `global`, `args` in scope) that interacts with the game strictly through L0 protocol messages (`await pal.send({ op: "CMSG_MOVE", dir: "up" })` or shorthands `pal.step(dir, n)`, `pal.interact()`, `pal.advance()`, `pal.choose(i)`, `pal.battle(type, extra)`). `pal.world` holds the live world model built from SMSG packets; `global` persists across calls for reusable helper functions and state; `pal.on(op, fn)` subscribes to SMSG packets; `pal.registerTool(name, { description, inputSchema }, fn)` registers a custom MCP tool at runtime; `await pal.readData("scenes.json")` reads static data dump files.',
    inputSchema: obj({
      code: { type: 'string', description: 'Async JavaScript function body. Use `await pal.step(...)` / `await pal.send(...)`, inspect `pal.world`, store helpers on `global`, and `return` a result.' },
      args: { type: 'object', description: 'Optional arguments passed as `args` to the function.', additionalProperties: true },
      timeout_ms: { type: 'integer', minimum: 50, maximum: 120000, default: 30000 }
    }, ['code'])
  },
  {
    name: 'module_reload',
    description: 'Hot-load a new L2 protocol module directory or hot-reload modified/existing L2 modules at runtime without restarting the game. Newly loaded or restarted modules immediately receive SMSG_HELLO and the current full state snapshot, and their RPC methods become available as `<module>__<method>` tools.',
    inputSchema: obj({
      dir: { type: 'string', description: 'Optional path to a module directory (containing module.yaml) or a parent directory of modules to add and load.' },
      name: { type: 'string', description: 'Optional module name to reload specifically.' },
      all: { type: 'boolean', description: 'If true, force restart all loaded modules even if their files did not change.' }
    })
  }
];

export const PURE_TOOL_NAMES = new Set(PURE_TOOLS.map((t) => t.name));

/**
 * 执行一个 pure 工具。run = 会话的串行队列(推进游戏的部分必须在队列里)。
 * 返回 { text, events }:events 由调用方在释放队列后投给模块。
 */
export async function callPure(name, args, { l0, a, run }) {
  if (name === 'observe') {
    const events = await run(async () => l0.observe());
    return { text: render(null, events, 'full state'), events };
  }
  if (name === 'list_saves') {
    const r = await run(async () => a.listSaves());
    return { text: r.note.trim(), events: [] };
  }
  if (name === 'advance') {
    const max = args.max ?? 40;
    return run(async () => {
      const events = [];
      let reply = null;
      for (let i = 0; i < max; i++) {
        const r = await l0.send({ op: 'CMSG_DIALOG_ADVANCE' });
        reply = r.reply;
        events.push(...r.events);
        if (r.reply.op === 'SMSG_REJECT' || l0.state().mode !== 'dialog') break;
      }
      return { text: render(reply, events), events: reply ? [reply, ...events] : events };
    });
  }
  const cmsg = toCmsg(name, args);
  const r = await run(() => l0.send(cmsg));
  return { text: render(r.reply, r.events), events: [r.reply, ...r.events] };
}

function toCmsg(name, args) {
  switch (name) {
    case 'step': return { op: 'CMSG_MOVE', dir: args.direction, ...(args.n != null ? { steps: args.n } : {}) };
    case 'search': return { op: 'CMSG_INTERACT' };
    case 'choose': return { op: 'CMSG_CHOICE', index: args.index };
    case 'battle': return { op: 'CMSG_BATTLE_ACTION', type: args.action ?? 'attack', ...(args.target != null ? { target: args.target } : {}), ...(args.magic != null ? { magic: args.magic } : {}), ...(args.item != null ? { item: args.item } : {}) };
    case 'use_item': return { op: 'CMSG_MENU_USE_ITEM', item: args.item, ...(args.target != null ? { target: args.target } : {}) };
    case 'press': return { op: 'CMSG_KEY', key: args.key, ...(args.ms != null ? { ms: args.ms } : {}) };
    case 'wait': return { op: 'CMSG_WAIT', ...(args.ms != null ? { ms: args.ms } : {}) };
    case 'save': return { op: 'CMSG_SAVE', slot: args.slot, ...(args.note ? { note: args.note } : {}) };
    case 'load': return { op: 'CMSG_LOAD', slot: args.slot };
    default: throw new Error(`not an L0 tool: ${name}`);
  }
}

/** 给 LLM 的文本:回复一行 + SMSG 原文(每行一条)。协议即界面,不做二次加工。 */
export function render(reply, events, label = 'events') {
  const out = [];
  if (reply) out.push(reply.op === 'SMSG_ACK' ? `ACK — ${reply.note || 'ok'}` : `REJECT ${reply.reason} — ${reply.note || ''}`);
  out.push(`${label} (${events.length}):`);
  for (const ev of events) out.push(JSON.stringify(ev));
  return out.join('\n');
}
