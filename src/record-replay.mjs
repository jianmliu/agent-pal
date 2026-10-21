/**
 * record-replay:把一局确定性模式(--seed)的 run log 重放一遍并录成 mp4 —— 事后出片、换参数重渲染,
 * 或补回当时没录到 / 被覆盖的部分。不调用模型。
 *
 *   node apps/agent-pal/src/record-replay.mjs <runs/run-….jsonl> <out.mp4>
 *
 * 起点 = run log 会话头里的 seed + 开局存档快照(start-saves);步骤 = 记下的工具调用,按 mcp 的方式逐个
 * 在 drive 下执行(不碰游戏状态的 screenshot / guide / atlas 跳过,同 golden from-run)。
 * 之后照常用 scripts/record-finish.py 配字幕(--play 给当时的 stream-json 可带上模型旁白)。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [runFile, outFile] = process.argv.slice(2);
if (!runFile || !outFile) { process.stderr.write('usage: record-replay.mjs <run.jsonl> <out.mp4>\n'); process.exit(2); }
const events = fs.readFileSync(runFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const session = events.find((e) => e.type === 'session');
if (!session || session.seed == null) { process.stderr.write('not a deterministic run (no seed in the session header); replay would not match\n'); process.exit(1); }
const OFF_GAME = new Set(['screenshot', 'guide', 'atlas', 'panorama']);
const steps = events.filter((e) => e.type === 'call' && !OFF_GAME.has(e.name)).map((e) => [e.name, e.args || {}]);

// 存档文件:开局快照的副本(重放会写存档,别动原件)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'record-replay-'));
const savesFile = path.join(tmp, 'saves.json');
if (session.startSaves) {
  const src = path.isAbsolute(session.startSaves) ? session.startSaves : path.resolve(path.dirname(runFile), session.startSaves);
  fs.copyFileSync(src, savesFile);
}
process.env.AGENT_PAL_SAVES = savesFile;
process.env.AGENT_PAL_SEED = String(session.seed);

const { bootEngine } = await import('./engine.mjs');
const { createAgent } = await import('./agent.mjs');
const { runTool } = await import('./tools.mjs');
const { startRecorder } = await import('./record.mjs');

const e = await bootEngine({ seed: session.seed, savesFile, log: () => {} });
const rec = startRecorder(e, path.resolve(outFile));
e.probes.onFrame = rec.frame;
const a = createAgent(e, { memoryFile: null });
await e.drive(a.settle(60000));
let i = 0;
for (const [name, args] of steps) {
  i++;
  rec.caption({ type: 'call', i, name, args });
  const r = await e.drive(runTool(a, name, args));
  a.observe();
  rec.caption({ type: 'result', i, name, ok: r ? !!r.ok : null, note: r?.note || '', mode: a.mode() });
  if (i % 50 === 0) process.stderr.write(`[record-replay] ${i}/${steps.length}\n`);
}
await rec.close(10000);
fs.rmSync(tmp, { recursive: true, force: true });
process.stderr.write(`[record-replay] ${steps.length} steps → ${rec.file}\n`);
process.exit(0);
