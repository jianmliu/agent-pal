/**
 * runner — bench run 的调度(spec §7):题 × 种子 → 一局一个进程,结果落 <runDir>/episodes/。
 *
 *   <runDir>/run.json                       本次运行的元数据(模型、档位、题与种子、代码版本、提示版本)
 *   <runDir>/episodes/<task>__s<seed>.json  每局结果(episode.finish 的输出 + 模型侧字段)
 *   <runDir>/episodes/<task>__s<seed>.jsonl 每局逐步日志(start / call / end)
 *   <runDir>/episodes/<task>__s<seed>.client.jsonl   外部 agent 的原始输出(claude-cli stream-json)
 *   <runDir>/episodes/<task>__s<seed>.stderr.log     子进程 stderr
 *
 * 两条通道:
 *   内置循环 —— 子进程 bench.mjs --episode:createEpisode + runLoop(loop.mjs)。
 *   claude-cli:<model> —— 子进程 mcp-episode.mjs --http 先开机到起点,再起 claude -p 挂这个 MCP 服务;
 *     第一条用户消息 = 同一份提示 + 开局观察。token / 成本取 claude 自己 result 事件里的数;成绩标 external。
 *     claude 没有工具调用上限参数:工具预算由 episode 自己判(到点后工具只回「已结束」),另有墙钟上限 --wall。
 */
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadTask, listTasks, loadReference } from './task.mjs';
import { taskFingerprint, runtimeFingerprint } from './start.mjs';
import { systemPrompt, firstMessage, PROMPT_VERSION } from './prompt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const benchCli = path.join(here, 'bench.mjs');
const mcpEpisode = path.join(here, 'mcp-episode.mjs');

const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');

/**
 * 代码版本:HEAD + 整个工作区是否有改动(packages/game-engine 等也决定一局的行为)。
 * 本次运行的输出目录不算:--out 指到仓库里未忽略的位置时,第一局写出的文件不该让续跑时变成 dirty。
 */
export function codeRev(excludeDir = null, cwd = here) {
  try {
    const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const rev = git(['rev-parse', '--short', 'HEAD']);
    const top = git(['rev-parse', '--show-toplevel']);
    const args = ['status', '--porcelain'];
    if (excludeDir) {
      let dir = path.resolve(excludeDir);
      try { dir = fs.realpathSync(dir); } catch { /* 还没建:用原路径 */ }
      const rel = path.relative(top, dir);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) args.push('--', '.', `:(exclude)${rel}`);
    }
    const dirty = execFileSync('git', args, { cwd: top, encoding: 'utf8' }).trim();
    return dirty ? `${rev}-dirty` : rev;
  } catch { return null; }
}

/** 引擎子进程统一环境:独立存档文件、地图记忆不落盘。 */
function episodeEnv(tmp) {
  return { ...process.env, AGENT_PAL_SAVES: path.join(tmp, 'saves.json'), AGENT_PAL_MEMORY: '' };
}

// 登录与配置相关的变量要留给 claude(无头机器常用 OAuth token 登录),其余 CLAUDE* / MCP_* 是宿主会话注入的
const CLAUDE_ENV_KEEP = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']);

/** claude 子进程环境:去掉宿主 Claude Code 会话注入的变量,等同于在干净终端里跑 claude。 */
export function cleanClaudeEnv(source = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(source)) {
    if (!CLAUDE_ENV_KEEP.has(k) && /^(CLAUDE|ANTHROPIC_BASE_URL$|MCP_)/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

/**
 * 续跑前核对:已有 run.json 的冻结元数据必须与这次一致,否则已完成的局和接下来的局不可比
 * (score 按题 id 合并,会把两套配置的成绩混进同一张表)。返回不一致的字段说明,空数组 = 可以续跑。
 */
export function resumeMismatch(meta, want) {
  const diffs = [];
  for (const k of ['model', 'tier', 'promptVersion', 'code']) {
    if (meta[k] !== want[k]) diffs.push(`${k}: ${JSON.stringify(meta[k])} → ${JSON.stringify(want[k])}`);
  }
  if (JSON.stringify(meta.runtime ?? null) !== JSON.stringify(want.runtime ?? null)) diffs.push('runtime / assets fingerprint differs');
  // 提示档位:加这个字段之前的 run.json 没有它,当时等同 standard
  if ((meta.hints ?? 'standard') !== (want.hints ?? 'standard')) diffs.push(`hints: ${JSON.stringify(meta.hints ?? 'standard')} → ${JSON.stringify(want.hints ?? 'standard')}`);
  if (JSON.stringify(meta.books ?? null) !== JSON.stringify(want.books ?? null)) {
    diffs.push(`books (guide / atlas): ${JSON.stringify(meta.books ?? null)} → ${JSON.stringify(want.books ?? null)}`);
  }
  if ((meta.scoring ?? 'cost') !== (want.scoring ?? 'cost')) diffs.push('scoring differs');
  const plan = (ts) => JSON.stringify((ts || []).map((t) => [t.id, t.version, t.seeds, t.fingerprint ?? null]));
  if (plan(meta.tasks) !== plan(want.tasks)) diffs.push(`tasks / versions / seeds: ${plan(meta.tasks)} → ${plan(want.tasks)}`);
  return diffs;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/**
 * C 档所用资料的指纹(spec §10:C 档成绩注明攻略 / 全图的来源版本):各攻略文件的内容哈希,
 * 全图索引及其引用的每张图的内容哈希。资料没配好返回 null。id 是整体的短哈希,排行榜上显示。
 */
export function booksFingerprint(env = process.env) {
  const guides = (env.AGENT_PAL_GUIDE || '').split(':').map((f) => f.trim()).filter((f) => f && fs.existsSync(f));
  const index = env.AGENT_PAL_ATLAS_INDEX;
  if (!guides.length || !index || !fs.existsSync(index)) return null;
  const guide = guides.map((f) => `${path.basename(f)}@${sha(fs.readFileSync(f)).slice(0, 12)}`);
  const idx = JSON.parse(fs.readFileSync(index, 'utf8'));
  const files = [...new Set(Object.values(idx.byMap || {}).map((e) => e.file))].sort();
  const h = crypto.createHash('sha256').update(JSON.stringify(idx.byMap || {}));
  for (const f of files) {
    const p = path.join(idx.dir || '', f);
    h.update(`${f}\0`).update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.from('missing'));
  }
  const atlas = `${h.digest('hex').slice(0, 12)} (${files.length} images)`;
  return { id: sha(JSON.stringify([guide, atlas])).slice(0, 8), guide, atlas };
}

const exited = (child) => new Promise((res) => {
  if (child.exitCode !== null || child.signalCode !== null) res(child.exitCode);
  else child.once('exit', (code) => res(code));
});

/** 兜底结果:子进程没留下结果文件时(崩溃 / 被杀)。 */
function harnessFailure(job, reason) {
  return {
    task: job.taskId, seed: job.seed, tier: job.tier, ...job.meta,
    success: false, successAt: null, failed: false, failAt: null, stuck: false, crashed: true,
    endReason: reason, milestones: {}, toolCalls: 0, invalidCalls: 0, tokensIn: 0, tokensOut: 0, cost: null,
    virtualSeconds: 0, battles: [], progress: 0
  };
}

export const replayTaskId = (model, taskId) => model === 'replay:auto' ? taskId : model.slice('replay:'.length);

/** 内置循环一局(子进程入口:bench.mjs --episode)。 */
export async function episodeChild(job) {
  const { createEpisode } = await import('./episode.mjs');
  const { runLoop } = await import('./loop.mjs');
  const { createProvider } = await import('./providers.mjs');
  const task = loadTask(job.taskId);
  const ctx = job.model.startsWith('replay:') ? { reference: loadReference(replayTaskId(job.model, job.taskId)), seed: job.seed } : {};
  const provider = createProvider(job.model, ctx);
  const episode = await createEpisode({ task, seed: job.seed, tier: job.tier, logFile: job.logFile, meta: job.meta });
  const res = await runLoop({ episode, provider, model: job.model });
  fs.writeFileSync(job.resultFile, JSON.stringify(res));
}

async function runBuiltin(job, tmp) {
  const err = fs.openSync(job.stderrFile, 'a');
  const child = spawn(process.execPath, [benchCli, '--episode', JSON.stringify(job)], { stdio: ['ignore', 'ignore', err], env: episodeEnv(tmp) });
  const timer = setTimeout(() => child.kill('SIGKILL'), job.wallSeconds * 1000);
  const code = await exited(child);
  clearTimeout(timer);
  fs.closeSync(err);
  if (!fs.existsSync(job.resultFile)) fs.writeFileSync(job.resultFile, JSON.stringify(harnessFailure(job, `harness-crash (exit ${code})`)));
}

async function runClaudeCli(job, tmp) {
  const claudeModel = job.model.slice('claude-cli:'.length);
  const err = fs.openSync(job.stderrFile, 'a');
  // 服务判分结果先落 .server.json,并上客户端用量后才写正式结果 —— 正式结果文件存在 = 这局完整结束(续跑据此跳过)
  const serverResult = job.resultFile.replace(/\.json$/, '.server.json');
  // 1) 起本局 MCP 服务(HTTP),等它开机到起点、报出地址与开局观察
  const server = spawn(process.execPath, [mcpEpisode, '--http'], {
    stdio: ['ignore', 'pipe', err], env: { ...episodeEnv(tmp), BENCH_EPISODE: JSON.stringify({ ...job, resultFile: serverResult }) }
  });
  const ready = await new Promise((res) => {
    const rl = readline.createInterface({ input: server.stdout });
    rl.once('line', (l) => { try { res(JSON.parse(l)); } catch { res(null); } });
    server.once('exit', () => res(null));
  });
  if (!ready) {
    fs.closeSync(err);
    fs.writeFileSync(job.resultFile, JSON.stringify(harnessFailure(job, 'harness-crash (mcp server did not start)')));
    return;
  }
  const task = loadTask(job.taskId);
  const cfg = path.join(tmp, 'mcp.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { palbench: { type: 'http', url: ready.url } } }));

  // 2) claude -p:只给本局工具,不读任何设置 / 项目文件,不落会话
  const args = [
    '-p', firstMessage(task, ready.intro),
    '--system-prompt', systemPrompt(job.tier),
    '--mcp-config', cfg, '--strict-mcp-config',
    '--tools', '', '--allowedTools', 'mcp__palbench',
    '--setting-sources', '', '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose',
    '--model', claudeModel
  ];
  const clientLog = fs.createWriteStream(job.clientLogFile);
  const claude = spawn('claude', args, { cwd: tmp, stdio: ['ignore', 'pipe', err], env: cleanClaudeEnv() });
  let final = null;
  const rl = readline.createInterface({ input: claude.stdout });
  rl.on('line', (l) => {
    clientLog.write(l + '\n');
    try { const ev = JSON.parse(l); if (ev.type === 'result') final = ev; } catch {}
  });
  // 一局判完后给客户端一点收尾时间,再不退就杀;另有墙钟上限
  let timedOut = false;
  const wall = setTimeout(() => { timedOut = true; claude.kill('SIGTERM'); }, job.wallSeconds * 1000);
  const poll = setInterval(() => {
    if (fs.existsSync(serverResult)) { clearInterval(poll); setTimeout(() => claude.kill('SIGTERM'), 60_000).unref(); }
  }, 1000);
  await exited(claude);
  clearTimeout(wall); clearInterval(poll);
  await new Promise((res) => clientLog.end(res));

  // 3) 收尾:服务若还没判完,按「客户端自己停了」或「墙钟超时」结算
  server.kill(timedOut ? 'SIGTERM' : 'SIGINT');
  await exited(server);
  fs.closeSync(err);
  const res = fs.existsSync(serverResult) ? JSON.parse(fs.readFileSync(serverResult, 'utf8')) : harnessFailure(job, 'harness-crash (no result)');
  fs.rmSync(serverResult, { force: true });
  fs.writeFileSync(job.resultFile, JSON.stringify(applyClientResult(res, final, claudeModel)));
}

/**
 * 外部 agent 的 token / 成本:取 claude 自己 result 事件的 usage(与内置循环同口径 —— tokensIn 含缓存读写,
 * 另记 tokensCached / tokensCacheWrite)。没有 result 事件 = 客户端出错。
 */
export function applyClientResult(res, final, claudeModel) {
  const u = final?.usage || {};
  res.external = true;
  res.client = { name: 'claude-cli', model: claudeModel, numTurns: final?.num_turns ?? null, isError: final?.is_error ?? null, subtype: final?.subtype ?? null, durationMs: final?.duration_ms ?? null };
  res.tokensIn = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  res.tokensOut = u.output_tokens ?? 0;
  res.tokensCached = u.cache_read_input_tokens ?? 0;
  res.tokensCacheWrite = u.cache_creation_input_tokens ?? 0;
  res.cost = final?.total_cost_usd ?? null;
  if (!final) res.endReason = res.endReason || 'client-error';
  return res;
}

/** 这些种子在当前参考解里的 par(没有参考解 / 没录的种子为 null)。 */
export function parFor(taskId, seeds) {
  const par = loadReference(taskId)?.par || {};
  return Object.fromEntries(seeds.map((seed) => [String(seed), par[String(seed)] ?? null]));
}

/** bench run:返回 runDir。 */
export async function runBench({ model, tier = 'B', hints = 'standard', tasks, seeds, jobs = 1, wallSeconds = 1800, out }) {
  if (hints !== 'standard' && hints !== 'full') throw new Error(`--hints must be standard or full, got ${hints}`);
  const ids = tasks?.length ? tasks : listTasks();
  const plan = ids.map((id) => {
    const task = loadTask(id);
    return { task, seeds: seeds?.length ? seeds : task.seeds };
  });
  const runDir = path.resolve(out || path.join(here, 'out', `${slug(model)}-${tier}-${stamp()}`));
  const epDir = path.join(runDir, 'episodes');
  fs.mkdirSync(epDir, { recursive: true });
  const runFile = path.join(runDir, 'run.json');
  const fresh = {
    scoring: plan.every(p=>p.task.scoring?.secondary==='battleRounds') ? 'battleRounds' : plan.some(p=>p.task.scoring?.secondary==='battleRounds') ? 'mixed' : 'cost',
    runId: path.basename(runDir), model, tier, hints, external: model.startsWith('claude-cli:'),
    // par 冻进 run.json:参考解以后重录(引擎修了战斗数值等)不改写这次运行的效率分
    tasks: plan.map((p) => ({ id: p.task.id, version: p.task.version, seeds: p.seeds, par: parFor(p.task.id, p.seeds), ...(p.task.scoring ? { fingerprint: taskFingerprint(p.task) } : {}) })),
    promptVersion: PROMPT_VERSION, code: codeRev(runDir), startedAt: new Date().toISOString()
  };
  if (plan.some(p=>p.task.scoring)) fresh.runtime = runtimeFingerprint();
  if (tier === 'C') {
    // 冻结所用资料的版本:续跑时资料变了就拒绝,排行榜上也能分辨
    fresh.books = booksFingerprint();
    if (!fresh.books) throw new Error('tier C needs the walkthrough and the map atlas: set AGENT_PAL_GUIDE and AGENT_PAL_ATLAS_INDEX (see bench/README.md)');
  }
  const meta = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : fresh;
  const diffs = meta === fresh ? [] : resumeMismatch(meta, fresh);
  if (diffs.length) throw new Error(`${runDir} was started with a different setup; use a fresh --out:\n  ${diffs.join('\n  ')}`);
  fs.writeFileSync(runFile, JSON.stringify(meta, null, 2));

  const queue = [];
  for (const { task, seeds: ss } of plan) {
    for (const seed of ss) {
      const base = path.join(epDir, `${task.id}__s${seed}`);
      if (fs.existsSync(base + '.json')) { console.log(`· ${task.id} seed ${seed}: already done, skipping`); continue; }
      queue.push({
        taskId: task.id, seed, tier, model, wallSeconds,
        resultFile: base + '.json', logFile: base + '.jsonl', stderrFile: base + '.stderr.log', clientLogFile: base + '.client.jsonl',
        meta: { model, runId: meta.runId, hints }
      });
    }
  }
  console.log(`run ${meta.runId}: ${queue.length} episode(s), model ${model}, tier ${tier}, hints ${hints}, jobs ${jobs}`);
  const worker = async () => {
    for (let job; (job = queue.shift());) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-bench-'));
      for (const f of [job.logFile]) if (fs.existsSync(f)) fs.rmSync(f);          // 上次中断的半截日志
      const t0 = Date.now();
      try {
        await (model.startsWith('claude-cli:') ? runClaudeCli(job, tmp) : runBuiltin(job, tmp));
      } catch (err) {
        fs.writeFileSync(job.resultFile, JSON.stringify(harnessFailure(job, `harness-crash (${err?.message || err})`)));
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      const r = JSON.parse(fs.readFileSync(job.resultFile, 'utf8'));
      console.log(`${r.success ? '✓' : '✗'} ${job.taskId} seed ${job.seed}: ${r.endReason} · calls ${r.toolCalls} · progress ${r.progress.toFixed(2)}` +
        ` · tok ${r.tokensIn}/${r.tokensOut} · cost ${r.cost == null ? '?' : '$' + r.cost.toFixed(4)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  meta.finishedAt = new Date().toISOString();
  fs.writeFileSync(runFile, JSON.stringify(meta, null, 2));
  return runDir;
}
