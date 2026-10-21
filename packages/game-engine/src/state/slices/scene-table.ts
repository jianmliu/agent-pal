import reactiveContext from '../reactive-context.js';

const SCENE_TABLE_KEY = 'world.scene.table';

type UpdateOptions = { emitEvent?: boolean; source?: string };

function ensureSceneTableSignal(initialValue: unknown[] = []) {
  return reactiveContext.ensureSignal(
    SCENE_TABLE_KEY,
    Array.isArray(initialValue) ? initialValue : []
  );
}

export function sceneTableSignal(initialValue: unknown[] = []) {
  return ensureSceneTableSignal(initialValue);
}

export function getSceneTableValue<T = unknown[]>(fallback: T) {
  const signal = ensureSceneTableSignal(fallback as unknown as unknown[]);
  return Array.isArray(signal.value) ? (signal.value as any as T) : fallback;
}

export function updateSceneTableValue(table: unknown[], options: UpdateOptions = {}) {
  const resolved = Array.isArray(table) ? table : [];
  const previous = reactiveContext.getSignal(SCENE_TABLE_KEY, resolved);
  const signal = ensureSceneTableSignal(previous as unknown[]);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(SCENE_TABLE_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/scene/tableChanged',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function resetSceneTableSlice() {
  reactiveContext.setSignal(SCENE_TABLE_KEY, []);
}
