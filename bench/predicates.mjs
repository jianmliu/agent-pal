/**
 * predicates — 题目的 goal / milestones / fail 求值(纯函数,只读 StateView)。
 *
 * 谓词是 JSON:一个对象恰好一个键(组合子 all / any / not,或下面的原子谓词)。
 * 规格见 docs/specs/agent-pal-bench.md §4.2。求值器不碰引擎 —— 引擎细节全在 state-view.mjs。
 */

const ATOMS = {
  sceneIs: (v, n) => v.scene === n,
  sceneVisited: (v, n) => v.visitedScenes.includes(n),
  at: (v, { scene, gx, gy, r = 0 }) => v.scene === scene && v.pos && Math.abs(v.pos.gx - gx) + Math.abs(v.pos.gy - gy) <= r,
  hasItem: (v, q) => {
    const min = q.min ?? 1;
    const hit = v.inventory.find((it) => (q.id != null ? it.itemId === q.id : it.name === q.name));
    return !!hit && hit.amount >= min;
  },
  partyIncludes: (v, q) => v.party.some((m) => (typeof q === 'number' ? m.roleId === q : m.name === q)),
  levelAtLeast: (v, { role, n }) => v.party.some((m) => (role == null || m.roleId === role || m.name === role) && m.level >= n),
  cashAtLeast: (v, n) => v.cash >= n,
  battleWon: (v, q = {}) => v.battles.some((b) => b.outcome === 'won' && (q.enemyTeam == null || b.enemyTeam === q.enemyTeam) && (q.enemyObject == null || b.enemyObjects?.includes(q.enemyObject))),
  battleFled: (v, q = {}) => v.battles.some((b) => b.outcome === 'fled' && (q.enemyTeam == null || b.enemyTeam === q.enemyTeam)),
  battleTerminated: (v, want = true) => v.battles.some(b=>b.outcome==='terminated') === want,
  // 队伍里有人倒下(HP 0);maxHp 0 的空位(存档里的幽灵队员)不算
  memberDown: (v, want = true) => v.party.some((m) => m.maxHp > 0 && m.hp <= 0) === want,
  partyWiped: (v, want = true) => (v.battles.some((b) => b.outcome === 'lost') || (v.party.length > 0 && v.party.every((m) => m.hp <= 0))) === want,
  textSeen: (v, q) => {
    if (typeof q === 'string') return v.textLog.some((t) => t.includes(q));
    const re = new RegExp(q.regex, q.flags ?? '');
    return v.textLog.some((t) => re.test(t));
  },
  eventObject: (v, { scene, idx, state, triggerScript }) => {
    if (v.scene !== scene) return false;
    const o = v.eventObjects.find((x) => x.idx === idx);
    if (!o) return false;
    return (state == null || o.state === state) && (triggerScript == null || o.triggerScript === triggerScript);
  }
};

export const ATOM_NAMES = Object.keys(ATOMS);

/** 校验一个谓词的结构;返回错误列表(空 = 合法)。 */
export function validatePredicate(p, path = 'pred') {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [`${path}: must be an object`];
  const keys = Object.keys(p);
  if (keys.length !== 1) return [`${path}: must have exactly one key, got [${keys.join(', ')}]`];
  const [k] = keys;
  const arg = p[k];
  if (k === 'all' || k === 'any') {
    if (!Array.isArray(arg) || !arg.length) return [`${path}.${k}: must be a non-empty array`];
    return arg.flatMap((q, i) => validatePredicate(q, `${path}.${k}[${i}]`));
  }
  if (k === 'not') return validatePredicate(arg, `${path}.not`);
  if (!(k in ATOMS)) return [`${path}: unknown predicate "${k}" (known: all, any, not, ${ATOM_NAMES.join(', ')})`];
  if (k === 'hasItem' && (arg == null || (arg.id == null && arg.name == null))) return [`${path}.hasItem: needs id or name`];
  if (k === 'textSeen' && !(typeof arg === 'string' || (arg && typeof arg.regex === 'string'))) return [`${path}.textSeen: string or {regex}`];
  return [];
}

/** 求值。未知键在 validatePredicate 阶段就该被挡下;这里遇到直接抛。 */
export function evaluate(p, view) {
  const [k] = Object.keys(p);
  const arg = p[k];
  if (k === 'all') return arg.every((q) => evaluate(q, view));
  if (k === 'any') return arg.some((q) => evaluate(q, view));
  if (k === 'not') return !evaluate(arg, view);
  const fn = ATOMS[k];
  if (!fn) throw new Error(`unknown predicate ${k}`);
  return !!fn(view, arg);
}
