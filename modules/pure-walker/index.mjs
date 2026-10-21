/**
 * pure-walker — 只靠 L0 走出当前场景(M0b 验收:§7「--pure 下一个手写模块只靠 L0 走到第一次场景切换」)。
 *
 * 世界模型全部来自订阅的 SMSG(会话不给快照后门):SCENE_ENTER 重建、PLAYER/OBJECT_UPDATE 增量、MODE 决策点。
 * 寻路:未知格当可走,向「最近的触碰触发器的作用范围」做 BFS;每步一条 CMSG_MOVE,
 * 被 REJECT blocked(或 ACK 了但没动)就把那格记成墙,重新规划。墙按场景记。
 * 触碰范围:Chebyshev 距离 ≤ triggerMode - 4(引擎判定 |dx|+2|dy| < (mode-4)*32+16 像素,换到旋转网格)。
 */
import { startModule } from '../../src/module-sdk.mjs';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const key = (x, y) => `${x},${y}`;

const model = { scene: null, player: null, objects: new Map(), mode: null, walls: new Map(), arrival: null };
const wallsHere = () => {
  if (!model.walls.has(model.scene)) model.walls.set(model.scene, new Set());
  return model.walls.get(model.scene);
};

function triggers() {
  return [...model.objects.values()].filter((o) => o.kind === 'touch-trigger');
}

const radius = (t) => Math.max(0, t.triggerMode - 4);
const within = (t, p, extra = 0) => Math.max(Math.abs(t.gx - p.gx), Math.abs(t.gy - p.gy)) <= radius(t) + extra;

/**
 * 目标格集合:触碰触发器作用范围内的格。站在某个范围里而它没触发(触碰是「踏入」才触发),
 * 那个触发器不算目标;进场时落脚处附近的(多半就是来时的门)只在别无去处时才用。
 */
function goalCells(includeArrival) {
  const goals = new Set();
  for (const t of triggers()) {
    if (model.player && within(t, model.player)) continue;
    if (!includeArrival && model.arrival && within(t, model.arrival, 2)) continue;
    const r = radius(t);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) goals.add(key(t.gx + dx, t.gy + dy));
  }
  return goals;
}

/** 在已知信息上 BFS(未知 = 可走),返回第一步的方向;没路返回 null。 */
function planStep({ ignoreSolidObjects = false, includeArrival = false } = {}) {
  const p = model.player;
  const goals = goalCells(includeArrival);
  if (!p || !goals.size) return null;
  const walls = wallsHere();
  const solid = new Set(ignoreSolidObjects ? [] : [...model.objects.values()].filter((o) => o.blocking && o.kind !== 'touch-trigger').map((o) => key(o.gx, o.gy)));
  const xs = [p.gx, ...triggers().map((t) => t.gx)], ys = [p.gy, ...triggers().map((t) => t.gy)];
  const pad = 16;
  const box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad };
  const start = key(p.gx, p.gy);
  if (goals.has(start)) return null;
  const first = new Map([[start, null]]);
  const q = [[p.gx, p.gy]];
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (first.has(k) || walls.has(k) || solid.has(k)) continue;
      if (nx < box.x0 || nx > box.x1 || ny < box.y0 || ny > box.y1) continue;
      first.set(k, first.get(key(x, y)) ?? dir);
      if (goals.has(k)) return first.get(k);
      q.push([nx, ny]);
    }
  }
  return null;
}

const session = await startModule({
  onSceneEnter(m) {
    model.scene = m.scene;
    model.player = m.player;
    model.objects = new Map(m.objects.map((o) => [o.id, o]));
    model.arrival = m.player;
  },
  onPlayerUpdate(m) { model.player = { gx: m.gx, gy: m.gy, facing: m.facing }; },
  onObjectUpdate(m) {
    if (m.removed) model.objects.delete(m.id);
    else model.objects.set(m.id, { ...model.objects.get(m.id), ...m });
  },
  onMode(m) { model.mode = m.mode; },

  async leaveScene({ maxMoves = 800 } = {}) {
    let seq = 0;
    const send = (cmsg) => session.send({ ...cmsg, seq: ++seq });
    let start = model.scene;
    let moves = 0, bumps = 0, other = 0;
    while (moves + other < maxMoves) {
      if (model.scene != null && start == null) start = model.scene;     // 从标题画面调用:等进了第一个场景再算
      if (start != null && model.scene !== start) {
        return { ok: true, from: start, to: model.scene, at: model.player, moves, bumps, wallsLearned: model.walls.get(start)?.size ?? 0 };
      }
      switch (model.mode) {
        case 'crashed': return { ok: false, note: 'engine crashed', moves };
        case 'dialog': other++; await send({ op: 'CMSG_DIALOG_ADVANCE' }); continue;
        case 'busy': other++; await send({ op: 'CMSG_WAIT', ms: 500 }); continue;
        case 'battle': other++; await send({ op: 'CMSG_BATTLE_ACTION', type: 'auto' }); continue;
        case 'menu': other++; await send({ op: 'CMSG_KEY', key: 'Menu' }); continue;
        default: break;
      }
      // 先找别的出口;不行再忽略实心物体(NPC 会走开);最后才走回来时的门
      const dir = planStep() || planStep({ ignoreSolidObjects: true }) || planStep({ includeArrival: true }) || planStep({ includeArrival: true, ignoreSolidObjects: true });
      if (!dir) return { ok: false, note: 'no path to any touch trigger with what is known', moves, bumps, player: model.player };
      const before = model.player;
      const { reply } = await send({ op: 'CMSG_MOVE', dir });
      moves++;
      const [dx, dy] = DIRS[dir];
      const target = key(before.gx + dx, before.gy + dy);
      if (reply.op === 'SMSG_REJECT' && reply.reason === 'blocked') { wallsHere().add(target); bumps++; continue; }
      if (reply.op === 'SMSG_ACK' && model.scene === start && model.player.gx === before.gx && model.player.gy === before.gy) { wallsHere().add(target); bumps++; }
    }
    return { ok: false, note: `gave up after ${maxMoves} commands`, moves, bumps, player: model.player };
  },

  describeModel() {
    return { scene: model.scene, mode: model.mode, player: model.player, triggers: triggers(), wallsLearned: [...wallsHere()].length };
  },

  beforeQuit() { process.stderr.write(`pure-walker: bye (scene ${model.scene})\n`); }
});
