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
      tasks.push({
        id: entry.id, version: entry.version, seedsPlanned: entry.seedsPlanned, n: episodes.length,
        successRate: episodes.length ? wins.length / episodes.length : null,
        progressMean: mean(episodes.map((e) => e.progress)), progressSd: sd(episodes.map((e) => e.progress)),
        battleRoundsMeanOnSuccess: roundsMean,
        toolCallsMedianOnSuccess: median(wins.map((e) => e.successAt)),
        invalidRate: episodes.length ? sumOrNull(episodes.map((e) => e.invalidCalls)) / Math.max(1, sumOrNull(episodes.map((e) => e.toolCalls))) : null,
        tokensMean: mean(episodes.map((e) => e.tokensIn + e.tokensOut)),
        costTotal: sumOrNull(episodes.map((e) => e.cost)),
        costMeanOnSuccess: wins.length ? (sumOrNull(wins.map((e) => e.cost)) == null ? null : mean(wins.map((e) => e.cost))) : null,
        efficiencyMean: mean(episodes.filter((e) => e.efficiency != null).map((e) => e.efficiency)),
        endReasons, episodes
      });
    }
    const scored = tasks.filter((t) => t.n);
    const allWins = allEps.filter((e) => e.success);
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
      tokensTotal: allEps.reduce((a, e) => a + (e.tokensIn || 0) + (e.tokensOut || 0), 0),
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
  const head = `<tr><th>#</th><th>${external ? '客户端 / 模型' : '模型'}</th><th>score</th><th>progress</th><th>闭卷测验</th><th>成功局平均回合</th><th>成功局平均 cost</th><th>总 cost</th><th>tokens</th><th>题 / 局</th><th>核验</th><th>代码</th><th>运行</th></tr>`;
  const body = rows.map((r, i) => `<tr${r.complete ? '' : ' class="incomplete"'}>` +
    `<td>${i + 1}</td><td class="model">${esc(r.model)}</td><td class="num strong">${pct(r.score)}</td><td class="num">${r.progress == null ? '–' : r.progress.toFixed(2)}</td>` +
    `<td class="num">${quizOf(r.model) ? pct(quizOf(r.model).score) : '<span class="muted">–</span>'}</td>` +
    `<td class="num">${r.battleRoundsMeanOnSuccess == null ? '–' : r.battleRoundsMeanOnSuccess.toFixed(2)}</td><td class="num">${r.score ? usd(r.costMeanOnSuccess) : '–'}</td><td class="num">${usd(r.costTotal)}</td><td class="num">${r.tokensTotal.toLocaleString('en-US')}</td>` +
    `<td class="num">${r.tasks.filter((t) => t.n).length} / ${r.episodes}${r.complete ? '' : ' <span class="warn">未跑完</span>'}</td>` +
    `<td>${verifyCell(r.verify)}</td><td><code>${esc(r.code || '?')}</code> <span class="muted">提示 v${esc(r.promptVersion ?? '?')}</span>${r.books ? `<br><code title="${esc([...r.books.guide, `atlas ${r.books.atlas}`].join('\n'))}">资料 ${esc(r.books.id)}</code>` : ''}</td><td><code>${esc(r.runId)}</code></td></tr>`).join('');
  return `<div class="scroll"><table>${head}${body}</table></div>`;
}

function taskMatrix(rows) {
  // 行按「题 + 版本」分:改版前后的题判据 / 预算可能不同,成功率不可直接比
  const key = (t) => `${t.id}@${t.version}`;
  const keys = [...new Map(rows.flatMap((r) => r.tasks.map((t) => [key(t), t]))).values()]
    .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  // 列头带运行 id:同一模型跑了几次时分得清哪列是哪次
  const head = `<tr><th>题</th>${rows.map((r) => `<th class="model">${esc(r.model)}<br><code>${esc(r.runId)}</code></th>`).join('')}</tr>`;
  const body = keys.map((k) => `<tr><td><code>${esc(k.id)}</code> <span class="muted">v${esc(k.version)}</span></td>${rows.map((r) => {
    const t = r.tasks.find((x) => key(x) === key(k));
    if (!t || !t.n) return '<td class="num muted">–</td>';
    const shade = Math.round((t.successRate ?? 0) * 100);
    return `<td class="num cell" style="--s:${shade}%">${pct(t.successRate)} <span class="muted">(${t.n})</span></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="scroll"><table class="matrix">${head}${body}</table></div>`;
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
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6a66;--line:#e3e2de;--card:#fff;--accent:#2f6fb3;--good:#2e7d4f;--bad:#b3412f;--warn:#9a6a00;--cell:47,111,179}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--fg:#ecebe8;--muted:#9c9a94;--line:#33322f;--card:#1f1f1d;--accent:#7fb0e6;--good:#6cc08f;--bad:#e58a77;--warn:#e0b24f;--cell:127,176,230;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#161615;--fg:#ecebe8;--muted:#9c9a94;--line:#33322f;--card:#1f1f1d;--accent:#7fb0e6;--good:#6cc08f;--bad:#e58a77;--warn:#e0b24f;--cell:127,176,230;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}h3{font-size:15px;margin:20px 0 8px;color:var(--muted)}
.muted{color:var(--muted)}.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-weight:600;color:var(--muted)}tr:last-child td{border-bottom:0}.num{text-align:right;font-variant-numeric:tabular-nums}.strong{font-weight:700}
.model{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}code{font-size:12px;color:var(--muted)}
tr.incomplete td{opacity:.75}.warn{color:var(--warn);font-size:12px}
.v{font-size:12px;padding:1px 6px;border-radius:4px;border:1px solid currentColor}.v-verified{color:var(--good)}.v-mismatch{color:var(--bad)}.v-stale{color:var(--warn)}.v-none{color:var(--muted)}
.cell{background:rgba(var(--cell),calc(var(--s) * .35 / 100%))}
svg{width:100%;height:auto;display:block;background:var(--card);border:1px solid var(--line);border-radius:8px}
svg .grid{stroke:var(--line)}svg .tick,svg .axis{fill:var(--muted);font-size:11px}svg .axis{font-size:12px}
svg .pt circle{fill:var(--muted);opacity:.8}svg .pt.on circle{fill:var(--accent);opacity:1}svg .pt text{fill:var(--fg);font-size:11px}
svg .front{fill:none;stroke:var(--accent);stroke-width:1.5;stroke-dasharray:4 3}
`;

/** 渲染整页。rows = collectRuns 的输出。 */
export function renderBoard(rows, { generatedAt = new Date().toISOString(), quizzes = [] } = {}) {
  // 提示档位 full(开关效果 / 道具用法直接告诉 AI)的成绩单独成档,不和 standard 混排
  const tierOf = (r) => (r.hints === 'full' ? `${r.tier} · full hints` : r.tier) + ((r.scoring ?? 'cost') === 'cost' ? '' : r.scoring === 'battleRounds' ? ' · 成功率→战斗回合' : ' · 混合题集（只按成功率排序）');
  const tiers = [...new Set(rows.map(tierOf))].sort();
  const sections = tiers.map((tier) => {
    const inTier = rows.filter((r) => tierOf(r) === tier);
    const main = rank(inTier.filter((r) => !r.external));
    const ext = rank(inTier.filter((r) => r.external));
    const pts = main.filter((r) => r.score > 0 && r.costMeanOnSuccess != null).map((r) => ({ label: r.model, cost: r.costMeanOnSuccess, score: r.score }));
    return `<section><h2>档位 ${esc(tier)}</h2>` +
      (main.length ? boardTable(main, { quizzes }) : '<p class="muted">这一档还没有内置循环的成绩。</p>') +
      (main.length ? `<h3>success × cost(虚线 = 帕累托前沿:没有别的成绩又便宜又不差)</h3>${scatter(pts)}` : '') +
      (ext.length ? `<h3>外部 agent(token / 成本由客户端自报、提示不统一 —— 单列,不进主榜)</h3>${boardTable(ext, { external: true, quizzes })}` : '') +
      `<h3>每题 success 率(括号内为局数)</h3>${taskMatrix([...main, ...ext])}</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-pal-bench 排行</title><style>${CSS}</style></head><body><main>
<h1>agent-pal-bench 排行</h1>
<p class="muted">score = 各题 success 率均值(主排序),同分按本题集口径比较成功局平均 cost 或战斗回合；不同评分口径分开排。按档位分开排,外部 agent 单列。
「核验」= bench verify 按日志重放的结果:只有全部局都重放一致才算已核验。题集不同的运行 score 不可直接比,见每题矩阵。
生成于 ${esc(generatedAt)},共 ${rows.length} 次运行${quizzes.length ? `、${quizzes.length} 份闭卷测验` : ''}。</p>
${rows.length ? sections : '<p>没有找到运行结果(bench run 的输出目录)。</p>'}
${quizSection(quizzes)}
</main></body></html>
`;
}

/** bench board:返回写出的文件路径。mergeModels = 按模型跨运行归并;verifiedOnly = 只纳入已核验运行。 */
export function board(dirs, { out = path.join(OUT_DIR, 'board.html'), mergeModels = false, verifiedOnly = false } = {}) {
  let rows = collectRuns(dirs.length ? dirs : listRunDirs());
  if (mergeModels) rows = mergeRunsByModel(rows, { verifiedOnly });
  else if (verifiedOnly) rows = rows.filter((r) => r.verify?.state === 'verified');
  const quizzes = collectQuizzes(dirs.length ? dirs : listQuizDirs());
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, renderBoard(rows, { quizzes }));
  return { out, runs: rows.length, quizzes: quizzes.length };
}
