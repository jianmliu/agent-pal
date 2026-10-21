import worldService from './world-service';
import stateService from './state-service.js';
import reactiveContext from '../state/reactive-context.js';
import { getSceneTableValue, sceneTableSignal } from '../state/slices/scene-table.js';
import { createAdapterObservable } from './adapter-helpers.js';

type SceneTableEntry = {
  id?: number;
  eventObjectIndex?: number;
  name?: string;
  [key: string]: unknown;
};

type SceneEventObjectRange = { start: number; end: number; count: number };

function resolveSceneId(sceneId?: number | null): number {
  if (typeof sceneId === 'number' && sceneId > 0) {
    return sceneId;
  }
  // TODO(rxjs-cleanup): eliminate worldService sceneId fallback once slices guarantee hydration.
  if (worldService && typeof worldService.getSceneId === 'function') {
    const current = worldService.getSceneId();
    if (typeof current === 'number' && current > 0) {
      return current;
    }
  }
  return 0;
}

export function getSceneEntry<T = SceneTableEntry | null>(sceneId?: number | null): T | null {
  const resolvedId = resolveSceneId(sceneId);
  if (resolvedId <= 0) {
    return null;
  }
  const table = getSceneTableValue([]) as SceneTableEntry[];
  if (Array.isArray(table) && table.length > 0) {
    const index = resolvedId - 1;
    if (index >= 0 && index < table.length) {
      const entry = table[index];
      if (entry) {
        return entry as unknown as T;
      }
    }
  }
  // TODO(rxjs-cleanup): drop worldService sceneEntry fallback once scene table slice covers all cases.
  if (worldService && typeof worldService.getSceneEntry === 'function') {
    return worldService.getSceneEntry(resolvedId) as T;
  }
  return null;
}

function coerceRangeValue(value: unknown, fallback: unknown): number {
  if (Number.isFinite(value)) {
    return Math.trunc(value as number);
  }
  return Number.isFinite(fallback) ? Math.trunc(fallback as number) : 0;
}

export function getSceneEventObjectRange(sceneId?: number | null): SceneEventObjectRange {
  const resolvedId = resolveSceneId(sceneId);
  if (resolvedId <= 0) {
    return {
      start: 0,
      end: 0,
      count: 0
    };
  }

  const table = getSceneTableValue([]) as SceneTableEntry[];
  let start: number | null = null;
  let end: number | null = null;
  if (Array.isArray(table) && table.length > 0) {
    const index = resolvedId - 1;
    const current = table[index];
    if (current && typeof current.eventObjectIndex === 'number') {
      start = Math.trunc(current.eventObjectIndex);
    }
    const next = table[index + 1];
    if (next && typeof next.eventObjectIndex === 'number') {
      end = Math.trunc(next.eventObjectIndex);
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    // TODO(rxjs-cleanup): remove worldService scene range fallback once table metadata is complete.
    if (worldService && typeof worldService.getSceneEventObjectRange === 'function') {
      const fallback = worldService.getSceneEventObjectRange(resolvedId);
      if (!Number.isFinite(start) && fallback && Number.isFinite(fallback.start)) {
        start = Math.trunc(fallback.start);
      }
      if (!Number.isFinite(end) && fallback && Number.isFinite(fallback.end)) {
        end = Math.trunc(fallback.end);
      }
    }
  }

  if (!Number.isFinite(end)) {
    const eventTable = stateService.getGameData('eventObject') as { length?: number } | undefined;
    const total = Array.isArray(eventTable)
      ? eventTable.length
      : (eventTable && typeof eventTable.length === 'number' ? eventTable.length : 0);
    end = Number.isFinite(total) ? total : null;
  }

  if (!Number.isFinite(start)) {
    start = 0;
  }
  if (!Number.isFinite(end)) {
    end = start;
  }
  const startValue = Number.isFinite(start) ? (start as number) : 0;
  const endValue = Number.isFinite(end) ? (end as number) : startValue;
  const count = Math.max(0, endValue - startValue);

  return {
    start: coerceRangeValue(startValue, 0),
    end: coerceRangeValue(endValue, 0),
    count: coerceRangeValue(count, 0)
  };
}

export function getSceneTable(): SceneTableEntry[] {
  const table = getSceneTableValue([]) as SceneTableEntry[];
  if (Array.isArray(table) && table.length > 0) {
    return table;
  }
  // TODO(rxjs-cleanup): drop fallback once reactive store is authoritative.
  const fallback = stateService.getGameData('scenes');
  if (Array.isArray(fallback)) {
    return fallback as SceneTableEntry[];
  }
  return [];
}

const sceneTableSignalRef = sceneTableSignal([]);
const sceneTableStream = reactiveContext.signalToObservable(sceneTableSignalRef, () => getSceneTable());

export const sceneTable$ = createAdapterObservable<SceneTableEntry[], SceneTableEntry[]>({
  name: 'scene.data.table',
  observe: () => sceneTableStream,
  getValue: getSceneTable
});

export default {
  getSceneEntry,
  getSceneEventObjectRange,
  getSceneTable,
  sceneTable$
};
