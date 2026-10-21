import reactiveContext from '../reactive-context.js';

type PartyEntry = Record<string, unknown> | null;
type TrailEntry = Record<string, unknown> | null;
type UpdateOptions = { emitEvent?: boolean; source?: string };

const PARTY_SIGNAL_KEY = 'world.party.members';
const TRAIL_SIGNAL_KEY = 'world.party.trail';
const FOLLOWER_COUNT_SIGNAL_KEY = 'world.party.followerCount';

let partySubject: any = null;
let trailSubject: any = null;
let followerCountSubject: any = null;

function cloneStructured(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneStructured(entry));
  }
  if (ArrayBuffer.isView(value) && typeof (value as ArrayBufferView & { slice?: () => ArrayBufferView }).slice === 'function') {
    return (value as ArrayBufferView & { slice: () => ArrayBufferView }).slice();
  }
  if (typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>).forEach((key) => {
      clone[key] = cloneStructured((value as Record<string, unknown>)[key]);
    });
    return clone;
  }
  return value;
}

function normaliseParty(value: unknown): PartyEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((member) => {
    if (!member || typeof member !== 'object') {
      return member ? { ...(member as Record<string, unknown>) } : null;
    }
    return cloneStructured(member) as PartyEntry;
  });
}

function normaliseTrail(value: unknown): TrailEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((step) => {
    if (!step || typeof step !== 'object') {
      return step ? { ...(step as Record<string, unknown>) } : null;
    }
    return cloneStructured(step) as TrailEntry;
  });
}

function ensurePartySignal(initialValue: PartyEntry[] = []) {
  return reactiveContext.ensureSignal(PARTY_SIGNAL_KEY, normaliseParty(initialValue));
}

function ensureTrailSignal(initialValue: TrailEntry[] = []) {
  return reactiveContext.ensureSignal(TRAIL_SIGNAL_KEY, normaliseTrail(initialValue));
}

function ensureFollowerSignal(initialValue = 0) {
  const fallback = Number.isFinite(initialValue) ? Math.max(0, Math.trunc(initialValue)) : 0;
  return reactiveContext.ensureSignal(FOLLOWER_COUNT_SIGNAL_KEY, fallback);
}

function ensurePartySubject(initialValue: PartyEntry[] = []) {
  if (!partySubject || partySubject.closed || partySubject.isStopped) {
    const signal = ensurePartySignal(initialValue);
    partySubject = reactiveContext.createBehaviorStream(signal.value, { name: 'partyTrail.party$' });
  }
  return partySubject;
}

function ensureTrailSubject(initialValue: TrailEntry[] = []) {
  if (!trailSubject || trailSubject.closed || trailSubject.isStopped) {
    const signal = ensureTrailSignal(initialValue);
    trailSubject = reactiveContext.createBehaviorStream(signal.value, { name: 'partyTrail.trail$' });
  }
  return trailSubject;
}

function ensureFollowerCountSubject(initialValue = 0) {
  if (!followerCountSubject || followerCountSubject.closed || followerCountSubject.isStopped) {
    const signal = ensureFollowerSignal(initialValue);
    followerCountSubject = reactiveContext.createBehaviorStream(signal.value, { name: 'partyTrail.followers$' });
  }
  return followerCountSubject;
}

function deepEqual(a: unknown, b: unknown) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (err) {
    return a === b;
  }
}

export function partyTrailSignals() {
  return {
    party: ensurePartySignal([]),
    trail: ensureTrailSignal([]),
    followerCount: ensureFollowerSignal(0)
  };
}

export function getPartyValue(fallback: PartyEntry[] = []) {
  return normaliseParty(ensurePartySignal(fallback).value);
}

export function partyStream(initialValue: PartyEntry[] = []) {
  const baseline = normaliseParty(
    Array.isArray(initialValue) ? initialValue : ensurePartySignal([]).value
  );
  return ensurePartySubject(baseline);
}

export function updatePartyValue(value: PartyEntry[], options: UpdateOptions = {}) {
  const resolved = normaliseParty(value);
  const signal = ensurePartySignal([]);
  const previous = signal.value;
  const changed = !deepEqual(previous, resolved);
  reactiveContext.setSignal(PARTY_SIGNAL_KEY, resolved);
  const subject = ensurePartySubject(resolved);
  if (subject && typeof subject.getValue === 'function') {
    const currentSubjectValue = subject.getValue();
    if (!deepEqual(currentSubjectValue, resolved)) {
      subject.next(resolved);
    }
  } else if (subject && typeof subject.next === 'function') {
    subject.next(resolved);
  }
  if (changed && options.emitEvent !== false) {
    reactiveContext.rootEvent$.next({
      type: 'world/party/changed',
      value: resolved,
      previous,
      source: options.source || 'worldService'
    });
  }
  return resolved;
}

export function mutatePartyValue(mutator: (current: PartyEntry[]) => PartyEntry[] | void, options: UpdateOptions = {}) {
  const current = normaliseParty(ensurePartySignal([]).value);
  const next = typeof mutator === 'function' ? mutator(cloneStructured(current) as PartyEntry[]) : current;
  return updatePartyValue(typeof next === 'undefined' ? current : next, options);
}

export function getTrailValue(fallback: TrailEntry[] = []) {
  return normaliseTrail(ensureTrailSignal(fallback).value);
}

export function trailStream(initialValue: TrailEntry[] = []) {
  const baseline = normaliseTrail(
    Array.isArray(initialValue) ? initialValue : ensureTrailSignal([]).value
  );
  return ensureTrailSubject(baseline);
}

export function updateTrailValue(value: TrailEntry[], options: UpdateOptions = {}) {
  const resolved = normaliseTrail(value);
  const signal = ensureTrailSignal([]);
  const previous = signal.value;
  const changed = !deepEqual(previous, resolved);
  reactiveContext.setSignal(TRAIL_SIGNAL_KEY, resolved);
  const subject = ensureTrailSubject(resolved);
  if (subject && typeof subject.getValue === 'function') {
    const currentSubjectValue = subject.getValue();
    if (!deepEqual(currentSubjectValue, resolved)) {
      subject.next(resolved);
    }
  } else if (subject && typeof subject.next === 'function') {
    subject.next(resolved);
  }
  if (changed && options.emitEvent !== false) {
    reactiveContext.rootEvent$.next({
      type: 'world/trail/changed',
      value: resolved,
      previous,
      source: options.source || 'worldService'
    });
  }
  return resolved;
}

export function mutateTrailValue(mutator: (current: TrailEntry[]) => TrailEntry[] | void, options: UpdateOptions = {}) {
  const current = normaliseTrail(ensureTrailSignal([]).value);
  const next = typeof mutator === 'function' ? mutator(cloneStructured(current) as TrailEntry[]) : current;
  return updateTrailValue(typeof next === 'undefined' ? current : next, options);
}

export function getFollowerCountValue(fallback = 0) {
  return ensureFollowerSignal(fallback).value;
}

export function followerCountStream(initialValue = 0) {
  const baseline = Number.isFinite(initialValue)
    ? Math.max(0, Math.trunc(initialValue))
    : ensureFollowerSignal(0).value;
  return ensureFollowerCountSubject(baseline);
}

export function updateFollowerCountValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const signal = ensureFollowerSignal(0);
  const previous = signal.value;
  reactiveContext.setSignal(FOLLOWER_COUNT_SIGNAL_KEY, resolved);
  const subject = ensureFollowerCountSubject(resolved);
  if (subject && typeof subject.getValue === 'function') {
    const currentSubjectValue = subject.getValue();
    if (currentSubjectValue !== resolved) {
      subject.next(resolved);
    }
  } else if (subject && typeof subject.next === 'function') {
    subject.next(resolved);
  }
  if (previous !== resolved && options.emitEvent !== false) {
    reactiveContext.rootEvent$.next({
      type: 'world/followerCount/changed',
      value: resolved,
      previous,
      source: options.source || 'worldService'
    });
  }
  return resolved;
}

export function resetPartyTrailSlice() {
  if (partySubject && typeof partySubject.complete === 'function') {
    partySubject.complete();
  }
  if (trailSubject && typeof trailSubject.complete === 'function') {
    trailSubject.complete();
  }
  if (followerCountSubject && typeof followerCountSubject.complete === 'function') {
    followerCountSubject.complete();
  }
  partySubject = null;
  trailSubject = null;
  followerCountSubject = null;
  reactiveContext.setSignal(PARTY_SIGNAL_KEY, []);
  reactiveContext.setSignal(TRAIL_SIGNAL_KEY, []);
  reactiveContext.setSignal(FOLLOWER_COUNT_SIGNAL_KEY, 0);
}
