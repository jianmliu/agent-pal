/**
 * planner — nav 模块的纯规划逻辑(不碰 socket / 文件,单元测试直接用 test/nav.test.mjs)。
 *
 * world = { cell(x, y) → '.' | '#' | ' ', objects() → [{ id, gx, gy, kind, triggerMode, blocking }], player() → { gx, gy, facing } }
 * 规则与 agent.mjs 里 MVP 版寻路一致:
 *  - 地图 '#' 不可走;虚空(空格)不可走,但触碰触发器范围 +2 内的虚空可走(门常压在地图边缘的虚空上)。
 *  - 实心物体(blocking)当墙;调用方可 ignoreObjects 退一步(会走动的 NPC)—— 没精灵的隐形墙(kind scenery)不会走动,照样当墙。
 *  - 绕开「非目标」触碰触发器的作用范围(Chebyshev ≤ triggerMode - 4);目标所在的、主角已经站在里面的范围不算。
 */
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const DIR_NAMES = Object.keys(DIRS);
export const key = (x, y) => `${x},${y}`;
export const radius = (o) => Math.max(0, o.triggerMode - 4);
export const cheb = (o, x, y) => Math.max(Math.abs(o.gx - x), Math.abs(o.gy - y));
const GRID = 192;

export function createPlanner(world) {
  const touchTriggers = () => world.objects().filter((o) => o.kind === 'touch-trigger' || (!o.blocking && o.triggerMode >= 4));
  const solidCells = (skipTriggers, onlyStatic = false) => new Set(world.objects()
    .filter((o) => o.blocking && !(skipTriggers && o.kind === 'touch-trigger') && (!onlyStatic || o.kind === 'scenery' || o.triggerMode === 0))
    .map((o) => key(o.gx, o.gy)));

  /** 本次寻路的通行规则。goal = 目标格(允许被物体占着、允许在它所在的触发范围里)。 */
  function rules(goal, { ignoreObjects = false, extraBlocked = new Set() } = {}) {
    const triggers = touchTriggers();
    const p = world.player();
    const zones = triggers.filter((t) => (!goal || cheb(t, goal.gx, goal.gy) > radius(t)) && !(p && cheb(t, p.gx, p.gy) <= radius(t)));
    const doors = triggers.map((t) => ({ t, r: radius(t) + 2 }));
    const solid = solidCells(true, ignoreObjects);
    const allSolid = solidCells(false);
    const walls = solidCells(true, true);
    const terrainOk = (x, y) => {
      const c = world.cell(x, y);
      if (c === '#') return false;
      if (c === ' ') return doors.some((d) => cheb(d.t, x, y) <= d.r);
      return true;
    };
    return {
      terrainOk,
      /** 能走进去(不会被挡、不会半路触发别的东西)。 */
      enter(x, y) {
        const k = key(x, y);
        if (extraBlocked.has(k)) return false;
        if (goal && x === goal.gx && y === goal.gy) return terrainOk(x, y) && !walls.has(k);
        return terrainOk(x, y) && !solid.has(k) && !zones.some((z) => cheb(z, x, y) <= radius(z));
      },
      /** 朝它走会被挡住(于是原地转身):墙或实心物体。 */
      turnsAgainst(x, y) { return world.cell(x, y) === '#' || allSolid.has(key(x, y)) || extraBlocked.has(key(x, y)); }
    };
  }

  /** BFS(等代价):从主角到 goals 中任一格的方向序列;不可达返回 null,已在目标上返回 []。 */
  function planTo(goals, goal, opts) {
    const p = world.player();
    if (!p) return null;
    const r = rules(goal, opts);
    const start = key(p.gx, p.gy);
    if (goals.has(start)) return [];
    const prev = new Map([[start, null]]);
    const q = [[p.gx, p.gy]];
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (const d of DIR_NAMES) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], k = key(nx, ny);
        if (prev.has(k) || nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || !r.enter(nx, ny)) continue;
        prev.set(k, [key(x, y), d]);
        if (goals.has(k)) {
          const dirs = [];
          for (let c = k; prev.get(c); c = prev.get(c)[0]) dirs.unshift(prev.get(c)[1]);
          return dirs;
        }
        q.push([nx, ny]);
      }
    }
    return null;
  }

  /**
   * walk_to 的规划:先直接去目标(先当实心物体是墙,不行再忽略它们);目标站不上去就找半径 3 内最近的
   * 可站格(候选只看地形与实心物体 —— 门口那几格本来就在门的范围里,要的就是踩上去),再以候选为目标逐个规划。
   * 返回 { dirs, target } 或 { dirs: null }。
   */
  function planWalk(gx, gy, { extraBlocked = new Set() } = {}) {
    const goal = { gx, gy };
    const goals = new Set([key(gx, gy)]);
    const direct = planTo(goals, goal, { extraBlocked }) ?? planTo(goals, goal, { ignoreObjects: true, extraBlocked });
    if (direct) return { dirs: direct, target: goal };
    const allSolid = solidCells(false);
    const standable = (x, y) => world.cell(x, y) !== '#' && !allSolid.has(key(x, y)) && !extraBlocked.has(key(x, y));
    const near = [];
    for (let d = 1; d <= 3 && !near.length; d++) {
      for (let dx = -d; dx <= d; dx++) for (let dy = -d; dy <= d; dy++) if (Math.abs(dx) + Math.abs(dy) === d && standable(gx + dx, gy + dy)) near.push({ gx: gx + dx, gy: gy + dy });
    }
    for (const c of near) {
      const dirs = planTo(new Set([key(c.gx, c.gy)]), c, { extraBlocked }) ?? planTo(new Set([key(c.gx, c.gy)]), c, { ignoreObjects: true, extraBlocked });
      if (dirs) return { dirs, target: c };
    }
    return { dirs: null, target: null };
  }

  /** 「搜索」够得着的直线距离:引擎沿朝向查 6·mode−4 个点 → mode 1 / 2 / 3 是 1 / 3 / 4 格。 */
  const reach = (o) => (o.triggerMode >= 3 ? 4 : o.triggerMode === 2 ? 3 : 1);
  /** 站在离物体 k 格、面朝它的四个站位。 */
  const sidesAt = (o, k) => DIR_NAMES.map((dir) => ({ dir, k, gx: o.gx - k * DIRS[dir][0], gy: o.gy - k * DIRS[dir][1] }));
  /** 所有够得着的站位(先紧挨着的,再隔一两格的),不筛可站。 */
  function allSides(o) {
    const out = [];
    for (let k = 1; k <= reach(o); k++) out.push(...sidesAt(o, k));
    return out;
  }

  /**
   * interact 的选边顺序(同 MVP):四个站位按离主角的曼哈顿距离排,站位须可站或就是主角脚下。
   * 紧挨着的都站不上(如书中仙身前是隐形墙)时,再排隔着一两格、「搜索」仍够得着的站位。
   */
  function approachSides(o) {
    const p = world.player();
    const allSolid = solidCells(false);
    const ok = (c) => (c.gx === p.gx && c.gy === p.gy) || (world.cell(c.gx, c.gy) !== '#' && !allSolid.has(key(c.gx, c.gy)));
    const byDist = (a, b) => (Math.abs(a.gx - p.gx) + Math.abs(a.gy - p.gy)) - (Math.abs(b.gx - p.gx) + Math.abs(b.gy - p.gy));
    const out = [];
    for (let k = 1; k <= reach(o); k++) out.push(...sidesAt(o, k).filter(ok).sort(byDist));
    return out;
  }

  /**
   * 在站位 c 上转向 c.dir(朝着 o)要发的 MOVE 序列。L0 没有转身原语:
   *  - 面前那格(紧挨着时就是目标)是墙 / 实心物体:朝它走一步(被挡住、人转过去);
   *  - 否则(调查点、隔着一格的空地):退到身后一格再朝它走回来;身后走不了返回 null。
   */
  function turnMoves(c, o) {
    const p = world.player();
    if (p.facing === c.dir) return [];
    const fx = c.gx + DIRS[c.dir][0], fy = c.gy + DIRS[c.dir][1];
    const front = fx === o.gx && fy === o.gy ? o : null;
    if (world.cell(fx, fy) === '#' || (front ? o.blocking : solidCells(false).has(key(fx, fy)))) return [c.dir];
    const back = DIR_NAMES.find((d) => DIRS[d][0] === -DIRS[c.dir][0] && DIRS[d][1] === -DIRS[c.dir][1]);
    const bx = c.gx + DIRS[back][0], by = c.gy + DIRS[back][1];
    return rules({ gx: bx, gy: by }).enter(bx, by) ? [back, c.dir] : null;
  }

  /**
   * 兜底:在 (格, 朝向) 上 BFS,一次规划出「站在某个站位、面朝目标」。动作 = { dir, turn },
   * turn = 朝墙 / 实心物体走,被挡住、人转过去。返回 { actions, side } 或 null。
   */
  function planFacing(sides, goalCell, opts) {
    const p = world.player();
    if (!p) return null;
    const r = rules(goalCell, opts);
    const di = (d) => DIR_NAMES.indexOf(d);
    const sk = (x, y, f) => `${x},${y},${f}`;
    const want = new Map(sides.map((s) => [sk(s.gx, s.gy, di(s.dir)), s]));
    const f0 = di(p.facing ?? 'down');
    const start = sk(p.gx, p.gy, f0);
    if (want.has(start)) return { actions: [], side: want.get(start) };
    const prev = new Map([[start, null]]);
    const q = [[p.gx, p.gy, f0]];
    for (let h = 0; h < q.length; h++) {
      const [x, y, f] = q[h];
      for (const d of DIR_NAMES) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        let next = null, turn = false;
        if (r.enter(nx, ny) && !(goalCell && nx === goalCell.gx && ny === goalCell.gy)) next = [nx, ny, di(d)];   // 不踩到目标本身
        else if (r.turnsAgainst(nx, ny)) { next = [x, y, di(d)]; turn = true; }
        if (!next) continue;
        const k = sk(...next);
        if (prev.has(k)) continue;
        prev.set(k, [sk(x, y, f), { dir: d, turn }]);
        if (want.has(k)) {
          const actions = [];
          for (let c = k; prev.get(c); c = prev.get(c)[0]) actions.unshift(prev.get(c)[1]);
          return { actions, side: want.get(k) };
        }
        q.push(next);
      }
    }
    return null;
  }

  const inTriggerZone = (x, y) => touchTriggers().some((t) => cheb(t, x, y) <= radius(t));

  return { rules, planTo, planWalk, approachSides, allSides, turnMoves, planFacing, inTriggerZone };
}
