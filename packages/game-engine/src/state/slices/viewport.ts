import reactiveContext from '../reactive-context.js';

const VIEWPORT_SIGNAL_KEY = 'world.viewport.position';
const PARTY_OFFSET_SIGNAL_KEY = 'world.viewport.partyOffset';
const PARTY_DIRECTION_SIGNAL_KEY = 'world.party.direction';
const MAX_PARTY_INDEX_SIGNAL_KEY = 'world.party.maxIndex';
const SAVE_SLOT_SIGNAL_KEY = 'world.progress.currentSaveSlot';

type UpdateOptions = { emitEvent?: boolean; source?: string };

function ensureNumberSignal(key: string, initialValue = 0) {
  return reactiveContext.ensureSignal(key, Number.isFinite(initialValue) ? Math.trunc(initialValue) : 0);
}

export function viewportSignals() {
  return {
    viewport: ensureNumberSignal(VIEWPORT_SIGNAL_KEY, 0),
    partyOffset: ensureNumberSignal(PARTY_OFFSET_SIGNAL_KEY, 0),
    partyDirection: ensureNumberSignal(PARTY_DIRECTION_SIGNAL_KEY, 0),
    maxPartyIndex: ensureNumberSignal(MAX_PARTY_INDEX_SIGNAL_KEY, -1),
    currentSaveSlot: ensureNumberSignal(SAVE_SLOT_SIGNAL_KEY, 1)
  };
}

export function getViewportValue(fallback = 0) {
  return ensureNumberSignal(VIEWPORT_SIGNAL_KEY, fallback).value;
}

export function updateViewportValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(VIEWPORT_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(VIEWPORT_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(VIEWPORT_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/viewport/changed',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function getPartyOffsetValue(fallback = 0) {
  return ensureNumberSignal(PARTY_OFFSET_SIGNAL_KEY, fallback).value;
}

export function updatePartyOffsetValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(PARTY_OFFSET_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(PARTY_OFFSET_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(PARTY_OFFSET_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/partyOffset/changed',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function getPartyDirectionValue(fallback = 0) {
  return ensureNumberSignal(PARTY_DIRECTION_SIGNAL_KEY, fallback).value;
}

export function updatePartyDirectionValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? (Math.trunc(value) & 3) : 0;
  const previous = reactiveContext.getSignal(PARTY_DIRECTION_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(PARTY_DIRECTION_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(PARTY_DIRECTION_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/partyDirection/changed',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function getMaxPartyIndexValue(fallback = -1) {
  return ensureNumberSignal(MAX_PARTY_INDEX_SIGNAL_KEY, fallback).value;
}

export function updateMaxPartyIndexValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : -1;
  const previous = reactiveContext.getSignal(MAX_PARTY_INDEX_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(MAX_PARTY_INDEX_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(MAX_PARTY_INDEX_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/maxPartyIndex/changed',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

// Slot 0 is a valid state (bCurrentSaveSlot of a new game that was never saved): 0x004E then
// restarts the new game instead of loading slot 1.
export function getCurrentSaveSlotValue(fallback = 1) {
  const value = ensureNumberSignal(SAVE_SLOT_SIGNAL_KEY, fallback).value;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function updateCurrentSaveSlotValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 1;
  const previous = reactiveContext.getSignal(SAVE_SLOT_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(SAVE_SLOT_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(SAVE_SLOT_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/progress/currentSaveSlotChanged',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function resetViewportSlice() {
  reactiveContext.setSignal(VIEWPORT_SIGNAL_KEY, 0);
  reactiveContext.setSignal(PARTY_OFFSET_SIGNAL_KEY, 0);
  reactiveContext.setSignal(PARTY_DIRECTION_SIGNAL_KEY, 0);
  reactiveContext.setSignal(MAX_PARTY_INDEX_SIGNAL_KEY, -1);
}
