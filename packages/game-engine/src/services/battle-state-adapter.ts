import { battleFormationSignals } from '../state/slices/battle-formation.js';
import { audioResourceSignals } from '../state/slices/audio-resources.js';
import { autoBattleSignal } from '../state/slices/auto-battle.js';
import { Observable } from 'rxjs';
import battleService from './battle-service.js';
import worldService from './world-service.js';
import { createAdapterObservable } from './adapter-helpers.js';

type Unsubscribe = () => void;
type SignalListener<T> = (value: T) => void;

type SignalLike<T> = {
  value: T;
  subscribe: (listener: SignalListener<T>) => Unsubscribe;
};

type BattleStateSnapshot = Record<string, unknown>;

type BattleStateEventType = 'snapshot' | 'stateChanged' | 'stateMutated' | 'disposed';

type BattleStateEvent = {
  type: BattleStateEventType;
  state?: BattleStateSnapshot;
  previous?: BattleStateSnapshot;
};

type BattleStateListener = (event: BattleStateEvent) => void;

type EnemyPositions = { pos?: Array<Array<unknown>> } | null;

type BattleFormationSignals = ReturnType<typeof battleFormationSignals>;
type BattleFormationKey = keyof BattleFormationSignals;

type AudioResourceSignals = ReturnType<typeof audioResourceSignals>;
type AudioResourceKey = keyof AudioResourceSignals;

const stateListeners = new Set<BattleStateListener>();
let stateSubscriptions: Array<Unsubscribe> = [];
let battleStateCache: BattleStateSnapshot | null = null;

const battleStateStream = new Observable<BattleStateSnapshot>((subscriber) => {
  subscriber.next(getBattleStateSnapshot());
  const unsubscribe = subscribeBattleState((event) => {
    if (event && (event.type === 'snapshot' || event.type === 'stateChanged' || event.type === 'stateMutated')) {
      subscriber.next(getBattleStateSnapshot());
    }
  });
  return () => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  };
});

function notifyState(event: BattleStateEvent) {
  stateListeners.forEach((listener) => {
    if (typeof listener !== 'function') {
      return;
    }
    try {
      listener(event);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[battleStateAdapter] listener error', err);
      }
    }
  });
}

function refreshBattleStateCache(source: string): BattleStateSnapshot | null {
  if (battleService && typeof battleService.getState === 'function') {
    const proxiedState = battleService.getState();
    if (proxiedState) {
      battleStateCache = proxiedState as BattleStateSnapshot;
      return battleStateCache;
    }
  }
  // TODO(rxjs-cleanup): remove worldService fallback once battle service always seeds the cache.
  if (worldService && typeof worldService.getBattleState === 'function') {
    const fallback = worldService.getBattleState();
    if (fallback) {
      battleStateCache = fallback as BattleStateSnapshot;
      return battleStateCache;
    }
  }
  if (source === 'dispose') {
    battleStateCache = null;
  }
  return battleStateCache;
}

function ensureBattleStateSubscription() {
  if (stateSubscriptions.length > 0) {
    return;
  }
  refreshBattleStateCache('init');
  if (!battleService || typeof battleService.on !== 'function') {
    return;
  }
  const handleStateChanged = () => {
    const previous = battleStateCache;
    const next = refreshBattleStateCache('stateChanged') || null;
    notifyState({
      type: 'stateChanged',
      state: (next || {}) as BattleStateSnapshot,
      previous: (previous || {}) as BattleStateSnapshot
    });
  };
  const handleStateMutated = () => {
    const previous = battleStateCache;
    const next = refreshBattleStateCache('stateMutated') || null;
    notifyState({
      type: 'stateMutated',
      state: (next || {}) as BattleStateSnapshot,
      previous: (previous || {}) as BattleStateSnapshot
    });
  };
  battleService.on('stateChanged', handleStateChanged);
  battleService.on('stateMutated', handleStateMutated);
  stateSubscriptions = [
    () => battleService.off('stateChanged', handleStateChanged),
    () => battleService.off('stateMutated', handleStateMutated)
  ];
}

function teardownBattleStateSubscription() {
  stateSubscriptions.forEach((dispose) => {
    if (typeof dispose === 'function') {
      dispose();
    }
  });
  stateSubscriptions = [];
  refreshBattleStateCache('dispose');
}

function getBattleFormationSignal<K extends BattleFormationKey>(key: K): BattleFormationSignals[K] | null {
  const slice = battleFormationSignals();
  return slice ? slice[key] : null;
}

function getAudioSignal<K extends AudioResourceKey>(key: K): AudioResourceSignals[K] | null {
  const slice = audioResourceSignals();
  return slice ? slice[key] : null;
}

function getAutoBattleFlagSignal() {
  return autoBattleSignal();
}

function observeSignal<T, R = T>(getSignal: () => SignalLike<T> | null, projector?: (value: T) => R) {
  return new Observable<R>((subscriber) => {
    let signal: SignalLike<T> | null;
    try {
      signal = typeof getSignal === 'function' ? getSignal() : null;
    } catch (err) {
      subscriber.error(err);
      return;
    }
    if (!signal || typeof signal.subscribe !== 'function') {
      subscriber.error(new Error('[battleStateAdapter] signal unavailable'));
      return;
    }
    const cleanup = signal.subscribe((value) => {
      try {
        subscriber.next(typeof projector === 'function' ? projector(value) : (value as unknown as R));
      } catch (err) {
        subscriber.error(err);
      }
    });
    return () => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
  });
}

export function getEnemyTeamEntry(teamId: number | null | undefined) {
  const signal = getBattleFormationSignal('enemyTeam');
  const list = signal && signal.value ? (signal.value as unknown[]) : [];
  return teamId != null && teamId >= 0 && teamId < list.length ? list[teamId] : null;
}

export function getEnemyFormationPosition(index: number, maxEnemyIndex: number) {
  const positionsSignal = getBattleFormationSignal('enemyPositions');
  const positions = (positionsSignal ? positionsSignal.value : null) as EnemyPositions;
  if (!positions || !Array.isArray(positions.pos)) {
    return null;
  }
  const rows = positions.pos[index];
  if (!rows || !Array.isArray(rows)) {
    return null;
  }
  return rows[Math.min(Math.max(maxEnemyIndex, 0), rows.length - 1)] || null;
}

export function getBattleFieldEntry(fieldId: number | null | undefined) {
  const battleFieldsSignal = getBattleFormationSignal('battleFields');
  const fields = battleFieldsSignal && battleFieldsSignal.value ? (battleFieldsSignal.value as unknown[]) : [];
  return fieldId != null && fieldId >= 0 && fieldId < fields.length ? fields[fieldId] : null;
}

export function getBattleFieldId() {
  const signal = getAudioSignal('battleFieldId');
  const value = signal ? signal.value : 0;
  return typeof value === 'number' ? value : 0;
}

export function getBattleMusicTrack() {
  const signal = getAudioSignal('battleMusicTrack');
  const value = signal ? signal.value : 0;
  return typeof value === 'number' ? value : 0;
}

export function getMusicTrack() {
  const signal = getAudioSignal('musicTrack');
  const value = signal ? signal.value : 0;
  return typeof value === 'number' ? value : 0;
}

export function isAutoBattleEnabled() {
  const signal = getAutoBattleFlagSignal();
  return !!(signal && signal.value);
}

export function getEnemyTeamValue() {
  const signal = getBattleFormationSignal('enemyTeam');
  const value = signal && signal.value;
  return Array.isArray(value) ? value : [];
}

export function getBattleFieldsValue() {
  const signal = getBattleFormationSignal('battleFields');
  const value = signal && signal.value;
  return Array.isArray(value) ? value : [];
}

const enemyTeamStream = observeSignal(
  () => getBattleFormationSignal('enemyTeam') as SignalLike<unknown[]>,
  (value) => (Array.isArray(value) ? value : [])
);

const battleFieldsStream = observeSignal(
  () => getBattleFormationSignal('battleFields') as SignalLike<unknown[]>,
  (value) => (Array.isArray(value) ? value : [])
);

const battleFieldIdStream = observeSignal(
  () => getAudioSignal('battleFieldId') as SignalLike<number>,
  () => getBattleFieldId()
);

const battleMusicTrackStream = observeSignal(
  () => getAudioSignal('battleMusicTrack') as SignalLike<number>,
  () => getBattleMusicTrack()
);

const musicTrackStream = observeSignal(
  () => getAudioSignal('musicTrack') as SignalLike<number>,
  () => getMusicTrack()
);

const autoBattleStreamRef = observeSignal(
  () => getAutoBattleFlagSignal() as SignalLike<boolean>,
  () => isAutoBattleEnabled()
);

export const enemyTeam$ = createAdapterObservable({
  name: 'battleState.enemyTeam',
  observe: () => enemyTeamStream,
  getValue: getEnemyTeamValue
});

export const battleFields$ = createAdapterObservable({
  name: 'battleState.battleFields',
  observe: () => battleFieldsStream,
  getValue: getBattleFieldsValue
});

export const battleFieldId$ = createAdapterObservable({
  name: 'battleState.fieldId',
  observe: () => battleFieldIdStream,
  getValue: getBattleFieldId
});

export const battleMusicTrack$ = createAdapterObservable({
  name: 'battleState.battleMusic',
  observe: () => battleMusicTrackStream,
  getValue: getBattleMusicTrack
});

export const musicTrack$ = createAdapterObservable({
  name: 'battleState.musicTrack',
  observe: () => musicTrackStream,
  getValue: getMusicTrack
});

export const autoBattle$ = createAdapterObservable({
  name: 'battleState.autoBattle',
  observe: () => autoBattleStreamRef,
  getValue: isAutoBattleEnabled
});

export const battleState$ = createAdapterObservable({
  name: 'battleState.state',
  observe: () => battleStateStream,
  getValue: getBattleStateSnapshot
});

export function getEnemyTeamSignal() {
  return getBattleFormationSignal('enemyTeam');
}

export function getBattleFieldsSignal() {
  return getBattleFormationSignal('battleFields');
}

export function getBattleStateSnapshot() {
  return refreshBattleStateCache('snapshot') || {};
}

export function subscribeBattleState(listener: BattleStateListener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  ensureBattleStateSubscription();
  stateListeners.add(listener);
  listener({
    type: 'snapshot',
    state: getBattleStateSnapshot()
  });
  return () => {
    stateListeners.delete(listener);
    if (stateListeners.size === 0) {
      notifyState({ type: 'disposed' });
      teardownBattleStateSubscription();
    }
  };
}

export default {
  getEnemyTeamEntry,
  getEnemyFormationPosition,
  getBattleFieldEntry,
  getBattleFieldId,
  getBattleMusicTrack,
  getMusicTrack,
  getEnemyTeamValue,
  getBattleFieldsValue,
  isAutoBattleEnabled,
  getEnemyTeamSignal,
  getBattleFieldsSignal,
  getBattleStateSnapshot,
  subscribeBattleState,
  enemyTeam$,
  battleFields$,
  battleFieldId$,
  battleMusicTrack$,
  musicTrack$,
  autoBattle$,
  battleState$
};
