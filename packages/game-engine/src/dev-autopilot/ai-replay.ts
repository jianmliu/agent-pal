const isBrowser = typeof window !== 'undefined';

type ReplayEntry = Record<string, any> & { type: 'stream' | 'action'; timestamp: number };

type ReplayRecorderOptions = {
  adapters?: string[] | string;
  maxEntries?: number;
};

type ReplayPlaybackOptions = {
  delay?: number;
  onAction?: (action: any) => void;
};

export class ReplayRecorder {
  adapters: string[];
  maxEntries: number;
  entries: ReplayEntry[];
  subscriptions: Array<() => void>;

  constructor(options: ReplayRecorderOptions = {}) {
    const { adapters = [], maxEntries = 10000 } = options;
    this.adapters = Array.isArray(adapters) ? adapters : [adapters];
    this.maxEntries = maxEntries;
    this.entries = [];
    this.subscriptions = [];
  }

  async start() {
    this.entries.length = 0;
  }

  stop() {
    this.subscriptions.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ai-replay] unsubscribe failure', err);
        }
      }
    });
    this.subscriptions = [];
  }

  registerSubscription(unsubscribe: unknown) {
    if (typeof unsubscribe === 'function') {
      this.subscriptions.push(unsubscribe as () => void);
    }
  }

  recordStream(event: Record<string, any>) {
    if (this.entries.length >= this.maxEntries) {
      return;
    }
    this.entries.push({ type: 'stream', timestamp: Date.now(), ...event });
  }

  recordAction(action: Record<string, any>) {
    if (this.entries.length >= this.maxEntries) {
      return;
    }
    this.entries.push({ type: 'action', timestamp: Date.now(), action });
  }

  save() {
    const payload = JSON.stringify(this.entries, null, 2);
    if (isBrowser) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ai-replay] save() called in browser; returning JSON string only');
      }
    }
    return payload;
  }
}

export class ReplayPlayer {
  entries: ReplayEntry[];

  constructor(entries: ReplayEntry[] = []) {
    this.entries = Array.isArray(entries) ? entries : [];
  }

  async play(options: ReplayPlaybackOptions = {}) {
    const { delay = 0, onAction } = options;
    for (const entry of this.entries) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (entry.type === 'action' && typeof onAction === 'function') {
        onAction(entry.action);
      }
    }
  }
}

export function loadReplayFromJSON(json: string) {
  try {
    return JSON.parse(json) as ReplayEntry[];
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[ai-replay] loadReplayFromJSON parse error', err);
    }
    return [];
  }
}
