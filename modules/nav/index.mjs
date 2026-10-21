/**
 * nav — 官方 L1 参考模块(spec §5.4):walk_to / interact / use_item / view,只靠 L0 消息 + data dump。
 *
 * 世界模型全部来自订阅的 SMSG;静态地形来自 data dump(AGENT_PAL_DATA_DIR:scenes.json + maps/<n>.json)。
 * 规划在 planner.mjs(与 agent.mjs 的 MVP 寻路同一套规则,可单测);这里只管世界模型与执行。
 *
 * 与 MVP 的差别(L0 的边界,不是 bug):
 *  - 转身要花一条 MOVE(朝实心目标走一步被挡住 / 对调查点退一格再走回来),MVP 是直接写朝向。
 *    所以对会走动的 NPC,时机会和 MVP 差一点。
 *  - 做不了的(要等脚本反汇编进 data dump):荷叶摆渡、怪物的追人范围、出口去向、「用了物品后某 NPC 的反应变了」提示。
 *    (L0 把怪当普通 npc 发,所以这里怪只是实心物体:堵路时走 ignoreObjects 那条退路穿过去,不会像 MVP 那样被触碰范围封死。)
 */
import fs from 'node:fs';
import path from 'node:path';
import { startModule } from '../../src/module-sdk.mjs';
import { createPlanner, DIRS, key } from './planner.mjs';

const MAX_RUN = 4;                         // CMSG_MOVE.steps 上限

// ---- data dump ---------------------------------------------------------------------
const dataDir = process.env.AGENT_PAL_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, 'manifest.json'))) {
  process.stderr.write(`nav: no data dump at ${dataDir || '(AGENT_PAL_DATA_DIR unset)'}\n`);
  process.exit(1);
}
const sceneMap = new Map(JSON.parse(fs.readFileSync(path.join(dataDir, 'scenes.json'), 'utf8')).map((s) => [s.id, s.mapNum]));
const gridCache = new Map();
function rowsFor(scene) {
  const mapNum = sceneMap.get(scene);
  if (mapNum == null) return null;
  if (!gridCache.has(mapNum)) {
    const f = path.join(dataDir, 'maps', `${mapNum}.json`);
    gridCache.set(mapNum, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).rows : null);
  }
  return gridCache.get(mapNum);
}

// ---- 世界模型(只来自 SMSG) ------------------------------------------------------------
const model = { scene: null, player: null, objects: new Map(), mode: null };
const cell = (x, y) => rowsFor(model.scene)?.[y]?.[x] ?? ' ';
const planner = createPlanner({ cell, objects: () => [...model.objects.values()], player: () => model.player });

// ---- 执行 --------------------------------------------------------------------------
let session;
let seq = 0;
const send = (m) => session.send({ ...m, seq: ++seq });
const here = () => ({ ...model.player });
const at = (c) => model.player.gx === c.gx && model.player.gy === c.gy;

/**
 * 执行一串方向(同向连续的并成一条 CMSG_MOVE,至多 4 步)。
 * 返回 { status: 'done' | 'blocked' | 'scene' | 'jump' | 'interrupted', steps, blockedAt }。
 */
async function walk(dirs) {
  const scene0 = model.scene;
  let steps = 0;
  for (let i = 0; i < dirs.length;) {
    let n = 1;
    while (n < MAX_RUN && i + n < dirs.length && dirs[i + n] === dirs[i]) n++;
    const from = here();
    const { reply } = await send({ op: 'CMSG_MOVE', dir: dirs[i], ...(n > 1 ? { steps: n } : {}) });
    const moved = Math.abs(model.player.gx - from.gx) + Math.abs(model.player.gy - from.gy);
    if (model.scene !== scene0) return { status: 'scene', steps: steps + n };
    if (moved > n) return { status: 'jump', steps: steps + n };
    if (model.mode !== 'control') return { status: 'interrupted', steps: steps + moved };
    if (reply.op === 'SMSG_REJECT' || moved < n) {
      const [dx, dy] = DIRS[dirs[i]];
      return { status: 'blocked', steps: steps + moved, blockedAt: key(model.player.gx + dx, model.player.gy + dy) };
    }
    steps += n;
    i += n;
  }
  return { status: 'done', steps };
}

const notControl = (verb) => ({ ok: false, note: `cannot ${verb}: mode is ${model.mode} (need control)` });
const newArea = (steps) => ({ ok: true, note: `entered a new area after ${steps} steps (scene ${model.scene}, now at (${model.player.gx},${model.player.gy})) — re-observe before moving on` });

async function walkTo({ x: gx, y: gy }) {
  if (model.mode !== 'control') return notControl('walk');
  const extraBlocked = new Set();
  let steps = 0;
  for (let replans = 0; replans < 4; replans++) {
    if (at({ gx, gy })) {
      if (steps > 0 && planner.inTriggerZone(gx, gy)) {
        const scene0 = model.scene;
        await send({ op: 'CMSG_WAIT', ms: 400 });                       // #29:门口的触发晚一两帧
        if (model.scene !== scene0 || !at({ gx, gy })) return newArea(steps);
        if (model.mode !== 'control') return { ok: false, note: `arrived at (${gx},${gy}) in ${steps} steps, then something triggered; mode now ${model.mode}` };
      }
      return { ok: true, note: `arrived at (${gx},${gy}) in ${steps} steps` };
    }
    const p = here();
    const { dirs, target } = planner.planWalk(gx, gy, { extraBlocked });
    if (!dirs) return { ok: false, note: `no path from (${p.gx},${p.gy}) to (${gx},${gy}) or any walkable cell near it (with what the data dump and the visible objects show)` };
    if (!dirs.length) {
      // 已经贴着目标(如紧挨铜门出口):门格本身是墙,但往它那边迈一步就会触发 —— 走一步看看
      const dir = Object.keys(DIRS).find((d) => p.gx + DIRS[d][0] === gx && p.gy + DIRS[d][1] === gy);
      if (!dir) return { ok: false, note: `(${gx},${gy}) is not walkable; already at nearest cell (${p.gx},${p.gy})` };
      const r = await walk([dir]);
      steps += r.steps;
      if (r.status === 'scene' || r.status === 'jump') return newArea(steps);
      if (r.status === 'interrupted') return { ok: false, note: `stepped ${dir} toward (${gx},${gy}), then something triggered; mode now ${model.mode}` };
      if (r.status === 'done') continue;
      if (planner.inTriggerZone(gx, gy)) {
        const scene0 = model.scene;
        await send({ op: 'CMSG_WAIT', ms: 400 });                       // 门口的触发晚一两帧
        if (model.scene !== scene0 || !at(p)) return newArea(steps);
      }
      return { ok: false, note: `(${gx},${gy}) is not walkable; already at nearest cell (${p.gx},${p.gy}) and stepping ${dir} into it did nothing` };
    }
    const r = await walk(dirs);
    steps += r.steps;
    if (r.status === 'scene' || r.status === 'jump') return newArea(steps);
    if (r.status === 'interrupted') return { ok: false, note: `interrupted after ${steps} steps (something triggered; mode now ${model.mode})` };
    if (r.status === 'blocked') { if (r.blockedAt) extraBlocked.add(r.blockedAt); continue; }
    if (target.gx !== gx || target.gy !== gy) return { ok: true, note: `(${gx},${gy}) itself is not walkable; stopped at nearest cell (${model.player.gx},${model.player.gy}) after ${steps} steps` };
  }
  return { ok: at({ gx, gy }), note: `stopped at (${model.player.gx},${model.player.gy}) after ${steps} steps (blocked repeatedly)` };
}

/**
 * 走到物体旁并面朝它。同 MVP 的选边顺序:按站位离主角的距离逐个 walk_to 过去再转身
 * (会走动的 NPC 对时机敏感,选边不同后面的剧情时机就对不上)。都不行再用 (格, 朝向) 上的 BFS 兜底。
 */
async function approach(id) {
  if (model.mode !== 'control') return notControl('approach');
  const o = model.objects.get(id);
  if (!o) return { ok: false, note: `object ${id} not found in this scene` };
  for (const c of planner.approachSides(o)) {
    if (!at(c)) {
      const r = await walkTo({ x: c.gx, y: c.gy });
      if (model.mode !== 'control') return { ok: false, note: r.note };
      if (!at(c)) continue;
    }
    const moves = planner.turnMoves(c, o);
    if (!moves) continue;
    for (const dir of moves) await send({ op: 'CMSG_MOVE', dir });     // 朝实心目标这一步会被挡住:要的就是转身
    if (model.mode !== 'control') return { ok: false, note: `interrupted while turning (mode now ${model.mode})` };
    if (at(c) && model.player.facing === c.dir) return { ok: true, dir: c.dir, note: `facing ${c.dir} toward object ${id}` };
  }
  return approachBySearch(id, o);
}

async function approachBySearch(id, o) {
  const extraBlocked = new Set();
  const sides = planner.allSides(o);                                     // 含隔着一两格、「搜索」仍够得着的站位
  for (let attempt = 0; attempt < 4; attempt++) {
    const plan = planner.planFacing(sides, o, { extraBlocked }) ?? planner.planFacing(sides, o, { ignoreObjects: true, extraBlocked });
    if (!plan) return { ok: false, note: `no reachable side of object ${id}` };
    let blockedAt = null;
    for (const a of plan.actions) {
      const from = here();
      const { reply } = await send({ op: 'CMSG_MOVE', dir: a.dir });
      if (model.mode !== 'control') return { ok: false, note: `interrupted on the way (mode now ${model.mode})` };
      const moved = !at(from);
      if (a.turn ? moved : (reply.op === 'SMSG_REJECT' || !moved)) { const [dx, dy] = DIRS[a.dir]; blockedAt = key(from.gx + dx, from.gy + dy); break; }
    }
    if (!blockedAt && at(plan.side) && model.player.facing === plan.side.dir) return { ok: true, dir: plan.side.dir, note: `facing ${plan.side.dir} toward object ${id}` };
    if (blockedAt) extraBlocked.add(blockedAt);
  }
  return { ok: false, note: `could not get in front of object ${id} (blocked repeatedly)` };
}

async function interact({ id }) {
  const r = await approach(id);
  if (!r.ok) return r;
  await send({ op: 'CMSG_INTERACT' });
  return { ok: true, note: `faced ${r.dir} toward object ${id} and searched; mode now ${model.mode}` };
}

async function useItem({ item, target = 0, facing = null }) {
  if (model.mode !== 'control') return notControl('use an item');
  if (facing != null) {
    const r = await approach(facing);
    if (!r.ok) return { ok: false, note: `could not get in front of object ${facing}: ${r.note}` };
  }
  const { reply } = await send({ op: 'CMSG_MENU_USE_ITEM', item, target });
  return { ok: reply.op === 'SMSG_ACK', note: reply.note || reply.reason };
}

/** observe 的地图部分(同 MVP 的 ASCII 局部图):@ 自己、# 墙、. 可走、空白 = 地图外,字母 = 物体。 */
function view() {
  const p = model.player;
  if (!p || !rowsFor(model.scene)) return 'no map (title screen or unknown scene)';
  const RX = 18, RY = 11, LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const objs = [...model.objects.values()].filter((o) => Math.abs(o.gx - p.gx) <= RX && Math.abs(o.gy - p.gy) <= RY)
    .sort((a, b) => (Math.abs(a.gx - p.gx) + Math.abs(a.gy - p.gy)) - (Math.abs(b.gx - p.gx) + Math.abs(b.gy - p.gy)));
  const marks = new Map();
  const legend = objs.map((o, i) => { const ch = LET[i] || '*'; if (!marks.has(key(o.gx, o.gy))) marks.set(key(o.gx, o.gy), ch); return `  ${ch} id=${o.id} ${o.kind} at (${o.gx},${o.gy})${o.blocking ? ' solid' : ''}`; });
  const rows = [];
  for (let y = p.gy - RY; y <= p.gy + RY; y++) {
    let row = '';
    for (let x = p.gx - RX; x <= p.gx + RX; x++) row += x === p.gx && y === p.gy ? '@' : marks.get(key(x, y)) ?? cell(x, y);
    rows.push('  |' + row.replace(/\s+$/, ''));
  }
  return [`scene ${model.scene}  you at (${p.gx},${p.gy}) facing ${p.facing}; top-left = (${p.gx - RX},${p.gy - RY})`, ...rows, ...(legend.length ? ['objects:', ...legend] : [])].join('\n');
}

session = await startModule({
  onSceneEnter(m) { model.scene = m.scene; model.player = m.player; model.objects = new Map(m.objects.map((o) => [o.id, o])); },
  onPlayerUpdate(m) { model.player = { gx: m.gx, gy: m.gy, facing: m.facing }; },
  onObjectUpdate(m) { if (m.removed) model.objects.delete(m.id); else model.objects.set(m.id, { ...model.objects.get(m.id), ...m }); },
  onMode(m) { model.mode = m.mode; },
  walkTo, interact, useItem, view
});
