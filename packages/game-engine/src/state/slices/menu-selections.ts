import reactiveContext from '../reactive-context.js';

const MAIN_MENU_SIGNAL_KEY = 'ui.menu.main.index';
const SYSTEM_MENU_SIGNAL_KEY = 'ui.menu.system.index';
const INVENTORY_MENU_SIGNAL_KEY = 'ui.menu.inventory.index';
const MUSIC_FLAG_SIGNAL_KEY = 'ui.audio.noMusic';
const SOUND_FLAG_SIGNAL_KEY = 'ui.audio.noSound';

type UpdateOptions = { emitEvent?: boolean; source?: string; eventType?: string };

function ensureNumberSignal(key: string, initialValue = 0) {
  return reactiveContext.ensureSignal(key, Number.isFinite(initialValue) ? Math.trunc(initialValue) : 0);
}

function ensureBooleanSignal(key: string, initialValue = false) {
  return reactiveContext.ensureSignal(key, !!initialValue);
}

function updateNumberSignal(key: string, value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(key, resolved);
  const signal = ensureNumberSignal(key, previous as number);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(key, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: options.eventType || 'ui/menu/indexChanged',
        key,
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

function updateBooleanSignal(key: string, value: boolean, options: UpdateOptions = {}) {
  const resolved = !!value;
  const previous = reactiveContext.getSignal(key, resolved);
  const signal = ensureBooleanSignal(key, previous as boolean);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(key, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: options.eventType || 'ui/audio/toggle',
        key,
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function menuSelectionSignals() {
  return {
    main: ensureNumberSignal(MAIN_MENU_SIGNAL_KEY),
    system: ensureNumberSignal(SYSTEM_MENU_SIGNAL_KEY),
    inventory: ensureNumberSignal(INVENTORY_MENU_SIGNAL_KEY)
  };
}

export function audioToggleSignals() {
  return {
    noMusic: ensureBooleanSignal(MUSIC_FLAG_SIGNAL_KEY),
    noSound: ensureBooleanSignal(SOUND_FLAG_SIGNAL_KEY)
  };
}

export function getMainMenuIndexValue(fallback = 0) {
  return ensureNumberSignal(MAIN_MENU_SIGNAL_KEY, fallback).value;
}

export function updateMainMenuIndex(value: number, options?: UpdateOptions) {
  return updateNumberSignal(MAIN_MENU_SIGNAL_KEY, value, {
    ...(options || {}),
    eventType: 'ui/menu/main/indexChanged'
  });
}

export function getSystemMenuIndexValue(fallback = 0) {
  return ensureNumberSignal(SYSTEM_MENU_SIGNAL_KEY, fallback).value;
}

export function updateSystemMenuIndex(value: number, options?: UpdateOptions) {
  return updateNumberSignal(SYSTEM_MENU_SIGNAL_KEY, value, {
    ...(options || {}),
    eventType: 'ui/menu/system/indexChanged'
  });
}

export function getInventoryMenuIndexValue(fallback = 0) {
  return ensureNumberSignal(INVENTORY_MENU_SIGNAL_KEY, fallback).value;
}

export function updateInventoryMenuIndex(value: number, options?: UpdateOptions) {
  return updateNumberSignal(INVENTORY_MENU_SIGNAL_KEY, value, {
    ...(options || {}),
    eventType: 'ui/menu/inventory/indexChanged'
  });
}

export function getNoMusicFlagValue(fallback = false) {
  return ensureBooleanSignal(MUSIC_FLAG_SIGNAL_KEY, fallback).value;
}

export function updateNoMusicFlag(value: boolean, options?: UpdateOptions) {
  return updateBooleanSignal(MUSIC_FLAG_SIGNAL_KEY, value, {
    ...(options || {}),
    eventType: 'ui/audio/noMusicChanged'
  });
}

export function getNoSoundFlagValue(fallback = false) {
  return ensureBooleanSignal(SOUND_FLAG_SIGNAL_KEY, fallback).value;
}

export function updateNoSoundFlag(value: boolean, options?: UpdateOptions) {
  return updateBooleanSignal(SOUND_FLAG_SIGNAL_KEY, value, {
    ...(options || {}),
    eventType: 'ui/audio/noSoundChanged'
  });
}

export function resetMenuSelectionSlices() {
  reactiveContext.setSignal(MAIN_MENU_SIGNAL_KEY, 0);
  reactiveContext.setSignal(SYSTEM_MENU_SIGNAL_KEY, 0);
  reactiveContext.setSignal(INVENTORY_MENU_SIGNAL_KEY, 0);
}

export function resetAudioToggleSlices() {
  reactiveContext.setSignal(MUSIC_FLAG_SIGNAL_KEY, false);
  reactiveContext.setSignal(SOUND_FLAG_SIGNAL_KEY, false);
}
