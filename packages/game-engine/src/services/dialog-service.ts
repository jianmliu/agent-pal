import reactiveContext from '../state/reactive-context.js';
import { writeDialogState } from '../state/ecs-context.js';

const MAX_HISTORY = 20;

const currentLineSignal = reactiveContext.ensureSignal('dialog.currentLine', null as DialogLine | null);
const historySignal = reactiveContext.ensureSignal('dialog.history', [] as DialogLine[]);
const statusSignal = reactiveContext.ensureSignal('dialog.status', {
  active: false,
  awaitingInput: false,
  needsAdvance: false,
  lastUpdated: null as number | null,
  position: null as number | null,
  lastMsgId: null as number | null,
  reason: null as string | null
});
const choiceSignal = reactiveContext.ensureSignal('dialog.choice', null as DialogChoice | null);
const injectedLines: DialogLine[] = [];

export interface DialogLine {
  text: string;
  msgId: number | null;
  position: number | null;
  line: number | null;
  timestamp: number;
  scriptEntry: number | null;
  eventObjectId: number | null;
  sceneId: number | null;
  targetEventId?: number | null;
  targetSceneId?: number | null;
  expiresAt?: number | null;
  source: string | null;
  metadata: unknown;
  buffer?: Uint8Array | null;
  skipOriginal?: boolean;
}

export interface DialogChoiceOption {
  label?: string;
  value?: unknown;
}

export interface DialogChoice {
  id?: number;
  type?: string;
  scriptEntry?: number;
  eventObjectId?: number;
  options?: DialogChoiceOption[];
  resolvedValue?: unknown;
  resolvedIndex?: number | null;
  resolvedLabel?: string | null;
  label?: string | null;
  awaitingInput?: boolean;
}

function clearInjectedLines(predicate?: (entry: DialogLine) => boolean) {
  if (!injectedLines.length) {
    return;
  }
  if (typeof predicate !== 'function') {
    injectedLines.length = 0;
    return;
  }
  for (let i = injectedLines.length - 1; i >= 0; i--) {
    const entry = injectedLines[i];
    let shouldRemove = false;
    try {
      shouldRemove = predicate(entry) === true;
    } catch (err) {
      shouldRemove = true;
    }
    if (shouldRemove) {
      injectedLines.splice(i, 1);
    }
  }
}

let pendingMetadata: Partial<DialogLine> | null = null;
let choiceCounter = 0;

function now() {
  return Date.now();
}

function normalizeLine(payload: Partial<DialogLine> = {}): DialogLine {
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  return {
    text,
    msgId: Number.isFinite(payload.msgId as number) ? Math.trunc(payload.msgId as number) : null,
    position: payload.position ?? null,
    line: Number.isFinite(payload.line as number) ? Math.trunc(payload.line as number) : null,
    timestamp: payload.timestamp ?? now(),
    scriptEntry: Number.isFinite(payload.scriptEntry as number) ? Math.trunc(payload.scriptEntry as number) : null,
    eventObjectId: Number.isFinite(payload.eventObjectId as number) ? Math.trunc(payload.eventObjectId as number) : null,
    sceneId: Number.isFinite(payload.sceneId as number) ? Math.trunc(payload.sceneId as number) : null,
    targetEventId: Number.isFinite(payload.targetEventId as number) ? Math.trunc(payload.targetEventId as number) : null,
    targetSceneId: Number.isFinite(payload.targetSceneId as number) ? Math.trunc(payload.targetSceneId as number) : null,
    expiresAt: Number.isFinite(payload.expiresAt as number) ? Math.trunc(payload.expiresAt as number) : null,
    source: (payload.source as string) || null,
    metadata: payload.metadata ?? null,
    buffer: payload.buffer ?? null,
    skipOriginal: payload.skipOriginal ?? false
  };
}

function pushHistory(entry: DialogLine) {
  if (!entry || !entry.text) {
    return;
  }
  const history = Array.isArray(historySignal.value) ? historySignal.value.slice(-MAX_HISTORY + 1) : [];
  history.push(entry);
  historySignal.value = history;
}

function consumePendingMetadata() {
  const metadata = pendingMetadata;
  pendingMetadata = null;
  return metadata || null;
}

function clampIndex(index: number | null | undefined, length: number) {
  if (!Number.isFinite(index as number)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(length - 1, Math.trunc(index as number)));
  return Number.isFinite(clamped) ? clamped : null;
}

function getOptions(choice: DialogChoice | null) {
  if (!choice) {
    return [];
  }
  return Array.isArray(choice.options) ? choice.options : [];
}

function deriveSelectionIndex(choice: DialogChoice | null, resolvedValue: unknown, fallbackIndex: number | null | undefined) {
  const options = getOptions(choice);
  if (options.length === 0) {
    return null;
  }
  if (fallbackIndex != null) {
    return clampIndex(fallbackIndex, options.length);
  }
  if (resolvedValue !== undefined) {
    const match = options.findIndex((entry) => entry && entry.value === resolvedValue);
    if (match >= 0) {
      return match;
    }
  }
  return null;
}

function deriveSelectionLabel(choice: DialogChoice | null, index: number | null, resolvedValue: unknown, explicitLabel?: string | null) {
  if (explicitLabel) {
    return explicitLabel;
  }
  const options = getOptions(choice);
  if (index != null && options[index] && typeof options[index].label === 'string') {
    return options[index].label.trim();
  }
  if (typeof resolvedValue === 'string') {
    return resolvedValue;
  }
  if (typeof resolvedValue === 'boolean') {
    return resolvedValue ? 'YES' : 'NO';
  }
  if (typeof resolvedValue === 'number') {
    const idx = clampIndex(resolvedValue, options.length) ?? Math.trunc(resolvedValue);
    if (idx != null && options[idx] && typeof options[idx].label === 'string') {
      return options[idx].label!.trim();
    }
    return `Slot ${resolvedValue}`;
  }
  return null;
}

function updateStatus(patch: Partial<typeof statusSignal.value> = {}, tag = '') {
  const previous = statusSignal.value || {};
  const next = Object.assign({}, previous, patch, { lastUpdated: now() });
  // Verbose dialog status logging removed to avoid console spam.
  statusSignal.value = next;
  writeDialogState({
    active: !!next.active,
    awaitingInput: !!next.awaitingInput,
    needsAdvance: !!next.needsAdvance,
    lastMsgId: Number.isFinite(next.lastMsgId as number) ? (next.lastMsgId as number) : null,
    position: Number.isFinite(next.position as number) ? (next.position as number) : null
  });
  return next;
}

function publishLine(payload: Partial<DialogLine> = {}) {
  const metadata = consumePendingMetadata();
  // Preserve the pending metadata ON the line (entry.metadata) — flattening it
  // into top-level fields loses everything normalizeLine doesn't model (most
  // critically the `injected` flag of AI-injected lines: without it on the
  // published line, the dialog-perception mapper re-attributes the NPC's own
  // reply back to it → a self-sustaining talk loop).
  const mergedMetadata = metadata || payload.metadata
    ? Object.assign({}, metadata || {}, (payload.metadata as Record<string, unknown>) || {})
    : null;
  const entry = normalizeLine(Object.assign({}, metadata || {}, payload, mergedMetadata ? { metadata: mergedMetadata } : {}));
  currentLineSignal.value = entry;
  pushHistory(entry);
  choiceSignal.value = null;
  updateStatus({
    active: true,
    awaitingInput: (payload as any).awaitingInput === true,
    needsAdvance: true,
    position: entry.position ?? (metadata && (metadata as any).position) ?? statusSignal.value?.position ?? null,
    lastMsgId: entry.msgId
  });
  return entry;
}

function clearDialog(reason = 'unknown') {
  currentLineSignal.value = null;
  updateStatus({
    active: false,
    awaitingInput: false,
    needsAdvance: false,
    reason
  }, 'clearDialog');
  if (reason === 'endDialog' || reason === 'clearDialog') {
    clearInjectedLines();
  }
}

function setPendingLineMetadata(metadata: Partial<DialogLine> | null) {
  if (!metadata) {
    pendingMetadata = null;
    return;
  }
  pendingMetadata = Object.assign({}, metadata);
}

function setAwaitingInput(isAwaiting: boolean, context: { position?: number | null } = {}) {
  updateStatus({
    awaitingInput: !!isAwaiting,
    active: isAwaiting ? true : statusSignal.value?.active,
    needsAdvance: isAwaiting ? true : statusSignal.value?.needsAdvance,
    position: context.position ?? statusSignal.value?.position ?? null
  }, isAwaiting ? 'awaiting:true' : 'awaiting:false');
}

function publishChoice(choice: DialogChoice | null) {
  if (!choice) {
    choiceSignal.value = null;
    return null;
  }
  const options = getOptions(choice);
  const payload = Object.assign({}, choice, {
    id: ++choiceCounter,
    resolvedIndex: deriveSelectionIndex(choice, (choice as any).value, (choice as any).resolvedIndex ?? (choice as any).defaultIndex ?? null),
    resolvedValue: (choice as any).value ?? (choice.resolvedIndex != null && options[choice.resolvedIndex] ? options[choice.resolvedIndex].value : null),
    resolvedLabel: deriveSelectionLabel(choice, (choice as any).resolvedIndex ?? null, (choice as any).resolvedValue, (choice as any).label)
  });
  choiceSignal.value = payload as DialogChoice;
  updateStatus({
    active: true,
    awaitingInput: true,
    needsAdvance: false,
    lastMsgId: statusSignal.value?.lastMsgId ?? null
  }, 'publishChoice');
  return payload;
}

function resolveChoice(value: unknown, index?: number | null, label?: string | null) {
  const choice = choiceSignal.value as DialogChoice | null;
  const resolvedIndex = deriveSelectionIndex(choice, value, index ?? null);
  const resolvedLabel = deriveSelectionLabel(choice, resolvedIndex, value, label ?? (choice as any)?.label ?? null);
  const payload = choice ? Object.assign({}, choice, {
    resolvedIndex,
    resolvedValue: value,
    resolvedLabel
  }) : null;
  choiceSignal.value = payload as DialogChoice | null;
  updateStatus({
    active: true,
    awaitingInput: false,
    needsAdvance: true
  }, 'resolveChoice');
  return payload;
}

function injectLine(payload: Partial<DialogLine>) {
  const entry = normalizeLine(payload);
  injectedLines.push(entry);
  return entry;
}

type QueueInjectedLinePayload = Partial<DialogLine> & {
  targetEventId?: number | null;
  targetSceneId?: number | null;
  ttlMs?: number | null;
};

function queueInjectedLine(payload: QueueInjectedLinePayload = {}) {
  const { targetEventId, targetSceneId, ttlMs, ...linePayload } = payload;
  const eventObjectId = Number.isFinite((linePayload as DialogLine).eventObjectId as number)
    ? Math.trunc((linePayload as DialogLine).eventObjectId as number)
    : (Number.isFinite(targetEventId as number) ? Math.trunc(targetEventId as number) : null);
  const sceneId = Number.isFinite((linePayload as DialogLine).sceneId as number)
    ? Math.trunc((linePayload as DialogLine).sceneId as number)
    : (Number.isFinite(targetSceneId as number) ? Math.trunc(targetSceneId as number) : null);
  const ttl = Number.isFinite(ttlMs as number) ? Math.max(0, Math.trunc(ttlMs as number)) : 0;
  const entry = injectLine(Object.assign({}, linePayload, {
    eventObjectId,
    sceneId,
    targetEventId: eventObjectId,
    targetSceneId: sceneId,
    expiresAt: ttl > 0 ? now() + ttl : null
  }));
  if (ttl > 0) {
    const clear = () => clearInjectedLines((line) => line === entry);
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(clear, ttl);
    } else if (typeof setTimeout === 'function') {
      setTimeout(clear, ttl);
    }
  }
  return entry;
}

function hasInjectedLine(predicate?: (entry: DialogLine) => boolean) {
  if (!injectedLines.length) {
    return false;
  }
  if (typeof predicate !== 'function') {
    return true;
  }
  return injectedLines.some((entry) => {
    try {
      return predicate(entry) === true;
    } catch (err) {
      return true;
    }
  });
}

type InjectContext = {
  eventObjectId?: number | null;
  sceneId?: number | null;
};

function consumeInjectedLine(
  predicateOrBuffer?: ((entry: DialogLine) => boolean) | Uint8Array | null,
  context?: InjectContext
) {
  if (!injectedLines.length) {
    return null;
  }
  const timestamp = now();
  for (let i = injectedLines.length - 1; i >= 0; i--) {
    const entry = injectedLines[i];
    if (Number.isFinite(entry.expiresAt as number) && (entry.expiresAt as number) <= timestamp) {
      injectedLines.splice(i, 1);
    }
  }
  if (typeof predicateOrBuffer === 'function') {
    for (let i = 0; i < injectedLines.length; i++) {
      const entry = injectedLines[i];
      let shouldConsume = false;
      try {
        shouldConsume = predicateOrBuffer(entry) === true;
      } catch (err) {
        shouldConsume = true;
      }
      if (shouldConsume) {
        injectedLines.splice(i, 1);
        return entry;
      }
    }
    return null;
  }
  const eventObjectId = context && Number.isFinite(context.eventObjectId as number)
    ? Math.trunc(context.eventObjectId as number)
    : null;
  const sceneId = context && Number.isFinite(context.sceneId as number)
    ? Math.trunc(context.sceneId as number)
    : null;
  if (eventObjectId != null || sceneId != null) {
    for (let i = 0; i < injectedLines.length; i++) {
      const entry = injectedLines[i];
      if ((eventObjectId != null && entry.eventObjectId === eventObjectId) ||
          (sceneId != null && entry.sceneId === sceneId)) {
        injectedLines.splice(i, 1);
        return entry;
      }
    }
  }
  return injectedLines.shift() || null;
}

function getStatus() {
  return statusSignal.value || {};
}

function getHistory() {
  return historySignal.value || [];
}

function getChoice() {
  return choiceSignal.value || null;
}

function getCurrentLine() {
  return currentLineSignal.value || null;
}

const nativeBindingDescriptor=Object.getOwnPropertyDescriptor,nativeBindingPrototype=Object.getPrototypeOf;
function dialogBindingData(value:any,key:string):any {const d=nativeBindingDescriptor(value,key);if(!d||!('value'in d))throw new Error('Dialog runtime binding requires actual data field '+key);return d.value;}
function dialogBindingMethod(value:any,key:string):PropertyDescriptor|undefined {for(let node=value;node;node=nativeBindingPrototype(node)){const d=nativeBindingDescriptor(node,key);if(d)return d;}return undefined;}
/** RxSignal wraps one actual BehaviorSubject. Reading its own _value has no
 * getValue/Signal.value callbacks; this is observation, never a signal write. */
export function getRuntimeBinding() {
  const signals=[statusSignal,currentLineSignal,historySignal,choiceSignal];
  const rows=signals.map(signal=>{const subject=dialogBindingData(signal,'_subject'),value=dialogBindingData(subject,'_value'),property=dialogBindingMethod(signal,'value'),get=dialogBindingMethod(subject,'getValue'),next=dialogBindingMethod(subject,'next'),closed=dialogBindingMethod(subject,'_throwIfClosed');
    if(dialogBindingData(subject,'hasError')||dialogBindingData(subject,'closed'))throw new Error('Dialog runtime subject is unavailable');
    return {value,refs:[subject,property?.get,property?.set,get?.value,get?.get,next?.value,next?.get,closed?.value,closed?.get]};});
  return {status:rows[0].value,current:rows[1].value,history:rows[2].value,choice:rows[3].value,pending:pendingMetadata,injected:injectedLines,signals,signalBindings:rows.flatMap(row=>row.refs),methods:Object.fromEntries(['publishLine','consumePendingMetadata','clearDialog','setAwaitingInput','setPendingLineMetadata','getRuntimeBinding','getStatus','getHistory','getChoice','getCurrentLine','hasInjectedLine'].flatMap(name=>{const d=nativeBindingDescriptor(dialogService,name);return [[name,d?.value],[name+':get',d?.get],[name+':set',d?.set]];}))};
}

const dialogService = {
  getRuntimeBinding,
  publishLine,
  consumePendingMetadata,
  clearDialog,
  clearInjectedLines,
  setAwaitingInput,
  setPendingLineMetadata,
  publishChoice,
  resolveChoice,
  injectLine,
  queueInjectedLine,
  hasInjectedLine,
  consumeInjectedLine,
  getStatus,
  getHistory,
  getChoice,
  getCurrentLine,
  signals: {
    currentLine: currentLineSignal,
    history: historySignal,
    status: statusSignal,
    choice: choiceSignal
  }
};

export default dialogService;
