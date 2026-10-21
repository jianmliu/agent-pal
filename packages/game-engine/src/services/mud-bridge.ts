import { Subject } from 'rxjs';
import reactiveContext from '../state/reactive-context.js';
import { party$ as partyStream, followerCount$ } from './party-trail-adapter.js';
import playerStateAdapter from './player-state-adapter.js';
import { sceneEventObjects$, sceneId$ } from './scene-event-adapter.js';
import dialogService from './dialog-service.js';
import { createMudClient, type MudClient } from './mud-client.js';
import { getMudConfig, type MudConfig } from './mud-config.js';

type MudEnvelope<T = unknown> = {
  kind: string;
  payload: T;
  timestamp: number;
};

type MudBridgeOptions = {
  log?: boolean;
  connection?: MudConfig;
};

type SubscriptionLike = { unsubscribe?: () => void } | (() => void);
type ObservableLike = { subscribe?: (callback: (value: any) => void) => SubscriptionLike };

const mudOutgoing$ = new Subject<MudEnvelope>();
const mudIncoming$ = new Subject<unknown>();

let running = false;
let subscriptions: SubscriptionLike[] = [];
let optionsSnapshot: MudBridgeOptions = { log: true };
let mudClient: MudClient | null = null;
let readyPromise: Promise<boolean> | null = null;
let readyResolve: ((value: boolean) => void) | null = null;

function cleanupSubscription(subscription?: SubscriptionLike | null) {
  if (!subscription) {
    return;
  }
  if (typeof subscription === 'function') {
    subscription();
    return;
  }
  if (typeof subscription.unsubscribe === 'function') {
    subscription.unsubscribe();
  }
}

function log(message: string, payload?: unknown) {
  if (optionsSnapshot.log === false) {
    return;
  }
  if (typeof console !== 'undefined' && console.debug) {
    console.debug(`[mud-bridge] ${message}`, payload);
  }
}

const noisyStreams = new Set(['sceneEvents', 'sceneId']);

function emit(kind: string, payload: unknown) {
  if (!running) {
    return;
  }
  const envelope: MudEnvelope = {
    kind,
    payload,
    timestamp: Date.now()
  };
  mudOutgoing$.next(envelope);
  if (noisyStreams.has(kind)) {
    return;
  }
  log(`emit:${kind}`, payload);
}

function subscribeObservable(observable: ObservableLike | null | undefined, kind: string) {
  if (!observable || typeof observable.subscribe !== 'function') {
    return;
  }
  let lastPayload = JSON.stringify(null);
  const subscription = observable.subscribe((value: unknown) => {
    if (noisyStreams.has(kind)) {
      const serialized = JSON.stringify(value);
      if (serialized === lastPayload) {
        return;
      }
      lastPayload = serialized;
    }
    emit(kind, value);
  });
  subscriptions.push(subscription as SubscriptionLike);
}

async function startMudBridge(options: MudBridgeOptions = {}) {
  if (running) {
    return mudBridge;
  }
  running = true;
  optionsSnapshot = Object.assign({ log: true }, options);
  log('start', optionsSnapshot);

  readyPromise = new Promise((resolve) => (readyResolve = resolve));
  const connection = optionsSnapshot.connection || safeGetConfig();
  mudClient = await createMudClient(connection);
  if (readyResolve) {
    readyResolve(true);
    readyResolve = null;
  }
  if (mudClient.onSync) {
    mudClient.onSync((message) => handleMudMessage(message));
  }

  subscribeObservable(partyStream, 'party');
  subscribeObservable(followerCount$, 'followers');
  subscribeObservable((playerStateAdapter as any).playerRoles$, 'playerRoles');
  subscribeObservable(sceneEventObjects$(), 'sceneEvents');
  subscribeObservable(sceneId$(), 'sceneId');

  const dialogLine$ = reactiveContext.signalToObservable(dialogService.signals.currentLine);
  const dialogStatus$ = reactiveContext.signalToObservable(dialogService.signals.status);
  subscribeObservable(dialogLine$ as ObservableLike, 'dialogLine');
  subscribeObservable(dialogStatus$ as ObservableLike, 'dialogStatus');

  return mudBridge;
}

async function stopMudBridge() {
  if (!running) {
    return;
  }
  subscriptions.forEach(cleanupSubscription);
  subscriptions = [];
  running = false;
  if (mudClient && typeof mudClient.stop === 'function') {
    await mudClient.stop();
  }
  mudClient = null;
  readyPromise = null;
  readyResolve = null;
  log('stop');
}

function handleMudMessage(message: unknown) {
  if (!message) {
    return;
  }
  mudIncoming$.next(message);
  log('incoming', message);
}

type MudBridge = {
  start: (options?: MudBridgeOptions) => Promise<MudBridge>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
  connectWallet: (requestOpts?: Partial<MudConfig>) => Promise<unknown>;
  mudOutgoing$: Subject<MudEnvelope>;
  mudIncoming$: Subject<unknown>;
  handleMudMessage: (message: unknown) => void;
};

const mudBridge: MudBridge = {
  start: startMudBridge,
  stop: stopMudBridge,
  isRunning: () => running,
  connectWallet: async (requestOpts: Partial<MudConfig> = {}) => {
    const config = Object.assign({}, safeGetConfig(), { privateKey: null }, requestOpts);
    if (!mudClient || typeof mudClient.connectWallet !== 'function') {
      throw new Error('Mud client not ready');
    }
    return mudClient.connectWallet(config);
  },
  mudOutgoing$,
  mudIncoming$,
  handleMudMessage
};

function safeGetConfig(): MudConfig {
  try {
    return getMudConfig();
  } catch (err) {
    console.warn('[mud-bridge] missing PAL_CONFIG.mud', err);
    throw err;
  }
}

function writeSystemCall(functionName: string, args: unknown[] = []) {
  if (!mudClient || typeof mudClient.writeSystem !== 'function') {
    console.warn('[mud-bridge] writeSystem requested but client is not ready');
    return Promise.reject(new Error('mud client not ready'));
  }
  return mudClient
    .writeSystem(functionName, args)
    .then((txHash) => {
      log('writeSystem', { functionName, args, txHash });
      return txHash;
    })
    .catch((err) => {
      console.warn('[mud-bridge] writeSystem failed', err);
      throw err;
    });
}

export default mudBridge;
export {
  startMudBridge,
  stopMudBridge,
  mudOutgoing$,
  mudIncoming$,
  handleMudMessage,
  writeSystemCall
};
