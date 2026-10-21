/**
 * 录像:无头引擎每次刷屏的帧(320×200 调色板)→ ffmpeg → mp4,同一套像素即图形版画面。
 *
 *   AGENT_PAL_RECORD=out.mp4      开录;旁边写 out.captions.jsonl(工具调用时间轴,给 record-finish 加字幕)
 *   AGENT_PAL_RECORD_SCALE=3      放大倍数(最近邻,保留像素感)
 *   AGENT_PAL_RECORD_IDLE_MS=1000 画面静止超过这么久就截掉(模型思考时画面不动,不必录进去)
 *
 * 时间轴按游戏时间走(确定性模式是虚拟时钟),输出固定 30fps:每来一帧新画面,把上一帧按它在屏上
 * 停留的时长(封顶 IDLE_MS)重复写出。mp4 用分片格式,进程被杀也能播放已写部分。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const W = 320, H = 200, FPS = 30;

/** 同名文件已存在就编号(out.mp4 → out-2.mp4 …):会话可能重开(session_quit 后客户端重启服务),别覆盖之前录的 */
function freshName(file) {
  if (!fs.existsSync(file)) return file;
  const base = file.replace(/\.mp4$/i, '');
  for (let k = 2; ; k++) if (!fs.existsSync(`${base}-${k}.mp4`)) return `${base}-${k}.mp4`;
}

export function startRecorder(e, file0, opts = {}) {
  const file = freshName(file0);
  const scale = opts.scale ?? (Number(process.env.AGENT_PAL_RECORD_SCALE) || 3);
  const idleMs = opts.idleMs ?? (Number(process.env.AGENT_PAL_RECORD_IDLE_MS) || 1000);
  const now = () => (e.clock ? e.clock.now() : Date.now());
  const capFile = file.replace(/\.mp4$/i, '') + '.captions.jsonl';
  fs.writeFileSync(capFile, '');
  // detached:外层超时杀会话时信号不波及 ffmpeg;我们退出后它读到 stdin EOF 自己收尾
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-vf', `scale=${W * scale}:${H * scale}:flags=neighbor`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', file], { stdio: ['pipe', 'ignore', 'inherit'], detached: true });
  ff.unref();
  let broken = false;
  ff.stdin.on('error', () => { broken = true; });

  let prev = null;            // 上一帧 RGB
  let prevSig = 0;
  let prevStart = 0;          // 上一帧开始显示的游戏时间
  let emitted = 0;            // 已写出的输出帧数
  let closed = false;

  const toRgb = (surface) => {
    const buf = surface.byteBuffer, pal = surface.palette, out = Buffer.allocUnsafe(W * H * 3);
    for (let i = 0, o = 0; i < W * H; i++, o += 3) {
      const c = pal[buf[i]];
      out[o] = c ? c.r : 0; out[o + 1] = c ? c.g : 0; out[o + 2] = c ? c.b : 0;
    }
    return out;
  };
  // FNV-1a over the RGB frame:同一画面反复刷屏不算新帧(调色板渐变会改 RGB,算新帧)
  const sig = (rgb) => { let h = 0x811c9dc5; for (let i = 0; i < rgb.length; i += 7) h = Math.imul(h ^ rgb[i], 0x01000193); return h >>> 0; };
  const shown = (t) => Math.min(Math.max(0, t - prevStart), idleMs);
  const flushPrev = (t) => {
    if (!prev || broken) return;
    const n = Math.max(1, Math.round((shown(t) / 1000) * FPS));
    for (let k = 0; k < n; k++) ff.stdin.write(prev);
    emitted += n;
  };

  function frame(surface) {
    if (closed || !surface?.byteBuffer || !surface.palette) return;
    const rgb = toRgb(surface), s = sig(rgb), t = now();
    if (prev && s === prevSig) return;
    flushPrev(t);
    prev = rgb; prevSig = s; prevStart = t;
  }
  /** 输出时间轴上的「此刻」(秒):已写出的 + 当前帧已显示(封顶)的。 */
  const outTime = () => (emitted + (prev ? Math.round((shown(now()) / 1000) * FPS) : 0)) / FPS;
  function caption(ev) {
    if (closed) return;
    try { fs.appendFileSync(capFile, JSON.stringify({ t: +outTime().toFixed(3), ...ev }) + '\n'); } catch { /* */ }
  }
  /** 写完最后一帧,关 ffmpeg 输入;等它收尾(最多 timeoutMs)。 */
  function close(timeoutMs = 5000) {
    if (closed) return Promise.resolve();
    flushPrev(now() + idleMs);
    closed = true;
    return new Promise((resolve) => {
      const done = () => resolve();
      ff.on('exit', done);
      setTimeout(done, timeoutMs).unref?.();
      try { ff.stdin.end(); } catch { done(); }
    });
  }
  return { frame, caption, close, file, capFile };
}
