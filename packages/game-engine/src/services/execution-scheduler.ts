/**
 * One live wait per runtime. Observations are detached JSON data, never checkpoints
 * that can authorize a native continuation. Owner handles require object identity;
 * a protocol/WaitStack adapter must resolve its observation to the live owner.
 * This does not change ScriptExecutionRuntime or grant cross-Runner authority.
 */
export type DispatchResult = { ok: true } | { ok: false; reason: string; note?: string };
export interface ExecutionOwner<K extends string> { readonly kind: K; readonly revision: number }
export interface WaitObservation<K extends string, P> { kind: K; revision: number; state: 'waiting' | 'staged'; payload: P }
export interface ExecutionAdapter<R, A> {
  ready(): boolean;
  stage(response: R): DispatchResult;
  /** null/false mean refusal; do not consume a different legal domain request. */
  accept(): A | null | false;
  commit(accepted: A): unknown;
  cancel(): unknown;
}

/** Copy only finite, plain JSON DTOs, without executing accessors or toJSON. */
export function detachedData<T>(value: T): T {
  const seen = new Set<object>();
  const copy = (v: any): any => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object' || seen.has(v)) throw new TypeError('expected pure detached JSON data');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new TypeError('expected pure detached JSON data');
    seen.add(v);
    const out: any = Array.isArray(v) ? [] : {};
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue;
      const desc = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== 'string' || !desc.enumerable || !('value' in desc)) throw new TypeError('expected pure detached JSON data');
      if (Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(key)) throw new TypeError('expected pure detached JSON data');
      Object.defineProperty(out, key, { value: copy(desc.value), enumerable: true, writable: true, configurable: true });
    }
    if (Array.isArray(v) && (out.length !== v.length || Object.keys(out).length !== v.length)) throw new TypeError('expected pure detached JSON data');
    seen.delete(v); return out;
  };
  return copy(value);
}
const synchronous = (result: any) => {
  if (result != null && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') throw new TypeError('execution callbacks must be synchronous');
  return result;
};
export function requireSynchronous(callbacks: readonly unknown[]): void {
  for (const callback of callbacks) {
    if (typeof callback !== 'function' || Object.prototype.toString.call(callback) !== '[object Function]') throw new TypeError('execution callbacks must be synchronous functions');
  }
}

type Active<K extends string, P, R, A> = {
  owner: ExecutionOwner<K>; payload: P; state: 'waiting' | 'staged'; adapter: ExecutionAdapter<R, A>;
};
export class ExecutionScheduler<K extends string, P, R, A> {
  private revision: number;
  readonly #publicationOwners = new WeakMap<object, ExecutionOwner<K>>();
  readonly #publicationAttempts = new WeakSet<object>();
  private active: Active<K, P, R, A> | null = null;
  private transitioning = false;
  get inTransition(): boolean { return this.transitioning; }
  private disposed = false;
  private error: string | null = null;
  /** initialRevision is an allocator high-water mark, never a restored wait. */
  constructor(options: { initialRevision?: number } = {}) {
    this.revision = options.initialRevision ?? 0;
    if (!Number.isSafeInteger(this.revision) || this.revision < 0) throw new RangeError('invalid scheduler revision');
  }
  publish(kind: K, payload: P, adapter: ExecutionAdapter<R, A>, attempt?: object): ExecutionOwner<K> {
    if (this.transitioning) throw new Error('scheduler transition in progress');
    if (this.disposed) throw new Error('scheduler disposed');
    if (this.error !== null) throw new Error('clear scheduler error before publishing');
    if (this.active) throw new Error('scheduler already has an active wait');
    if (typeof kind !== 'string' || !kind) throw new TypeError('wait kind required');
    if (this.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('scheduler revision overflow');
    if (attempt !== undefined) {
      if (!attempt || typeof attempt !== 'object' || this.#publicationAttempts.has(attempt)) throw new TypeError('invalid publication attempt');
      this.#publicationAttempts.add(attempt);
    }
    const data = detachedData(payload);
    this.transitioning = true;
    try {
      const { ready, stage, accept, commit, cancel } = adapter;
      requireSynchronous([ready, stage, accept, commit, cancel]);
      const owner = Object.freeze({ kind, revision: ++this.revision });
      // Capture callback references; a caller cannot swap the continuation later.
      this.active = { owner, payload: data, state: 'waiting', adapter: {
        ready: () => ready.call(adapter),
        stage: response => stage.call(adapter, response),
        accept: () => accept.call(adapter),
        commit: accepted => commit.call(adapter, accepted),
        cancel: () => cancel.call(adapter)
      } };
      if (attempt) this.#publicationOwners.set(attempt, owner);
      return owner;
    } finally { this.transitioning = false; }
  }
  /** Consume only the exact stock owner produced by this one-use attempt. */
  cancelPublication(attempt: object, kind: K): DispatchResult {
    const owner = this.#publicationOwners.get(attempt);
    if (!owner || owner.kind !== kind) return { ok: false, reason: 'stale' };
    this.#publicationOwners.delete(attempt);
    return this.cancel(owner, kind);
  }
  ownsPublication(attempt: object, owner: ExecutionOwner<K>, kind: K): boolean {
    return this.#publicationOwners.get(attempt) === owner && this.bound(owner, kind) !== null;
  }
  forgetPublication(attempt: object): void { this.#publicationOwners.delete(attempt); }
  peek(): WaitObservation<K, P> | null {
    const a = this.active;
    return a ? { ...a.owner, state: a.state, payload: detachedData(a.payload) } : null;
  }
  snapshot(): { revision: number; disposed: boolean; error: string | null; wait: WaitObservation<K, P> | null } {
    return { revision: this.revision, disposed: this.disposed, error: this.error, wait: this.peek() };
  }
  clearError(): void {
    if (this.transitioning) throw new Error('scheduler transition in progress');
    this.error = null;
  }
  private bound(owner: ExecutionOwner<K>, kind: K): Active<K, P, R, A> | null {
    return !this.disposed && !this.transitioning && this.active?.owner === owner && owner.kind === kind ? this.active : null;
  }
  private failure(a: Active<K, P, R, A>, error: unknown, cleanup = true): never {
    this.active = null;
    this.error = error instanceof Error ? error.message : String(error);
    // A rejected asynchronous callback may already have effects. Retire, never retry;
    // no rollback guarantee is made for callbacks violating the synchronous contract.
    if (cleanup) { try { synchronous(a.adapter.cancel()); } catch { /* retain original failure */ } }
    throw error;
  }
  stage(owner: ExecutionOwner<K>, kind: K, response: R): DispatchResult {
    const a = this.bound(owner, kind);
    if (!a) return { ok: false, reason: 'stale' };
    if (a.state !== 'waiting') return { ok: false, reason: 'busy' };
    let data: R;
    try { data = detachedData(response); } catch { return { ok: false, reason: 'invalid' }; }
    this.transitioning = true;
    try {
      const result = synchronous(a.adapter.stage(data));
      if (!result || typeof result.ok !== 'boolean') throw new TypeError('invalid stage result');
      if (result.ok) a.state = 'staged';
      return detachedData(result);
    } catch (error) { return this.failure(a, error); }
    finally { this.transitioning = false; }
  }
  resume(owner: ExecutionOwner<K>, kind: K): DispatchResult {
    const a = this.bound(owner, kind);
    if (!a) return { ok: false, reason: 'stale' };
    if (a.state !== 'staged') return { ok: false, reason: 'waiting' };
    this.transitioning = true;
    try {
      const ready = synchronous(a.adapter.ready());
      if (typeof ready !== 'boolean') throw new TypeError('readiness must be boolean');
      if (!ready) return { ok: false, reason: 'not-ready' };
      const accepted = synchronous(a.adapter.accept());
      if (accepted === null || accepted === false) return { ok: false, reason: 'not-accepted' };
      this.active = null; // Domain accept has closed first. Retire before any writer.
      synchronous(a.adapter.commit(accepted));
      return { ok: true };
    } catch (error) { return this.failure(a, error); }
    finally { this.transitioning = false; }
  }
  cancel(owner: ExecutionOwner<K>, kind: K): DispatchResult {
    const a = this.bound(owner, kind);
    if (!a) return { ok: false, reason: 'stale' };
    this.transitioning = true; this.active = null;
    try { synchronous(a.adapter.cancel()); return { ok: true }; }
    catch (error) { return this.failure(a, error, false); }
    finally { this.transitioning = false; }
  }
  dispose(): void {
    if (this.transitioning) throw new Error('scheduler transition in progress');
    if (this.disposed) return;
    const a = this.active;
    this.disposed = true; this.active = null;
    if (!a) return;
    this.transitioning = true;
    try { synchronous(a.adapter.cancel()); }
    catch (error) { this.failure(a, error, false); }
    finally { this.transitioning = false; }
  }
}
