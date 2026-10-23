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
/** token 数写成 2.78M / 640K(表格里一眼能比),完整数字放悬停 */
const tok = (n) => { n = Number(n) || 0; const s = n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n); return `<span title="${n.toLocaleString('en-US')}">${s}</span>`; };
/** 生成时刻:2026-10-23 16:33 UTC(ISO 串原样太长;不是 ISO 的原样输出) */
const stamp = (t) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(t)); return m ? `${m[1]} ${m[2]} UTC` : String(t); };
/** score 前面一小条进度条:不用读数字就看得出高低 */
const scoreCell = (x) => `<td class="num strong"><span class="sbar" style="--p:${Math.round((x ?? 0) * 100)}%"></span>${pct(x)}</td>`;
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
  const head = `<tr><th>#</th><th class="model">${external ? '客户端 / 模型' : '模型'}</th><th>score</th><th>progress</th><th>闭卷测验</th><th>成功局平均回合</th><th>成功局平均 cost</th><th>总 cost</th><th>tokens</th><th>题 / 局</th><th>核验</th><th>代码</th><th>运行</th></tr>`;
  const body = rows.map((r, i) => `<tr${r.complete ? '' : ' class="incomplete"'}>` +
    `<td class="num muted">${i + 1}</td><td class="model">${esc(r.model)}</td>${scoreCell(r.score)}<td class="num">${r.progress == null ? '–' : r.progress.toFixed(2)}</td>` +
    `<td class="num">${quizOf(r.model) ? pct(quizOf(r.model).score) : '<span class="muted">–</span>'}</td>` +
    `<td class="num">${r.battleRoundsMeanOnSuccess == null ? '–' : r.battleRoundsMeanOnSuccess.toFixed(2)}</td><td class="num">${r.score ? usd(r.costMeanOnSuccess) : '–'}</td><td class="num">${usd(r.costTotal)}</td><td class="num">${tok(r.tokensTotal)}</td>` +
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
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6a66;--line:#e3e2de;--card:#fff;--accent:#2f6fb3;--good:#2e7d4f;--bad:#b3412f;--warn:#9a6a00;--cell:47,111,179;--soft:#f3f2ee}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--fg:#ecebe8;--muted:#9c9a94;--line:#33322f;--card:#1f1f1d;--accent:#7fb0e6;--good:#6cc08f;--bad:#e58a77;--warn:#e0b24f;--cell:127,176,230;--soft:#262623;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#161615;--fg:#ecebe8;--muted:#9c9a94;--line:#33322f;--card:#1f1f1d;--accent:#7fb0e6;--good:#6cc08f;--bad:#e58a77;--warn:#e0b24f;--cell:127,176,230;--soft:#262623;color-scheme:dark}
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
#tab-tasks:checked ~ .tab-bar label[for="tab-tasks"],
#tab-ironman:checked ~ .tab-bar label[for="tab-ironman"],
#tab-quiz:checked ~ .tab-bar label[for="tab-quiz"]{color:var(--accent);background:var(--card);border-color:var(--line);border-bottom:2px solid var(--card)}
#tab-stats:checked ~ .panes #pane-stats,
#tab-tiers:checked ~ .panes #pane-tiers,
#tab-tasks:checked ~ .panes #pane-tasks,
#tab-ironman:checked ~ .panes #pane-ironman,
#tab-quiz:checked ~ .panes #pane-quiz{display:block}
@media print{.tab-pane{display:block!important}}
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
#tab-stats:focus-visible ~ .tab-bar label[for="tab-stats"],#tab-tiers:focus-visible ~ .tab-bar label[for="tab-tiers"],#tab-tasks:focus-visible ~ .tab-bar label[for="tab-tasks"],#tab-ironman:focus-visible ~ .tab-bar label[for="tab-ironman"],#tab-quiz:focus-visible ~ .tab-bar label[for="tab-quiz"]{outline:2px solid var(--accent);outline-offset:-2px}
@media (max-width:640px){h1{font-size:20px}main{padding:16px 16px 40px}.navlinks a{padding:3px 8px}.kpi .k-val{font-size:22px}.podium,.grid2{grid-template-columns:1fr}}
`;

function statsOverviewSection() {
  return `<section>
<h2>核心统计总览：华山论剑首期守擂榜（三剑客率先满贯，诚邀大家提交国产模型 PR 攻擂！）</h2>
<p class="muted">评测基准涵盖 <strong>闭卷先验笔试（22 问）</strong>、<strong>四大专项实操擂台（祈雨祭坛 / 白河采药 / 扬州紫金葫芦 / 南诏王宫拜月决战 &amp; 禁招消融赛）</strong> 与 <strong>从零手写代码全游戏通关（<code>--pure</code> 模式 300 场景 11 章马拉松）</strong>。在首期登台的 13 款模型中，各自拥有独立个人订阅额度的<strong>“外来三剑客”（<code>Gemini 4 Argon</code>、<code>Claude Opus 5.5</code>、<code>GPT-6.1-Sol</code>）率先完成四大专项实操 100% 大满贯并打穿全游戏</strong>。</p>
<div class="card" style="margin:0 0 16px;border-left:4px solid var(--warn);background:color-mix(in oklab, var(--warn) 7%, var(--card))">
  <h3 style="margin:0 0 6px;color:var(--warn)">⚡ 江湖擂台声明：个人 Ollama 订阅额度有限，国产模型大量高阶席位虚位以待！</h3>
  <p style="margin:0">本次评测完全由个人自费订阅完成：“外来三剑客”分别跑在各自独立的个人订阅账号上，因此有充足额度跑满全科；而 <strong>8 款国产模型（<code>DeepSeek</code>、<code>GLM</code>、<code>Kimi</code>、<code>MiniMax</code>）全部共用同一个个人 Ollama Cloud 订阅账号分摊额度</strong>（例如 <code>DeepSeek V4.1 Flash</code> 在 <code>--pure</code> 模式一路连斩赤鬼王、石长老杀入第 5 章扬州城后直接把整月 Ollama 额度耗尽被迫中断；扬州 15 场景长链与 240/560 步扩容赛也因额度见底未能对其他国产模型全面展开；<code>Qwen</code>、<code>Doubao Seed</code>、<code>Step</code> 等国产主力更是尚未测试）。<strong>因此本榜单定位是一座开放攻擂的“江湖擂台”</strong>——非常欢迎有额度的朋友跑分并通过 <strong>GitHub PR（$0 API 成本自动重放核验）</strong>提交国产模型记录，争夺首座国产大满贯奖杯！</p>
</div>

<div class="kpis">
  <div class="kpi"><div class="k-label">全游戏通关率 (--pure 11章)</div><div class="k-val good">3 / 13 (23%)</div><div class="k-sub">仅 Argon、Claude Opus 5.5、GPT-6.1-Sol 抵达全剧终</div></div>
  <div class="kpi"><div class="k-label">四大专项实操大满贯</div><div class="k-val accent">3 / 13 (23%)</div><div class="k-sub">祈雨坛 + 白河采药 + 扬州断案 + 拜月决战全胜</div></div>
  <div class="kpi"><div class="k-label">零先验逆袭纪录</div><div class="k-val good">8% → 100%</div><div class="k-sub">Claude Opus 5.5 笔试倒数第一(1/13)，实操夺得双冠</div></div>
  <div class="kpi"><div class="k-label">防作弊重放核验成本</div><div class="k-val warn">$0 CPU</div><div class="k-sub">确定性引擎重放 + Token 物理下界 + 官方价格表审计</div></div>
</div>

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

<h3>📊 15 大参评模型跨维度总成绩单（闭卷笔试 × 四大专项实操 × 全游戏通关）</h3>
<div class="scroll">
<table class="wrap">
  <tr>
    <th>总座次</th><th class="model">模型</th><th>厂商 / 机构</th><th>闭卷笔试 (22问)</th>
    <th>实操① 祈雨祭坛<br><span class="muted">par=7 / 预算80</span></th>
    <th>实操② 白河采药<br><span class="muted">par=40 / 预算120–240</span></th>
    <th>实操③ 扬州紫金葫芦<br><span class="muted">par=74 / 15场景长链</span></th>
    <th>实操④ 拜月教主决战<br><span class="muted">常规赛 / 禁招消融赛</span></th>
    <th>终极铁人赛 (--pure)<br><span class="muted">300场景手写代码全通</span></th>
    <th>综合定性</th>
  </tr>
  <tr>
    <td class="num strong">🥇 1</td><td class="model">agy-cli:gemini-4-argon</td><td>Google</td><td class="num strong">64% (14/22)</td>
    <td><span class="badge good">✓ 13 步</span></td><td><span class="badge good">✓ 90 步 (最快)</span></td><td><span class="badge good">✓ 161 步 (净139)</span></td><td><span class="badge good">✓ 7 回合</span> / <span class="badge good">✓ 39 回合</span></td>
    <td><span class="badge good">🏆 全剧终 (731行库)</span></td><td>四大实操 + 全游戏满贯</td>
  </tr>
  <tr>
    <td class="num strong">🥈 2</td><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">14% (3/22)</td>
    <td><span class="badge good">✓ 10 步 (最快)</span></td><td><span class="badge good">✓ 143 步 (零先验)</span></td><td><span class="badge good">✓ 280 步 (跨屋顶)</span></td><td><span class="badge good">✓ 17 回合</span> / <span class="badge good">🥇 36 回合</span></td>
    <td><span class="badge good">🏆 全剧终 (1427行库)</span></td><td>零先验逆袭 + 禁招冠军</td>
  </tr>
  <tr>
    <td class="num strong">🥉 3</td><td class="model">codex-cli:gpt-6.1-sol</td><td>OpenAI</td><td class="num strong">59% (13/22)</td>
    <td><span class="badge good">✓ 22 步</span></td><td><span class="badge good">✓ 105 步</span></td><td><span class="badge good">✓ 218 步</span></td><td><span class="badge good">✓ 14 回合 (1命)</span> / <span class="badge good">✓ 37 回合</span></td>
    <td><span class="badge good">🏆 全剧终 (845步单轮)</span></td><td>初见1命斩拜月 + 单轮全通</td>
  </tr>
  <tr>
    <td class="num strong">4</td><td class="model">codex-cli:gpt-6-astra</td><td>OpenAI</td><td class="muted">–</td>
    <td><span class="badge good">✓ 13 步</span></td><td><span class="badge good">✓ 107 步</span></td><td><span class="badge good">✓ 146 步 (最快)</span></td><td><span class="badge good">✓ 11 回合 (1命/28步)</span> / <span class="badge good">✓ 54 回合</span></td>
    <td class="muted">⏳ 虚位待战</td><td>四大专项实操 (含禁招) 全胜满贯</td>
  </tr>
  <tr>
    <td class="num">5</td><td class="model">claude-cli:claude-fable-5-1</td><td>Anthropic</td><td class="muted">–</td>
    <td><span class="badge good">✓ 10 步 (并列最快)</span></td><td><span class="badge good">✓ 203 步 (240扩容)</span></td><td class="muted">⏳ 待测</td><td class="muted">⏳ 待测</td>
    <td class="muted">⏳ 虚位待战</td><td>祈雨坛 10 步 + 白河村三味药通关</td>
  </tr>
  <tr>
    <td class="num">6</td><td class="model">ollama:deepseek-v4.1-flash:cloud</td><td>DeepSeek</td><td class="num">31% (4/13)</td>
    <td><span class="badge good">✓ 28 步</span></td><td><span class="badge warn">✗ 进度 0.75 (120步未扩容)</span></td><td><span class="badge warn">✗ 困于客栈楼梯</span></td><td><span class="badge good">🥈 10 回合 (1HP绝杀)</span> / <span class="badge bad">✗ 0%</span></td>
    <td><span class="badge warn">⚔️ 闯至第5章扬州 (额度耗尽中断)</span></td><td>斩赤鬼王 &amp; 1HP绝杀拜月</td>
  </tr>
  <tr>
    <td class="num">7</td><td class="model">ollama:glm-5.3:cloud</td><td>Zhipu AI (智谱)</td><td class="num">38% (5/13)</td>
    <td><span class="badge good">✓ 16–19 步 (4K熔断)</span></td><td><span class="badge bad">✗ 进度 0.50 (未扩容)</span></td><td class="muted">⏳ 待攻擂 (额度受限)</td><td><span class="badge bad">✗ 0% (压至22,502 HP)</span></td><td class="muted">⏳ 虚位待战</td><td>加思考熔断器后祈雨坛 3/3 满贯</td>
  </tr>
  <tr>
    <td class="num">8</td><td class="model">ollama:kimi-k3:cloud</td><td>Moonshot AI (月之暗面)</td><td class="num">38% (5/13)</td>
    <td><span class="badge good">✓ 31 步</span></td><td><span class="badge bad">✗ 进度 0.50 (未扩容)</span></td><td class="muted">⏳ 待攻擂 (额度受限)</td><td><span class="badge warn">✗ 0% (第7命打空拜月本体)</span></td><td class="muted">⏳ 虚位待战</td><td>第 7 命击穿 32,760 HP 本体死于护卫</td>
  </tr>
  <tr>
    <td class="num">9</td><td class="model">ollama:minimax-m3:cloud</td><td>MiniMax</td><td class="num">31% (4/13)</td>
    <td><span class="badge good">✓ 38–44 步</span></td><td><span class="badge bad">✗ 进度 0.50 (未扩容)</span></td><td class="muted">⏳ 待攻擂 (额度受限)</td><td><span class="badge bad">✗ 0%</span></td><td class="muted">⏳ 虚位待战</td><td>祈雨坛试错通关，长程待扩容补测</td>
  </tr>
  <tr>
    <td class="num">10</td><td class="model">ollama:glm-5.3-flash:cloud</td><td>Zhipu AI (智谱)</td><td class="num">31% (4/13)</td>
    <td><span class="badge good">✓ 34 步</span></td><td><span class="badge bad">✗ 进度 0.25</span></td><td class="muted">⏳ 待攻擂 (额度受限)</td><td><span class="badge bad">✗ 0%</span></td><td class="muted">⏳ 虚位待战</td><td>背熟拜月招式但缺乏回蓝生存链</td>
  </tr>
  <tr>
    <td class="num">11</td><td class="model">ollama:gemma4:31b-cloud</td><td>Google</td><td class="num">23% (3/13)</td>
    <td><span class="badge good">✓ 36 步</span></td><td><span class="badge bad">✗ 进度 0.25</span></td><td class="muted">⏳ 待攻擂</td><td><span class="badge bad">✗ 0%</span></td><td class="muted">⏳ 虚位待战</td><td>31B 开源权重通过单场景空间解谜</td>
  </tr>
  <tr>
    <td class="num">12</td><td class="model">ollama:deepseek-v4-pro:0813-cloud</td><td>DeepSeek</td><td class="num">23% (3/13)</td>
    <td><span class="badge bad">✗ 超时 (10.3万思考词)</span></td><td class="muted">⏳ 待攻擂 (额度受限)</td><td class="muted">⏳ 待攻擂 (额度受限)</td><td class="muted">⏳ 待攻擂 (额度受限)</td><td class="muted">⏳ 虚位待战</td><td>祈雨坛未加熔断陷入几何证明死循环</td>
  </tr>
  <tr>
    <td class="num">13</td><td class="model">ollama:minimax-m3.1-flash / m2.7</td><td>MiniMax</td><td class="num">15%–23%</td>
    <td><span class="badge bad">✗ 0%</span></td><td><span class="badge bad">✗ 进度 0.25</span></td><td class="muted">⏳ 待攻擂</td><td><span class="badge bad">✗ 0%</span></td><td class="muted">⏳ 虚位待战</td><td>状态追踪与工具参数易发散</td>
  </tr>
  <tr>
    <td class="num">14</td><td class="model">laya:laya-multilingual</td><td>ConvAI Innovations</td><td class="num">0% (无生成能力)</td>
    <td class="muted">–</td><td><span class="badge bad">✗ 0% (进度 0.00)</span></td><td class="muted">–</td><td class="muted">–</td><td class="muted">–</td><td>7ms 极速选工具，但无长程规划陷入死循环</td>
  </tr>
  <tr>
    <td class="num strong">🎯</td><td class="model">Qwen / Doubao / Step / DeepSeek 等原生 API</td><td><strong>Alibaba / ByteDance / StepFun 等</strong></td><td class="num"><span class="badge warn">欢迎 PR 提交</span></td>
    <td><span class="badge warn">欢迎 PR 挑战</span></td><td><span class="badge warn">欢迎 240步 挑战</span></td><td><span class="badge warn">欢迎 320步 挑战</span></td><td><span class="badge warn">欢迎挑战 36 回合</span></td>
    <td><span class="badge warn">🏆 悬赏首个国产全通!</span></td><td>提交 PR 自动运行 <code>bench verify</code> 合榜</td>
  </tr>
</table>
</div>

<div class="grid2">
  <div class="card">
    <h3>🔬 统计发现一：为什么其他 10 个模型未能通关？四大折戟漏斗</h3>
    <div class="bar-row"><span class="bar-name">1. 祈雨坛 45° 旋转解谜</span><div class="bar-track"><div class="bar-fill good" style="width:69%"></div></div><span class="bar-val">9 / 13 通过</span></div>
    <div class="bar-row"><span class="bar-name">2. 拜月教主常规决战</span><div class="bar-track"><div class="bar-fill warn" style="width:31%"></div></div><span class="bar-val">4 / 13 通过</span></div>
    <div class="bar-row"><span class="bar-name">3. 白河村跨场景三味药</span><div class="bar-track"><div class="bar-fill bad" style="width:23%"></div></div><span class="bar-val">3 / 13 通过</span></div>
    <div class="bar-row"><span class="bar-name">4. 扬州 15 场景侦探链</span><div class="bar-track"><div class="bar-fill bad" style="width:23%"></div></div><span class="bar-val">3 / 13 通过</span></div>
    <div class="bar-row"><span class="bar-name">5. 拜月禁招赛 &amp; 全通</span><div class="bar-track"><div class="bar-fill bad" style="width:23%"></div></div><span class="bar-val">3 / 13 通过</span></div>
    <p>单场景拼图（祈雨坛）有 69% 模型能过，但一旦进入<strong>跨 6–15 个场景的状态追踪与假设证伪</strong>（白河捕鹿、扬州追贼、禁招拜月），唯有三剑客存活。</p>
  </div>
  <div class="card">
    <h3>🧠 统计发现二：决定通关的四大底层 Agent 核心内功</h3>
    <p><strong>① 零成本认知探针（Epistemic Probe）：</strong>面对 45° 坐标歧义，<code>Claude Opus 5.5</code> 用 1 步 <code>use_item</code> 实测代替代数空想，10 步破局；而 <code>DeepSeek V4 Pro</code> 空想 103,616 tokens 零次出手。</p>
    <p><strong>② 止损弹性（Pivot Elasticity）：</strong>白河猎场放偏第一枚捕兽夹后，<code>Argon</code>（5步）与 <code>GPT-6.1</code>（7步）秒收夹重放；揚州井口打不开时，<code>Argon</code> 22 步转登城墙，而 <code>GPT-6.1</code> 被错误记忆锚定 82 步。</p>
    <p><strong>③ 控制变量消元法：</strong>面对回合制批量结算（<code>ΔHP = x1+x2+x3</code>），<code>Claude</code> 固定两人投 1000 伤毒药解出单招真实伤害；<code>DeepSeek</code> 误把 1、2 号位未结算当成“法术 0 伤害”自废武功。</p>
    <p><strong>④ 自演化代码库（Self-Coding Library）：</strong><code>--pure</code> 模式下三剑客将开门、寻路、反编译沉淀为持久化 JS 库，而 <code>DeepSeek</code> 每轮手写一次性脚本最终在第 63 轮困于扬州客栈楼梯。</p>
  </div>
</div>
</section>`;
}

function perTaskDeepDiveSection() {
  return `<section>
<h2>四大专项实操擂台：分题目精细化数据统计与行为诊断</h2>
<p class="muted">本页汇总四大核心实操考题中各模型的步数、回合数、Token 消耗与关键转折点遥测数据。</p>

<h3>擂台一：大理祈雨祭坛（<code>classic48-rain-orbs</code>，<code>par = 7</code>，预算 80 步）</h3>
<p class="muted">考察点：石碑正交方位（东北/东南/西南/西北）向 45° 斜向梅花桩坐标的映射，以及“先内省证明 vs 先发 1 步探针”。</p>
<div class="scroll">
<table class="wrap">
  <tr><th>排名</th><th class="model">模型</th><th>厂商</th><th>笔试该题分</th><th>实操通关</th><th>通关步数</th><th>思考输出 Tokens</th><th>策略画像与死因分析</th></tr>
  <tr><td class="num strong">🥇 1</td><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">0% (0/5)</td><td><span class="badge good">100%</span></td><td class="num strong">10 步</td><td class="num">2,158</td><td>1 步 <code>use_item</code> 探针试出旋转方向，下一轮 4 珠连放收官</td></tr>
  <tr><td class="num strong">🥇 1</td><td class="model">claude-cli:claude-fable-5-1</td><td>Anthropic</td><td class="num">–</td><td><span class="badge good">100%</span></td><td class="num strong">10 步</td><td class="num">1,259</td><td>1 步探针锁定方位，10 步并列全场最快</td></tr>
  <tr><td class="num strong">🥉 3</td><td class="model">agy-cli:gemini-4-argon</td><td>Google</td><td class="num">20% (1/5)</td><td><span class="badge good">100%</span></td><td class="num strong">13 步</td><td class="num">–</td><td>读碑后试放 1 次立即锁定 45° 顺时针映射</td></tr>
  <tr><td class="num strong">🥉 3</td><td class="model">codex-cli:gpt-6-astra</td><td>OpenAI</td><td class="num">–</td><td><span class="badge good">100%</span></td><td class="num strong">13 步</td><td class="num">726</td><td>1 步试放消解 45° 旋转歧义，13 步收官</td></tr>
  <tr><td class="num">5</td><td class="model">ollama:glm-5.3:cloud (4K熔断)</td><td>Zhipu AI</td><td class="num">20% (1/5)</td><td><span class="badge good">100% (3/3)</span></td><td class="num">16–19 步</td><td class="num">~18,000</td><td>单轮 4,096 思考熔断器截断过度怀疑后迅速通关</td></tr>
  <tr><td class="num">6</td><td class="model">codex-cli:gpt-6.1-sol</td><td>OpenAI</td><td class="num">20% (1/5)</td><td><span class="badge good">100%</span></td><td class="num">22 步</td><td class="num">4,295</td><td>稳健巡视五座石柱坐标后逐一配对归位</td></tr>
  <tr><td class="num">7</td><td class="model">ollama:deepseek-v4.1-flash:cloud</td><td>DeepSeek</td><td class="num">0% (0/5)</td><td><span class="badge good">100%</span></td><td class="num">28 步</td><td class="num">~24,000</td><td>以快打慢，边走边试错完成五珠归位</td></tr>
  <tr><td class="num">8</td><td class="model">ollama:kimi-k3 / minimax-m3 / gemma4</td><td>Moonshot / MiniMax / Google</td><td class="num">20% (1/5)</td><td><span class="badge good">100%</span></td><td class="num">31–44 步</td><td class="num">~35,000</td><td>经过多轮方位枚举后成功放齐五灵珠</td></tr>
  <tr><td class="num">❌</td><td class="model">ollama:glm-5.3:cloud (16K无熔断)</td><td>Zhipu AI</td><td class="num">20% (1/5)</td><td><span class="badge bad">0% (超时)</span></td><td class="num">未完成</td><td class="num">290,000+</td><td>前 500 词已算对，因一句 "Let's not assume" 陷入无限自我怀疑</td></tr>
  <tr><td class="num">❌</td><td class="model">ollama:deepseek-v4-pro:0813-cloud</td><td>DeepSeek</td><td class="num">0% (0/5)</td><td><span class="badge bad">0% (超时)</span></td><td class="num">17 步 (0放珠)</td><td class="num">103,616</td><td>十万字坐标几何证明走火入魔，到死未调 1 次 <code>use_item</code></td></tr>
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
  <tr><td class="num">4</td><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">0% (0/5)</td><td><span class="badge warn">进度 0.50</span></td><td><span class="badge good">100% (143/176步)</span></td><td class="num">39–43 步 (搜遍全村6民居)</td><td class="num">23–48 步 (执着赶鹿后起夹重放)</td></tr>
  <tr><td class="num">5</td><td class="model">claude-cli:claude-fable-5-1</td><td>Anthropic</td><td class="num">–</td><td><span class="badge warn">未完</span></td><td><span class="badge good">100% (203步)</span></td><td class="num">全村探索清图</td><td class="num">203 步完成三味药收集交回医仙</td></tr>
  <tr><td class="num">6</td><td class="model">ollama:deepseek-v4.1-flash:cloud</td><td>DeepSeek</td><td class="num">40% (2/5)</td><td><span class="badge bad">进度 0.75</span></td><td><span class="badge bad">进度 0.75</span></td><td class="num">18 步</td><td class="num">找到猎场与捕兽夹但未捕获梅花鹿</td></tr>
  <tr><td class="num">7–14</td><td class="model">Kimi K3 / GLM-5.3 / MiniMax / Laya</td><td>Moonshot / Zhipu / MiniMax / ConvAI</td><td class="num">0%–40%</td><td><span class="badge bad">进度 0.00–0.50</span></td><td><span class="badge bad">进度 0.00–0.50</span></td><td class="num">20–90 步</td><td class="num">卡在渔夫借竿对话链、村内迷路或猎场</td></tr>
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
  <tr><td class="num">4</td><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">0% (0/5)</td><td class="num">280 步</td><td class="num strong">215 步</td><td class="num">56</td><td class="num">161 (首胜@94漏捡)</td><td class="num">169</td><td class="num">177</td><td><strong>跨 4 重屋顶奇袭</strong>（回客栈二楼翻窗 <code>85→98→87→98→85→98→86</code> 复用屋顶图）</td></tr>
</table>
</div>

<h3>擂台四：南诏王宫决战拜月教主（<code>baiyue-single-origin</code> 常规赛 vs 废除三板斧反事实禁招赛）</h3>
<p class="muted">考察点：面对 32,760 HP 终局 Boss 的同上下文团灭复盘学习（In-Context RL），以及禁用“酒神 + 乾坤一掷 + 隐蛊”后的纯机制推导。</p>
<div class="scroll">
<table class="wrap">
  <tr><th class="model">模型</th><th>厂商</th><th>笔试拜月考</th><th>上半场：常规决战 (胜局回合)</th><th>常规赛战术拆解</th><th>下半场：禁招消融赛 (胜局回合)</th><th>禁招赛机制发现与成败归因</th></tr>
  <tr><td class="model">agy-cli:gemini-4-argon</td><td>Google</td><td class="num">100% (3/3)</td><td class="num strong">🥇 7.00 回合 (第2命/42步)</td><td>第 2 命补双 <code>五氣朝元</code> + <code>乾坤一擲</code> 创 7 回合 0 死纪录</td><td class="num strong">🥉 39.00 回合 (第2命/114步)</td><td>第 2 命叠防 + 投掷神兵，全场唯一发明 <code>{"action":"repeat"}</code> 循环宏</td></tr>
  <tr><td class="model">ollama:deepseek-v4.1-flash:cloud</td><td>DeepSeek</td><td class="num">67% (2/3)</td><td class="num strong">🥈 10.00 回合 (第6命/172步)</td><td><strong>第 6 命仅剩 1 HP 阿奴砸出 <code>乾坤一擲</code>+<code>化屍水</code> 绝杀</strong></td><td class="num">❌ 0% (23命/700步，剩21,022 HP)</td><td>悟出开局三盾，但栽在<strong>回合批量结算归因幻觉</strong>（误判逍遥灵儿法术 0 伤害）</td></tr>
  <tr><td class="model">codex-cli:gpt-6-astra</td><td>OpenAI</td><td class="num">–</td><td class="num strong">🥉 11.00 回合 (第1命/28步)</td><td><strong>初见第 1 命一次过：</strong>仅 28 步 / 95.3s 极速斩拜月</td><td class="num strong">✓ 54.00 回合 (第2命/220步)</td><td>第 2 命 <code>真元護體</code> + <code>天罡戰氣</code> + 投掷与剑神稳定磨穿 32,760 HP</td></tr>
  <tr><td class="model">codex-cli:gpt-6.1-sol</td><td>OpenAI</td><td class="num">67% (2/3)</td><td class="num strong">✓ 14.00 回合 (第1命/33步)</td><td><strong>初见第 1 命一次过：</strong>3 颗隐蛊维持 9 回合隐身 + 4 发酒神</td><td class="num strong">🥈 37.00 回合 (第2命/176步)</td><td>第 2 命构建“轮流 <code>真元護體</code> + 每回合 <code>五氣朝元</code>”37 回合铁桶阵</td></tr>
  <tr><td class="model">claude-cli:claude-opus-5-5</td><td>Anthropic</td><td class="num">33% (1/3)</td><td class="num">17.00 回合 (第4命/157步)</td><td>全程未用 <code>乾坤一擲</code>，自研群攻清场流分文未花过关</td><td class="num strong">🥇 36.00 回合夺冠! (第11命/542步)</td><td><strong>控制变量线性消元法</strong>测准单招伤害，第 11 命心算 &lt;5% 血线用 <code>化屍水</code> 秒杀夺冠</td></tr>
  <tr><td class="model">ollama:kimi-k3:cloud</td><td>Moonshot AI</td><td class="num">67% (2/3)</td><td class="num">❌ 0% (10命/240步)</td><td>第 7 命已打空拜月本体 (0 HP) 死于小怪；随后近因过拟合漏喂雪莲子</td><td class="muted">–</td><td class="muted">–</td></tr>
</table>
</div>
</section>`;
}

function ironmanAndPrSection() {
  return `<section>
<h2>终极铁人三项：从零手写代码全游戏通关（<code>--pure</code> 模式）与 PR 打榜指南</h2>
<p class="muted">在 <code>--pure</code>（Tier P）模式下，系统剥夺 <code>walk_to</code>、<code>interact</code>、<code>map</code> 等一切高级工具，只提供底层方向键原语与 <code>run_code</code> JS 沙盒。模型必须自己手写寻路器、字节码反编译器与战斗状态机打穿全部 11 章 300 个场景。</p>

<div class="scroll">
<table class="wrap">
  <tr><th>维度</th><th><code>Gemini 4 Argon</code></th><th><code>GPT-6.1-Sol</code></th><th><code>Claude Opus 5.5</code></th><th><code>DeepSeek V4.1 Flash</code></th></tr>
  <tr><td><strong>最终结局</strong></td><td><span class="badge good">🏆 全剧终通关 (Slot 99)</span></td><td><span class="badge good">🏆 全剧终通关 (Slot 99)</span></td><td><span class="badge good">🏆 全剧终通关 (Slot 99)</span></td><td><span class="badge warn">⚔️ 闯至第5章扬州城 (Slot 28)</span></td></tr>
  <tr><td><strong>推进剧情跨度</strong></td><td>全 11 章 (余杭 → 拜月水魔兽)</td><td>全 11 章 (余杭 → 拜月水魔兽)</td><td>全 11 章 (余杭 → 拜月水魔兽)</td><td>前 5 章 (斩赤鬼王/石长老，困于扬州客栈)</td></tr>
  <tr><td><strong>会话轮数</strong></td><td class="num">5 段接力</td><td class="num strong">单会话 1 轮到底!</td><td class="num">2 轮接力</td><td class="num">109 轮 (每轮 ~220K 上下文)</td></tr>
  <tr><td><strong>总工具调用数</strong></td><td class="num">1,704 次 (主段 475 次)</td><td class="num strong">845 次 (全场最精简)</td><td class="num">1,453 次 (<code>run_code</code> 1,434 次)</td><td class="num">7,041 次 (后 46 轮客栈空转)</td></tr>
  <tr><td><strong>自编写持久化引擎库</strong></td><td><code>argon-pure-lib.js</code> (<strong>731 行</strong>)</td><td><code>gpt61-pure-lib.js</code> (<strong>135 行</strong>)</td><td><code>opus-pure-lib.js</code> (<strong>1,427 行 / 43 函数</strong>)</td><td><code>deepseek-pure-lib.js</code> (一次性内联脚本)</td></tr>
  <tr><td><strong>通关队伍终局等级</strong></td><td class="num">Lv36 / Lv33 / Lv31</td><td class="num">Lv35 / Lv32 / Lv30</td><td class="num strong">Lv45 / Lv43 / Lv42 (刷满傀儡虫)</td><td class="num">Lv13 / Lv12 / Lv12</td></tr>
</table>
</div>

<div class="grid2">
  <div class="card">
    <h3>🛡️ 零成本防作弊核验机制（<code>bench verify</code> &amp; <code>check-pr</code>）</h3>
    <p>为什么开放外部 PR 提交不需要维护者花钱重调大模型 API？因为游戏引擎完全确定性（同种子 + 同工具序列 = 状态 100% 唯一）：</p>
    <p><strong>1. 纯 CPU 引擎重放：</strong>子进程按 <code>.jsonl</code> 日志重打每一道工具调用，逐帧比对场景、坐标、背包、战斗回合与里程碑，伪造坐标或跳关瞬间报 <code>mismatch</code>。</p>
    <p><strong>2. 账本与物理下界锁定：</strong>交叉核对 <code>.json</code> 与 <code>.jsonl</code> 的 Token 汇总、逐轮 <code>turn</code> 累加下界与系统提示词物理下界（<code>≥100 tokens/turn</code>）。</p>
    <p><strong>3. 官方价格表独立重算：</strong>服务端按 <code>bench/prices.json</code> 官方单价重算美元成本，拒绝篡改低价刷帕累托前沿。</p>
  </div>
  <div class="card">
    <h3>🚀 如何通过 GitHub PR 提交你的模型成绩？</h3>
    <p><strong>Step 1：运行评测并生成核验签名</strong></p>
    <p><code>node bin/agent-pal.mjs bench run --model &lt;provider:model&gt; --tier B --out bench/out/&lt;your-run&gt;</code><br>
    <code>node bin/agent-pal.mjs bench verify bench/out/&lt;your-run&gt;</code></p>
    <p><strong>Step 2：本地运行 PR 门禁自检</strong></p>
    <p><code>node bench/bench.mjs check-pr</code>（确保仅新增 <code>bench/out/&lt;your-run&gt;/</code> 目录，不提交 <code>board.html</code>，零 Git 冲突）</p>
    <p><strong>Step 3：提交 PR 自动合榜</strong></p>
    <p>GitHub Actions 免费 CPU 容器自动执行防作弊重放并在 PR 输出成绩单；合入 <code>main</code> 后自动重生成本 GitHub Pages 排行榜。</p>
  </div>
</div>
</section>`;
}

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
    const anchor = `ext-${esc(tier).replace(/[^\w-]+/g, '-')}`;
    const pointer = ext.length && main.length
      ? `<p class="note">通过命令行客户端接入的模型(${ext.slice(0, 4).map((r) => `<code>${esc(r.model.replace(/^[^:]+:/, ''))}</code>`).join('、')}${ext.length > 4 ? ' 等' : ''})不在这张主表里,在下方 <a href="#${anchor}">外部 agent 表</a>。</p>` : '';
    return `<section><h2>档位 ${esc(tier)}</h2>${pointer}` +
      (main.length ? boardTable(main, { quizzes }) : '<p class="muted">这一档还没有内置循环的成绩。</p>') +
      (main.length ? `<h3>success × cost(虚线 = 帕累托前沿:没有别的成绩又便宜又不差)</h3>${scatter(pts)}` : '') +
      (ext.length ? `<h3 id="${anchor}">外部 agent(token / 成本由客户端自报、提示不统一 —— 单列,不进主榜)</h3>${boardTable(ext, { external: true, quizzes })}` : '') +
      `<h3>每题 success 率(括号内为局数)</h3>${taskMatrix([...main, ...ext])}</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-pal-bench 排行与统计看板</title><style>${CSS}</style>
<script>
// 标签页可以用地址直达(…/index.html#quiz),切换时地址跟着变,刷新 / 分享不丢当前页
addEventListener('DOMContentLoaded', () => {
  const show = (r) => document.querySelector('label[for="' + r.id + '"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });   // 窄屏:标签条横滑,把当前这一页的标签滑进视野
  const pick = () => { const el = document.getElementById('tab-' + location.hash.slice(1)); if (el && el.classList.contains('tab-ctrl')) { el.checked = true; show(el); } };
  pick(); addEventListener('hashchange', pick);
  for (const r of document.querySelectorAll('.tab-ctrl')) r.addEventListener('change', () => { history.replaceState(null, '', '#' + r.id.slice(4)); show(r); });
});
</script></head><body><main>
<div class="topbar">
  <div>
    <h1>agent-pal-bench 排行与实测数据统计看板</h1>
    <p class="muted" style="margin:2px 0 0">《仙剑奇侠传》(1995 DOS) 智能体长程决策基准 · 生成于 ${esc(stamp(generatedAt))} · 共 ${rows.length} 条运行记录${quizzes.length ? `、${quizzes.length} 份闭卷测验` : ''}</p>
  </div>
  <nav class="navlinks" aria-label="视图切换">
    <a href="index.html">📊 模型归并主榜</a>
    <a href="verified.html">✅ 严格已核验榜</a>
    <a href="runs.html">🗂️ 原始运行批次</a>
    <a href="https://github.com/jianmliu/agent-pal" target="_blank" rel="noopener">💻 GitHub 仓库 &amp; PR 打榜</a>
  </nav>
</div>

<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-stats" checked>
<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-tiers">
<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-tasks">
<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-ironman">
<input class="tab-ctrl" type="radio" name="pal-tab" id="tab-quiz">

<div class="tab-bar" role="tablist">
  <label class="tab-lbl" for="tab-stats">🏆 全通统计与三剑客画像</label>
  <label class="tab-lbl" for="tab-tiers">⚔️ 实操分档与帕累托榜 (${rows.length})</label>
  <label class="tab-lbl" for="tab-tasks">🎯 四大实操擂台拆解</label>
  <label class="tab-lbl" for="tab-ironman">💻 全游戏通关 (--pure) &amp; PR 指南</label>
  <label class="tab-lbl" for="tab-quiz">📝 闭卷笔试 vs 实操 (${quizzes.length})</label>
</div>

<div class="panes">
  <div class="tab-pane" id="pane-stats">${statsOverviewSection()}</div>
  <div class="tab-pane" id="pane-tiers">
    <p class="muted">score = 各题 success 率均值(主排序),同分按本题集口径比较成功局平均 cost 或战斗回合；不同评分口径分开排。按档位分开排,外部 agent 单列。「核验」= bench verify 按日志重放的结果:只有全部局都重放一致才算已核验。题集不同的运行 score 不可直接比,见每题矩阵。</p>
    ${rows.length ? sections : '<p>没有找到运行结果(bench run 的输出目录)。</p>'}
  </div>
  <div class="tab-pane" id="pane-tasks">${perTaskDeepDiveSection()}</div>
  <div class="tab-pane" id="pane-ironman">${ironmanAndPrSection()}</div>
  <div class="tab-pane" id="pane-quiz">${quizSection(quizzes) || '<p class="muted">暂无闭卷测验记录。</p>'}</div>
</div>
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
