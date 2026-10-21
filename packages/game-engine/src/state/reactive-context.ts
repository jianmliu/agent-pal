/**
 * Shared reactive context using RxJS primitives. Signals are thin wrappers
 * around BehaviorSubject so existing `.value` accessors continue to work while
 * we transition the rest of the codebase.
 */

import { BehaviorSubject, Subject, Observable, type Subscription } from 'rxjs';

type Unsubscribe = () => void;

type Teardown = {
  unsubscribe: Unsubscribe;
};

type SignalListener<T> = (value: T) => void;

type SignalLike<T> = {
  value: T;
  subscribe: (listener: SignalListener<T>) => Unsubscribe;
  asObservable: () => Observable<T>;
  complete: () => void;
};

type SignalOptions<T, R = T> = {
  initialValue?: T;
  transform?: (value: T, previous: R) => R;
};

type DiagnosticsEntry = {
  name: string;
  kind: string;
  emissions: number;
  subscribers: number;
  lastEmission: number | null;
  lastValue: unknown;
  lastError: unknown;
  completed: boolean;
};

type DiagnosticsSnapshot = {
  timestamp: number;
  streams: Array<{
    name: string;
    kind: string;
    emissions: number;
    subscribers: number;
    completed: boolean;
    lastEmission: number | null;
    lastEmissionDelta: number | null;
    lastValue: unknown;
    lastError: unknown;
  }>;
};

function getTimestamp() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function createDiagnosticsEntry(name: string, kind = 'stream'): DiagnosticsEntry {
  return {
    name,
    kind,
    emissions: 0,
    subscribers: 0,
    lastEmission: null,
    lastValue: undefined,
    lastError: undefined,
    completed: false
  };
}

const streamDiagnostics = new Map<string, DiagnosticsEntry>();
let anonymousStreamId = 0;

function instrumentSubject<T extends { subscribe: (...args: any[]) => any }>(
  name: string,
  subject: T,
  kind = 'stream'
): T {
  if (!subject || typeof subject.subscribe !== 'function') {
    return subject;
  }
  if ((subject as any).__instrumented) {
    return subject;
  }
  const label = name || `${kind}#${++anonymousStreamId}`;
  const entry = streamDiagnostics.get(label) || createDiagnosticsEntry(label, kind);
  entry.kind = kind;
  streamDiagnostics.set(label, entry);

  const originalSubscribe = subject.subscribe.bind(subject) as (...args: any[]) => any;
  (subject as any).subscribe = function instrumentedSubscribe(...args: any[]) {
    entry.subscribers += 1;
    const subscription = originalSubscribe(...args);
    if (subscription && typeof subscription.unsubscribe === 'function') {
      const originalUnsubscribe = subscription.unsubscribe.bind(subscription);
      subscription.unsubscribe = function instrumentedUnsubscribe() {
        if (entry.subscribers > 0) {
          entry.subscribers -= 1;
        }
        originalUnsubscribe();
      };
      return subscription;
    }
    if (typeof subscription === 'function') {
      const teardown = subscription;
      return function instrumentedTeardown() {
        if (entry.subscribers > 0) {
          entry.subscribers -= 1;
        }
        teardown();
      };
    }
    return subscription;
  };

  if (typeof (subject as any).next === 'function') {
    const originalNext = (subject as any).next.bind(subject);
    (subject as any).next = function instrumentedNext(value: unknown) {
      entry.emissions += 1;
      entry.lastEmission = getTimestamp();
      entry.lastValue = value;
      return originalNext(value);
    };
  }

  if (typeof (subject as any).error === 'function') {
    const originalError = (subject as any).error.bind(subject);
    (subject as any).error = function instrumentedError(err: unknown) {
      entry.lastError = err;
      entry.lastEmission = getTimestamp();
      return originalError(err);
    };
  }

  if (typeof (subject as any).complete === 'function') {
    const originalComplete = (subject as any).complete.bind(subject);
    (subject as any).complete = function instrumentedComplete(...args: any[]) {
      entry.completed = true;
      entry.lastEmission = getTimestamp();
      entry.subscribers = 0;
      return originalComplete(...args);
    };
  }

  Object.defineProperty(subject as any, '__instrumented', {
    value: true,
    enumerable: false,
    configurable: false
  });
  Object.defineProperty(subject as any, '__diagnosticsKey', {
    value: label,
    enumerable: false,
    configurable: false
  });
  return subject;
}

function getDiagnosticsSnapshot(): DiagnosticsSnapshot {
  const nowTs = getTimestamp();
  const streams = Array.from(streamDiagnostics.values()).map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    emissions: entry.emissions,
    subscribers: entry.subscribers,
    completed: entry.completed,
    lastEmission: entry.lastEmission,
    lastEmissionDelta: entry.lastEmission == null ? null : Number((nowTs - entry.lastEmission).toFixed(2)),
    lastValue: entry.lastValue,
    lastError: entry.lastError
  }));
  return {
    timestamp: nowTs,
    streams
  };
}

class RxSignal<T> implements SignalLike<T> {
  _subject: BehaviorSubject<T>;

  constructor(initialValue: T) {
    this._subject = new BehaviorSubject(initialValue);
  }

  get value() {
    return this._subject.getValue();
  }

  set value(next: T) {
    const current = this._subject.getValue();
    if (Object.is(current, next)) {
      return;
    }
    this._subject.next(next);
  }

  subscribe(listener: SignalListener<T>): Unsubscribe {
    if (typeof listener !== 'function') {
      return () => {};
    }
    const subscription = this._subject.subscribe({
      next: listener,
      error(err: unknown) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[reactive] signal listener error', err);
        }
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }

  asObservable(): Observable<T> {
    return this._subject.asObservable();
  }

  complete() {
    this._subject.complete();
  }
}

function signal<T>(initialValue: T): SignalLike<T> {
  return new RxSignal(initialValue);
}

function computed<T>(fn: () => T) {
  return {
    get value() {
      return fn();
    }
  };
}

function effect<T>(fn: () => T) {
  try {
    return fn();
  } catch (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[reactive] effect error', err);
    }
    return undefined;
  }
}

function batch<T>(fn: () => T) {
  return fn();
}

class QueryClient {
  getQueryData() {
    return undefined;
  }

  setQueryData() {
    return undefined;
  }

  invalidateQueries() {
    return undefined;
  }
}

const queryClient = new QueryClient();
const rootEvent$ = new Subject<unknown>();
const battleBus$ = new Subject<unknown>();
const sceneBus$ = new Subject<unknown>();

instrumentSubject('rootEvent$', rootEvent$, 'bus');
instrumentSubject('battleBus$', battleBus$, 'bus');
instrumentSubject('sceneBus$', sceneBus$, 'bus');

const signalRegistry = new Map<string, SignalLike<any>>();
const cleanupSubscriptions = new Set<Teardown>();

function ensureSignal<T>(key: string, initialValue?: T): SignalLike<T> {
  if (!signalRegistry.has(key)) {
    const instance = signal(initialValue as T) as RxSignal<T>;
    instrumentSubject(`signal:${key}`, instance._subject, 'signal');
    signalRegistry.set(key, instance);
  }
  return signalRegistry.get(key) as SignalLike<T>;
}

function setSignalValue<T>(key: string, value: T) {
  const target = ensureSignal(key, value);
  if (target.value === value) {
    return target.value;
  }
  batch(() => {
    target.value = value;
  });
  return target.value;
}

function updateSignalValue<T>(key: string, updater: ((prev: T) => T) | T) {
  const current = ensureSignal<T>(key);
  if (typeof updater === 'function') {
    return setSignalValue(key, (updater as (prev: T) => T)(current.value));
  }
  return setSignalValue(key, updater as T);
}

function getSignalValue<T>(key: string, fallback: T) {
  if (!signalRegistry.has(key)) {
    return fallback;
  }
  return (signalRegistry.get(key) as SignalLike<T>).value;
}

function toSignalFromObservable<T, R = T>(
  key: string,
  observable: Observable<T>,
  options: SignalOptions<T, R> = {}
) {
  const { initialValue, transform } = options;
  const target = ensureSignal<T>(key, initialValue as T);
  const onNext = (value: T) => {
    const nextValue = typeof transform === 'function'
      ? (transform as (value: T, previous: R) => R)(value, target.value as unknown as R)
      : (value as unknown as R);
    batch(() => {
      (target as unknown as SignalLike<R>).value = nextValue;
    });
  };
  let subscription: Subscription | Teardown;
  try {
    subscription = observable.subscribe(onNext);
  } catch (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[reactive] observable signal subscribe error', err);
    }
    subscription = {
      unsubscribe() {}
    };
  }
  cleanupSubscriptions.add(subscription);
  return {
    signal: target as unknown as SignalLike<R>,
    unsubscribe() {
      subscription.unsubscribe();
      cleanupSubscriptions.delete(subscription);
    }
  };
}

function createBehaviorStream<T>(initialValue: T, options: { name?: string } = {}) {
  const label = options && typeof options.name === 'string' && options.name.trim()
    ? options.name.trim()
    : `behavior#${++anonymousStreamId}`;
  const subject = instrumentSubject(label, new BehaviorSubject(initialValue), 'behavior');
  cleanupSubscriptions.add({
    unsubscribe() {
      subject.complete();
    }
  });
  return subject as BehaviorSubject<T>;
}

function signalToObservable<T, R = T>(signal: SignalLike<T>, projector?: (value: T) => R) {
  if (!signal || typeof signal.asObservable !== 'function') {
    return new Observable<R>((subscriber) => {
      subscriber.error(new Error('[reactive] invalid signal'));
    });
  }
  const source = signal.asObservable();
  if (typeof projector !== 'function') {
    return source as unknown as Observable<R>;
  }
  return new Observable<R>((subscriber) => {
    const subscription = source.subscribe({
      next(value) {
        try {
          subscriber.next(projector(value));
        } catch (err) {
          subscriber.error(err);
        }
      },
      error(err) {
        subscriber.error(err);
      },
      complete() {
        subscriber.complete();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  });
}

function resetSignals() {
  signalRegistry.forEach((sig) => {
    if (sig && typeof sig.complete === 'function') {
      sig.complete();
    }
  });
  signalRegistry.clear();
}

function dispose() {
  cleanupSubscriptions.forEach((subscription) => {
    subscription.unsubscribe();
  });
  cleanupSubscriptions.clear();
  resetSignals();
}

const reactiveContext = {
  queryClient,
  rootEvent$,
  battleBus$,
  sceneBus$,
  setSignal: setSignalValue,
  getSignal: getSignalValue,
  updateSignal: updateSignalValue,
  ensureSignal,
  toSignalFromObservable,
  computed,
  effect,
  createBehaviorStream,
  signalToObservable,
  dispose,
  resetSignals,
  getDiagnostics: getDiagnosticsSnapshot
};

export default reactiveContext;
