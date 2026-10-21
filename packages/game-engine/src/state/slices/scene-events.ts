import reactiveContext from '../reactive-context.js';

const SCENE_ID_SIGNAL_KEY = 'world.scene.id';
const EVENT_OBJECTS_SIGNAL_KEY = 'world.scene.eventObjects';
const COLLISION_STATE_SIGNAL_KEY = 'world.scene.collisionState';

type UpdateOptions = { emitEvent?: boolean; source?: string };

function ensureNumberSignal(key: string, fallback = 0) {
  const value = Number.isFinite(fallback) ? Math.trunc(fallback) : 0;
  return reactiveContext.ensureSignal(key, value);
}

function ensureArraySignal<T>(key: string, initialValue: T[] = []) {
  return reactiveContext.ensureSignal(key, Array.isArray(initialValue) ? initialValue : []);
}

function ensureAnySignal<T>(key: string, initialValue: T | null = null) {
  return reactiveContext.ensureSignal(key, initialValue as any);
}

function cloneEventObjects(list: any[]) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((entry) => {
    if (!entry) {
      return null;
    }
    return {
      index: entry.index,
      id: entry.id,
      state: entry.state
    };
  });
}

function arraysEqualByRef(a: any[], b: any[]) {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function sceneEventSignals() {
  return {
    sceneId: ensureNumberSignal(SCENE_ID_SIGNAL_KEY, 0),
    eventObjects: ensureArraySignal(EVENT_OBJECTS_SIGNAL_KEY, []),
    collisionState: ensureAnySignal(COLLISION_STATE_SIGNAL_KEY, null)
  };
}

export function getSceneIdValue(fallback = 0) {
  return ensureNumberSignal(SCENE_ID_SIGNAL_KEY, fallback).value;
}

export function updateSceneIdValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(SCENE_ID_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(SCENE_ID_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(SCENE_ID_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/scene/idChanged',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function getEventObjectsValue<T = any[]>(fallback: T[] = []) {
  const signal = ensureArraySignal(EVENT_OBJECTS_SIGNAL_KEY, fallback as any[]);
  return Array.isArray(signal.value) ? (signal.value as any as T[]) : [];
}

export function updateEventObjectsValue(list: any[], options: UpdateOptions = {}) {
  const normalized = cloneEventObjects(list);
  const previous = reactiveContext.getSignal(EVENT_OBJECTS_SIGNAL_KEY, []);
  const signal = ensureArraySignal(EVENT_OBJECTS_SIGNAL_KEY, previous);
  if (!arraysEqualByRef(signal.value, normalized)) {
    reactiveContext.setSignal(EVENT_OBJECTS_SIGNAL_KEY, normalized);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/scene/eventObjectsChanged',
        value: normalized,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return normalized;
}

export function getCollisionStateValue<T = unknown>(fallback: T | null = null) {
  const signal = ensureAnySignal<T>(COLLISION_STATE_SIGNAL_KEY, fallback);
  return signal.value as T | null;
}

export function updateCollisionStateValue(state: unknown, options: UpdateOptions = {}) {
  const previous = reactiveContext.getSignal(COLLISION_STATE_SIGNAL_KEY, null);
  const signal = ensureAnySignal(COLLISION_STATE_SIGNAL_KEY, previous);
  if (signal.value !== state) {
    reactiveContext.setSignal(COLLISION_STATE_SIGNAL_KEY, state as any);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/scene/collisionStateChanged',
        value: state,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return state;
}

export function resetSceneEventsSlice() {
  reactiveContext.setSignal(SCENE_ID_SIGNAL_KEY, 0);
  reactiveContext.setSignal(EVENT_OBJECTS_SIGNAL_KEY, []);
  reactiveContext.setSignal(COLLISION_STATE_SIGNAL_KEY, null);
}
