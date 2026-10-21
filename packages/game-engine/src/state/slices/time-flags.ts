import reactiveContext from '../reactive-context.js';

const FRAME_COUNT_SIGNAL_KEY = 'world.time.frameCount';
const NEED_TO_FADE_SIGNAL_KEY = 'world.time.needToFadeIn';
const WAVE_PROGRESSION_SIGNAL_KEY = 'world.time.waveProgression';

type UpdateOptions = { emitEvent?: boolean; source?: string };

let frameCountSubject: any = null;

function normaliseFrame(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return fallback;
}

function ensureFrameSignal(initialValue = 0) {
  return reactiveContext.ensureSignal(FRAME_COUNT_SIGNAL_KEY, normaliseFrame(initialValue, 0));
}

function ensureFrameSubject(initialValue = 0) {
  if (!frameCountSubject || frameCountSubject.closed || frameCountSubject.isStopped) {
    const signal = ensureFrameSignal(initialValue);
    frameCountSubject = reactiveContext.createBehaviorStream(signal.value, { name: 'time.frameCount$' });
  }
  return frameCountSubject;
}

function ensureBooleanSignal(key: string, fallback = false) {
  return reactiveContext.ensureSignal(key, !!fallback);
}

function ensureNumberSignal(key: string, fallback = 0) {
  const resolved = Number.isFinite(fallback) ? Math.trunc(fallback) : 0;
  return reactiveContext.ensureSignal(key, resolved);
}

export function timeFlagSignals() {
  return {
    frameCount: ensureFrameSignal(0),
    needToFadeIn: ensureBooleanSignal(NEED_TO_FADE_SIGNAL_KEY, false),
    waveProgression: ensureNumberSignal(WAVE_PROGRESSION_SIGNAL_KEY, 0)
  };
}

export function frameCountSignal(initialValue = 0) {
  return ensureFrameSignal(initialValue);
}

export function getFrameCountValue(initialValue = 0) {
  return ensureFrameSignal(initialValue).value;
}

export function frameCountStream(initialValue?: number) {
  const baseline = normaliseFrame(
    typeof initialValue === 'undefined' ? getFrameCountValue(0) : initialValue,
    0
  );
  return ensureFrameSubject(baseline);
}

export function updateFrameCount(value: number, options: UpdateOptions = {}) {
  const resolved = normaliseFrame(value, 0);
  const previous = reactiveContext.getSignal(FRAME_COUNT_SIGNAL_KEY, resolved);
  const subject = ensureFrameSubject(previous);
  if (previous === resolved) {
    reactiveContext.setSignal(FRAME_COUNT_SIGNAL_KEY, resolved);
    return resolved;
  }
  reactiveContext.setSignal(FRAME_COUNT_SIGNAL_KEY, resolved);
  if (subject && typeof subject.getValue === 'function') {
    if (subject.getValue() !== resolved) {
      subject.next(resolved);
    }
  } else if (subject && typeof subject.next === 'function') {
    subject.next(resolved);
  }
  if (options.emitEvent !== false) {
    reactiveContext.rootEvent$.next({
      type: 'world/time/frameCountChanged',
      value: resolved,
      previous,
      source: options.source || 'worldService'
    });
  }
  return resolved;
}

export function incrementFrameCount(delta = 1, options: UpdateOptions = {}) {
  const current = reactiveContext.getSignal(FRAME_COUNT_SIGNAL_KEY, 0);
  const adjustment = Number.isFinite(delta) ? delta : 0;
  return updateFrameCount((current as number) + adjustment, options);
}

export function getNeedToFadeInValue(fallback = false) {
  return ensureBooleanSignal(NEED_TO_FADE_SIGNAL_KEY, fallback).value;
}

export function updateNeedToFadeInValue(value: boolean, options: UpdateOptions = {}) {
  const resolved = !!value;
  const previous = reactiveContext.getSignal(NEED_TO_FADE_SIGNAL_KEY, resolved);
  const signal = ensureBooleanSignal(NEED_TO_FADE_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(NEED_TO_FADE_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/time/needToFadeInChanged',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function getWaveProgressionValue(fallback = 0) {
  return ensureNumberSignal(WAVE_PROGRESSION_SIGNAL_KEY, fallback).value;
}

export function updateWaveProgressionValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
  const previous = reactiveContext.getSignal(WAVE_PROGRESSION_SIGNAL_KEY, resolved);
  const signal = ensureNumberSignal(WAVE_PROGRESSION_SIGNAL_KEY, previous);
  if (signal.value !== resolved) {
    reactiveContext.setSignal(WAVE_PROGRESSION_SIGNAL_KEY, resolved);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: 'world/time/waveProgressionChanged',
        value: resolved,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return resolved;
}

export function resetFrameCountSlice(defaultValue = 0) {
  if (frameCountSubject && typeof frameCountSubject.complete === 'function') {
    frameCountSubject.complete();
  }
  frameCountSubject = null;
  reactiveContext.setSignal(FRAME_COUNT_SIGNAL_KEY, normaliseFrame(defaultValue, 0));
}

export function resetTimeFlagSlice() {
  resetFrameCountSlice(0);
  reactiveContext.setSignal(NEED_TO_FADE_SIGNAL_KEY, false);
  reactiveContext.setSignal(WAVE_PROGRESSION_SIGNAL_KEY, 0);
}
