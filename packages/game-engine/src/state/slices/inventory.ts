import reactiveContext from '../reactive-context.js';

export type InventorySlot = {
  item?: number;
  amount?: number;
  amountInUse?: number;
  [key: string]: unknown;
} | null;
type InventoryList = InventorySlot[];
type UpdateOptions = { emitEvent?: boolean; source?: string; capacity?: number };

const INVENTORY_SIGNAL_KEY = 'world.inventory.items';
const CASH_SIGNAL_KEY = 'world.inventory.cash';
const LAST_UNEQUIPPED_SIGNAL_KEY = 'world.inventory.lastUnequipped';
const CAPACITY_SIGNAL_KEY = 'world.inventory.capacity';

function cloneInventory(list: unknown): InventoryList {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((slot) => {
    if (!slot || typeof slot !== 'object') {
      return slot ? { ...(slot as Record<string, unknown>) } : null;
    }
    const entry = slot as Record<string, unknown>;
    return {
      item: typeof entry.item === 'number' ? entry.item : 0,
      amount: typeof entry.amount === 'number' ? entry.amount : 0,
      amountInUse: typeof entry.amountInUse === 'number' ? entry.amountInUse : 0
    };
  });
}

function ensureArraySignal(key: string, initialValue: InventoryList = []) {
  return reactiveContext.ensureSignal(key, cloneInventory(initialValue));
}

function ensureNumberSignal(key: string, initialValue = 0) {
  return reactiveContext.ensureSignal(key, Number.isFinite(initialValue) ? Math.trunc(initialValue) : 0);
}

export function inventorySignals() {
  return {
    items: ensureArraySignal(INVENTORY_SIGNAL_KEY, []),
    cash: ensureNumberSignal(CASH_SIGNAL_KEY, 0),
    lastUnequipped: ensureNumberSignal(LAST_UNEQUIPPED_SIGNAL_KEY, 0),
    capacity: ensureNumberSignal(CAPACITY_SIGNAL_KEY, 0)
  };
}

export function getInventoryValue(fallback: InventoryList = []) {
  return cloneInventory(ensureArraySignal(INVENTORY_SIGNAL_KEY, fallback).value);
}

export function updateInventoryValue(list: InventoryList, options: UpdateOptions = {}) {
  const resolved = cloneInventory(list);
  const previous = reactiveContext.getSignal(INVENTORY_SIGNAL_KEY, []);
  const signal = ensureArraySignal(INVENTORY_SIGNAL_KEY, previous);
  const changed = JSON.stringify(signal.value) !== JSON.stringify(resolved);
  if (changed) {
    reactiveContext.setSignal(INVENTORY_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/inventory/changed',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  if (typeof options.capacity === 'number') {
    updateInventoryCapacityValue(options.capacity, { emitEvent: options.emitEvent, source: options.source });
  }
  return resolved;
}

export function mutateInventoryValue(mutator: (current: InventoryList) => InventoryList | void, options: UpdateOptions = {}) {
  const signal = ensureArraySignal(INVENTORY_SIGNAL_KEY, []);
  const current = cloneInventory(signal.value);
  const next = typeof mutator === 'function' ? mutator(current) : current;
  return updateInventoryValue(typeof next === 'undefined' ? current : next, options);
}

export function getCashValue(fallback = 0) {
  return ensureNumberSignal(CASH_SIGNAL_KEY, fallback).value;
}

export function updateCashValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(CASH_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(CASH_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(CASH_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/cash/changed',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function getLastUnequippedValue(fallback = 0) {
  return ensureNumberSignal(LAST_UNEQUIPPED_SIGNAL_KEY, fallback).value;
}

export function updateLastUnequippedValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(LAST_UNEQUIPPED_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(LAST_UNEQUIPPED_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(LAST_UNEQUIPPED_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/inventory/lastUnequippedChanged',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function updateInventoryCapacityValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(CAPACITY_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(CAPACITY_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(CAPACITY_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/inventory/capacityChanged',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function resetInventorySlice() {
  reactiveContext.setSignal(INVENTORY_SIGNAL_KEY, []);
  reactiveContext.setSignal(CASH_SIGNAL_KEY, 0);
  reactiveContext.setSignal(LAST_UNEQUIPPED_SIGNAL_KEY, 0);
  reactiveContext.setSignal(CAPACITY_SIGNAL_KEY, 0);
}
