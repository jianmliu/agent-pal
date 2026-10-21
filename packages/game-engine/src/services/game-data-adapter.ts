import worldService from './world-service';
import reactiveContext from '../state/reactive-context.js';
import {
  gameDataSignals,
  getLevelUpExpTableValue,
  getLevelUpMagicTableValue,
  updateLevelUpExpTableValue,
  updateLevelUpMagicTableValue
} from '../state/slices/game-data.js';
import { createAdapterObservable } from './adapter-helpers.js';

type MagicEntry = Record<string, unknown>;
type StoreEntry = Record<string, unknown>;
type EnemyEntry = Record<string, unknown>;
type BattleEffectEntry = Record<string, unknown>;
type MagicTable = MagicEntry[];
type StoreTable = StoreEntry[];
type EnemyTable = EnemyEntry[];
type BattleEffectTable = BattleEffectEntry[];
type LevelUpTable = number[];
type LevelUpMagicEntry = Record<string, unknown>;
type LevelUpMagicTable = LevelUpMagicEntry[];
type ExpState = Record<string, unknown>[] | null;
type TableCache<T = unknown[]> = T;
type Subscription = { unsubscribe?: () => void } | (() => void);

type SnapshotEvent = {
  type: 'snapshot';
  magicTable: MagicTable;
  storeTable: StoreTable;
  enemyTable: EnemyTable;
  battleEffectTable: BattleEffectTable;
  expState: ExpState;
  levelUpExpTable: LevelUpTable;
  levelUpMagicTable: LevelUpMagicTable;
} | {
  type: 'magic' | 'store' | 'enemy' | 'battleEffect' | 'exp' | 'levelUpExp' | 'levelUpMagic';
  value: unknown;
};

const listeners = new Set<(event: SnapshotEvent) => void>();
let subscriptions: Subscription[] = [];
let initialised = false;

let magicTableCache: MagicTable = [];
let storeTableCache: StoreTable = [];
let enemyTableCache: EnemyTable = [];
let battleEffectTableCache: BattleEffectTable = [];
let expStateCache: ExpState = null;
let levelUpTableCache: LevelUpTable = [];
let levelUpMagicTableCache: LevelUpMagicTable = [];

const dataSignals = gameDataSignals();
const magicTableStream = reactiveContext.signalToObservable(
  dataSignals.magic,
  () => (Array.isArray(magicTableCache) ? magicTableCache : [])
);
const storeTableStream = reactiveContext.signalToObservable(
  dataSignals.store,
  () => (Array.isArray(storeTableCache) ? storeTableCache : [])
);
const enemyTableStream = reactiveContext.signalToObservable(
  dataSignals.enemy,
  () => (Array.isArray(enemyTableCache) ? enemyTableCache : [])
);
const battleEffectsStream = reactiveContext.signalToObservable(
  dataSignals.battleEffects,
  () => (Array.isArray(battleEffectTableCache) ? battleEffectTableCache : [])
);
const expStateStream = reactiveContext.signalToObservable(
  dataSignals.exp,
  () => getExpStateSnapshot()
);
const levelUpExpStream = reactiveContext.signalToObservable(
  dataSignals.levelUpExp,
  () => getLevelUpExpTable()
);
const levelUpMagicStream = reactiveContext.signalToObservable(
  dataSignals.levelUpMagic,
  () => getLevelUpMagicTable()
);

/**
 * Resolve the global GameData store (browser or Node globals).
 */
declare const global: any;

function getGameDataStore(): Record<string, unknown> | null {
  if (typeof globalThis !== 'undefined' && (globalThis as any).GameData) {
    return (globalThis as any).GameData as Record<string, unknown>;
  }
  if (typeof global !== 'undefined' && (global as any).GameData) {
    return (global as any).GameData as Record<string, unknown>;
  }
  return null;
}

/**
 * Deep-ish clone for arrays, typed arrays, and plain objects.
 */
function clone<T>(value: T): T {
  if (!value) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => clone(entry)) as unknown as T;
  }
  if (entryIsTypedArray(value)) {
    return toUint8Array(value).slice() as unknown as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    Object.keys(value).forEach((key) => {
      result[key] = clone((value as Record<string, unknown>)[key]);
    });
    return result as unknown as T;
  }
  return value;
}

function entryIsTypedArray(entry: unknown): entry is ArrayBufferView {
  return ArrayBuffer.isView(entry);
}

/**
 * Normalize any ArrayBufferView to a Uint8Array for safe slicing.
 */
function toUint8Array(view: ArrayBufferView): Uint8Array {
  if (view instanceof Uint8Array) return view;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function refreshMagicCache() {
  const signals = gameDataSignals();
  const latest = signals.magic.value;
  if (Array.isArray(latest) && latest.length > 0) {
    magicTableCache = latest as MagicTable;
    return magicTableCache;
  }
  if (worldService && typeof worldService.syncObjectStores === 'function') {
    worldService.syncObjectStores();
  }
  magicTableCache = (gameDataSignals().magic.value as MagicTable) || [];
  return magicTableCache;
}

function refreshStoreCache() {
  const signals = gameDataSignals();
  const latest = signals.store.value;
  if (Array.isArray(latest) && latest.length > 0) {
    storeTableCache = latest as StoreTable;
    return storeTableCache;
  }
  if (worldService && typeof worldService.syncObjectStores === 'function') {
    worldService.syncObjectStores();
  }
  storeTableCache = (gameDataSignals().store.value as StoreTable) || [];
  return storeTableCache;
}

function refreshEnemyCache() {
  const signals = gameDataSignals();
  const latest = signals.enemy.value;
  if (Array.isArray(latest) && latest.length > 0) {
    enemyTableCache = latest as EnemyTable;
    return enemyTableCache;
  }
  if (worldService && typeof worldService.syncObjectStores === 'function') {
    worldService.syncObjectStores();
  }
  enemyTableCache = (gameDataSignals().enemy.value as EnemyTable) || [];
  return enemyTableCache;
}

function refreshBattleEffectCache() {
  const signals = gameDataSignals();
  const latest = signals.battleEffects.value;
  if (Array.isArray(latest) && latest.length > 0) {
    battleEffectTableCache = latest as BattleEffectTable;
    return battleEffectTableCache;
  }
  if (worldService && typeof worldService.syncObjectStores === 'function') {
    worldService.syncObjectStores();
  }
  battleEffectTableCache = (gameDataSignals().battleEffects.value as BattleEffectTable) || [];
  return battleEffectTableCache;
}

function refreshExpCache() {
  const signals = gameDataSignals();
  const latest = signals.exp.value;
  if (latest) {
    expStateCache = latest as unknown as ExpState;
    return expStateCache;
  }
  // TODO(rxjs-cleanup): remove worldService exp fallback once exp slice is always primed.
  const current = worldService.getExpState ? worldService.getExpState() : null;
  expStateCache = Array.isArray(current) ? current : null;
  return expStateCache;
}

function refreshLevelUpCache() {
  const store = getGameDataStore();
  if (store && Array.isArray(store.levelUpExp) && store.levelUpExp.length > 0) {
    levelUpTableCache = store.levelUpExp.slice();
    const snapshot = levelUpTableCache ? levelUpTableCache.slice() : [];
    updateLevelUpExpTableValue(snapshot);
    return levelUpTableCache;
  }
  const signals = gameDataSignals();
  const latest = signals.levelUpExp.value;
  if (Array.isArray(latest) && latest.length > 0) {
    levelUpTableCache = latest.map((n) => (typeof n === 'number' ? n : 0));
    return levelUpTableCache;
  }
  const fallback = getLevelUpExpTableValue([] as number[]) as number[];
  if (Array.isArray(fallback) && fallback.length > 0) {
    levelUpTableCache = fallback.map((n) => (typeof n === 'number' ? n : 0));
    const snapshot = levelUpTableCache ? levelUpTableCache.slice() : [];
    updateLevelUpExpTableValue(snapshot);
    return levelUpTableCache;
  }
  levelUpTableCache = Array.isArray(fallback)
    ? fallback.map((n) => (typeof n === 'number' ? n : 0))
    : [];
  return levelUpTableCache;
}

function refreshLevelUpMagicCache() {
  const store = getGameDataStore();
  if (store && Array.isArray(store.levelUpMagic) && store.levelUpMagic.length > 0) {
    levelUpMagicTableCache = store.levelUpMagic as LevelUpMagicTable;
    const snapshot = Array.isArray(levelUpMagicTableCache)
      ? levelUpMagicTableCache.slice()
      : [];
    updateLevelUpMagicTableValue(snapshot);
    return levelUpMagicTableCache;
  }
  const signals = gameDataSignals();
  const latest = signals.levelUpMagic.value;
  if (Array.isArray(latest) && latest.length > 0) {
    levelUpMagicTableCache = latest as LevelUpMagicTable;
    return levelUpMagicTableCache;
  }
  const fallback = getLevelUpMagicTableValue([] as LevelUpMagicTable) as LevelUpMagicTable;
  levelUpMagicTableCache = Array.isArray(fallback) ? (fallback as LevelUpMagicTable) : [];
  if (Array.isArray(levelUpMagicTableCache) && levelUpMagicTableCache.length > 0) {
    const snapshot = levelUpMagicTableCache.slice();
    updateLevelUpMagicTableValue(snapshot);
  }
  return levelUpMagicTableCache;
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

function ensureInitialised() {
  if (initialised) {
    return;
  }
  refreshMagicCache();
  refreshStoreCache();
  refreshEnemyCache();
  refreshBattleEffectCache();
  refreshExpCache();
  refreshLevelUpCache();
  refreshLevelUpMagicCache();

  const signals = gameDataSignals();
  subscriptions = [
    signals.magic.subscribe((value: any) => {
      magicTableCache = Array.isArray(value) ? value : [];
      notify({ type: 'magic', value: magicTableCache });
    }),
    signals.store.subscribe((value: any) => {
      storeTableCache = Array.isArray(value) ? value : [];
      notify({ type: 'store', value: storeTableCache });
    }),
    signals.enemy.subscribe((value: any) => {
      enemyTableCache = Array.isArray(value) ? value : [];
      notify({ type: 'enemy', value: enemyTableCache });
    }),
    signals.battleEffects.subscribe((value: any) => {
      battleEffectTableCache = Array.isArray(value) ? value : [];
      notify({ type: 'battleEffect', value: battleEffectTableCache });
    }),
    signals.exp.subscribe((value: any) => {
      expStateCache = value || null;
      notify({ type: 'exp', value: expStateCache });
    }),
    signals.levelUpExp.subscribe((value: any) => {
      levelUpTableCache = Array.isArray(value) ? value.slice() : [];
      notify({ type: 'levelUpExp', value: levelUpTableCache });
    }),
    signals.levelUpMagic.subscribe((value: any) => {
      levelUpMagicTableCache = Array.isArray(value) ? value : [];
      notify({ type: 'levelUpMagic', value: levelUpMagicTableCache });
    })
  ];
  initialised = true;
}

function notify(event: SnapshotEvent) {
  listeners.forEach((listener) => {
    if (typeof listener !== 'function') {
      return;
    }
    try {
      listener(event);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[gameDataAdapter] listener error', err);
      }
    }
  });
}

function subscribe(listener: (event: SnapshotEvent) => void) {
  ensureInitialised();
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
    const snapshot: SnapshotEvent = {
      type: 'snapshot',
      magicTable: magicTableCache,
      storeTable: storeTableCache,
      enemyTable: enemyTableCache,
      battleEffectTable: battleEffectTableCache,
      expState: expStateCache,
      levelUpExpTable: (getLevelUpExpTableValue([] as number[]) as unknown[]).map((n) =>
        typeof n === 'number' ? n : 0
      ),
      levelUpMagicTable: Array.isArray(getLevelUpMagicTableValue([] as LevelUpMagicTable))
        ? (getLevelUpMagicTableValue([] as LevelUpMagicTable) as LevelUpMagicTable).map((entry) =>
            entry && typeof entry === 'object' ? { ...(entry as Record<string, unknown>) } : entry
          )
        : []
    };
  listener(snapshot);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      teardown();
      magicTableCache = [];
      storeTableCache = [];
      enemyTableCache = [];
      battleEffectTableCache = [];
      expStateCache = null;
      levelUpTableCache = [];
      levelUpMagicTableCache = [];
    }
  };
}

function getMagicEntry(id: number | null | undefined) {
  ensureInitialised();
  if (typeof id !== 'number' || id < 0) {
    return null;
  }
  return Array.isArray(magicTableCache) ? magicTableCache[id] || null : null;
}

export function getMagicTableValue() {
  ensureInitialised();
  return Array.isArray(magicTableCache) ? magicTableCache.slice() : [];
}

function getStoreEntry(id: number | null | undefined) {
  ensureInitialised();
  if (typeof id !== 'number' || id < 0) {
    return null;
  }
  return Array.isArray(storeTableCache) ? storeTableCache[id] || null : null;
}

export function getStoreTableValue() {
  ensureInitialised();
  return Array.isArray(storeTableCache) ? storeTableCache.slice() : [];
}

function getEnemyEntry(id: number | null | undefined) {
  ensureInitialised();
  if (typeof id !== 'number' || id < 0) {
    return null;
  }
  return Array.isArray(enemyTableCache) ? enemyTableCache[id] || null : null;
}

export function getEnemyTableValue() {
  ensureInitialised();
  return Array.isArray(enemyTableCache) ? enemyTableCache.slice() : [];
}

function getBattleEffectIndexRow(id: number | null | undefined) {
  ensureInitialised();
  if (typeof id !== 'number' || id < 0) {
    return null;
  }
  return Array.isArray(battleEffectTableCache) ? battleEffectTableCache[id] || null : null;
}

export function getBattleEffectsValue() {
  ensureInitialised();
  return Array.isArray(battleEffectTableCache) ? battleEffectTableCache.slice() : [];
}

export function getExpStateSnapshot() {
  ensureInitialised();
  return expStateCache ? clone(expStateCache) : null;
}

function getLevelUpExpValue(level: number | null | undefined) {
  if (typeof level !== 'number' || level < 0) {
    return 0;
  }
  if (!Array.isArray(levelUpTableCache)) {
    refreshLevelUpCache();
  }
  if (Array.isArray(levelUpTableCache)) {
    const value = levelUpTableCache[level];
    if (typeof value === 'number') {
      return value;
    }
  }
  // TODO(rxjs-cleanup): drop worldService level-up fallback once table seeding is guaranteed.
  if (worldService && typeof worldService.getLevelUpExp === 'function') {
    return worldService.getLevelUpExp(level) || 0;
  }
  return 0;
}

function getLevelUpExpTable() {
  if (!Array.isArray(levelUpTableCache)) {
    refreshLevelUpCache();
  }
  if (Array.isArray(levelUpTableCache)) {
    return levelUpTableCache.slice();
  }
  return [];
}

function getLevelUpMagicTable() {
  ensureInitialised();
  if (!Array.isArray(levelUpMagicTableCache) || levelUpMagicTableCache.length === 0) {
    refreshLevelUpMagicCache();
  }
  if (Array.isArray(levelUpMagicTableCache)) {
    return clone(levelUpMagicTableCache);
  }
  return [];
}

function getLevelUpMagicEntry(index: number | null | undefined) {
  if (typeof index !== 'number' || index < 0) {
    return null;
  }
  ensureInitialised();
  if (!Array.isArray(levelUpMagicTableCache) || levelUpMagicTableCache.length === 0) {
    refreshLevelUpMagicCache();
  }
  if (!Array.isArray(levelUpMagicTableCache)) {
    return null;
  }
  const entry = levelUpMagicTableCache[index];
  return entry ? clone(entry) : null;
}

export const magicTable$ = createAdapterObservable({
  name: 'gameData.magicTable',
  observe: () => {
    ensureInitialised();
    return magicTableStream;
  },
  getValue: getMagicTableValue
});

export const storeTable$ = createAdapterObservable({
  name: 'gameData.storeTable',
  observe: () => {
    ensureInitialised();
    return storeTableStream;
  },
  getValue: getStoreTableValue
});

export const enemyTable$ = createAdapterObservable({
  name: 'gameData.enemyTable',
  observe: () => {
    ensureInitialised();
    return enemyTableStream;
  },
  getValue: getEnemyTableValue
});

export const battleEffects$ = createAdapterObservable({
  name: 'gameData.battleEffects',
  observe: () => {
    ensureInitialised();
    return battleEffectsStream;
  },
  getValue: getBattleEffectsValue
});

export const expState$ = createAdapterObservable({
  name: 'gameData.expState',
  observe: () => {
    ensureInitialised();
    return expStateStream;
  },
  getValue: getExpStateSnapshot
});

export const levelUpExp$ = createAdapterObservable({
  name: 'gameData.levelUpExp',
  observe: () => {
    ensureInitialised();
    return levelUpExpStream;
  },
  getValue: getLevelUpExpTable
});

export const levelUpMagic$ = createAdapterObservable({
  name: 'gameData.levelUpMagic',
  observe: () => {
    ensureInitialised();
    return levelUpMagicStream;
  },
  getValue: getLevelUpMagicTable
});

export function getRuntimeStoreBinding() {
  return {table:storeTableCache,initialised,getStoreEntry:Object.getOwnPropertyDescriptor(gameDataAdapter,'getStoreEntry')?.value,getStoreGetter:Object.getOwnPropertyDescriptor(gameDataAdapter,'getStoreEntry')?.get,getRuntimeStoreBinding:Object.getOwnPropertyDescriptor(gameDataAdapter,'getRuntimeStoreBinding')?.value,getRuntimeGetter:Object.getOwnPropertyDescriptor(gameDataAdapter,'getRuntimeStoreBinding')?.get};
}

const gameDataAdapter = {
  getRuntimeStoreBinding,
  subscribe,
  getMagicEntry,
  getMagicTableValue,
  getStoreEntry,
  getStoreTableValue,
  getEnemyEntry,
  getEnemyTableValue,
  getBattleEffectIndexRow,
  getBattleEffectsValue,
  getExpStateSnapshot,
  getLevelUpExpValue,
  getLevelUpExpTable,
  getLevelUpMagicTable,
  getLevelUpMagicEntry,
  magicTable$,
  storeTable$,
  enemyTable$,
  battleEffects$,
  expState$,
  levelUpExp$,
  levelUpMagic$
};

export default gameDataAdapter;
