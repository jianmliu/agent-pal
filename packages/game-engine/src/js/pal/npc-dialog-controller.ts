import co from './co';
import ui from './ui';
import { dialogService } from '../../services/index';

declare const DialogPosition: any;
declare const sleep: any;

const DEFAULT_POSITION = typeof DialogPosition !== 'undefined'
  ? DialogPosition.Lower
  : 2;

type DialogOptions = {
  position?: number | string;
  color?: number;
  charFace?: number;
  playingRNG?: boolean;
  autoAdvance?: boolean;
  holdMs?: number;
  debug?: boolean;
  npcId?: number | string;
  metadata?: Record<string, any>;
};

type DialogTask = {
  buffer: Uint8Array;
  options: DialogOptions;
  resolve: (value: boolean) => void;
  reject: (reason?: unknown) => void;
};

const queue: DialogTask[] = [];
const runtimeInput = typeof window !== 'undefined' ? (window as any).input : null;
const globalDialogService = typeof window !== 'undefined' ? (window as any).dialogService : null;
let running = false;
let currentTask: DialogTask | null = null;

function toUint8Array(value: unknown): Uint8Array | null {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  return null;
}

function resolvePosition(position?: number | string): number {
  if (Number.isFinite(position)) {
    return position as number;
  }
  if (typeof position === 'string' && typeof DialogPosition !== 'undefined') {
    return DialogPosition[position] ?? DEFAULT_POSITION;
  }
  return DEFAULT_POSITION;
}

function getRuntimeUi() {
  if (typeof window !== 'undefined' && (window as any).ui) {
    return (window as any).ui;
  }
  return ui;
}

function ensureDialogApi(runtimeUi: any) {
  if (!runtimeUi) {
    return null;
  }
  return typeof runtimeUi.startDialog === 'function' &&
    typeof runtimeUi.showDialogText === 'function' &&
    typeof runtimeUi.dialogWaitForKey === 'function' &&
    typeof runtimeUi.endDialog === 'function'
    ? runtimeUi
    : null;
}

function drainQueue() {
  if (running || queue.length === 0) {
    return;
  }
  const task = queue.shift();
  if (!task) {
    return;
  }
  running = true;
  currentTask = task;
  const position = resolvePosition(task.options.position);
  const color = Number.isFinite(task.options.color) ? task.options.color : 0;
  const charFace = Number.isFinite(task.options.charFace) ? task.options.charFace : 0;
  const playingRNG = !!task.options.playingRNG;
  const autoAdvance = !!task.options.autoAdvance;
  const holdMs = typeof task.options.holdMs === 'number' ? Math.max(0, task.options.holdMs) : 1400;

  const runtimeUi = ensureDialogApi(getRuntimeUi());
  if (!runtimeUi) {
    running = false;
    currentTask = null;
    return;
  }

  const run = co(function* npcDialogRunner() {
    if (typeof console !== 'undefined' && console.debug && task.options.debug !== false) {
      console.debug('[npc-dialog] start', {
        npcId: task.options.npcId,
        position,
        color,
        charFace,
        autoAdvance
      });
    }
    if (runtimeInput && typeof runtimeInput.clear === 'function') {
      runtimeInput.clear();
      runtimeInput.keyPress = 0;
    }
    runtimeUi.startDialog(position, color, charFace, playingRNG);
    // carry the injection metadata onto the published line — without it the
    // dialog-perception mapper can't tell this is the NPC's OWN line and
    // re-attributes it back to the NPC (self-sustaining talk loop).
    if (task.options.metadata) {
      dialogService.setPendingLineMetadata(task.options.metadata as never);
    }
    yield* runtimeUi.showDialogText(task.buffer);
    yield* waitForInputRelease();
    yield* runtimeUi.dialogWaitForKey();
    if (autoAdvance) {
      if (typeof sleep === 'function') {
        yield sleep(holdMs);
      } else {
        yield new Promise((resolve) => setTimeout(resolve, holdMs));
      }
    }
    yield* runtimeUi.endDialog();
  }) as Promise<unknown>;

  run.then(
    () => {
      task.resolve(true);
    },
    (err) => {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[npc-dialog] run failed', err);
      }
      task.reject(err);
    }
  ).finally(() => {
    running = false;
    currentTask = null;
    drainQueue();
  });
}

function enqueue(buffer: unknown, options: DialogOptions = {}) {
  const normalized = toUint8Array(buffer);
  if (!normalized || normalized.length === 0) {
    const error = new TypeError('[npc-dialog] enqueue requires a non-empty Uint8Array buffer');
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(error.message);
    }
    return Promise.reject(error);
  }
  return new Promise<boolean>((resolve, reject) => {
    queue.push({
      buffer: normalized,
      options,
      resolve,
      reject
    });
    drainQueue();
  });
}

function clear() {
  queue.length = 0;
  currentTask = null;
}

function getState() {
  return {
    running,
    pending: queue.length,
    current: currentTask
  };
}

const controller = {
  enqueue,
  clear,
  getState,
  isRunning() {
    return running;
  }
};

if (typeof window !== 'undefined') {
  (window as any).NpcDialogController = controller;
}

export default controller;

function* waitForInputRelease(timeoutMs = 800) {
  if (!runtimeInput) {
    return;
  }
  const start = Date.now();
  while (runtimeInput.keyPress && Date.now() - start < timeoutMs) {
    if (typeof sleep === 'function') {
      yield sleep(50);
    } else {
      yield new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (runtimeInput.clear) {
      runtimeInput.clear();
    }
  }
  if (runtimeInput.clear) {
    runtimeInput.clear();
  }
  runtimeInput.keyPress = 0;
}
