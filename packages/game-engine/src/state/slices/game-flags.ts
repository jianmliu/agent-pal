import reactiveContext from '../reactive-context.js';

const COLLECT_VALUE_KEY = 'world.flags.collectValue';
const CHASE_RANGE_KEY = 'world.flags.chaseRange';
const CHASE_SPEED_CYCLES_KEY = 'world.flags.chaseSpeedChangeCycles';
const BATTLE_SPEED_KEY = 'world.flags.battleSpeed';

type UpdateOptions = { emitEvent?: boolean; source?: string; eventType?: string };

function normaliseInt(value: unknown, fallback = 0) {
  return Number.isFinite(value as number) ? Math.trunc(value as number) : fallback;
}

function ensureNumberSignal(key: string, fallback = 0) {
  return reactiveContext.ensureSignal(key, normaliseInt(fallback));
}

function setSignalValue(key: string, value: number, options: UpdateOptions = {}, fallback = 0) {
  const resolved = normaliseInt(value, fallback);
  const previous = reactiveContext.getSignal(key, resolved);
  const signal = ensureNumberSignal(key, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(key, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: options.eventType || `world/game/${key}/changed`,
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function gameFlagSignals() {
  return {
    collect: ensureNumberSignal(COLLECT_VALUE_KEY, 0),
    chaseRange: ensureNumberSignal(CHASE_RANGE_KEY, 0),
    chaseSpeedChangeCycles: ensureNumberSignal(CHASE_SPEED_CYCLES_KEY, 0),
    battleSpeed: ensureNumberSignal(BATTLE_SPEED_KEY, 2)
  };
}

export function getCollectValue(fallback = 0) {
  return ensureNumberSignal(COLLECT_VALUE_KEY, fallback).value;
}

export function updateCollectValue(value: number, options: UpdateOptions = {}) {
  return setSignalValue(COLLECT_VALUE_KEY, value, { ...options, eventType: 'world/game/collectValueChanged' }, 0);
}

export function getChaseRangeValue(fallback = 0) {
  return ensureNumberSignal(CHASE_RANGE_KEY, fallback).value;
}

export function updateChaseRangeValue(value: number, options: UpdateOptions = {}) {
  return setSignalValue(CHASE_RANGE_KEY, value, { ...options, eventType: 'world/game/chaseRangeChanged' }, 0);
}

export function getChaseSpeedCyclesValue(fallback = 0) {
  return ensureNumberSignal(CHASE_SPEED_CYCLES_KEY, fallback).value;
}

export function updateChaseSpeedCyclesValue(value: number, options: UpdateOptions = {}) {
  return setSignalValue(CHASE_SPEED_CYCLES_KEY, value, { ...options, eventType: 'world/game/chaseSpeedCyclesChanged' }, 0);
}

export function getBattleSpeedValue(fallback = 2) {
  return ensureNumberSignal(BATTLE_SPEED_KEY, fallback).value;
}

export function updateBattleSpeedValue(value: number, options: UpdateOptions = {}) {
  return setSignalValue(BATTLE_SPEED_KEY, value, { ...options, eventType: 'world/game/battleSpeedChanged' }, 2);
}

export function resetGameFlagsSlice() {
  reactiveContext.setSignal(COLLECT_VALUE_KEY, 0);
  reactiveContext.setSignal(CHASE_RANGE_KEY, 0);
  reactiveContext.setSignal(CHASE_SPEED_CYCLES_KEY, 0);
  reactiveContext.setSignal(BATTLE_SPEED_KEY, 2);
}
