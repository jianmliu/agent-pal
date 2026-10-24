/**
 * board — 排行页(spec §6 聚合、§12 M2):把若干次 bench run 汇总成一个自包含的静态 HTML(不连外网、不引脚本)。
 *
 *   bench board [runDir...] [--out file.html]      不给目录 = bench/out/ 下的全部运行;默认写 bench/out/board.html
 *
 * - 按档位分开排(spec §5:不跨档比较);外部 agent(claude-cli 等)单列,不进主榜(§7.2)。
 * - 主排序 = score(各题 success 率均值),同分比成功局平均 cost(越低越好,未知价排后)。
 * - 每档一张 success × cost 散点图,帕累托前沿(没有别的成绩又便宜又不差)单独标出;cost 未知的不上图。
 * - 每行标重放核验状态(bench verify 写的 verify.json,按局与指纹对上):现在的每一局都核过、通过、且成绩与日志
 *   和核验时一模一样,才算「已核验」;不一致、没核、核验后被替换,都如实标出 —— 成绩不靠信任,靠重放(§8)。
 * - 不同题集的运行 score 不可直接比:表里列出题数,并给每题 × 每次运行的 success 率矩阵。
 * - 闭卷测验(bench quiz 写的 quiz.json,spec §8.1):同一模型的测验分并进成绩表一列,另有测验分节 —— 知道多少 vs. 做到多少。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './score.mjs';
import { loadTask } from './task.mjs';
import { episodeDigest, episodeLogs, runDigest } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.join(here, 'out');

/**
 * 一次运行的核验状态(按局对上 verify.json,不只比局数):
 *   verified —— 现在的每一局都有核验记录、都通过,且指纹(成绩 + 日志的 sha256)与核验时一致
 *   mismatch —— 现在的某一局核验不一致
 *   stale    —— 有局没核过,或核验后成绩 / 日志被替换(指纹变了),或记录是旧版没有指纹
 *   none     —— 没跑过 bench verify
 */
export function verifyStatus(runDir) {
  const logs = fs.existsSync(path.join(runDir, 'episodes')) ? episodeLogs(runDir) : [];
  const file = path.join(runDir, 'verify.json');
  if (!fs.existsSync(file)) return { state: 'none', ok: 0, total: logs.length };
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  const runFile=path.join(runDir,'run.json');
  const meta=fs.existsSync(runFile)?JSON.parse(fs.readFileSync(runFile,'utf8')):null;
  if((v.runDigest || meta?.runtime || meta?.scoring==='battleRounds') && (!meta || v.runDigest!==runDigest(meta)))return {state:'stale',ok:0,total:logs.length,at:v.verifiedAt||null};
  const byFile = new Map((v.episodes || []).map((e) => [e.file, e]));
  let ok = 0, bad = 0, stale = 0;
  for (const log of logs) {
    const e = byFile.get(path.basename(log));
    if (!e || !e.digest || e.digest !== episodeDigest(log)) stale++;
    else if (e.ok) ok++;
    else bad++;
  }
  const state = bad ? 'mismatch' : stale ? 'stale' : 'verified';
  return { state, ok, total: logs.length, at: v.verifiedAt || null };
}

/** 读入若干运行目录(有 run.json 的),每个都重新 score 一遍(summary.json 可能过期)。 */
export function collectRuns(dirs) {
  const rows = [];
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(dir, 'run.json')) || !fs.existsSync(path.join(dir, 'episodes'))) continue;
    const s = score(dir);
    rows.push({ ...s, dir, verify: verifyStatus(dir) });
  }
  return rows;
}

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

/**
 * 将多次分批 / 多 PR 提交的运行按 (model, tier, hints, external, scoring, books) 合并为同一模型行。
 * verifiedOnly = true 时只纳入 verify.state === 'verified' 的运行(公共 Leaderboard 门禁)。
 */
export function mergeRunsByModel(rows, { verifiedOnly = false } = {}) {
  const filtered = verifiedOnly ? rows.filter((r) => r.verify?.state === 'verified') : rows;
  const groups = new Map();
  for (const r of filtered) {
    const key = JSON.stringify([r.model, r.tier, r.hints ?? 'standard', !!r.external, r.scoring ?? 'cost', r.books?.id ?? null]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const last = group.at(-1);
    const taskMap = new Map();
    for (const r of group) {
      for (const t of r.tasks || []) {
        const tk = `${t.id}@${t.version}`;
        if (!taskMap.has(tk)) taskMap.set(tk, { id: t.id, version: t.version, seedsPlanned: t.seedsPlanned, bySeed: new Map() });
        const entry = taskMap.get(tk);
        entry.seedsPlanned = Math.max(entry.seedsPlanned || 0, t.seedsPlanned || 0);
        for (const ep of t.episodes || []) entry.bySeed.set(ep.seed, ep);
      }
    }
    const tasks = [];
    const allEps = [];
    for (const entry of taskMap.values()) {
      const episodes = [...entry.bySeed.values()].sort((a, b) => a.seed - b.seed);
      allEps.push(...episodes);
      const wins = episodes.filter((e) => e.success);
      const roundValues = wins.map((e) => e.battleRounds);
      const roundsMean = wins.length && roundValues.every((x) => Number.isInteger(x) && x > 0) ? mean(roundValues) : null;
      const endReasons = {};
      for (const e of episodes) endReasons[e.endReason] = (endReasons[e.endReason] || 0) + 1;
      const epTokens = episodes.map((e) => (e.tokensIn == null || e.tokensOut == null ? null : e.tokensIn + e.tokensOut));
      tasks.push({
        id: entry.id, version: entry.version, seedsPlanned: entry.seedsPlanned, n: episodes.length,
        successRate: episodes.length ? wins.length / episodes.length : null,
        progressMean: mean(episodes.map((e) => e.progress)), progressSd: sd(episodes.map((e) => e.progress)),
        battleRoundsMeanOnSuccess: roundsMean,
        toolCallsMedianOnSuccess: median(wins.map((e) => e.successAt)),
        invalidRate: episodes.length ? sumOrNull(episodes.map((e) => e.invalidCalls)) / Math.max(1, sumOrNull(episodes.map((e) => e.toolCalls))) : null,
        tokensMean: sumOrNull(epTokens) == null ? null : mean(epTokens),
        costTotal: sumOrNull(episodes.map((e) => e.cost)),
        costMeanOnSuccess: wins.length ? (sumOrNull(wins.map((e) => e.cost)) == null ? null : mean(wins.map((e) => e.cost))) : null,
        efficiencyMean: mean(episodes.filter((e) => e.efficiency != null).map((e) => e.efficiency)),
        endReasons, episodes
      });
    }
    const scored = tasks.filter((t) => t.n);
    const allWins = allEps.filter((e) => e.success);
    const allToks = allEps.map((e) => (e.tokensIn == null || e.tokensOut == null ? null : e.tokensIn + e.tokensOut));
    const vStates = group.map((g) => g.verify?.state || 'none');
    const vState = vStates.includes('mismatch') ? 'mismatch' : vStates.every((s) => s === 'verified') ? 'verified' : vStates.every((s) => s === 'none') ? 'none' : 'stale';
    const vOk = group.reduce((a, g) => a + (g.verify?.ok || 0), 0);
    const vTotal = group.reduce((a, g) => a + (g.verify?.total || 0), 0);
    merged.push({
      ...last,
      runId: `${group.length} runs (${group[0].runId}…${last.runId})`,
      complete: tasks.every((t) => t.n >= t.seedsPlanned),
      score: mean(scored.map((t) => t.successRate)),
      progress: mean(scored.map((t) => t.progressMean)),
      battleRoundsMeanOnSuccess: allWins.length && allWins.every((e) => Number.isInteger(e.battleRounds) && e.battleRounds > 0) ? mean(allWins.map((e) => e.battleRounds)) : null,
      costMeanOnSuccess: allWins.length && sumOrNull(allWins.map((e) => e.cost)) != null ? mean(allWins.map((e) => e.cost)) : null,
      costTotal: sumOrNull(allEps.map((e) => e.cost)),
      tokensTotal: sumOrNull(allToks),
      episodes: allEps.length,
      tasks,
      verify: { state: vState, ok: vOk, total: vTotal, at: last.verify?.at || null }
    });
  }
  return merged;
}

/** 读入若干测验目录(有 quiz.json 的);同一模型有多次测验时取最新一次。 */
export function collectQuizzes(dirs) {
  const byModel = new Map();
  for (const dir of dirs) {
    const f = path.join(dir, 'quiz.json');
    if (!fs.existsSync(f)) continue;
    const q = JSON.parse(fs.readFileSync(f, 'utf8'));
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const row = { model: String(q.model ?? '?'), score: num(q.score), taskMean: num(q.taskMean), perTask: q.perTask && typeof q.perTask === 'object' ? q.perTask : {}, n: Array.isArray(q.answers) ? q.answers.length : 0, code: q.code, promptVersion: q.quizPromptVersion, at: q.at, dir };
    const prev = byModel.get(q.model);
    if (!prev || String(row.at) > String(prev.at)) byModel.set(q.model, row);
  }
  return [...byModel.values()].sort((a, b) => b.score - a.score || a.model.localeCompare(b.model));
}

/** bench/out 下的测验目录。 */
export const listQuizDirs = (root = OUT_DIR) => (fs.existsSync(root)
  ? fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, 'quiz.json'))).sort()
  : []);

/** bench/out 下的运行目录。 */
export const listRunDirs = (root = OUT_DIR) => (fs.existsSync(root)
  ? fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, 'run.json'))).sort()
  : []);

/** 排序:score 降序,同分比成功局平均 cost 升序(未知价排后),再按模型名。 */
export function rank(rows) {
  const c = (x) => (x == null ? Infinity : x);
  return [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || ((a.scoring ?? 'cost') === 'battleRounds' ? c(a.battleRoundsMeanOnSuccess) - c(b.battleRoundsMeanOnSuccess) : (a.scoring ?? 'cost') === 'mixed' ? 0 : c(a.costMeanOnSuccess) - c(b.costMeanOnSuccess)) || a.model.localeCompare(b.model));
}

/** 帕累托前沿(score 越高越好、cost 越低越好):没有别的点 cost ≤ 且 score ≥ 且至少一项严格更好。返回下标集合。 */
export function paretoFront(points) {
  const front = new Set();
  points.forEach((p, i) => {
    const dominated = points.some((q, j) => j !== i && q.cost <= p.cost && q.score >= p.score && (q.cost < p.cost || q.score > p.score));
    if (!dominated) front.add(i);
  });
  return front;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const usd = (x) => (x == null ? '?' : `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(2)}`);
/** token 数写成 2.78M / 640K(表格里一眼能比),完整数字放悬停;未采集记 ? */
const tok = (n) => { if (n == null) return '?'; n = Number(n) || 0; const s = n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n); return `<span title="${n.toLocaleString('en-US')}">${s}</span>`; };
/** 生成时刻:2026-10-23 16:33 UTC(ISO 串原样太长;不是 ISO 的原样输出) */
const stamp = (t) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(t)); return m ? `${m[1]} ${m[2]} UTC` : String(t); };
/** score 前面一小条进度条:不用读数字就看得出高低 */
const scoreCell = (x, r = {}) => `<td class="num strong"><span class="sbar" style="--p:${Math.round((x ?? 0) * 100)}%"></span>${r.cleared != null ? `${r.cleared} / ${r.taskUniverse} 题` : pct(x)}</td>`;
const VERIFY_LABEL = { verified: '已核验', mismatch: '核验不一致', stale: '核验已过期', none: '未核验' };

function verifyCell(v) {
  const detail = v.state === 'none' ? '' : ` ${v.ok}/${v.total}`;
  return `<span class="v v-${v.state}" title="${esc(v.at || '')}">${VERIFY_LABEL[v.state]}${detail}</span>`;
}

/** success × cost 散点图(内联 SVG)。points: [{ label, cost, score }],cost 已排除 null。 */
export function scatter(points) {
  if (!points.length) return '<p class="muted">没有已知 cost 的成功成绩,画不了图。</p>';
  const W = 820, H = 340, L = 56, R = 24, T = 20, B = 40;
  const maxCost = Math.max(...points.map((p) => p.cost)) || 1;
  const x = (c) => L + (c / maxCost) * (W - L - R);
  const y = (s) => T + (1 - s) * (H - T - B);
  const front = paretoFront(points);
  const frontPts = [...front].map((i) => points[i]).sort((a, b) => a.cost - b.cost);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const out = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="success × cost">`];
  for (const t of ticks) {
    out.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text>`);
    out.push(`<text class="tick" x="${x(t * maxCost)}" y="${H - B + 18}" text-anchor="middle">${usd(t * maxCost)}</text>`);
  }
  out.push(`<text class="axis" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">成功局平均 cost →(越左越省)</text>`);
  out.push(`<text class="axis" transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">score ↑</text>`);
  if (frontPts.length > 1) out.push(`<polyline class="front" points="${frontPts.map((p) => `${x(p.cost)},${y(p.score)}`).join(' ')}"/>`);
  points.forEach((p, i) => {
    const on = front.has(i);
    // 标签:右半边的点写在左侧(不被裁掉);前沿上的点写上方,其余写下方(相邻两点不叠字)
    const left = x(p.cost) > (L + W - R) / 2;
    const lx = x(p.cost) + (left ? -9 : 9), ly = y(p.score) + (on ? -9 : 16);
    out.push(`<g class="pt${on ? ' on' : ''}"><circle cx="${x(p.cost)}" cy="${y(p.score)}" r="${on ? 6 : 4.5}"><title>${esc(p.label)} · score ${pct(p.score)} · ${usd(p.cost)}/success</title></circle>` +
      `<text x="${lx}" y="${ly}" text-anchor="${left ? 'end' : 'start'}">${esc(p.label)}</text></g>`);
  });
  out.push('</svg>');
  return out.join('');
}

function boardTable(rows, { external = false, quizzes = [] } = {}) {
  const quizOf = (m) => quizzes.find((q) => q.model === m);
  const head = `<tr><th>#</th><th class="model">${external ? '客户端 / 模型' : '模型'}</th><th>通关</th><th>闭卷测验</th><th>成功局平均回合</th><th>成功局平均 cost</th><th>总 cost</th><th>tokens</th><th>题 / 局</th><th>核验</th><th>代码</th><th>运行</th></tr>`;
  const body = rows.map((r, i) => `<tr${r.complete ? '' : ' class="incomplete"'}>` +
    `<td class="num muted">${i + 1}</td><td class="model">${esc(r.model)}</td>${scoreCell(r.score, r)}` +
    `<td class="num">${quizOf(r.model) ? pct(quizOf(r.model).score) : '<span class="muted">–</span>'}</td>` +
    `<td class="num">${r.battleRoundsMeanOnSuccess == null ? '–' : r.battleRoundsMeanOnSuccess.toFixed(2)}</td><td class="num">${r.score ? usd(r.costMeanOnSuccess) : '–'}</td><td class="num">${usd(r.costTotal)}</td><td class="num">${tok(r.tokensTotal)}</td>` +
    `<td class="num">${r.tasks.filter((t) => t.n).length} / ${r.episodes}${r.complete ? '' : ' <span class="warn">未跑完</span>'}</td>` +
    `<td>${verifyCell(r.verify)}</td><td><code>${esc(r.code || '?')}</code> <span class="muted">提示 v${esc(r.promptVersion ?? '?')}</span>${r.books ? `<br><code title="${esc([...r.books.guide, `atlas ${r.books.atlas}`].join('\n'))}">资料 ${esc(r.books.id)}</code>` : ''}</td><td><code>${esc(r.runId)}</code></td></tr>`).join('');
  return `<div class="scroll"><table>${head}${body}</table></div>`;
}

function quizSection(quizzes) {
  if (!quizzes.length) return '';
  const tasks = [...new Set(quizzes.flatMap((q) => Object.keys(q.perTask)))].sort();
  const head = `<tr><th>模型</th><th>测验分</th><th>题均</th><th>问数</th><th>提示版本</th><th>代码</th></tr>`;
  const body = quizzes.map((q) => `<tr><td class="model">${esc(q.model)}</td><td class="num strong">${pct(q.score)}</td><td class="num">${pct(q.taskMean)}</td>` +
    `<td class="num">${q.n}</td><td class="num">v${esc(q.promptVersion ?? '?')}</td><td><code>${esc(q.code || '?')}</code></td></tr>`).join('');
  const mHead = `<tr><th>题</th>${quizzes.map((q) => `<th class="model">${esc(q.model)}</th>`).join('')}</tr>`;
  const mBody = tasks.map((t) => `<tr><td><code>${esc(t)}</code></td>${quizzes.map((q) => {
    const x = q.perTask[t];
    if (!x) return '<td class="num muted">–</td>';
    // quiz.json 是本地文件、可能被手改:数字一律转成数字再拼,不让任意字符串进 HTML
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return `<td class="num cell" style="--s:${Math.round(num(x.score) * 100)}%">${num(x.correct)}/${num(x.n)}</td>`;
  }).join('')}</tr>`).join('');
  return `<section><h2>闭卷测验(训练数据污染检测)</h2>
<p class="muted">不开游戏、不给工具,只问模型记得多少(spec §8.1)。与同一模型的游戏成绩并排看:测验高、游戏低 = 记得却用不上;
测验低、游戏高 = 靠现场推理而不是背攻略。关键词判分,不用模型当裁判。</p>
<div class="scroll"><table>${head}${body}</table></div><h3>每题答对数</h3><div class="scroll"><table class="matrix">${mHead}${mBody}</table></div></section>`;
}

const CSS = `
/* 横幅配色:宣纸 / 墨 / 月 / 朱砂印;夜间换成月下青山 */
:root{--sky1:#f6f1e4;--sky2:#ebe2cd;--ink:#2a2925;--moon:#fffaf0;--cloud:#cfc4ab;--seal:#b5372a;--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6a66;--line:#e3e2de;--card:#fff;--accent:#2f6fb3;--good:#2e7d4f;--bad:#b3412f;--warn:#9a6a00;--cell:47,111,179;--soft:#f3f2ee}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--sky1:#0f141d;--sky2:#1b2230;--ink:#8ea2b9;--moon:#f1e7c6;--cloud:#3a465a;--seal:#d4594a;--bg:#161615;--fg:#ecebe8;--muted:#9c9a94;--line:#33322f;--card:#1f1f1d;--accent:#7fb0e6;--good:#6cc08f;--bad:#e58a77;--warn:#e0b24f;--cell:127,176,230;--soft:#262623;color-scheme:dark}}
:root[data-theme="dark"]{--sky1:#0f141d;--sky2:#1b2230;--ink:#8ea2b9;--moon:#f1e7c6;--cloud:#3a465a;--seal:#d4594a;--bg:#161615;--fg:#ecebe8;--muted:#9c9a94;--line:#33322f;--card:#1f1f1d;--accent:#7fb0e6;--good:#6cc08f;--bad:#e58a77;--warn:#e0b24f;--cell:127,176,230;--soft:#262623;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 56px}h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:28px 0 8px}h3{font-size:15px;margin:20px 0 8px;color:var(--muted)}
.muted{color:var(--muted)}.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-weight:600;color:var(--muted);background:var(--soft)}tr:last-child td{border-bottom:0}.num{text-align:right;font-variant-numeric:tabular-nums}.strong{font-weight:700}
.model{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}code{font-size:12px;color:var(--muted)}
tr.incomplete td{opacity:.75}.warn{color:var(--warn);font-size:12px}
.v{font-size:12px;padding:1px 6px;border-radius:4px;border:1px solid currentColor}.v-verified{color:var(--good)}.v-mismatch{color:var(--bad)}.v-stale{color:var(--warn)}.v-none{color:var(--muted)}
.cell{background:rgba(var(--cell),calc(var(--s) * .35 / 100%))}
svg{width:100%;height:auto;display:block;background:var(--card);border:1px solid var(--line);border-radius:8px}
svg .grid{stroke:var(--line)}svg .tick,svg .axis{fill:var(--muted);font-size:11px}svg .axis{font-size:12px}
svg .pt circle{fill:var(--muted);opacity:.8}svg .pt.on circle{fill:var(--accent);opacity:1}svg .pt text{fill:var(--fg);font-size:11px}
svg .front{fill:none;stroke:var(--accent);stroke-width:1.5;stroke-dasharray:4 3}
.topbar{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px}
.navlinks{display:flex;flex-wrap:wrap;gap:8px;font-size:13px}
.navlinks a{color:var(--accent);text-decoration:none;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card)}
.navlinks a:hover{border-color:var(--accent)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:16px 0 22px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi .k-label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.kpi .k-val{font-size:26px;font-weight:800;margin:4px 0 2px;font-variant-numeric:tabular-nums}
.kpi .k-val.good{color:var(--good)}.kpi .k-val.accent{color:var(--accent)}.kpi .k-val.warn{color:var(--warn)}
.kpi .k-sub{font-size:12px;color:var(--muted)}
.podium{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px;margin:16px 0 24px}
.champ{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:10px;padding:16px}
.champ.gold{border-top-color:#d4a017}.champ.silver{border-top-color:#7fb0e6}.champ.bronze{border-top-color:#2e7d4f}
.champ-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.champ-title{font-weight:700;font-size:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.badge{font-size:12px;padding:2px 8px;border-radius:99px;font-weight:600;background:var(--soft);color:var(--fg)}
.badge.good{background:rgba(46,125,79,.15);color:var(--good)}.badge.warn{background:rgba(154,106,0,.15);color:var(--warn)}.badge.bad{background:rgba(179,65,47,.15);color:var(--bad)}
.champ-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0;padding:10px;background:var(--soft);border-radius:8px;text-align:center}
.champ-metrics .m-v{font-weight:700;font-size:14px;font-variant-numeric:tabular-nums}
.champ-metrics .m-k{font-size:11px;color:var(--muted)}
.champ-desc{font-size:13px;color:var(--muted);margin:6px 0 0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.card h3{margin:0 0 8px;color:var(--fg);font-size:15px}
.card p{margin:6px 0;font-size:13.5px;color:var(--muted)}
.bar-row{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:13px}
.bar-name{width:175px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{flex:1;height:10px;background:var(--soft);border-radius:99px;overflow:hidden}
.bar-fill{height:100%;background:var(--accent);border-radius:99px}
.bar-fill.good{background:var(--good)}.bar-fill.warn{background:var(--warn)}.bar-fill.bad{background:var(--bad)}
.bar-val{width:76px;text-align:right;font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)}
.tab-bar{display:flex;flex-wrap:wrap;gap:6px;border-bottom:2px solid var(--line);margin:20px 0 18px;padding-bottom:0}
.tab-lbl{padding:9px 15px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;margin-bottom:-2px;user-select:none;transition:all .15s}
.tab-lbl:hover{color:var(--fg);background:var(--soft)}
.tab-pane{display:none}
#tab-stats:checked ~ .tab-bar label[for="tab-stats"],
#tab-tiers:checked ~ .tab-bar label[for="tab-tiers"],
#tab-ironman:checked ~ .tab-bar label[for="tab-ironman"],
#tab-quiz:checked ~ .tab-bar label[for="tab-quiz"]{color:var(--accent);background:var(--card);border-color:var(--line);border-bottom:2px solid var(--card)}
#tab-stats:checked ~ .panes #pane-stats,
#tab-tiers:checked ~ .panes #pane-tiers,
#tab-ironman:checked ~ .panes #pane-ironman,
#tab-quiz:checked ~ .panes #pane-quiz{display:block}
@media print{.tab-pane{display:block!important}}
.landing .lead{font-size:16px;line-height:1.75;max-width:880px;margin:4px 0 18px}
.pillars{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:0 0 26px}
.pillar{position:relative;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 18px 14px;display:flex;flex-direction:column}
.pillar .p-no{position:absolute;top:12px;right:14px;font-family:"Ma Shan Zheng","STKaiti","KaiTi",serif;font-size:30px;line-height:1;color:var(--seal);opacity:.8}
.pillar h3{margin:0 0 8px;font-size:17px;color:var(--fg)}
.pillar p{margin:0 0 12px;font-size:13.5px;color:var(--muted);line-height:1.65;flex:1}
.pillar .p-meta{font-size:12px;color:var(--accent);border-top:1px dashed var(--line);padding-top:8px}
.landing>h2{margin-top:30px}
.task-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:12px}
.task-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0}
.task-card h4{margin:0 0 8px;font-size:14px;line-height:1.45}
.task-card .tid{display:block;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);font-weight:400}
table.mini{font-size:13px;width:100%}table.mini th,table.mini td{padding:4px 6px;white-space:nowrap}
.task-card{overflow-x:auto}
.empty-lb{color:var(--muted);font-size:14px}
.empty-lb.big{background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:18px 20px}
.empty-lb.big strong{color:var(--seal);font-size:16px;margin-right:6px}
.cta{margin:34px 0 8px;padding:20px 22px;border-radius:14px;border:1px solid var(--line);background:linear-gradient(180deg,var(--sky1),var(--card))}
.cta h2{margin:0 0 8px;border:0;padding:0}
.cta p,.cta li{font-size:14px;color:var(--muted);line-height:1.7}
.cta ol{padding-left:20px;margin:6px 0 12px}.cta code{word-break:break-all}
.btn{display:inline-block;padding:8px 16px;border-radius:8px;background:var(--seal);color:#fff;text-decoration:none;font-weight:600}
.btn:hover{filter:brightness(1.08)}
.cite{margin:30px 0 8px}
.cite h2{margin:0 0 8px}
.cite p{font-size:14px;color:var(--muted);margin:6px 0}
.bib{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px}
.bib pre{margin:0;padding:14px 16px;overflow-x:auto;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg)}
.bib .copy{position:absolute;top:8px;right:8px;font:12px system-ui,sans-serif;padding:3px 10px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--fg);cursor:pointer}
.bib .copy:hover{border-color:var(--accent)}
.banner{position:relative;overflow:hidden;border-radius:14px;min-height:230px;margin:0 0 14px;background:linear-gradient(180deg,var(--sky1),var(--sky2));border:1px solid var(--line)}
.banner .scape{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;background:none}
.banner-text{position:relative;padding:26px 28px 0;max-width:720px}
.eyebrow{display:flex;align-items:center;gap:14px}
.brush{font-family:"Ma Shan Zheng","STKaiti","KaiTi","Kaiti SC",serif;font-size:52px;line-height:1.1;color:var(--ink);letter-spacing:.06em}
.seal{display:inline-grid;grid-auto-rows:1fr;place-items:center;width:40px;height:52px;padding:3px 0;border:2px solid var(--seal);border-radius:4px;color:var(--seal);font-family:"Ma Shan Zheng","STKaiti","KaiTi",serif;font-size:19px;line-height:1;transform:rotate(-4deg)}.seal i{font-style:normal}
.banner h1{margin:10px 0 4px;font-size:20px;color:var(--fg)}
.banner .meta{display:inline-block;margin:0;padding:3px 10px;font-size:13px;color:var(--muted);background:color-mix(in srgb,var(--sky1) 82%,transparent);border-radius:6px}
.banner .gh{position:absolute;top:14px;right:16px;z-index:1;font-size:13px;font-weight:600;color:var(--fg);text-decoration:none;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--sky1) 80%,transparent)}
.banner .gh:hover{border-color:var(--seal);color:var(--seal)}
section p.muted a{color:var(--accent)}
section>h2{border-left:3px solid var(--seal);padding-left:10px}
@media (max-width:640px){.banner{min-height:200px}.banner-text{padding:18px 16px 0}.brush{font-size:34px}.banner .gh{top:10px;right:10px;padding:2px 8px;font-size:12px}.seal{width:34px;height:44px;font-size:15px}.banner h1{font-size:17px}}
/* 宽表:模型列钉在左边,横向滚动时不丢「这一行是谁」;叙述性的最后一列换行,不把表撑到两千像素 */
.scroll td.model,.scroll th.model{position:sticky;left:0;z-index:1;background:var(--card)}
.scroll th.model{background:var(--soft)}
.scroll .matrix tr>:first-child{position:sticky;left:0;z-index:1;background:var(--card)}
.scroll .matrix th:first-child{background:var(--soft)}
table.wrap td:last-child{white-space:normal;min-width:240px;max-width:420px}
table.wrap td{vertical-align:top}
tbody tr:hover td,table tr:hover td{background-image:linear-gradient(rgba(var(--cell),.06),rgba(var(--cell),.06))}
.sbar{display:inline-block;width:44px;height:6px;margin-right:8px;vertical-align:middle;border-radius:99px;background:linear-gradient(90deg,var(--accent) var(--p),var(--soft) var(--p))}
.note{font-size:13.5px;color:var(--muted);background:var(--soft);border-radius:8px;padding:8px 12px;margin:0 0 12px}
.note a{color:var(--accent)}
/* 标签:单选框藏起来但留在键盘焦点链里(左右键切换);窄屏一行横滑,不竖排占满一屏 */
.tab-ctrl{display:block;position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.tab-bar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.tab-bar::-webkit-scrollbar{display:none}
.tab-lbl{white-space:nowrap;flex:none}
#tab-stats:focus-visible ~ .tab-bar label[for="tab-stats"],#tab-tiers:focus-visible ~ .tab-bar label[for="tab-tiers"],#tab-ironman:focus-visible ~ .tab-bar label[for="tab-ironman"],#tab-quiz:focus-visible ~ .tab-bar label[for="tab-quiz"]{outline:2px solid var(--accent);outline-offset:-2px}
@media (max-width:640px){h1{font-size:20px}main{padding:16px 16px 40px}.navlinks a{padding:3px 8px}.kpi .k-val{font-size:22px}.podium,.grid2{grid-template-columns:1fr}}
`;

/** 技术报告的引用条目:不写版本号,只指向 GitHub 仓库(报告随仓库更新) */
export const BIBTEX = `@misc{liu2026agentpalbench,
  title        = {Agent-PAL-Bench: Evaluating Long-Horizon Decision-Making in a Chinese Role-Playing Game Through Text-Based Interaction},
  author       = {Liu, Jianming},
  year         = {2026},
  howpublished = {\\url{https://github.com/jianmliu/agent-pal}},
  note         = {Technical report and open-source benchmark}
}`;

/** 任务显示顺序:按剧情先后(开场 → 第一章 → 经典存档按章 → 终局 → 拜月) */
const TASK_ORDER = (id) => (/^opening/.test(id) ? 0 : /^wine/.test(id) ? 1 : /^pal-ch1/.test(id) ? 2 : /^classic(\d+)/.test(id) ? 10 + Number(id.match(/^classic(\d+)/)[1]) : /^pal-final/.test(id) ? 90 : /^baiyue/.test(id) ? 95 : 99);
const shortModel = (m) => String(m || '').replace(/^[^:]+:/, '');
const taskTitle = (id) => { try { return loadTask(id)?.title || id; } catch { return id; } };

/** 分章节关卡:每题 × 每个模型取最好的一局通关(拜月按战斗回合,其余按步数),只看成功局 */
export function clearedByTask(rows) {
  const tasks = new Map();
  for (const r of rows) for (const t of r.tasks || []) for (const e of t.episodes || []) {
    if (!e.success) continue;
    const byModel = tasks.get(t.id) || new Map(); tasks.set(t.id, byModel);
    const cur = byModel.get(r.model);
    const better = (x, y) => (x.battleRounds ?? Infinity) - (y.battleRounds ?? Infinity) || (x.successAt ?? Infinity) - (y.successAt ?? Infinity) || (x.cost ?? Infinity) - (y.cost ?? Infinity);
    const cand = { ...e, model: r.model, verified: r.verify?.state === 'verified' };
    if (!cur || better(cand, cur) < 0) byModel.set(r.model, cand);
  }
  return [...tasks.entries()].map(([id, m]) => ({ id, title: taskTitle(id), wins: [...m.values()].sort((x, y) => (x.battleRounds ?? Infinity) - (y.battleRounds ?? Infinity) || (x.successAt ?? Infinity) - (y.successAt ?? Infinity) || (x.cost ?? Infinity) - (y.cost ?? Infinity)) }))
    .sort((a, b) => TASK_ORDER(a.id) - TASK_ORDER(b.id) || a.id.localeCompare(b.id));
}

function landingSection(rows, quizzes) {
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || String(i + 1);
  const quizBoard = quizzes.length
    ? `<div class="scroll"><table><tr><th>#</th><th class="model">模型</th><th>得分</th><th>答对 / 题数</th></tr>${[...quizzes].sort((a, b) => b.score - a.score).map((q, i) => `<tr><td class="num">${medal(i)}</td><td class="model">${esc(shortModel(q.model))}</td>${scoreCell(q.score)}<td class="num">${Math.round(q.score * q.n)} / ${q.n}</td></tr>`).join('')}</table></div>`
    : '<p class="empty-lb">还没有闭卷成绩。</p>';
  const byTask = clearedByTask(rows);
  const taskBoard = byTask.length ? `<div class="task-grid">${byTask.map((t) => {
    const battle = t.wins.some((w) => w.battleRounds != null);
    return `<article class="task-card"><h4><span class="tid">${esc(t.id)}</span>${esc(t.title)}</h4><table class="mini"><tr><th></th><th>模型</th><th class="num">${battle ? '回合' : '步数'}</th><th class="num">par</th><th class="num">花费</th></tr>${t.wins.map((w, i) =>
      `<tr><td>${medal(i)}</td><td class="model">${esc(shortModel(w.model))}${w.verified ? ' <span class="v v-verified" title="bench verify 重放一致">✓</span>' : ''}</td><td class="num">${battle ? (w.battleRounds ?? '–') : (w.successAt ?? '–')}</td><td class="num muted">${w.par ?? '–'}</td><td class="num muted">${usd(w.cost)}</td></tr>`).join('')}</table></article>`;
  }).join('')}</div>` : '<p class="empty-lb">还没有通关成绩。</p>';
  return `<section class="landing">
<p class="lead"><strong>agent-pal-bench</strong> 用 1995 年 DOS 原版《仙剑奇侠传》考 AI 智能体的<strong>长程决策</strong>：读对白找线索、跨场景记住状态、在迷宫和 Boss 战里提出并证伪假设。引擎是确定性的 —— 同一种子、同一串操作，结果唯一，所以每份成绩都能<strong>不花一分 API 费用重放核验</strong>。四个栏目从「知道」到「做到」逐级加码：</p>
<div class="pillars">
  <article class="pillar"><div class="p-no">壹</div><h3>闭卷笔试</h3><p>不开游戏、不给工具，按关卡配对提问，只答一行；拿不准必须答「不知道」，乱猜判错。关键词判分，不用模型当裁判。用来分清<strong>背过攻略</strong>和<strong>现场推理</strong>。</p><div class="p-meta">22 问 · 关键词判分</div></article>
  <article class="pillar"><div class="p-no">贰</div><h3>分章节关卡</h3><p>从各章节切出的迷宫、剧情锁与 Boss 战，各从固定存档出发：谜题、跨场景寻物、长链侦探、终局决战。目标与里程碑由谓词判定，参考解给出 par，调用与 token 都有预算。</p><div class="p-meta">23 题 · par + 预算 · 重放核验</div></article>
  <article class="pillar"><div class="p-no">叁</div><h3>基本工具通关</h3><p>从「新的故事」开始，只用标准工具 —— 看周围、寻路、对话、战斗、用物品 —— 一路打到全剧终。考的是跨十一章的规划、记忆与资源管理。</p><div class="p-meta">新游戏 → 全剧终 · 标准工具</div></article>
  <article class="pillar"><div class="p-no">肆</div><h3>编程通关</h3><p>拿掉寻路、互动、地图这些高级工具，只给底层协议包、方向键和一个 JavaScript 沙箱。模型要现场写寻路器、脚本反编译器和战斗状态机，打穿全游戏。</p><div class="p-meta"><code>--pure</code> · Tier P</div></article>
</div>

<h2>排行 · 壹 闭卷笔试</h2>
<p class="muted">参评模型的闭卷得分（只列榜上有通关成绩的模型）。笔试高不代表打得过 —— 对照下面几栏看「知道」与「做到」的差距。</p>
${quizBoard}

<h2>排行 · 贰 分章节关卡</h2>
<p class="muted">每道题列出打通过它的模型，各取最好的一局：普通关卡按步数排，拜月决战按战斗回合排；par 是参考解的步数。<span class="v v-verified">✓</span> = 这份成绩已按日志重放核验。</p>
${taskBoard}

<h2>排行 · 叁 基本工具通关</h2>
<div class="empty-lb big"><strong>虚位以待。</strong>还没有模型提交「只用标准工具、从新游戏打到全剧终」的记录 —— 第一个上榜的就是你的模型。</div>

<h2>排行 · 肆 编程通关</h2>
<p class="muted"><code>--pure</code> 模式下从新游戏写代码打到全剧终的模型（详见「全游戏通关」页）。</p>
<div class="scroll"><table class="wrap"><tr><th>#</th><th class="model">模型</th><th>结局</th><th class="num">工具调用</th><th class="num">会话</th><th class="num">自写代码库</th><th class="num">终局等级</th></tr>
<tr><td class="num">🥇</td><td class="model">gpt-6.1-sol</td><td><span class="badge good">全剧终</span></td><td class="num strong">845</td><td class="num">1 段</td><td class="num">135 行</td><td class="num">Lv35 / 32 / 30</td></tr>
<tr><td class="num">🥈</td><td class="model">claude-opus-5-5</td><td><span class="badge good">全剧终</span></td><td class="num">1,453</td><td class="num">2 段</td><td class="num">1,427 行</td><td class="num">Lv45 / 43 / 42</td></tr>
<tr><td class="num">🥉</td><td class="model">gemini-4-argon</td><td><span class="badge good">全剧终</span></td><td class="num">1,704</td><td class="num">5 段</td><td class="num">731 行</td><td class="num">Lv36 / 33 / 31</td></tr>
</table></div>
<p class="muted">按工具调用次数排（越少越好）。</p>

<div class="cta">
  <h2>提交你的模型</h2>
  <p>榜单<strong>只收通关的那一局</strong>：没打通的局不计，一局都没打通的模型不上榜。每一局都要先过 <code>bench verify</code> 的重放核验，PR 门禁会再自动查一遍 —— 维护者不用花钱重调模型。</p>
  <ol>
    <li>用自己的额度跑：<code>node bin/agent-pal.mjs bench run --model &lt;provider:model&gt; --tier B --tasks &lt;题&gt; --out bench/out/&lt;你的运行&gt;</code></li>
    <li>核验并删掉没打通的局：<code>node bin/agent-pal.mjs bench verify bench/out/&lt;你的运行&gt;</code></li>
    <li>本地自检后提 PR：<code>node bench/bench.mjs check-pr</code>，合并后榜单自动更新</li>
  </ol>
  <p><a class="btn" href="https://github.com/jianmliu/agent-pal" target="_blank" rel="noopener">去 GitHub 提交 PR →</a></p>
</div>

<div class="cite">
  <h2>技术报告与引用</h2>
  <p>在论文、文章里引用这份报告，或使用本仓库的题目、代码与评测轨迹时，请引用：</p>
  <div class="bib"><button type="button" class="copy" data-copy="bibtex">复制</button><pre id="bibtex">${esc(BIBTEX)}</pre></div>
</div>
</section>`;
}

function perTaskDeepDiveSection() {
  return `<section>
<h2>四大专项擂台深度拆解：步数、回合、转折点与行为诊断</h2>
<p class="muted">本页汇总四大核心实操考题中各模型的步数、回合数、Token 消耗与关键转折点遥测数据。</p>
<div class="grid2">
  <div class="card">
    <h3>🧠 决定通关的四大底层 Agent 核心内功</h3>
    <p><strong>① 零成本认知探针（Epistemic Probe）：</strong>面对 45° 坐标歧义，<code>Claude Opus 5.5</code> 用 1 步 <code>use_item</code> 实测代替代数空想，10 步破局。</p>
    <p><strong>② 止损弹性（Pivot Elasticity）：</strong>白河猎场放偏第一枚捕兽夹后，<code>Argon</code>（5步）与 <code>GPT-6.1</code>（7步）秒收夹重放；揚州井口打不开时，<code>Argon</code> 22 步转登城墙，而 <code>GPT-6.1</code> 被错误记忆锚定 82 步。</p>
    <p><strong>③ 控制变量消元法：</strong>面对回合制批量结算（<code>ΔHP = x1+x2+x3</code>），<code>Claude</code> 固定两人投 1000 伤毒药解出单招真实伤害。</p>
    <p><strong>④ 自演化代码库（Self-Coding Library）：</strong><code>--pure</code> 模式下三剑客将开门、寻路、反编译沉淀为持久化 JS 库，越往后越少被同一类障碍卡住。</p>
  </div>
</div>

<h3>擂台一：大理祈雨祭坛（<code>classic48-rain-orbs</code>，<code>par = 7</code>，预算 80 步）</h3>
<p class="muted">考察点：石碑正交方位（东北/东南/西南/西北）向 45° 斜向梅花桩坐标的映射，以及“先内省证明 vs 先发 1 步探针”。</p>
<div class="scroll">
<table class="wrap">
  <tr><th>排名</th><th class="model">模型</th><th>厂商</th><th>笔试该题分</th><th>实操通关</th><th>通关步数</th><th>思考输出 Tokens</th><th>策略画像与死因分析</th></tr>
  <tr><td class="num strong">🥇 1</td><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">0% (0/5)</td><td><span class="badge good">100%</span></td><td class="num strong">10 步</td><td class="num">2,158</td><td>1 步 <code>use_item</code> 探针试出旋转方向，下一轮 4 珠连放收官</td></tr>
  <tr><td class="num strong">🥇 1</td><td class="model">claude-cli:claude-fable-5-1</td><td>Anthropic</td><td class="num">–</td><td><span class="badge good">100%</span></td><td class="num strong">10 步</td><td class="num">1,259</td><td>1 步探针锁定方位，10 步并列全场最快</td></tr>
  <tr><td class="num strong">🥉 3</td><td class="model">agy-cli:gemini-4-argon</td><td>Google</td><td class="num">20% (1/5)</td><td><span class="badge good">100%</span></td><td class="num strong">13 步</td><td class="num">–</td><td>读碑后试放 1 次立即锁定 45° 顺时针映射</td></tr>
  <tr><td class="num strong">🥉 3</td><td class="model">codex-cli:gpt-6-astra</td><td>OpenAI</td><td class="num">–</td><td><span class="badge good">100%</span></td><td class="num strong">13 步</td><td class="num">726</td><td>1 步试放消解 45° 旋转歧义，13 步收官</td></tr>
  <tr><td class="num">5</td><td class="model">agy-cli:gemini-3.8-flash</td><td>Google</td><td class="num">–</td><td><span class="badge good">100%</span></td><td class="num">17 步</td><td class="num">11,310</td><td>第 5 步激活石碑，第 13 步首珠入槽，17 步（$0.18）稳健通关</td></tr>
  <tr><td class="num">6</td><td class="model">codex-cli:gpt-6.1-sol</td><td>OpenAI</td><td class="num">20% (1/5)</td><td><span class="badge good">100%</span></td><td class="num">22 步</td><td class="num">4,295</td><td>稳健巡视五座石柱坐标后逐一配对归位</td></tr>
</table>
</div>

<h3>擂台二：白河村三味药材（<code>classic10-baihe-medicine</code>，<code>par = 40</code>，标准 120 步 / 扩容 240 步）</h3>
<p class="muted">考察点：银杏子 + 借竿钓鱼 + 猎场布夹赶鹿三线并进。对比“背过攻略直奔南门”与“零先验挨家搜全村”的步数拆解。</p>
<div class="scroll">
<table class="wrap">
  <tr><th>排名</th><th class="model">模型</th><th>厂商</th><th>笔试得分</th><th>120步标准赛</th><th>240步扩容赛</th><th>村内6民居地毯搜索开销</th><th>猎场第一夹放偏后的止损步数</th></tr>
  <tr><td class="num strong">🥇 1</td><td class="model">agy-cli:gemini-4-argon</td><td>Google</td><td class="num">80% (4/5)</td><td><span class="badge good">100% (90步)</span></td><td><span class="badge good">100% (90/120步)</span></td><td class="num strong">0 步 (直奔南门猎场)</td><td class="num strong">5 步 (秒收夹改放 45,111)</td></tr>
  <tr><td class="num strong">🥈 2</td><td class="model">codex-cli:gpt-6.1-sol</td><td>OpenAI</td><td class="num">100% (5/5)</td><td><span class="badge good">100% (105步)</span></td><td><span class="badge good">100% (105–117步)</span></td><td class="num strong">4 步 (直奔南门猎场)</td><td class="num strong">7–8 步 (迅速移夹至 44,110)</td></tr>
  <tr><td class="num strong">🥉 3</td><td class="model">codex-cli:gpt-6-astra</td><td>OpenAI</td><td class="num">–</td><td><span class="badge good">100% (107步)</span></td><td><span class="badge good">100% (107步)</span></td><td class="num">少量探路后进南门猎场</td><td class="num">107 步标准预算内一次通关</td></tr>
  <tr><td class="num">4</td><td class="model">agy-cli:gemini-3.8-flash</td><td>Google</td><td class="num">–</td><td class="muted">– 未跑</td><td><span class="badge good">100% (138步)</span></td><td class="num">第 51 步摘银杏、第 82 步钓鲤鱼</td><td class="num">第 132 步获鹿茸、138 步交药（$1.46）</td></tr>
  <tr><td class="num">5</td><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">0% (0/5)</td><td class="muted">– 未通关</td><td><span class="badge good">100% (143/176步)</span></td><td class="num">39–43 步 (搜遍全村6民居)</td><td class="num">23–48 步 (执着赶鹿后起夹重放)</td></tr>
  <tr><td class="num">6</td><td class="model">claude-cli:claude-fable-5-1</td><td>Anthropic</td><td class="num">–</td><td class="muted">– 未跑</td><td><span class="badge good">100% (203步)</span></td><td class="num">全村探索清图</td><td class="num">203 步完成三味药收集交回医仙</td></tr>
</table>
</div>

<h3>擂台三：扬州夜雨与紫金葫芦长链（<code>classic19-yangzhou-gourd</code>，<code>par = 74</code>，跨 15 场景 5 大里程碑）</h3>
<p class="muted">考察点：客栈投宿 → 屋顶追女飞贼夺布包 → 富商诬陷 → 拜访寡妇姬三娘 → 登高处目击投井 → 古井底搜出紫金葫芦。</p>
<div class="scroll">
<table class="wrap">
  <tr><th>排名</th><th class="model">模型</th><th>厂商</th><th>笔试葫芦考</th><th>总通关步数</th><th>净主线步数</th><th>M1 客栈夜警</th><th>M2 屋顶夺包</th><th>M3 富商诬陷</th><th>M4 拜访寡妇</th><th>M4→M5 破除“井边盲区”耗时与路径</th></tr>
  <tr><td class="num strong">🥇 1</td><td class="model">codex-cli:gpt-6-astra</td><td>OpenAI</td><td class="num">–</td><td class="num strong">146 步</td><td class="num strong">146 步</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td><strong>146 步全场最低总步数</strong>标准预算内直通古井底拿到紫金葫芦</td></tr>
  <tr><td class="num strong">🥈 2</td><td class="model">agy-cli:gemini-4-argon</td><td>Google</td><td class="num">60% (3/5)</td><td class="num strong">161 步</td><td class="num strong">139 步</td><td class="num">16</td><td class="num">50</td><td class="num">68</td><td class="num">101</td><td><strong>仅 22 步</strong>（井口受阻后调 map 登东北台阶上城墙；井底顺手开完11宝箱）</td></tr>
  <tr><td class="num strong">🥉 3</td><td class="model">codex-cli:gpt-6.1-sol</td><td>OpenAI</td><td class="num">40% (2/5)</td><td class="num">218 步</td><td class="num">218 步</td><td class="num">18</td><td class="num">46</td><td class="num">60</td><td class="num">104</td><td><strong>被困 82 步</strong>（受错误先验锚定 5 次进出寡妇家搜家具，第186步才上城墙）</td></tr>
  <tr><td class="num">4</td><td class="model">agy-cli:gemini-3.8-flash</td><td>Google</td><td class="num">–</td><td class="num strong">231 步</td><td class="num strong">212 步</td><td class="num">62</td><td class="num">101</td><td class="num">114</td><td class="num">130</td><td><strong>第186步登城墙触发投井：</strong>回屋内做 7×7 坐标探测排除密道后，第223步下井、231步通关（放宽熔断窗口至60步）</td></tr>
  <tr><td class="num">5</td><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">0% (0/5)</td><td class="num">280 步</td><td class="num strong">215 步</td><td class="num">56</td><td class="num">161 (首胜@94漏捡)</td><td class="num">169</td><td class="num">177</td><td><strong>跨 4 重屋顶奇袭</strong>（回客栈二楼翻窗 <code>85→98→87→98→85→98→86</code> 复用屋顶图）</td></tr>
</table>
</div>

<h3>擂台四：南诏王宫决战拜月教主（<code>baiyue-single-origin</code> 常规赛 vs 废除三板斧反事实禁招赛）</h3>
<p class="muted">考察点：面对 32,760 HP 终局 Boss 的同上下文团灭复盘学习（In-Context RL），以及禁用“酒神 + 乾坤一掷 + 隐蛊”后的纯机制推导。</p>
<div class="scroll">
<table class="wrap">
  <tr><th class="model">模型</th><th>厂商</th><th>笔试拜月考</th><th>上半场：常规决战 (胜局回合)</th><th>常规赛战术拆解</th><th>下半场：禁招消融赛 (胜局回合)</th><th>禁招赛机制发现与成败归因</th></tr>
  <tr><td class="model">agy-cli:gemini-4-argon</td><td>Google</td><td class="num">100% (3/3)</td><td class="num strong">🥇 7.00 回合 (第2命/42步)</td><td>第 2 命补双 <code>五氣朝元</code> + <code>乾坤一擲</code> 创 7 回合 0 死纪录</td><td class="num strong">🥉 39.00 回合 (第2命/114步)</td><td>第 2 命叠防 + 投掷神兵，全场唯一发明 <code>{"action":"repeat"}</code> 循环宏</td></tr>
  <tr><td class="model">agy-cli:gemini-3.8-flash</td><td>Google</td><td class="num">–</td><td class="num strong">🥈 9.00 回合 (第1命/25步)</td><td><strong>初见第 1 命 0 团灭最快纪录：</strong>仅 25 步 / 56.1s / $0.37 极速斩拜月</td><td class="muted">– 未跑</td><td>常规赛 1 命速通效率超越全尺寸旗舰</td></tr>
  <tr><td class="model">codex-cli:gpt-6-astra</td><td>OpenAI</td><td class="num">–</td><td class="num strong">🥉 11.00 回合 (第1命/28步)</td><td><strong>初见第 1 命一次过：</strong>仅 28 步 / 95.3s 极速斩拜月</td><td class="num strong">✓ 54.00 回合 (第2命/220步)</td><td>第 2 命 <code>真元護體</code> + <code>天罡戰氣</code> + 投掷与剑神稳定磨穿 32,760 HP</td></tr>
  <tr><td class="model">codex-cli:gpt-6.1-sol</td><td>OpenAI</td><td class="num">67% (2/3)</td><td class="num strong">✓ 14.00 回合 (第1命/33步)</td><td><strong>初见第 1 命一次过：</strong>3 颗隐蛊维持 9 回合隐身 + 4 发酒神</td><td class="num strong">🥈 37.00 回合 (第2命/176步)</td><td>第 2 命构建“轮流 <code>真元護體</code> + 每回合 <code>五氣朝元</code>”37 回合铁桶阵</td></tr>
  <tr><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">33% (1/3)</td><td class="num">17.00 回合 (第4命/157步)</td><td>全程未用 <code>乾坤一擲</code>，自研群攻清场流分文未花过关</td><td class="num strong">🥇 36.00 回合夺冠! (第11命/542步)</td><td><strong>控制变量线性消元法</strong>测准单招伤害，第 11 命心算 &lt;5% 血线用 <code>化屍水</code> 秒杀夺冠</td></tr>
</table>
</div>
</section>`;
}

function ironmanAndPrSection() {
  return `<section>
<h2>肆 · 编程通关详情：从零写代码打穿全游戏（<code>--pure</code> 模式）</h2>
<p class="muted">在 <code>--pure</code>（Tier P）模式下，系统剥夺 <code>walk_to</code>、<code>interact</code>、<code>map</code> 等一切高级工具，只提供底层方向键原语与 <code>run_code</code> JS 沙盒。模型必须自己手写寻路器、字节码反编译器与战斗状态机打穿全部 11 章 300 个场景。</p>

<h3>🏆 三大全通满贯模型（Full-Clear Hall of Fame）深度画像对比</h3>
<div class="podium">
  <div class="champ gold">
    <div class="champ-head"><span class="champ-title">🥇 Gemini 4 Argon</span><span class="badge good">全通 #1 · 竞速之王</span></div>
    <div class="champ-metrics">
      <div><div class="m-v">64% (14/22)</div><div class="m-k">闭卷笔试(并列第1)</div></div>
      <div><div class="m-v">90步 / 161步</div><div class="m-k">白河 / 扬州(全场最快)</div></div>
      <div><div class="m-v">7 回合 / 39 回合</div><div class="m-k">拜月常规(纪录) / 禁招</div></div>
    </div>
    <p class="champ-desc"><strong>核心特质：先验储备与在线纠错双修。</strong>白河采药钓完鱼 0 步废话直奔南门猎场；扬州井口受阻仅花 <strong>22 步</strong> 即破除“井边盲区”错误先验登上城墙；全游戏 <code>--pure</code> 模式自写 <strong>731 行</strong> 引擎库打穿 11 章。</p>
  </div>
  <div class="champ silver">
    <div class="champ-head"><span class="champ-title">🥈 Claude Opus 5.5</span><span class="badge good">全通 #2 · 零先验推理之王</span></div>
    <div class="champ-metrics">
      <div><div class="m-v">14% (3卷0分)</div><div class="m-k">闭卷笔试(一张白纸)</div></div>
      <div><div class="m-v">10 步 (par=7)</div><div class="m-k">祈雨祭坛(全场第1)</div></div>
      <div><div class="m-v">36 回合夺冠!</div><div class="m-k">拜月禁招反事实赛</div></div>
    </div>
    <p class="champ-desc"><strong>核心特质：科学实验探针与控制变量消元。</strong>笔试对攻略一无所知，却靠 1 步零成本探针 10 步秒过祈雨坛；扬州横跨 4 重屋顶飞檐走壁奇袭；拜月禁招赛用<strong>控制变量线性消元法</strong>测准单招伤害并用 <code>化屍水</code> 斩杀满血 32,760 HP 拜月；自写 <strong>1,427 行</strong> 引擎库全通。</p>
  </div>
  <div class="champ bronze">
    <div class="champ-head"><span class="champ-title">🥉 GPT-6.1-Sol</span><span class="badge good">全通 #3 · 一命稳健宗师</span></div>
    <div class="champ-metrics">
      <div><div class="m-v">59% (13/22)</div><div class="m-k">闭卷笔试(白河满分)</div></div>
      <div><div class="m-v">第1命 14回合</div><div class="m-k">拜月全场唯一初见胜</div></div>
      <div><div class="m-v">845 次调用</div><div class="m-k">--pure 单轮一气呵成</div></div>
    </div>
    <p class="champ-desc"><strong>核心特质：极致工程密度与零失误执行。</strong>拜月常规赛全场唯一<strong>初见第 1 命 0 团灭</strong>通关（3 颗隐蛊 + 4 发酒神）；禁招赛第 2 命构建 37 回合铁桶阵；<code>--pure</code> 全游戏仅用 <strong>135 行</strong> 高密度函数式代码库、<strong>单会话 845 步</strong>直通全剧终。</p>
  </div>
</div>

<div class="scroll">
<table class="wrap">
  <tr><th>维度</th><th><code>Gemini 4 Argon</code></th><th><code>GPT-6.1-Sol</code></th><th><code>Claude Opus 5.5</code></th></tr>
  <tr><td><strong>最终结局</strong></td><td><span class="badge good">🏆 全剧终通关 (Slot 99)</span></td><td><span class="badge good">🏆 全剧终通关 (Slot 99)</span></td><td><span class="badge good">🏆 全剧终通关 (Slot 99)</span></td></tr>
  <tr><td><strong>推进剧情跨度</strong></td><td>全 11 章 (余杭 → 拜月水魔兽)</td><td>全 11 章 (余杭 → 拜月水魔兽)</td><td>全 11 章 (余杭 → 拜月水魔兽)</td></tr>
  <tr><td><strong>会话轮数</strong></td><td class="num">5 段接力</td><td class="num strong">单会话 1 轮到底!</td><td class="num">2 轮接力</td></tr>
  <tr><td><strong>总工具调用数</strong></td><td class="num">1,704 次 (主段 475 次)</td><td class="num strong">845 次 (全场最精简)</td><td class="num">1,453 次 (<code>run_code</code> 1,434 次)</td></tr>
  <tr><td><strong>自编写持久化引擎库</strong></td><td><code>argon-pure-lib.js</code> (<strong>731 行</strong>)</td><td><code>gpt61-pure-lib.js</code> (<strong>135 行</strong>)</td><td><code>opus-pure-lib.js</code> (<strong>1,427 行 / 43 函数</strong>)</td></tr>
  <tr><td><strong>通关队伍终局等级</strong></td><td class="num">Lv36 / Lv33 / Lv31</td><td class="num">Lv35 / Lv32 / Lv30</td><td class="num strong">Lv45 / Lv43 / Lv42 (刷满傀儡虫)</td></tr>
</table>
</div>

</section>`;
}

/**
 * 页首横幅:原创的水墨山水(远山 / 中山 / 近山三层、山间雾带、一轮月、几缕云)。
 * 全部是这里算出来的 SVG 路径 —— 不用游戏里的任何图片或音乐(版权素材不进仓库、不上公开页)。
 * 山脊用固定种子的伪随机数生成,每次生成的页面一模一样。
 */
function ridge(seed, { base, amp, step, w = 1200, h = 260 }) {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pts = [];
  for (let px = -step; px <= w + step; px += step) pts.push([px, base - amp * (0.35 + 0.65 * rnd()) * (0.6 + 0.4 * Math.sin(px / 170 + seed))]);
  let d = `M${pts[0][0]},${h} L${pts[0][0]},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    d += ` Q${((x0 + x1) / 2).toFixed(1)},${(Math.min(y0, y1) - amp * 0.18).toFixed(1)} ${x1},${y1.toFixed(1)}`;
  }
  return `${d} L${pts.at(-1)[0]},${h} Z`;
}
function banner(meta) {
  const scape = `<svg class="scape" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
<defs><radialGradient id="glow"><stop offset="0" stop-color="var(--moon)" stop-opacity=".55"/><stop offset="1" stop-color="var(--moon)" stop-opacity="0"/></radialGradient>
<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sky2)" stop-opacity="0"/><stop offset=".55" stop-color="var(--sky2)" stop-opacity=".85"/><stop offset="1" stop-color="var(--sky2)" stop-opacity="0"/></linearGradient></defs>
<circle cx="948" cy="66" r="78" fill="url(#glow)"/><circle cx="948" cy="66" r="30" fill="var(--moon)"/>
<g fill="none" stroke="var(--cloud)" stroke-width="2" stroke-linecap="round" opacity=".7"><path d="M760 92 q36 -14 70 -2 q26 -12 54 2"/><path d="M1010 118 q30 -10 58 0 q20 -8 42 2"/><path d="M180 70 q40 -16 82 -2 q30 -12 60 4"/></g>
<path d="${ridge(7, { base: 168, amp: 92, step: 90 })}" fill="var(--ink)" opacity=".16"/>
<rect x="0" y="128" width="1200" height="70" fill="url(#mist)"/>
<path d="${ridge(23, { base: 206, amp: 78, step: 70 })}" fill="var(--ink)" opacity=".3"/>
<rect x="0" y="178" width="1200" height="48" fill="url(#mist)" opacity=".8"/>
<path d="${ridge(41, { base: 246, amp: 58, step: 55 })}" fill="var(--ink)" opacity=".62"/>
</svg>`;
  return `<header class="banner">${scape}
<a class="gh" href="https://github.com/jianmliu/agent-pal" target="_blank" rel="noopener">GitHub ↗</a>
<div class="banner-text">
  <div class="eyebrow"><span class="brush" lang="zh-CN">仙剑奇侠传</span><span class="seal" aria-hidden="true"><i>论</i><i>剑</i></span></div>
  <h1>agent-pal-bench：用《仙剑奇侠传》考 AI 智能体的长程决策</h1>
  <p class="meta">${meta}</p>
</div>
</header>`;
}

/** 渲染整页。rows = collectRuns 的输出。 */
export function renderBoard(rows, { generatedAt = new Date().toISOString(), quizzes = [] } = {}) {
  // 提示档位 full(开关效果 / 道具用法直接告诉 AI)的成绩单独成档,不和 standard 混排
  const tierOf = (r) => (r.hints === 'full' ? `${r.tier} · full hints` : r.tier) + ((r.scoring ?? 'cost') === 'cost' ? '' : r.scoring === 'battleRounds' ? ' · 按战斗回合排' : ' · 混合题集（只按成功率排序）');
  const tiers = [...new Set(rows.map(tierOf))].sort();
  const sections = tiers.map((tier) => {
    const inTier = rows.filter((r) => tierOf(r) === tier);
    const main = rank(inTier.filter((r) => !r.external));
    const ext = rank(inTier.filter((r) => r.external));
    const pts = main.filter((r) => r.score > 0 && r.costMeanOnSuccess != null).map((r) => ({ label: r.model, cost: r.costMeanOnSuccess, score: r.score }));
    const anchor = `ext-${esc(tier).replace(/[^\w-]+/g, '-')}`;
    const pointer = ext.length && main.length
      ? `<p class="note">通过命令行客户端接入的模型(${ext.slice(0, 4).map((r) => `<code>${esc(r.model.replace(/^[^:]+:/, ''))}</code>`).join('、')}${ext.length > 4 ? ' 等' : ''})不在这张主表里,在下方 <a href="#${anchor}">外部 agent 表</a>。</p>` : '';
    return `<section><h2>档位 ${esc(tier)}</h2>${pointer}` +
      (main.length ? boardTable(main, { quizzes }) : ext.length ? '' : '<p class="muted">这一档还没有内置循环的成绩。</p>') +
      (main.length ? `<h3>success × cost(虚线 = 帕累托前沿:没有别的成绩又便宜又不差)</h3>${scatter(pts)}` : '') +
      (ext.length ? `<h3 id="${anchor}">外部 agent(通过命令行客户端接入;token / 成本由客户端自报)</h3>${boardTable(ext, { external: true, quizzes })}` : '') +
      `</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-pal-bench · 仙剑智能体基准</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&amp;text=%E4%BB%99%E5%89%91%E5%A5%87%E4%BE%A0%E4%BC%A0%E8%AE%BA&amp;display=swap">
<style>${CSS}</style>
<script>
// 标签页可以用地址直达(…/index.html#quiz),切换时地址跟着变,刷新 / 分享不丢当前页
addEventListener('DOMContentLoaded', () => {
  const show = (r) => document.querySelector('label[for="' + r.id + '"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });   // 窄屏:标签条横滑,把当前这一页的标签滑进视野
  const pick = () => { const el = document.getElementById('tab-' + ({ tasks: 'tiers' }[location.hash.slice(1)] || location.hash.slice(1))); if (el && el.classList.contains('tab-ctrl')) { el.checked = true; show(el); } };
  pick(); addEventListener('hashchange', pick);
  // 复制引用:剪贴板不让写时,退回选中文字让人自己复制
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const pre = document.getElementById(b.dataset.copy); if (!pre) return;
    try { await navigator.clipboard.writeText(pre.textContent); b.textContent = '已复制'; }
    catch { const sel = getSelection(), rg = document.createRange(); rg.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(rg); b.textContent = '已选中,按 ⌘C / Ctrl+C'; }
    setTimeout(() => { b.textContent = '复制'; }, 2000);
  });
  for (const r of document.querySelectorAll('.tab-ctrl')) r.addEventListener('change', () => { history.replaceState(null, '', '#' + r.id.slice(4)); show(r); });
});
</script></head><body><main>
${banner(`《仙剑奇侠传》(1995 DOS) 智能体长程决策基准 · 生成于 ${esc(stamp(generatedAt))} · 共 ${rows.length} 条运行记录${quizzes.length ? `、${quizzes.length} 份闭卷测验` : ''}`)}

<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-stats" checked>
<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-quiz">
<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-tiers">
<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-ironman">

<div class="tab-bar" role="tablist">
  <label class="tab-lbl" for="tab-stats">🏠 基准介绍与排行</label>
  <label class="tab-lbl" for="tab-quiz">壹 闭卷笔试</label>
  <label class="tab-lbl" for="tab-tiers">贰 分章节关卡</label>
  <label class="tab-lbl" for="tab-ironman">肆 编程通关</label>
</div>

<div class="panes">
  <div class="tab-pane" id="pane-stats">${landingSection(rows, quizzes)}</div>
  <div class="tab-pane" id="pane-tiers">
<h2>贰 · 分章节关卡详情</h2>
    <p class="muted">榜单只收通关的那一局:没打通的局不计,一局都没打通的运行不出现。score = 通关题数 / 这一档里有人通关过的题数(主排序),同分按本题集口径比较成功局平均 cost 或战斗回合；不同评分口径分开排。按档位分开排,外部 agent 单列。「核验」= bench verify 按日志重放的结果:只有全部局都重放一致才算已核验。共用一个 Ollama 订阅、额度不够没跑全的模型不上榜(运行记录仍在仓库里)。题集不同的运行 score 不可直接比。</p>
    ${rows.length ? sections : '<p>没有找到运行结果(bench run 的输出目录)。</p>'}
    ${perTaskDeepDiveSection()}
    <section><h2>成绩怎么核验</h2>
<p class="muted">另外两种视图,给想核对数据的人:<a href="verified.html">严格已核验榜</a>(只算 bench verify 重放一致的运行)· <a href="runs.html">原始运行批次</a>(不按模型归并,每次运行单独一行)。</p>
<div class="grid2">
  <div class="card">
    <h3>🛡️ 零成本防作弊核验机制（<code>bench verify</code> &amp; <code>check-pr</code>）</h3>
    <p>为什么开放外部 PR 提交不需要维护者花钱重调大模型 API？因为游戏引擎完全确定性（同种子 + 同工具序列 = 状态 100% 唯一）：</p>
    <p><strong>1. 纯 CPU 引擎重放：</strong>子进程按 <code>.jsonl</code> 日志重打每一道工具调用，逐帧比对场景、坐标、背包、战斗回合与里程碑，伪造坐标或跳关瞬间报 <code>mismatch</code>。</p>
    <p><strong>2. 账本与物理下界锁定：</strong>交叉核对 <code>.json</code> 与 <code>.jsonl</code> 的 Token 汇总、逐轮 <code>turn</code> 累加下界与系统提示词物理下界（<code>≥100 tokens/turn</code>）。</p>
    <p><strong>3. 官方价格表独立重算：</strong>服务端按 <code>bench/prices.json</code> 官方单价重算美元成本，拒绝篡改低价刷帕累托前沿。</p>
  </div>
</div></section>
  </div>
  <div class="tab-pane" id="pane-ironman">${ironmanAndPrSection()}</div>
  <div class="tab-pane" id="pane-quiz"><h2>壹 · 闭卷笔试详情</h2>${quizSection(quizzes) || '<p class="muted">暂无闭卷测验记录。</p>'}</div>
</div>
</main></body></html>
`;
}

/**
 * 额度受限、没跑全的模型不上榜:这一批共用一个个人 Ollama Cloud 订阅,多数题没跑全,
 * 排进去会把「没跑」读成「打不过」(用户 2026-10-23 定)。运行记录仍在 bench/out/,只是不进任何视图。
 */
export const QUOTA_LIMITED = (model) => /^ollama:/.test(String(model || ''));

/**
 * 只收通关的那一局(用户 2026-10-23 定):没打通的局不进榜,一局都没打通的运行整行不出现。
 * 各题只剩成功局,所以「success 率」不再有意义:score 改成「通关题数 / 同一档(同提示档位、同评分口径)里有人通关过的题数」,
 * cost / 回合照旧只看成功局。PR 门禁也只收成功局(pr-check.mjs)。
 */
export function clearedOnly(rows) {
  const out = [];
  for (const r of rows) {
    const tasks = (r.tasks || []).map((t) => {
      const wins = (t.episodes || []).filter((e) => e.success);
      if (!wins.length) return null;
      return {
        ...t, n: wins.length, successRate: 1, progressMean: 1, progressSd: 0,
        invalidRate: sumOrNull(wins.map((e) => e.invalidCalls)) / Math.max(1, sumOrNull(wins.map((e) => e.toolCalls))),
        tokensMean: mean(wins.map((e) => (e.tokensIn || 0) + (e.tokensOut || 0))),
        costTotal: sumOrNull(wins.map((e) => e.cost)),
        costMeanOnSuccess: sumOrNull(wins.map((e) => e.cost)) == null ? null : mean(wins.map((e) => e.cost)),
        endReasons: { success: wins.length }, episodes: wins
      };
    }).filter(Boolean);
    if (!tasks.length) continue;
    const eps = tasks.flatMap((t) => t.episodes);
    out.push({
      ...r, tasks, cleared: tasks.length, complete: true, progress: null, episodes: eps.length,
      costTotal: sumOrNull(eps.map((e) => e.cost)),
      costMeanOnSuccess: sumOrNull(eps.map((e) => e.cost)) == null ? null : mean(eps.map((e) => e.cost)),
      tokensTotal: eps.reduce((a, e) => a + (e.tokensIn || 0) + (e.tokensOut || 0), 0)
    });
  }
  const key = (r) => JSON.stringify([r.tier, r.hints ?? 'standard', r.scoring ?? 'cost']);
  const universe = new Map();
  for (const r of out) { const u = universe.get(key(r)) || new Set(); for (const t of r.tasks) u.add(`${t.id}@${t.version}`); universe.set(key(r), u); }
  for (const r of out) { r.taskUniverse = universe.get(key(r)).size; r.score = r.cleared / r.taskUniverse; }
  return out;
}

/** bench board:返回写出的文件路径。mergeModels = 按模型跨运行归并;verifiedOnly = 只纳入已核验运行。 */
export function board(dirs, { out = path.join(OUT_DIR, 'board.html'), mergeModels = false, verifiedOnly = false } = {}) {
  let rows = collectRuns(dirs.length ? dirs : listRunDirs()).filter((r) => !QUOTA_LIMITED(r.model));
  if (mergeModels) rows = mergeRunsByModel(rows, { verifiedOnly });
  else if (verifiedOnly) rows = rows.filter((r) => r.verify?.state === 'verified');
  rows = clearedOnly(rows);
  // 闭卷测验只给榜上有通关局的模型列(一局都没打通的模型不上榜,测验也不单独出现)
  const quizzes = collectQuizzes(dirs.length ? dirs : listQuizDirs()).filter((q) => !QUOTA_LIMITED(q.model) && rows.some((r) => r.model === q.model));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, renderBoard(rows, { quizzes }));
  return { out, runs: rows.length, quizzes: quizzes.length };
}
