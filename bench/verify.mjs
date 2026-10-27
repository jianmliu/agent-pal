/**
 * verify — 重放核验(spec §8):成绩不靠信任,靠重放。
 *
 *   bench verify <runDir>                     核验这次运行的每一局,结果写 <runDir>/verify.json
 *   bench verify <runDir>/episodes/<x>.jsonl  只核验这一局
 *
 * 一局的逐步日志(episode.mjs 写的 start / call / end)里有模型的全部工具调用。核验 = 新子进程按日志里的
 * 题目、种子、档位重新开一局(同一个 createEpisode,起点一样),把调用按原顺序原参数再打一遍,然后对照:
 *  - 每次调用后的判分快照:调用名、ok、场景、坐标、模式、虚拟时间、goal、milestones、终止原因
 *  - 终局:success / successAt、fail、stuck、crashed、milestones、调用数、无效调用数、虚拟时间、progress
 *  - 登记成绩(episodes/<x>.json)与日志 end 逐项一致,含题 / 版本 / 种子 / 档位 / 终止原因
 *  - 终止原因:重放只对照 episode 自己判的(成功 / 失败条件 / 崩溃 / 卡死 / 调用与虚拟时间预算);
 *    token 预算、模型自己停、provider 出错、墙钟、客户端出错是模型侧的事,重放里没有模型,不比。
 * 模型的 token / 成本不在重放范围内(内置循环由 runner 逐轮累计,外部 agent 取客户端自报)。
 *
 * 题目版本与日志不同 → 判不可核验(判据可能已经变了)。代码版本与 run.json 不同只提示:引擎行为若真变了,
 * 对照会自己失败。
 * C 档:本机攻略 / 全图的指纹必须与 run.json 的 books 一致,否则判不可核验 —— 资料内容不进日志,
 * 换了资料重放照样能对上,但那已经不是模型当时看到的东西。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTask } from './task.mjs';
import { taskFingerprint, runtimeFingerprint } from './start.mjs';
import { codeRev, booksFingerprint } from './runner.mjs';
import { costOf } from './providers.mjs';
import { PROTOCOL_OVERRIDE_KEYS } from './protocol-contract.mjs';
import { readClientFinalization, ACCOUNTING_FIELDS } from './client-finalization.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const benchCli = path.join(here, 'bench.mjs');

/** episode 自己判的终止原因;其余(token 预算、agent-stopped、provider-error、墙钟、客户端)来自模型侧。 */
export const ENGINE_REASONS = new Set(['success', 'fail-condition', 'crashed', 'stuck', 'budget-toolCalls', 'budget-virtualSeconds']);
const CALL_FIELDS = ['battleRounds','battleTelemetry','combat','name', 'ok', 'scene', 'pos', 'mode', 'vt', 'success', 'milestones', 'stop'];
const END_FIELDS = ['task','taskVersion','seed','tier','model','runId','battleRounds','battles','success', 'successAt', 'failed', 'failAt', 'stuck', 'crashed', 'milestones', 'toolCalls', 'invalidCalls', 'virtualSeconds', 'progress'];
// 登记成绩与日志 end 还要对上身份与终止原因:score 按 task 分组、按 seed 取 par、统计 endReason
const CLAIM_FIELDS = ['task', 'taskVersion', 'seed', 'tier', 'endReason', ...END_FIELDS];
const CLAIM_USAGE_FIELDS = ['tokensIn', 'tokensOut', 'tokensCached', 'tokensCacheWrite', 'cost'];

/** 读逐步日志:{ start, calls, turns, end }(end 缺失 = 那局没正常收尾)。 */
export function readLog(file) {
  const out = { start: null, calls: [], turns: [], end: null };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (!ev || typeof ev !== 'object' || Array.isArray(ev) || typeof ev.type !== 'string') throw new Error(`${file}: invalid log event`);
    if (ev.type === 'start' && (out.start || out.end || out.calls.length || out.turns.length)) throw new Error(`${file}: duplicate or misplaced start event`);
    if (ev.type !== 'start' && !out.start) throw new Error(`${file}: event before start`);
    if (ev.type === 'end' && out.end) throw new Error(`${file}: duplicate end event`);
    if (ev.type === 'call' && (out.end || !Number.isInteger(ev.i) || ev.i !== out.calls.length + 1 || typeof ev.name !== 'string')) throw new Error(`${file}: invalid or misplaced call event`);
    if (ev.type === 'start') out.start = ev;
    else if (ev.type === 'call') out.calls.push(ev);
    else if (ev.type === 'turn') out.turns.push(ev);
    else if (ev.type === 'end') out.end = ev;
  }
  if (!out.start) throw new Error(`${file}: no start event`);
  if (out.end?.toolCalls !== undefined && (!Number.isInteger(out.end.toolCalls) || out.end.toolCalls !== out.calls.length)) throw new Error(`${file}: end toolCalls disagrees with raw call count`);
  out.accountingErrors = [];
  if (out.end) {
    try { out.clientFinalized = readClientFinalization(file); }
    catch (err) { out.accountingErrors.push(err.message); }
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 对照原日志与重放日志,返回差异列表(空 = 核验通过)。纯函数。
 * claimed = 这局登记的成绩(episodes/<x>.json,score 读的就是它);缺省用日志里的 end 事件。
 */
export function compareLogs(orig, replay, claimed = orig.end) {
  const diffs = [...(orig.accountingErrors || [])];
  const accountedEnd = orig.clientFinalized?.result || orig.end;
  if (orig.start?.clientAccountingVersion === 1 && !orig.clientFinalized) diffs.push('missing required client_finalized event');
  for(const k of ['fingerprint','initial','setup','protocol','trial'])if(orig.start?.[k] !== undefined && !same(orig.start[k],replay.start?.[k]))diffs.push(`start ${k} mismatch`);
  const n = Math.max(orig.calls.length, replay.calls.length);
  for (let i = 0; i < n; i++) {
    const a = orig.calls[i], b = replay.calls[i];
    if (!a || !b) { diffs.push(`call count: logged ${orig.calls.length}, replayed ${replay.calls.length}`); break; }
    const bad = CALL_FIELDS.filter((k) => !same(a[k], b[k]));
    // 只报第一处分歧:之后的状态都是它的后果
    if (bad.length) { diffs.push(`call #${a.i} ${a.name}: ` + bad.map((k) => `${k} ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`).join(', ')); break; }
  }
  if (!orig.end) {
    // 没正常收尾(子进程崩溃 / 被杀):登记的是兜底结果,只要求它没有声称成功
    if (claimed?.success) diffs.push('claims success but the log has no end event');
    return diffs;
  }
  for (const k of ['task','taskVersion','seed','tier','model','runId']) if(orig.start?.[k] != null && orig.end[k] != null && !same(orig.start[k], orig.end[k])) diffs.push(`end ${k} disagrees with start`);
  for (const k of ['protocol','trial']) {
    if (orig.start?.[k] !== undefined && orig.end && !same(orig.start[k], orig.end[k])) diffs.push(`end ${k} disagrees with start`);
    if (claimed && orig.end?.[k] !== undefined && !same(claimed[k],orig.end[k])) diffs.push(`result file ${k} disagrees with log`);
    if (replay.end && orig.end?.[k] !== undefined && !same(replay.end[k],orig.end[k])) diffs.push(`final ${k} mismatch`);
  }
  if (claimed && claimed !== orig.end) {
    for (const k of CLAIM_FIELDS) if (!same(claimed[k], orig.end[k])) diffs.push(`result file ${k} ${JSON.stringify(claimed[k])} disagrees with the log's ${JSON.stringify(orig.end[k])}`);
    for (const k of orig.clientFinalized ? ACCOUNTING_FIELDS : CLAIM_USAGE_FIELDS) if ((orig.clientFinalized || (claimed[k] !== undefined && orig.end[k] !== undefined)) && !same(claimed[k], accountedEnd[k])) diffs.push(`result file ${k} ${JSON.stringify(claimed[k])} disagrees with the log's ${JSON.stringify(accountedEnd[k])}`);
    for (const k of ['accountingStatus','measuredUsage','turns']) if ((claimed[k] !== undefined || accountedEnd?.[k] !== undefined) && !same(claimed[k],accountedEnd?.[k])) diffs.push(`result file ${k} disagrees with accounting log`);
    if (orig.clientFinalized && !same(claimed.client, accountedEnd.client)) diffs.push('result client metadata disagrees with client_finalized');
  }
  // Built-in provider errors retain a measured prefix, while whole-trial totals stay unknown.
  const incomplete = !orig.end.external && orig.end.accountingStatus === 'incomplete';
  const ledger = incomplete ? (orig.end.measuredUsage || {}) : orig.end;
  const ledgerLabel = incomplete ? 'end measuredUsage' : 'end';
  if (!orig.end.external && orig.end.accountingStatus === 'complete') {
    for (const key of ['tokensIn','tokensOut','tokensCached','tokensCacheWrite']) {
      if (!Number.isSafeInteger(orig.end[key]) || orig.end[key] < 0) diffs.push(`complete accounting requires known ${key}`);
    }
  }
  if (incomplete) {
    for (const key of CLAIM_USAGE_FIELDS) if (orig.end[key] !== null) diffs.push(`incomplete accounting requires null whole-trial ${key}`);
    for (const key of ['tokensIn','tokensOut','tokensCached','tokensCacheWrite','turns']) {
      if (!Number.isSafeInteger(ledger[key]) || ledger[key] < 0) diffs.push(`invalid measuredUsage ${key}`);
    }
    if (ledger.cost !== null && (typeof ledger.cost !== 'number' || !Number.isFinite(ledger.cost) || ledger.cost < 0)) diffs.push('invalid measuredUsage cost');
    if (ledger.turns !== (orig.turns?.length ?? 0)) diffs.push('measuredUsage turns disagrees with logged turn count');
  }
  if (Array.isArray(orig.turns) && orig.turns.length > 0) {
    let sumIn = 0, sumOut = 0, sumCacheRead = 0, sumCacheWrite = 0, activeTurns = 0;
    for (const t of orig.turns) {
      const u = t.usage || {};
      const known = key => {
        if (u[key] === undefined || u[key] === null) return 0;
        if (Number.isSafeInteger(u[key]) && u[key] >= 0) return u[key];
        if (!incomplete) diffs.push(`invalid turn usage ${key}`);
        return 0;
      };
      const input = known('tokensIn');
      sumIn += input; sumOut += known('tokensOut');
      sumCacheRead += known('cacheRead'); sumCacheWrite += known('cacheWrite');
      if (input > 0) activeTurns++;
    }
    for (const [key, sum] of [['tokensIn',sumIn],['tokensOut',sumOut],['tokensCached',sumCacheRead],['tokensCacheWrite',sumCacheWrite]]) {
      if ((ledger[key] ?? 0) < sum) diffs.push(`${ledgerLabel} ${key} ${ledger[key]} < sum of turn ${key} ${sum}`);
    }
    if (!incomplete && activeTurns > 0 && (ledger.tokensIn ?? 0) < activeTurns * 100) {
      diffs.push(`end tokensIn ${ledger.tokensIn} is below physical prompt minimum (${activeTurns} active turns × 100 tokens)`);
    }
  }
  if (!orig.end.external && orig.end.model && ledger.tokensIn != null) {
    const expectedCost = costOf(orig.end.model, {
      tokensIn: ledger.tokensIn || 0, tokensOut: ledger.tokensOut || 0,
      cacheRead: ledger.tokensCached || 0, cacheWrite: ledger.tokensCacheWrite || 0
    });
    if (expectedCost != null && (ledger.cost == null || Math.abs(ledger.cost - expectedCost) > 1e-5)) {
      diffs.push(`${ledgerLabel} cost ${JSON.stringify(ledger.cost)} disagrees with official price table (${expectedCost.toFixed(6)})`);
    }
  }
  if (!replay.end) diffs.push('replay has no end event');
  if (replay.end) {
    for (const k of END_FIELDS) if (!same(orig.end[k], replay.end[k])) diffs.push(`final ${k}: ${JSON.stringify(orig.end[k])} → ${JSON.stringify(replay.end[k])}`);
    if (ENGINE_REASONS.has(orig.end.endReason) && orig.end.endReason !== replay.end.endReason) {
      diffs.push(`endReason: ${orig.end.endReason} → ${replay.end.endReason}`);
    }
  }
  return diffs;
}

/** 子进程入口(bench.mjs --verify-episode):按日志重开一局、重打调用,重放日志写到 job.logFile。 */
export async function verifyChild(job) {
  delete process.env.BENCH_RESUME_FROM;
  const { createEpisode } = await import('./episode.mjs');
  const orig = readLog(job.source);
  const s = orig.start;
  const task = loadTask(s.task);
  const budgetToolCalls = s.protocol?.budget?.toolCalls ?? s.budgetToolCalls ?? (orig.end?.endReason === 'budget-toolCalls' ? orig.end.toolCalls : undefined);
  let tailSame = 0;
  if (orig.end?.endReason === 'stuck' && orig.calls.length > 0) {
    const last = orig.calls[orig.calls.length - 1];
    const sig = (c) => JSON.stringify([c.scene, c.pos, c.mode, c.milestones]);
    const target = sig(last);
    for (let i = orig.calls.length - 1; i >= 0 && sig(orig.calls[i]) === target; i--) tailSame++;
  }
  const stuckK = s.stuckK ?? (orig.end?.endReason === 'stuck' && tailSame < 60 ? 20 : undefined);
  const ep = await createEpisode({ task, seed: s.seed, tier: s.tier, logFile: job.logFile, meta: { model: s.model, runId: s.runId, hints: s.hints ?? 'standard', ...(s.protocol ? {protocol:s.protocol} : {}), ...(s.trial ? {trial:s.trial} : {}), ...(budgetToolCalls ? { budgetToolCalls } : {}), ...(stuckK ? { stuckK } : {}) } });
  for (const c of orig.calls) {
    if (ep.done) break;
    await ep.call(c.name, c.args);
  }
  ep.finish(orig.end && !ENGINE_REASONS.has(orig.end.endReason) ? orig.end.endReason : null);
}

/** Semantic metadata that determines ranking and comparability. */
export function runDigest(meta) {
  const keys=['runId','model','tier','hints','external','code','promptVersion','scoring','tasks','runtime','books','clientAccountingVersion'];
  // Optional release fields must not alter the digest of historical runs.
  for (const key of ['release','releaseId','campaign','campaignId','manifestDigest','protocol','protocols','formal','protocolVersion','effectiveBudgets','trial','trialId','condition','repetition','attempt']) {
    if (Object.hasOwn(meta, key)) keys.push(key);
  }
  return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(keys.map(k=>[k,meta[k]??null])))).digest('hex');
}

/**
 * 一局的指纹:登记成绩(.json)+ 逐步日志(.jsonl)的 sha256。写进 verify.json 的每一局,
 * 排行页据此判断核验记录是否还对应现在的成绩(核验后成绩被替换 / 重跑,指纹就变)。
 */
export function episodeDigest(jsonlPath) {
  const h = crypto.createHash('sha256');
  for (const f of [jsonlPath.replace(/\.jsonl$/, '.json'), jsonlPath]) {
    h.update(f.endsWith('.jsonl') ? '\0log\0' : '\0result\0');
    if (fs.existsSync(f)) h.update(fs.readFileSync(f));
  }
  // A cached verdict must expire when its bound raw client evidence changes.
  if (fs.existsSync(jsonlPath)) {
    try {
      const rows = fs.readFileSync(jsonlPath,'utf8').split('\n').filter(Boolean).map(JSON.parse);
      for (const ev of rows.filter(e=>e.type==='client_finalized')) {
        h.update('\0client-source\0');
        if (typeof ev.source?.file !== 'string' || path.basename(ev.source.file)!==ev.source.file) {h.update('invalid-source');continue;}
        const source=path.join(path.dirname(jsonlPath),ev.source.file);
        h.update(fs.existsSync(source) ? fs.readFileSync(source) : 'missing-source');
      }
    } catch {h.update('invalid-client-log');}
  }
  return h.digest('hex');
}

/** Restore only protocol-owned knobs; never accept paths, endpoints or secrets from logs. */
export function replayEnvironment(protocol, base = process.env) {
  const env = {...base};
  for (const key of ['BENCH_RESUME_FROM','BENCH_REPLAY_PREFIX','BENCH_REPLAY_NOTE']) delete env[key];
  if (protocol) for (const key of PROTOCOL_OVERRIDE_KEYS) {
    delete env[key];
    if (protocol.overrides?.[key] !== undefined) {
      if (typeof protocol.overrides[key] !== 'string') throw Error(`invalid protocol override ${key}`);
      env[key] = protocol.overrides[key];
    }
  }
  return env;
}

/** 新子进程按日志重放一局(引擎是全局状态,一个进程只跑一局),返回重放日志。 */
export function replayInChild(source, { runtimeRoot = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-verify-'));
  const logFile = path.join(tmp, 'replay.jsonl');
  try {
    const p = spawnSync(process.execPath, [runtimeRoot ? path.join(runtimeRoot, 'bench/bench.mjs') : benchCli, '--verify-episode', JSON.stringify({ source, logFile })], {
      stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8',
      env: { ...replayEnvironment(readLog(source).start.protocol), AGENT_PAL_SAVES: path.join(tmp, 'saves.json'), AGENT_PAL_MEMORY: '' }
    });
    if (p.status !== 0 || !fs.existsSync(logFile)) {
      const lines = (p.stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const why = lines.find((l) => /^\w*Error\b/.test(l)) || lines.slice(-3).join(' | ');
      throw new Error(`replay child exited ${p.status}: ${why}`);
    }
    return readLog(logFile);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * C 档资料核对:run.json 记的 books 与本机的是否一致。返回不一致的说明,null = 一致。
 * current 为本机指纹(booksFingerprint() 的结果,未配好为 null)。
 */
export function booksMismatch(recorded, current) {
  if (!recorded) return 'the run recorded no guide / atlas fingerprint (tier C runs before the books fingerprint are invalid; re-run)';
  if (!current) return `guide / atlas not configured here (set AGENT_PAL_GUIDE and AGENT_PAL_ATLAS_INDEX to the run's sources, books ${recorded.id})`;
  if (JSON.stringify(current) === JSON.stringify(recorded)) return null;
  const parts = [];
  if (JSON.stringify(current.guide) !== JSON.stringify(recorded.guide)) parts.push(`guide ${recorded.guide.join(', ')} → ${current.guide.join(', ')}`);
  if (current.atlas !== recorded.atlas) parts.push(`atlas ${recorded.atlas} → ${current.atlas}`);
  return `guide / atlas differ from the run's (books ${recorded.id} → ${current.id}): ${parts.join('; ')}`;
}

/** 核验一局(replay 可替换,测试用):返回 { file, task, seed, ok, verdict, diffs, warnings }。currentBooks 为本机资料指纹或返回它的函数(只有 C 档才算)。 */
export function verifyEpisode(file, { backend = 'engine-replay', runMeta = null, currentCode = undefined, currentBooks = booksFingerprint, currentRuntime = runtimeFingerprint, currentTaskFingerprint = taskFingerprint, replay = replayInChild } = {}) {
  const resultFile = file.replace(/\.jsonl$/, '.json');
  let claimed = null, orig = null, inputError = null;
  try { if (fs.existsSync(resultFile)) claimed = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch (err) { inputError = err; }
  try { if (fs.existsSync(file)) orig = readLog(file); } catch (err) { inputError = err; }
  claimed ??= orig?.end ?? null;
  const r = { file: path.basename(file), task: orig?.start.task ?? claimed?.task, seed: orig?.start.seed ?? claimed?.seed,
    claimed: claimed ? { success: !!claimed.success, endReason: claimed.endReason } : null, digest: episodeDigest(file), backend, evidenceLevel: 'not-replayed', ok: false, verdict: null, diffs: [], warnings: [] };
  if (!['engine-replay', 'log-consistency'].includes(backend)) {r.verdict='unverifiable';r.diffs.push(`unknown verification backend: ${backend}`);return r;}
  if (inputError) {r.verdict='invalid-log';r.diffs.push(String(inputError.message));return r;}
  if (!orig) {
    // 没有可重放的日志:兜底的失败结果没什么可核的;声称成功却拿不出日志 = 不可信
    r.verdict = 'no-log';
    if (claimed?.success) r.diffs.push('claims success but has no replayable log');
    else r.warnings.push('no replayable log (the episode never started); nothing to verify');
    r.ok = r.diffs.length === 0;
    return r;
  }
  const s = orig.start;
  if (runMeta?.protocols) {
    const planned = Array.isArray(runMeta.protocols) ? runMeta.protocols.find(p => p.task === s.task) : null;
    if (!planned || !same(planned.contract, s.protocol)) {
      r.verdict='unverifiable';r.diffs.push('run protocol disagrees with episode protocol');return r;
    }
  }
  if (!orig.end) r.warnings.push('the episode did not finish normally (no end event); only its calls were replayed');
  let task;
  try { task = loadTask(s.task); } catch (err) { r.verdict = 'unverifiable'; r.diffs.push(`task ${s.task}: ${err.message}`); return r; }
  if (task.version !== s.taskVersion) {
    r.verdict = 'unverifiable';
    r.diffs.push(`task ${s.task} is now version ${task.version}, the run used version ${s.taskVersion}`);
    return r;
  }
  if (task.scoring && runMeta && !runMeta.runtime) { r.verdict='unverifiable';r.diffs.push('formal battle task run is missing runtime / assets fingerprint');return r; }
  if (task.scoring && runMeta) {
    const planned = Array.isArray(runMeta.tasks) ? runMeta.tasks.find(t=>t.id===task.id) : null;
    let policy;try {policy=runMeta.tasks?.map(t=>loadTask(t.id).scoring?.secondary === 'battleRounds');}catch(err){r.verdict='unverifiable';r.diffs.push(`run task list invalid: ${err.message}`);return r;}
    const scoring = policy?.every(Boolean) ? 'battleRounds' : policy?.some(Boolean) ? 'mixed' : 'cost';
    if (path.basename(file)!==`${s.task}__s${s.seed}.jsonl` || !planned || planned.version!==s.taskVersion || !planned.seeds?.includes(s.seed) || !same(planned.fingerprint,s.fingerprint) || runMeta.scoring!==scoring || runMeta.model!==s.model) {
      r.verdict='unverifiable'; r.diffs.push('run scoring / task / seed / model identity disagrees with episode'); return r;
    }
  }
  if (backend === 'log-consistency') r.warnings.push('log consistency only: runtime/assets and engine behavior were not replayed or certified');
  if (runMeta?.runtime && backend === 'engine-replay') {
    let runtime; try { runtime = typeof currentRuntime === 'function' ? currentRuntime() : currentRuntime; } catch(err) { r.verdict='unverifiable'; r.diffs.push(`runtime fingerprint: ${err.message}`); return r; }
    if (!same(runMeta.runtime, runtime)) { r.verdict='unverifiable'; r.diffs.push('runtime or assets fingerprint changed'); return r; }
  }
  if (s.fingerprint) {
    let fingerprint;try { fingerprint = currentTaskFingerprint(task); }catch(err){r.verdict='unverifiable';r.diffs.push(`task or starting save fingerprint: ${err.message}`);return r;}
    if (!same(s.fingerprint, fingerprint)) {r.verdict='unverifiable';r.diffs.push('task or starting save fingerprint changed');return r;}
  }
  // 档位以 run.json 为准(score 按它上榜):日志里的档位对不上就不核,免得 B 档的局冒充 C 档绕过资料核对
  if (runMeta?.tier && s.tier !== runMeta.tier) {
    r.verdict = 'unverifiable';
    r.diffs.push(`episode tier ${s.tier} disagrees with the run's tier ${runMeta.tier}`);
    return r;
  }
  if ((runMeta?.tier ?? s.tier) === 'C') {
    let why;
    try { why = booksMismatch(runMeta?.books ?? null, typeof currentBooks === 'function' ? currentBooks() : currentBooks); }
    catch (err) { why = `cannot fingerprint the local guide / atlas: ${err?.message || err}`; }   // 索引坏了 / 文件读不了:这一局判不可核验,别中断整次核验
    if (why) { r.verdict = 'unverifiable'; r.diffs.push(why); return r; }
  }
  if (runMeta?.code && currentCode !== undefined && runMeta.code !== currentCode) {
    r.warnings.push(`code ${currentCode ?? '?'} differs from the run's ${runMeta.code}`);
  }
  if (runMeta?.code?.endsWith('-dirty')) {
    r.warnings.push(`run recorded on dirty worktree (${runMeta.code})`);
  }
  if (orig.turns?.length > 0 && orig.calls.length > 0 && (orig.end?.tokensOut || 0) === 0) {
    r.warnings.push('zero output tokens across tool calls (non-generative / custom decision adapter)');
  }
  let replayed;
  try { replayed = backend === 'log-consistency' ? orig : replay(path.resolve(file)); } catch (err) { r.verdict = 'error'; r.diffs.push(String(err?.message || err)); return r; }
  r.diffs = compareLogs(orig, replayed, claimed);
  if (orig.clientFinalized && orig.clientFinalized.result.accountingStatus !== 'complete') r.warnings.push(`client accounting ${orig.clientFinalized.result.accountingStatus}: usage/cost unknown, not zero`);
  if (!orig.clientFinalized && orig.end?.accountingStatus === 'incomplete') r.warnings.push('built-in accounting incomplete: measured prefix retained; whole-trial usage/cost unknown, not zero');
  r.ok = r.diffs.length === 0;
  r.evidenceLevel = backend;
  r.verdict = r.ok ? (backend === 'engine-replay' ? 'verified' : 'consistent') : 'mismatch';
  return r;
}

/**
 * 一次运行里要核验的局:以登记的成绩(episodes/<task>__s<seed>.json,score 读的就是它)为准,
 * 再补上只有日志没有成绩的;返回各局的逐步日志路径(.jsonl,文件可能不存在)。外部 agent 的 .client.jsonl 不算。
 */
export const episodeLogs = (runDir) => {
  const dir = path.join(runDir, 'episodes');
  const bases = new Set(fs.readdirSync(dir).map((f) => f.match(/^(.+__s-?\d+)\.jsonl?$/)?.[1]).filter(Boolean));
  return [...bases].sort().map((b) => path.join(dir, `${b}.jsonl`));
};

/** bench verify:目录 = 整次运行(写 verify.json),文件 = 单局。返回各局结果。 */
export function verify(target, { replay = replayInChild, runtimeRoot = null, backend = 'engine-replay' } = {}) {
  if (runtimeRoot) {
    runtimeRoot = path.resolve(runtimeRoot);
    if (replay === replayInChild) replay = source => replayInChild(source, {runtimeRoot});
  }
  const isDir = fs.statSync(target).isDirectory();
  const runDir = isDir ? target : path.dirname(path.dirname(path.resolve(target)));
  const runFile = path.join(runDir, 'run.json');
  const runMeta = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : null;
  const currentCode = codeRev(runDir);
  let runtime;
  const currentRuntime = () => {
    if (runtime) return runtime;
    if (!runtimeRoot) return (runtime = runtimeFingerprint());
    const script = `import {pathToFileURL} from 'node:url'; const m=await import(pathToFileURL(process.argv[1])); process.stdout.write(JSON.stringify(m.runtimeFingerprint()));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, path.join(runtimeRoot, 'bench/start.mjs')], {encoding:'utf8'});
    if (result.status !== 0) throw Error('frozen runtime fingerprint failed: '+result.stderr);
    return (runtime = JSON.parse(result.stdout));
  };
  let books;                                                   // 本机资料指纹:遇到 C 档才算,算一次
  const currentBooks = () => (books === undefined ? (books = booksFingerprint()) : books);
  const files = isDir ? episodeLogs(target) : [target];
  const results = [];
  for (const f of files) {
    const r = verifyEpisode(f, { runMeta, currentCode, currentBooks, currentRuntime, replay, backend });
    results.push(r);
    const claim = r.claimed ? `${r.claimed.success ? 'success' : 'no success'} (${r.claimed.endReason})` : 'no result';
    console.log(`${r.ok ? '✓' : '✗'} ${r.task} seed ${r.seed}: ${r.verdict} · claimed ${claim}`);
    for (const d of r.diffs) console.log(`    ${d}`);
    for (const w of r.warnings) console.log(`    note: ${w}`);
  }
  if (isDir && backend === 'engine-replay') {
    fs.writeFileSync(path.join(runDir, 'verify.json'), JSON.stringify({ backend, evidenceLevel: results.every(r => r.evidenceLevel === backend) ? backend : results.every(r => r.evidenceLevel === 'not-replayed') ? 'not-replayed' : 'mixed', verifiedAt: new Date().toISOString(), code: currentCode, ...(runtimeRoot ? {replayRuntimeRoot:runtimeRoot} : {}), ...(runMeta?.runtime ? {runDigest:runDigest(runMeta)} : {}), episodes: results }, null, 2));
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} episode(s) passed ${backend}`);
  return results;
}

/** Strict formal certification; unlabeled historical evidence retains unknown provenance. */
export function replayCertification(result) {
  return result?.ok === true && result.verdict === 'verified' && result.backend === 'engine-replay' && result.evidenceLevel === 'engine-replay';
}
