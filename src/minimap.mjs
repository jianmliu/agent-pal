/**
 * 观战页的小地图(「GPS」):当前场景的整图、队伍位置、走过的地方、出口走没走过。
 *
 * 起因:直播里 AI 在死路场景里打转了两轮多,观众从 320×200 的画面上完全看不出来。
 *
 * 每个场景出两张底图,换场景时出一次。页面只显示一张:有实景图就用实景图,没有(还没出 / 出不来)用平面图兜底:
 *   - plan 平面图:正视的格子图 —— 旋转网格(同 walk_to 的坐标)里一格一个方块,只画走得到的地面和围着它的墙。
 *     只跟地图有关,不看调色板;实景图靠它定范围(走得到的区域)。
 *   - art 实景图:引擎里 GPS 叠加层用的那张图(全景渲染器出的整张场景,游戏本身的斜 45° 视角),裁到走得到的区域四周。
 *     暗场景自动提亮。
 *     调色板取出图那一刻的;淡入淡出途中调色板是暗的,所以太暗时先不出,之后明显变亮了再重出一版。
 * 哪张图(重)出了,版本 v 就加一,页面按 (场景, v) 重新取图。
 *
 * 位置、走过的格子、出口一律用网格坐标给页面,每张图带一个仿射变换 m(网格 → 图上像素:
 * x = m[0]·gx + m[1]·gy + m[2],y = m[3]·gx + m[4]·gy + m[5]),页面不用懂游戏的坐标系。
 *
 *   - 走过的格子:每个引擎帧记一次队伍所在的格子。agent 若提供 visitedCells(scene)(存在 memory 里、跨进程不丢),
 *     一并并进来;没有就只有本进程记的这份。
 *   - 出口:从 agent.objects() 里取会换场景的触发点。「走没走过」:agent 提供 exitUsage(scene)(带次数)就用它;
 *     另外本进程每次换场景都记下「离开时站在哪、去了哪」「到达时站在哪、从哪来」,离这些点近、去向也对得上的出口算走过
 *     (同一个去向有好几个门时,只有真走过的那个算)。
 */
import { fromGrid, toGrid } from './agent.mjs';
import { encodePng } from './png.mjs';
import { sceneName } from './scene-names.mjs';

const GRID = 192;            // 网格坐标的范围(2048×2048 的地图转 45° 以后,gx / gy 都落在 0..191)
const GY_OFF = toGrid(0, 0).gy;
const REVEAL_CELLS = 2.2;    // 平面图上同一件事,按格算
const LEVEL = 210, MAX_GAIN = 3.2, DARK = 14;   // 实景图提亮:目标亮度、最多放大几倍、暗到什么程度算出不来
const PAD = 40;              // 实景图在走得到的区域四周留的边(原图像素;上边留两倍)
const REVEAL = 56;           // 实景图上,走过的格子周围多大一圈算「看过」(游戏里的像素;一屏是 320×200)
const SETTLE_FRAMES = 3;     // 换场景后跳过的帧数
const NEAR = 8;              // 离「离开 / 到达」的位置多少格以内的出口算走过
const COLOR = { void: [6, 8, 10], wall: [46, 56, 68], floor: [178, 188, 198] };

const near = (r, x) => r.marks.some((m) => m.to === x.to && Math.max(Math.abs(m.gx - x.gx), Math.abs(m.gy - x.gy)) <= NEAR);
/** 这个出口从平面图画出来的地面走得到吗(触发范围挨着地面)。同一张地图上别的房间的门走不到:不画、不计数 */
const reaches = (kind, x) => {
  const d = x.r + 1;
  for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    const nx = x.gx + dx, ny = x.gy + dy;
    if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && kind[ny * GRID + nx] === 2) return true;
  }
  return false;
};
const brightness = (palette) => { let s = 0; for (let i = 0; i < 256; i++) { const c = palette?.[i]; if (c) s += c.r + c.g + c.b; } return s; };
const PAL_XY = (x, y) => (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0;
/** 世界坐标 → 带小数的网格坐标(fromGrid 的逆) */
const toGridF = (x, y) => [(x / 16 + y / 8) / 2, (y / 8 - x / 16) / 2 + GY_OFF];
const round2 = (v) => Math.round(v * 100) / 100;

export function createMinimap(e, { agent = null, maxSize = 640 } = {}) {
  const ws = e.worldService;
  // 这个进程的标识,拼在底图地址里:版本号每次启动都从 1 数起,不加的话浏览器会拿上一次启动缓存的图配这一次的坐标
  const boot = Math.random().toString(16).slice(2, 10);
  // 场景号 → { mapNum, v, views: { plan, art }, cells: Set, order: [[gx, gy]], marks: [{ gx, gy, to }], exits }
  const scenes = new Map();
  let lastScene = null, lastCell = null, pendingFrom = null, settle = 0;
  const rec = (scene) => { let r = scenes.get(scene); if (!r) { r = { mapNum: null, v: 0, views: {}, planStale: false, cells: new Set(), order: [], marks: [], exits: [], exitsAt: 0 }; scenes.set(scene, r); } return r; };
  const here = () => { try { return ws.getSceneId?.() ?? null; } catch { return null; } };
  /** 引擎里装着的地图是不是这个场景的(换场景的那几帧,场景号已经变了、地图还是上一张) */
  const mapReady = (scene) => {
    const map = e.sceneService.getMap?.(); if (!map) return null;
    let want = null; try { want = ws.getSceneEntry?.(scene)?.mapNum ?? null; } catch { /* */ }
    return want == null || map.mapNum == null || want === map.mapNum ? map : null;
  };
  const world = () => {
    // 视口和队伍偏移是打包成一个数的 (x, y)(同 agent.mjs 的 PAL_X / PAL_Y:低 16 位 x、高 16 位 y,有符号)
    const vp = ws.getViewport(), off = ws.getPartyOffset ? ws.getPartyOffset() : PAL_XY(160, 112);
    const X = (v) => (typeof v === 'number' ? (v << 16) >> 16 : v.x), Y = (v) => (typeof v === 'number' ? v >> 16 : v.y);
    return { x: X(vp) + X(off), y: Y(vp) + Y(off) };
  };

  /** 每个引擎帧:记下队伍所在的格子;看有没有换场景 */
  function sample() {
    const scene = here(); if (scene == null) return;
    if (scene !== lastScene) {
      if (lastScene != null && lastCell) { rec(lastScene).marks.push({ gx: lastCell[0], gy: lastCell[1], to: scene }); pendingFrom = lastScene; }
      lastScene = scene; lastCell = null; settle = SETTLE_FRAMES;
    }
    // 换场景后先等几帧、等新地图装好:这期间队伍坐标可能还是上一个场景的
    if (settle > 0) { settle--; return; }
    if (!mapReady(scene)) return;
    let p; try { p = world(); } catch { return; }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const g = toGrid(p.x, p.y), key = g.gx * 4096 + g.gy, r = rec(scene);
    if (pendingFrom != null) { r.marks.push({ gx: g.gx, gy: g.gy, to: pendingFrom }); pendingFrom = null; }
    lastCell = [g.gx, g.gy];
    if (!r.cells.has(key)) { r.cells.add(key); r.order.push([g.gx, g.gy]); }
    if (r.views.plan && r.views.plan.kind[g.gy * GRID + g.gx] !== 2) r.planStale = true;      // 走到平面图没画到的地方了
  }

  /** 场景外的虚空 = 两层都没有可画的图块(同 agent.mjs 的 voidAt) */
  function voidCell(map, gx, gy) {
    const { x, y } = fromGrid(gx, gy);
    if (x < 0 || y < 0) return true;
    const h = (x % 32) ? 1 : 0, tx = Math.floor(x / 32), ty = Math.floor((y - 8 * h) / 16);
    if (tx < 0 || ty < 0 || tx >= 64 || ty >= 128) return true;
    if (typeof map.getTileBitmap !== 'function') return !map.getTile?.(ty, tx, h);
    return !map.getTileBitmap(tx, ty, h, 0) && !map.getTileBitmap(tx, ty, h, 1);
  }
  /** 地图本身挡不挡(不算人和物体;同引擎走路时用的判断) */
  function wallCell(gx, gy) {
    const { x, y } = fromGrid(gx, gy);
    if (x < 0 || y < 0 || x >= 2048 || y >= 2048) return true;
    const svc = e.sceneService, at = PAL_XY(x, y);
    try { return !!(svc.checkObstacleWithRange ? svc.checkObstacleWithRange(at, false, 0) : svc.checkObstacle(at, false, 0)); } catch { return true; }
  }

  /**
   * 平面图:一格一个方块。地图图块铺满整张图,「场景外」的空地在数据里也是能走的,所以不能把不挡路的格子都画成地面 ——
   * 从队伍走过的格子(seeds)出发做四连通填充(走路就是沿网格轴一步一格),填到的才是地面,贴着地面的墙画成墙,其余留空;
   * 填到出口的触发范围就停(同寻路:不穿出口范围)。
   * 之后走到了填充范围以外(剧情开了门、坐船过了河),sample() 会把这张图标成过期,下一拍带着新的种子重出。
   */
  function renderPlan(map, seeds, exits) {
    const open = new Int8Array(GRID * GRID).fill(-1);                          // -1 没查过 / 0 挡 / 1 不挡
    const isOpen = (gx, gy) => {
      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return false;
      const i = gy * GRID + gx;
      if (open[i] < 0) open[i] = voidCell(map, gx, gy) || wallCell(gx, gy) ? 0 : 1;
      return open[i] === 1;
    };
    // 出口的触发范围是填充的边界:路在出口处直通到场景外的空地,不拦住的话会把整张地图外面都填成地面
    const stop = new Uint8Array(GRID * GRID);
    for (const x of exits) for (let dy = -x.r; dy <= x.r; dy++) for (let dx = -x.r; dx <= x.r; dx++) {
      const nx = x.gx + dx, ny = x.gy + dy; if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) stop[ny * GRID + nx] = 1;
    }
    const kind = new Uint8Array(GRID * GRID);                                  // 0 留空 / 1 墙 / 2 地面
    const queue = [], seeded = new Uint8Array(GRID * GRID);
    for (const [gx, gy] of seeds) if (gx >= 0 && gy >= 0 && gx < GRID && gy < GRID) seeded[gy * GRID + gx] = 1;
    for (const [gx, gy] of seeds) { if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID || kind[gy * GRID + gx]) continue; kind[gy * GRID + gx] = 2; queue.push(gx, gy); }
    for (let q = 0; q < queue.length; q += 2) {
      const gx = queue[q], gy = queue[q + 1];
      if (stop[gy * GRID + gx] && !seeded[gy * GRID + gx]) continue;           // 出口范围里:算地面,但不往外扩(真走到过的格子照常扩)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = gx + dx, ny = gy + dy;
        if (!isOpen(nx, ny) || kind[ny * GRID + nx]) continue;
        kind[ny * GRID + nx] = 2; queue.push(nx, ny);
      }
    }
    if (!queue.length) return null;
    let x0 = GRID, y0 = GRID, x1 = -1, y1 = -1;
    const grow = (gx, gy) => { if (gx < x0) x0 = gx; if (gx > x1) x1 = gx; if (gy < y0) y0 = gy; if (gy > y1) y1 = gy; };
    for (let q = 0; q < queue.length; q += 2) {
      const gx = queue[q], gy = queue[q + 1]; grow(gx, gy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && !kind[ny * GRID + nx]) kind[ny * GRID + nx] = 1;
      }
    }
    for (const x of exits) if (reaches(kind, x)) grow(Math.max(0, Math.min(GRID - 1, x.gx)), Math.max(0, Math.min(GRID - 1, x.gy)));   // 出口的标记要画得下
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(GRID - 1, x1 + 2); y1 = Math.min(GRID - 1, y1 + 2);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, c = Math.max(2, Math.min(12, Math.floor(maxSize / Math.max(cw, ch))));
    const W = cw * c, H = ch * c, img = Buffer.alloc(W * H * 3), tones = [COLOR.void, COLOR.wall, COLOR.floor];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tones[kind[(y0 + ((y / c) | 0)) * GRID + x0 + ((x / c) | 0)]], o = (y * W + x) * 3;
      img[o] = t[0]; img[o + 1] = t[1]; img[o + 2] = t[2];
    }
    // 格子 gx 画在 [gx - x0, gx - x0 + 1)·c,中心在 (gx - x0 + .5)·c
    return { w: W, h: H, rad: round2(REVEAL_CELLS * c), m: [c, 0, (0.5 - x0) * c, 0, c, (0.5 - y0) * c], png: Buffer.from(encodePng(img, W, H), 'base64'),
      kind, box: [x0, y0, x1, y1] };
  }

  /**
   * 实景图:就是引擎里 GPS 叠加层用的那张图(panorama-renderer 出的整张场景,游戏本身的斜 45° 视角,不变形),
   * 裁到走得到的那片区域(平面图里填出来的地面)四周,缩到 ≤ maxSize。暗场景自动提亮。
   * 试过把它按网格摆正(#236):地面是正了,但房子、树斜着拉长,不如原图好认。
   */
  let pano = null;                              // 最近一次的全景图(整张十几 MB,只留一张):{ mapNum, score, out, bounds }
  async function renderArt(map, palette, score, plan, exits) {
    if (!pano || pano.mapNum !== map.mapNum || pano.score !== score) {
      const { default: renderer } = await import('@onchainpal/game-engine/js/pal/panorama-renderer');
      const bounds = renderer.measureBounds(map.mapNum || 0, map);
      const out = renderer.renderMapToBitmap(map, palette, { containerWidth: bounds.width, containerHeight: bounds.height });
      if (!out?.bitmap) return null;
      pano = { mapNum: map.mapNum, score, out, bounds };
    }
    const { out, bounds } = pano, src = out.bitmap.data, bw = out.width, bh = out.height;
    // 网格 → 原图像素(格子的世界坐标就是那一格菱形图块的中心)
    const at = (gx, gy) => { const w = fromGrid(gx, gy); return [(w.x - bounds.minX) * out.scale, (w.y - bounds.minY) * out.scale]; };
    // 范围:地面格子落在原图上的外接框,四周留边(上面多留些:墙和房子是往上长的)
    let x0 = bw, y0 = bh, x1 = -1, y1 = -1;
    const [gx0, gy0, gx1, gy1] = plan.box;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      if (plan.kind[gy * GRID + gx] !== 2) continue;
      const [x, y] = at(gx, gy);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    for (const e of exits) if (reaches(plan.kind, e)) { const [x, y] = at(e.gx, e.gy); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }   // 出口的标记要画得下
    x0 = Math.max(0, Math.floor(x0 - PAD)); x1 = Math.min(bw - 1, Math.ceil(x1 + PAD));
    y0 = Math.max(0, Math.floor(y0 - PAD * 2)); y1 = Math.min(bh - 1, Math.ceil(y1 + PAD));
    if (x1 <= x0 || y1 <= y0) return null;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.max(1, Math.ceil(Math.max(cw, ch) / maxSize));
    const W = Math.max(1, Math.floor(cw / k)), H = Math.max(1, Math.floor(ch / k)), img = Buffer.alloc(W * H * 3), n = k * k;
    for (let y = 0, o = 0; y < H; y++) for (let x = 0; x < W; x++, o += 3) {                     // 盒式降采样
      let R = 0, G = 0, B = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const i = ((y0 + y * k + dy) * bw + (x0 + x * k + dx)) * 4; R += src[i]; G += src[i + 1]; B += src[i + 2]; }
      img[o] = R / n; img[o + 1] = G / n; img[o + 2] = B / n;
    }
    // 暗场景(夜里、地宫)整体提亮:让最亮的那 2% 像素落在 LEVEL 附近,最多放大 MAX_GAIN 倍。
    // 提不起来(几乎全黑)就当没有实景图,页面退回平面图
    const hist = new Uint32Array(256);
    for (let o = 0; o < img.length; o += 3) hist[Math.max(img[o], img[o + 1], img[o + 2])]++;
    let top = 255; for (let left = W * H * 0.02; top > 0 && (left -= hist[top]) > 0;) top--;
    if (top < DARK) return null;
    const gain = Math.min(MAX_GAIN, LEVEL / top);
    if (gain > 1.05) for (let o = 0; o < img.length; o++) img[o] = Math.min(255, img[o] * gain);
    // 网格 → 图上像素是仿射的:取三个点定出来
    const px = (g) => [(g[0] - x0) / k, (g[1] - y0) / k], o = px(at(0, 0)), ax = px(at(1, 0)), ay = px(at(0, 1));
    return { w: W, h: H, rad: round2(Math.max(4, REVEAL * out.scale / k)), m: [ax[0] - o[0], ay[0] - o[0], o[0], ax[1] - o[1], ay[1] - o[1], o[1]].map(round2),
      png: Buffer.from(encodePng(img, W, H), 'base64') };
  }

  /** 需要时出底图。返回这次有没有出新图 */
  async function render(scene) {
    const map = mapReady(scene); if (!map) return false;
    const r = rec(scene);
    let changed = false;
    const finish = () => { if (changed) r.v++; return changed; };
    if (r.mapNum !== map.mapNum) { r.views = {}; r.mapNum = map.mapNum; }      // 同一个场景换了地图(少见):两张都重出
    if ((!r.views.plan || r.planStale) && r.order.length) {
      const plan = renderPlan(map, r.order, r.exits); r.planStale = false;
      if (plan) { r.views.plan = plan; changed = true; }
    }
    const palette = e.probes.surface?.palette, score = brightness(palette);
    // 几乎全黑多半在淡入淡出途中:先不出;已有的那张是半暗时出的,明显变亮了再出一版。平面图重出了(范围变了)也跟着重出
    const plan = r.views.plan, art = r.views.art;
    if (plan && palette && score >= 256 * 3 * 12 && !(art && art.plan === plan && score <= art.score * 1.4)) {
      // 出图在引擎的线程上(整张约 0.1 秒,每个场景一两次):两张之间让一拍,别连着卡住画面
      if (changed) await new Promise((done) => setImmediate(done));
      if (mapReady(scene) !== map) return finish();
      const next = await renderArt(map, palette, score, plan, r.exits);
      if (next) { r.views.art = { ...next, score, plan }; changed = true; }
    }
    return finish();
  }

  /** 每秒一次:刷新出口;把 agent 记的走过的格子并进来;需要时出底图 */
  async function tick() {
    const scene = here(); if (scene == null) return;
    const r = rec(scene);
    try {
      for (const c of agent?.visitedCells?.(scene) || []) {
        const key = c[0] * 4096 + c[1]; if (r.cells.has(key)) continue;
        r.cells.add(key); r.order.push([c[0], c[1]]);
        if (r.views.plan && r.views.plan.kind[c[1] * GRID + c[0]] !== 2) r.planStale = true;
      }
    } catch { /* */ }
    if (Date.now() - r.exitsAt > 3000 && mapReady(scene)) {
      r.exitsAt = Date.now();
      try {
        // 出口取自场景里会换场景的触发点(带触发半径 = 模式 − 4);agent 记了各出口走过几次就并上
        const usage = agent?.exitUsage?.(scene), count = new Map();
        if (Array.isArray(usage)) for (const x of usage) count.set(`${x.gx},${x.gy},${x.to}`, x.count || 0);
        let exits = null;
        if (agent?.objects && here() === scene) {
          exits = agent.objects().filter((o) => o.kind === 'touch-trigger' && o.dest && o.dest.scene != null && o.dest.scene !== scene)
            .map((o) => ({ gx: o.gx, gy: o.gy, to: o.dest.scene, r: Math.max(0, (o.triggerMode || 0) - 4), count: count.get(`${o.gx},${o.gy},${o.dest.scene}`) || 0 }));
        } else if (Array.isArray(usage)) exits = usage.map((x) => ({ gx: x.gx, gy: x.gy, to: x.to, r: 1, count: x.count || 0 }));
        if (exits) {
          const sig = (list) => list.map((x) => `${x.gx},${x.gy},${x.r}`).join(';');
          if (sig(exits) !== sig(r.exits)) r.planStale = true;                 // 出口变了(剧情开了新门):填充边界跟着变
          r.exits = exits;
        }
      } catch { /* */ }
    }
    try { await render(scene); } catch { /* 出不了图就没有小地图,不影响直播 */ }
  }

  return {
    sample, tick,
    /** 底图 PNG(view = 'plan' | 'art');还没出就 null */
    png: (scene, view) => scenes.get(Number(scene))?.views[view]?.png || null,
    /** 当前场景小地图的状态(网格坐标);底图一张都还没出就 null */
    state() {
      const scene = here(), r = scene == null ? null : scenes.get(scene);
      if (!r || !Object.keys(r.views).length) return null;
      let pos = null; try { const p = world(); pos = toGridF(p.x, p.y).map(round2); } catch { /* */ }
      const views = {}; for (const [name, v] of Object.entries(r.views)) views[name] = { w: v.w, h: v.h, rad: v.rad, m: v.m };
      return {
        scene, v: r.v, boot, place: sceneName(scene), views, pos, cells: r.order.length,
        exits: r.exits.filter((x) => !r.views.plan || reaches(r.views.plan.kind, x))
          .map((x) => ({ gx: x.gx, gy: x.gy, to: x.to, place: sceneName(x.to), used: x.count > 0 || near(r, x) }))
      };
    },
    /** 走过的格子里第 from 个之后的那些 */
    trail(scene, from = 0) { return scenes.get(scene)?.order.slice(from) || []; }
  };
}
