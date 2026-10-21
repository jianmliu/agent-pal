/**
 * task — 读取与校验题目(docs/specs/agent-pal-bench.md §3)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePredicate } from './predicates.mjs';
import { TIER_TOOLS } from './episode.mjs';
import { SETUP_TOOLS } from './start.mjs';
import { BATTLE_ACTIONS } from './battle-metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TASK_DIR = path.join(here, 'tasks');
export const REFERENCE_DIR = path.join(here, 'reference');
export const TIERS = ['A', 'B', 'C', 'P'];

/** 校验题目对象;返回错误列表(空 = 合法)。 */
export function validateTask(t) {
  const err = [];
  const need = (cond, msg) => { if (!cond) err.push(msg); };
  need(typeof t.id === 'string' && /^[a-z0-9-]+$/.test(t.id), 'id: lowercase slug');
  need(Number.isInteger(t.version) && t.version >= 1, 'version: integer ≥ 1');
  need(typeof t.title === 'string' && t.title, 'title: required');
  need([1, 2, 3, 4].includes(t.difficulty), 'difficulty: 1–4');
  const s = t.start || {};
  const kinds = ['rpg', 'saves', 'newGame'].filter((k) => s[k] != null);
  need(kinds.length === 1, 'start: exactly one of rpg / saves / newGame');
  // 起点存档:只给 bench/saves/ 下的文件名(不带目录,防 ../ 跑出去)
  if (s.saves != null) need(typeof s.saves === 'string' && /^[A-Za-z0-9._-]+\.saves\.json\.gz$/.test(s.saves) && !s.saves.startsWith('.'), 'start.saves: a file name in bench/saves/ (<name>.saves.json.gz)');
  if (s.slot != null) need(Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= 5, 'start.slot: 1–5');
  need(Array.isArray(t.seeds) && t.seeds.length >= 1 && t.seeds.every((x) => Number.isInteger(x) && x >= 0), 'seeds: non-empty list of non-negative integers');
  if (Array.isArray(t.seeds)) need(new Set(t.seeds).size===t.seeds.length, 'seeds: must be unique');
  need(typeof t.brief === 'string' && t.brief.length > 0, 'brief: required');
  if (t.goal) err.push(...validatePredicate(t.goal, 'goal')); else err.push('goal: required');
  for (const [i, m] of (t.milestones || []).entries()) {
    need(typeof m.id === 'string', `milestones[${i}].id: required`);
    if (m.when) err.push(...validatePredicate(m.when, `milestones[${i}].when`)); else err.push(`milestones[${i}].when: required`);
  }
  if (t.fail) err.push(...validatePredicate(t.fail, 'fail'));
  const b = t.budget || {};
  need(Number.isInteger(b.toolCalls) && b.toolCalls > 0, 'budget.toolCalls: positive integer');
  need(Array.isArray(t.tiers) && t.tiers.length && t.tiers.every((x) => TIERS.includes(x)), `tiers: subset of ${TIERS.join('/')}`);
  // 挑战题:本题禁用的工具(如一条命题禁存读档),从档位工具清单里去掉
  if (t.disallowTools != null) need(Array.isArray(t.disallowTools) && t.disallowTools.length && t.disallowTools.every((x) => typeof x === 'string' && /^[a-z_]+$/.test(x)), 'disallowTools: non-empty list of tool names');
  // 名字要对得上本题开放档位里真有的工具:写错名字(save_game)或禁一个本题根本用不到的工具,validate 就报,
  // 不要等到开局时子进程才抛、一批跑分白跑
  if (Array.isArray(t.disallowTools) && Array.isArray(t.tiers)) {
    const open = t.tiers.filter((x) => TIER_TOOLS[x]);
    for (const n of t.disallowTools) {
      if (typeof n !== 'string') continue;
      if (!Object.values(TIER_TOOLS).some((ts) => ts.includes(n))) err.push(`disallowTools: unknown tool "${n}"`);
      else if (open.length && !open.some((x) => TIER_TOOLS[x].includes(n))) err.push(`disallowTools: "${n}" is not a tool of tier ${open.join('/')}`);
    }
  }
  if (s.setup != null) need(Array.isArray(s.setup) && s.setup.length > 0 && s.setup.every((x) => Array.isArray(x) && x.length === 2 && SETUP_TOOLS.has(x[0]) && x[1] && typeof x[1] === 'object' && !Array.isArray(x[1])), 'start.setup: non-empty [walk_to|advance|wait, args] list');
  if (s.expect != null) need(s.expect && typeof s.expect === 'object' && !Array.isArray(s.expect) && Object.keys(s.expect).every(k=>['scene','mode','inBattle','enemyObject','enemyHp','party','cash','items'].includes(k)), 'start.expect: supported state fields');
  if (s.expect && typeof s.expect==='object') {
    const x=s.expect;
    if(x.party!=null)need(Array.isArray(x.party)&&x.party.length>0&&x.party.every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&Object.entries(m).every(([k,v])=>['roleId','level','hp','maxHp','mp','maxMp'].includes(k)&&Number.isInteger(v)&&v>=0)), 'start.expect.party: role/vital integer fields');
    if(x.items!=null)need(x.items&&typeof x.items==='object'&&!Array.isArray(x.items)&&Object.entries(x.items).every(([id,n])=>/^[1-9]\d*$/.test(id)&&Number.isInteger(n)&&n>=0), 'start.expect.items: item ID to non-negative amount');
    if(x.enemyObject!=null)need(Number.isInteger(x.enemyObject)&&x.enemyObject>0&&Number.isInteger(x.enemyHp)&&x.enemyHp>0,'start.expect.enemyObject/enemyHp: positive integers');
    if(x.cash!=null)need(Number.isInteger(x.cash)&&x.cash>=0,'start.expect.cash: non-negative integer');
    if(x.inBattle!=null)need(typeof x.inBattle==='boolean','start.expect.inBattle: boolean');
    if(x.mode!=null)need(typeof x.mode==='string','start.expect.mode: string');
    if(x.scene!=null)need(Number.isInteger(x.scene)&&x.scene>0,'start.expect.scene: positive integer');
  }
  if (t.engineProfile != null) need(t.engineProfile==='owned-battle', 'engineProfile: owned-battle');
  if (t.scoring != null) need(t.scoring && t.scoring.secondary === 'battleRounds' && Object.keys(t.scoring).length === 1, 'scoring: {secondary: "battleRounds"}');
  if (t.battlePolicy?.forbiddenSpells != null) need(Array.isArray(t.battlePolicy.forbiddenSpells) && t.battlePolicy.forbiddenSpells.every(x=>typeof x==='string'&&x.trim().length>0), 'battlePolicy.forbiddenSpells: spell names');
  if (t.battlePolicy != null) need(t.battlePolicy && Array.isArray(t.battlePolicy.forbiddenActions) && t.battlePolicy.forbiddenActions.length > 0 && t.battlePolicy.forbiddenActions.every(x=>BATTLE_ACTIONS.includes(x)), 'battlePolicy.forbiddenActions: known actions');
  return err;
}

export function loadTask(id) {
  const file = path.join(TASK_DIR, `${id}.json`);
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const err = validateTask(t);
  if (t.id !== id) err.push(`id "${t.id}" does not match file name "${id}"`);
  if (err.length) throw new Error(`task ${id} invalid:\n  ${err.join('\n  ')}`);
  return t;
}

export function listTasks() {
  return fs.existsSync(TASK_DIR) ? fs.readdirSync(TASK_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
}

/** 参考解:{ steps: [[tool, args], ...] } 或 { bySeed: { "<seed>": steps } }(参考解只保证在录它的那颗种子上可重放)——
 *  与黄金场景的 steps 同格式,从起点之后开始(标题画面那几步由 harness 做)。 */
export function loadReference(id) {
  const file = path.join(REFERENCE_DIR, `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
