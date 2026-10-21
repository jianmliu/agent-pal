#!/usr/bin/env node
/**
 * agent-pal 启动器。
 *   agent-pal               MCP stdio 服务(给 Claude Code 等 agent 客户端)
 *   agent-pal --http [port] 本地 HTTP JSON-RPC(POST /rpc,默认 8086)
 *   agent-pal --host [port] pal-host 远程屏幕(默认 8090;docs/specs/pal-companion.md P1):浏览器开 http://127.0.0.1:port/ 玩
 *                           同一局;可与 --http 同开(AI 工具接同一个引擎)。实时模式,不要配 --seed
 *                           /watch 是观战页:看 AI 直播(画面 + 每次工具调用 + 聊天 / 弹幕),只看不按
 *   --watch-only            配 --host:所有浏览器都只能看(AI 在玩,不让人误按)
 *   --record [DIR]          配 --host:把画面和声音事件录成回放文件 DIR/<运行日志同名>.palrec(同 AGENT_PAL_RECORD_DIR;
 *                           不给 DIR = 运行日志所在目录)。边录边落盘,进程被杀也读得出来;事后转视频:
 *                           node scripts/palrec-export.mjs <文件> -o out.mp4 --scale 4。AGENT_PAL_RECORD_FPS 调上限(默认 30)
 *   AGENT_PAL_MUSIC_DIR     配 --host:游戏音乐 <曲号>.mp3 所在目录(scripts/music-from-midi.mjs 从 MIDI 渲染);设了页面才有背景音乐
 *   --commentator           配 --host:解说模式(同 AGENT_PAL_LIVE_COMMENTATOR=1)。另有一个解说进程把 AI 刚做的事说给观众
 *                           (POST /live/commentary,可带配音:AGENT_PAL_VOICE_DIR 下的 .m4a),所以不再要求、也不催这个 AI 边玩边说
 *   --player-notes          配 --commentator:请玩的那个 AI 在拿主意的地方留一句笔记(为什么 / 哪里想错了),给解说当素材
 *                           (同 AGENT_PAL_PLAYER_NOTES=1)。默认不开:这段说明可能让开局被模型的安全过滤拦下(Fable 5.1 必现,Sonnet 5.5 偶发)
 *   --chat                  配 --host:观战页上出聊天框 / 弹幕,观众的话 AI 能用 chat 工具读到。默认不开
 *                           (直播走视频网站时观众在那边聊;AI 说的话照样进侧栏)
 *   --flee-grace S          实时模式的难度开关:逃出战斗后 S 秒内怪不能再缠上来(原版是 15 个场景帧,1× 下 1.5 秒)。
 *                           同 AGENT_PAL_FLEE_GRACE;不设 = 原版规则。AI 每步要想几秒,不调的话逃跑后多半立刻被拖回战斗
 *   --speed N               实时模式的游戏倍速:1 = 原版速度(默认),2 = 两倍 …(0.25–8);场景和战斗可分开:--speed scene=2,battle=1;
 *                           fast = 引擎的旧节奏(场景约原版 4 倍)。同 AGENT_PAL_SPEED;运行中可在页面上调,
 *                           或 POST /speed {"x": 2} / {"x": {"scene": 2}}。确定性模式(--seed)不适用
 *   --mcp                   配 --host / --http:同时开 MCP stdio(让 Claude Code 等客户端来玩这一局)
 *   --seed N                确定性模式:虚拟时钟 + 锁步 + 引擎随机数设种(同 AGENT_PAL_SEED)
 *   --assist | --pure       分层(§5.4):assist = L0 + 官方 L1(默认,MVP 体验);pure = 只有 L0 原语
 *   --modules DIR           加载 DIR 下的模块(§5.2,可重复;也可用 AGENT_PAL_MODULES,路径分隔符分开)
 *   agent-pal data dump [--out DIR] [--maps all]   导出原始游戏数据(§5.3「攻略本」,默认 ./pal-data)
 *   --data DIR              模块要读的 data dump(module.yaml 里 data: true);默认 apps/agent-pal/pal-data,没有就先导
 *   --assets DIR            仙剑游戏资源目录(含 PAT.MKF 等;同 PAL_ASSET_DIR)。打包版(npx)必填
 *   --help                  用法
 *
 * 依赖 @onchainpal/game-engine 的 dist/(gitignore)。缺了就给一句能照做的提示,别甩 ERR_MODULE_NOT_FOUND。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGED, userHome } from '../src/paths.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`agent-pal — 让 AI agent 当玩家玩经典《仙剑奇侠传》的 MCP 服务

用法:
  agent-pal --assets <游戏目录>            以 MCP stdio 服务运行(给 Claude Code 等客户端)
  agent-pal --assets <游戏目录> --http 8086  本地 HTTP JSON-RPC(POST /rpc)
  agent-pal --assets <游戏目录> --host 8090  远程屏幕:浏览器开 http://127.0.0.1:8090/ 玩(可再加 --http 让 AI 接同一局)
  claude mcp add pal-live -- npx -y @jianmliu/agent-pal --assets /path/to/PAL --host 8090 --mcp
                                          AI 直播:Claude Code 来玩,浏览器开 http://127.0.0.1:8090/watch 看

接入 Claude Code:
  claude mcp add pal -- npx -y @jianmliu/agent-pal --assets /path/to/PAL

  agent-pal data dump [--out DIR] [--maps all]
                                          导出原始游戏静态数据表 (默认 ./pal-data)
  agent-pal replay <file.palrec|dir> [--port 8096]
                                          浏览器交互式回放观战页 (http://127.0.0.1:8096/replay)
  agent-pal export <file.palrec> [-o out.mp4] [--scale 4]
                                          将 .palrec 录像导出为 MP4 视频
  agent-pal bench <run|baiyue|quiz|check|verify|board|validate> [...]
                                          运行 Agent-PAL-Bench (题库模式 / 拜月通关模式 / 闭卷测验)

选项:
  --assets DIR   你自己的仙剑 DOS 版游戏目录(含 PAT.MKF、MAP.MKF 等),也可用环境变量 PAL_ASSET_DIR
  --seed N       确定性模式(同样的操作得到同样的结果)
  --pure         只给底层原语工具(默认 assist:带寻路、自动练级等高层工具)

环境变量:
  AGENT_PAL_HOME     存档、地图记忆、运行日志放在哪(默认 ~/.agent-pal${PACKAGED ? `,当前 ${userHome()}` : ''})
  AGENT_PAL_HINTS    full(默认,把读脚本得来的提示也告诉 AI)| standard(只给真人玩家看得到的信息)
  AGENT_PAL_GUIDE    攻略文本文件(可选,多个用 ${path.delimiter} 分隔),开启 guide 工具
  AGENT_PAL_ATLAS_INDEX  标注地图索引(可选),开启 atlas 工具
`);
  process.exit(0);
}
const ai = process.argv.indexOf('--assets');
if (ai >= 0 && process.argv[ai + 1]) process.env.PAL_ASSET_DIR = path.resolve(process.argv[ai + 1]);
if (PACKAGED) {
  const d = process.env.PAL_ASSET_DIR;
  if (!d || !(fs.existsSync(path.join(d, 'PAT.MKF')) || fs.existsSync(path.join(d, 'pat.mkf')))) {
    process.stderr.write(`[agent-pal] 找不到仙剑游戏资源${d ? `:${d} 里没有 PAT.MKF` : ''}。\n`
      + '[agent-pal] 用 --assets <目录> 或环境变量 PAL_ASSET_DIR 指向你自己的《仙剑奇侠传》DOS 版游戏目录(含 PAT.MKF、MAP.MKF、SSS.MKF 等)。\n'
      + '[agent-pal] 用法见 agent-pal --help\n');
    process.exit(2);
  }
}

if (process.argv[2] === 'replay') {
  process.argv.splice(2, 1);
  await import('../scripts/palrec-replay.mjs');
  await new Promise(() => {});
}

if (process.argv[2] === 'export') {
  process.argv.splice(2, 1);
  await import('../scripts/palrec-export.mjs');
  process.exit(0);
}

if (process.argv[2] === 'bench') {
  process.argv.splice(2, 1);
  await import('../bench/bench.mjs');
  process.exit(0);
}

// 包的 exports 不含 package.json,直接看 workspace 软链下的 dist(打包版已把引擎打进单文件,不用查)
const engineDist = fileURLToPath(new URL('../node_modules/@onchainpal/game-engine/dist/index.js', import.meta.url));
if (!PACKAGED && !fs.existsSync(engineDist)) {
  process.stderr.write('[agent-pal] 找不到 game-engine 的 dist/ —— 先构建:pnpm --filter @onchainpal/game-engine build\n');
  process.exit(1);
}

if (process.argv[2] === 'data') {
  if (process.argv[3] !== 'dump') { process.stderr.write('usage: agent-pal data dump [--out DIR] [--maps all]\n'); process.exit(2); }
  const flag = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const out = path.resolve(flag('--out', 'pal-data'));
  const { bootEngine } = await import('../src/engine.mjs');
  const { dumpData } = await import('../src/data-dump.mjs');
  const e = await bootEngine();
  const m = await dumpData(e, out, { maps: flag('--maps', 'used') });
  process.stderr.write(`[agent-pal] data dump → ${out}: ${Object.entries(m.counts).map(([k, v]) => `${v} ${k}`).join(', ')}\n`);
  process.exit(0);
}

const fgi = process.argv.indexOf('--flee-grace');
if (fgi >= 0 && process.argv[fgi + 1]) process.env.AGENT_PAL_FLEE_GRACE = process.argv[fgi + 1];
const spi = process.argv.indexOf('--speed');
if (spi >= 0 && process.argv[spi + 1]) process.env.AGENT_PAL_SPEED = process.argv[spi + 1];
const si = process.argv.indexOf('--seed');
if (si >= 0) process.env.AGENT_PAL_SEED = String(Number(process.argv[si + 1]) >>> 0);

if (process.argv.includes('--pure')) process.env.AGENT_PAL_LAYER = 'pure';
else if (process.argv.includes('--assist')) process.env.AGENT_PAL_LAYER = 'assist';

const moduleDirs = (process.env.AGENT_PAL_MODULES || '').split(path.delimiter).filter(Boolean);
process.argv.forEach((a, k) => { if (a === '--modules' && process.argv[k + 1]) moduleDirs.push(process.argv[k + 1]); });
const di = process.argv.indexOf('--data');
if (di >= 0 && process.argv[di + 1]) process.env.AGENT_PAL_DATA = path.resolve(process.argv[di + 1]);

const { startMcp, startHttp, setModules, setLive, getEngine, moduleOptions, ensureDataDump, LAYER } = await import('../src/mcp.mjs');
// 模块必须在引擎启动(确定性模式接管全局计时器)之前加载完
if (moduleDirs.length) {
  const { loadModules, discoverModules } = await import('../src/modules.mjs');
  try {
    // 有模块要读 data dump(module.yaml 里 data: true):--data DIR / AGENT_PAL_DATA,默认 apps/agent-pal/pal-data;
    // 还没有就先在子进程里导一份(约 5 秒;引擎不能在这个进程里先启动)
    if (discoverModules(moduleDirs.map((d) => path.resolve(d))).some((m) => m.needsData)) {
      await ensureDataDump();
    }
    setModules(await loadModules(moduleDirs.map((d) => path.resolve(d)), moduleOptions()));
  } catch (err) {
    process.stderr.write(`[agent-pal] ${err.message}\n`);
    process.exit(1);
  }
}
process.stderr.write(`[agent-pal] layer: ${LAYER}\n`);
const i = process.argv.indexOf('--http');
const hi = process.argv.indexOf('--host');
// 直播中枢要在工具列表给出去之前装上(多一个 chat 工具)
const live = hi >= 0 ? (await import('../src/live.mjs')).createLive({ viewerChat: process.argv.includes('--chat'), commentator: process.argv.includes('--commentator') || process.env.AGENT_PAL_LIVE_COMMENTATOR === '1',
  playerNotes: process.argv.includes('--player-notes') || process.env.AGENT_PAL_PLAYER_NOTES === '1' }) : null;
if (live) setLive(live);
if (i >= 0) startHttp(Number(process.argv[i + 1]) || 8086);
// MCP stdio:没开别的服务时默认开;--mcp 时与 --host / --http 一起开(stdin 一关就退出,所以不默认带上)
if ((i < 0 && hi < 0) || process.argv.includes('--mcp')) startMcp();
if (hi >= 0) {
  if (si >= 0) process.stderr.write('[agent-pal] --host 是实时模式;--seed 的虚拟时钟只在工具调用时走,画面会停住\n');
  const { startHost } = await import('../src/host.mjs');
  const { getAgent, runLogFile, abortAi, syncExternalState } = await import('../src/mcp.mjs');
  // 录制:回放文件和这一轮的运行日志同名(.jsonl → .palrec),放在 --record 给的目录;没给目录就和运行日志放一起
  const ri = process.argv.indexOf('--record'), rarg = ri >= 0 ? process.argv[ri + 1] : undefined;
  const recordDir = ri >= 0 ? (rarg && !rarg.startsWith('--') ? rarg : path.dirname(runLogFile)) : (process.env.AGENT_PAL_RECORD_DIR || '');
  let record = null;
  if (recordDir) { fs.mkdirSync(recordDir, { recursive: true }); record = path.join(recordDir, path.basename(runLogFile).replace(/\.jsonl$/, '') + '.palrec'); }
  await startHost(await getEngine(), { port: Number(process.argv[hi + 1]) || 8090, live, agent: await getAgent(), readonly: process.argv.includes('--watch-only'),
    onTakeover: abortAi, onHandback: syncExternalState,
    record, recordMeta: { runLog: path.basename(runLogFile) } });
}
