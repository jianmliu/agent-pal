import { Observable } from 'rxjs';
import {
  partyStream,
  trailStream,
  followerCountStream,
  getPartyValue,
  getTrailValue,
  getFollowerCountValue
} from '../state/slices/party-trail.js';
import stateService from './state-service.js';
import worldService from './world-service';
import { createAdapterObservable } from './adapter-helpers.js';
import { writePlayerState } from '../state/ecs-context.js';

type PartyEntry = {
  playerRole: number;
  x: number;
  y: number;
  frame: number;
  imageOffset: number;
};

type TrailEntry = {
  x: number;
  y: number;
  direction: number;
};

type PartyTrailEvent =
  | { type: 'snapshot'; party: PartyEntry[]; trail: TrailEntry[]; followerCount: number }
  | { type: 'party'; value: PartyEntry[]; previous: PartyEntry[] }
  | { type: 'trail'; value: TrailEntry[]; previous: TrailEntry[] }
  | { type: 'followerCount'; value: number; previous: number }
  | { type: 'disposed' };

type Subscription = { unsubscribe?: () => void } | (() => void);

let initialised = false;
let partyCache: PartyEntry[] = [];
let trailCache: TrailEntry[] = [];
let followerCountCache = 0;
let subscriptions: Subscription[] = [];
const listeners = new Set<(event: PartyTrailEvent) => void>();

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

function toPlainPartyMember(entry: any, index: number): PartyEntry {
  if (!entry || typeof entry !== 'object') {
    return {
      playerRole: typeof index === 'number' ? index : 0,
      x: 0,
      y: 0,
      frame: 0,
      imageOffset: 0
    };
  }
  return {
    playerRole: Number.isFinite(entry.playerRole) ? entry.playerRole : (Number(entry.playerRole) || index || 0),
    x: Number.isFinite(entry.x) ? entry.x : Number(entry.x) || 0,
    y: Number.isFinite(entry.y) ? entry.y : Number(entry.y) || 0,
    frame: Number.isFinite(entry.frame) ? entry.frame : Number(entry.frame) || 0,
    imageOffset: Number.isFinite(entry.imageOffset) ? entry.imageOffset : Number(entry.imageOffset) || 0
  };
}

function toPlainTrailEntry(entry: any): TrailEntry {
  if (!entry || typeof entry !== 'object') {
    return { x: 0, y: 0, direction: 0 };
  }
  return {
    x: Number.isFinite(entry.x) ? entry.x : Number(entry.x) || 0,
    y: Number.isFinite(entry.y) ? entry.y : Number(entry.y) || 0,
    direction: Number.isFinite(entry.direction) ? entry.direction : Number(entry.direction) || 0
  };
}

function refreshPartyCache() {
  const sliceValue = getPartyValue([]);
  console.log('[partyTrailAdapter] refreshPartyCache: sliceValue', {
    isArray: Array.isArray(sliceValue),
    length: sliceValue?.length,
    value: sliceValue
  });

  if (Array.isArray(sliceValue) && sliceValue.length > 0) {
    partyCache = sliceValue.map(toPlainPartyMember);
    console.log('[partyTrailAdapter] refreshPartyCache: using sliceValue', {
      count: partyCache.length,
      first: partyCache[0]
    });
    return partyCache;
  }

  const globalParty = stateService.getGlobal('party');
  console.log('[partyTrailAdapter] refreshPartyCache: globalParty', {
    isArray: Array.isArray(globalParty),
    length: Array.isArray(globalParty) ? globalParty.length : 'not an array',
    value: globalParty
  });

  if (Array.isArray(globalParty) && globalParty.length > 0) {
    partyCache = globalParty.map(toPlainPartyMember);
    console.log('[partyTrailAdapter] refreshPartyCache: using globalParty', {
      count: partyCache.length,
      first: partyCache[0]
    });
    return partyCache;
  }

  if (worldService && typeof worldService.getParty === 'function') {
    const fallback = worldService.getParty();
    console.log('[partyTrailAdapter] refreshPartyCache: fallback', {
      isArray: Array.isArray(fallback),
      length: fallback?.length,
      value: fallback
    });

    if (Array.isArray(fallback) && fallback.length > 0) {
      partyCache = fallback.map(toPlainPartyMember);
      console.log('[partyTrailAdapter] refreshPartyCache: using fallback', {
        count: partyCache.length,
        first: partyCache[0]
      });
      return partyCache;
    }
  }

  console.log('[partyTrailAdapter] refreshPartyCache: no valid party data found, returning empty array');
  partyCache = [];
  return partyCache;
}

function refreshTrailCache() {
  const sliceValue = getTrailValue([]);
  if (Array.isArray(sliceValue) && sliceValue.length > 0) {
    trailCache = sliceValue.map(toPlainTrailEntry);
    return trailCache;
  }
  const globalTrail = stateService.getGlobal('trail');
  if (Array.isArray(globalTrail) && globalTrail.length > 0) {
    trailCache = globalTrail.map(toPlainTrailEntry);
    return trailCache;
  }
  if (worldService && typeof worldService.getTrail === 'function') {
    const fallback = worldService.getTrail();
    if (Array.isArray(fallback) && fallback.length > 0) {
      trailCache = fallback.map(toPlainTrailEntry);
      return trailCache;
    }
  }
  trailCache = [];
  return trailCache;
}

function refreshFollowerCountCache() {
  const sliceValue = getFollowerCountValue(0);
  if (Number.isFinite(sliceValue) && sliceValue >= 0) {
    followerCountCache = sliceValue;
    return followerCountCache;
  }
  const globalCount = stateService.getGlobal('numFollower') as unknown;
  if (typeof globalCount === 'number' && Number.isFinite(globalCount) && globalCount >= 0) {
    followerCountCache = Math.trunc(globalCount);
    return followerCountCache;
  }
  // TODO(rxjs-cleanup): drop worldService fallback once follower slice is always hydrated early.
  if (worldService && typeof worldService.getFollowerCount === 'function') {
    const fallback = worldService.getFollowerCount();
    if (Number.isFinite(fallback) && fallback >= 0) {
      followerCountCache = Math.trunc(fallback);
      return followerCountCache;
    }
  }
  followerCountCache = Math.max(0, Math.trunc(sliceValue || 0));
  return followerCountCache;
}

function notify(event: PartyTrailEvent) {
  if (!event) {
    return;
  }
  listeners.forEach((listener) => {
    if (typeof listener !== 'function') {
      return;
    }
    try {
      listener(event);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[partyTrailAdapter] listener error', err);
      }
    }
  });
  syncPlayerStateToEcs();
}

function ensureInitialised() {
  if (initialised) {
    return;
  }

  const world = worldService as { isInitialised?: () => boolean; init?: () => void };
  if (world && typeof world.isInitialised === 'function' && !world.isInitialised()) {
    if (typeof world.init === 'function') {
      world.init();
    }
  }

  refreshPartyCache();
  refreshTrailCache();
  refreshFollowerCountCache();

  subscriptions = [
    partyStream(partyCache).subscribe(() => {
      const previous = partyCache;
      const next = refreshPartyCache();
      notify({ type: 'party', value: next, previous });
    }),
    trailStream(trailCache).subscribe(() => {
      const previous = trailCache;
      const next = refreshTrailCache();
      notify({ type: 'trail', value: next, previous });
    }),
    followerCountStream(followerCountCache).subscribe((value: number) => {
      const previous = followerCountCache;
      if (Number.isFinite(value)) {
        followerCountCache = value;
      } else {
        refreshFollowerCountCache();
      }
      notify({ type: 'followerCount', value: followerCountCache, previous });
    })
  ];

  initialised = true;
  syncPlayerStateToEcs();
}

function subscribe(listener: (event: PartyTrailEvent) => void) {
  ensureInitialised();
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  listener({
    type: 'snapshot',
    party: partyCache,
    trail: trailCache,
    followerCount: followerCountCache
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      teardown();
    }
  };
}

function syncPlayerStateToEcs() {
  try {
    const leader = Array.isArray(partyCache) && partyCache.length > 0 ? partyCache[0] : null;
    const headTrail = Array.isArray(trailCache) && trailCache.length > 0 ? trailCache[0] : null;
    const fallbackX = headTrail && Number.isFinite(headTrail.x) ? headTrail.x : null;
    const fallbackY = headTrail && Number.isFinite(headTrail.y) ? headTrail.y : null;
    const patch = {
      x: leader && Number.isFinite(leader.x) ? leader.x : fallbackX,
      y: leader && Number.isFinite(leader.y) ? leader.y : fallbackY,
      direction: headTrail && Number.isFinite(headTrail.direction) ? headTrail.direction : null,
      followers: Number.isFinite(followerCountCache) ? followerCountCache : null
    };
    if (
      patch.x == null &&
      patch.y == null &&
      patch.direction == null &&
      patch.followers == null
    ) {
      return;
    }
    writePlayerState(patch);
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[partyTrailAdapter] failed to sync ECS player snapshot', err);
    }
  }
}

function createEventStream<T>(extractor: (event: PartyTrailEvent) => T | undefined) {
  return new Observable<T>((subscriber) => {
    ensureInitialised();
    const snapshot = extractor({
      type: 'snapshot',
      party: partyCache,
      trail: trailCache,
      followerCount: followerCountCache
    });
    if (typeof snapshot !== 'undefined') {
      subscriber.next(snapshot);
    }
    const unsubscribe = subscribe((event) => {
      if (!event) {
        return;
      }
      if (event.type === 'disposed') {
        subscriber.complete();
        return;
      }
      const value = extractor(event);
      if (typeof value !== 'undefined') {
        subscriber.next(value);
      }
    });
    return () => {
      unsubscribe();
    };
  });
}

const partyObservable = createEventStream((event) => {
  if (event.type === 'snapshot') {
    return Array.isArray(event.party) ? event.party : partyCache;
  }
  if (event.type === 'party') {
    return Array.isArray(event.value) ? event.value : partyCache;
  }
  return undefined;
});

const trailObservable = createEventStream((event) => {
  if (event.type === 'snapshot') {
    return Array.isArray(event.trail) ? event.trail : trailCache;
  }
  if (event.type === 'trail') {
    return Array.isArray(event.value) ? event.value : trailCache;
  }
  return undefined;
});

const followerCountObservable = createEventStream((event) => {
  if (event.type === 'snapshot') {
    return Number.isFinite(event.followerCount) ? event.followerCount : followerCountCache;
  }
  if (event.type === 'followerCount') {
    return Number.isFinite(event.value) ? event.value : followerCountCache;
  }
  return undefined;
});

function getPartyState() {
  ensureInitialised();
  return partyCache;
}

function getTrailState() {
  ensureInitialised();
  return trailCache;
}

function getPartyMember(index: number) {
  ensureInitialised();
  if (!Array.isArray(partyCache)) {
    return null;
  }
  return partyCache[index] || null;
}

function getFollowerCount() {
  ensureInitialised();
  return followerCountCache;
}

export const party$ = createAdapterObservable<PartyEntry[]>({
  name: 'partyTrail.party',
  observe: () => {
    ensureInitialised();
    return partyObservable;
  },
  getValue: getPartyState
});

export const trail$ = createAdapterObservable<TrailEntry[]>({
  name: 'partyTrail.trail',
  observe: () => {
    ensureInitialised();
    return trailObservable;
  },
  getValue: getTrailState
});

export const followerCount$ = createAdapterObservable<number>({
  name: 'partyTrail.followers',
  observe: () => {
    ensureInitialised();
    return followerCountObservable;
  },
  getValue: getFollowerCount
});

function dispose() {
  notify({ type: 'disposed' });
  teardown();
  listeners.clear();
  partyCache = [];
  trailCache = [];
  followerCountCache = 0;
}

export default {
  subscribe,
  getPartyState,
  getTrailState,
  getPartyMember,
  getFollowerCount,
  party$,
  trail$,
  followerCount$,
  dispose
};

export {
  getPartyState as getPartyStateValue,
  getTrailState as getTrailStateValue,
  getFollowerCount as getFollowerCountValue
};
