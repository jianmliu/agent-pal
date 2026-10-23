/**
 * bench.test — 谓词求值与题目校验的单元测试(纯函数,不起引擎、不需要游戏资产 → 可进 CI)。
 *
 *   node apps/agent-pal/bench/test/bench.test.mjs
 *
 * 题目「可解」的端到端验证(回放参考解)要游戏资产,本地跑:bench.mjs check。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { evaluate, validatePredicate } from '../predicates.mjs';
import { validateTask, listTasks, loadTask, loadReference, TASK_DIR } from '../task.mjs';
import { compact, runLoop, KEEP_OBS } from '../loop.mjs';
import { score } from '../score.mjs';
import { costOf, postJson, createProvider, geminiSchema } from '../providers.mjs';
import http from 'node:http';
import { grade, validateQuiz, listQuizzes, loadQuiz, finalAnswer } from '../quiz.mjs';
import { guideText } from '../../src/guide.mjs';
import { resumeMismatch, cleanClaudeEnv, codeRev, applyClientResult, booksFingerprint, parFor } from '../runner.mjs';
import { isSoftStop, resultLabel } from '../../src/tools.mjs';
import { pixelResult, toolContent, TIER_TOOLS, BOOK_TOOLS, bookTool, NON_ADVANCING, createStuckCounter, toolNames, referenceTools, referenceToolErrors, replayReferenceStep } from '../episode.mjs';
import { runTool } from '../../src/tools.mjs';
import { systemPrompt, PROMPT_VERSION } from '../prompt.mjs';
import { compareLogs, readLog, verifyEpisode, verify, episodeDigest, booksMismatch } from '../verify.mjs';
import { collectRuns, mergeRunsByModel, rank, paretoFront, renderBoard, board, verifyStatus, collectQuizzes } from '../board.mjs';
import { classifySubmissionDiff, checkPrSubmission } from '../pr-check.mjs';

const base = {
  scene: 4, pos: { gx: 95, gy: 88 }, visitedScenes: [1, 3, 4],
  party: [{ roleId: 0, name: '李逍遙', level: 1, hp: 150, maxHp: 150, mp: 100, maxMp: 100 }],
  inventory: [{ itemId: 284, name: '止血草', amount: 2 }, { itemId: 300, name: '桂花酒', amount: 0 }],
  cash: 500, mode: 'control', inBattle: false,
  battles: [{ enemyTeam: 7, outcome: 'won' }],
  eventObjects: [{ idx: 9, state: 1, triggerScript: 4660, autoScript: 0 }],
  textLog: ['醉道士：十里坡"山神廟"。不見不散！', '李逍遙：兩位大爺！酒菜送來了']
};
const ok = (p, v = base) => assert.equal(evaluate(p, v), true, JSON.stringify(p));
const no = (p, v = base) => assert.equal(evaluate(p, v), false, JSON.stringify(p));

// ① 原子谓词
ok({ sceneIs: 4 }); no({ sceneIs: 3 });
ok({ sceneVisited: 3 }); no({ sceneVisited: 9 });
ok({ at: { scene: 4, gx: 95, gy: 88 } }); ok({ at: { scene: 4, gx: 97, gy: 88, r: 2 } }); no({ at: { scene: 4, gx: 98, gy: 88, r: 2 } });
ok({ hasItem: { name: '止血草' } }); ok({ hasItem: { id: 284, min: 2 } }); no({ hasItem: { id: 284, min: 3 } });
no({ hasItem: { name: '桂花酒' } }, base);                  // 数量 0 = 没有(送出去的酒仍留空槽)
ok({ partyIncludes: '李逍遙' }); ok({ partyIncludes: 0 }); no({ partyIncludes: '趙靈兒' });
ok({ levelAtLeast: { n: 1 } }); no({ levelAtLeast: { role: '李逍遙', n: 2 } });
ok({ cashAtLeast: 500 }); no({ cashAtLeast: 501 });
ok({ battleWon: {} }); ok({ battleWon: { enemyTeam: 7 } }); no({ battleWon: { enemyTeam: 8 } });
no({ partyWiped: true }); ok({ partyWiped: true }, { ...base, battles: [{ enemyTeam: 7, outcome: 'lost' }] });
ok({ partyWiped: true }, { ...base, battles: [], party: [{ ...base.party[0], hp: 0 }] });
ok({ textSeen: '十里坡' }); no({ textSeen: '仙靈島' }); ok({ textSeen: { regex: '酒菜.*了$' } });
ok({ eventObject: { scene: 4, idx: 9, state: 1 } }); no({ eventObject: { scene: 3, idx: 9 } }); no({ eventObject: { scene: 4, idx: 9, state: 2 } });
console.log('  ✓ ① 原子谓词');

// ② 组合子
ok({ all: [{ sceneIs: 4 }, { textSeen: '十里坡' }] }); no({ all: [{ sceneIs: 4 }, { sceneIs: 3 }] });
ok({ any: [{ sceneIs: 3 }, { sceneIs: 4 }] }); no({ any: [{ sceneIs: 1 }, { sceneIs: 2 }] });
ok({ not: { hasItem: { name: '桂花酒' } } });
ok({ all: [{ textSeen: '十里坡' }, { not: { hasItem: { name: '桂花酒' } } }] });   // 规格 §3 的示例目标
console.log('  ✓ ② all / any / not');

// ③ 谓词校验
assert.deepEqual(validatePredicate({ sceneIs: 4 }), []);
assert.match(validatePredicate({ sceneIs: 4, cashAtLeast: 1 })[0], /exactly one key/);
assert.match(validatePredicate({ teleported: true })[0], /unknown predicate/);
assert.match(validatePredicate({ all: [] })[0], /non-empty array/);
assert.match(validatePredicate({ hasItem: {} })[0], /needs id or name/);
assert.match(validatePredicate({ any: [{ sceneIs: 1 }, { textSeen: 3 }] })[0], /any\[1\]\.textSeen/);
console.log('  ✓ ③ 谓词结构校验(含路径定位)');

// ④ 题目:仓里的题全部合法,且每题都有参考解(可解的证明)
const ids = listTasks();
assert.ok(ids.length >= 3, `expected ≥ 3 tasks, found ${ids.length}`);
for (const id of ['pal-ch1-island', 'pal-ch1-corridor']) {
  assert.ok(ids.includes(id), `${id}: missing difficulty-gradient task`);
  const task = loadTask(id);
  assert.deepEqual(task.goal, loadTask('pal-ch1-meet-linger').goal, `${id}: must retain the same first-meeting goal`);
  assert.ok(!task.disallowTools?.includes('save'), `${id}: normal gradient must not add hardcore restrictions`);
}
for (const id of ids) {
  const t = loadTask(id);                                     // 不合法会抛
  const ref = loadReference(id);
  assert.ok(ref, `${id}: missing bench/reference/${id}.json`);
  for (const seed of t.seeds) {
    const steps = ref.bySeed ? ref.bySeed[String(seed)] : ref.steps;
    assert.ok(Array.isArray(steps) && steps.length, `${id}: reference has no steps for seed ${seed}`);
    assert.ok(Number.isInteger(ref.par?.[String(seed)]), `${id}: reference has no par for seed ${seed} (bench check --write-par)`);
  }
  // 预算至少留 3 倍 par 的探索余地(par 是知道答案的人走的步数;预算贴着 par 等于不许探索)
  const maxPar = Math.max(...Object.values(ref.par));
  assert.ok(t.budget.toolCalls >= 3 * maxPar, `${id}: budget.toolCalls ${t.budget.toolCalls} < 3 × par ${maxPar}`);
  // token 预算不能先于调用预算触发:内置循环每轮重发上下文,实测 7–9k token / 次调用
  assert.ok(!t.budget.tokens || t.budget.tokens >= 12000 * t.budget.toolCalls, `${id}: budget.tokens ${t.budget.tokens} < 12000 × toolCalls`);
}
const good = JSON.parse(fs.readFileSync(path.join(TASK_DIR, `${ids[0]}.json`), 'utf8'));
assert.deepEqual(validateTask(good), []);
assert.ok(validateTask({ ...good, start: { rpg: '01.rpg', newGame: true } }).some((e) => /exactly one of/.test(e)));
assert.ok(validateTask({ ...good, seeds: [] }).some((e) => /seeds/.test(e)));
assert.ok(validateTask({ ...good, tiers: ['D'] }).some((e) => /tiers/.test(e)));
assert.ok(validateTask({ ...good, goal: { nope: 1 } }).some((e) => /unknown predicate/.test(e)));
console.log(`  ✓ ④ ${ids.length} 道题全部合法、都有参考解与 par、预算 ≥ 3×par、token 预算 ≥ 12k×调用;坏题被拒`);

// ⑤ 内置循环的上下文规则:只留最近 6 条工具结果全文,其余占位;模型自己的话全留
const hist = [{ role: 'user', text: 'brief' }];
for (let i = 0; i < 9; i++) hist.push({ role: 'assistant', text: `t${i}`, calls: [] }, { role: 'tool', id: `c${i}`, name: 'observe', text: `obs${i}` });
const ch = compact(hist);
assert.equal(ch.length, hist.length);
assert.deepEqual(ch.filter((h) => h.role === 'tool').map((h) => h.text.startsWith('obs')), [false, false, false, true, true, true, true, true, true]);
assert.ok(ch.filter((h) => h.role === 'assistant').every((h, i) => h.text === `t${i}`));
assert.equal(hist[2].text, 'obs0', 'compact must not mutate history');
assert.deepEqual(ch.filter((h) => h.role === 'tool').map((h) => !!h.elided), [true, true, true, false, false, false, false, false, false]);   // 占位标 elided(缓存断点用)
console.log('  ✓ ⑤ 上下文截断规则');

// ⑥ 价格:已知价按 $/Mtok 算,未知价是 null(不编数)
assert.equal(costOf('ollama:qwen2.5:3b', { tokensIn: 1e6, tokensOut: 1e6 }), 0);
assert.equal(costOf('nope:model', { tokensIn: 1, tokensOut: 1 }), null);
// 登记的价格:每条都是非负数,所属 provider 在 _sources 里有官方来源与核对日期
{
  const prices = JSON.parse(fs.readFileSync(new URL('../prices.json', import.meta.url), 'utf8'));
  const providers = new Set(['ollama', 'replay', 'claude-cli', ...Object.keys(prices._sources || {})]);
  for (const [k, v] of Object.entries(prices)) {
    if (k.startsWith('_')) continue;
    assert.ok(Number.isFinite(v.in) && v.in >= 0 && Number.isFinite(v.out) && v.out >= 0, `price ${k}`);
    const prov = k.split(':')[0];
    assert.ok(['ollama', 'replay'].includes(prov) || /^https:\/\//.test(prices._sources[prov]?.url) && /^\d{4}-\d{2}-\d{2}$/.test(prices._sources[prov]?.retrieved), `${k}: no source for provider ${prov}`);
  }
  assert.ok(providers.has('anthropic') && providers.has('openai') && providers.has('gemini'));
  assert.equal(costOf('anthropic:claude-opus-5-5', { tokensIn: 1e6, tokensOut: 1e6 }), 24);
  // 缓存:tokensIn 含缓存读写,读写部分按缓存价(Opus 5.5:读 $0.20、5 分钟写 $5、输入 $4)
  assert.ok(Math.abs(costOf('anthropic:claude-opus-5-5', { tokensIn: 1e6, tokensOut: 0, cacheRead: 5e5, cacheWrite: 1e5 }) - (4e5 * 4 + 5e5 * 0.2 + 1e5 * 5) / 1e6) < 1e-9);
  assert.ok(Math.abs(costOf('openai:gpt-4o', { tokensIn: 1e6, tokensOut: 0, cacheRead: 1e6 }) - 1.25) < 1e-9);
  for (const [k, v] of Object.entries(prices)) if (!k.startsWith('_') && v.cacheRead != null) assert.ok(v.cacheRead <= v.in && (v.cacheWrite == null || v.cacheWrite >= v.in), `cache price ${k}`);
  // 地址被覆盖(代理 / 兼容服务)时不套官方价
  assert.equal(costOf('openai:gpt-4o', { tokensIn: 1e6, tokensOut: 0 }, { BENCH_OPENAI_BASE_URL: 'http://proxy' }), null);
  assert.equal(costOf('anthropic:claude-opus-5-5', { tokensIn: 1, tokensOut: 1 }, { BENCH_ANTHROPIC_BASE_URL: 'http://x' }), null);
  assert.equal(costOf('gemini:gemini-2.5-pro', { tokensIn: 1, tokensOut: 1 }, { BENCH_GEMINI_BASE_URL: 'http://x' }), null);
  assert.equal(costOf('openai:gpt-4o', { tokensIn: 1e6, tokensOut: 0 }, { BENCH_ANTHROPIC_BASE_URL: 'http://x' }), 2.5);   // 别家的覆盖不影响
  assert.equal(costOf('ollama:qwen2.5:3b', { tokensIn: 1, tokensOut: 1 }, { BENCH_OLLAMA_BASE_URL: 'http://x' }), 0);     // 本地模型本来就是 0
}
console.log('  ✓ ⑥ 价目表(每条有官方来源与核对日期)');

// ⑦ score:按题聚合 success / progress / par 效率,总分 = 各题 success 率均值;未知 cost 不当 0
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-score-'));
  fs.mkdirSync(path.join(dir, 'episodes'));
  const t = loadTask('classic08-leave-area');
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ runId: 'x', model: 'm:x', tier: 'B', tasks: [{ id: t.id, version: t.version, seeds: [42, 43] }] }));
  const ep = (seed, success, extra) => fs.writeFileSync(path.join(dir, 'episodes', `${t.id}__s${seed}.json`), JSON.stringify({
    task: t.id, seed, success, successAt: success ? 4 : null, endReason: success ? 'success' : 'stuck', progress: success ? 1 : 0.5,
    toolCalls: success ? 4 : 30, invalidCalls: 1, tokensIn: 100, tokensOut: 10, cost: 0.01, virtualSeconds: 5, ...extra
  }));
  ep(42, true); ep(43, false, { cost: null });
  const sm = score(dir);
  assert.equal(sm.complete, true);
  assert.equal(sm.score, 0.5);
  assert.equal(sm.progress, 0.75);
  assert.equal(sm.costTotal, null);                 // 有一局未知价 → 总价未知
  assert.equal(sm.costMeanOnSuccess, 0.01);
  assert.equal(sm.tasks[0].episodes[0].efficiency, +(loadReference(t.id).par['42'] / 4).toFixed(3));
  assert.deepEqual(sm.tasks[0].endReasons, { success: 1, stuck: 1 });
  assert.ok(fs.existsSync(path.join(dir, 'summary.json')));
  // par 以 run.json 开跑时冻结的为准:参考解后来重录,旧运行的效率分不变
  const rj = path.join(dir, 'run.json');
  fs.writeFileSync(rj, JSON.stringify({ ...JSON.parse(fs.readFileSync(rj, 'utf8')), tasks: [{ id: t.id, version: t.version, seeds: [42, 43], par: { 42: 2, 43: 2 } }] }));
  assert.equal(score(dir).tasks[0].episodes[0].efficiency, 0.5);                        // 2 / 4,不是当前参考解的 par
  assert.deepEqual(parFor(t.id, [42, 99]), { 42: loadReference(t.id).par['42'], 99: null });
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('  ✓ ⑦ score 聚合');

// ⑧ 续跑核对:冻结元数据任何一项不同都拒绝(否则新旧配置的局混进同一张表)
{
  const base = { model: 'm:x', tier: 'B', promptVersion: 2, code: 'abc123', tasks: [{ id: 't', version: 3, seeds: [1, 2] }] };
  assert.deepEqual(resumeMismatch(base, { ...base, runId: 'other', startedAt: 'later' }), [], 'runId / startedAt may differ');
  for (const [k, v] of [['model', 'm:y'], ['tier', 'C'], ['promptVersion', 3], ['code', 'def456']]) {
    const d = resumeMismatch(base, { ...base, [k]: v });
    assert.equal(d.length, 1); assert.match(d[0], new RegExp(`^${k}:`));
  }
  assert.equal(resumeMismatch(base, { ...base, tasks: [{ id: 't', version: 4, seeds: [1, 2] }] }).length, 1, 'task version');
  // 提示档位:旧 run.json 没有 hints = standard
  assert.deepEqual(resumeMismatch(base, { ...base, hints: 'standard' }), [], 'missing hints = standard');
  assert.equal(resumeMismatch(base, { ...base, hints: 'full' }).length, 1, 'hints full vs standard');
  assert.equal(resumeMismatch(base, { ...base, tasks: [{ id: 't', version: 3, seeds: [1, 2, 3] }] }).length, 1, 'seeds');
  assert.equal(resumeMismatch(base, { ...base, tasks: [...base.tasks, { id: 'u', version: 1, seeds: [1] }] }).length, 1, 'task list');
}
// 代码版本:整个工作区的改动都算 dirty,本次运行的输出目录除外(否则 --out 指到仓库里时续跑会被拒)
{
  const { execFileSync } = await import('node:child_process');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-rev-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'engine'));
  fs.writeFileSync(path.join(repo, 'engine', 'a.ts'), '1');
  git('add', '.'); git('commit', '-qm', 'init');
  const clean = codeRev(null, repo);
  assert.match(clean, /^[0-9a-f]+$/);
  const out = path.join(repo, 'runs', 'r1');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'run.json'), '{}');
  assert.equal(codeRev(out, repo), clean, 'files in the run directory itself do not make the tree dirty');
  assert.equal(codeRev(null, repo), `${clean}-dirty`, 'without the exclusion they would');
  fs.writeFileSync(path.join(repo, 'engine', 'a.ts'), '2');
  assert.equal(codeRev(out, repo), `${clean}-dirty`, 'a change anywhere else (e.g. the engine) is dirty');
  assert.equal(codeRev(path.join(os.tmpdir(), 'elsewhere'), repo), `${clean}-dirty`, 'an --out outside the repo excludes nothing');
  fs.rmSync(repo, { recursive: true, force: true });
}
console.log('  ✓ ⑧ 续跑前核对冻结元数据;代码版本不把本次输出算作改动');

// ⑨ claude 子进程环境:去掉宿主会话注入的变量,留下登录 / 配置
{
  const env = cleanClaudeEnv({
    PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SSE_PORT: '1234', MCP_TIMEOUT: '5',
    ANTHROPIC_BASE_URL: 'http://host-proxy', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: '/cfg'
  });
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'PATH']);
}
// 外部 agent 的用量:与内置循环同口径(tokensIn 含缓存读写,另记缓存读 / 写);没有 result 事件 = 客户端出错
{
  const r = applyClientResult({ endReason: 'success' }, { usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 7 }, total_cost_usd: 0.12, num_turns: 3 }, 'm');
  assert.deepEqual([r.tokensIn, r.tokensOut, r.tokensCached, r.tokensCacheWrite, r.cost, r.external, r.client.numTurns], [1000, 7, 900, 90, 0.12, true, 3]);
  const e = applyClientResult({ endReason: null }, null, 'm');
  assert.deepEqual([e.endReason, e.cost, e.tokensCacheWrite], ['client-error', null, 0]);
}
console.log('  ✓ ⑨ claude 子进程环境');

// ⑪ 重放核验:逐次调用的判分快照、终局、登记成绩三方对照;题目改版 / 没日志 / 重放出错各有判定
{
  const t0 = loadTask(ids.find(id=>!loadTask(id).scoring)); // Legacy-log compatibility fixture.
  const call = (i, over = {}) => ({ type: 'call', i, name: 'step', args: { dir: 'up' }, ok: true, scene: 4, pos: { gx: 1, gy: i }, mode: 'control', vt: i, success: false, milestones: { m: null }, stop: null, ...over });
  const end = (over = {}) => ({ type: 'end', task: t0.id, seed: 7, success: false, successAt: null, failed: false, failAt: null, stuck: false, crashed: false,
    milestones: { m: 2 }, toolCalls: 3, invalidCalls: 0, virtualSeconds: 3, progress: 0.5, endReason: 'budget-tokens', tokensIn: 999, ...over });
  const log = (over = {}) => ({ start: { type: 'start', task: t0.id, taskVersion: t0.version, seed: 7, tier: 'B' }, calls: [call(1), call(2), call(3)], end: end(), ...over });

  // 纯对照
  assert.deepEqual(compareLogs(log(), log({ end: end({ endReason: 'agent-stopped', tokensIn: 0 }) })), []);   // 模型侧的终止原因与 token 不比
  const drift = log({ calls: [call(1), call(2, { scene: 5 }), call(3, { scene: 5 })] });
  const d1 = compareLogs(log(), drift);
  assert.equal(d1.length, 1);                                               // 只报第一处分歧
  assert.match(d1[0], /call #2 step: scene 4 → 5/);
  assert.match(compareLogs(log(), log({ calls: [call(1), call(2)] }))[0], /call count: logged 3, replayed 2/);
  assert.match(compareLogs(log(), log({ end: end({ virtualSeconds: 4 }) }))[0], /final virtualSeconds: 3 → 4/);
  const won = log({ end: end({ success: true, successAt: 3, progress: 1, endReason: 'success' }) });
  assert.ok(compareLogs(won, log({ end: end({ endReason: 'agent-stopped' }) })).some((x) => /endReason: success → agent-stopped/.test(x)));
  assert.match(compareLogs(log(), log(), { ...end(), success: true })[0], /result file success true disagrees/);   // 改了成绩文件
  assert.match(compareLogs(log(), log(), { ...end(), seed: 8 })[0], /result file seed 8 disagrees/);           // 记到别的种子 / 题 / 终止原因上
  assert.match(compareLogs(log(), log(), { ...end(), task: 'other' })[0], /result file task "other" disagrees/);
  assert.match(compareLogs(log(), log(), { ...end(), endReason: 'success' })[0], /result file endReason "success" disagrees/);
  assert.match(compareLogs(log(), log(), { ...end(), tokensIn: 10 })[0], /result file tokensIn 10 disagrees/);
  assert.match(compareLogs(log({ end: end({ cost: 0.25 }) }), log(), { ...end(), cost: 0.01 })[0], /result file cost 0\.01 disagrees/);
  assert.match(compareLogs(log({ turns: [{ type: 'turn', i: 1, usage: { tokensIn: 800, tokensOut: 50 } }], end: end({ tokensIn: 500, tokensOut: 50 }) }), log())[0], /end tokensIn 500 < sum of turn tokensIn 800/);
  assert.match(compareLogs(log({ turns: [{ type: 'turn', i: 1, usage: { tokensIn: 60, tokensOut: 10 } }, { type: 'turn', i: 2, usage: { tokensIn: 60, tokensOut: 10 } }], end: end({ tokensIn: 120, tokensOut: 20 }) }), log())[0], /below physical prompt minimum/);
  assert.match(compareLogs(log({ start: { ...log().start, model: 'openai:gpt-5.4' }, end: end({ model: 'openai:gpt-5.4', tokensIn: 10000, tokensOut: 1000, cost: 0.0001 }) }), log())[0], /disagrees with official price table/);
  assert.deepEqual(compareLogs(log({ end: null }), log({ end: null }), { success: false }), []);
  assert.match(compareLogs(log({ end: null }), log({ end: null }), { success: true })[0], /no end event/);

  // 整次运行:文件布局、成绩文件、verify.json
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-verify-'));
  const ep = path.join(dir, 'episodes');
  fs.mkdirSync(ep);
  const writeEp = (base, l, result) => {
    if (l) fs.writeFileSync(path.join(ep, `${base}.jsonl`), [l.start, ...l.calls, l.end].filter(Boolean).map((x) => JSON.stringify(x)).join('\n') + '\n');
    if (result) fs.writeFileSync(path.join(ep, `${base}.json`), JSON.stringify(result));
  };
  writeEp(`${t0.id}__s7`, log(), end());                                       // 正常
  writeEp(`${t0.id}__s8`, log(), { ...end(), success: true });                 // 成绩被改
  writeEp(`${t0.id}__s9`, log({ start: { ...log().start, taskVersion: t0.version + 1 } }), end());   // 题目改版
  writeEp(`${t0.id}__s10`, null, { task: t0.id, seed: 10, success: false, endReason: 'harness-crash (exit 1)' });   // 没开局就崩
  writeEp(`${t0.id}__s11`, null, { task: t0.id, seed: 11, success: true });   // 声称成功却没日志
  fs.writeFileSync(path.join(ep, `${t0.id}__s7.client.jsonl`), 'not a log\n');
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ code: 'abc1234' }));
  const replays = [];
  const fake = (file) => { replays.push(path.basename(file)); return readLog(file); };   // 重放 = 原样(引擎确定性时就是这样)
  const origLog = console.log; console.log = () => {};
  let rs;
  try { rs = verify(dir, { replay: fake }); } finally { console.log = origLog; }
  const by = Object.fromEntries(rs.map((r) => [r.file.match(/__s(\d+)\./)[1], r]));
  assert.equal(rs.length, 5);
  assert.equal(by[7].verdict, 'verified', JSON.stringify(by[7])); assert.equal(by[7].ok, true);
  assert.equal(by[8].verdict, 'mismatch');
  assert.equal(by[9].verdict, 'unverifiable'); assert.match(by[9].diffs[0], /now version/);
  assert.equal(by[10].verdict, 'no-log'); assert.equal(by[10].ok, true);
  assert.equal(by[11].verdict, 'no-log'); assert.equal(by[11].ok, false);
  assert.deepEqual(replays.sort(), [`${t0.id}__s7.jsonl`, `${t0.id}__s8.jsonl`]);   // 题目改版的不重放
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'verify.json'), 'utf8'));
  assert.equal(saved.episodes.length, 5);
  const boom = verifyEpisode(path.join(ep, `${t0.id}__s7.jsonl`), { replay: () => { throw new Error('replay child exited 1'); } });
  assert.equal(boom.verdict, 'error'); assert.equal(boom.ok, false);

  // C 档:本机资料指纹必须与 run.json 的 books 一致才重放(资料内容不进日志,换了资料重放照样对得上)
  const books = { id: 'aaaa1111', guide: ['g.txt@111111111111'], atlas: '222222222222 (3 images)' };
  assert.equal(booksMismatch(books, { ...books }), null);
  assert.match(booksMismatch(null, books), /recorded no guide/);
  assert.match(booksMismatch(books, null), /not configured here.*books aaaa1111/);
  assert.match(booksMismatch(books, { ...books, id: 'bbbb2222', atlas: '333333333333 (3 images)' }), /aaaa1111 → bbbb2222\): atlas 222222222222 \(3 images\) → 333333333333/);
  assert.match(booksMismatch(books, { ...books, id: 'cccc3333', guide: ['g.txt@999999999999'] }), /guide g\.txt@111111111111 → g\.txt@999999999999$/);
  const cLog = log({ start: { ...log().start, tier: 'C' }, end: end({ tier: 'C' }) });
  writeEp(`${t0.id}__s20`, cLog, { ...end(), tier: 'C' });
  const cFile = path.join(ep, `${t0.id}__s20.jsonl`);
  const cRun = { code: 'abc1234', tier: 'C', books };
  replays.length = 0;
  const vc = (runMeta, currentBooks) => verifyEpisode(cFile, { runMeta, currentBooks, replay: fake });
  assert.equal(vc(cRun, () => ({ ...books })).verdict, 'verified');
  for (const [runMeta, cur, re] of [[cRun, () => ({ ...books, id: 'x', atlas: 'y' }), /differ from the run's/], [cRun, null, /not configured/], [{ code: 'abc1234', tier: 'C' }, books, /recorded no guide/]]) {
    const r = vc(runMeta, cur);
    assert.deepEqual([r.verdict, r.ok], ['unverifiable', false]); assert.match(r.diffs[0], re);
  }
  const broken = vc(cRun, () => { throw new Error('Unexpected token } in JSON'); });   // 本机索引坏了:判这一局,不中断
  assert.equal(broken.verdict, 'unverifiable'); assert.match(broken.diffs[0], /cannot fingerprint the local guide \/ atlas: Unexpected token/);
  // 档位以 run.json 为准:C 档运行目录里混进 B 档的局,判不可核验(不能绕过资料核对)
  const sneaky = verifyEpisode(path.join(ep, `${t0.id}__s7.jsonl`), { runMeta: cRun, currentBooks: () => assert.fail('must not reach books'), replay: fake });
  assert.equal(sneaky.verdict, 'unverifiable'); assert.match(sneaky.diffs[0], /episode tier B disagrees with the run's tier C/);
  assert.deepEqual(replays, [`${t0.id}__s20.jsonl`]);                                  // 资料对不上的不重放
  let asked = 0;
  assert.equal(verifyEpisode(path.join(ep, `${t0.id}__s7.jsonl`), { runMeta: { code: 'abc1234', tier: 'B' }, currentBooks: () => { asked++; return null; }, replay: fake }).verdict, 'verified');
  assert.equal(asked, 0);                                                                // B 档的局不看资料
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('  ✓ ⑪ 重放核验:逐次判分 / 终局 / 登记成绩对照,改版、缺日志、重放出错;C 档资料指纹');

// ⑫ 排行页:按档分开、外部 agent 单列、score 降序同分比 cost、帕累托前沿、核验状态、HTML 转义
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-board-'));
  const t = loadTask('classic08-leave-area');
  const mkRun = (name, { model, tier = 'B', external = false, wins, cost, verifyOk = null, seeds = [42, 43] }) => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'episodes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ runId: name, model, tier, external, code: 'abc1234', tasks: [{ id: t.id, version: t.version, seeds }] }));
    seeds.forEach((seed, i) => fs.writeFileSync(path.join(dir, 'episodes', `${t.id}__s${seed}.json`), JSON.stringify({
      task: t.id, seed, success: i < wins, successAt: i < wins ? 5 : null, endReason: i < wins ? 'success' : 'stuck', progress: i < wins ? 1 : 0.5,
      toolCalls: 10, invalidCalls: 0, tokensIn: 1000, tokensOut: 100, cost, virtualSeconds: 9
    })));
    // verify.json 按局记文件名与指纹(同 bench verify 写的格式)
    if (verifyOk != null) fs.writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({ episodes: verifyOk.map((ok, i) => {
      const log = path.join(dir, 'episodes', `${t.id}__s${seeds[i]}.jsonl`);
      return { file: path.basename(log), ok, digest: episodeDigest(log) };
    }) }));
    return dir;
  };
  const dirs = [
    mkRun('a', { model: 'p:cheap', wins: 1, cost: 0.01, verifyOk: [true, true] }),          // 50%,便宜 → 前沿
    mkRun('b', { model: 'p:strong', wins: 2, cost: 0.2, verifyOk: [true, false] }),         // 100%,贵 → 前沿;核验不一致
    mkRun('c', { model: 'p:<script>', wins: 1, cost: 0.5, verifyOk: [true] }),             // 50%,更贵 → 被 a 支配;只核了一局
    mkRun('d', { model: 'p:unpriced', wins: 1, cost: null }),                               // 价格未知:不上图,同分排后;未核验
    mkRun('e', { model: 'claude-cli:x', external: true, wins: 2, cost: 0.05 }),             // 外部 agent:单列
    mkRun('f', { model: 'p:pixels', tier: 'A', wins: 0, cost: 0.1 }),                       // 另一档
    mkRun('g', { model: 'p:cheap', tier: 'A', wins: 1, cost: 0.1, verifyOk: [true, true] })  // 同模型再跑一次;核验后成绩被替换
  ];
  // g:核验之后把一局成绩换掉(局数不变)→ 核验过期,不能再算已核验
  const gRes = path.join(dirs[6], 'episodes', `${t.id}__s43.json`);
  fs.writeFileSync(gRes, JSON.stringify({ ...JSON.parse(fs.readFileSync(gRes, 'utf8')), success: true, successAt: 3, endReason: 'success', progress: 1 }));
  // 旧版 verify.json(没有指纹)也不算
  const old = mkRun('h', { model: 'p:old', tier: 'A', wins: 1, cost: 0.1 });
  fs.writeFileSync(path.join(old, 'verify.json'), JSON.stringify({ episodes: [{ file: `${t.id}__s42.jsonl`, ok: true }, { file: `${t.id}__s43.jsonl`, ok: true }] }));
  // 另一个题目版本(改版前跑的)
  const v0 = mkRun('i', { model: 'p:older-task', tier: 'A', wins: 1, cost: 0.1 });
  const rj = path.join(v0, 'run.json');
  fs.writeFileSync(rj, JSON.stringify({ ...JSON.parse(fs.readFileSync(rj, 'utf8')), tasks: [{ id: t.id, version: t.version - 1, seeds: [42, 43] }] }));
  dirs.push(old, v0);
  fs.mkdirSync(path.join(root, 'not-a-run'));
  const rows = collectRuns([...dirs, path.join(root, 'not-a-run')]);
  assert.equal(rows.length, 9);
  const byModel = Object.fromEntries(rows.map((r) => [r.runId === 'g' ? 'g' : r.model, r]));
  assert.equal(byModel['p:cheap'].verify.state, 'verified');
  assert.equal(byModel['p:strong'].verify.state, 'mismatch');
  assert.equal(byModel['p:<script>'].verify.state, 'stale');                // 只核了一局
  assert.equal(byModel['p:unpriced'].verify.state, 'none');
  assert.deepEqual([byModel.g.verify.state, byModel.g.verify.ok], ['stale', 1]);   // 局数没变,但一局成绩换过
  assert.equal(byModel['p:old'].verify.state, 'stale');
  assert.deepEqual(verifyStatus(path.join(root, 'nowhere')), { state: 'none', ok: 0, total: 0 });
  const tierB = rows.filter((r) => r.tier === 'B' && !r.external);
  assert.deepEqual(rank(tierB).map((r) => r.model), ['p:strong', 'p:cheap', 'p:<script>', 'p:unpriced']);
  assert.deepEqual([...paretoFront([{ cost: 0.01, score: 0.5 }, { cost: 0.2, score: 1 }, { cost: 0.5, score: 0.5 }, { cost: 0.01, score: 0.5 }])].sort(), [0, 1, 3]);   // 完全相同的点互不支配
  const html = renderBoard(rows, { generatedAt: 'T' });
  assert.ok(html.indexOf('档位 A') < html.indexOf('档位 B'));
  assert.ok(html.includes('p:&lt;script&gt;') && !html.includes('p:<script>'));          // 模型名转义
  const sectionB = html.slice(html.indexOf('档位 B'));
  assert.ok(sectionB.indexOf('外部 agent') < sectionB.indexOf('claude-cli:x'));          // 外部 agent 在单列表里
  assert.equal((sectionB.match(/class="pt on"/g) || []).length, 2);                       // 前沿 2 点(cheap、strong)
  assert.equal((sectionB.slice(0, sectionB.indexOf('</svg>')).match(/<circle/g) || []).length, 3);   // 未知价不上图
  assert.match(html, /核验不一致 1\/2/);
  assert.match(html, /核验已过期 1\/2/);
  const sectionA = html.slice(html.indexOf('档位 A'), html.indexOf('档位 B'));
  assert.ok(sectionA.includes(`${t.id}</code> <span class="muted">v${t.version - 1}`) && sectionA.includes(`v${t.version}</span>`));   // 改版前后分两行
  assert.ok(sectionA.includes('p:cheap<br><code>g</code>'));                              // 矩阵列头带运行 id
  const { out, runs } = board(dirs, { out: path.join(root, 'site', 'board.html') });
  assert.equal(runs, 9);
  assert.ok(fs.readFileSync(out, 'utf8').startsWith('<!doctype html>'));
  // 闭卷测验:同一模型取最新一份,分数并进成绩表一列,另有测验分节
  const qz = (name, model, sc, at) => {
    const d = path.join(root, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'quiz.json'), JSON.stringify({ model, score: sc, taskMean: sc, quizPromptVersion: 2, code: 'c', at, perTask: { [t.id]: { n: 4, correct: Math.round(sc * 4), score: sc } }, answers: [{}, {}, {}, {}] }));
    return d;
  };
  const qd = [qz('q-old', 'p:cheap', 0.25, '2026-01-01'), qz('q-new', 'p:cheap', 0.5, '2026-02-01'), qz('q-other', 'p:none', 0, '2026-01-01')];
  const qs = collectQuizzes(qd);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].score, 0.5);                                                          // 同模型取最新
  const qhtml = renderBoard(rows, { generatedAt: 'T', quizzes: qs });
  assert.ok(qhtml.includes('闭卷测验(训练数据污染检测)') && qhtml.includes('2/4'));
  assert.match(qhtml.slice(qhtml.indexOf('p:cheap')), /<td class="num">50%<\/td>/);       // 成绩表里的测验列
  // 手改 / 恶意的 quiz.json:数字字段塞 HTML 也不会原样进页面
  const evil = qz('q-evil', 'p:<b>evil</b>', 0.5, '2026-03-01');
  const ej = JSON.parse(fs.readFileSync(path.join(evil, 'quiz.json'), 'utf8'));
  ej.perTask[t.id] = { n: '<img src=x onerror=alert(1)>', correct: '<script>alert(1)</script>', score: '"><svg onload=alert(1)>' };
  ej.quizPromptVersion = '<script>x</script>';
  fs.writeFileSync(path.join(evil, 'quiz.json'), JSON.stringify(ej));
  const ehtml = renderBoard(rows, { generatedAt: 'T', quizzes: collectQuizzes([evil]) });
  assert.ok(!/<script>|<img |<svg |onerror=|onload=|<b>evil/.test(ehtml.slice(ehtml.indexOf('闭卷测验(训练数据污染检测)'))), 'quiz fields must be escaped / coerced');
  const both = board([...dirs, ...qd], { out: path.join(root, 'site', 'board2.html') });
  assert.equal(both.quizzes, 2);
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('  ✓ ⑫ 排行页:分档、外部单列、排序、帕累托前沿、按局 + 指纹核验、题目版本分行、转义、闭卷测验列与分节');

// ⑬ Gemini 适配器(假服务器,不连外网):请求格式、工具 schema 裁成 OpenAPI 子集、thoughtSignature 回传、usage 含思考 token
{
  const reqs = [];
  const replies = [
    { candidates: [{ content: { role: 'model', parts: [
      { text: '想一想', thought: true },                                              // 思考摘要不算模型的话
      { text: '先往上走' },
      { functionCall: { name: 'step', args: { dir: 'up' } }, thoughtSignature: 'sig-1' },   // 没有 id:自造,且不回传
      { functionCall: { id: 'g-2', name: 'observe', args: {} } }                        // 有 id:原样回传
    ] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 50 } },
    { candidates: [{ content: { role: 'model', parts: [{ text: '好了' }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 5, cachedContentTokenCount: 150 } },
    { promptFeedback: { blockReason: 'SAFETY' } }
  ];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      reqs.push({ url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(replies[reqs.length - 1]));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const saved = { key: process.env.GEMINI_API_KEY, base: process.env.BENCH_GEMINI_BASE_URL };
  try {
    delete process.env.GEMINI_API_KEY;
    assert.throws(() => createProvider('gemini:m'), /GEMINI_API_KEY/);
    process.env.GEMINI_API_KEY = 'k-test';
    process.env.BENCH_GEMINI_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    const prov = createProvider('gemini:gemini-test-model');
    const tools = [{ name: 'step', description: 'walk', inputSchema: {
      type: 'object', additionalProperties: false, required: ['dir'],
      properties: { dir: { type: 'string', enum: ['up', 'down'], default: 'up' }, n: { type: 'integer', minimum: 1, maximum: 9 }, list: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { x: { type: 'number' } } } } }
    } }, { name: 'observe', description: 'look', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }];
    const history = [{ role: 'user', text: 'brief' }];
    const r1 = await prov.turn({ system: 'SYS', history, tools });
    assert.equal(r1.text, '先往上走');
    assert.deepEqual(r1.calls.map((c) => [c.name, c.args]), [['step', { dir: 'up' }], ['observe', {}]]);
    assert.deepEqual(r1.usage, { tokensIn: 120, tokensOut: 80, cacheRead: 0 });   // 思考 token 按输出算
    const q1 = reqs[0];
    assert.equal(q1.url, '/v1beta/models/gemini-test-model:generateContent');
    assert.equal(q1.key, 'k-test');
    assert.deepEqual(q1.body.systemInstruction, { parts: [{ text: 'SYS' }] });
    assert.deepEqual(q1.body.contents, [{ role: 'user', parts: [{ text: 'brief' }] }]);
    const decl = q1.body.tools[0].functionDeclarations[0];
    assert.ok(!JSON.stringify(q1.body.tools).includes('additionalProperties') && !JSON.stringify(q1.body.tools).includes('default'));
    assert.deepEqual(decl.parameters.required, ['dir']);
    assert.deepEqual(decl.parameters.properties.n, { type: 'integer', minimum: 1, maximum: 9 });
    assert.deepEqual(decl.parameters.properties.list.items, { type: 'object', properties: { x: { type: 'number' } } });
    assert.equal(q1.body.generationConfig.maxOutputTokens, 4096);
    assert.deepEqual(q1.body.tools[0].functionDeclarations[1], { name: 'observe', description: 'look' });   // 无参工具不带 parameters

    // 第二轮:模型回合原样带回 thoughtSignature;工具结果是 user 回合的 functionResponse,只有原生 id 才回传 id
    history.push({ role: 'assistant', text: r1.text, calls: r1.calls });
    for (const c of r1.calls) history.push({ role: 'tool', id: c.id, name: c.name, text: `result of ${c.name}` });
    history.push({ role: 'user', text: '继续' });
    const r2 = await prov.turn({ system: 'SYS', history, tools });
    assert.equal(r2.text, '好了');
    assert.deepEqual(r2.usage, { tokensIn: 200, tokensOut: 5, cacheRead: 150 });   // 隐式缓存命中
    assert.deepEqual(r2.calls, []);
    assert.deepEqual(reqs[1].body.contents.slice(1), [
      { role: 'model', parts: [
        { text: '先往上走' },
        { functionCall: { name: 'step', args: { dir: 'up' } }, thoughtSignature: 'sig-1' },
        { functionCall: { id: 'g-2', name: 'observe', args: {} } }
      ] },
      { role: 'user', parts: [
        { functionResponse: { name: 'step', response: { content: 'result of step' } } },
        { functionResponse: { id: 'g-2', name: 'observe', response: { content: 'result of observe' } } },
        { text: '继续' }
      ] }
    ]);
    await assert.rejects(prov.turn({ system: 'SYS', history, tools }), /prompt blocked: SAFETY/);
    assert.equal(costOf('gemini:gemini-test-model', r1.usage), null);              // 没登记的价格不编
    assert.deepEqual(geminiSchema({ type: 'object', $schema: 'x', properties: { a: { type: 'string', pattern: '^a' } } }), { type: 'object', properties: { a: { type: 'string' } } });
    // 联合类型:Gemini 的 type 只能是单个值(C 档 guide 的 source 是 string|integer,原样传过去整局请求被拒)
    assert.deepEqual(geminiSchema({ type: 'object', properties: { source: { type: ['string', 'integer'] }, n: { type: ['integer', 'null'] } } }),
      { type: 'object', properties: { source: { type: 'string' }, n: { type: 'integer', nullable: true } } });
    assert.ok(!JSON.stringify(geminiSchema({ type: 'object', properties: { s: { type: ['string', 'integer'] } } })).includes('['));
    // 收成 string 后模型会传 "2":guide 要把纯数字字符串当序号,而不是当名字去模糊匹配
    // 第 1 个来源的名字里带「2」:当名字模糊匹配就会错选它
    const fakeGuide = { sources: ['攻略2024', '主线剧情'].map((name, i) => ({ name, chapters: [{ n: 1, title: `章${i + 1}`, lines: ['正文'] }] })) };
    assert.match(guideText(fakeGuide, { source: '2', chapter: 1 }), /^\[主线剧情\] 1\. 章2/);
    assert.match(guideText(fakeGuide, { source: 2, chapter: 1 }), /^\[主线剧情\]/);
    assert.match(guideText(fakeGuide, { source: '主线', chapter: 1 }), /^\[主线剧情\]/);
    assert.match(guideText(fakeGuide, { source: '2024', chapter: 1 }), /^\[攻略2024\]/);   // 超出序号范围的数字串照旧按名字找
  } finally {
    server.close();
    if (saved.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.BENCH_GEMINI_BASE_URL; else process.env.BENCH_GEMINI_BASE_URL = saved.base;
  }
}
console.log('  ✓ ⑬ Gemini 适配器:请求格式、schema 子集(含联合类型)、thoughtSignature / id 回传、思考 token 计入输出、拦截报错;guide 认数字字符串序号');

// ⑭ Anthropic 适配器的提示缓存(假服务器):系统提示一个断点;最后一条已省略的工具结果一个断点;末尾不打;usage 含缓存读写
{
  const reqs = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      reqs.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 700, output_tokens: 40 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.BENCH_ANTHROPIC_BASE_URL };
  try {
    process.env.ANTHROPIC_API_KEY = 'k';
    process.env.BENCH_ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    const prov = createProvider('anthropic:claude-opus-5-5');
    const hist = [{ role: 'user', text: 'brief' }];
    for (let i = 0; i < 9; i++) hist.push({ role: 'assistant', text: '', calls: [{ id: `c${i}`, name: 'observe', args: {} }] }, { role: 'tool', id: `c${i}`, name: 'observe', text: `obs${i}` });
    const r = await prov.turn({ system: 'SYS', history: compact(hist), tools: [] });
    assert.deepEqual(r.usage, { tokensIn: 6000, tokensOut: 40, cacheRead: 5000, cacheWrite: 700 });   // 全部输入 = 未命中 + 读 + 写
    const q = reqs[0];
    assert.deepEqual(q.system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    assert.equal(q.cache_control, undefined);                                   // 不用自动缓存(末尾每轮都会被改写)
    const marked = q.messages.flatMap((m) => m.content).filter((b) => b.cache_control);
    assert.equal(marked.length, 1);
    assert.deepEqual([marked[0].type, marked[0].tool_use_id], ['tool_result', 'c2']);   // 9 条结果留 6 条全文:最后一条占位是 c2
    // 还没有省略的(前 6 次调用):只有系统提示的断点
    await prov.turn({ system: 'SYS', history: hist.slice(0, 5), tools: [] });
    assert.equal(reqs[1].messages.flatMap((m) => m.content).filter((b) => b.cache_control).length, 0);
  } finally {
    server.close();
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.key], ['BENCH_ANTHROPIC_BASE_URL', saved.base]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
console.log('  ✓ ⑭ Anthropic 提示缓存:系统提示 + 最后一条占位两个断点,末尾不打;usage 含缓存读写');

// ⑮ Anthropic ?context=server:上下文规则交给服务端 context editing,历史原样回传(含思考块)
{
  // 循环:ownsContext 的 provider 拿到不截断的历史,且每轮的 raw 内容块进历史
  const seen = [];
  let n = 0;
  const fakeProvider = {
    ownsContext: true,
    async turn({ history, keep }) {
      seen.push({ history: history.map((h) => ({ ...h })), keep });
      n++;
      return n > 8 ? { text: 'done', calls: [], usage: {} }
        : { text: '', calls: [{ id: `c${n}`, name: 'observe', args: {} }], usage: { tokensIn: 1, tokensOut: 1 }, raw: [{ type: 'thinking', thinking: '', signature: `sig${n}` }, { type: 'tool_use', id: `c${n}`, name: 'observe', input: {} }] };
    }
  };
  let done = false;
  const ep = { tier: 'B', task: { brief: 'b' }, intro: 'i', tools: [], result: {}, get done() { return done; },
    logTurn() {}, addUsage() { return false; }, async call() { return { text: 'obs', done: false }; }, finish(reason) { done = true; return { endReason: reason }; } };
  await runLoop({ episode: ep, provider: fakeProvider, model: 'replay:x' });
  const last = seen[8];
  assert.equal(last.keep, KEEP_OBS);
  assert.equal(last.history.filter((h) => h.role === 'tool').length, 8);
  assert.ok(last.history.every((h) => !h.elided && (h.role !== 'tool' || h.text === 'obs')));     // 没被客户端截断
  assert.equal(last.history.filter((h) => h.role === 'assistant')[0].raw[0].signature, 'sig1');   // raw 随历史保留

  // 适配器:beta 头 + clear_tool_uses(keep 与客户端规则相同);思考块原样回传;只有系统提示一个断点
  const reqs = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      reqs.push({ beta: req.headers['anthropic-beta'], body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'thinking', thinking: '', signature: 'S' }, { type: 'text', text: 'hi' }, { type: 'tool_use', id: 't9', name: 'observe', input: {} }], usage: { input_tokens: 5, output_tokens: 6 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.BENCH_ANTHROPIC_BASE_URL };
  try {
    process.env.ANTHROPIC_API_KEY = 'k';
    process.env.BENCH_ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    assert.throws(() => createProvider('anthropic:m?context=both'), /client or server/);
    assert.throws(() => createProvider('anthropic:m?foo=1'), /unknown option/);
    assert.equal(createProvider('anthropic:m').ownsContext, false);
    const prov = createProvider('anthropic:claude-opus-5-5?context=server');
    assert.equal(prov.ownsContext, true);
    const r = await prov.turn({ system: 'SYS', history: last.history, tools: [], keep: 6 });
    assert.deepEqual(r.raw.map((b) => b.type), ['thinking', 'text', 'tool_use']);
    assert.deepEqual(r.calls.map((c) => c.id), ['t9']);
    const q = reqs[0];
    assert.equal(q.beta, 'context-management-2025-06-27');
    assert.equal(q.body.model, 'claude-opus-5-5');                                  // 选项不进模型名
    assert.deepEqual(q.body.context_management, { edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'tool_uses', value: 6 }, keep: { type: 'tool_uses', value: 6 } }] });
    const asst = q.body.messages.filter((m) => m.role === 'assistant');
    assert.deepEqual(asst[0].content, [{ type: 'thinking', thinking: '', signature: 'sig1' }, { type: 'tool_use', id: 'c1', name: 'observe', input: {} }]);   // 原样回传
    assert.equal(q.body.messages.flatMap((m) => m.content).filter((b) => b.cache_control).length, 0);
    assert.deepEqual(q.body.system[0].cache_control, { type: 'ephemeral' });
    // 默认模式不变:不发 beta 头、不回传思考块
    await createProvider('anthropic:claude-opus-5-5').turn({ system: 'SYS', history: compact(last.history), tools: [] });
    assert.equal(reqs[1].beta, undefined);
    assert.equal(reqs[1].body.context_management, undefined);
    assert.ok(!reqs[1].body.messages.flatMap((m) => m.content).some((b) => b.type === 'thinking'));
    // 价格:选项不影响查价
    assert.equal(costOf('anthropic:claude-opus-5-5?context=server', { tokensIn: 1e6, tokensOut: 0 }, {}), 4);
  } finally {
    server.close();
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.key], ['BENCH_ANTHROPIC_BASE_URL', saved.base]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
console.log('  ✓ ⑮ Anthropic ?context=server:服务端按同一规则清理、历史与思考块原样回传;默认模式不变');

// ⑯ A 像素档:结果只给成败 + 画面;省略的结果连画面一起丢;三家适配器各按自家格式附图
{
  assert.deepEqual(TIER_TOOLS.A, ['screenshot', 'press', 'wait']);
  assert.equal(pixelResult({ ok: true, note: 'pressed Search; mode now dialog' }), 'ok');
  assert.equal(pixelResult({ ok: false, note: 'unknown key Foo; mode now control' }), 'FAILED — unknown key Foo');   // 不漏结构化提示
  assert.equal(pixelResult(null), 'ok');
  // 走到半路遇敌 / 进剧情:提前停下,不是失败(MCP 服务与 bench 同一判定)
  const stopped = { ok: false, note: 'interrupted after 12 steps (something triggered; mode now battle)' };
  assert.equal(isSoftStop('walk_to', stopped), true);
  assert.equal(isSoftStop('use_item', stopped), false, 'only walk_to / step / interact');
  assert.equal(isSoftStop('walk_to', { ok: false, note: 'no path from (1,2) to (3,4)' }), false);
  assert.equal(resultLabel('walk_to', stopped), 'stopped early (not an error)');
  assert.equal(pixelResult(stopped, 'walk_to'), 'stopped early (not an error) — interrupted after 12 steps (something triggered');
  const img = { mimeType: 'image/png', data: 'AAAA' };
  assert.deepEqual(toolContent({ text: 'ok', image: img }), [{ type: 'text', text: 'ok' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }]);
  assert.deepEqual(toolContent({ text: 'x' }), [{ type: 'text', text: 'x' }]);

  // 截断:超过 6 条的旧结果,画面一起丢、占位提示 screenshot;B 档(无画面)的占位文字不变
  const h = [{ role: 'user', text: 'b', image: img }];
  for (let i = 0; i < 8; i++) h.push({ role: 'assistant', text: '', calls: [{ id: `p${i}`, name: 'press', args: { key: 'Up' } }] }, { role: 'tool', id: `p${i}`, name: 'press', text: 'ok', image: img });
  const ch = compact(h);
  const tools = ch.filter((x) => x.role === 'tool');
  assert.deepEqual(tools.map((x) => !!x.image), [false, false, true, true, true, true, true, true]);
  assert.match(tools[0].text, /earlier screenshot elided — call screenshot/);
  assert.equal(ch[0].image, img);                                                   // 第一条用户消息的画面留着
  assert.match(compact([{ role: 'tool', text: 'o' }, ...Array(6).fill({ role: 'tool', text: 'o' })])[0].text, /earlier observation elided — call observe/);

  // 循环:开局画面进第一条消息,工具结果的画面进历史
  let seenHist = null;
  const prov = { async turn({ history }) { seenHist = seenHist || null; if (history.length > 2) { seenHist = history; return { text: 'end', calls: [], usage: {} }; } return { text: '', calls: [{ id: 'k1', name: 'press', args: { key: 'Up' } }], usage: {} }; } };
  let done = false;
  const ep = { tier: 'A', task: { brief: 'b' }, intro: 'see image', introImage: img, tools: [], result: {}, get done() { return done; },
    logTurn() {}, addUsage() { return false; }, async call() { return { text: 'ok', image: img, done: false }; }, finish(r) { done = true; return { endReason: r }; } };
  await runLoop({ episode: ep, provider: prov, model: 'replay:x' });
  assert.equal(seenHist[0].image, img);
  assert.equal(seenHist.find((x) => x.role === 'tool').image, img);

  // 三家适配器的请求格式(一台假服务器按路径回各家格式)
  const reqs = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const b = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      if (req.url.includes('/chat/completions')) { reqs.openai = b; res.end(JSON.stringify({ choices: [{ message: { content: 'x' } }], usage: {} })); }
      else if (req.url.includes('/v1/messages')) { reqs.anthropic = b; res.end(JSON.stringify({ content: [{ type: 'text', text: 'x' }], usage: {} })); }
      else { reqs.gemini = b; res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }], usageMetadata: {} })); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const keys = ['OPENAI_API_KEY', 'BENCH_OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'BENCH_ANTHROPIC_BASE_URL', 'GEMINI_API_KEY', 'BENCH_GEMINI_BASE_URL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, { OPENAI_API_KEY: 'k', BENCH_OPENAI_BASE_URL: base, ANTHROPIC_API_KEY: 'k', BENCH_ANTHROPIC_BASE_URL: base, GEMINI_API_KEY: 'k', BENCH_GEMINI_BASE_URL: base });
    const hist = [
      { role: 'user', text: 'brief', image: img },
      { role: 'assistant', text: '', calls: [{ id: 'a', name: 'press', args: { key: 'Up' } }, { id: 'b', name: 'wait', args: {} }] },
      { role: 'tool', id: 'a', name: 'press', text: 'ok', image: img },
      { role: 'tool', id: 'b', name: 'wait', text: 'ok', image: img }
    ];
    for (const spec of ['openai:m', 'anthropic:m', 'gemini:m']) await createProvider(spec).turn({ system: 'S', history: hist, tools: [] });
    // OpenAI:tool 消息只放文字、紧跟 assistant;两张画面在这些 tool 消息之后合成一条 user 消息
    const om = reqs.openai.messages;
    assert.deepEqual(om.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user']);
    assert.deepEqual(om[1].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
    assert.ok(om.slice(3, 5).every((m) => typeof m.content === 'string'));
    assert.deepEqual(om[5].content.filter((c) => c.type === 'image_url').length, 2);
    // Anthropic:用户消息附 image 块;tool_result 的 content 是 [文字, 图]
    const am = reqs.anthropic.messages;
    assert.deepEqual(am[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    assert.deepEqual(am[2].content.map((b) => [b.type, b.content.map((c) => c.type)]), [['tool_result', ['text', 'image']], ['tool_result', ['text', 'image']]]);
    // Gemini:inlineData 紧跟在对应的 functionResponse 后面
    const gc = reqs.gemini.contents;
    assert.deepEqual(gc[0].parts, [{ text: 'brief' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }]);
    assert.deepEqual(gc[2].parts.map((p) => Object.keys(p)[0]), ['functionResponse', 'inlineData', 'functionResponse', 'inlineData']);
  } finally {
    server.close();
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
}
console.log('  ✓ ⑯ A 像素档:成败 + 画面、截断连画面一起丢、循环传图,OpenAI / Anthropic / Gemini 各按自家格式附图');

// ⑩ provider 重试在虚拟时钟下也能退避:种子局把全局计时器换成了虚拟时钟,而 provider 调用不经 e.drive()。
//    退避若用全局 setTimeout 就永远不触发(以前会一直挂到墙钟 1800s 被杀)。放最后:时钟装上就不卸。
{
  const http = await import('node:http');
  const { setTimeout: realSleep } = await import('node:timers/promises');
  const { installVirtualClock } = await import('../../src/clock.mjs');
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (hits < 3) { res.writeHead(503).end('busy'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  installVirtualClock();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const r = await Promise.race([
    postJson(url, {}, {}, { retries: 3, baseDelayMs: 20 }),
    realSleep(10000, undefined, { ref: false }).then(() => { throw new Error('postJson hung under the virtual clock'); })
  ]);
  assert.deepEqual(r, { ok: true });
  assert.equal(hits, 3, 'two 503s retried, third call succeeds');
  // 次数用完:直接抛最后一个错误,不再空等一次退避
  await assert.rejects(postJson(url.replace(/:\d+\/$/, ':1/'), {}, {}, { retries: 0, baseDelayMs: 60000 }), /fetch failed/);
  server.close();
}
console.log('  ✓ ⑩ provider 退避不受虚拟时钟影响');

// ⑰ 每档的每个工具都真有人接:游戏动作走 runTool,screenshot / guide / atlas 在 episode 里单独接(C 档曾经白给)
{
  const stub = new Proxy({}, { get: () => async () => ({ ok: true, note: 'stub' }) });   // 任何 agent 动作都「成功」
  for (const [tier, names] of Object.entries(TIER_TOOLS)) {
    for (const name of names) {
      if (name === 'screenshot' || name === 'run_code' || BOOK_TOOLS.has(name)) continue;
      const r = await runTool(stub, name, {});
      assert.ok(!(r && r.unknown), `tier ${tier}: tool ${name} is not dispatched by runTool`);
    }
  }
  assert.deepEqual(TIER_TOOLS.C.filter((n) => !TIER_TOOLS.B.includes(n)), [...BOOK_TOOLS]);
  // 每档的工具在 MCP 工具表里都有定义(按源码核对:mcp.mjs / pure.mjs)
  const mcpSrc = fs.readFileSync(new URL('../../src/mcp.mjs', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../../src/pure.mjs', import.meta.url), 'utf8');
  for (const n of new Set(Object.values(TIER_TOOLS).flat())) assert.match(mcpSrc, new RegExp(`name: '${n}'`), `tool ${n} has no MCP definition`);
  // 提示 v3:B / C 档可在地图上施法(cast),A 档仍只有画面与按键;提示里讲了 cast
  assert.ok(TIER_TOOLS.B.includes('cast') && TIER_TOOLS.C.includes('cast') && !TIER_TOOLS.A.includes('cast'));
  assert.equal(PROMPT_VERSION, 3);
  assert.match(systemPrompt('B'), /cast/); assert.doesNotMatch(systemPrompt('A'), /cast/);
  assert.ok(systemPrompt('C').includes(systemPrompt('B').split('\n\n')[1]));          // C 档拿到 B 档的全部说明(含 cast)
  assert.match(systemPrompt('C'), /guide[\s\S]*atlas/); assert.doesNotMatch(systemPrompt('B'), /guide|atlas/);

  const guide = { sources: [{ name: 'g.txt', chapters: [{ n: 1, title: '余杭', lines: ['李逍遥去十里坡'] }] }] };
  const g = bookTool('guide', { query: '十里坡' }, { guide, guideText, atlasFor: () => assert.fail('guide must not touch atlas') });
  assert.equal(g.r.ok, true);
  assert.match(g.text, /李逍遥去十里坡/);
  assert.equal(g.image, undefined);
  const img = { mimeType: 'image/png', data: 'AAAA' };
  const m = bookTool('atlas', { place: '余杭镇' }, { guide, guideText, atlasFor: (p) => (assert.equal(p, '余杭镇'), { entry: { name: '余杭镇' }, image: img }) });
  assert.deepEqual([m.r, m.image], [{ ok: true, note: '余杭镇' }, img]);
  assert.match(m.text, /^余杭镇 — fan-made annotated map/);
  const miss = bookTool('atlas', {}, { guide, guideText, atlasFor: () => ({ error: 'No atlas image for scene 3.' }) });
  assert.deepEqual([miss.r.ok, miss.image], [false, undefined]);
  assert.match(miss.text, /FAILED — No atlas image/);

  // 截断:查资料的旧结果按工具给占位提示,全图一起丢
  const h = [{ role: 'user', text: 'b' }, { role: 'tool', name: 'guide', text: 'g' }, { role: 'tool', name: 'atlas', text: 'm', image: img }];
  for (let i = 0; i < 6; i++) h.push({ role: 'tool', name: 'observe', text: 'o' });
  const [, cg, ca] = compact(h);
  assert.match(cg.text, /earlier walkthrough text elided — call guide/);
  assert.match(ca.text, /earlier map elided — call atlas/);
  assert.equal(ca.image, undefined);

  // C 档资料指纹(spec §10):攻略 / 全图任何一处内容变了指纹就变;冻进 run.json,续跑时不同就拒绝;排行榜上显示
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-books-'));
  const gf = path.join(dir, 'guide.txt'); fs.writeFileSync(gf, '〔1〕余杭\n李逍遥');
  fs.mkdirSync(path.join(dir, 'maps')); fs.writeFileSync(path.join(dir, 'maps', 'a.jpg'), 'img-a');
  const ix = path.join(dir, 'index.json');
  fs.writeFileSync(ix, JSON.stringify({ dir: path.join(dir, 'maps'), byMap: { 1: { name: '余杭镇', file: 'a.jpg' }, 2: { name: '余杭镇', file: 'a.jpg' } } }));
  const env = { AGENT_PAL_GUIDE: gf, AGENT_PAL_ATLAS_INDEX: ix };
  const b0 = booksFingerprint(env);
  assert.match(b0.id, /^[0-9a-f]{8}$/);
  assert.match(b0.guide[0], /^guide\.txt@[0-9a-f]{12}$/);
  assert.match(b0.atlas, /^[0-9a-f]{12} \(1 images\)$/);
  assert.deepEqual(booksFingerprint(env), b0);                                     // 稳定
  assert.equal(booksFingerprint({ AGENT_PAL_GUIDE: gf }), null);                    // 缺全图
  assert.equal(booksFingerprint({ AGENT_PAL_ATLAS_INDEX: ix }), null);              // 缺攻略
  fs.writeFileSync(path.join(dir, 'maps', 'a.jpg'), 'img-a2');                      // 换一张图
  const b1 = booksFingerprint(env);
  assert.notEqual(b1.atlas, b0.atlas); assert.equal(b1.guide[0], b0.guide[0]);
  fs.appendFileSync(gf, '\n多一行');                                                 // 改攻略
  const b2 = booksFingerprint(env);
  assert.notEqual(b2.guide[0], b1.guide[0]); assert.notEqual(b2.id, b1.id);
  fs.rmSync(dir, { recursive: true, force: true });
  const cBase = { model: 'm:x', tier: 'C', promptVersion: 2, code: 'abc', tasks: [], books: b0 };
  assert.deepEqual(resumeMismatch(cBase, { ...cBase, books: { ...b0 } }), []);
  const bd = resumeMismatch(cBase, { ...cBase, books: b1 });
  assert.equal(bd.length, 1); assert.match(bd[0], /^books/);
  assert.equal(resumeMismatch({ ...cBase, books: undefined }, cBase).length, 1);   // 旧 run.json 没记资料 → 不能续
  const row = { runId: 'c1', model: 'm:<x>', tier: 'C', external: false, complete: true, score: 1, progress: 1, costMeanOnSuccess: 0.1, costTotal: 0.1,
    tokensTotal: 1, tasks: [], episodes: 0, verify: { state: 'none', ok: 0, total: 0 }, code: 'abc', books: b0 };
  const page = renderBoard([row], { generatedAt: 'T' });
  assert.ok(page.includes(`资料 ${b0.id}`) && page.includes(b0.guide[0]));
  assert.ok(page.includes('提示 v?'));                                                    // 没记提示版本的行
  assert.ok(renderBoard([{ ...row, promptVersion: 3 }], { generatedAt: 'T' }).includes('提示 v3'));   // 排行榜分得清提示版本
}
console.log('  ✓ ⑰ C 档 guide / atlas 真的接上了;每档工具都有人接;资料指纹冻进 run.json');

// ⑱ 闭卷测验:关键词判分(每组至少一个、简繁都收、明说不知道算错);每道题都有一份合法的测验
{
  const acc = [['婶婶', '嬸嬸', '李大娘'], ['厨房', '廚房']];
  assert.equal(grade('回厨房找婶婶', acc), true);
  assert.equal(grade('去廚房找李大娘', acc), true);
  assert.equal(grade('找婶婶', acc), false);                       // 缺第二组
  assert.equal(grade('不知道', [['不知道']]), false);                 // 明说不知道一律算错
  assert.equal(grade('', acc), false);
  assert.equal(grade('Go to the KITCHEN 厨房 and ask 婶婶', acc), true);
  assert.equal(grade('水灵珠', [['水']], ['火', '雷']), true);
  assert.equal(grade('可能是水灵珠或火灵珠', [['水']], ['火', '雷']), false);   // 两头押算错
  assert.equal(grade('桥上——不对,我不确定,不知道', [['桥']]), false);            // 改口 / 不确定一律算错
  assert.equal(finalAnswer('我想想……\n答案:西厢房'), '西厢房');
  assert.equal(grade(finalAnswer('应该是巫后吧\n答案:赵灵儿'), [['巫后']]), false); // 只判「答案:」那一行
  const ok = { task: 'x', version: 1, questions: [1, 2, 3].map((i) => ({ id: 'q' + i, q: '问' + i, accept: [['答']] })) };
  assert.deepEqual(validateQuiz(ok, 'x'), []);
  assert.ok(validateQuiz({ ...ok, questions: ok.questions.slice(0, 2) }, 'x').some((e) => /3–5/.test(e)));
  assert.ok(validateQuiz({ ...ok, questions: [...ok.questions.slice(0, 2), { id: 'q1', q: '重复', accept: [['a']] }] }, 'x').some((e) => /duplicate/.test(e)));
  assert.ok(validateQuiz({ ...ok, questions: [...ok.questions.slice(0, 2), { id: 'q9', q: '空', accept: [[]] }] }, 'x').some((e) => /non-empty/.test(e)));
  assert.ok(validateQuiz({ ...ok, questions: [...ok.questions.slice(0, 2), { id: 'q9', q: '方向', accept: [['西北']], reject: ['西'] }] }, 'x').some((e) => /reject word/.test(e)));
  const quizzes = listQuizzes();
  for (const id of listTasks()) assert.ok(quizzes.includes(id), `task ${id} has no closed-book quiz (bench/quiz/${id}.json)`);
  for (const id of quizzes) loadQuiz(id);                           // 格式不合法会抛
}
console.log(`  ✓ ⑱ 闭卷测验:关键词判分;${listQuizzes().length} 道题都有合法测验`);

// ⑲ 卡死只数推进游戏的调用:读攻略 / 看全图 / 截图不加一也不清零
{
  assert.deepEqual([...NON_ADVANCING].sort(), ['atlas', 'guide', 'screenshot']);
  for (const n of NON_ADVANCING) assert.ok(Object.values(TIER_TOOLS).some((ts) => ts.includes(n)), n);   // 都是真有的工具
  const run = (seq, k = 3) => { const c = createStuckCounter(k); return seq.map(([fp, adv]) => c.step(fp, adv)); };
  // 推进游戏的调用:状态连续 3 次不变 → 卡死
  assert.deepEqual(run([['a', true], ['a', true], ['a', true], ['a', true]]), [false, false, false, true]);
  // 只查资料:多少次都不算卡死
  assert.deepEqual(run([['a', true], ...Array(10).fill(['a', false])]).at(-1), false);
  // 夹在中间的查资料既不清零也不加一:原地踏步照样累计
  assert.deepEqual(run([['a', true], ['a', true], ['a', false], ['a', false], ['a', true], ['a', true]]), [false, false, false, false, false, true]);
  // 状态一变就清零
  assert.deepEqual(run([['a', true], ['a', true], ['a', true], ['b', true], ['b', true]]), [false, false, false, false, false]);
  const c = createStuckCounter(2); c.step('a'); c.step('a'); c.reset();
  assert.equal(c.step('a'), false);                                                       // 开局判分后清零
}
console.log('  ✓ ⑲ 卡死只数推进游戏的调用');
// ⑳ 挑战题(一条命):逃跑 / 有人倒下的原子谓词;disallowTools 从档位工具里去掉;挑战题的参考解不能用被禁的工具、不能逃
{
  const v = (party, battles = []) => ({ ...base, party, battles });
  ok({ battleFled: {} }, v([], [{ enemyTeam: 3, outcome: 'fled' }]));
  no({ battleFled: {} }, v([], [{ enemyTeam: 3, outcome: 'won' }]));
  ok({ memberDown: true }, v([{ hp: 0, maxHp: 150 }, { hp: 9, maxHp: 99 }]));
  no({ memberDown: true }, v([{ hp: 5, maxHp: 150 }, { hp: 0, maxHp: 0 }]));          // maxHp 0 的幽灵队员不算倒下
  const hc = loadTask('pal-ch1-meet-linger-hardcore');
  assert.deepEqual(toolNames(hc, 'B').filter((n) => ['save', 'load', 'list_saves'].includes(n)), []);
  assert.ok(toolNames(hc, 'B').includes('battle') && toolNames(hc, 'C').includes('guide'));
  assert.deepEqual(toolNames({ id: 'x' }, 'B'), TIER_TOOLS.B);
  assert.throws(() => toolNames({ id: 'x', disallowTools: ['teleport'] }, 'B'), /unknown tool/);
  assert.ok(validateTask({ ...hc, disallowTools: [] }).some((e) => /disallowTools/.test(e)));
  // validate 就查名字:写错的、本题开放档位里没有的都报(不等开局才抛)
  assert.deepEqual(validateTask(hc), []);
  assert.ok(validateTask({ ...hc, disallowTools: ['save_game'] }).some((e) => /unknown tool "save_game"/.test(e)));
  assert.ok(validateTask({ ...hc, tiers: ['B'], disallowTools: ['guide'] }).some((e) => /"guide" is not a tool of tier B/.test(e)));
  assert.deepEqual(validateTask({ ...hc, tiers: ['B', 'C'], disallowTools: ['guide'] }), []);   // C 档有 guide
  // 参考解只能用模型也拿得到的工具(bench check 直接调 runTool,不经档位过滤)
  assert.deepEqual(referenceTools({ id: 'x', tiers: ['B', 'C'] }), TIER_TOOLS.B);
  assert.deepEqual(referenceTools({ id: 'x', tiers: ['A'] }), TIER_TOOLS.A);
  assert.deepEqual(referenceTools({ id: 'x', tiers: ['A', 'B'] }), TIER_TOOLS.B);              // 参考解是结构化动作,A 档另录
  assert.ok(!referenceTools(hc).includes('save') && referenceTools(hc).includes('battle'));
  assert.deepEqual(referenceToolErrors({ id: 'x', tiers: ['B'] }, [['observe'], ['grind', { target_level: 5 }], ['panorama'], ['grind']]),
    ['step 2: tool "grind" is not available to models on this task', 'step 3: tool "panorama" is not available to models on this task']);
  assert.match(referenceToolErrors({ id: 'x', tiers: ['B'] }, [['guide']])[0], /"guide"/);      // 只开 B 的题不能查攻略
  assert.match(referenceToolErrors(hc, [['save', { slot: 1 }]])[0], /"save"/);                 // 被禁的工具
  // 只开 A / 只开 C 的参考解可以用 screenshot / guide / atlas:check 回放时只计步、不交给 runTool(它不认这三个)
  assert.deepEqual(referenceToolErrors({ id: 'x', tiers: ['A'] }, [['screenshot'], ['press', { key: 'Up' }]]), []);
  assert.deepEqual(referenceToolErrors({ id: 'x', tiers: ['C'] }, [['guide'], ['atlas'], ['observe']]), []);
  const calls = [];
  const ctx = { drive: async (p) => p, agent: {}, runTool: async (_a, name) => (calls.push(name), name === 'press' ? { ok: true, note: 'pressed' } : { unknown: true }) };
  for (const n of ['screenshot', 'guide', 'atlas']) assert.equal((await replayReferenceStep(ctx, n)).ok, true);
  assert.deepEqual(await replayReferenceStep(ctx, 'press', { key: 'Up' }), { ok: true, note: 'pressed' });
  assert.deepEqual(calls, ['press']);                                                    // 只有游戏动作交给 runTool
  for (const id of listTasks()) {
    const t = loadTask(id);
    const ref = loadReference(id);
    for (const steps of ref.bySeed ? Object.values(ref.bySeed) : [ref.steps]) assert.deepEqual(referenceToolErrors(t, steps), [], `${id}: reference uses tools models cannot use`);
  }
  for (const id of listTasks()) {
    const t = loadTask(id);
    if (!t.disallowTools && !JSON.stringify(t.fail || {}).includes('battleFled')) continue;
    const ref = loadReference(id);
    const runs = ref.bySeed ? Object.values(ref.bySeed) : [ref.steps];
    for (const steps of runs) for (const [tool, args = {}] of steps) {
      assert.ok(!(t.disallowTools || []).includes(tool), `${id}: reference uses disallowed tool ${tool}`);
      if (JSON.stringify(t.fail || {}).includes('battleFled')) assert.ok(!(tool === 'battle' && args.action === 'flee'), `${id}: reference flees`);
    }
  }
}
console.log('  ✓ ⑳ 挑战题:逃跑 / 倒下谓词、disallowTools、参考解守规则');

// ㉑ 存档起点:题目只能引用 bench/saves/ 下的文件名;文件在仓库里,解开是引擎存档表,题目要的槽位有档
{
  const hc = loadTask('pal-ch1-island-hardcore');
  for (const bad of ['../x.saves.json.gz', 'bench/saves/x.saves.json.gz', 'x.json', '.x.saves.json.gz']) {
    assert.ok(validateTask({ ...hc, start: { saves: bad, slot: 1 } }).some((e) => /start\.saves/.test(e)), bad);
  }
  const savesDir = path.resolve(TASK_DIR, '..', 'saves');
  for (const id of listTasks()) {
    const s = loadTask(id).start;
    if (!s.saves) continue;
    const file = path.join(savesDir, s.saves);
    assert.ok(fs.existsSync(file), `${id}: missing bench/saves/${s.saves}`);
    const table = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    const slot = JSON.parse(table[`PAL-SAVE-${s.slot || 1}`] || 'null');
    assert.ok(slot && Array.isArray(slot.bytes) && slot.bytes.length > 0, `${id}: bench/saves/${s.saves} has no save in slot ${s.slot || 1}`);
  }
}
console.log('  ✓ ㉑ 存档起点:文件名受限、存档在库、槽位有档');

// README 的题目表:每道题一行,par 与调用预算和数据一致(参考解重录 / 预算改了不同步就红)
{
  const readme = fs.readFileSync(path.join(TASK_DIR, '..', 'README.md'), 'utf8');
  const rows = new Map([...readme.matchAll(/^\| `([a-z0-9-]+)` \|[^|]*\|[^|]*\|[^|]*\| ([\d /]+) \| (\d+) \|$/gm)].map((m) => [m[1], { par: m[2].trim(), budget: Number(m[3]) }]));
  for (const id of listTasks()) {
    const t = loadTask(id), ref = loadReference(id), row = rows.get(id);
    assert.ok(row, `README task table has no row for ${id}`);
    assert.equal(row.par, t.seeds.map((s) => ref.par[String(s)]).join(' / '), `README par for ${id}`);
    assert.equal(row.budget, t.budget.toolCalls, `README budget for ${id}`);
  }
}

// Native replay calls runTool directly, so it must not silently accept a
// reference argument that a real agent cannot send through the public schema.
{
  const { TOOLS } = await import('../../src/mcp.mjs');
  const battleSchema = TOOLS.find(t => t.name === 'battle').inputSchema;
  for (const id of listTasks().filter(id => id.startsWith('baiyue-single-'))) {
    for (const [seed, steps] of Object.entries(loadReference(id).bySeed)) {
      for (const [index, [name, args = {}]] of steps.entries()) {
        if (name !== 'battle') continue;
        const at = `${id} seed${seed} step${index + 1}`;
        for (const [key, value] of Object.entries(args)) {
          const rule = battleSchema.properties[key];
          assert.ok(rule, `${at}: battle argument ${key} is not public`);
          if (rule.type === 'integer') assert.ok(Number.isInteger(value), `${at}: ${key} must be integer`);
          if (rule.minimum != null) assert.ok(value >= rule.minimum, `${at}: ${key} below public minimum ${rule.minimum}`);
          if (rule.enum) assert.ok(rule.enum.includes(value), `${at}: ${key} outside public enum`);
        }
      }
    }
  }
}

// ㉒ Tier P (Pure 编程档):只暴露 L0 原语 + run_code(无 walk_to / interact / map),提示词含 run_code / pal.world / global 说明
{
  assert.ok(TIER_TOOLS.P.includes('run_code') && TIER_TOOLS.P.includes('observe') && TIER_TOOLS.P.includes('step'));
  assert.ok(!TIER_TOOLS.P.includes('walk_to') && !TIER_TOOLS.P.includes('interact') && !TIER_TOOLS.P.includes('map'));
  assert.match(systemPrompt('P'), /run_code/);
  assert.match(systemPrompt('P'), /pal\.world/);
  assert.match(systemPrompt('P'), /global/);
  const hc = loadTask('pal-ch1-island-hardcore');
  assert.ok(!toolNames(hc, 'P').includes('save') && toolNames(hc, 'P').includes('run_code'));
}
console.log('  ✓ ㉒ Tier P (Pure 编程档):L0 原语 + run_code 工具面与系统提示');

// ㉓ 公共 Leaderboard PR 门禁与同模型跨运行合并
{
  // 1) PR diff 分类:禁止直接提交 board.html,禁止在提交 bench/out/ 时顺手改裁判/引擎代码
  assert.deepEqual(classifySubmissionDiff(['bench/out/run1/run.json', 'bench/out/run1/verify.json', 'bench/prices.json']), {
    subDirs: ['run1'], pricesTouched: true, otherFiles: [], errors: []
  });
  assert.match(classifySubmissionDiff(['bench/out/board.html', 'bench/out/run1/run.json']).errors[0], /board\.html must not be committed/);
  assert.match(classifySubmissionDiff(['bench/out/run1/run.json', 'bench/verify.mjs']).errors[0], /cannot simultaneously modify code/);

  // 2) 同模型分批运行合并 + verifiedOnly 门禁
  const rows = [
    {
      runId: 'r1', model: 'p:m1', tier: 'B', hints: 'standard', external: false, scoring: 'cost', books: null,
      verify: { state: 'verified', ok: 1, total: 1 },
      tasks: [{ id: 'tA', version: 1, seedsPlanned: 1, n: 1, episodes: [{ seed: 42, success: true, successAt: 10, endReason: 'success', progress: 1, toolCalls: 10, invalidCalls: 0, tokensIn: 1000, tokensOut: 100, cost: 0.02, efficiency: 0.8 }] }]
    },
    {
      runId: 'r2', model: 'p:m1', tier: 'B', hints: 'standard', external: false, scoring: 'cost', books: null,
      verify: { state: 'verified', ok: 1, total: 1 },
      tasks: [{ id: 'tB', version: 1, seedsPlanned: 1, n: 1, episodes: [{ seed: 42, success: false, successAt: null, endReason: 'stuck', progress: 0.4, toolCalls: 20, invalidCalls: 2, tokensIn: 2000, tokensOut: 200, cost: 0.04, efficiency: null }] }]
    },
    {
      runId: 'r3-unverified', model: 'p:m1', tier: 'B', hints: 'standard', external: false, scoring: 'cost', books: null,
      verify: { state: 'none', ok: 0, total: 1 },
      tasks: [{ id: 'tB', version: 1, seedsPlanned: 1, n: 1, episodes: [{ seed: 42, success: true, successAt: 5, endReason: 'success', progress: 1, toolCalls: 5, invalidCalls: 0, tokensIn: 500, tokensOut: 50, cost: 0.01, efficiency: 1 }] }]
    }
  ];
  const mergedVerified = mergeRunsByModel(rows, { verifiedOnly: true });
  assert.equal(mergedVerified.length, 1);
  assert.equal(mergedVerified[0].episodes, 2);
  assert.equal(mergedVerified[0].score, 0.5);           // r3-unverified 被挡在门外,tA 100% + tB 0% = 50%
  assert.equal(mergedVerified[0].verify.state, 'verified');
  assert.equal(mergedVerified[0].verify.ok, 2);

  // 3) checkPrSubmission 端到端:核验通过 vs 缺 verify.json
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-pr-'));
  const t = loadTask('classic08-leave-area');
  const rDir = path.join(tmpRepo, 'bench', 'out', 'sub1');
  fs.mkdirSync(path.join(rDir, 'episodes'), { recursive: true });
  fs.writeFileSync(path.join(rDir, 'run.json'), JSON.stringify({ runId: 'sub1', model: 'p:x', tier: 'B', code: 'abc1234', tasks: [{ id: t.id, version: t.version, seeds: [42] }] }));
  const epJson = { task: t.id, seed: 42, success: true, successAt: 5, endReason: 'success', progress: 1, toolCalls: 5, invalidCalls: 0, tokensIn: 1000, tokensOut: 100, cost: 0.01, virtualSeconds: 5 };
  const epLog = path.join(rDir, 'episodes', `${t.id}__s42.jsonl`);
  fs.writeFileSync(path.join(rDir, 'episodes', `${t.id}__s42.json`), JSON.stringify(epJson));
  fs.writeFileSync(epLog, JSON.stringify({ type: 'start', task: t.id, taskVersion: t.version, seed: 42, tier: 'B' }) + '\n');
  // 没写 verify.json → 门禁拒绝
  const failPr = checkPrSubmission({ changedFiles: ['bench/out/sub1/run.json'], repoRoot: tmpRepo, verifyFn: () => [{ task: t.id, seed: 42, ok: true, verdict: 'verified', diffs: [], warnings: [] }] });
  assert.equal(failPr.ok, false);
  assert.match(failPr.errors[0], /committed verify\.json is none/);
  // 补齐匹配指纹的 verify.json → 门禁放行并生成 Markdown 报表
  fs.writeFileSync(path.join(rDir, 'verify.json'), JSON.stringify({ episodes: [{ file: `${t.id}__s42.jsonl`, ok: true, digest: episodeDigest(epLog) }] }));
  const passPr = checkPrSubmission({ changedFiles: ['bench/out/sub1/run.json'], repoRoot: tmpRepo, verifyFn: () => [{ task: t.id, seed: 42, ok: true, verdict: 'verified', diffs: [], warnings: [] }] });
  assert.equal(passPr.ok, true);
  assert.match(passPr.markdown, /✅ Agent-PAL-Bench PR Submission Check/);
  assert.match(passPr.markdown, /`sub1`/);
  fs.rmSync(tmpRepo, { recursive: true, force: true });
}
console.log('  ✓ ㉓ 公共 Leaderboard PR 门禁(零冲突 / 防篡改 / 增量核验)与同模型跨运行归并');

// 外部 CLI 的可执行文件:环境变量 > ~/.local/bin(当前用户) > 应用内置 > PATH 裸名字;不写死某个人的家目录
{
  const { resolveCliBin } = await import('../cli-bins.mjs');
  const none = () => false;
  assert.equal(resolveCliBin('claude', { env: { BENCH_CLAUDE_BIN: '/opt/claude' }, home: '/h', exists: none }), '/opt/claude');
  assert.equal(resolveCliBin('claude', { env: {}, home: '/h', exists: (p) => p === '/h/.local/bin/claude' }), '/h/.local/bin/claude');
  assert.equal(resolveCliBin('agy', { env: {}, home: '/h', exists: none }), 'agy');
  const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  assert.equal(resolveCliBin('codex', { env: {}, home: '/h', exists: (p) => p === bundled }), bundled);
  assert.equal(resolveCliBin('codex', { env: {}, home: '/h', exists: (p) => p === bundled || p === '/h/.local/bin/codex' }), '/h/.local/bin/codex');
  for (const f of ['runner.mjs', 'quiz.mjs']) assert.doesNotMatch(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /\/Users\//, `${f} hard-codes a /Users/ path`);
}
console.log('  ✓ 外部 CLI 路径按环境变量 / 当前用户解析,不写死家目录');

console.log('\nBENCH TESTS PASSED ✅');
