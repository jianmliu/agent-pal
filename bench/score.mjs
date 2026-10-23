/**
 * score — 汇总一次 run(spec §6 聚合):每题按种子求 success 率、progress 均值 ± 标准差、成功局的调用数与花费;
 * 总分 = 各题 success 率均值(主排序),同分比成功局的平均 cost。
 * par = 参考解在该种子上到达 goal 的步数(bench check --write-par 写进参考解;作者知道答案时的参照,不是最优解);
 * efficiency = par / 到达 goal 的调用数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadReference } from './task.mjs';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const sumOrNull = (xs) => (xs.some((x) => x == null) ? null : xs.reduce((a, b) => a + b, 0));

/** par:优先用 run.json 开跑时冻结的(参考解后来重录不改写旧成绩);旧 run.json 没记就读当前参考解。 */
function parOf(t, seed) {
  if (t.par && String(seed) in t.par) return t.par[String(seed)];
  return loadReference(t.id)?.par?.[String(seed)] ?? null;
}

export function score(runDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  const epDir = path.join(runDir, 'episodes');
  const results = fs.readdirSync(epDir).filter((f) => /__s-?\d+\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(epDir, f), 'utf8')));

  const tasks = [];
  for (const t of meta.tasks) {
    const rs = results.filter((r) => r.task === t.id).sort((a, b) => a.seed - b.seed);
    const wins = rs.filter((r) => r.success);
    const roundValues = wins.map(r=>r.battleRounds);
    const roundsMean = wins.length && roundValues.every(x=>Number.isInteger(x)&&x>0) ? mean(roundValues) : null;
    const endReasons = {};
    for (const r of rs) endReasons[r.endReason] = (endReasons[r.endReason] || 0) + 1;
    const episodes = rs.map((r) => {
      const par = parOf(t, r.seed);
      const unmeasuredExternal = meta.external && !r.tokensIn && !r.tokensOut && r.accountingStatus !== 'complete' && r.accountingStatus !== 'partial';
      const cost = unmeasuredExternal ? null : r.cost;
      const tokensIn = unmeasuredExternal ? null : r.tokensIn;
      const tokensOut = unmeasuredExternal ? null : r.tokensOut;
      return {
        seed: r.seed, success: r.success, endReason: r.endReason, progress: r.progress, toolCalls: r.toolCalls,
        successAt: r.successAt, invalidCalls: r.invalidCalls, tokensIn, tokensOut, cost,
        virtualSeconds: r.virtualSeconds, battleRounds: r.battleRounds ?? null, par, efficiency: r.success && par ? +(par / r.successAt).toFixed(3) : null
      };
    });
    const epTokens = episodes.map((e) => (e.tokensIn == null || e.tokensOut == null ? null : e.tokensIn + e.tokensOut));
    tasks.push({
      id: t.id, version: t.version, seedsPlanned: t.seeds.length, n: rs.length,
      successRate: rs.length ? wins.length / rs.length : null,
      progressMean: mean(rs.map((r) => r.progress)), progressSd: sd(rs.map((r) => r.progress)),
      battleRoundsMeanOnSuccess: roundsMean,
      toolCallsMedianOnSuccess: median(wins.map((r) => r.successAt)),
      invalidRate: rs.length ? sumOrNull(rs.map((r) => r.invalidCalls)) / Math.max(1, sumOrNull(rs.map((r) => r.toolCalls))) : null,
      tokensMean: sumOrNull(epTokens) == null ? null : mean(epTokens),
      costTotal: sumOrNull(episodes.map((e) => e.cost)),
      costMeanOnSuccess: wins.length ? (sumOrNull(episodes.filter((e) => e.success).map((e) => e.cost)) == null ? null : mean(episodes.filter((e) => e.success).map((e) => e.cost))) : null,
      efficiencyMean: mean(episodes.filter((e) => e.efficiency != null).map((e) => e.efficiency)),
      endReasons, episodes
    });
  }
  const scored = tasks.filter((t) => t.n);
  const allEps = tasks.flatMap((t) => t.episodes);
  const allWins = allEps.filter((e) => e.success);
  const allToks = allEps.map((e) => (e.tokensIn == null || e.tokensOut == null ? null : e.tokensIn + e.tokensOut));
  const summary = {
    runId: meta.runId, model: meta.model, tier: meta.tier, hints: meta.hints ?? 'standard', external: !!meta.external, code: meta.code, promptVersion: meta.promptVersion, books: meta.books ?? null,
    scoring: meta.scoring ?? 'cost',
    battleRoundsMeanOnSuccess: allWins.length && allWins.every(r=>Number.isInteger(r.battleRounds)&&r.battleRounds>0) ? mean(allWins.map(r=>r.battleRounds)) : null,
    complete: tasks.every((t) => t.n === t.seedsPlanned),
    score: mean(scored.map((t) => t.successRate)),
    progress: mean(scored.map((t) => t.progressMean)),
    costMeanOnSuccess: allWins.length && sumOrNull(allWins.map((r) => r.cost)) != null ? mean(allWins.map((r) => r.cost)) : null,
    costTotal: sumOrNull(allEps.map((r) => r.cost)),
    tokensTotal: sumOrNull(allToks),
    episodes: results.length,
    tasks
  };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const num = (x, d = 2) => (x == null ? '–' : (+x).toFixed(d));
const usd = (x) => (x == null ? '?' : `$${x.toFixed(4)}`);

export function printSummary(s) {
  console.log(`\n${s.model} · tier ${s.tier}${s.external ? ' · EXTERNAL (not on main board)' : ''} · run ${s.runId} · code ${s.code}${s.books ? ` · books ${s.books.id}` : ''}${s.complete ? '' : ' · INCOMPLETE'}`);
  console.log('| task | success | progress | calls (median, won) | rounds (mean, won) | par | efficiency | invalid | tokens (mean) | cost | end reasons |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of s.tasks) {
    const pars = [...new Set(t.episodes.map((e) => e.par).filter((p) => p != null))].join('/');
    console.log(`| ${t.id} | ${pct(t.successRate)} (${t.n}) | ${num(t.progressMean)} ± ${num(t.progressSd)} | ${t.toolCallsMedianOnSuccess ?? '–'} | ${num(t.battleRoundsMeanOnSuccess)} | ${pars || '–'} |` +
      ` ${num(t.efficiencyMean)} | ${pct(t.invalidRate)} | ${t.tokensMean == null ? '–' : Math.round(t.tokensMean)} | ${usd(t.costTotal)} |` +
      ` ${Object.entries(t.endReasons).map(([k, v]) => `${k}×${v}`).join(' ')} |`);
  }
  console.log(`\nscore ${pct(s.score)} · ranking ${s.scoring ?? 'cost'} · rounds/win ${num(s.battleRoundsMeanOnSuccess)} · progress ${num(s.progress)} · cost/success ${s.score ? usd(s.costMeanOnSuccess) : '–'} · total ${usd(s.costTotal)} · ${s.tokensTotal} tokens · ${s.episodes} episodes`);
}
