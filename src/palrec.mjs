/**
 * 回放文件(.palrec):pal-host 把游戏画面和声音事件边跑边录下来,事后随时能转成视频(scripts/palrec-export.mjs)。
 *
 * 实时模式的一局事后没法靠重放操作复现画面,所以直接录 host 发给观众的那份:320×200 的调色板索引帧 + 调色板
 * (同线路上的增量编码,无损、很小),外加音效 / 音乐事件。音效的波形第一次响的时候也存一份,文件自己就能出声;
 * 音乐只记「切到第几首 / 停」,素材(MP3)转视频时另给。
 *
 * 文件 = 8 字节文件头 "PALREC1\n" + 一串记录,只追加、每条写完就落盘(进程被杀也读得出来,最多丢最后半条):
 *   [u8 类型][u32 距开录的毫秒数][u32 载荷长度][载荷]        (小端)
 *   1 META     JSON:{ v, startT(开录时的 Date.now(),同运行日志的 t), w, h, fps, … }—— 第一条
 *   2 PALETTE  [u8 编码][数据]        768 字节 RGB;编码同 host.mjs 的 encodeDelta(1 整份 / 2 与上一份异或)
 *   3 FRAME    [i8 震屏][u8 编码][数据]  w×h 字节的调色板索引;编码 3 = [i8 dx][i8 dy] + 与「挪了 (dx, dy) 的上一帧」异或
 *                                      (走路时整屏滚动,见 estimateShift)
 *   4 AUDIO    JSON:{ sfx: n } | { music: n, loop } | { music: 0 }(停)
 *   5 SAMPLE   [u16 音效号][WAV 文件]   这个音效的波形(每个号存一次)
 *   6 PAGE     JSON:host 发给观战页的一条消息(t = live / status / map / speed)—— 回放观战页用(replay.mjs),转视频时不看
 *   7 ASSET    [u16 名字长度][名字][文件]  页面要取的文件(小地图底图 minimap/<场景>-<版本>-<plan|art>.png;每个名字存一次)
 * 每隔 KEY_EVERY_MS 调色板和帧各写一次整份(关键帧):从中间截一段不用从头解,坏了一条也只影响到下一个关键帧。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

export const MAGIC = Buffer.from('PALREC1\n');
export const REC_META = 1, REC_PALETTE = 2, REC_FRAME = 3, REC_AUDIO = 4, REC_SAMPLE = 5, REC_PAGE = 6, REC_ASSET = 7;
const ENC_KEY = 1, ENC_XOR = 2, ENC_SHIFT = 3;
const KEY_EVERY_MS = 10000;
const deflate = (b) => zlib.deflateRawSync(b, { level: 6 });     // 实测连估位移一起每帧约 0.65ms;比 level 1 小 13%

/**
 * 走路时整屏在滚动,直接和上一帧异或几乎每个像素都不一样(实测一帧 13KB)。先估一下这一帧相对上一帧整体挪了多少
 * (dx, dy),和「挪过以后的上一帧」异或,剩下的只有人物和新露出来的边(约 1/5)。
 * 候选:沿斜 45° 的四个走路方向 (2k, ±k),以及纯横 / 纯竖(过场里镜头平移);在一组固定的采样点上数不相同的像素。
 */
const SHIFTS = (() => { const out = []; for (let k = -32; k <= 32; k++) { if (!k) continue; out.push([2 * k, k], [2 * k, -k], [k, 0], [0, k]); } return out; })();
function sampleGrid(w, h) { const pts = []; for (let y = 7; y < h; y += 13) for (let x = 5 + (y % 3) * 3; x < w; x += 11) pts.push(x, y); return pts; }
const grids = new Map();
/** 返回 [dx, dy]:cur(x, y) ≈ ref(x + dx, y + dy);估不出明显更好的就是 [0, 0] */
export function estimateShift(cur, ref, w, h) {
  let pts = grids.get(w * 4096 + h); if (!pts) grids.set(w * 4096 + h, pts = sampleGrid(w, h));
  const miss = (dx, dy) => {
    let bad = 0, n = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1], sx = x + dx, sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      n++; if (cur[y * w + x] !== ref[sy * w + sx]) bad++;
    }
    return n < pts.length / 8 ? 1 : bad / n;
  };
  const still = miss(0, 0);
  if (still < 0.25) return [0, 0];                                     // 没在滚动
  let best = still, at = [0, 0];
  for (const [dx, dy] of SHIFTS) { const m = miss(dx, dy); if (m < best) { best = m; at = [dx, dy]; } }
  return best < still * 0.6 ? at : [0, 0];
}
/** 把 ref 挪 (dx, dy):out(x, y) = ref(x + dx, y + dy),挪出去的地方填 0 */
export function shifted(ref, w, h, dx, dy) {
  const out = Buffer.alloc(w * h);
  const x0 = Math.max(0, -dx), x1 = Math.min(w, w - dx);
  for (let y = Math.max(0, -dy), y1 = Math.min(h, h - dy); y < y1; y++) ref.copy(out, y * w + x0, (y + dy) * w + x0 + dx, (y + dy) * w + x1 + dx);
  return out;
}

/** 整份 / 与上一份异或 / 与挪过的上一份异或(只有帧:给了 w, h 才试),哪个小用哪个(key = 强制整份) */
function encode(cur, ref, key, w = 0, h = 0) {
  if (key || !ref || ref.length !== cur.length) return { enc: ENC_KEY, data: deflate(cur) };
  let base = ref, shift = null;
  if (w && h) { const [dx, dy] = estimateShift(cur, ref, w, h); if (dx || dy) { base = shifted(ref, w, h, dx, dy); shift = Buffer.from(Int8Array.of(dx, dy).buffer); } }
  const x = Buffer.allocUnsafe(cur.length);
  for (let i = 0; i < cur.length; i++) x[i] = cur[i] ^ base[i];
  const xd = deflate(x), delta = shift ? { enc: ENC_SHIFT, data: Buffer.concat([shift, xd]) } : { enc: ENC_XOR, data: xd };
  if (xd.length < cur.length >> 3) return delta;
  const kd = deflate(cur);
  return kd.length < xd.length ? { enc: ENC_KEY, data: kd } : delta;
}

/**
 * 开始录。meta 里的东西原样进文件头那条 META(startT 不给就取现在)。
 * 返回 { file, palette(rgb768), frame(indices, shake), audio(obj), sample(n, wav), stats(), close() };
 * 写盘出错(盘满之类)就停录、报一次,不影响游戏。
 */
export function createRecorder(file, { now = () => Date.now(), onError = null, ...meta } = {}) {
  const startT = meta.startT ?? now(), W = meta.w || 320, H = meta.h || 200;
  let fd = fs.openSync(file, 'w'), bytes = 0, frames = 0, lastPal = null, lastImg = null, palKeyAt = -Infinity, imgKeyAt = -Infinity;
  const samples = new Set(), assets = new Set();
  const write = (type, payload) => {
    if (fd == null) return;
    const head = Buffer.alloc(9);
    head[0] = type; head.writeUInt32LE(Math.max(0, Math.min(0xffffffff, now() - startT)) >>> 0, 1); head.writeUInt32LE(payload.length, 5);
    try { bytes += fs.writeSync(fd, Buffer.concat([head, payload])); }
    catch (err) { try { fs.closeSync(fd); } catch { /* */ } fd = null; onError?.(err); }
  };
  try { bytes += fs.writeSync(fd, MAGIC); } catch (err) { fd = null; onError?.(err); }
  write(REC_META, Buffer.from(JSON.stringify({ v: 1, ...meta, startT })));

  return {
    file, startT,
    /** 调色板(768 字节 RGB);和上一份一样就不写 */
    palette(rgb) {
      const t = now(), key = t - palKeyAt >= KEY_EVERY_MS;
      if (!key && lastPal && rgb.equals(lastPal)) return;
      const { enc, data } = encode(rgb, lastPal, key);
      if (enc === ENC_KEY) palKeyAt = t;
      write(REC_PALETTE, Buffer.concat([Buffer.from([enc]), data])); lastPal = Buffer.from(rgb);
    },
    /** 一帧(调色板索引);和上一帧一样、震屏也没变就不写 */
    frame(indices, shake = 0) {
      const t = now(), key = t - imgKeyAt >= KEY_EVERY_MS, sh = Math.max(-127, Math.min(127, shake | 0));
      if (!key && lastImg && sh === lastImg.shake && indices.equals(lastImg.buf)) return;
      const { enc, data } = encode(indices, lastImg?.buf, key, W, H);
      if (enc === ENC_KEY) imgKeyAt = t;
      const head = Buffer.alloc(2); head.writeInt8(sh, 0); head[1] = enc;
      write(REC_FRAME, Buffer.concat([head, data])); lastImg = { buf: Buffer.from(indices), shake: sh }; frames++;
    },
    audio(obj) { write(REC_AUDIO, Buffer.from(JSON.stringify(obj))); },
    /** 这个音效的波形存过没有 */
    hasSample: (n) => samples.has(n),
    sample(n, wav) {
      if (samples.has(n) || !wav) return;
      samples.add(n);
      const head = Buffer.alloc(2); head.writeUInt16LE(n & 0xffff, 0);
      write(REC_SAMPLE, Buffer.concat([head, wav]));
    },
    /** 发给观战页的一条消息(原样存) */
    page(obj) { write(REC_PAGE, Buffer.from(JSON.stringify(obj))); },
    hasAsset: (name) => assets.has(name),
    /** 页面要取的一个文件(同名只存一次) */
    asset(name, data) {
      const nm = Buffer.from(String(name), 'utf8');
      if (assets.has(name) || !data || nm.length > 512) return;
      assets.add(name);
      const head = Buffer.alloc(2); head.writeUInt16LE(nm.length, 0);
      write(REC_ASSET, Buffer.concat([head, nm, data]));
    },
    stats: () => ({ bytes, frames, recording: fd != null }),
    close() { if (fd != null) { try { fs.closeSync(fd); } catch { /* */ } fd = null; } }
  };
}

/**
 * 读回放文件。返回 { meta, records: [{ type, t, off, len }], … };载荷不先解,要哪条解哪条(decode)。
 * 文件尾巴上没写完的半条(进程被杀)直接忽略。
 */
export function openRecording(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${file}: not a .palrec file`);
  const records = [];
  let off = MAGIC.length, meta = null, truncated = false;
  while (off < buf.length) {
    if (buf.length - off < 9) { truncated = true; break; }
    const type = buf[off], t = buf.readUInt32LE(off + 1), len = buf.readUInt32LE(off + 5);
    if (buf.length - off - 9 < len) { truncated = true; break; }
    if (type === REC_META && !meta) { try { meta = JSON.parse(buf.subarray(off + 9, off + 9 + len).toString('utf8')); } catch { /* */ } }
    else records.push({ type, t, off: off + 9, len });
    off += 9 + len;
  }
  if (!meta) throw new Error(`${file}: no header record`);
  const W = meta.w || 320, H = meta.h || 200;
  const payload = (r) => buf.subarray(r.off, r.off + r.len);
  const isKey = (r) => (r.type === REC_FRAME ? buf[r.off + 1] === ENC_KEY : r.type === REC_PALETTE ? buf[r.off] === ENC_KEY : false);
  const delta = (enc, data, ref, len) => {
    const raw = zlib.inflateRawSync(enc === ENC_SHIFT ? data.subarray(2) : data);
    if (raw.length !== len) throw new Error(`palrec: got ${raw.length} bytes, want ${len}`);
    if (enc === ENC_KEY) return raw;
    if ((enc !== ENC_XOR && enc !== ENC_SHIFT) || !ref) throw new Error(`palrec: delta without a reference (enc ${enc})`);
    const base = enc === ENC_SHIFT ? shifted(ref, W, H, data.readInt8(0), data.readInt8(1)) : ref;
    for (let i = 0; i < len; i++) raw[i] ^= base[i];
    return raw;
  };
  const last = records.length ? records[records.length - 1].t : 0;

  return {
    file, meta, records, truncated, width: W, height: H,
    /** 录了多长(毫秒):最后一条记录的时间 */
    durationMs: last,
    /** 音效 / 音乐事件:[{ t, sfx } | { t, music, loop }] */
    audio() { return records.filter((r) => r.type === REC_AUDIO).map((r) => { try { return { t: r.t, ...JSON.parse(payload(r).toString('utf8')) }; } catch { return null; } }).filter(Boolean); },
    /** 发给观战页的消息:[{ t(毫秒), msg }] */
    pages() { return records.filter((r) => r.type === REC_PAGE).map((r) => { try { return { t: r.t, msg: JSON.parse(payload(r).toString('utf8')) }; } catch { return null; } }).filter(Boolean); },
    /** 页面要取的文件:Map 名字 → Buffer */
    assets() { const m = new Map(); for (const r of records) if (r.type === REC_ASSET && r.len >= 2) { const n = buf.readUInt16LE(r.off); if (r.len >= 2 + n) m.set(buf.subarray(r.off + 2, r.off + 2 + n).toString('utf8'), buf.subarray(r.off + 2 + n, r.off + r.len)); } return m; },
    /** 音效波形:Map 音效号 → WAV(Buffer) */
    samples() { const m = new Map(); for (const r of records) if (r.type === REC_SAMPLE) m.set(buf.readUInt16LE(r.off), payload(r).subarray(2)); return m; },
    /**
     * 按时间顺序放画面:[fromMs, toMs) 里每个「画面变了」的时刻给一个 { t, indices, palette, shake }
     * (indices / palette 是内部缓冲,取下一个时会变,要留就自己拷)。fromMs 之前的状态先给一次(t = fromMs)。
     * 从 fromMs 之前最近的关键帧开始解,不从头解。是个生成器:一小时的录像也不会一次全解进内存。
     */
    *changes({ fromMs = 0, toMs = Infinity } = {}) {
      // 起点:fromMs 之前最后一个「帧关键帧」,以及它之前最后一个「调色板关键帧」
      let start = 0, lastKeyFrame = -1;
      for (let i = 0; i < records.length && records[i].t <= fromMs; i++) if (records[i].type === REC_FRAME && isKey(records[i])) lastKeyFrame = i;
      for (let i = lastKeyFrame; i >= 0; i--) if (records[i].type === REC_PALETTE && isKey(records[i])) { start = i; break; }
      let img = null, pal = null, shake = 0, primed = false;
      for (let i = start; i < records.length; i++) {
        const r = records[i];
        if (r.t >= toMs) break;
        if (r.type !== REC_FRAME && r.type !== REC_PALETTE) continue;
        if (r.t > fromMs && !primed) { primed = true; if (img && pal) yield { t: fromMs, indices: img, palette: pal, shake }; }
        try {
          if (r.type === REC_PALETTE) pal = delta(buf[r.off], buf.subarray(r.off + 1, r.off + r.len), pal, 768);
          else { img = delta(buf[r.off + 1], buf.subarray(r.off + 2, r.off + r.len), img, W * H); shake = buf.readInt8(r.off); }
        } catch { continue; }                      // 坏了一条:跳过,等下一个关键帧接上
        if (r.t > fromMs && img && pal) yield { t: r.t, indices: img, palette: pal, shake };
      }
      if (!primed && img && pal) yield { t: fromMs, indices: img, palette: pal, shake };
    }
  };
}
