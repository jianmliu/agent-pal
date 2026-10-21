/**
 * panorama:用引擎自带的全景渲染器(GPS / panorama 叠加层同一个)把当前场景整图渲出来,
 * 叠上旋转网格坐标、自己的位置、出口 / 摆渡 / 敌人 / NPC 的字母标记,出一张 PNG。
 * 给 agent 全局视野:observe 只有身边 37×23 格,远处的出口只能靠猜坐标;
 * walk_to 的寻路本来就是整图的,缺的只是「知道去哪」。图例文字与 map 工具同一份(sceneDirectory)。
 */
import { fromGrid } from './agent.mjs';
import { encodePng } from './png.mjs';

const MAX_W = 1024, MAX_H = 1024;

/**
 * 底图缓存:图块与网格只由「地图编号 + 调色板」决定(白天 / 夜晚 / 剧情滤镜颜色不同),渲一次反复用;
 * 标记(自己、出口、摆渡、敌人…)每次按当时状态现画。每张 ~1.8MB,留最近 8 张。
 */
const baseCache = new Map();
const CACHE_MAX = 8;
function paletteSig(palette) {
  let h = 0x811c9dc5;
  for (let i = 0; i < palette.length; i++) { const c = palette[i] || {}; h = Math.imul(h ^ ((c.r << 16) | (c.g << 8) | c.b), 0x01000193); }
  return (h >>> 0).toString(16);
}

// 3×5 点阵字(数字、大写字母、少量符号),绘制时放大
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '@': '010101111100011', ',': '000000000010100', '-': '000000111000000'
};

const COLORS = {
  exits: [255, 214, 10], ferries: [80, 220, 120], enemies: [255, 70, 70], 'people & objects': [80, 200, 255],
  'search spots': [255, 255, 255], 'other triggers': [200, 160, 255], switches: [255, 140, 0], player: [255, 60, 220]
};

export async function renderPanorama(e, a) {
  const map = e.sceneService.getMap?.();
  const palette = e.probes.surface?.palette;
  if (!map || !palette) return { error: 'no map loaded yet (still on the title screen?)' };
  const key = `${map.mapNum || 0}|${paletteSig(palette)}`;
  let base = baseCache.get(key);
  if (base) { baseCache.delete(key); baseCache.set(key, base); }   // LRU:挪到最新
  else {
    base = await renderBase(map, palette, a);
    if (base.error) return base;
    baseCache.set(key, base);
    if (baseCache.size > CACHE_MAX) baseCache.delete(baseCache.keys().next().value);
  }
  const { W, H, toImg } = base;
  const img = Buffer.from(base.img);                                 // 底图副本上画标记
  const { put, text, dot } = painter(img, W, H);
  return drawMarkers(a, img, W, H, toImg, text, dot, put, base.cached++ > 0);
}

/** 底图:引擎全景渲染 → 降采样到 ≤1024 → 叠网格与坐标。只依赖地图与调色板 */
async function renderBase(map, palette, a) {
  const { default: pano } = await import('@onchainpal/game-engine/js/pal/panorama-renderer');
  const bounds = pano.measureBounds(map.mapNum || 0, map);
  const r = pano.renderMapToBitmap(map, palette, { containerWidth: bounds.width, containerHeight: bounds.height });
  if (!r?.bitmap) return { error: 'the panorama renderer could not draw this map' };

  // 缩到 ≤ 1024:盒式降采样
  const k = Math.max(1, Math.ceil(Math.max(r.width / MAX_W, r.height / MAX_H)));
  const W = Math.floor(r.width / k), H = Math.floor(r.height / k);
  const src = r.bitmap.data, img = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let R = 0, G = 0, B = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = ((y * k + dy) * r.width + (x * k + dx)) * 4;
          R += src[i]; G += src[i + 1]; B += src[i + 2];
        }
      }
      const o = (y * W + x) * 3, n = k * k;
      img[o] = R / n; img[o + 1] = G / n; img[o + 2] = B / n;
    }
  }
  const s = r.scale / k;
  // 网格格子 → 图上像素(格子的世界坐标就是该格菱形图块的中心)
  const toImg = (gx, gy) => { const w = fromGrid(gx, gy); return { x: Math.round((w.x - bounds.minX) * s), y: Math.round((w.y - bounds.minY) * s) }; };
  const { put, text } = painter(img, W, H);

  // 网格:每 10 格一条淡线,每 20 格交点标坐标(只画地图上有东西的地方)
  const onMap = (gx, gy) => !a.voidAt(gx, gy);
  for (let gx = 0; gx <= 160; gx++) {
    for (let gy = 0; gy <= 160; gy++) {
      if ((gx % 10 && gy % 10) || !onMap(gx, gy)) continue;
      const p = toImg(gx, gy);
      put(p.x, p.y, [255, 255, 255], 0.55);
    }
  }
  for (let gx = 0; gx <= 160; gx += 20) {
    for (let gy = 0; gy <= 160; gy += 20) {
      if (!onMap(gx, gy)) continue;
      const p = toImg(gx, gy);
      text(`${gx},${gy}`, p.x + 3, p.y + 3, [235, 235, 235], 1);
    }
  }
  return { img, W, H, toImg, cached: 0 };
}

/** 在 RGB 缓冲上画点、字、圆点的小工具 */
function painter(img, W, H) {
  const put = (x, y, c, alpha = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    for (let j = 0; j < 3; j++) img[o + j] = Math.round(img[o + j] * (1 - alpha) + c[j] * alpha);
  };
  const text = (str, x, y, c, z = 2) => {
    let cx = x;
    for (const ch of String(str)) {
      const g = FONT[ch];
      if (g) {
        for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
          if (g[gy * 3 + gx] !== '1') continue;
          for (let dy = -1; dy <= z; dy++) for (let dx = -1; dx <= z; dx++) put(cx + gx * z + dx, y + gy * z + dy, [0, 0, 0], 0.85);   // 描边
        }
        for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
          if (g[gy * 3 + gx] !== '1') continue;
          for (let dy = 0; dy < z; dy++) for (let dx = 0; dx < z; dx++) put(cx + gx * z + dx, y + gy * z + dy, c);
        }
      }
      cx += 4 * z;
    }
  };
  const dot = (x, y, rad, c) => {
    for (let dy = -rad - 1; dy <= rad + 1; dy++) for (let dx = -rad - 1; dx <= rad + 1; dx++) {
      const d = dx * dx + dy * dy;
      if (d <= rad * rad) put(x + dx, y + dy, c);
      else if (d <= (rad + 1) * (rad + 1)) put(x + dx, y + dy, [0, 0, 0], 0.9);
    }
  };

  return { put, text, dot };
}

/** 标记:每次按当时状态画(物体会动、荷叶会换岸、门会开) */
function drawMarkers(a, img, W, H, toImg, text, dot, put, fromCache) {
  // 物体标记 + 字母(与图例同序)
  const dir = a.sceneDirectory();
  for (const o of dir.objects) {
    if (!o.mark) continue;
    const kind = o.kind === 'switch' ? 'switches' : o.kind === 'touch-trigger' ? (o.dest ? 'exits' : 'other triggers') : o.kind === 'ferry' ? 'ferries'
      : o.kind === 'enemy' ? 'enemies' : o.kind === 'npc' ? 'people & objects' : 'search spots';
    const p = toImg(o.gx, o.gy);
    dot(p.x, p.y, 4, COLORS[kind]);
    text(o.mark, p.x + 6, p.y - 12, COLORS[kind], 2);
  }
  const me = toImg(dir.player.gx, dir.player.gy);
  dot(me.x, me.y, 6, COLORS.player);
  text('@', me.x + 8, me.y - 14, COLORS.player, 2);

  const legend = `panorama of scene ${dir.scene} (${W}×${H}). Grid: rotated map coordinates — faint dotted lines every 10 cells, labels "x,y" every 20; walk_to takes these coordinates directly. ` +
    `Markers: @ magenta = you at (${dir.player.gx},${dir.player.gy}); yellow = exits; green = ferries; red = enemies; blue = people & objects (NPCs, statues, other sprites); white = search spots; orange = switches (step on / search them to open doors etc.); purple = other triggers. ` +
    `Only the map tiles are drawn (no characters), so use the markers for where things are.\n${dir.text}`;
  return { png: encodePng(img, W, H), legend, width: W, height: H, fromCache };
}
