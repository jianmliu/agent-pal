/**
 * 跨场景路线规划:walk_to 在本场景找不到路时,看看能不能「绕」过去 ——
 * 走别的出口 / 楼梯到相邻场景再从另一处回来(乱葬岗地面 ↔ 地下墓穴),或者先踩开关把门打开(full 提示档)。
 *
 * 不用真走:地图块挡路直接读地图文件(任何场景的地图都能按地图号加载),物体状态是全局的。
 * 算法:在当前场景 + 顺着出口连出去的几个场景上做格子广度搜索;到不了就踩一个已经够得着的开关
 * (开关把目标物体设成可通过 / 消失),再搜,直到到达或没有新开关可踩。最后删掉用不着的开关,
 * 按顺序写出每一段:去哪个出口、到哪里、踩哪个开关、最后 walk_to 哪一格。
 */
import { toGrid, fromGrid } from './agent.mjs';

const MAX_SCENES = 8;          // 最多看这么多个场景(当前场景 + 顺着出口连出去的)
const MAX_DEPTH = 3;           // 出口跳数
const GX = [0, 192], GY = [-64, 192];   // 2048×2048 像素地图对应的格子范围(见 fromGrid)

export function createRoutePlanner({ worldService, sceneService, scanScript, isSwitch, switchesEnabled, sceneName = () => null }) {
  const mapCache = new Map();
  function mapOf(scene) {
    if (scene === worldService.getSceneId()) { try { return sceneService.getMap(); } catch { return null; } }
    const mapNum = worldService.getSceneEntry(scene)?.mapNum;
    if (mapNum == null) return null;
    if (mapCache.has(mapNum)) return mapCache.get(mapNum);
    let inst = null;
    try {
      const MapClass = sceneService.getMap().constructor, Files = globalThis.Files;
      inst = MapClass.fromFile(mapNum, Files.MAP, Files.GOP);
    } catch { /* */ }
    mapCache.set(mapNum, inst);
    return inst;
  }
  // 与 scene-service 的 legacyCheckObstacle 同一套像素 → 图块换算,并带走路时的范围判定(checkRange):
  // 视口滚不出地图,地图左 / 上边一圈(约 5 / 7 个图块,按主角在屏幕上的偏移算)主角走不进去
  function edgeBlock() {
    let off = null;
    try { off = worldService.getPartyOffset?.(); } catch { /* */ }
    const ox = off != null ? off & 0xffff : 160, oy = off != null ? (off >>> 16) & 0xffff : 112;
    return { bx: ~~(ox / 32), by: ~~(oy / 16) };
  }
  function tileBlocked(map, X, Y) {
    if (X < 0 || Y < 0 || X >= 2048 || Y >= 2048) return true;
    let x = ~~(X / 32), y = ~~(Y / 16), h = 0;
    const { bx, by } = edgeBlock();
    if (x < bx || y < by) return true;   // SDLPAL 只挡左 / 上:右 / 下的比较拿图块号去比 2048,永远不成立
    const xr = X % 32, yr = Y % 16;
    if (xr + yr * 2 >= 16) {
      if (xr + yr * 2 >= 48) { x++; y++; } else if (32 - xr + yr * 2 < 16) x++; else if (32 - xr + yr * 2 < 48) h = 1; else y++;
    }
    try { return !!map.isTileBlocked(x, y, h); } catch { return true; }
  }
  function isVoid(map, X, Y) {
    if (X < 0 || Y < 0) return true;
    const h = (X % 32) ? 1 : 0, tx = Math.floor(X / 32), ty = Math.floor((Y - 8 * h) / 16);
    if (tx < 0 || ty < 0 || tx >= 64 || ty >= 128) return true;
    if (typeof map.getTileBitmap !== 'function') return typeof map.getTile === 'function' ? !map.getTile(ty, tx, h) : false;
    return !map.getTileBitmap(tx, ty, h, 0) && !map.getTileBitmap(tx, ty, h, 1);
  }

  /**
   * 一个场景的静态信息:物体分类(出口 / 开关 / 挡路物),按当前物体状态 + 假设已踩的开关。
   * 「出口」= 踩进触碰范围就把主角挪走的物体:换场景 / 同场景传送(0x0046)/ 摆渡(0x0044 载人)/ 强制走位(0x007A)/
   * 楼梯(只有 0x006E 平移:落点 = 踩进去那格 + 位移,随入口而变)。同场景里挪位置还放对白 / 改别的物体 = 剧情触发
   * (把你拽回去),不当路。
   * 触碰范围按引擎判定 |dx|+2|dy| < (mode-4)*32+16,在旋转网格上恰好是 Chebyshev 距离 ≤ mode-4
   * (含斜角那几格:只能斜着踩进去的传送区就是这样);落点是脚本这一趟最后一个放置 / 走位点。
   */
  function sceneInfo(scene, overlay) {
    const store = globalThis.GameData?.eventObject;
    let rg = null;
    try { rg = worldService.getSceneEventObjectRange(scene); } catch { /* */ }
    const exits = [], switches = [], solid = new Set();
    if (!store || !rg) return { exits, switches, solid };
    for (let idx = rg.start; idx < rg.end && idx < store.length; idx++) {
      const s = store[idx]; if (!s) continue;
      const id = idx + 1, state = overlay.has(id) ? overlay.get(id) : (s.state << 16 >> 16);
      if (state <= 0 || s.vanishTime) continue;
      const g = toGrid(s.x, s.y), touch = s.triggerMode >= 4;
      const trig = s.triggerScript ? scanScript(s.triggerScript) : null;
      const enemy = !!(s.spriteNum && trig?.teams?.length);
      const sameStory = trig && trig.scene == null && (trig.talks || trig.sets.some((x) => x.id !== id));
      const stairs = trig?.shift && (trig.shift.dx || trig.shift.dy) && trig.scene == null && !trig.pos ? trig.shift : null;
      const moves = !!(trig && (trig.scene != null || trig.pos || trig.trail?.length || stairs));
      const sw = switchesEnabled && trig && isSwitch(s, id, trig);
      if (touch && moves && !trig.teams.length && !sw && !sameStory) {
        const to = trig.scene != null && trig.scene !== scene ? trig.scene : scene;
        // 设了位置又平移(神殿的门 = 0x0046 + 调楼梯位移)→ 落点 = 位置 + 位移;否则取走位末点
        const land = trig.posPx && trig.shift ? toGrid(trig.posPx.x + trig.shift.dx, trig.posPx.y + trig.shift.dy) : (trig.trail?.at(-1) ?? trig.pos);
        // 走位落点的前一个点:落点被挡时(物体堵着),引擎的走位停在半路,沿这条线往回找
        const back = trig.trail?.length > 1 ? trig.trail.at(-2) : null;
        const ferry = !!(trig.rides && trig.moveTo && trig.scene == null);
        exits.push({ id, gx: g.gx, gy: g.gy, r: Math.max(0, s.triggerMode - 4), ferry, shift: land ? null : stairs, to: { scene: to, gx: land?.gx, gy: land?.gy, back } });
        // 摆渡载完停在落点旁(最后一段 0x0044),那格再踩会被载回去:同 agent findPath,当挡路
        if (ferry && trig.parkAt) solid.add(trig.parkAt.gx * 1024 + trig.parkAt.gy);
      } else if (sw) {
        switches.push({ id, gx: g.gx, gy: g.gy, r: touch ? Math.max(0, s.triggerMode - 4) : 1, how: touch ? 'step on' : 'search', sets: trig.sets.filter((x) => x.id !== id) });
      }
      if (state >= 2 && !enemy) solid.add(g.gx * 1024 + g.gy);
    }
    return { exits, switches, solid };
  }
  const cheb = (a, gx, gy) => Math.max(Math.abs(a.gx - gx), Math.abs(a.gy - gy));

  /** 多场景格子 BFS。返回 { reached, prev, infos }。 */
  function search(start, goalTest, overlay) {
    const infos = new Map(), staticCache = new Map();
    const info = (sc) => { if (!infos.has(sc)) infos.set(sc, sceneInfo(sc, overlay)); return infos.get(sc); };
    const free = (sc, gx, gy) => {
      if (gx < GX[0] || gx >= GX[1] || gy < GY[0] || gy >= GY[1]) return false;
      const k = sc * 1048576 + (gx + 256) * 1024 + (gy + 256);
      let st = staticCache.get(k);
      if (st === undefined) {
        const map = mapOf(sc);
        if (!map) st = false;
        else {
          const { x, y } = fromGrid(gx, gy);
          // 虚空按墙算,但出口常压在地图边缘的虚空上:出口附近 2 格的虚空可走
          st = !tileBlocked(map, x, y) && (!isVoid(map, x, y) || info(sc).exits.some((ex) => cheb(ex, gx, gy) <= Math.max(1, ex.r) + 2));
        }
        staticCache.set(k, st);
      }
      return st && !info(sc).solid.has(gx * 1024 + gy);
    };
    // 真正的落点:脚本写的落点被挡(物体 / 墙)时,引擎的走位停在半路 —— 从落点往上一个走位点退,退到能站的格
    const landing = (ex, c) => {
      const t = ex.to, sc = t.scene;
      // 楼梯:0x006E 直接挪视口,落点 = 踩进去那格 + 位移,不看挡不挡
      if (ex.shift) { const { x, y } = fromGrid(c.gx, c.gy), g = toGrid(x + ex.shift.dx, y + ex.shift.dy); return { sc, gx: g.gx, gy: g.gy }; }
      if (t.gx == null || free(sc, t.gx, t.gy) || !t.back) return { sc, gx: t.gx, gy: t.gy };
      let { gx, gy } = t;
      while (gx !== t.back.gx || gy !== t.back.gy) {
        gx += Math.sign(t.back.gx - gx); gy += Math.sign(t.back.gy - gy);
        if (free(sc, gx, gy)) return { sc, gx, gy };
      }
      return { sc, gx: t.gx, gy: t.gy };
    };
    const key = (sc, gx, gy) => `${sc}:${gx}:${gy}`;
    const prev = new Map([[key(start.scene, start.gx, start.gy), null]]);
    const scenes = new Map([[start.scene, 0]]);
    const q = [{ sc: start.scene, gx: start.gx, gy: start.gy }];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      // 进了出口的触碰范围就会被挪走(引擎按物体顺序,第一个命中的先触发):不能再接着走。
      // 起点除外 —— 人已经站在这里,说明这个范围此刻不会再拽人(刚落地 / 已触发过)
      const hit = qi > 0 ? info(c.sc).exits.find((ex) => cheb(ex, c.gx, c.gy) <= ex.r) : null;
      if (goalTest(c, hit)) return { reached: c, prev, infos };
      const push = (n, via) => { const k = key(n.sc, n.gx, n.gy); if (prev.has(k)) return; prev.set(k, { from: c, via }); q.push(n); };
      if (hit) {
        if (hit.to.gx == null && !hit.shift) continue;   // 去向不明(换场景没写落点):死路
        const depth = scenes.get(c.sc) + (hit.to.scene !== c.sc ? 1 : 0);
        if (!scenes.has(hit.to.scene)) { if (scenes.size >= MAX_SCENES || depth > MAX_DEPTH) continue; scenes.set(hit.to.scene, depth); }
        push(landing(hit, c), { exit: hit, scene: c.sc, at: { gx: c.gx, gy: c.gy } });
        continue;
      }
      // 只有四个方向(引擎的方向键都是网格轴向);斜角的触碰格靠 Chebyshev 范围踩到,见 sceneInfo
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (free(c.sc, c.gx + dx, c.gy + dy)) push({ sc: c.sc, gx: c.gx + dx, gy: c.gy + dy });
    }
    return { reached: null, prev, infos };
  }
  // 已到达的格子里,有哪些开关够得着(还没踩、踩了会改东西)
  function reachableSwitches(res, overlay, pressed) {
    const out = [];
    for (const [k] of res.prev) {
      const [sc, gx, gy] = k.split(':').map(Number);
      const inf = res.infos.get(sc); if (!inf) continue;
      for (const sw of inf.switches) {
        if (pressed.some((p) => p.id === sw.id) || out.some((p) => p.id === sw.id)) continue;
        if (Math.max(Math.abs(sw.gx - gx), Math.abs(sw.gy - gy)) > Math.max(sw.r, 0)) continue;
        if (!sw.sets.some((x) => (overlay.get(x.id) ?? (globalThis.GameData?.eventObject?.[x.id - 1]?.state << 16 >> 16)) !== x.state)) continue;
        out.push({ ...sw, scene: sc, at: { sc, gx, gy } });
      }
    }
    return out;
  }
  const apply = (overlay, sw) => { const o = new Map(overlay); for (const x of sw.sets) o.set(x.id, x.state); return o; };

  /** 目标:本场景 (gx,gy) 附近 3 格内可站的格;目标上是触碰触发的物体(boss 等)时,它的触发范围内也算 */
  function goalFor(scene, gx, gy) {
    let r = 0;
    const store = globalThis.GameData?.eventObject;
    try {
      const rg = worldService.getSceneEventObjectRange(scene);
      for (let idx = rg.start; idx < rg.end; idx++) {
        const s = store?.[idx]; if (!s || (s.state << 16 >> 16) <= 0) continue;
        const g = toGrid(s.x, s.y);
        if (g.gx === gx && g.gy === gy && s.triggerMode >= 4) r = Math.max(r, s.triggerMode - 4);
      }
    } catch { /* */ }
    return (c) => c.sc === scene && (Math.abs(c.gx - gx) + Math.abs(c.gy - gy) <= 3 || Math.max(Math.abs(c.gx - gx), Math.abs(c.gy - gy)) <= r);
  }

  /** 把一段 BFS 路径(到 end)拆成「走到出口 → 落到哪」 */
  function legsOf(res, end) {
    const hops = [];
    let k = `${end.sc}:${end.gx}:${end.gy}`;
    while (res.prev.get(k)) {
      const p = res.prev.get(k);
      if (p.via) hops.push({ exit: p.via.exit, scene: p.via.scene, at: p.via.at, land: { gx: Number(k.split(':')[1]), gy: Number(k.split(':')[2]) } });
      k = `${p.from.sc}:${p.from.gx}:${p.from.gy}`;
    }
    return hops.reverse();
  }

  /**
   * 规划:from = { scene, gx, gy };返回 { text, steps } 或 null(怎么都到不了 / 本来就能到)。
   */
  function plan(from, gx, gy) {
    const near = goalFor(from.scene, gx, gy);
    // 目标格本身能站就要它本身;否则(墙上的门、boss 的台子)附近 / 触发范围内的格也行
    const exact = (c) => c.sc === from.scene && c.gx === gx && c.gy === gy;
    // 「附近」的格若在别的出口范围里,站上去就被拽走了,不算到达(目标本身就在那个范围里 = 想去的就是它,照算)
    const goal = (c, hit) => exact(c) || (!exactOk && near(c) && (!hit || cheb(hit, gx, gy) <= hit.r));
    let exactOk = false;
    let overlay = new Map();
    const pressed = [];
    let res = search(from, goal, overlay);
    for (let i = 0; !res.reached && i < 24; i++) {
      const cand = reachableSwitches(res, overlay, pressed);
      if (!cand.length) break;
      // 一次踩一个:离起点 BFS 最近的(prev 的插入顺序就是 BFS 顺序,cand 已按它排)
      const sw = cand[0];
      pressed.push(sw); overlay = apply(overlay, sw);
      res = search(from, goal, overlay);
    }
    if (!res.reached) return null;
    exactOk = !!search(from, exact, overlay).reached;
    // 删掉用不着的开关(倒着试)
    for (let i = pressed.length - 1; i >= 0; i--) {
      const rest = pressed.filter((_, j) => j !== i);
      let ov = new Map(); for (const sw of rest) ov = apply(ov, sw);
      if (search(from, goal, ov).reached) pressed.splice(i, 1);
    }
    // 按顺序走:起点 → 开关 1 → 开关 2 … → 目标;每段重新搜(门是一路踩开的)
    const steps = [];
    let cur = from, ov = new Map();
    const where = (sc) => (sc === from.scene ? 'this scene' : `scene ${sc}${sceneName(sc) ? ` (${sceneName(sc)})` : ''}`);
    const emitLegs = (r, end) => {
      // 写出踩进去的那一格(walk_to 它):触发物体本身那格常是墙,只能从旁边 / 斜角踩进范围
      let last = null;
      for (const h of legsOf(r, end)) {
        const what = h.exit.ferry ? 'the ferry' : h.exit.shift ? 'the stairs' : 'the exit';
        // 落点就在下一个出口的范围里:引擎接着就触发,不用(也没法)自己走 —— 并进上一步
        if (last && last.scene === h.scene && last.gx === h.at.gx && last.gy === h.at.gy) {
          steps[steps.length - 1] += `, which is inside ${what} at (${h.exit.gx},${h.exit.gy}) — it carries you on to (${h.land.gx},${h.land.gy})${h.exit.to.scene !== h.scene ? ` in ${where(h.exit.to.scene)}` : ''}`;
        } else {
          const via = h.at.gx !== h.exit.gx || h.at.gy !== h.exit.gy ? `: walk_to (${h.at.gx},${h.at.gy})` : '';
          steps.push(`in ${where(h.scene)} ${h.exit.ferry ? 'ride' : 'take'} ${what} at (${h.exit.gx},${h.exit.gy})${via} → you arrive in ${where(h.exit.to.scene)} at (${h.land.gx},${h.land.gy})`);
        }
        last = { scene: h.exit.to.scene, ...h.land };
      }
    };
    for (const sw of pressed) {
      const r = search(cur, (c) => c.sc === sw.scene && Math.max(Math.abs(c.gx - sw.gx), Math.abs(c.gy - sw.gy)) <= Math.max(sw.r, 0), ov);
      if (!r.reached) return null;
      emitLegs(r, r.reached);
      steps.push(`${sw.how} the switch at (${sw.gx},${sw.gy})${sw.scene !== from.scene ? ` in ${where(sw.scene)}` : ''} — it opens ${sw.sets.map((x) => describeTarget(x.id)).join(', ')}`);
      ov = apply(ov, sw);
      cur = { scene: r.reached.sc, gx: sw.gx, gy: sw.gy };
    }
    const r = search(cur, goal, ov);
    if (!r.reached) return null;
    emitLegs(r, r.reached);
    steps.push(`walk_to (${r.reached.gx},${r.reached.gy})${r.reached.gx !== gx || r.reached.gy !== gy ? ` (as close to (${gx},${gy}) as you can get)` : ''}`);
    if (steps.length < 2) return null;   // 没有绕路、没有开关:不是这里能帮上的
    return { steps, pressed: pressed.map((s) => s.id), text: `a route exists via other areas:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}` };
  }
  function describeTarget(id) {
    const s = globalThis.GameData?.eventObject?.[id - 1];
    if (!s) return `object ${id}`;
    const g = toGrid(s.x, s.y);
    return `(${g.gx},${g.gy})`;
  }
  /** 某场景通往别处的静态出口(按当前物体状态):map 工具找「还没探索的方向」用 */
  const sceneExits = (scene) => sceneInfo(scene, new Map()).exits;
  return { plan, sceneExits };
}
