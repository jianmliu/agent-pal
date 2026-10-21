import reactiveContext from '../reactive-context.js';

type TableEntry = unknown;
type Table = TableEntry[];
type StoreEntry = { items?: unknown[] } & Record<string, unknown>;
type StoreTable = StoreEntry[];
export type LevelUpExpTable = number[];
export type LevelUpMagicEntry = Record<string, unknown>;
export type LevelUpMagicTable = LevelUpMagicEntry[];

export type ExpEntry = { exp?: number; level?: number; count?: number; [key: string]: unknown } | null;
export type ExpState = {
  primaryExp?: ExpEntry[];
  secondaryExp?: ExpEntry[];
  [key: string]: unknown;
} | null;

type UpdateOptions = { emitEvent?: boolean; source?: string };

const MAGIC_TABLE_KEY = 'world.gameData.magicTable';
const STORE_TABLE_KEY = 'world.gameData.storeTable';
const EXP_STATE_KEY = 'world.gameData.expState';
const ENEMY_TABLE_KEY = 'world.gameData.enemyTable';
const BATTLE_EFFECT_TABLE_KEY = 'world.gameData.battleEffectTable';
const LEVEL_UP_EXP_TABLE_KEY = 'world.gameData.levelUpExpTable';
const LEVEL_UP_MAGIC_TABLE_KEY = 'world.gameData.levelUpMagicTable';

function cloneTable(value: unknown): Table {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry) return entry as null;
      if (Array.isArray(entry)) return entry.slice();
      if (entry && typeof entry === 'object') {
        const typed = entry as { uint8Array?: Uint8Array };
        if (typed.uint8Array) {
          return { ...typed, uint8Array: typed.uint8Array.slice() };
        }
        return { ...(entry as Record<string, unknown>) };
      }
      return entry as TableEntry;
    });
  }
  if (ArrayBuffer.isView(value) && typeof (value as ArrayBufferView & { slice?: () => ArrayBufferView }).slice === 'function') {
    return (value as ArrayBufferView & { slice: () => ArrayBufferView }).slice() as unknown as Table;
  }
  return [];
}

function cloneStoreTable(value: unknown): StoreTable {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry as StoreEntry;
    }
    const clone: StoreEntry = { ...(entry as StoreEntry) };
    if (Array.isArray((entry as StoreEntry).items)) {
      clone.items = (entry as StoreEntry).items?.slice();
    }
    return clone;
  });
}

function cloneExpState(value: unknown): ExpState {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const clone: ExpState = { ...source };
  const primary = (source as { primaryExp?: ExpEntry[] }).primaryExp;
  if (Array.isArray(primary)) {
    clone.primaryExp = primary.map((entry) => (entry && typeof entry === 'object' ? { ...(entry as Record<string, unknown>) } : entry));
  }
  const secondary = (source as { secondaryExp?: ExpEntry[] }).secondaryExp;
  if (Array.isArray(secondary)) {
    clone.secondaryExp = secondary.map((entry) => (entry && typeof entry === 'object' ? { ...(entry as Record<string, unknown>) } : entry));
  }
  return clone;
}

function ensureMagicSignal(initialValue: Table = []) {
  return reactiveContext.ensureSignal(MAGIC_TABLE_KEY, cloneTable(initialValue));
}

function ensureStoreSignal(initialValue: StoreTable = []) {
  return reactiveContext.ensureSignal(STORE_TABLE_KEY, cloneStoreTable(initialValue));
}

function ensureExpSignal(initialValue: ExpState = null) {
  return reactiveContext.ensureSignal(EXP_STATE_KEY, cloneExpState(initialValue));
}

function ensureEnemySignal(initialValue: Table = []) {
  return reactiveContext.ensureSignal(ENEMY_TABLE_KEY, cloneTable(initialValue));
}

function ensureBattleEffectSignal(initialValue: Table = []) {
  return reactiveContext.ensureSignal(BATTLE_EFFECT_TABLE_KEY, cloneTable(initialValue));
}

function ensureLevelUpExpSignal(initialValue: LevelUpExpTable = []) {
  return reactiveContext.ensureSignal(LEVEL_UP_EXP_TABLE_KEY, cloneTable(initialValue));
}

function ensureLevelUpMagicSignal(initialValue: LevelUpMagicTable = []) {
  return reactiveContext.ensureSignal(LEVEL_UP_MAGIC_TABLE_KEY, cloneTable(initialValue));
}

export function gameDataSignals() {
  return {
    magic: ensureMagicSignal([]),
    store: ensureStoreSignal([]),
    enemy: ensureEnemySignal([]),
    battleEffects: ensureBattleEffectSignal([]),
    exp: ensureExpSignal(null),
    levelUpExp: ensureLevelUpExpSignal([]),
    levelUpMagic: ensureLevelUpMagicSignal([])
  };
}

function setSignalValue<T>(
  key: string,
  ensureFn: (initial?: T) => any,
  cloneFn: (value: unknown) => T,
  value: unknown,
  options: UpdateOptions = {}
) {
  const resolved = cloneFn(value);
  const previous = reactiveContext.getSignal(key, resolved);
  const signal = ensureFn(previous);
  const changed = JSON.stringify(signal.value) !== JSON.stringify(resolved);
  if (changed) {
    signal.value = resolved;
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: `world/gameData/${key}/changed`,
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function updateMagicTableValue(table: Table, options: UpdateOptions = {}) {
  return setSignalValue<Table>(MAGIC_TABLE_KEY, ensureMagicSignal, cloneTable, table, options);
}

export function updateStoreTableValue(table: StoreTable, options: UpdateOptions = {}) {
  return setSignalValue<StoreTable>(STORE_TABLE_KEY, ensureStoreSignal, cloneStoreTable, table, options);
}

export function updateEnemyTableValue(table: Table, options: UpdateOptions = {}) {
  return setSignalValue<Table>(ENEMY_TABLE_KEY, ensureEnemySignal, cloneTable, table, options);
}

export function updateBattleEffectTableValue(table: Table, options: UpdateOptions = {}) {
  return setSignalValue<Table>(BATTLE_EFFECT_TABLE_KEY, ensureBattleEffectSignal, cloneTable, table, options);
}

function cloneLevelUpExp(value: unknown): LevelUpExpTable {
  if (!Array.isArray(value)) return [];
  return value.map((n) => (typeof n === 'number' ? n : 0));
}

function cloneLevelUpMagic(value: unknown): LevelUpMagicTable {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (entry && typeof entry === 'object' ? { ...(entry as Record<string, unknown>) } : entry));
}

export function updateLevelUpExpTableValue(table: LevelUpExpTable, options: UpdateOptions = {}) {
  return setSignalValue<LevelUpExpTable>(LEVEL_UP_EXP_TABLE_KEY, ensureLevelUpExpSignal, cloneLevelUpExp, table, options);
}

export function updateLevelUpMagicTableValue(table: LevelUpMagicTable, options: UpdateOptions = {}) {
  return setSignalValue<LevelUpMagicTable>(LEVEL_UP_MAGIC_TABLE_KEY, ensureLevelUpMagicSignal, cloneLevelUpMagic, table, options);
}

export function updateExpStateValue(state: ExpState, options: UpdateOptions = {}) {
  const resolved = cloneExpState(state);
  const previous = reactiveContext.getSignal(EXP_STATE_KEY, resolved);
  const signal = ensureExpSignal(previous);
  const changed = JSON.stringify(signal.value) !== JSON.stringify(resolved);
  if (changed) {
    reactiveContext.setSignal(EXP_STATE_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/gameData/expState/changed',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function getMagicTableValue(fallback: Table = []) {
  return cloneTable(ensureMagicSignal(fallback).value);
}

export function getStoreTableValue(fallback: StoreTable = []) {
  return cloneStoreTable(ensureStoreSignal(fallback).value);
}

export function getEnemyTableValue(fallback: Table = []) {
  return cloneTable(ensureEnemySignal(fallback).value);
}

export function getBattleEffectTableValue(fallback: Table = []) {
  return cloneTable(ensureBattleEffectSignal(fallback).value);
}

export function getLevelUpExpTableValue(fallback: LevelUpExpTable = []): LevelUpExpTable {
  return cloneTable(ensureLevelUpExpSignal(fallback).value) as LevelUpExpTable;
}

export function getLevelUpMagicTableValue(fallback: LevelUpMagicTable = []): LevelUpMagicTable {
  return cloneTable(ensureLevelUpMagicSignal(fallback).value) as LevelUpMagicTable;
}

export function getExpStateValue(): ExpState {
  const signal = ensureExpSignal(null);
  const value = signal.value;
  return value ? cloneExpState(value) : null;
}

export function resetGameDataSlice() {
  ensureMagicSignal([]).value = [];
  ensureStoreSignal([]).value = [];
  ensureEnemySignal([]).value = [];
  ensureBattleEffectSignal([]).value = [];
  ensureLevelUpMagicSignal([]).value = [];
  ensureLevelUpExpSignal([]).value = [];
  ensureExpSignal(null).value = null;
}
