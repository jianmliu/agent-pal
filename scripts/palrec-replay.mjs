#!/usr/bin/env node
/**
 * 回放观战页:把录下来的一局(.palrec,pal-host --record 录的)在观战页上照当时的时间线重放 —— 画面、声音、时间线、
 * 状态栏、小地图都在,能暂停、拖动、换倍速(src/replay.mjs)。不起引擎、不要游戏资产。
 *
 *   node scripts/palrec-replay.mjs <文件.palrec | 目录>… [--port 8096]
 *        [--script 主播台词.jsonl]   解说改用台词本里对好的时刻和配音(不给就放录像里当时到的那份)
 *        [--voice-dir 目录]          解说配音 .m4a 放在哪(同 AGENT_PAL_VOICE_DIR)
 *        [--music-dir 目录]          游戏音乐 <曲号>.mp3 放在哪(同 AGENT_PAL_MUSIC_DIR)
 *
 * 然后浏览器开 http://127.0.0.1:8096/replay 。地址上可以带 ?rec=第几轮&t=从第几秒开始&rate=倍速&paused&autostart;
 * ?capture 去掉回放条和调试行(录屏用)。目录 = 里面所有的 .palrec(连跑的几轮),按开录时间排成一张播放单。
 */
import fs from 'node:fs';
import path from 'node:path';
import { startReplay } from '../src/replay.mjs';

const argv = process.argv.slice(2);
const VALUE = ['--port', '--script', '--voice-dir', '--music-dir'];
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const inputs = argv.filter((a, i) => !a.startsWith('--') && !VALUE.includes(argv[i - 1]));
const files = inputs.flatMap((p) => {
  if (!fs.statSync(p).isDirectory()) return [p];
  const walk = (d, depth) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (depth > 0 && !e.name.startsWith('.') && e.name !== 'node_modules' ? walk(path.join(d, e.name), depth - 1) : []) : e.name.endsWith('.palrec') ? [path.join(d, e.name)] : []));
  return walk(p, 3);
});
if (!files.length) { process.stderr.write('usage: palrec-replay.mjs <file.palrec | dir>… [--port 8096] [--script 主播台词.jsonl] [--voice-dir DIR] [--music-dir DIR]\n'); process.exit(2); }

await startReplay({
  files, port: Number(flag('--port', 8096)), script: flag('--script', null),
  voiceDir: flag('--voice-dir', process.env.AGENT_PAL_VOICE_DIR || ''), musicDir: flag('--music-dir', process.env.AGENT_PAL_MUSIC_DIR || '')
});
