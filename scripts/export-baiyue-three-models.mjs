#!/usr/bin/env node
/**
 * Replays and exports the winning Baiyue Cult Leader (拜月教主) Boss battles
 * for the 3 full-clear frontier models (Gemini 4 Argon, GPT-6.1-Sol, Claude Opus 5.5)
 * at 1x normal DOS battle speed (常规速度) with original VOC.MKF sound effects and BGM,
 * then stitches both a sequential video and a 3-way side-by-side comparison video.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readLog } from '../bench/verify.mjs';
import { loadTask } from '../bench/task.mjs';
import { initializeTask, engineOptions, executeTaskTool } from '../bench/start.mjs';
import { createStateTracker } from '../bench/state-view.mjs';
import { createBattleMetrics } from '../bench/battle-metrics.mjs';
import { createRecorder, openRecording } from '../src/palrec.mjs';
import { exportVideo } from './palrec-export.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');
const musicDir = '/Volumes/T7-Data/pal/music-mp3';

const MODELS = [
  {
    key: 'argon',
    title: 'Gemini 4 Argon  ·  7 回合速胜纪录 (第 2 命)',
    sub: '战术：开局补双【五气朝元】稳住血线 + 连续【乾坤一掷】7 回合 0 阵亡击穿 32,760 HP 拜月教主',
    accent: '#d4a017',
    logFile: path.join(rootDir, 'bench/out/agy-cli_gemini-4-argon-B-baiyue-retry/episodes/baiyue-single-origin__s42.jsonl'),
    wipeCallIdx: 21
  },
  {
    key: 'gpt61',
    title: 'GPT-6.1-Sol  ·  14 回合初见一命胜 (第 1 命 0 团灭)',
    sub: '战术：全场唯一初见 1 命通关 · 3 颗【隐蛊】维持 9 回合全队隐身 + 4 发【酒神】+ 天罡战气剑神收官',
    accent: '#4da3ff',
    logFile: path.join(rootDir, 'bench/out/codex-cli_gpt-6.1-sol-B-baiyue/episodes/baiyue-single-origin__s42.jsonl'),
    wipeCallIdx: 0
  },
  {
    key: 'opus55',
    title: 'Claude Opus 5.5  ·  17 回合零先验胜 (第 4 命 · 0 次乾坤一掷)',
    sub: '战术：笔试不知道【乾坤一掷】，全程分文未花，自研群攻仙术清掉双护卫后稳扎稳打磨穿拜月教主',
    accent: '#5ce096',
    logFile: path.join(rootDir, 'bench/out/claude-cli_claude-opus-5-5-B-baiyue-retry/episodes/baiyue-single-origin__s42.jsonl'),
    wipeCallIdx: 111
  }
];

function pcmToWav({ sampleRate, channels, samples }) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

const paletteRgb = (pal) => {
  const b = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    const c = pal?.[i] || { r: 0, g: 0, b: 0 };
    b[i * 3] = c.r; b[i * 3 + 1] = c.g; b[i * 3 + 2] = c.b;
  }
  return b;
};

if (process.argv[2] === '--child') {
  const job = JSON.parse(process.argv[3]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baiyue-rec-'));
  const savesFile = path.join(tmp, 'saves.json');
  process.env.AGENT_PAL_SAVES = savesFile;

  const orig = readLog(job.logFile);
  const task = loadTask(orig.start.task);
  const gz = fs.readFileSync(path.join(rootDir, 'bench/saves', task.start.saves));
  fs.writeFileSync(savesFile, zlib.gunzipSync(gz));

  const { bootEngine } = await import('../src/engine.mjs');
  const { createAgent } = await import('../src/agent.mjs');
  const { runTool } = await import('../src/tools.mjs');

  const e = await bootEngine({ seed: orig.start.seed, savesFile, log: () => {}, ...engineOptions(task) });
  const sound = (await import('@onchainpal/game-engine/js/pal/sound')).default;
  const music = (await import('@onchainpal/game-engine/js/pal/music')).default;
  const resourceService = (await import('@onchainpal/game-engine/services/resource-service')).default;
  const { decodeSoundChunk } = await import('@onchainpal/game-engine/services/voc');
  const a = createAgent(e, { memoryFile: null, hints: 'standard' });
  const battleMetrics = createBattleMetrics(e);
  const tracker = createStateTracker(e, a, { battleMetrics });

  // Scale deterministic engine clock by 1.7x so battle frames play at 1x original DOS speed (~24fps battle cadence)
  // and add a natural 350ms pause at each command prompt so the viewer can see menu transitions clearly.
  let pauseOffsetMs = 0;
  const now1x = () => Math.round(e.clock.now() * 1.7 + pauseOffsetMs);

  const rec = createRecorder(job.palrecFile, { now: now1x, w: 320, h: 200, fps: 30 });
  const sfxPromises = [];
  const sfxCache = new Map();
  const loadSfxWav = async (n) => {
    if (sfxCache.has(n)) return sfxCache.get(n);
    const usable = (m) => m && typeof m.readChunk === 'function' && m.getChunkCount() > 0;
    let mkf = resourceService.getMKF('VOC');
    if (!usable(mkf)) mkf = await resourceService.loadMKF('VOC');
    if (!usable(mkf) || n >= mkf.getChunkCount()) return null;
    const raw = mkf.readChunk(n);
    const pcm = raw && decodeSoundChunk(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
    const wav = pcm ? pcmToWav(pcm) : null;
    sfxCache.set(n, wav);
    return wav;
  };

  const origSfx = sound.play.bind(sound), origPlay = music.play.bind(music), origStop = music.stop.bind(music);
  sound.play = (n, ...rest) => {
    if (n > 0) {
      rec.audio({ sfx: n });
      if (!rec.hasSample(n)) {
        sfxPromises.push(loadSfxWav(n).then((wav) => { if (wav) rec.sample(n, wav); }).catch(() => {}));
      }
    }
    return origSfx(n, ...rest);
  };
  music.play = (track, loop = true, ...rest) => {
    rec.audio({ music: track | 0, loop: loop !== false });
    return origPlay(track, loop, ...rest);
  };
  music.stop = (...rest) => {
    rec.audio({ music: 0 });
    return origStop(...rest);
  };

  let lastFrameSurface = null;
  e.probes.onFrame = (s, sh = 0) => {
    if (!s?.byteBuffer || !s.palette) return;
    lastFrameSurface = s;
    rec.palette(paletteRgb(s.palette));
    rec.frame(Buffer.from(s.byteBuffer.subarray(0, 320 * 200)), sh);
  };

  await initializeTask({ e, a, task, runTool, tracker });
  let winStartMs = now1x();

  for (const c of orig.calls) {
    if (c.name !== 'observe') {
      pauseOffsetMs += 280;
      if (lastFrameSurface) {
        rec.palette(paletteRgb(lastFrameSurface.palette));
        rec.frame(Buffer.from(lastFrameSurface.byteBuffer.subarray(0, 320 * 200)), 0);
      }
    }
    await executeTaskTool({ e, a, task, runTool }, c.name, c.args || {});
    if (c.i === job.wipeCallIdx) {
      winStartMs = now1x();
      // Re-emit current music & keyframe at winStartMs so the trimmed segment has BGM + initial frame
      rec.audio({ music: 4, loop: true });
      if (lastFrameSurface) {
        rec.palette(paletteRgb(lastFrameSurface.palette));
        rec.frame(Buffer.from(lastFrameSurface.byteBuffer.subarray(0, 320 * 200)), 0);
      }
    }
  }

  // Hold final victory frame for 2.5 seconds
  pauseOffsetMs += 2500;
  if (lastFrameSurface) {
    rec.palette(paletteRgb(lastFrameSurface.palette));
    rec.frame(Buffer.from(lastFrameSurface.byteBuffer.subarray(0, 320 * 200)), 0);
  }
  await Promise.all(sfxPromises);
  const endMs = now1x();
  rec.close();

  const opened = openRecording(job.palrecFile);
  await exportVideo(opened, {
    out: job.rawMp4,
    scale: 3,
    fps: 30,
    fromMs: Math.max(0, winStartMs - 200),
    toMs: endMs,
    musicDir: fs.existsSync(musicDir) ? musicDir : null,
    audio: true,
    crf: 18,
    preset: 'veryfast'
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  process.stderr.write(`[export-baiyue] ${job.key}: exported ${(endMs - winStartMs) / 1000}s → ${job.rawMp4}\n`);
  process.exit(0);
}

const outDir = path.join(rootDir, 'bench/out/videos');
fs.mkdirSync(outDir, { recursive: true });

const labeledClips = [];
for (const m of MODELS) {
  const palrecFile = path.join(outDir, `${m.key}-baiyue.palrec`);
  const rawMp4 = path.join(outDir, `${m.key}-raw.mp4`);
  const bannerPng = path.join(outDir, `${m.key}-banner.png`);
  const labeledMp4 = path.join(outDir, `${m.key}-labeled.mp4`);
  if (!fs.existsSync(rawMp4)) {
    process.stderr.write(`[1/3] Replaying & rendering 1x normal-speed battle for ${m.key}...\n`);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', JSON.stringify({ ...m, palrecFile, rawMp4 })], {
      stdio: ['ignore', 'inherit', 'inherit']
    });
    if (r.status !== 0) throw new Error(`Child failed for ${m.key}`);
  } else {
    process.stderr.write(`[1/3] Reusing existing ${rawMp4}...\n`);
  }

  // Generate 960x64 Chinese + English header PNG via Pillow
  const py = `
from PIL import Image, ImageDraw, ImageFont
import sys
W, H = 960, 64
img = Image.new("RGB", (W, H), (22, 22, 21))
draw = ImageDraw.Draw(img)
draw.rectangle([0, 0, 8, H], fill="${m.accent}")
draw.line([(0, H-1), (W, H-1)], fill=(60, 58, 54), width=1)
font_paths = ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]
f_title = f_sub = ImageFont.load_default()
for fp in font_paths:
    try:
        f_title = ImageFont.truetype(fp, 21)
        f_sub = ImageFont.truetype(fp, 14)
        break
    except Exception:
        pass
draw.text((22, 8), ${JSON.stringify(m.title)}, font=f_title, fill=(245, 245, 240))
draw.text((22, 38), ${JSON.stringify(m.sub)}, font=f_sub, fill=(185, 183, 176))
img.save(${JSON.stringify(bannerPng)})
`;
  const pr = spawnSync('python3', ['-c', py], { stdio: 'inherit' });
  if (pr.status !== 0) throw new Error(`Banner generation failed for ${m.key}`);

  const ff = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', rawMp4,
    '-i', bannerPng,
    '-filter_complex', '[0:v]pad=960:664:0:64:color=#161615[bg];[bg][1:v]overlay=0:0[v]',
    '-map', '[v]', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    labeledMp4
  ], { stdio: 'inherit' });
  if (ff.status !== 0) throw new Error(`ffmpeg banner failed for ${m.key}`);
  labeledClips.push(labeledMp4);
}

// 1) Sequential stitched video (Argon -> GPT-6.1-Sol -> Claude Opus 5.5)
const concatList = path.join(outDir, 'concat.txt');
fs.writeFileSync(concatList, labeledClips.map((f) => `file '${f}'`).join('\n') + '\n');
const seqOut = path.join(rootDir, 'baiyue-three-models-sequential.mp4');
process.stderr.write(`[2/3] Stitching sequential video → ${seqOut}...\n`);
spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'concat', '-safe', '0', '-i', concatList,
  '-c', 'copy', '-movflags', '+faststart',
  seqOut
], { stdio: 'inherit' });

// 2) 3-way Side-by-Side (hstack) simultaneous comparison video (1920x438)
const sbsOut = path.join(rootDir, 'baiyue-three-models-side-by-side.mp4');
process.stderr.write(`[3/3] Rendering 3-way side-by-side comparison video → ${sbsOut}...\n`);
spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', labeledClips[0],
  '-i', labeledClips[1],
  '-i', labeledClips[2],
  '-filter_complex',
  '[0:v]scale=640:438,tpad=stop_mode=clone:stop_duration=240[v0];' +
  '[1:v]scale=640:438,tpad=stop_mode=clone:stop_duration=240[v1];' +
  '[2:v]scale=640:438[v2];' +
  '[v0][v1][v2]hstack=inputs=3[v]',
  '-map', '[v]', '-map', '2:a',
  '-shortest',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k',
  '-movflags', '+faststart',
  sbsOut
], { stdio: 'inherit' });

process.stderr.write(`Done!\n  Sequential: ${seqOut}\n  Side-by-Side: ${sbsOut}\n`);
