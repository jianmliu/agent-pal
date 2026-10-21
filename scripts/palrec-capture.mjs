#!/usr/bin/env node
/**
 * 把回放的观战页录成视频:整个页面(游戏画面 + 小地图 + 解说 / 操作时间线 + 状态栏),逐帧截,不掉帧(src/replay-capture.mjs)。
 *
 *   node scripts/palrec-capture.mjs <文件.palrec> -o out.mp4
 *        [--script 主播台词.jsonl]     解说用台词本里对好的时刻(同 palrec-replay.mjs)
 *        [--from 毫秒] [--to 毫秒]     截一段:距开录的毫秒数
 *        [--fps 30] [--size 1920x1080]
 *        [--music-dir 目录] [--no-audio]   声音 = 游戏的音效 + 音乐(同 palrec-export.mjs);解说的配音不在这里合 ——
 *                                          按章节出带解说的成品用 commentary-chapters.mjs --page --mux
 * 要 playwright 的 chromium 和 ffmpeg。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startReplay } from '../src/replay.mjs';
import { openCapture } from '../src/replay-capture.mjs';
import { exportVideo } from './palrec-export.mjs';

const argv = process.argv.slice(2);
const VALUE = ['-o', '--script', '--from', '--to', '--fps', '--size', '--music-dir'];
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const file = argv.find((a, i) => !a.startsWith('-') && !VALUE.includes(argv[i - 1]));
if (!file) { process.stderr.write('usage: palrec-capture.mjs <file.palrec> -o out.mp4 [--script 主播台词.jsonl] [--from ms] [--to ms] [--fps 30] [--size 1920x1080] [--music-dir DIR] [--no-audio]\n'); process.exit(2); }
const out = flag('-o', file.replace(/\.palrec$/, '') + '.page.mp4');
const [width, height] = String(flag('--size', '1920x1080')).split('x').map(Number);
const fps = Math.max(1, Number(flag('--fps', 30)) || 30), fromMs = Math.max(0, Number(flag('--from', 0)) || 0);
const log = (s) => process.stderr.write(s + '\n');

const srv = await startReplay({ files: [file], port: 0, script: flag('--script', null), log: () => {} });
let cap; try { cap = await openCapture({ base: `http://127.0.0.1:${srv.port}`, width, height, log }); } catch (err) { log(`palrec-capture: ${err.message}`); srv.close(); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palcap-'));
let code = 0;
try {
  const rec = srv.recs[0].rec, toMs = Math.min(Number(flag('--to', rec.durationMs)) || rec.durationMs, rec.durationMs);
  const audio = !argv.includes('--no-audio'), pageOut = audio ? path.join(tmp, 'page.mp4') : out;
  const t0 = Date.now();
  const r = await cap.capture({ rec: 0, fromMs, toMs, out: pageOut, fps, onProgress: (k, n) => log(`  ${Math.round(k / n * 100)}%`) });
  if (audio) {
    // 声音:借转视频那条路出一份(画面缩到最小,只要它的音轨),再和整页画面合
    const game = path.join(tmp, 'game.mp4');
    await exportVideo(rec, { out: game, scale: 1, fps: 2, fromMs, toMs, musicDir: flag('--music-dir', process.env.AGENT_PAL_MUSIC_DIR || null) });
    const ok = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', pageOut, '-i', game, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', out], { stdio: ['ignore', 'ignore', 'inherit'] }).status === 0;
    if (!ok) throw new Error('合声音失败');
  }
  log(`${out}: ${(r.durationMs / 1000).toFixed(1)}s,${r.frames} 帧(实际截图 ${r.shots} 张),用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) { log(`palrec-capture: ${err.message}`); code = 1; }
finally { await cap.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
process.exit(code);
