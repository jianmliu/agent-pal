import { gameFlagSignals } from '../state/slices/game-flags.js';
import { createAdapterObservable } from './adapter-helpers.js';

type Signal<T = number> = { value: T };

type FlagSignals = {
  collect: Signal<number>;
  chaseRange: Signal<number>;
  chaseSpeedChangeCycles: Signal<number>;
  battleSpeed: Signal<number>;
};

const flagSignals: FlagSignals = gameFlagSignals() as FlagSignals;

function normaliseNumber(value: unknown, fallback = 0) {
  return Number.isFinite(value as number) ? Math.trunc(value as number) : fallback;
}

export function getCollectValue() {
  return normaliseNumber(flagSignals.collect.value, 0);
}

export function getChaseRange() {
  return normaliseNumber(flagSignals.chaseRange.value, 0);
}

export function getChaseSpeedChangeCycles() {
  return normaliseNumber(flagSignals.chaseSpeedChangeCycles.value, 0);
}

export function getBattleSpeed() {
  return normaliseNumber(flagSignals.battleSpeed.value, 2);
}

export const collect$ = createAdapterObservable<number>({
  name: 'gameFlags.collect',
  signal: flagSignals.collect,
  getValue: getCollectValue
});

export const chaseRange$ = createAdapterObservable<number>({
  name: 'gameFlags.chaseRange',
  signal: flagSignals.chaseRange,
  getValue: getChaseRange
});

export const chaseSpeedChangeCycles$ = createAdapterObservable<number>({
  name: 'gameFlags.chaseSpeedCycles',
  signal: flagSignals.chaseSpeedChangeCycles,
  getValue: getChaseSpeedChangeCycles
});

export const battleSpeed$ = createAdapterObservable<number>({
  name: 'gameFlags.battleSpeed',
  signal: flagSignals.battleSpeed,
  getValue: getBattleSpeed
});

export default {
  getCollectValue,
  getChaseRange,
  getChaseSpeedChangeCycles,
  getBattleSpeed,
  collect$,
  chaseRange$,
  chaseSpeedChangeCycles$,
  battleSpeed$
};
