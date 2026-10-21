#!/usr/bin/env node
/**
 * 回放文件(.palrec,pal-host --record 录的)→ 视频。需要 ffmpeg。
 *
 *   node scripts/palrec-export.mjs <文件.palrec> [-o out.mp4] [--scale 4] [--fps 30]
 *        [--from 毫秒] [--to 毫秒]            截一段:距开录的毫秒数
 *        [--from-t 时刻] [--to-t 时刻]        截一段:Date.now() 那种绝对时刻(同运行日志里事件的 t)
 *        [--music-dir 目录]                   游戏音乐 <曲号>.mp3 放在哪;不给或缺文件就没有音乐(音效照样有)
 *        [--no-audio]                         只出画面
 *        [--crf 18] [--preset veryfast]       x264 的质量 / 速度
 *   node scripts/palrec-export.mjs <文件.palrec> --info     只看文件头、时长、各类记录数(JSON)
 *
 * 画面:按固定帧率重新取样(每个输出时刻显示当时最新的一帧),整数倍最近邻放大(像素不糊)。
 * 声音:音效的波形录在文件里,按事件的时刻混成一条 44.1kHz 的轨;音乐按「切歌 / 停」事件从 --music-dir 取 MP3 叠上去。
 * 输出的第 0 秒 = --from(默认是开录那一刻);文件头的 startT 是开录时的 Date.now(),和运行日志对时间用它。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openRecording, REC_FRAME, REC_PALETTE, REC_AUDIO, REC_SAMPLE } from '../src/palrec.mjs';

const RATE = 44100;
const MUSIC_VOLUME = 0.6;        // 音乐垫在音效下面

/** WAV(16 位 PCM)→ { sampleRate, mono: Float32Array } */
export function readWav(wav) {
  if (wav.length < 44 || wav.toString('latin1', 0, 4) !== 'RIFF') return null;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= wav.length) {
    const id = wav.toString('latin1', off, off + 4), len = wav.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: wav.readUInt16LE(off + 10), sampleRate: wav.readUInt32LE(off + 12), bits: wav.readUInt16LE(off + 22) };
    else if (id === 'data') data = wav.subarray(off + 8, Math.min(wav.length, off + 8 + len));
    off += 8 + len + (len & 1);
  }
  if (!fmt || !data || fmt.bits !== 16 || !fmt.channels) return null;
  const n = Math.floor(data.length / 2 / fmt.channels), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2); mono[i] = s / fmt.channels / 32768; }
  return { sampleRate: fmt.sampleRate, mono };
}

/** 把 [fromMs, toMs) 里的音效按时刻混成一条单声道 16 位 WAV(Buffer);没有音效也给一条等长的静音(方便后面对齐) */
export function mixSfx(rec, fromMs, toMs) {
  const total = Math.max(1, Math.round((toMs - fromMs) / 1000 * RATE)), out = new Float32Array(total);
  const samples = new Map();
  for (const [n, wav] of rec.samples()) { const w = readWav(wav); if (w) samples.set(n, w); }
  let used = 0;
  for (const ev of rec.audio()) {
    if (!('sfx' in ev)) continue;
    const w = samples.get(ev.sfx); if (!w) continue;
    const step = w.sampleRate / RATE, lenOut = Math.floor(w.mono.length / step);
    const at = Math.round((ev.t - fromMs) / 1000 * RATE);             // 截取起点之前响起、还没放完的也接上尾巴
    if (at >= total || at + lenOut <= 0) continue;
    used++;
    for (let i = Math.max(0, -at); i < lenOut && at + i < total; i++) {
      const p = i * step, k = Math.floor(p), f = p - k;                // 线性插值换采样率
      out[at + i] += w.mono[k] * (1 - f) + (w.mono[k + 1] ?? w.mono[k]) * f;
    }
  }
  const wav = Buffer.alloc(44 + total * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) wav.writeInt16LE(Math.round(Math.tanh(out[i]) * 32767), 44 + i * 2);   // 好几个音效叠在一起时软削波
  return { wav, used };
}

/** 音乐分段:[{ music, loop, startMs, endMs }](相对截取起点),只留 dir 里有文件的 */
export function musicSegments(rec, fromMs, toMs, dir) {
  const segs = [];
  let cur = null;
  const close = (t) => { if (cur && t > cur.startMs) segs.push({ ...cur, endMs: t }); cur = null; };
  for (const ev of rec.audio()) {
    if (!('music' in ev)) continue;
    close(ev.t);
    if (ev.music > 0) cur = { music: ev.music, loop: ev.loop !== false, startMs: ev.t };
  }
  close(Infinity);
  return segs
    .map((s) => ({ ...s, file: dir ? path.join(dir, `${s.music}.mp3`) : null }))
    .filter((s) => s.file && fs.existsSync(s.file) && s.endMs > fromMs && s.startMs < toMs)
    // 截取起点之前就在放的:从截取起点接着放(从曲子的那个位置起)
    .map((s) => ({ ...s, skipMs: Math.max(0, fromMs - s.startMs), atMs: Math.max(0, s.startMs - fromMs), durMs: Math.min(s.endMs, toMs) - Math.max(s.startMs, fromMs) }));
}

export function info(rec) {
  const count = (type) => rec.records.filter((r) => r.type === type).length;
  const audio = rec.audio();
  return {
    file: rec.file, meta: rec.meta, truncated: rec.truncated, durationMs: rec.durationMs, bytes: fs.statSync(rec.file).size,
    frames: count(REC_FRAME), palettes: count(REC_PALETTE), audioEvents: count(REC_AUDIO), sfxSamples: count(REC_SAMPLE),
    sfx: audio.filter((e) => 'sfx' in e).length, music: [...new Set(audio.filter((e) => e.music > 0).map((e) => e.music))]
  };
}

/** 转视频。opts:{ out, scale, fps, fromMs, toMs, musicDir, audio, crf, preset, ffmpeg, log };返回 { out, frames, durationMs, sfx, music } */
export async function exportVideo(rec, opts = {}) {
  const { out, scale = 4, fps = 30, musicDir = null, audio = true, crf = 18, preset = 'veryfast', ffmpeg = 'ffmpeg', log = () => {} } = opts;
  const fromMs = Math.max(0, opts.fromMs ?? 0), toMs = Math.min(rec.durationMs + 1000 / fps, opts.toMs ?? Infinity);
  if (!(toMs > fromMs)) throw new Error(`nothing to export: from ${fromMs}ms to ${toMs}ms (recording is ${rec.durationMs}ms)`);
  const W = rec.width, H = rec.height, total = Math.max(1, Math.round((toMs - fromMs) / 1000 * fps));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palrec-'));
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-framerate', String(fps), '-i', 'pipe:0'];
  let sfxUsed = 0, segs = [];
  const filters = [`[0:v]scale=${W * scale}:${H * scale}:flags=neighbor[v]`];
  if (audio) {
    const mix = mixSfx(rec, fromMs, toMs); sfxUsed = mix.used;
    const sfxFile = path.join(tmp, 'sfx.wav'); fs.writeFileSync(sfxFile, mix.wav);
    args.push('-i', sfxFile);
    segs = musicSegments(rec, fromMs, toMs, musicDir);
    const labels = ['[1:a]'];
    segs.forEach((s, k) => {
      args.push(...(s.loop ? ['-stream_loop', '-1'] : []), '-ss', (s.skipMs / 1000).toFixed(3), '-t', (s.durMs / 1000).toFixed(3), '-i', s.file);
      filters.push(`[${k + 2}:a]aresample=${RATE},volume=${MUSIC_VOLUME},adelay=${Math.round(s.atMs)}:all=1[m${k}]`);
      labels.push(`[m${k}]`);
    });
    filters.push(labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first[a]` : '[1:a]anull[a]');
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k'] : []),
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', (total / fps).toFixed(3), out);

  const ff = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => { ff.on('error', reject); ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(-400)}`)))); });
  ff.stdin.on('error', () => {});                                     // ffmpeg 先退了:错误从 close 那边报
  const write = (buf) => (ff.stdin.write(buf) ? null : new Promise((r) => ff.stdin.once('drain', r)));

  // 把「画面变了」的时刻展开成固定帧率:第 i 帧显示时刻 fromMs + i / fps 时最新的画面
  const rgb = Buffer.alloc(W * H * 3), lut = Buffer.alloc(768);
  let have = false, written = 0;
  const paint = ({ indices, palette, shake }) => {
    palette.copy(lut);
    for (let y = 0, o = 0; y < H; y++) {
      const sy = y + shake;                                           // 同观战页:正 = 内容上移,露出来的地方涂黑
      if (sy < 0 || sy >= H) { rgb.fill(0, o, o + W * 3); o += W * 3; continue; }
      for (let x = 0, s = sy * W; x < W; x++, o += 3) { const c = indices[s + x] * 3; rgb[o] = lut[c]; rgb[o + 1] = lut[c + 1]; rgb[o + 2] = lut[c + 2]; }
    }
    have = true;
  };
  const upTo = async (t) => {                                         // 把时刻 < t 的输出帧都写掉(用当前画面)
    const n = Math.min(total, Math.ceil((t - fromMs) / 1000 * fps));
    while (written < n) { const p = write(have ? Buffer.from(rgb) : Buffer.alloc(W * H * 3)); written++; if (p) await p; if (written % (fps * 60) === 0) log(`  ${Math.round(written / fps)}s / ${Math.round(total / fps)}s`); }
  };
  for (const f of rec.changes({ fromMs, toMs })) { await upTo(f.t + 0.001); paint(f); }   // 时刻恰好等于 f.t 的那一帧已经用上新画面
  await upTo(Infinity);
  ff.stdin.end();
  try { await done; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { out, frames: written, durationMs: Math.round(written / fps * 1000), sfx: sfxUsed, music: segs.map((s) => s.music) };
}

// ---- 命令行 ----
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const argv = process.argv.slice(2), say = (s) => process.stderr.write(s + '\n');
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (k) => { const v = opt(k); if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n)) { say(`${k}: not a number: ${v}`); process.exit(2); } return n; };
  const valued = new Set(['-o', '--scale', '--fps', '--from', '--to', '--from-t', '--to-t', '--music-dir', '--crf', '--preset', '--ffmpeg']);
  const file = argv.find((a, i) => !a.startsWith('-') && !valued.has(argv[i - 1]));
  if (!file) { say('usage: palrec-export <file.palrec> [-o out.mp4] [--scale 4] [--fps 30] [--from ms] [--to ms] [--from-t t] [--to-t t] [--music-dir DIR] [--no-audio] | --info'); process.exit(2); }
  let rec;
  try { rec = openRecording(file); } catch (err) { say(err.message); process.exit(1); }
  if (argv.includes('--info')) { process.stdout.write(JSON.stringify(info(rec), null, 2) + '\n'); process.exit(0); }
  const scale = num('--scale') ?? 4, fps = num('--fps') ?? 30;
  if (!Number.isInteger(scale) || scale < 1 || scale > 12) { say('--scale: an integer 1–12'); process.exit(2); }
  if (!(fps >= 1 && fps <= 120)) { say('--fps: 1–120'); process.exit(2); }
  const abs = (k) => { const t = num(k); return t === undefined ? undefined : t - rec.meta.startT; };
  const out = opt('-o') || file.replace(/\.palrec$/i, '') + '.mp4';
  const t0 = Date.now();
  try {
    const r = await exportVideo(rec, { out, scale, fps, fromMs: num('--from') ?? abs('--from-t'), toMs: num('--to') ?? abs('--to-t'), musicDir: opt('--music-dir') || null,
      audio: !argv.includes('--no-audio'), crf: num('--crf') ?? 18, preset: opt('--preset') || 'veryfast', ffmpeg: opt('--ffmpeg') || 'ffmpeg', log: say });
    say(`${r.out}: ${(r.durationMs / 1000).toFixed(1)}s, ${r.frames} frames at ${fps} fps, ${rec.width * scale}×${rec.height * scale}, ${r.sfx} sound effects`
      + `${r.music.length ? `, music ${[...new Set(r.music)].join(' ')}` : ', no music'}${rec.truncated ? ' (recording ends mid-record: the process was killed)' : ''} — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) { say(`export failed: ${err.message}`); process.exit(1); }
}
