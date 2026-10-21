import worldService from './world-service';
import reactiveContext from '../state/reactive-context.js';
import { scriptObjectSignals } from '../state/slices/script-objects.js';
import type { ObjectTable, ObjectDesc } from '../state/slices/script-objects.js';
import { createAdapterObservable } from './adapter-helpers.js';

type SignalSubscription = { unsubscribe?: () => void } | (() => void) | null | undefined;
type ScriptEntry = any;
type ObjectEntry = any;
type ObjectDescEntry = { id: number; desc: Uint8Array } | null;

type ScriptObjectEvent =
  | { type: 'snapshot'; scriptEntries: ScriptEntry[]; objectTable: ObjectEntry[]; objectDesc: ObjectDescEntry[] | null }
  | { type: 'scriptEntries'; value: ScriptEntry[]; previous: ScriptEntry[] }
  | { type: 'objectTable'; value: ObjectEntry[]; previous: ObjectEntry[] }
  | { type: 'objectDesc'; value: ObjectDescEntry[] | null; previous: ObjectDescEntry[] | null }
  | { type: 'disposed' };

const listeners = new Set<(event: ScriptObjectEvent) => void>();
let subscriptions: SignalSubscription[] = [];
let initialised = false;

let scriptEntriesCache: ScriptEntry[] = [];
let objectTableCache: ObjectEntry[] = [];
let objectDescCache: ObjectDescEntry[] | null = null;

const scriptSignals = scriptObjectSignals();
const scriptEntriesStream = reactiveContext.signalToObservable(
  scriptSignals.scriptEntries,
  () => {
    refreshScriptEntriesCache();
    return scriptEntriesCache;
  }
);
const objectTableStream = reactiveContext.signalToObservable(
  scriptSignals.objectTable,
  () => {
    refreshObjectTableCache();
    return objectTableCache;
  }
);
const objectDescStream = reactiveContext.signalToObservable(
  scriptSignals.objectDesc,
  () => {
    refreshObjectDescCache();
    return objectDescCache;
  }
);

function teardown() {
  subscriptions.forEach((subscription) => {
    if (!subscription) {
      return;
    }
    if (typeof (subscription as any).unsubscribe === 'function') {
      (subscription as { unsubscribe: () => void }).unsubscribe();
    } else if (typeof subscription === 'function') {
      subscription();
    }
  });
  subscriptions = [];
  initialised = false;
}

function refreshScriptEntriesCache() {
  const latest = scriptSignals.scriptEntries.value;
  if (Array.isArray(latest) && latest.length > 0) {
    scriptEntriesCache = latest;
    return scriptEntriesCache;
  }
  if (worldService && typeof worldService.syncScriptRegisters === 'function') {
    worldService.syncScriptRegisters();
  }
  const refreshed = scriptSignals.scriptEntries.value;
  scriptEntriesCache = Array.isArray(refreshed) ? refreshed : [];
  return scriptEntriesCache;
}

function refreshObjectTableCache() {
  let latest = scriptSignals.objectTable.value;
  if (!Array.isArray(latest) || latest.length === 0) {
    if (worldService && typeof worldService.syncObjectStores === 'function') {
      worldService.syncObjectStores();
    }
    latest = scriptSignals.objectTable.value;
  }
  if (Array.isArray(latest)) {
    objectTableCache = latest;
  } else {
    objectTableCache = [];
  }
  return objectTableCache;
}

function refreshObjectDescCache() {
  const latest = scriptSignals.objectDesc.value;
  if (typeof latest !== 'undefined') {
    objectDescCache = Array.isArray(latest) ? (latest as ObjectDescEntry[]) : null;
    return objectDescCache;
  }
  if (worldService && typeof worldService.syncObjectStores === 'function') {
    worldService.syncObjectStores();
  }
  const refreshed = scriptSignals.objectDesc.value;
  objectDescCache = Array.isArray(refreshed) ? (refreshed as ObjectDescEntry[]) : null;
  return objectDescCache;
}

function notify(event: ScriptObjectEvent) {
  listeners.forEach((listener) => {
    if (typeof listener !== 'function') {
      return;
    }
    try {
      listener(event);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[scriptObjectAdapter] listener error', err);
      }
    }
  });
}

function ensureInitialised() {
  if (initialised) {
    return;
  }
  refreshScriptEntriesCache();
  refreshObjectTableCache();
  refreshObjectDescCache();

  const signals = scriptObjectSignals();
  subscriptions = [
    signals.scriptEntries.subscribe((value: ScriptEntry[]) => {
      if (Array.isArray(value) && value !== scriptEntriesCache) {
        const previous = scriptEntriesCache;
        scriptEntriesCache = value;
        notify({ type: 'scriptEntries', value, previous });
      }
    }),
    signals.objectTable.subscribe((value: ObjectTable) => {
      if (Array.isArray(value) && value !== objectTableCache) {
        const previous = objectTableCache;
        objectTableCache = value;
        notify({ type: 'objectTable', value, previous });
      }
    }),
    signals.objectDesc.subscribe((value: ObjectDesc | null) => {
      if (value !== objectDescCache) {
        const previous = objectDescCache;
        objectDescCache = Array.isArray(value) ? (value as ObjectDescEntry[]) : null;
        notify({ type: 'objectDesc', value: objectDescCache, previous });
      }
    })
  ];

  initialised = true;
}

function subscribe(listener: (event: ScriptObjectEvent) => void) {
  ensureInitialised();
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  listener({
    type: 'snapshot',
    scriptEntries: scriptEntriesCache,
    objectTable: objectTableCache,
    objectDesc: objectDescCache
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      teardown();
      scriptEntriesCache = [];
      objectTableCache = [];
      objectDescCache = null;
    }
  };
}

function getScriptEntries() {
  ensureInitialised();
  return scriptEntriesCache;
}

function getScriptEntry(index: number) {
  const entries = getScriptEntries();
  if (!entries || typeof index !== 'number') {
    return null;
  }
  return entries[index] || null;
}

function getObjectTable() {
  ensureInitialised();
  return objectTableCache;
}

function getObjectEntry(id: number) {
  ensureInitialised();
  if (!Array.isArray(objectTableCache)) {
    return null;
  }
  return objectTableCache[id] || null;
}

function getObjectDesc() {
  ensureInitialised();
  return objectDescCache;
}

function getObjectDescEntry(id: number) {
  const table = getObjectDesc();
  if (!table) {
    return null;
  }
  for (let i = 0; i < table.length; i++) {
    const entry = table[i];
    if (entry && entry.id === id) {
      return entry;
    }
  }
  return null;
}

export const scriptEntries$ = createAdapterObservable({
  name: 'scriptObjects.entries',
  observe: () => {
    ensureInitialised();
    return scriptEntriesStream;
  },
  getValue: getScriptEntries
});

export const objectTable$ = createAdapterObservable({
  name: 'scriptObjects.objectTable',
  observe: () => {
    ensureInitialised();
    return objectTableStream;
  },
  getValue: getObjectTable
});

export const objectDesc$ = createAdapterObservable({
  name: 'scriptObjects.objectDesc',
  observe: () => {
    ensureInitialised();
    return objectDescStream;
  },
  getValue: getObjectDesc
});

function dispose() {
  notify({ type: 'disposed' });
  teardown();
  listeners.clear();
  scriptEntriesCache = [];
  objectTableCache = [];
  objectDescCache = null;
}

export function getRuntimeBinding() {
  return {entries:scriptEntriesCache,objects:objectTableCache,descriptions:objectDescCache,getScriptEntry:Object.getOwnPropertyDescriptor(scriptObjectAdapter,'getScriptEntry')?.value,getScriptGetter:Object.getOwnPropertyDescriptor(scriptObjectAdapter,'getScriptEntry')?.get,getObjectEntry:Object.getOwnPropertyDescriptor(scriptObjectAdapter,'getObjectEntry')?.value,getObjectGetter:Object.getOwnPropertyDescriptor(scriptObjectAdapter,'getObjectEntry')?.get,getRuntimeBinding:Object.getOwnPropertyDescriptor(scriptObjectAdapter,'getRuntimeBinding')?.value,getRuntimeGetter:Object.getOwnPropertyDescriptor(scriptObjectAdapter,'getRuntimeBinding')?.get};
}

const scriptObjectAdapter = {
  getRuntimeBinding,
  subscribe,
  getScriptEntries,
  getScriptEntry,
  getObjectTable,
  getObjectEntry,
  getObjectDesc,
  getObjectDescEntry,
  scriptEntries$,
  objectTable$,
  objectDesc$,
  dispose
};

export {
  getScriptEntries as getScriptEntriesValue,
  getObjectTable as getObjectTableValue,
  getObjectDesc as getObjectDescValue
};

export default scriptObjectAdapter;
