/** Passive telemetry for Bench's legacy battle loop; never writes gameplay state. */
const OUTCOME = { 3: 'won', 1: 'lost', 65535: 'fled', 0: 'terminated' };

export function createBattleMetrics(e) {
  const bs = e.services.battle;
  let current = null;
  const completed = [];
  const capture = () => {
    if (!current) return;
    for (const enemy of bs.getState().enemy || []) {
      if (enemy?.objectID && !current.enemyObjects.includes(enemy.objectID)) {
        current.enemyObjects.push(enemy.objectID);
      }
    }
  };

  // Attach to the service: its native battle module is not loaded at boot yet.
  const nativeStart = bs.start;
  bs.start = function* (team, ...args) {
    current = { enemyTeam: team, enemyObjects: [], completedRounds: 0,
      startedRounds: 0, rounds: null, outcome: null };
    try {
      return yield* nativeStart.call(this, team, ...args);
    } finally {
      if (current) {
        capture();
        current.outcome = OUTCOME[bs.getState()?.battleResult] ?? 'terminated';
        current.rounds = current.startedRounds;
        completed.push({ ...current, enemyObjects: [...current.enemyObjects] });
        current = null;
      }
    }
  };

  // Count the native SelectAction -> PerformAction transition. Counting status
  // passes plus a terminal round would count a poison victory's last round twice.
  const nativeSet = bs.set;
  bs.set = function (keys, ...args) {
    const before = bs.getState()?.phase;
    const result = nativeSet.call(this, keys, ...args);
    const after = bs.getState()?.phase;
    if (current && keys?.length === 1 && keys[0] === 'phase' &&
        before !== after && after === (globalThis.BattlePhase?.PerformAction ?? 1)) {
      current.startedRounds++;
    }
    return result;
  };
  const nativeSystems = bs.runSystems;
  bs.runSystems = function (stage, ...args) {
    const result = nativeSystems.call(this, stage, ...args);
    capture();
    if (current && stage === 'status') current.completedRounds++;
    return result;
  };

  return {
    snapshot() {
      capture();
      return {
        current: current ? { ...current, enemyObjects: [...current.enemyObjects] } : null,
        completed: completed.map(b => ({ ...b, enemyObjects: [...b.enemyObjects] }))
      };
    },
    dispose() { bs.start = nativeStart; bs.set = nativeSet; bs.runSystems = nativeSystems; }
  };
}

export const BATTLE_ACTIONS = ['attack', 'defend', 'flee', 'repeat', 'auto', 'magic', 'item', 'throw', 'coop'];
export function actionError(task, name, args = {}) {
  if (name !== 'battle') return null;
  if (task.battlePolicy && args.referenceID != null) {
    return 'battle referenceID is not supported by this task; use the full spell/item name';
  }
  const act = args.action ?? args.type;
  const normalizedAct = act === 'combo' ? 'coop' : act;
  if ((task.battlePolicy?.forbiddenActions || []).includes(normalizedAct) || (task.battlePolicy?.forbiddenActions || []).includes(act)) {
    return `battle action "${act}" is not allowed in this task`;
  }
  const spell = String(args.name ?? args.magic ?? '').trim();
  // Match the Agent's fuzzy-name resolution too, so prefixes cannot escape policy.
  if (normalizedAct === 'magic' && (task.battlePolicy?.forbiddenSpells || [])
      .some(blocked => spell && (blocked.includes(spell) || spell.includes(blocked)))) {
    return `battle spell "${spell}" is not allowed in this task`;
  }
  return null;
}
export function winningRounds(battles) {
  const wins = battles.filter(b => b.outcome === 'won');
  return wins.length && wins.every(b => Number.isInteger(b.rounds) && b.rounds > 0)
    ? wins.reduce((n, b) => n + b.rounds, 0) : null;
}
