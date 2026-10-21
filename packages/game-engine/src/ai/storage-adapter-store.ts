/**
 * StorageAdapterStore — a durable @aigg/npc-agent `Store` backed by the
 * existing cross-platform storage adapter (Capacitor Preferences on mobile,
 * localStorage on web). This is P0 ④: relationship + world-flag persistence so a
 * reopened game still remembers the player (affinity, tags, addressing tier).
 *
 * Decision (2026-05): reuse storage-adapter (zero new deps, web+mobile, matches
 * the game's save mechanism). Graduate the durable tier to IndexedDB only when
 * episodic memory + embedding vectors arrive — same Store interface, swap impl.
 *
 * The backend is injectable (a tiny string-KV interface) so the store is
 * headless-testable in node without Capacitor/localStorage; the default lazily
 * loads the platform storage-adapter (kept lazy so importing this module in node
 * tooling doesn't pull in @capacitor/core).
 */
import type { Store, Scope, WriteOptions } from '@aigg/npc-agent';

/** Minimal string key-value backend (matches storage-adapter's get/set/remove). */
export interface KvBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

let platformBackend: KvBackend | null = null;
async function getPlatformBackend(): Promise<KvBackend> {
  if (!platformBackend) {
    const mod = await import('../mobile/storage-adapter');
    platformBackend = { getItem: mod.getItem, setItem: mod.setItem, removeItem: mod.removeItem };
  }
  return platformBackend;
}

export interface StorageAdapterStoreOptions {
  /** inject a backend (tests pass a Map-backed fake); defaults to the platform adapter. */
  backend?: KvBackend;
  /** key namespace prefix to avoid colliding with game saves. */
  namespace?: string;
}

function scopePart(scope: Scope): string {
  switch (scope.type) {
    case 'npc-player':
      return `np:${scope.npcId}:${scope.playerId}`;
    case 'player':
      return `pl:${scope.playerId}`;
    case 'world':
      return 'w';
  }
}

export class StorageAdapterStore implements Store {
  private readonly backend: Promise<KvBackend>;
  private readonly ns: string;
  /** keys written with { onchain: true } this session — the future MUD/Auto Drive sync set. */
  readonly onchainKeys = new Set<string>();

  constructor(options: StorageAdapterStoreOptions = {}) {
    this.backend = options.backend ? Promise.resolve(options.backend) : getPlatformBackend();
    this.ns = options.namespace ?? 'npcagent';
  }

  private key(scope: Scope, key: string): string {
    return `${this.ns}:${scopePart(scope)}:${key}`;
  }

  async get<T>(scope: Scope, key: string): Promise<T | null> {
    const raw = await (await this.backend).getItem(this.key(scope, key));
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(scope: Scope, key: string, value: T, opts?: WriteOptions): Promise<void> {
    const k = this.key(scope, key);
    await (await this.backend).setItem(k, JSON.stringify(value));
    if (opts?.onchain) this.onchainKeys.add(k);
  }

  async delete(scope: Scope, key: string): Promise<void> {
    await (await this.backend).removeItem(this.key(scope, key));
  }
}
