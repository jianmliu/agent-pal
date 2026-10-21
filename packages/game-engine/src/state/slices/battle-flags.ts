import reactiveContext from '../reactive-context.js';

const REPEAT_FLAG_KEY = 'battle.flags.repeat';
const FORCE_FLAG_KEY = 'battle.flags.force';
const FLEE_FLAG_KEY = 'battle.flags.flee';
const RESULT_KEY = 'battle.flags.result';
const PHASE_KEY = 'battle.flags.phase';

type UpdateOptions = { emitEvent?: boolean; source?: string; eventType?: string };

function ensureBooleanSignal(key: string, initialValue = false) {
  return reactiveContext.ensureSignal(key, !!initialValue);
}

function ensureNumberSignal(key: string, initialValue = 0) {
  const value = Number.isFinite(initialValue) ? initialValue : 0;
  return reactiveContext.ensureSignal(key, value);
}

function emitChange(type: string, value: unknown, previous: unknown, source?: string) {
  reactiveContext.rootEvent$.next({
    type,
    value,
    previous,
    source
  });
}

function setSignalValue(key: string, value: boolean | number, options: UpdateOptions = {}) {
  const previous = reactiveContext.getSignal(key, value);
  const signal = typeof value === 'boolean'
    ? ensureBooleanSignal(key, previous as boolean)
    : ensureNumberSignal(key, previous as number);
  if (signal.value !== value) {
    reactiveContext.setSignal(key, value as any);
    if (options.emitEvent !== false) {
      emitChange(options.eventType || `battle/flags/${key}/changed`, value, previous, options.source || 'battleService');
    }
  }
  return value;
}

export function battleFlagSignals() {
  return {
    repeat: ensureBooleanSignal(REPEAT_FLAG_KEY, false),
    force: ensureBooleanSignal(FORCE_FLAG_KEY, false),
    flee: ensureBooleanSignal(FLEE_FLAG_KEY, false),
    result: ensureNumberSignal(RESULT_KEY, 0),
    phase: ensureNumberSignal(PHASE_KEY, 0)
  };
}

export function updateRepeatFlag(value: boolean, options: UpdateOptions = {}) {
  return setSignalValue(REPEAT_FLAG_KEY, !!value, { ...options, eventType: 'battle/flags/repeatChanged' });
}

export function updateForceFlag(value: boolean, options: UpdateOptions = {}) {
  return setSignalValue(FORCE_FLAG_KEY, !!value, { ...options, eventType: 'battle/flags/forceChanged' });
}

export function updateFleeFlag(value: boolean, options: UpdateOptions = {}) {
  return setSignalValue(FLEE_FLAG_KEY, !!value, { ...options, eventType: 'battle/flags/fleeChanged' });
}

export function updateBattleResultValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? value : 0;
  return setSignalValue(RESULT_KEY, resolved, { ...options, eventType: 'battle/flags/resultChanged' });
}

export function updateBattlePhaseValue(value: number, options: UpdateOptions = {}) {
  const resolved = Number.isFinite(value) ? value : 0;
  return setSignalValue(PHASE_KEY, resolved, { ...options, eventType: 'battle/flags/phaseChanged' });
}

export function updateBattleFlagsFromState(state: any, options: UpdateOptions = {}) {
  const source = options.source || 'battleService:syncFlags';
  if (!state) {
    updateRepeatFlag(false, { emitEvent: options.emitEvent, source });
    updateForceFlag(false, { emitEvent: options.emitEvent, source });
    updateFleeFlag(false, { emitEvent: options.emitEvent, source });
    updateBattleResultValue(0, { emitEvent: options.emitEvent, source });
    updateBattlePhaseValue(0, { emitEvent: options.emitEvent, source });
    return;
  }
  updateRepeatFlag(!!(state as any).repeat, { emitEvent: options.emitEvent, source });
  updateForceFlag(!!(state as any).force, { emitEvent: options.emitEvent, source });
  updateFleeFlag(!!(state as any).flee, { emitEvent: options.emitEvent, source });
  updateBattleResultValue((state as any).battleResult, { emitEvent: options.emitEvent, source });
  updateBattlePhaseValue((state as any).phase, { emitEvent: options.emitEvent, source });
}

export function resetBattleFlagsSlice() {
  reactiveContext.setSignal(REPEAT_FLAG_KEY, false);
  reactiveContext.setSignal(FORCE_FLAG_KEY, false);
  reactiveContext.setSignal(FLEE_FLAG_KEY, false);
  reactiveContext.setSignal(RESULT_KEY, 0);
  reactiveContext.setSignal(PHASE_KEY, 0);
}
