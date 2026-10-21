import reactiveContext from '../reactive-context.js';

export type ScriptEntry = Record<string, unknown>;
export type ObjectDesc = unknown;
export type ObjectTable = Record<string, unknown>[];
type UpdateOptions = { emitEvent?: boolean; source?: string };

const SCRIPT_ENTRIES_KEY = 'world.script.entries';
const OBJECT_TABLE_KEY = 'world.script.objectTable';
const OBJECT_DESC_KEY = 'world.script.objectDesc';

function ensureSignal<T>(key: string, fallback: T) {
  return reactiveContext.ensureSignal(key, fallback);
}

function normaliseEntries(value: unknown): ScriptEntry[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as ScriptEntry[];
  if (typeof (value as { length?: number }).length === 'number') return value as ScriptEntry[];
  return [];
}

function normaliseObjectTable(value: unknown): ObjectTable {
  if (!value) return [];
  if (Array.isArray(value)) return value as ObjectTable;
  if (typeof (value as { length?: number }).length === 'number') return value as ObjectTable;
  return [];
}

function setSignalValue<T>(key: string, value: T, options: UpdateOptions = {}) {
  const previous = reactiveContext.getSignal(key, value);
  const signal = ensureSignal<T>(key, previous);
  if (signal.value !== value) {
    reactiveContext.setSignal(key, value);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: `world/script/${key}/changed`,
        value,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return value;
}

export function scriptObjectSignals() {
  return {
    scriptEntries: ensureSignal(SCRIPT_ENTRIES_KEY, [] as ScriptEntry[]),
    objectTable: ensureSignal(OBJECT_TABLE_KEY, [] as ObjectTable),
    objectDesc: ensureSignal<ObjectDesc | null>(OBJECT_DESC_KEY, null)
  };
}

export function updateScriptEntriesValue(entries: ScriptEntry[] | unknown, options: UpdateOptions = {}) {
  return setSignalValue(SCRIPT_ENTRIES_KEY, normaliseEntries(entries), options);
}

export function updateObjectTableValue(table: ObjectTable | unknown, options: UpdateOptions = {}) {
  return setSignalValue(OBJECT_TABLE_KEY, normaliseObjectTable(table), options);
}

export function updateObjectDescValue(desc: ObjectDesc | null, options: UpdateOptions = {}) {
  return setSignalValue(OBJECT_DESC_KEY, desc || null, options);
}

export function resetScriptObjectSlice() {
  reactiveContext.setSignal(SCRIPT_ENTRIES_KEY, []);
  reactiveContext.setSignal(OBJECT_TABLE_KEY, []);
  reactiveContext.setSignal(OBJECT_DESC_KEY, null);
}
