import {attachInputLedger} from './input-ledger.mjs';
import {measureCall,decisionStop} from './execution-config.mjs';
/**
 * mcp — 手写的最小 MCP stdio 服务(换行分隔 JSON-RPC 2.0),把 agent 工具面暴露给 Claude Code 等客户端。
 *
 * 不引 SDK:只需 initialize / tools/list / tools/call / ping 四个方法。stdout 只走协议帧,
 * 引擎日志已在 bootEngine 里静音,我们自己的日志一律 stderr。
 *
 * 每次调用记一行 JSONL 到 runs/(工具名、参数、结果、期间的对白与换场),用于事后评估进度。
 */
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootEngine } from './engine.mjs';
import { createAgent } from './agent.mjs';
import { startRecorder } from './record.mjs';
import { renderPanorama } from './panorama.mjs';
import { PACKAGED, userHome } from './paths.mjs';
import { runTool, isSoftStop, resultLabel } from './tools.mjs';
import { framePng } from './png.mjs';
import { loadGuide, guideText } from './guide.mjs';
import { createL0 } from './l0.mjs';
import { PURE_TOOLS, PURE_TOOL_NAMES, callPure } from './pure.mjs';
import { loadModules, rpcNameFromTool } from './modules.mjs';
import { createCodeRunner } from './code-runner.mjs';
import { liveTools, liveInstructions, runChat, cleanText, NOTE_REMINDER } from './live.mjs';
import { sceneName } from './scene-names.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 分层(§5.4):assist = L0 + 官方 L1(MVP 的完整工具面,默认);pure = 只有 L0 原语。
 * 模块(L2)两种模式下都可加载,它们的方法注册成 MCP 工具 <module>__<method>。
 */
export const LAYER = process.env.AGENT_PAL_LAYER === 'pure' ? 'pure' : 'assist';
let modules = null;
let mcpActive = false;
function notifyToolsChanged() {
  if (mcpActive) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
}

/** 按需生成或返回 data dump 目录(供热加载的 data:true 模块与 run_code 的 pal.readData 使用)。 */
export async function ensureDataDump() {
  const existing = process.env.AGENT_PAL_DATA_DIR;
  if (existing && fs.existsSync(path.join(existing, 'manifest.json'))) return existing;
  const dataDir = path.resolve(process.env.AGENT_PAL_DATA || path.resolve(here, '..', 'pal-data'));
  if (!fs.existsSync(path.join(dataDir, 'manifest.json'))) {
    process.stderr.write(`[agent-pal] no data dump at ${dataDir}; dumping now…\n`);
    const { spawnSync } = await import('node:child_process');
    const os = await import('node:os');
    const binFile = path.resolve(here, '..', 'bin', 'agent-pal.mjs');
    const r = spawnSync(process.execPath, [binFile, 'data', 'dump', '--out', dataDir], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, AGENT_PAL_SAVES: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-dump-')), 'saves.json') }
    });
    if (r.status !== 0) throw new Error(`data dump failed (exit ${r.status})`);
  }
  process.env.AGENT_PAL_DATA_DIR = dataDir;
  return dataDir;
}

/** 构造传给 loadModules 的会话钩子,使启动时和运行中热加载的模块都能拿到当前世界状态与 data dump。 */
export function moduleOptions() {
  return {
    session: getSession,
    getHello: async () => (l0Ref ? l0Ref.helloSnapshot(LAYER) : null),
    ensureDataDump,
    onEvents: async (evs) => { await codeRunner.deliver(evs); },
    onChanged: notifyToolsChanged
  };
}

/** bin 在启动服务前加载好模块后交进来;保留 loader 引用以便运行中调用 reload。 */
export function setModules(loader) { modules = loader || null; }
async function ensureModules() {
  if (!modules) modules = await loadModules([], moduleOptions());
  return modules;
}
let l0Ref = null;
let resolveL0;
const l0Ready = new Promise((r) => { resolveL0 = r; });
/** 模块的会话 API 用:按需启动引擎,等 L0 就绪(不等模块收完 HELLO,否则模块在 HELLO 里发指令会互等)。 */
export async function getSession() {
  getAgent().catch((e) => process.stderr.write('[agent-pal] boot failed: ' + (e?.stack || e) + '\n'));
  return { l0: await l0Ready, run: serialize };
}

const runDir = process.env.AGENT_PAL_RUNS || (PACKAGED ? path.join(userHome(), 'runs') : path.resolve(here, '..', 'runs'));
fs.mkdirSync(runDir, { recursive: true });
const runFile = path.join(runDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
/** 这一轮的运行日志(回放文件和它同名、换个扩展名,好配对) */
export const runLogFile = runFile;
const record = (ev) => { try { fs.appendFileSync(runFile, JSON.stringify({ t: Date.now(), ...ev }) + '\n'); } catch { /* */ } };

/**
 * 自动存档:试玩常被外层超时直接杀掉,最后一段进度就丢了。
 *  - 退出时(SIGTERM/SIGINT/SIGHUP、stdin 关闭)若在 control 存一次
 *  - 工具调用之间每 AGENT_PAL_AUTOSAVE_MIN 分钟(默认 3)存一次,兜住被杀时正在战斗/对话的情况
 * 槽位 AGENT_PAL_AUTOSAVE_SLOT(默认 5,标题画面「舊的回憶」里能看到);0 = 关。
 * 确定性模式(锁步)默认关(黄金轨迹 / bench 不受影响);试玩用锁步时显式设 AGENT_PAL_AUTOSAVE_SLOT 即可照常自动存档。
 * 间隔按真实时间算:锁步下 Date 是虚拟时钟,只在工具调用期间走。
 * 确定性模式(黄金轨迹/bench)默认关:墙钟触发的存档会让同一份日志重放出不同的存档表。
 */
const AUTOSAVE_SLOT = Number(process.env.AGENT_PAL_AUTOSAVE_SLOT ?? (process.env.AGENT_PAL_SEED != null ? 0 : 5)) || 0;
const AUTOSAVE_EVERY_MS = (Number(process.env.AGENT_PAL_AUTOSAVE_MIN) || 3) * 60000;
const AUTOSAVE_EXPLICIT = process.env.AGENT_PAL_AUTOSAVE_SLOT != null;
const realNow = Date.now.bind(Date);          // 模块加载时还是真实时钟;引擎启动后锁步会把全局 Date 换成虚拟的
const autosaveAllowed = () => !engineRef?.deterministic || AUTOSAVE_EXPLICIT;


const COORDS = 'Coordinates are on a rotated grid where the four arrow keys move exactly one cell: up = y-1, down = y+1, left = x-1, right = x+1. (On the actual screen the world is drawn isometrically, so "up" looks like up-right.)';

export const TOOLS = [
  {
    name: 'observe',
    description: `Look at the game. Returns the mode (control = you can walk; dialog = text box waiting; menu = pick an option; battle; busy = a cutscene is playing), your position, party, any new dialog text since last call, and when walking a local ASCII map with nearby objects (NPCs, search spots, touch triggers such as doors/exits). ${COORDS}`,
    inputSchema: { type: 'object', properties: { full: { type: 'boolean', description: 'list every inventory item and every nearby object (normally the inventory is shown only when it changes, and only the 20 nearest objects)' } }, additionalProperties: false }
  },
  {
    name: 'screenshot',
    description: 'Return the current 320x200 game frame as an image (scaled 2x). Use it when the ASCII map is not enough to understand the scene.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'walk_to',
    description: `Pathfind and walk to grid cell (x, y). Stops early if something triggers (a cutscene, dialog, scene change). ${COORDS}`,
    inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false }
  },
  {
    name: 'step',
    description: 'Walk n cells in one direction (no pathfinding). Useful for stepping onto exits / touch triggers at the edge of the map.',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, n: { type: 'integer', minimum: 1, maximum: 30, default: 1 } }, required: ['direction'], additionalProperties: false }
  },
  {
    name: 'interact',
    description: 'Walk next to the object with this id (from observe), face it and press the search/talk key. This is how you talk to NPCs and examine things.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'search',
    description: 'Press the search/talk key in the direction you are facing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'advance',
    description: 'In dialog mode: keep pressing to advance the text until the dialog ends (or max presses). All text read is returned.',
    inputSchema: { type: 'object', properties: { max: { type: 'integer', minimum: 1, maximum: 200, default: 40 } }, additionalProperties: false }
  },
  {
    name: 'choose',
    description: 'In menu mode: select the option with this index.',
    inputSchema: { type: 'object', properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'], additionalProperties: false }
  },
  {
    name: 'use_item',
    description: 'Use an item from the inventory. Healing items: pick party member `target` (0 = first). Story items meant for an NPC or object: pass `facing` = that object id — you will walk up and face it first, because item scripts check what you are facing. Such items often just change what the NPC does next, so interact with it afterwards. To browse instead, press UseItem and use choose.',
    inputSchema: { type: 'object', properties: { item: { type: 'string', description: 'item name as shown in observe' }, target: { type: 'integer', minimum: 0, default: 0 }, facing: { type: 'integer', description: 'object id to stand in front of before using the item' } }, required: ['item'], additionalProperties: false }
  },
  {
    name: 'equip',
    description: 'Wear a weapon, armour or accessory from the bag on party member `member` (index as in observe\'s party list, or name). The piece it replaces goes back to the bag. Equipment cannot be used with use_item. Only while walking (control mode).',
    inputSchema: { type: 'object', properties: { item: { type: 'string', description: 'item name as shown in observe' }, member: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string' }], default: 0, description: 'party index (0 = first) or member name' } }, required: ['item'], additionalProperties: false }
  },
  {
    name: 'save',
    description: `Save the game to a numbered slot (1-99) so you can come back if something goes wrong. Add a short note to remember why. Only while walking (control mode). Slots 1-5 also show up in the game's own load menu (title screen 舊的回憶).${AUTOSAVE_SLOT ? ` Slot ${AUTOSAVE_SLOT} is the autosave: it is overwritten every few minutes and when the session ends, so keep your own saves in other slots.` : ''}`,
    inputSchema: { type: 'object', properties: { slot: { type: 'integer', minimum: 1, maximum: 99 }, note: { type: 'string' } }, required: ['slot'], additionalProperties: false }
  },
  {
    name: 'load',
    description: 'Load a previously saved slot (see list_saves). Only while walking (control mode).',
    inputSchema: { type: 'object', properties: { slot: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['slot'], additionalProperties: false }
  },
  {
    name: 'guide',
    description: 'Read the walkthrough (攻略) and the full story script (剧情对话) for this game. No arguments = list of sources and their chapters. chapter=N reads a chapter (source 1, the walkthrough, by default; pass source="主线" or a number for the script; long chapters are paged with page=N). query="keyword" (an NPC, place or item name, or a line you just saw) searches every source and shows surrounding lines — handy for "what happens next". Use it when unsure what the story expects you to do.',
    inputSchema: { type: 'object', properties: { chapter: { type: 'integer', minimum: 1 }, source: { type: ['string', 'integer'] }, page: { type: 'integer', minimum: 1 }, query: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'atlas',
    description: 'Show the hand-annotated full map (from a fan walkthrough) of the current scene, or of a named place: the whole area at once with labels for exits (e.g. 菜市场, 十里坡), houses, shops and item spots. Costs an image, so use it when you are lost in an area, not every step. observe already shows place names next to scene numbers when known.',
    inputSchema: { type: 'object', properties: { place: { type: 'string', description: 'place name, e.g. 余杭镇市集; omit for the current scene' } }, additionalProperties: false }
  },
  {
    name: 'panorama',
    description: 'Render the WHOLE current scene as one picture (the game\'s own map tiles) with a coordinate grid and lettered markers: you, every exit (and where it leads), ferries, enemies, people and search spots. Use it to plan a long route or find an exit that is outside observe\'s small local map, then walk_to the coordinates — walk_to plans over the whole scene, not just the local window. Costs an image (~1-2k tokens); the text legend lists every marker with its coordinates.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'map',
    description: 'Everything in the current scene with coordinates (every exit and where it leads, ferries, enemies, people, search spots — not limited to observe\'s local window), plus your map memory: every exit you have walked through (scene A exit → scene B and where you landed) and the people you have met in each scene. Recorded automatically as you play and kept across runs. observe also shows, next to each exit/trigger, where it leads — read from the game script even before you use it. When the scene is split into parts you cannot walk between (cave levels, dungeons), entries you cannot reach from where you stand are marked NOT reachable: get there through another exit.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'cast',
    description: 'Cast a spell outside battle (walking/control mode), e.g. a healing spell like 氣療術 or 觀音咒 after a fight instead of using items. caster and target are a party member index or name; leave caster empty to use whoever knows the spell and has the MP, leave target empty to heal the member with the lowest HP%. Returns HP/MP before and after. In battle use battle with action=magic instead.',
    inputSchema: { type: 'object', properties: { spell: { type: 'string' }, caster: { type: ['integer', 'string'] }, target: { type: ['integer', 'string'] } }, required: ['spell'], additionalProperties: false }
  },
  {
    name: 'grind',
    description: 'Level up the party automatically in the current area (prefer=exp picks the group worth the most experience instead of the weakest): repeatedly walk into the weakest visible monster group (nearest among similar ones) and fight turn by turn — heal spells when someone is below 45% HP, area attack spells when 2+ enemies remain (keeping MP for one heal), otherwise attack the weakest enemy, heal with healing items when someone drops below 70% HP; flees a battle when the party falls under half HP and avoids that group afterwards (revive items for a downed member; it stops instead of fighting on hurt when no healing item is left), and wait for monsters to respawn. Stops when the lowest party level reaches target_level, after max_battles battles or budget_s real seconds, or as soon as anything unexpected happens (a lost battle, a story event, leaving the scene, no healing items left, no monsters). Use it when you are under-levelled for the next area; pick a safe area where you win easily. Returns battles fought, levels before/after and items used.',
    inputSchema: { type: 'object', properties: { target_level: { type: 'integer', minimum: 1, maximum: 99 }, max_battles: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, budget_s: { type: 'integer', minimum: 10, maximum: 600, default: 120, description: 'real seconds for this call; capped at 110s to return before the MCP timeout. May stop mid-battle: observe before continuing.' }, prefer: { type: 'string', enum: ['safe', 'exp'], default: 'safe', description: 'safe = fight the weakest group (default); exp = fight the reachable group that gives the most experience — use it in late dungeons where the weakest groups level you too slowly (the same safety net applies: flee under half HP, avoid groups that hurt too much)' } }, required: ['target_level'], additionalProperties: false }
  },
  {
    name: 'list_saves',
    description: 'List save slots with scene, position, party and your notes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'battle',
    description: 'In battle mode, give the command for the party member whose turn it is (observe shows enemies with their target index, HP, and whose turn it is). attack = physical attack, optionally on enemy `target` (index from observe; default = last target); defend; flee; repeat = repeat last round\'s commands; auto = switch on auto-battle and let the game fight (any other action switches it off); coop = joint attack (合擊) by the whole party on enemy `target` — needs the current member and at least one other to be healthy, costs every member some HP, and the others skip their own action this round; magic = cast the spell `name` (observe lists the current member\'s spells and MP cost); item = use the item `name` from the bag (e.g. a healing item); throw = throw the item `name` at an enemy. A round plays out only after every member has a command, and then everyone (enemies included) acts in speed order — an enemy may hit before your heal or revive lands; the "HP changes" part of the result shows what happened during the round (e.g. 李逍遙 0→36→0 = revived, then knocked out again). For magic/item/throw, `target` is an enemy index for attack spells/thrown items, or a party member index (observe lists them under "party in battle") for healing/support; spells that hit everyone ignore it. Returns when it is your turn again or the battle is over (with won/lost/fled, cash and level changes).',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['attack', 'defend', 'flee', 'repeat', 'auto', 'magic', 'item', 'throw', 'coop'], default: 'attack' }, target: { type: 'integer', minimum: 0, description: 'enemy index (attack, attack spells, thrown items) or party member index (healing / support)' }, name: { type: 'string', description: 'spell name for magic, item name for item / throw (as shown in observe)' } }, additionalProperties: false }
  },
  {
    name: 'press',
    description: 'Escape hatch: press a raw game key. Keys: Up Down Left Right Search(confirm/talk) Menu(cancel/open menu) UseItem ThrowItem Force(magic) Status Auto Defend Flee Repeat PageUp PageDown Home End.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, ms: { type: 'integer', minimum: 16, maximum: 2000, default: 100 } }, required: ['key'], additionalProperties: false }
  },
  {
    name: 'wait',
    description: 'Let the game run for ms milliseconds (e.g. while a cutscene plays), then observe.',
    inputSchema: { type: 'object', properties: { ms: { type: 'integer', minimum: 0, maximum: 15000, default: 1000 } }, additionalProperties: false }
  }
];

let agentP = null;
let engineRef = null;
let agentRef = null;
let recorder = null;
let callIndex = 0;

let lastAutosave = realNow();
function autosave(why) {
  if (!AUTOSAVE_SLOT || !agentRef || !autosaveAllowed()) return;
  let r;
  try { r = agentRef.autosave(AUTOSAVE_SLOT, why); } catch (err) { r = { ok: false, note: String(err?.message || err) }; }
  if (r.ok) lastAutosave = realNow();
  record({ type: 'autosave', why, slot: AUTOSAVE_SLOT, ...r });
}
let exiting = false;
function exitWithAutosave(why, code = 0) {
  if (exiting) return;
  exiting = true;
  autosave(why);
  // 录像:写完最后一帧再走(ffmpeg 是脱离的子进程,读到 EOF 自己收尾)
  if (recorder) recorder.close(3000).then(() => process.exit(code));
  else process.exit(code);
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => exitWithAutosave(sig.toLowerCase(), 128 + ({ SIGTERM: 15, SIGINT: 2, SIGHUP: 1 })[sig]));
export function getAgent() {
  if (!agentP) {
    agentP = (async () => {
      const e = await bootEngine();
      engineRef = e;
      attachInputLedger(e.inputService,{frame:()=>e.worldService.getFrameCount?.()??null,now:()=>e.clock?.now()??null,record});
      if (process.env.AGENT_PAL_RECORD) {
        recorder = startRecorder(e, path.resolve(process.env.AGENT_PAL_RECORD));
        e.probes.onFrame = recorder.frame;
        process.stderr.write(`[agent-pal] recording → ${recorder.file}\n`);
      }
      // 会话头:确定性模式下这份日志可直接转成黄金轨迹场景(golden.mjs from-run)。
      // 开局时已有的存档拍快照存旁边:从存档继续玩的会话,重放时要从同一份存档起步(玩的过程中槽位可能被覆盖)
      let startSaves = null;
      if (e.deterministic) {
        const entries = {};
        for (const k of e.storage.keys()) if (/^(PAL-SAVE-|AGENT-PAL-META-)/.test(k)) entries[k] = e.storage.getItem(k);
        if (Object.keys(entries).length) {
          startSaves = runFile.replace(/\.jsonl$/, '.start-saves.json');
          fs.writeFileSync(startSaves, JSON.stringify(entries));
        }
      }
      // 倍速写进会话头,运行中改了再记一行:AI 的思考时间也是成绩的一部分,不同倍速下的成绩不能直接比
      record({ type: 'session', seed: e.seed, deterministic: e.deterministic, virtualClock: e.virtualClock, advancePolicy:e.advancePolicy, presentationPace:e.presentationPace, speed: e.speed, fleeGrace: e.fleeGrace ?? null, startSaves });
      if (typeof e.setSpeed === 'function') {
        const setSpeed = e.setSpeed;
        e.setSpeed = (v) => {
          const before = JSON.stringify(e.speed), after = setSpeed(v);
          if (JSON.stringify(after) !== before) record({ type: 'speed', speed: after });
          return after;
        };
      }
      const a = createAgent(e, { onLog: (ev) => { record(ev); liveGame(ev); } });
      agentRef = a;
      await e.drive(a.settle(60000));
      // L0 发出的每条指令按工具调用记一行(与 assist 同格式),from-run 照样能重放;via = 发起的模块或 run_code
      const l0 = createL0(e, a, {
        onTiming: ({name,via,...timing}) => record({type:"call_timing",scope:"l0",name,via,...timing}),
        onCall: ({ name, args, result, via }) => record({ type: 'call', name, args, result, ...(via ? { via } : {}), mode: a.mode(), ...a.stats(), ...(e.clock ? { vt: Math.round(e.clock.now()), rng: e.services.random.getState().draws } : {}) })
      });
      l0Ref = l0;
      resolveL0(l0);
      if (LAYER === 'pure' || (modules && modules.count)) {
        const helloEvs = l0.hello(LAYER);
        await codeRunner.deliver(helloEvs);
        if (modules && modules.count) await modules.deliver(helloEvs);
      }
      return a;
    })();
  }
  return agentP;
}

/** 当前这一局的引擎(pal-host 远程屏幕与 AI 工具面共用同一局) */
export async function getEngine() {
  await getAgent();
  return engineRef;
}

let queue = Promise.resolve();
export function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const codeRunner = createCodeRunner({
  getSession,
  getModules: () => modules,
  onEvents: async (evs) => { if (modules && modules.count) await modules.deliver(evs); },
  ensureDataDump,
  isReservedTool: (n) => PURE_TOOL_NAMES.has(n) || TOOLS.some((t) => t.name === n) || n === 'session_quit' || n === 'chat',
  onToolsChanged: notifyToolsChanged,
  logEvent: record
});

// 直播(pal-host --host):AI 的每次工具调用转播给观众;多一个 chat 工具。没开直播时一切照旧(bench / golden 不受影响)
let live = null;
export function setLive(hub) { live = hub; }
/** 参数原样转播(页面翻成人话);太长的字符串截短 */
const liveArgs = (args) => Object.fromEntries(Object.entries(args ?? {}).map(([k, v]) => [k, typeof v === 'string' ? cleanText(v, 60) : v]));
/** 开始一次工具调用的转播;返回结束时调用的函数(AI 的想法另走 host 的 /live/thought,见 scripts/live-narrate.mjs) */
function liveCall(name, args) {
  if (!live || !TOOLS.some((t) => t.name === name)) return () => {};   // 不认识的名字(打错 / 协议方法)不上直播
  const i = ++liveSeq, t0 = realNow();
  // before = 调用前的模式:观战页据此只在「模式变了」时说进入战斗 / 有人说话,并把战斗里的指令并成一张卡
  live.emit({ type: 'call', i, name, args: liveArgs(args), before: liveMode });
  return (res) => { if (res.mode) liveMode = res.mode; live.emit({ type: 'result', i, name, ms: Math.round(realNow() - t0), ...res }); };
}
let liveSeq = 0;
let liveMode = null;
/**
 * agent 自己记的游戏事件也上直播(观战页的时间线不只有操作):
 * 新出现的对白、换场景、练级(grind)里的每一场 —— 一个 grind 调用能跑几分钟,不转播的话时间线上只有一行在转。
 */
function liveGame(ev) {
  if (!live || !ev) return;
  if (ev.type === 'dialog' && ev.lines?.length) live.emit({ type: 'story', lines: ev.lines.slice(-40).map((l) => cleanText(l, 120)) });
  else if (ev.type === 'scene') live.emit({ type: 'scene', from: ev.from, to: ev.to, place: sceneName(ev.to), fromPlace: sceneName(ev.from) });
  else if (ev.type === 'grind-battle') live.emit({ type: 'progress', n: ev.n, foes: ev.foes ? String(ev.foes).slice(0, 60) : '', fled: !!ev.fled, hpBefore: ev.hpBefore, hpAfter: ev.hpAfter, lost: /battle over: lost/.test(ev.note || '') });
}
/** 工具结果末尾的直播提醒:有观众发言没读;AI 连续好几次操作没开口 */
const liveNudge = () => {
  if (!live) return '';
  const n = live.unreadCount();
  return (n ? `\n\n[live] ${n} new viewer message(s) — call chat to read them.` : '')
    + (live.takeSilence() ? '\n\n[live] 观众有一阵没听到你的想法了:用 chat 的 say 说一两句中文 —— 现在局面怎么看、接下来打算做什么。' : '')
    + (live.takeNoteReminder() ? '\n\n' + NOTE_REMINDER : '');
};

let guideCache;
const getGuide = () => (guideCache === undefined ? (guideCache = loadGuide()) : guideCache);

function timedEntry(scope,name,args,fn){
 return measureCall(fn,{virtualNow:()=>engineRef?.clock?.now()??null,
 decision:()=>decisionStop(agentRef,engineRef),record:timing=>record({type:'call_timing',scope,name,...timing})});
}

export async function callTool(name, args = {}) {
  return timedEntry("tool", name, args, () => callToolInner(name,args));
}
async function callToolInner(name, args = {}) {
  const done = liveCall(name, args);
  if (name === 'guide') {   // 不碰引擎,不用等启动
    record({ type: 'call', name, args });
    done({ ok: true, label: 'ok', note: '' });
    return { content: [{ type: 'text', text: guideText(getGuide(), args) + liveNudge() }], isError: false };
  }
  const a = await getAgent();
  if (name === 'atlas') {
    const r = a.atlasFor(args.place);
    record({ type: 'call', name, args, result: { ok: !r.error, note: r.error || r.entry.name } });
    done({ ok: !r.error, label: r.error ? 'failed' : 'ok', note: r.error || r.entry.name });
    if (r.error) return { content: [{ type: 'text', text: r.error }], isError: false };
    return { content: [{ type: 'image', data: r.image.data, mimeType: r.image.mimeType }, { type: 'text', text: `${r.entry.name} — fan-made annotated map (labels mark exits, houses, shops, items). It is drawn from the 98 version, so building colors may differ slightly from the game.` }] };
  }
  if (name === 'panorama') {
    const r = await renderPanorama(engineRef, a);
    record({ type: 'call', name, args, result: { ok: !r.error, note: r.error || `${r.width}x${r.height}` } });
    done({ ok: !r.error, label: r.error ? 'failed' : 'ok', note: r.error || '' });
    if (r.error) return { content: [{ type: 'text', text: r.error }], isError: false };
    return { content: [{ type: 'image', data: r.png, mimeType: 'image/png' }, { type: 'text', text: r.legend }] };
  }
  if (name === 'screenshot') {
    const s = engineRef.probes.surface;
    done({ ok: !!s, label: s ? 'ok' : 'failed', note: '' });
    if (!s || !s.byteBuffer || !s.palette) return { content: [{ type: 'text', text: 'no frame yet' }], isError: true };
    return { content: [{ type: 'image', data: framePng(s.byteBuffer, s.palette), mimeType: 'image/png' }, { type: 'text', text: `mode: ${a.mode()}` }] };
  }
  // 确定性模式下游戏时间只在工具调用期间推进(锁步);非确定性模式 drive 是恒等
  const i = ++callIndex;
  recorder?.caption({ type: 'call', i, name, args });
  const r = await measureCall(() => engineRef.drive(runTool(a, name, args)), {
    virtualNow: () => engineRef.clock?.now() ?? null,
    decision: () => decisionStop(a,engineRef),
    record: timing => record({type:'call_timing', i, name, ...timing})
  });
  if (r && r.unknown) { done({ ok: false, label: 'unknown tool', note: '' }); return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true }; }
  const obs = a.observe({ full: name === 'observe' && !!args.full });
  record({ type: 'call', name, args, result: r, ...(isSoftStop(name, r) ? { soft: true } : {}), mode: a.mode(), ...a.stats(), ...(engineRef.clock ? { vt: Math.round(engineRef.clock.now()) } : {}), rng: engineRef.services.random.getState().draws, frame: engineRef.worldService.getFrameCount?.() });
  recorder?.caption({ type: 'result', i, name, ok: r ? !!r.ok : null, note: r?.note || '', mode: a.mode() });
  if (AUTOSAVE_SLOT && autosaveAllowed() && realNow() - lastAutosave >= AUTOSAVE_EVERY_MS) autosave('periodic');
  // 走到半路遇敌 / 触发剧情不是工具出错(路线本就要经过怪,或剧情该发生了):别标 FAILED,免得模型以为出错
  const label = r ? resultLabel(name, r) : '';
  done({ ok: r ? !!r.ok : null, label, note: r?.note || '', mode: a.mode() });
  const text = (r ? `result: ${label} — ${r.note}\n\n` : '') + obs + liveNudge();
  return { content: [{ type: 'text', text }], isError: false };
}

const SESSION_TOOLS = [
  { name: 'session_quit', description: 'End the session: lets loaded modules run their before_quit hook, then exits agent-pal.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
];

/** 本会话的工具面:按层取 L0 / L0+L1,加会话内置方法、模块方法与 run_code 动态注册的工具。 */
export function listTools() {
  return [
    ...(LAYER === 'pure' ? PURE_TOOLS : TOOLS),
    ...SESSION_TOOLS,
    ...(live ? liveTools(live) : []),
    ...(modules ? modules.tools() : []),
    ...codeRunner.tools()
  ];
}

const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], isError });

/**
 * 工具调用总入口(MCP 与 HTTP 共用)。推进游戏的部分在串行队列里跑;
 * 产生的 SMSG 在释放队列之后才投给模块 —— 模块的 packet 处理函数里可能再发指令。
 * 模块方法与 run_code 本身不进外层串行队列:它们内部的每条 SendMessage 各自排队,否则会等自己。
 */
export async function dispatch(name, args = {}) {
  record({type:'replay_request',name,args});
  return timedEntry("dispatch", name, args, () => dispatchInner(name,args));
}
async function dispatchInner(name, args = {}) {
  if (name === 'session_quit') return textResult('bye');
  if (name === 'chat' && live) {                   // 直播聊天:不碰引擎,不进串行队列
    record({ type: 'call', name, args });
    return textResult(runChat(live, args));
  }
  if (name === 'run_code') {
    await getAgent();
    const r = await codeRunner.runCode(args);
    return textResult(JSON.stringify(r, null, 2), !r.ok);
  }
  if (name === 'module_reload') {
    await getAgent();
    const m = await ensureModules();
    const r = await m.reload(args);
    record({ type: 'module_reload', args, result: r });
    return textResult(JSON.stringify(r, null, 2));
  }
  if (codeRunner.hasTool(name)) {
    await getAgent();
    const r = await codeRunner.invokeTool(name, args);
    return textResult(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
  }
  const rpcName = rpcNameFromTool(name);
  if (rpcName && modules) {
    const modName = rpcName.split('.')[0];
    // 若 Agent 刚在已有模块根目录下写了新模块而没先调 module_reload,自动尝试发现并挂载一次
    if (!modules.has(modName) && modules.roots().length) {
      try { await modules.reload({ name: modName }); } catch { /* 交由下面的 invoke 报统一错误 */ }
    }
    if (modules.has(modName)) {
      record({ type: 'module_call', name: rpcName, args });
      await getAgent();
      const r = await modules.invoke(rpcName, args);
      record({ type: 'module_result', name: rpcName, result: r });
      return textResult(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
    }
  }
  if (LAYER === 'pure') {
    if (!PURE_TOOL_NAMES.has(name)) return textResult(`${name} is not available in --pure mode (only L0 primitives; see tools/list)`, true);
    const a = await getAgent();
    const { text, events } = await callPure(name, args, { l0: l0Ref, a, run: serialize });
    await codeRunner.deliver(events);
    if (modules && modules.count) await modules.deliver(events);
    return textResult(text);
  }
  let events = null;
  const result = await serialize(async () => {
    const r = await callTool(name, args);
    if ((modules && modules.count) || codeRunner) events = l0Ref.sync();          // L1 工具不经 L0:补一份增量给模块与脚本模型
    return r;
  });
  if (events) {
    await codeRunner.deliver(events);
    if (modules && modules.count) await modules.deliver(events);
  }
  return result;
}

/** session.quit:模块 before_quit → 结束子进程 → 退出。 */
export async function quitSession() {
  if (modules) await modules.quit();
  try { engineRef?.close(); } catch { /* */ }
  process.exit(0);
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handleMcpMsg(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      getAgent().catch((e) => process.stderr.write('[agent-pal] boot failed: ' + (e?.stack || e) + '\n'));   // 后台预热
      return isRequest ? { jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'agent-pal', version: '0.0.1' },
        instructions: LAYER === 'pure'
          ? 'You are playing the classic Chinese RPG 仙剑奇侠传 (Chinese Paladin, 1995) as 李逍遥, through the raw Agent-PAL protocol (--pure): only L0 primitives, each answered by SMSG_ACK / SMSG_REJECT plus protocol messages. There is no built-in pathfinding, map image or walkthrough — keep your own world model from the messages, write inline L0 scripts / reusable helpers with run_code, or hot-load L2 modules with module_reload. Start with observe.'
          : 'You are playing the classic Chinese RPG 仙剑奇侠传 (Chinese Paladin, 1995) as 李逍遥. Start with observe. Progress the story: read dialog for objectives, talk to NPCs (interact), walk through exits (touch triggers). Every action returns a fresh observation.'
            + (live && liveInstructions(live) ? '\n\n' + liveInstructions(live) : '')
      } } : null;
    }
    if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return null;
    if (method === 'ping') return isRequest ? { jsonrpc: '2.0', id, result: {} } : null;
    if (method === 'tools/list') return isRequest ? { jsonrpc: '2.0', id, result: { tools: listTools() } } : null;
    if (method === 'tools/call') {
      const result = await dispatch(params?.name, params?.arguments || {});
      if (params?.name === 'session_quit') setImmediate(() => quitSession());
      return isRequest ? { jsonrpc: '2.0', id, result } : null;
    }
    return isRequest ? { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } } : null;
  } catch (err) {
    return isRequest ? { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'error: ' + (err?.message || err) }], isError: true } } : null;
  }
}

async function handle(msg) {
  const resp = await handleMcpMsg(msg);
  if (resp) send(resp);
}

/**
 * HTTP JSON-RPC 面(同 agent-wow 的 localhost:8086/rpc 形状):POST /rpc 与 MCP Streamable HTTP POST /mcp
 *   {"jsonrpc":"2.0","id":1,"method":"pal.walk_to","params":{"x":60,"y":50}}
 * 方便脚本/非 MCP 客户端或外部 MCP 客户端(claude --mcp-config)长连同一个持久会话。只监听回环地址。
 */
export async function startHttp(port = 8086) {
  const http = await import('node:http');
  getAgent().catch((e) => process.stderr.write('[agent-pal] boot failed: ' + (e?.stack || e) + '\n'));
  const loopbackHost = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || (req.url !== '/rpc' && req.url !== '/mcp')) { res.writeHead(404); return res.end(); }
    // 只给本机脚本用。浏览器里的网页也能往回环地址 POST(text/plain 不触发预检),这里能驱动游戏、
    // 调模块代码、关会话 —— 所以:带 Origin 的(浏览器发的)一律拒;必须 application/json(逼出预检,
    // 我们不答 CORS);Host 必须是回环地址(防 DNS rebinding)。curl / 脚本不受影响。
    if (req.headers.origin) { res.writeHead(403); return res.end('cross-origin requests are not allowed'); }
    if (!loopbackHost.has(String(req.headers.host || ''))) { res.writeHead(403); return res.end('bad host'); }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { res.writeHead(415); return res.end('content-type must be application/json'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end('parse error'); }
      if (req.url === '/mcp') {
        const msgs = Array.isArray(msg) ? msg : [msg];
        const out = (await Promise.all(msgs.map((m) => handleMcpMsg(m)))).filter(Boolean);
        if (!out.length) { res.writeHead(202).end(); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(Array.isArray(msg) ? out : out[0]));
        return;
      }
      // pal.<tool> = 内置工具;session.quit;<module>.<method> = 模块方法(MCP 里叫 <module>__<method>)
      const method = String(msg.method || '');
      const name = method === 'session.quit' ? 'session_quit' : method.startsWith('pal.') ? method.slice(4) : method.includes('.') ? method.replace('.', '__') : method;
      const result = await dispatch(name, msg.params || {}).catch((e) => ({ content: [{ type: 'text', text: 'error: ' + (e?.message || e) }], isError: true }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, result }));
      if (name === 'session_quit') quitSession();
    });
  });
  server.listen(port, '127.0.0.1', () => process.stderr.write(`[agent-pal] HTTP JSON-RPC on http://127.0.0.1:${port}/rpc (/mcp); run log → ${runFile}\n`));
}

export function startMcp() {
  mcpActive = true;
  process.stderr.write(`[agent-pal] MCP stdio ready; run log → ${runFile}\n`);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    handle(msg);
  });
  rl.on('close', () => exitWithAutosave('stdin closed'));
}
