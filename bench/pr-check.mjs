/**
 * pr-check — 公共 Leaderboard 的 PR 门禁(零 API 成本 CI 自动审稿):
 *
 *   node bench/bench.mjs check-pr [--base origin/main] [--summary-out file.md]
 *
 * 规则:
 *  1. 零冲突协议:PR 严禁直接提交 bench/out/board.html(由合入 main 后的 CI 自动构建发布)。
 *  2. 沙箱防篡改:凡是向 bench/out/<dir>/ 提交评测数据的 PR,严禁同时修改引擎、题库、参考解或 verify.mjs 等代码文件(仅允许附带修改带官方来源的 bench/prices.json)。
 *  3. 强制核验准入:每个新增或修改的运行目录必须已附带指纹匹配的 verify.json,并在 CI 容器上现场通过 bench verify 确定性重放与 Token/价格账本核验。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify, verifyEpisode, episodeLogs, readLog } from './verify.mjs';
import { score } from './score.mjs';
import { verifyStatus } from './board.mjs';
import { engineOptions } from './start.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function hasLocalGameAssets() {
  try {
    const opts = engineOptions();
    return Boolean(opts?.assetsDir && fs.existsSync(path.join(opts.assetsDir, 'FBP.MKF')));
  } catch {
    return false;
  }
}

function defaultVerifyDir(dirPath) {
  if (hasLocalGameAssets()) return verify(dirPath);
  const runFile = path.join(dirPath, 'run.json');
  const runMeta = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : null;
  return episodeLogs(dirPath).map((f) => verifyEpisode(f, {
    runMeta,
    currentRuntime: runMeta?.runtime ?? null,
    currentTaskFingerprint: () => (fs.existsSync(f) ? readLog(f).start?.fingerprint ?? null : null),
    replay: readLog
  }));
}

/** 分类 PR 改动的文件列表,检查是否违反零冲突或防篡改沙箱协议。纯函数。 */
export function classifySubmissionDiff(changedFiles) {
  const norm = changedFiles.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean);
  const errors = [];
  const subDirs = new Set();
  const otherFiles = [];
  let boardHtmlTouched = false;
  let pricesTouched = false;

  for (const f of norm) {
    if (f === 'bench/out/board.html') {
      boardHtmlTouched = true;
      continue;
    }
    const m = f.match(/^bench\/out\/([^/]+)\/(.+)$/);
    if (m) {
      subDirs.add(m[1]);
      continue;
    }
    if (f === 'bench/prices.json') {
      pricesTouched = true;
      continue;
    }
    otherFiles.push(f);
  }

  if (boardHtmlTouched) {
    errors.push('bench/out/board.html must not be committed in a submission PR (auto-generated on merge to prevent Git conflicts)');
  }
  if (subDirs.size > 0 && otherFiles.length > 0) {
    errors.push(`submission PR touching bench/out/ cannot simultaneously modify code or task files: ${otherFiles.join(', ')}`);
  }

  return { subDirs: [...subDirs].sort(), pricesTouched, otherFiles, errors };
}

/** 从 git 获取相对于 baseRef 的改动文件列表。 */
export function gitChangedFiles(baseRef = 'origin/main', repoRoot = path.resolve(here, '..')) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    const out = execFileSync('git', ['diff', '--name-only', 'HEAD~1..HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  }
}

/** 对 PR 中涉及的 bench/out/<dir> 目录做增量重放核验与成绩单生成。 */
export function checkPrSubmission({ changedFiles = null, baseRef = 'origin/main', repoRoot = path.resolve(here, '..'), verifyFn = defaultVerifyDir } = {}) {
  const files = changedFiles ?? gitChangedFiles(baseRef, repoRoot);
  const diff = classifySubmissionDiff(files);
  const errors = [...diff.errors];
  const runReports = [];

  for (const name of diff.subDirs) {
    const dirPath = path.join(repoRoot, 'bench', 'out', name);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;
    const runFile = path.join(dirPath, 'run.json');
    const quizFile = path.join(dirPath, 'quiz.json');

    if (fs.existsSync(runFile)) {
      const pre = verifyStatus(dirPath);
      if (pre.state !== 'verified') {
        errors.push(`${name}: committed verify.json is ${pre.state} (${pre.ok}/${pre.total}); run "node bench/bench.mjs verify bench/out/${name}" before submitting`);
      }
      const results = verifyFn(dirPath);
      const bad = results.filter((r) => !r.ok || r.verdict !== 'verified');
      if (bad.length > 0) {
        errors.push(`${name}: replay verification failed on ${bad.length}/${results.length} episode(s): ` +
          bad.map((b) => `${b.task} s${b.seed} (${b.verdict}: ${b.diffs.join('; ')})`).join(', '));
      }
      const summary = score(dirPath);
      const warnings = [...new Set(results.flatMap((r) => r.warnings || []))];
      runReports.push({ name, type: 'run', ok: pre.state === 'verified' && bad.length === 0, summary, episodesVerified: results.length - bad.length, episodesTotal: results.length, warnings });
    } else if (fs.existsSync(quizFile)) {
      try {
        const q = JSON.parse(fs.readFileSync(quizFile, 'utf8'));
        if (!q.model || typeof q.score !== 'number' || !Array.isArray(q.answers)) {
          errors.push(`${name}: invalid quiz.json structure`);
          runReports.push({ name, type: 'quiz', ok: false });
        } else {
          runReports.push({ name, type: 'quiz', ok: true, model: q.model, score: q.score, questions: q.answers.length });
        }
      } catch (err) {
        errors.push(`${name}: malformed quiz.json (${err.message})`);
      }
    } else {
      errors.push(`${name}: directory under bench/out/ has neither run.json nor quiz.json`);
    }
  }

  const ok = errors.length === 0;
  const md = [
    `## ${ok ? '✅' : '❌'} Agent-PAL-Bench PR Submission Check`,
    ''
  ];
  if (errors.length) {
    md.push('### Errors', ...errors.map((e) => `- ❌ ${e}`), '');
  }
  const runs = runReports.filter((r) => r.type === 'run' && r.summary);
  if (runs.length) {
    md.push(
      '### Verified Run Submissions',
      '| Directory | Model | Tier | Score | Progress | Cost / Win | Total Cost | Tokens | Verified | Notes |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---|'
    );
    for (const r of runs) {
      const s = r.summary;
      const pct = s.score == null ? '–' : `${Math.round(s.score * 100)}%`;
      const prog = s.progress == null ? '–' : s.progress.toFixed(2);
      const cWin = s.costMeanOnSuccess == null ? '–' : `$${s.costMeanOnSuccess.toFixed(4)}`;
      const cTot = s.costTotal == null ? '?' : `$${s.costTotal.toFixed(4)}`;
      const notes = r.warnings.length ? r.warnings.join('; ') : 'clean';
      md.push(`| \`${r.name}\` | \`${s.model}\` | ${s.tier} | **${pct}** | ${prog} | ${cWin} | ${cTot} | ${s.tokensTotal.toLocaleString('en-US')} | ${r.episodesVerified}/${r.episodesTotal} | ${notes} |`);
    }
    md.push('');
  }
  const quizzes = runReports.filter((r) => r.type === 'quiz' && r.ok);
  if (quizzes.length) {
    md.push(
      '### Closed-Book Quiz Submissions',
      '| Directory | Model | Quiz Score | Questions |',
      '|---|---|---:|---:|',
      ...quizzes.map((q) => `| \`${q.name}\` | \`${q.model}\` | **${Math.round(q.score * 100)}%** | ${q.questions} |`),
      ''
    );
  }
  if (!runs.length && !quizzes.length && ok) {
    md.push('_No `bench/out/` submission directories modified in this PR._', '');
  }

  return { ok, errors, subDirs: diff.subDirs, runReports, markdown: md.join('\n') };
}
