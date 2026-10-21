/**
 * atlas — 全图攻略(每张是一整个场景的鸟瞰图 + 手写地名/物品标注)接进 agent。
 *
 * 图是第三方作品,不进仓库:AGENT_PAL_ATLAS_INDEX 指向本地生成的索引(atlas-build.mjs 产出),
 * 索引里记着图片目录和「地图号 → 图片/地名」。图片解码借 macOS 自带的 sips(转 BMP / 缩放 JPEG),
 * 不引图像库依赖。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const FEATURE = 24;

/** 文件名 → 地名:「03-余杭盛鱼村.jpg」→「余杭盛鱼村」。 */
export function placeName(file) {
  return path.basename(file).replace(/\.[a-z]+$/i, '').replace(/^\d+[-_.\s]*/, '');
}

/** 解析 24/32 位未压缩 BMP(sips 的输出)→ { width, height, rgba }。 */
export function parseBmp(buf) {
  if (buf.toString('ascii', 0, 2) !== 'BM') throw new Error('not a BMP');
  const off = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const hRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported BMP bpp ${bpp}`);
  const h = Math.abs(hRaw), bottomUp = hRaw > 0;
  const stride = Math.ceil((w * bpp) / 32) * 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (bottomUp ? h - 1 - y : y) * stride;
    for (let x = 0; x < w; x++) {
      const p = row + x * (bpp / 8), q = (y * w + x) * 4;
      rgba[q] = buf[p + 2]; rgba[q + 1] = buf[p + 1]; rgba[q + 2] = buf[p]; rgba[q + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
}

/** 用 sips 把任意图片缩到最长边 maxSide 并转 BMP 读进来。 */
export function loadImageSmall(file, maxSide = 160) {
  const tmp = path.join(os.tmpdir(), `agent-pal-atlas-${process.pid}-${Math.random().toString(36).slice(2)}.bmp`);
  try {
    execFileSync('sips', ['-s', 'format', 'bmp', '-Z', String(maxSide), file, '--out', tmp], { stdio: 'ignore' });
    return parseBmp(fs.readFileSync(tmp));
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* */ }
  }
}

/**
 * 图像特征:裁到非暗内容的包围盒 → 盒采样成 FEATURE×FEATURE 灰度 → 去均值归一化。
 * 两边(引擎渲染的地图 / 攻略图)都这样处理,再用相关系数比。宽高比单独记,打分时扣分。
 */
export function feature({ width, height, rgba }) {
  const lum = (i) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (lum((y * width + x) * 4) > 14) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < x0) { x0 = 0; y0 = 0; x1 = width - 1; y1 = height - 1; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const v = new Float64Array(FEATURE * FEATURE);
  for (let fy = 0; fy < FEATURE; fy++) for (let fx = 0; fx < FEATURE; fx++) {
    const sx0 = x0 + Math.floor((fx * cw) / FEATURE), sx1 = x0 + Math.max(Math.floor(((fx + 1) * cw) / FEATURE), Math.floor((fx * cw) / FEATURE) + 1);
    const sy0 = y0 + Math.floor((fy * ch) / FEATURE), sy1 = y0 + Math.max(Math.floor(((fy + 1) * ch) / FEATURE), Math.floor((fy * ch) / FEATURE) + 1);
    let s = 0, n = 0;
    for (let y = sy0; y < Math.min(sy1, height); y++) for (let x = sx0; x < Math.min(sx1, width); x++) { s += lum((y * width + x) * 4); n++; }
    v[fy * FEATURE + fx] = n ? s / n : 0;
  }
  let mean = 0; for (const a of v) mean += a; mean /= v.length;
  let sd = 0; for (const a of v) sd += (a - mean) ** 2; sd = Math.sqrt(sd / v.length) || 1;
  return { v: Array.from(v, (a) => (a - mean) / sd), aspect: cw / ch };
}

/** 灰度下采样:RGBA → (w/k)×(h/k) 的亮度数组(盒平均)。 */
export function grayDown({ width, height, rgba }, k) {
  const W = Math.max(1, Math.floor(width / k)), H = Math.max(1, Math.floor(height / k));
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let yy = y * k; yy < (y + 1) * k; yy++) for (let xx = x * k; xx < (x + 1) * k; xx++) {
      const i = (yy * width + xx) * 4; s += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
    g[y * W + x] = s / (k * k);
  }
  return { w: W, h: H, g };
}

/** 4×4×4 颜色直方图(归一化),给模板匹配做粗筛。 */
export function colorHist({ width, height, rgba }) {
  const h = new Float64Array(64); let n = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 24) continue;     // 地图外的虚空不计
    h[((rgba[i] >> 6) << 4) | ((rgba[i + 1] >> 6) << 2) | (rgba[i + 2] >> 6)]++; n++;
  }
  if (n) for (let i = 0; i < 64; i++) h[i] /= n;
  return h;
}
export const histSim = (a, b) => { let s = 0; for (let i = 0; i < 64; i++) s += Math.sqrt(a[i] * b[i]); return s; };   // Bhattacharyya

/**
 * 模板匹配:在大图 big 里滑动小图 small,取最大归一化互相关(NCC)。
 * 攻略图是地图整图渲染的原尺寸裁片,所以同为 1/k 缩小后应能几乎重合。
 */
export function bestNcc(big, small) {
  const { w: W, h: H, g: B } = big, { w, h, g: S } = small;
  if (w > W || h > H) return { score: -1 };
  const n = w * h;
  let sm = 0; for (let i = 0; i < n; i++) sm += S[i]; sm /= n;
  let ss = 0; const Sc = new Float32Array(n); for (let i = 0; i < n; i++) { Sc[i] = S[i] - sm; ss += Sc[i] * Sc[i]; }
  ss = Math.sqrt(ss) || 1;
  // 积分图求窗口均值/方差
  const I = new Float64Array((W + 1) * (H + 1)), I2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let r = 0, r2 = 0; for (let x = 0; x < W; x++) { const v = B[y * W + x]; r += v; r2 += v * v; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + r; I2[(y + 1) * (W + 1) + x + 1] = I2[y * (W + 1) + x + 1] + r2; } }
  const box = (A, x, y) => A[(y + h) * (W + 1) + x + w] - A[y * (W + 1) + x + w] - A[(y + h) * (W + 1) + x] + A[y * (W + 1) + x];
  let best = { score: -1, x: 0, y: 0 };
  for (let oy = 0; oy <= H - h; oy++) for (let ox = 0; ox <= W - w; ox++) {
    const mean = box(I, ox, oy) / n;
    const varw = box(I2, ox, oy) - n * mean * mean;
    if (varw <= 1e-6) continue;
    let c = 0;
    for (let y = 0; y < h; y++) { const bo = (oy + y) * W + ox, so = y * w; for (let x = 0; x < w; x++) c += B[bo + x] * Sc[so + x]; }
    const score = c / (Math.sqrt(varw) * ss);
    if (score > best.score) best = { score, x: ox, y: oy };
  }
  return best;
}

export function similarity(a, b) {
  let c = 0;
  for (let i = 0; i < a.v.length; i++) c += a.v[i] * b.v[i];
  c /= a.v.length;
  return c - 0.5 * Math.abs(Math.log(a.aspect / b.aspect));
}

/** 运行时:读索引,给出 地图号 → { name, file }。 */
export function loadAtlas(indexFile = process.env.AGENT_PAL_ATLAS_INDEX) {
  if (!indexFile || !fs.existsSync(indexFile)) return null;
  let idx;
  try { idx = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { return null; }
  const byMap = new Map(Object.entries(idx.byMap || {}).map(([k, v]) => [Number(k), v]));
  return {
    dir: idx.dir,
    byMap,
    forMap: (mapNum) => byMap.get(mapNum) || null,
    names: () => [...new Set([...byMap.values()].map((e) => e.name))],
    byName: (q) => [...byMap.values()].find((e) => e.name === q) || [...byMap.values()].find((e) => e.name.includes(q)) || null,
    /** 给 agent 看的图:缩到最长边 1200 的 JPEG(base64)。 */
    imageBase64(entry, maxSide = 1200) {
      const file = path.join(idx.dir, entry.file);
      const tmp = path.join(os.tmpdir(), `agent-pal-atlas-${process.pid}.jpg`);
      try {
        execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', String(maxSide), file, '--out', tmp], { stdio: 'ignore' });
        return { data: fs.readFileSync(tmp).toString('base64'), mimeType: 'image/jpeg' };
      } catch {
        const ext = path.extname(file).toLowerCase();
        return { data: fs.readFileSync(file).toString('base64'), mimeType: ext === '.png' ? 'image/png' : 'image/jpeg' };
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* */ }
      }
    }
  };
}
