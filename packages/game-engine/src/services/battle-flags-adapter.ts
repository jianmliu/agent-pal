import { battleFlagSignals } from '../state/slices/battle-flags.js';
import { Observable } from 'rxjs';
import { createAdapterObservable } from './adapter-helpers.js';

type BattleFlags = {
  repeat: boolean;
  force: boolean;
  flee: boolean;
  result: number;
  phase: number;
};

type FlagsEvent =
  | { type: 'snapshot'; value: BattleFlags }
  | { type: 'flags'; value: BattleFlags; previous: BattleFlags }
  | { type: 'disposed' };

type Subscription = { unsubscribe?: () => void } | (() => void) | null | undefined;

const listeners = new Set<(event: FlagsEvent) => void>();
let subscriptions: Subscription[] = [];
let initialised = false;

let flagsCache: BattleFlags = {
  repeat: false,
  force: false,
  flee: false,
  result: 0,
  phase: 0
};

function teardown() {
  subscriptions.forEach((subscription) => {
    if (!subscription) {
      return;
    }
    if (typeof (subscription as any).unsubscribe === 'function') {
      (subscription as { unsubscribe: () => void }).unsubscribe();
    } else if (typeof subscription === 'function') {
      subscription();
    }
  });
  subscriptions = [];
  initialised = false;
}

function syncCache(): BattleFlags {
  const signals = battleFlagSignals();
  flagsCache = {
    repeat: !!signals.repeat.value,
    force: !!signals.force.value,
    flee: !!signals.flee.value,
    result: Number.isFinite(signals.result.value) ? signals.result.value : 0,
    phase: Number.isFinite(signals.phase.value) ? signals.phase.value : 0
  };
  return flagsCache;
}

function notify(event: FlagsEvent) {
  listeners.forEach((listener) => {
    if (typeof listener !== 'function') {
      return;
    }
    try {
      listener(event);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[battleFlagsAdapter] listener error', err);
      }
    }
  });
}

function ensureInitialised() {
  if (initialised) {
    return;
  }
  syncCache();

  const signals = battleFlagSignals();
  subscriptions = [
    signals.repeat.subscribe((value: boolean) => {
      if (value !== flagsCache.repeat) {
        const previous = { ...flagsCache };
        flagsCache.repeat = !!value;
        notify({ type: 'flags', value: { ...flagsCache }, previous });
      }
    }),
    signals.force.subscribe((value: boolean) => {
      if (value !== flagsCache.force) {
        const previous = { ...flagsCache };
        flagsCache.force = !!value;
        notify({ type: 'flags', value: { ...flagsCache }, previous });
      }
    }),
    signals.flee.subscribe((value: boolean) => {
      if (value !== flagsCache.flee) {
        const previous = { ...flagsCache };
        flagsCache.flee = !!value;
        notify({ type: 'flags', value: { ...flagsCache }, previous });
      }
    }),
    signals.result.subscribe((value: number) => {
      if (value !== flagsCache.result) {
        const previous = { ...flagsCache };
        flagsCache.result = Number.isFinite(value) ? value : 0;
        notify({ type: 'flags', value: { ...flagsCache }, previous });
      }
    }),
    signals.phase.subscribe((value: number) => {
      if (value !== flagsCache.phase) {
        const previous = { ...flagsCache };
        flagsCache.phase = Number.isFinite(value) ? value : 0;
        notify({ type: 'flags', value: { ...flagsCache }, previous });
      }
    })
  ];

  initialised = true;
}

function subscribe(listener: (event: FlagsEvent) => void) {
  ensureInitialised();
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  listener({ type: 'snapshot', value: { ...flagsCache } });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      notify({ type: 'disposed' });
      teardown();
      flagsCache = {
        repeat: false,
        force: false,
        flee: false,
        result: 0,
        phase: 0
      };
    }
  };
}

const flagsStream = new Observable<{ repeat: boolean; force: boolean; flee: boolean; result: number; phase: number }>((subscriber) => {
  const emit = () => subscriber.next({ ...flagsCache });
  emit();
  const unsubscribe = subscribe((event) => {
    if (!event) {
      return;
    }
    if (event.type === 'flags') {
      emit();
    }
    if (event.type === 'disposed') {
      subscriber.complete();
    }
  });
  return () => {
    unsubscribe();
  };
});

function getFlags(): BattleFlags {
  ensureInitialised();
  return { ...flagsCache };
}

export function getFlagsValue(): BattleFlags {
  return getFlags();
}

export const flags$ = createAdapterObservable<BattleFlags>({
  name: 'battleFlags.state',
  observe: () => {
    ensureInitialised();
    return flagsStream;
  },
  getValue: getFlagsValue
});

function dispose() {
  notify({ type: 'disposed' });
  teardown();
  listeners.clear();
  flagsCache = {
    repeat: false,
    force: false,
    flee: false,
    result: 0,
    phase: 0
  };
}

export default {
  subscribe,
  getFlags,
  getFlagsValue,
  flags$,
  dispose
};
