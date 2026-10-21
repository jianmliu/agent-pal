import reactiveContext from '../reactive-context.js';

const AUTO_BATTLE_SIGNAL_KEY = 'world.autoBattle.flag';

type UpdateOptions = { emitEvent?: boolean; source?: string };

let autoBattleSubject: any = null;

function ensureAutoBattleSubject(initialValue = false) {
  if (!autoBattleSubject || autoBattleSubject.closed || autoBattleSubject.isStopped) {
    const signal = reactiveContext.ensureSignal(AUTO_BATTLE_SIGNAL_KEY, !!initialValue);
    autoBattleSubject = reactiveContext.createBehaviorStream(signal.value, { name: 'autoBattle$' });
  }
  return autoBattleSubject;
}

export function autoBattleSignal(initialValue = false) {
  return reactiveContext.ensureSignal(AUTO_BATTLE_SIGNAL_KEY, !!initialValue);
}

export function getAutoBattleValue(initialValue = false) {
  return autoBattleSignal(initialValue).value;
}

export function autoBattleStream(initialValue?: boolean) {
  const baseline = typeof initialValue === 'undefined' ? getAutoBattleValue(false) : !!initialValue;
  return ensureAutoBattleSubject(baseline);
}

export function updateAutoBattle(value: boolean, options: UpdateOptions = {}) {
  const resolved = !!value;
  const previous = reactiveContext.getSignal(AUTO_BATTLE_SIGNAL_KEY, resolved);
  const subject = ensureAutoBattleSubject(previous);
  if (previous === resolved) {
    reactiveContext.setSignal(AUTO_BATTLE_SIGNAL_KEY, resolved);
    return resolved;
  }
  reactiveContext.setSignal(AUTO_BATTLE_SIGNAL_KEY, resolved);
  if (subject && typeof subject.getValue === 'function') {
    if (subject.getValue() !== resolved) {
      subject.next(resolved);
    }
  } else if (subject && typeof subject.next === 'function') {
    subject.next(resolved);
  }
  if (options.emitEvent !== false) {
    reactiveContext.rootEvent$.next({
      type: 'world/autoBattle/set',
      value: resolved,
      previous,
      source: options.source || 'worldService'
    });
  }
  return resolved;
}

export function resetAutoBattleSlice(defaultValue = false) {
  if (autoBattleSubject && typeof autoBattleSubject.complete === 'function') {
    autoBattleSubject.complete();
  }
  autoBattleSubject = null;
  reactiveContext.setSignal(AUTO_BATTLE_SIGNAL_KEY, !!defaultValue);
}
