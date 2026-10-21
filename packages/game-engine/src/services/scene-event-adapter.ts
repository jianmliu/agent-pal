import worldService from './world-service';
import stateService from './state-service.js';
import reactiveContext from '../state/reactive-context.js';
import { Observable } from 'rxjs';
import { sceneEventSignals } from '../state/slices/scene-events.js';
import { getSceneEventObjectRange as getSceneEventObjectRangeSnapshot } from './scene-data-adapter.js';
import { createAdapterObservable } from './adapter-helpers.js';

type SceneEventEntry = { index: number | null; id: number | null; state: SceneEventState | null };
type SceneEventState = {
  active?: boolean;
  triggered?: boolean;
  [key: string]: unknown;
};
type CollisionState = {
  collisions?: unknown;
  [key: string]: unknown;
} | null;
type SceneEventSnapshot = {
  type: 'snapshot';
  sceneId: number;
  eventObjects: SceneEventEntry[];
  collisionState: CollisionState;
  version: number;
};
type SceneEventSignalEvent =
  | { type: 'sceneId'; value: number; previous?: number }
  | { type: 'eventObjects'; value: SceneEventEntry[]; previous?: SceneEventEntry[]; version?: number }
  | { type: 'collisionState'; value: CollisionState; previous?: CollisionState }
  | { type: 'disposed' }
  | SceneEventSnapshot;

const listeners = new Set<(event: SceneEventSignalEvent) => void>();
type Subscription = { unsubscribe?: () => void } | (() => void);
let subscriptions: Subscription[] = [];
let initialised = false;

let sceneIdCache = 0;
let eventObjectsCache: SceneEventEntry[] = [];
let eventObjectsVersion = 0;
let collisionStateCache: CollisionState = null;

const sceneSignals = sceneEventSignals();

const sceneIdStream = reactiveContext.signalToObservable(sceneSignals.sceneId, () => getSceneId());
const eventObjectsStream = reactiveContext.signalToObservable(
  sceneSignals.eventObjects,
  () => getEventObjects()
);
const collisionStateStream = reactiveContext.signalToObservable(
  sceneSignals.collisionState,
  () => getCollisionState()
);
const eventVersionStream = new Observable<number>((subscriber) => {
  ensureInitialised();
  subscriber.next(eventObjectsVersion);
  const unsubscribe = subscribe((event: SceneEventSignalEvent) => {
    if (!event) {
      return;
    }
    if (event.type === 'eventObjects') {
      subscriber.next(eventObjectsVersion);
    }
    if (event.type === 'disposed') {
      subscriber.complete();
    }
  });
  return () => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  };
});

function normalizeEventEntry(entry: any): SceneEventEntry | null {
  if (!entry) {
    return null;
  }
  const index = Number.isFinite(entry.index) ? Math.trunc(entry.index) : null;
  const id = Number.isFinite(entry.id) ? Math.trunc(entry.id) : null;
  const state = entry.state && typeof entry.state === 'object'
    ? (entry.state as SceneEventState)
    : null;
  return { index, id, state };
}

function normalizeEventEntries(entries: any): SceneEventEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry) => normalizeEventEntry(entry))
    .filter((entry): entry is SceneEventEntry => !!entry);
}

function entriesEqual(left: SceneEventEntry[], right: SceneEventEntry[]) {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (!a && !b) {
      continue;
    }
    if (!a || !b) {
      return false;
    }
    if (a.id !== b.id || a.index !== b.index || a.state !== b.state) {
      return false;
    }
  }
  return true;
}

function teardown() {
  subscriptions.forEach((subscription) => {
    if (!subscription) {
      return;
    }
    if (typeof (subscription as any).unsubscribe === 'function') {
      (subscription as any).unsubscribe();
    } else if (typeof subscription === 'function') {
      subscription();
    }
  });
  subscriptions = [];
  initialised = false;
}

function setEventObjectsCache(nextValue: any) {
  const normalized = normalizeEventEntries(nextValue);
  if (!entriesEqual(eventObjectsCache, normalized)) {
    eventObjectsCache = normalized;
    eventObjectsVersion++;
  }
  return eventObjectsCache;
}

function refreshSceneId() {
  sceneIdCache = sceneEventSignals().sceneId.value;
  return sceneIdCache;
}

type SceneEventSignalsShape = {
  sceneId: { value: number; subscribe?: (...args: any[]) => any };
  eventObjects: { value: SceneEventEntry[]; subscribe?: (...args: any[]) => any };
  collisionState: { value: CollisionState; subscribe?: (...args: any[]) => any };
};

function getSignals(): SceneEventSignalsShape {
  return sceneEventSignals() as SceneEventSignalsShape;
}

function refreshEventObjects() {
  const latest = getSignals().eventObjects.value;
  if (Array.isArray(latest) && latest.length > 0) {
    return setEventObjectsCache(latest);
  }
  // TODO(rxjs-cleanup): drop worldService fallback once scene event slice guarantees hydration.
  if (worldService && typeof worldService.getEventObjectsInCurrentScene === 'function') {
    const fallback = worldService.getEventObjectsInCurrentScene();
    return setEventObjectsCache(fallback);
  }
  return setEventObjectsCache([]);
}

function refreshCollisionState() {
  collisionStateCache = getSignals().collisionState.value;
  return collisionStateCache;
}

function notify(event: SceneEventSignalEvent) {
  listeners.forEach((listener) => {
    if (typeof listener !== 'function') {
      return;
    }
    try {
      listener(event);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[sceneEventAdapter] listener error', err);
      }
    }
  });
}

function ensureInitialised() {
  if (initialised) {
    return;
  }
  refreshSceneId();
  refreshEventObjects();
  refreshCollisionState();

  const signals = getSignals();
  subscriptions = [
    signals.sceneId.subscribe?.((value: number) => {
      if (value !== sceneIdCache) {
        const previous = sceneIdCache;
        sceneIdCache = value;
        notify({ type: 'sceneId', value, previous });
      }
    }),
    signals.eventObjects.subscribe?.((value: SceneEventEntry[]) => {
      if (value !== eventObjectsCache) {
        const previous = eventObjectsCache;
        setEventObjectsCache(value);
        notify({
          type: 'eventObjects',
          value: eventObjectsCache,
          previous,
          version: eventObjectsVersion
        });
      }
    }),
    signals.collisionState.subscribe?.((value: CollisionState) => {
      if (value !== collisionStateCache) {
        const previous = collisionStateCache;
        collisionStateCache = value;
        notify({ type: 'collisionState', value, previous });
      }
    })
  ];

  initialised = true;
}

function subscribe(listener: (event: SceneEventSignalEvent) => void) {
  ensureInitialised();
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  listener({
    type: 'snapshot',
    sceneId: sceneIdCache,
    eventObjects: eventObjectsCache,
    collisionState: collisionStateCache,
    version: eventObjectsVersion
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      notify({ type: 'disposed' });
      teardown();
      sceneIdCache = 0;
      eventObjectsCache = [];
      eventObjectsVersion = 0;
      collisionStateCache = null;
    }
  };
}

function getSceneId(): number {
  ensureInitialised();
  return sceneIdCache;
}

function cloneForConsumer(entry: SceneEventEntry | null): SceneEventEntry | null {
  return entry
    ? { index: entry.index, id: entry.id, state: entry.state }
    : null;
}

function getEventObjects(): SceneEventEntry[] {
  ensureInitialised();
  if (!Array.isArray(eventObjectsCache) || eventObjectsCache.length === 0) {
    return [];
  }
  const results: SceneEventEntry[] = [];
  for (let i = 0; i < eventObjectsCache.length; i++) {
    const entry = eventObjectsCache[i];
    if (entry) {
      const clone = cloneForConsumer(entry);
      if (clone) {
        results.push(clone);
      }
    }
  }
  return results;
}

function getEventObjectsVersion(): number {
  ensureInitialised();
  return eventObjectsVersion;
}

function getEventObjectIds(): Array<number | null> {
  ensureInitialised();
  return eventObjectsCache
    .map((entry) => (entry ? entry.id : null))
    .filter((id) => Number.isFinite(id));
}

function getGlobalEventObjects() {
  if (!stateService || typeof stateService.getGameData !== 'function') {
    return [];
  }
  const table = stateService.getGameData('eventObject') as unknown;
  if (!table) {
    return [];
  }
  const length = Array.isArray(table)
    ? table.length
    : (typeof (table as any).length === 'number' ? (table as any).length : 0);
  if (!length) {
    return [];
  }
  const results = [];
  for (let i = 0; i < length; i++) {
    const state = Array.isArray(table) ? table[i] : (table as any)[i];
    if (!state) {
      continue;
    }
    results.push({
      index: i,
      id: i + 1,
      state
    });
  }
  return results;
}

function findEventObjectEntry(predicate: (entry: SceneEventEntry) => boolean) {
  ensureInitialised();
  if (typeof predicate !== 'function') {
    return null;
  }
  const cacheLength = eventObjectsCache.length;
  for (let i = 0; i < cacheLength; i++) {
    const entry = eventObjectsCache[i];
    if (entry && predicate(entry)) {
      return entry;
    }
  }
  const globalEntries = getGlobalEventObjects();
  for (let i = 0; i < globalEntries.length; i++) {
    const entry = globalEntries[i];
    if (entry && predicate(entry)) {
      return entry;
    }
  }
  return null;
}

function getEventObjectEntryById(id: number | null | undefined) {
  if (!Number.isFinite(id)) {
    return null;
  }
  return findEventObjectEntry((entry: SceneEventEntry) => entry.id === id);
}

function getEventObjectEntryByIndex(index: number | null | undefined) {
  if (!Number.isFinite(index)) {
    return null;
  }
  return findEventObjectEntry((entry: SceneEventEntry) => entry.index === index);
}

function getEventObjectIdForRelativeIndex(relativeIndex: number) {
  ensureInitialised();
  if (!Number.isFinite(relativeIndex)) {
    return null;
  }
  const range = getSceneEventObjectRangeSnapshot();
  if (!range || typeof range.start !== 'number') {
    return null;
  }
  const absoluteIndex = range.start + Math.trunc(relativeIndex);
  const entry = getEventObjectEntryByIndex(absoluteIndex);
  return entry && Number.isFinite(entry.id) ? entry.id : null;
}

function getEventObjectStateById(id: number | null | undefined): CollisionState {
  const entry = getEventObjectEntryById(id);
  return entry ? entry.state : null;
}

function getEventObjectStateByIndex(index: number | null | undefined): CollisionState {
  const entry = getEventObjectEntryByIndex(index);
  return entry ? entry.state : null;
}

function getCollisionState(): CollisionState {
  ensureInitialised();
  return collisionStateCache;
}

export function sceneId$() {
  ensureInitialised();
  return sceneIdStream;
}

export function sceneEventObjects$() {
  ensureInitialised();
  return eventObjectsStream;
}

export function collisionState$() {
  ensureInitialised();
  return collisionStateStream;
}

export function sceneEventVersion$() {
  ensureInitialised();
  return eventVersionStream;
}

function getListenerCount() {
  return listeners.size;
}

function dispose() {
  notify({ type: 'disposed' });
  teardown();
  listeners.clear();
  sceneIdCache = 0;
  eventObjectsCache = [];
  eventObjectsVersion = 0;
  collisionStateCache = null;
}

export default {
  subscribe,
  getSceneId,
  getEventObjects,
  getEventObjectsVersion,
  getEventObjectIds,
  getEventObjectEntryById,
  getEventObjectEntryByIndex,
  getEventObjectIdForRelativeIndex,
  getEventObjectStateById,
  getEventObjectStateByIndex,
  getCollisionState,
  getListenerCount,
  sceneId$,
  sceneEventObjects$,
  collisionState$,
  sceneEventVersion$,
  dispose
};

export {
  getSceneId as getSceneIdValue,
  getEventObjects as getEventObjectsValue,
  getCollisionState as getCollisionStateValue
};
