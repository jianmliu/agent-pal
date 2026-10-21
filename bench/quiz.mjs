/**
 * quiz — 闭卷测验:不开游戏、不给工具,只问模型对这款游戏「记得多少」(spec §8 污染检测)。
 *
 *   bench quiz --model <spec> [--tasks a,b] [--jobs N] [--out dir]
 *
 * 题目在 bench/quiz/<task>.json(每题 3–5 问,问的是该题需要、但游戏不会马上告诉你的知识:下一步做什么、找谁、
 * 东西在哪、谜底)。判分不靠模型:每问一组 accept 关键词组,答案对每一组都至少含一个关键词才算对(简繁都收)。
 * 与同一模型的游戏成绩并排看:知道得多却玩不好 = 用不上已有知识;知道得少却玩得好 = 靠推理而不是背攻略。
 *
 * 模型:与 bench run 相同的 <provider>:<model>(ollama / openai / anthropic / gemini),或 claude-cli:<model>。
 * 每问单独一轮(问题之间不互相提示);token / 成本照记。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProvider, costOf } from './providers.mjs';
import { cleanClaudeEnv, codeRev } from './runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const QUIZ_DIR = path.join(here, 'quiz');
export const QUIZ_PROMPT_VERSION = 2;

const SYSTEM = [
  '你在回答关于经典 RPG《仙剑奇侠传》(1995 年 DOS 版,大宇资讯)剧情与玩法的问题。',
  '不能查资料,只凭你自己的记忆作答;不确定就答「不知道」,不要编、不要列多个可能。',
  '只输出一行,格式固定为:答案:<最终答案>(人名 / 地名 / 物品 / 做法,越短越好,不要解释)。'
].join('\n');

/** 只判「答案:」那一行(v2 起要求的格式);没写这一行就退回整段。边想边改口的长回答不再沾光。 */
export function finalAnswer(text) {
  const m = String(text || '').match(/答案\s*[::]\s*(.+)/);
  return m ? m[1].trim() : String(text || '').trim();
}

/** 读一个测验文件并校验格式;返回 { quiz, errors }。 */
export function validateQuiz(q, id) {
  const err = [];
  if (!q || typeof q !== 'object') return ['not an object'];
  if (q.task !== id) err.push(`task "${q.task}" does not match file name ${id}`);
  if (!Number.isInteger(q.version)) err.push('version must be an integer');
  if (!Array.isArray(q.questions) || q.questions.length < 3 || q.questions.length > 5) err.push('questions: need 3–5');
  const ids = new Set();
  for (const [i, x] of (q.questions || []).entries()) {
    const at = `questions[${i}]`;
    if (!x.id || ids.has(x.id)) err.push(`${at}.id missing or duplicate`);
    ids.add(x.id);
    if (typeof x.q !== 'string' || !x.q.trim()) err.push(`${at}.q missing`);
    if (!Array.isArray(x.accept) || !x.accept.length) err.push(`${at}.accept: need ≥ 1 keyword group`);
    for (const [j, g] of (x.accept || []).entries()) {
      if (!Array.isArray(g) || !g.length || g.some((k) => typeof k !== 'string' || !k.trim())) err.push(`${at}.accept[${j}]: need non-empty strings`);
    }
    if (x.reject != null && (!Array.isArray(x.reject) || x.reject.some((k) => typeof k !== 'string' || !k.trim()))) err.push(`${at}.reject: need non-empty strings`);
    // 正确答案本身不能踩到 reject(否则这一问永远答不对)
    for (const g of x.accept || []) for (const k of g) if ((x.reject || []).some((r) => norm(k).includes(norm(r)))) err.push(`${at}: accept keyword "${k}" contains a reject word`);
  }
  return err;
}

export function listQuizzes() {
  if (!fs.existsSync(QUIZ_DIR)) return [];
  return fs.readdirSync(QUIZ_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

export function loadQuiz(id) {
  const q = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, `${id}.json`), 'utf8'));
  const err = validateQuiz(q, id);
  if (err.length) throw new Error(`quiz ${id}: ${err.join('; ')}`);
  return q;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const DONT_KNOW = /不知道|不清楚|不记得|不確定|不确定|无法确定|無法確定|i don'?t know|not sure/i;

/**
 * 判一个答案:每个关键词组都至少命中一个;明说不知道的一律算错;
 * 含 reject 里任一词也算错 —— 互斥选项(哪颗灵珠、左右、几只)防「水或火都有可能」这种两头押。
 */
export function grade(answer, accept, reject = []) {
  const a = norm(answer);
  if (!a || DONT_KNOW.test(answer)) return false;
  if (reject.some((k) => a.includes(norm(k)))) return false;
  return accept.every((group) => group.some((k) => a.includes(norm(k))));
}

function userText(quiz, x) {
  return `${quiz.context ? quiz.context + '\n\n' : ''}问题:${x.q}`;
}

/** claude CLI 单轮:不给任何工具、不读设置、不落会话。 */
function askClaudeCli(model, system, text) {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-quiz-'));
    const args = ['-p', text, '--system-prompt', system, '--tools', '', '--setting-sources', '', '--no-session-persistence', '--output-format', 'json', '--model', model];
    const child = spawn('claude', args, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], env: cleanClaudeEnv() });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => {
      fs.rmSync(tmp, { recursive: true, force: true });
      try {
        const j = JSON.parse(out);
        const u = j.usage || {};
        resolve({ text: String(j.result || ''), usage: { tokensIn: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), tokensOut: u.output_tokens || 0 }, cost: j.total_cost_usd ?? null, error: j.is_error ? String(j.result || 'error') : null });
      } catch (e) {
        resolve({ text: '', usage: { tokensIn: 0, tokensOut: 0 }, cost: null, error: `claude-cli output unparsable: ${out.slice(0, 200)}` });
      }
    });
  });
}

async function ask(model, quiz, x) {
  const text = userText(quiz, x);
  if (model.startsWith('claude-cli:')) return askClaudeCli(model.slice('claude-cli:'.length), SYSTEM, text);
  const provider = createProvider(model);
  try {
    const r = await provider.turn({ system: SYSTEM, history: [{ role: 'user', text }], tools: [] });
    return { text: r.text, usage: r.usage, cost: costOf(model, r.usage), error: null };
  } catch (err) {
    return { text: '', usage: { tokensIn: 0, tokensOut: 0 }, cost: null, error: String(err?.message || err).slice(0, 300) };
  }
}

const sumOrNull = (xs) => (xs.some((x) => x == null) ? null : xs.reduce((a, b) => a + b, 0));

/** 跑一次测验,结果写 <out>/quiz.json,并返回。 */
export async function runQuiz({ model, tasks, jobs = 4, out }) {
  const ids = tasks?.length ? tasks : listQuizzes();
  const quizzes = ids.map(loadQuiz);
  const items = quizzes.flatMap((q) => q.questions.map((x) => ({ quiz: q, x })));
  const answers = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i; (i = next++) < items.length;) {
      const { quiz, x } = items[i];
      const r = await ask(model, quiz, x);
      answers[i] = { task: quiz.task, id: x.id, q: x.q, answer: r.text, final: finalAnswer(r.text), correct: !r.error && grade(finalAnswer(r.text), x.accept, x.reject), error: r.error, tokensIn: r.usage.tokensIn, tokensOut: r.usage.tokensOut, cost: r.cost };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));

  const perTask = {};
  for (const q of quizzes) {
    const as = answers.filter((a) => a.task === q.task);
    perTask[q.task] = { version: q.version, n: as.length, correct: as.filter((a) => a.correct).length, score: as.filter((a) => a.correct).length / as.length };
  }
  const res = {
    model, quizPromptVersion: QUIZ_PROMPT_VERSION, code: codeRev(), at: new Date().toISOString(),
    score: answers.filter((a) => a.correct).length / answers.length,
    taskMean: Object.values(perTask).reduce((s, t) => s + t.score, 0) / quizzes.length,
    errors: answers.filter((a) => a.error).length,
    cost: sumOrNull(answers.map((a) => a.cost)),
    tokens: answers.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0),
    perTask, answers
  };
  const dir = path.resolve(out || path.join(here, 'out', `quiz-${model.replace(/[^A-Za-z0-9._-]+/g, '_')}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}`));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'quiz.json'), JSON.stringify(res, null, 2));
  res.dir = dir;
  return res;
}

export function printQuiz(res) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(`\nclosed-book quiz · ${res.model} · code ${res.code} · ${res.dir}`);
  console.log('| task | correct | score |');
  console.log('|---|---|---|');
  for (const [t, s] of Object.entries(res.perTask)) console.log(`| ${t} | ${s.correct}/${s.n} | ${pct(s.score)} |`);
  console.log(`\nquiz score ${pct(res.score)} (task mean ${pct(res.taskMean)}) · ${res.answers.length} questions · errors ${res.errors} · cost ${res.cost == null ? '?' : '$' + res.cost.toFixed(4)}`);
}
