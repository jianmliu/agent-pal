import EventBus from './event-bus.js';
import type { PalGlobal, PalGameData } from '../types/pal.js';

// Allow Node-style global usage when available.
declare const global: any;

type Store = PalGlobal;
type GameDataStore = PalGameData;
type Mutator<T = unknown> = (current: T | undefined) => T | void;
type StateEvent =
  | { type: 'globalChanged'; key: keyof Store | string; previous: unknown; value: unknown }
  | { type: 'gameDataChanged'; key: keyof GameDataStore | string; previous: unknown; value: unknown };

function resolveGlobalStore(): Store | null {
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    if (g && (g as any).Global) return (g as any).Global as Store;
  }
  if (typeof global !== 'undefined') {
    const g = global as Record<string, unknown>;
    if (g && (g as any).Global) return (g as any).Global as Store;
  }
  return null;
}

function ensureGlobalStore(): Store {
  let store = resolveGlobalStore();
  if (!store && typeof globalThis !== 'undefined') {
    store = {} as Store;
    (globalThis as Record<string, unknown>).Global = store;
  }
  return store || ({} as Store);
}

function resolveGameDataStore(): GameDataStore | null {
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    if (g && (g as any).GameData) return (g as any).GameData as GameDataStore;
  }
  if (typeof global !== 'undefined') {
    const g = global as Record<string, unknown>;
    if (g && (g as any).GameData) return (g as any).GameData as GameDataStore;
  }
  return null;
}

function ensureGameDataStore(): GameDataStore {
  let store = resolveGameDataStore();
  if (!store && typeof globalThis !== 'undefined') {
    store = {} as GameDataStore;
    (globalThis as Record<string, unknown>).GameData = store;
  }
  return store || ({} as GameDataStore);
}

class StateService extends EventBus {
  private emitGlobalChanged(key: keyof Store | string, previous: unknown, value: unknown): void {
    this.fire('globalChanged', { key, previous, value });
  }

  private emitGameDataChanged(key: keyof GameDataStore | string, previous: unknown, value: unknown): void {
    this.fire('gameDataChanged', { key, previous, value });
  }

  getGlobal<T = unknown>(key?: keyof Store | string): T | Store | undefined {
    const store = resolveGlobalStore();
    if (!store) return undefined;
    return key ? (store[key as keyof Store] as T) : store;
  }

  setGlobal<T>(key: keyof Store | string, value: T): T {
    const store = ensureGlobalStore();
    const previous = store[key as keyof Store];
    (store as Record<string, unknown>)[key as string] = value as unknown;
    this.emitGlobalChanged(key, previous, value);
    return value;
  }

  updateGlobal(patch: Record<string, unknown>): void {
    Object.keys(patch).forEach((key) => {
      this.setGlobal(key, patch[key]);
    });
  }

  mutateGlobal<T = unknown>(key: keyof Store | string, mutator?: Mutator<T>): T | undefined {
    const store = ensureGlobalStore();
    const current = store[key as keyof Store] as T;
    const result = mutator ? mutator(current) : current;
    if (typeof result !== 'undefined' && result !== current) {
      return this.setGlobal(key, result);
    }
    this.emitGlobalChanged(key, current, current);
    return current;
  }

  getGameData<T = unknown>(key?: keyof GameDataStore | string): T | GameDataStore | undefined {
    const store = resolveGameDataStore();
    if (!store) return undefined;
    return key ? (store[key as keyof GameDataStore] as T) : store;
  }

  setGameData<T>(key: keyof GameDataStore | string, value: T): T {
    const store = ensureGameDataStore();
    const previous = store[key as keyof GameDataStore];
    (store as Record<string, unknown>)[key as string] = value as unknown;
    this.emitGameDataChanged(key, previous, value);
    return value;
  }

  updateGameData(patch: Record<string, unknown>): void {
    Object.keys(patch).forEach((key) => {
      this.setGameData(key, patch[key]);
    });
  }

  mutateGameData<T = unknown>(key: keyof GameDataStore | string, mutator?: Mutator<T>): T | undefined {
    const store = ensureGameDataStore();
    const current = store[key as keyof GameDataStore] as T;
    const result = mutator ? mutator(current) : current;
    if (typeof result !== 'undefined' && result !== current) {
      return this.setGameData(key, result);
    }
    this.emitGameDataChanged(key, current, current);
    return current;
  }
}

const stateService = new StateService();

export { StateService };
export default stateService;
