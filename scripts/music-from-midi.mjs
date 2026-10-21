#!/usr/bin/env node
/**
 * 把游戏音乐的 MIDI(001.mid … 087.mid,曲号 = 文件名)渲染成 <曲号>.mp3 —— 引擎 / 观战页 / palrec-export 认的名字。
 *
 *   node scripts/music-from-midi.mjs --midi <MIDI 目录> --out <输出目录> [--bitrate 128k] [--tail 1] [--force]
 *
 * 只在 macOS 上能用:用系统自带的 GM 音色库离线合成(render-midi.swift),再用 ffmpeg 压成 MP3。要 swift(Xcode 命令行工具)和 ffmpeg。
 * 用法:
 *   - 转视频:palrec-export.mjs --music-dir <输出目录>
 *   - 观战页 / 远程屏幕出音乐:把输出目录放成资源目录下的 MP3/(页面按 <资源>/MP3/<曲号>.mp3 取)
 * 音乐是游戏素材,渲染出来的文件同样不进仓库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const say = (s) => process.stderr.write(s + '\n');
const midiDir = opt('--midi'), outDir = opt('--out'), bitrate = opt('--bitrate') || '128k', tail = opt('--tail') || '1', force = argv.includes('--force');
if (!midiDir || !outDir) { say('usage: music-from-midi --midi <dir with NNN.mid> --out <dir> [--bitrate 128k] [--tail 1] [--force]'); process.exit(2); }
if (process.platform !== 'darwin') { say('music-from-midi: macOS only (uses the system GM sound bank). Elsewhere render the MIDI files with any synth and name them <n>.mp3.'); process.exit(1); }
for (const tool of ['swiftc', 'ffmpeg']) if (spawnSync(tool, ['--version']).status !== 0 && spawnSync(tool, ['-version']).status !== 0) { say(`music-from-midi: ${tool} not found`); process.exit(1); }

const files = fs.readdirSync(midiDir).filter((f) => /^\d+\.mid$/i.test(f)).sort();
if (!files.length) { say(`no NNN.mid files in ${midiDir}`); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-midi-'));
try {
  const bin = path.join(tmp, 'render-midi');
  const cc = spawnSync('swiftc', ['-O', '-o', bin, path.join(here, 'render-midi.swift')], { encoding: 'utf8' });
  if (cc.status !== 0) { say(`swiftc failed:\n${cc.stderr}`); process.exit(1); }
  let done = 0, skipped = 0, failed = 0, seconds = 0;
  for (const f of files) {
    const n = Number(f.replace(/\.mid$/i, '')), out = path.join(outDir, `${n}.mp3`);
    if (!force && fs.existsSync(out)) { skipped++; continue; }
    const wav = path.join(tmp, `${n}.wav`);
    const r = spawnSync(bin, [path.join(midiDir, f), wav, tail], { encoding: 'utf8' });
    if (r.status !== 0) { failed++; say(`${f}: ${r.stderr.trim() || 'render failed'}`); continue; }
    const e = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', bitrate, out], { encoding: 'utf8' });
    fs.rmSync(wav, { force: true });
    if (e.status !== 0) { failed++; say(`${f}: ffmpeg: ${e.stderr.trim()}`); continue; }
    done++; seconds += Number(r.stdout) || 0;
  }
  say(`music-from-midi: ${done} rendered (${Math.round(seconds / 60)} min of music), ${skipped} already there, ${failed} failed → ${outDir}`);
  process.exit(failed ? 1 : 0);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
