#!/usr/bin/env node
/**
 * bench — agent-pal-bench 的命令行(docs/specs/agent-pal-bench.md)。M0:出题与验题。
 *
 *   node apps/agent-pal/bench/bench.mjs check [id...] [--jobs N]
 *        # --jobs:同时跑 N 局(默认 CPU 核数的一半,或 AGENT_PAL_JOBS);每局独立子进程 + 虚拟时钟,并发不影响结果,输出仍按题目 / 种子顺序
 *        每题每颗种子起一个子进程:到起点 → 回放参考解(bench/reference/<id>.json)→ 每步后求
 *        goal / milestones / fail。全部种子都判为成功才算这题「可解」;否则非零退出。
 *        --write-par:把各种子到达 goal 的步数写回参考解的 par 字段(bench score 的效率参照)。
 *   node apps/agent-pal/bench/bench.mjs state --task <id> [--seed N] [--steps file.json] [--observe]
 *        出题辅助:到该题起点(可再回放一串步骤),打印状态视图 JSON —— 从中挑 goal 判据;
 *        --observe 改为打印模型视角的 observe 文本(含物体 / 出口去向),用来规划参考解。
 *   node apps/agent-pal/bench/bench.mjs verify <runDir | runDir/episodes/<task>__s<seed>.jsonl>
 *        重放核验(spec §8,verify.mjs):按日志里的调用在同种子下重打一遍,判分快照与登记成绩都要对得上;
 *        整次运行的核验结果写 <runDir>/verify.json。有不一致就非零退出。
 *   node apps/agent-pal/bench/bench.mjs board [runDir...] [--out file.html]
 *        排行页(board.mjs):若干次运行汇总成自包含 HTML —— 按档位排、外部 agent 单列、success × cost 帕累托图、
 *        每题矩阵、核验状态,以及闭卷测验(目录里有 quiz.json 就收)。不给目录 = bench/out/ 下全部;默认写 bench/out/board.html。
 *   node apps/agent-pal/bench/bench.mjs quiz --model <spec> [--tasks a,b] [--jobs N] [--out dir]
 *        闭卷测验(quiz.mjs):不开游戏、不给工具,按 bench/quiz/<task>.json 问模型对这款游戏记得多少;
 *        关键词判分,结果写 <out>/quiz.json。与同一模型的游戏成绩并排看「知道」与「做到」的差距(污染检测)。
 *   node apps/agent-pal/bench/bench.mjs validate
 *        只校验 bench/tasks/*.json 与 bench/quiz/*.json 的格式(不起引擎)。
 *
 * 环境:AGENT_PAL_CLASSIC_SAVES(start.rpg 的原版存档目录);PAL 资产同 agent-pal(pal-playground/public/pal-assets)。
 * 每局独立子进程(引擎是全局状态)、独立存档文件、地图记忆不落盘 —— 互不沾光(spec §5)。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadTask, listTasks, loadReference, validateTask, TASK_DIR } from './task.mjs';
import { runBench, episodeChild } from './runner.mjs';
import { score, printSummary } from './score.mjs';
import { verify, verifyChild } from './verify.mjs';
import { board } from './board.mjs';
import { checkPrSubmission } from './pr-check.mjs';
import { runQuiz, printQuiz, listQuizzes, validateQuiz, QUIZ_DIR } from './quiz.mjs';
import { referenceToolErrors, replayReferenceStep } from './episode.mjs';
import { initializeTask, engineOptions, executeTaskTool } from './start.mjs';
import { createBattleMetrics, actionError } from './battle-metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentSrc = path.resolve(here, '..', 'src');
const startSaves = path.join(here, 'saves');   // 题目起点存档(start.saves)
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

if (argv[0] === '--child') {
  await child(JSON.parse(argv[1]));
  process.exit(0);
}
if (argv[0] === '--episode') {
  await episodeChild(JSON.parse(argv[1]));
  process.exit(0);
}
if (argv[0] === '--verify-episode') {
  await verifyChild(JSON.parse(argv[1]));
  process.exit(0);
}

const cmd = argv[0];
if (cmd === 'validate') {
  let bad = 0;
  for (const id of listTasks()) {
    const t = JSON.parse(fs.readFileSync(path.join(TASK_DIR, `${id}.json`), 'utf8'));
    const err = validateTask(t);
    if (t.id !== id) err.push(`id "${t.id}" does not match file name`);
    console.log(`${err.length ? '✗' : '✓'} ${id}${err.length ? '\n    ' + err.join('\n    ') : ''}`);
    if (err.length) bad++;
  }
  const quizzes = new Set(listQuizzes());
  for (const id of quizzes) {
    const err = validateQuiz(JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, `${id}.json`), 'utf8')), id);
    if (!listTasks().includes(id)) err.push('no task with this id');
    console.log(`${err.length ? '✗' : '✓'} quiz ${id}${err.length ? '\n    ' + err.join('\n    ') : ''}`);
    if (err.length) bad++;
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === 'quiz') {
  if (!flag('--model')) { process.stderr.write('usage: bench.mjs quiz --model <spec> [--tasks a,b] [--jobs N] [--out dir]\n'); process.exit(2); }
  const res = await runQuiz({ model: flag('--model'), tasks: flag('--tasks') ? flag('--tasks').split(',').filter(Boolean) : null, jobs: Number(flag('--jobs', 4)), out: flag('--out') });
  printQuiz(res);
} else if (cmd === 'state') {
  const task = loadTask(flag('--task'));
  const steps = flag('--steps') ? JSON.parse(fs.readFileSync(flag('--steps'), 'utf8')).steps : [];
  const r = runChild({ task, seed: Number(flag('--seed', task.seeds[0])), steps, dump: true });
  if (r.error) console.error(r.error);
  if (argv.includes('--observe')) console.log(r.observe ?? '(no observe)');
  else console.log(JSON.stringify(r.finalView, null, 1));
} else if (cmd === 'check') {
  const writePar = argv.includes('--write-par');
  const jobs = Math.max(1, Number(flag('--jobs', process.env.AGENT_PAL_JOBS ?? Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2))) || 1);
  const VALUE_FLAGS = new Set(['--jobs']);
  const positional = argv.slice(1).filter((x, i, a) => !x.startsWith('--') && !VALUE_FLAGS.has(a[i - 1]));
  const ids = positional.length ? positional : listTasks();
  // 先排好所有(题, 种子),以 jobs 路并发跑,再按原顺序打印 / 判定
  const plan = [];
  for (const id of ids) {
    const task = loadTask(id);
    const ref = loadReference(id);
    plan.push({ id, task, ref, seeds: task.seeds.map((seed) => {
      const steps = ref ? (ref.bySeed ? ref.bySeed[String(seed)] : ref.steps) : null;
      return { seed, steps, bad: steps ? referenceToolErrors(task, steps) : [] };   // 用了模型拿不到的工具:不回放,直接判失败
    }) });
  }
  const runs = plan.flatMap((p) => (p.ref ? p.seeds.filter((s) => s.steps && !s.bad.length).map((s) => ({ key: `${p.id}:${s.seed}`, job: { task: p.task, seed: s.seed, steps: s.steps } })) : []));
  const results = new Map();
  let next = 0;
  const worker = async () => {
    while (next < runs.length) {
      const { key, job } = runs[next++];
      results.set(key, await runChildAsync(job));
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(jobs, runs.length) }, worker));
  const waitFor = async (key) => { while (!results.has(key)) await new Promise((r) => setTimeout(r, 50)); return results.get(key); };
  let failed = 0;
  for (const { id, task, ref, seeds } of plan) {
    const par = {};
    if (!ref) { console.log(`✗ ${id}: no reference solution at bench/reference/${id}.json`); failed++; continue; }
    for (const { seed, steps, bad } of seeds) {
      if (!steps) { console.log(`✗ ${id} seed ${seed}: reference has no steps for this seed`); failed++; continue; }
      if (bad.length) { console.log(`✗ ${id} seed ${seed}: reference uses tools models cannot use\n    ${bad.join('\n    ')}`); failed++; continue; }
      const r = await waitFor(`${id}:${seed}`);
      const ms = Object.entries(r.milestones).map(([k, v]) => `${k}@${v ?? '–'}`).join(' ');
      const ok = r.success && !r.failed;
      console.log(`${ok ? '✓' : '✗'} ${id} seed ${seed}: ${r.success ? `goal at step ${r.successStep}/${r.steps}` : `goal NOT reached (${r.steps} steps)`}` +
        `${r.battleRounds != null ? ` · rounds ${r.battleRounds}` : ''}${r.failed ? ` · FAIL condition at step ${r.failStep}` : ''} · milestones ${ms || '(none)'} · vt ${r.vt}s`);
      if (!ok) { failed++; if (r.error) console.log(`    error: ${r.error}`); }
      else par[String(seed)] = r.successStep;
    }
    if (writePar && Object.keys(par).length === task.seeds.length) {
      fs.writeFileSync(path.join(here, 'reference', `${id}.json`), JSON.stringify({ ...ref, par }, null, 1) + '\n');
    }
  }
  await workers;
  process.exit(failed ? 1 : 0);
} else if (cmd === 'run') {
  if (!flag('--model')) { process.stderr.write('usage: bench.mjs run --model <spec> [--tier B] [--hints standard|full] [--tasks a,b] [--seeds 1,2] [--jobs N] [--wall secs] [--out dir]\n'); process.exit(2); }
  const list = (k) => (flag(k) ? flag(k).split(',').filter(Boolean) : null);
  const runDir = await runBench({
    model: flag('--model'), tier: flag('--tier', 'B'), hints: flag('--hints', 'standard'), tasks: list('--tasks'), seeds: list('--seeds')?.map(Number),
    jobs: Number(flag('--jobs', 1)), wallSeconds: Number(flag('--wall', 1800)), out: flag('--out')
  });
  printSummary(score(runDir));
} else if (cmd === 'score') {
  if (!argv[1]) { process.stderr.write('usage: bench.mjs score <runDir>\n'); process.exit(2); }
  printSummary(score(argv[1]));
} else if (cmd === 'verify') {
  if (!argv[1]) { process.stderr.write('usage: bench.mjs verify <runDir | runDir/episodes/<task>__s<seed>.jsonl>\n'); process.exit(2); }
  process.exit(verify(argv[1]).every((r) => r.ok) ? 0 : 1);
} else if (cmd === 'board') {
  const dirs = argv.slice(1).filter((x, i, a) => !x.startsWith('--') && a[i - 1] !== '--out');
  const { out, runs, quizzes } = board(dirs, {
    ...(flag('--out') ? { out: flag('--out') } : {}),
    mergeModels: argv.includes('--merge'),
    verifiedOnly: argv.includes('--verified-only')
  });
  console.log(`${out}: ${runs} run(s), ${quizzes} quiz(zes)`);
} else if (cmd === 'check-pr') {
  const res = checkPrSubmission({ baseRef: flag('--base', 'origin/main') });
  console.log('\n' + res.markdown);
  const summaryFile = flag('--summary-out', process.env.GITHUB_STEP_SUMMARY || '');
  if (summaryFile) fs.appendFileSync(summaryFile, res.markdown + '\n');
  process.exit(res.ok ? 0 : 1);
} else {
  process.stderr.write('usage: bench.mjs run --model <spec> [...] | score <runDir> | verify <runDir|log.jsonl> | board [runDir...] [--out f.html] [--merge] [--verified-only] | check-pr [--base origin/main] | quiz --model <spec> [...] | check [id...] | state --task <id> [...] | validate\n');
  process.exit(2);
}

/** 起一个独立子进程跑一局,返回其 JSON 结果。 */
function runChild(job) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-bench-'));
  const out = path.join(dir, 'result.json');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', JSON.stringify({ ...job, out })], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, AGENT_PAL_SAVES: path.join(dir, 'saves.json'), AGENT_PAL_MEMORY: '' }
  });
  if (r.status !== 0 || !fs.existsSync(out)) return { success: false, steps: 0, milestones: {}, error: `child exited ${r.status}`, vt: 0 };
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/** runChild 的并发版:子进程的 stderr 先缓冲,结束时一次写出(并发时不交错) */
function runChildAsync(job) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-bench-'));
  const out = path.join(dir, 'result.json');
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', JSON.stringify({ ...job, out })], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, AGENT_PAL_SAVES: path.join(dir, 'saves.json'), AGENT_PAL_MEMORY: '' }
    });
    const err = [];
    p.stderr.on('data', (d) => err.push(d));
    p.on('close', (status) => {
      if (err.length) process.stderr.write(Buffer.concat(err));
      // 子进程没留下结果(开局前就崩了,比如存档目录没配):把 stderr 里最后一条报错带上,别只剩「exited 1」
      const cause = Buffer.concat(err).toString().split('\n').map((l) => l.trim()).filter((l) => /^\w*Error\b|^Error:/.test(l)).pop();
      if (status !== 0 || !fs.existsSync(out)) return resolve({ success: false, steps: 0, milestones: {}, error: `child exited ${status}${cause ? ` — ${cause}` : ''}`, vt: 0 });
      resolve(JSON.parse(fs.readFileSync(out, 'utf8')));
    });
  });
}

/** 子进程:到起点 → 回放步骤 → 每步后判分。 */
async function child({ task, seed, steps, out, dump }) {
  const start = task.start;
  if (start.rpg) {
    const raw = fs.readFileSync(path.join(process.env.AGENT_PAL_CLASSIC_SAVES || path.join(startSaves, 'classic'), start.rpg));
    const payload = { version: 1, savedTimes: raw.readUInt16LE(0), timestamp: 0, bytes: Array.from(raw) };
    fs.writeFileSync(process.env.AGENT_PAL_SAVES, JSON.stringify({ 'PAL-SAVE-1': JSON.stringify(payload) }));
  } else if (start.saves) {
    fs.writeFileSync(process.env.AGENT_PAL_SAVES, zlib.gunzipSync(fs.readFileSync(path.join(startSaves, start.saves))));
  }

  const { bootEngine } = await import(path.join(agentSrc, 'engine.mjs'));
  const { createAgent } = await import(path.join(agentSrc, 'agent.mjs'));
  const { runTool } = await import(path.join(agentSrc, 'tools.mjs'));
  const { createStateTracker } = await import(path.join(here, 'state-view.mjs'));
  const { evaluate } = await import(path.join(here, 'predicates.mjs'));

  const e = await bootEngine({ seed, log: () => {}, ...engineOptions(task) });
  const a = createAgent(e, { memoryFile: null });
  const battleMetrics = task.scoring?.secondary === 'battleRounds' ? createBattleMetrics(e) : null;
  const tracker = createStateTracker(e, a, { battleMetrics });
  const res = { task: task.id, version: task.version, seed, success: false, successStep: null, failed: false, failStep: null, milestones: {}, steps: 0, vt: 0 };
  for (const m of task.milestones || []) res.milestones[m.id] = null;

  try {
    await initializeTask({ e, a, task, runTool, tracker });

    const judge = (i) => {
      const v = tracker.view();
      for (const m of task.milestones || []) if (res.milestones[m.id] == null && evaluate(m.when, v)) res.milestones[m.id] = i;
      if (!res.failed && task.fail && evaluate(task.fail, v)) { res.failed = true; res.failStep = i; }
      if (!res.success && evaluate(task.goal, v)) { res.success = true; res.successStep = i; }
    };
    judge(0);
    for (const [i, [tool, args = {}]] of steps.entries()) {
      if (res.success || res.failed) break;
      const forbidden = actionError(task, tool, args);
      if (forbidden) throw new Error(forbidden);
      const r = task.engineProfile ? await executeTaskTool({e,a,task,runTool},tool,args) : await replayReferenceStep({ drive: (p) => e.drive(p), runTool, agent: a }, tool, args);
      if (r && r.unknown) throw new Error(`unknown tool ${tool}`);
      if (task.start.setup && r?.ok === false) throw new Error(`reference ${tool}: ${r.note}`);
      tracker.update();
      res.steps = i + 1;
      judge(i + 1);
    }
  } catch (err) {
    res.error = String(err?.stack || err);
  }
  if (battleMetrics) res.battleRounds = tracker.view().battles.filter(b=>b.outcome==='won').reduce((n,b)=>n+b.rounds,0);
  res.vt = Math.round(e.clock.now()) / 1000;
  if (dump) { res.finalView = tracker.view(); res.observe = a.observe(); }   // observe 放最后:它会把新文字标已读
  fs.writeFileSync(out, JSON.stringify(res));
}
