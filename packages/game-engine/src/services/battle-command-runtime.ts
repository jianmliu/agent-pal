import { BattleCommandExecution, type BattleExecutionOwner, type BattleCommandData } from './battle-command-execution';
import { BattleCommandsComponent, samePrompt, type CommandChoice, type PromptIdentity } from '../ecs/components/battle-commands';
import { detachedData, type DispatchResult } from './execution-scheduler';

export type CommandProfile = 'legacy' | 'owned-command';
export class OwnedBattleCancelled extends Error {
  readonly resumeNativeLoop: boolean;
  constructor(reason: string) {
    super(reason); this.name = 'OwnedBattleCancelled';
    this.resumeNativeLoop = reason !== 'world disposed' && reason !== 'runtime disposed';
  }
}
export const isOwnedBattleCancelled = (error: unknown): error is OwnedBattleCancelled => error instanceof OwnedBattleCancelled;
interface Dependencies {
  battle: BattleCommandData & { getState(): any; getCommands(): any; battleInstance: number; isInBattle(): boolean; openPrompt(member: number): any; publishOwnedPrompt(prompt: PromptIdentity, kind?: 'battle.command' | 'battle.auto-mode'): PromptIdentity; setAutoBattle(on: boolean): unknown };
  world: { _getPlayerRoleArrayValue(field: string, role: number, fallback: number): number; getPlayerStatusMatrix(): any; getWorldWriter(): any; _partyView(): any; registerCancellableExecutionScope(scope: any): void; releaseCancellableExecutionScope(scope: any): void };
  party?: { subscribe(listener: (event: any) => void): () => void };
  global(): any;
  enums(): any;
}
interface NativeRoot {
  raw: any; global: any; world: any; context: string; battle: number; native: any; live: boolean; cleanupUnsafe?: boolean;
  member?: number; role?: number; error?: unknown;
  clear(): void; check(): void;
}
interface Mode { prompt: PromptIdentity; root: NativeRoot; owner: BattleExecutionOwner }
interface Park { prompt: PromptIdentity; retry?: boolean; root: NativeRoot; owner: BattleExecutionOwner; resolve(reason: 'stage' | 'retry'): void; reject(error: unknown): void }
const raw = (value: any) => { while (value?.__raw__ && value.__raw__ !== value) value = value.__raw__; return value; };

/** Runtime capabilities stay here, outside World/WaitStack snapshots. Only the
 * resumed native post-startFrame generator calls BCE.resume. */
export class BattleCommandRuntime {
  private profile: CommandProfile = 'legacy';
  private installed = false;
  private disposed = false;
  private failureSummary: { name: string; message: string } | null = null;
  private unsafeFailures = new WeakSet<object>();
  private unsafePrimitiveFailures = new Set<unknown>();
  private deps: Dependencies | null = null;
  private execution: BattleCommandExecution | null = null;
  private roots = new Set<NativeRoot>();
  private park: Park | null = null;
  private mode: Mode | null = null;
  private pauseRoot: NativeRoot | null = null;
  private unsubscribeParty: (() => void) | null = null;
  get lastError() { return this.failureSummary ? { ...this.failureSummary } : null; }
  shouldBypassNativeCleanup(error: unknown) {
    // Consume only the failure recorded for this invalidated parent unwind.
    // Reusing the same Error in a later writer must retain ordinary semantics.
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      const unsafe = this.unsafeFailures.has(error as object);
      this.unsafeFailures.delete(error as object); return unsafe;
    }
    return this.unsafePrimitiveFailures.delete(error);
  }
  private rememberFailure(error: unknown) {
    try {
      this.failureSummary = { name: String((error as any)?.name || 'Error'), message: String((error as any)?.message ?? error) };
    } catch { this.failureSummary = { name: 'Error', message: 'unprintable runtime error' }; }
  }
  private markUnsafeFailure(error: unknown) {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) this.unsafeFailures.add(error as object);
    else this.unsafePrimitiveFailures.add(error);
  }
  isCancellation(error: unknown) { return isOwnedBattleCancelled(error); }
  get owned() { return this.profile === 'owned-command'; }
  install(profile: unknown, deps: Dependencies) {
    if (profile !== 'legacy' && profile !== 'owned-command') throw new TypeError('unknown battle command profile');
    if (this.installed) throw new Error('battle command profile is boot-only');
    this.installed = true; this.profile = profile; this.deps = deps;
    this.execution = new BattleCommandExecution(deps.battle);
    if (this.owned && deps.party) this.unsubscribeParty = deps.party.subscribe(event => {
      if (event.type === 'disposed') this.invalidate('party adapter disposed');
      else if (event.type === 'party' || event.type === 'snapshot') for (const root of this.roots) root.check();
    });
  }
  capture(native: any): NativeRoot | null {
    if (!this.owned) return null;
    if (this.disposed) throw new OwnedBattleCancelled('runtime disposed');
    // Recovery belongs to a new native parent after every old root/owner has
    // retired. Retain lastError for inspection; never retry a failed choice.
    if (this.roots.size === 0 && !this.park && !this.mode && !this.execution!.peek()) {
      if (this.execution!.snapshot().error !== null) this.execution!.clearError();
      this.unsafePrimitiveFailures.clear();
      this.unsafeFailures = new WeakSet<object>();
    }
    const d = this.deps!;
    const root: NativeRoot = {
      raw: raw(d.battle.getState()), global: d.global(), world: d.world.getWorldWriter(),
      context: d.battle.getCommands().context, battle: d.battle.battleInstance, native, live: true,
      clear: () => this.invalidateRoot(root, 'world disposed'),
      check: () => { if (!this.valid(root)) this.invalidateRoot(root, 'native battle root changed'); }
    };
    this.roots.add(root); d.world.registerCancellableExecutionScope(root);
    return root;
  }
  private valid(root: NativeRoot) { return root.live && this.matchesNativeRoot(root); }
  private matchesNativeRoot(root: NativeRoot) {
    const d = this.deps!;
    if (root.raw !== raw(d.battle.getState()) || root.global !== d.global() ||
      root.world !== d.world.getWorldWriter() || root.context !== d.battle.getCommands().context ||
      root.battle !== d.battle.battleInstance || !d.battle.isInBattle()) return false;
    if (root.member !== undefined) {
      const p = d.world._partyView();
      if (root.member > p.maxIndex || p.members[root.member]?.playerRole !== root.role) return false;
    }
    return true;
  }
  private cleanupUnsafe(root: NativeRoot) {
    if (root.cleanupUnsafe) return true;
    try { return !this.matchesNativeRoot(root); } catch { return true; }
  }
  assertRoot(root: NativeRoot | null) {
    if (root && !this.valid(root)) { this.invalidateRoot(root, 'native battle root changed'); throw root.error!; }
  }
  release(root: NativeRoot | null, bodyError?: unknown, bodyFailed = bodyError !== undefined) {
    if (!root) return;
    this.releasePauseBoundary(root);
    const mode = this.mode?.root === root ? this.mode : null;
    const original = bodyFailed ? bodyError : root.error;
    if ((bodyFailed || root.error !== undefined) && this.cleanupUnsafe(root)) { root.cleanupUnsafe = true; this.markUnsafeFailure(original); }
    let failed = false, failure: unknown;
    try { if (mode) this.retireMode(mode); } catch (error) { failed = true; failure = error; }
    finally {
      this.roots.delete(root); root.live = false;
      try { this.deps!.world.releaseCancellableExecutionScope(root); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    if (bodyFailed || root.error !== undefined) this.rememberFailure(original);
    else if (failed) { this.rememberFailure(failure); throw failure; }
  }
  checkPark() { const park = this.park; if (park && (!this.valid(park.root) || !this.ready(park.root))) this.invalidateRoot(park.root, 'parked battle actor changed'); }
  invalidate(reason: string) {
    let failed = false, failure: unknown;
    for (const root of this.roots) {
      try { this.invalidateRoot(root, reason); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    if (failed) throw failure;
  }
  private closeOwnPrompt(park: Park) {
    if (samePrompt(park.prompt, this.deps!.battle.getOpenPrompt())) this.deps!.battle.closePrompt();
  }
  private failPark(park: Park, error: unknown, destructive = false) {
    if (destructive || this.cleanupUnsafe(park.root)) { park.root.cleanupUnsafe = true; this.markUnsafeFailure(error); }
    this.rememberFailure(error);
    park.root.live = false; park.root.error = error;
    if (this.park === park) this.park = null;
    this.retireParkOwner(park);
    park.reject(error); // A resolved stage wake still sees root.error on resume.
  }
  private retireParkOwner(park: Park) {
    // All transition/parent error exits retire only this opaque owner. Cleanup
    // cannot close a foreign prompt or replace the original failure.
    try { this.execution!.cancel(park.owner); } catch { /* preserve original error */ }
    try { this.closeOwnPrompt(park); } catch { /* preserve original error */ }
  }
  private invalidateRoot(root: NativeRoot, reason: string) {
    if (!root.live) return;
    root.cleanupUnsafe = true; root.live = false; root.error = new OwnedBattleCancelled(reason);
    if (this.mode?.root === root) {
      try { this.retireMode(this.mode); } catch (error) { this.rememberFailure(error); this.markUnsafeFailure(error); root.error = error; throw error; }
    }
    const parked = this.park;
    if (parked?.root === root) {
      this.park = null;
      try { this.execution!.cancel(parked.owner); }
      catch (error) { this.failPark(parked, error, true); throw error; }
      finally { parked.reject(root.error); }
    }
  }
  private ready(root: NativeRoot, roundPolicy = false) {
    if (!this.valid(root)) return false;
    const d = this.deps!, e = d.enums(), st = d.battle.getState(), u = st.UI;
    const p = d.world._partyView(), member = Number(u?.curPlayerIndex);
    const role = p.members[member]?.playerRole, status = d.world.getPlayerStatusMatrix()[role] || [];
    const nativeControlled = d.world._getPlayerRoleArrayValue('HP', role, 0) <= 0 ||
      [e.PlayerStatus.Sleep, e.PlayerStatus.Paralyzed, e.PlayerStatus.Confused].some(index => status[index] > 0);
    return !nativeControlled && (roundPolicy ? !!(st.repeat || (!st.force && st.flee)) : !st.repeat && !st.force && !st.flee) && st.battleResult === e.BattleResult.OnGoing && st.phase === e.BattlePhase.SelectAction && !st.enemyCleared &&
      u?.state === e.BattleUIState.SelectMove && u.menuState === e.BattleMenuState.Main && !u.autoAttack && !d.global().autoBattle &&
      Number.isInteger(member) && member >= 0 && member <= p.maxIndex && !!p.members[member] &&
      st.player?.[member]?.state === e.FighterState.Com &&
      (root.member === undefined || (root.member === member && root.role === p.members[member].playerRole));
  }
  /** Rewards uses no root reservation or command mutation. */
  rewardsPauseQuiescent():boolean {
    if(this.disposed||!this.owned||!this.execution||this.roots.size||this.park||this.mode||this.pauseRoot||this.execution.inTransition||this.execution.peek())return false;
    const writer=this.deps!.world.getWorldWriter(),registry=writer.registry,entity=registry?registry.getEntitiesByTag('world')[0]:writer.world();
    if(entity===undefined)return false;const data=writer.peek(entity,BattleCommandsComponent);
    return !!data&&!data.open&&!data.pending&&!data.autoRequest;
  }
  /** Whole-loop cut only; never steals a manual park or staged C2 response. */
  preparePauseBoundary(root: NativeRoot | null): boolean {
    if (!root || this.pauseRoot || this.park || this.execution!.inTransition) return false;
    this.assertRoot(root);
    const data=this.deps!.battle.getCommands(), wait=this.execution!.peek();
    if (data.pending || data.autoRequest || (wait && (wait.kind !== 'battle.auto-mode' || wait.state !== 'waiting'))) return false;
    if (this.mode) {
      if (this.mode.root !== root || !wait || !samePrompt(this.mode.prompt,this.deps!.battle.getOpenPrompt())) return false;
      this.retireMode(this.mode);
    } else if (wait || this.deps!.battle.getOpenPrompt()) return false;
    this.assertRoot(root);
    const fresh=this.deps!.battle.getCommands();
    if (this.mode || this.park || this.execution!.peek() || fresh.pending || fresh.autoRequest || this.deps!.battle.getOpenPrompt()) return false;
    this.pauseRoot=root;
    return true;
  }
  releasePauseBoundary(root: NativeRoot | null): void { if (this.pauseRoot === root) this.pauseRoot=null; }
  *afterFrame(root: NativeRoot | null): Generator<any, void, any> {
    if (!root) return;
    if (this.pauseRoot) throw new Error('battle loop is paused');
    try {
      this.assertRoot(root);
      const d = this.deps!, execution = this.execution!;
      // A terminal child return is normal native progress: rewards and cleanup
      // still belong to battle.start. Assert destructive/sticky errors first.
      if (!this.ongoing()) { if (this.mode?.root === root) this.retireMode(this.mode); return; }
      if (this.mode) {
        const binding = this.mode;
        if (binding.root !== root) throw new Error('another owned battle parent has mode authority');
        try {
          if (!this.modeReady(root) || !samePrompt(binding.prompt, d.battle.getOpenPrompt())) this.retireMode(binding);
          else if (execution.peek()?.state === 'staged') {
            const result = execution.resume(binding.owner);
            if (!result.ok) throw new OwnedBattleCancelled(`owned mode resume: ${result.reason}`);
            this.clearMode(binding);
          }
        } catch (error) { this.failMode(binding, error); throw error; }
      }
      if (this.modeReady(root)) { if (!this.mode) this.publishMode(root); return; }
      // Native selection/UI/status work has returned in full. Native flags are
      // the sole round-policy authority; select only the actual Com actor.
      if (this.ready(root, true)) {
        const st = d.battle.getState();
        root.member = Number(st.UI.curPlayerIndex); root.role = d.world._partyView().members[root.member].playerRole;
        try {
          this.assertRoot(root);
          if (!this.ready(root, true)) throw new OwnedBattleCancelled('round policy actor changed at write');
          const choice = st.repeat ? { repeat: true } : { actionType: d.enums().BattleActionType.Flee, actionID: 0, target: -1 };
          root.native.commitCommand(root.member, choice, { autoAttack: false, uiToWait: true });
        } finally { root.member = undefined; root.role = undefined; }
        return;
      }
      while (this.ready(root)) {
        if (this.park) throw new Error('another owned battle parent is parked');
        const st = d.battle.getState(); root.member = Number(st.UI.curPlayerIndex); root.role = d.world._partyView().members[root.member].playerRole;
        this.assertRoot(root);
        const opened = d.battle.openPrompt(root.member);
        this.assertRoot(root);
        if (!this.ready(root)) throw new OwnedBattleCancelled('battle actor changed at publication');
        const prompt = d.battle.publishOwnedPrompt(opened);
        this.assertRoot(root);
        if (!this.ready(root)) throw new OwnedBattleCancelled('battle actor changed at publication');
        const owner = execution.publishDecision({ prompt, ready: () => this.ready(root) }, {
          context: { autoAttack: false, uiToWait: true },
          setAutoBattle: on => { this.assertRoot(root); return d.battle.setAutoBattle(on); },
          commitCommand: (member, choice, context) => {
            this.assertRoot(root);
            if (!this.ready(root)) throw new OwnedBattleCancelled('battle actor changed at accept');
            if ('repeat' in choice) {
              // BCE has already accept-closed and retired; the private park was
              // cleared before resume. Restoring player auto precedes expansion.
              root.native.beginRepeat(() => this.assertRoot(root));
              this.assertRoot(root);
              // Same-root status/script-auto progression remains native too.
              // The accepted round flag stays authoritative for the next frame.
              if (!this.ready(root, true)) return;
            }
            return root.native.commitCommand(member, choice, context);
          }
        });
        let parked!: Park;
        const wake = new Promise<'stage' | 'retry'>((resolve, reject) => { parked = { prompt, root, owner, resolve, reject }; });
        this.park = parked;
        try {
          let reason: 'stage' | 'retry';
          try { reason = yield wake; }
          catch (error) { throw !root.live ? root.error : error; }
          this.assertRoot(root);
          if (!this.ready(root)) { execution.cancel(owner); throw new OwnedBattleCancelled('battle actor no longer ready'); }
          if (reason === 'retry' || parked.retry) continue;
          // No await between BCE's accept-close, owner retirement and native commit.
          if (this.park === parked) this.park = null;
          const result = execution.resume(owner);
          if (!result.ok) { execution.cancel(owner); throw new OwnedBattleCancelled(`owned command resume: ${result.reason}`); }
          root.member = undefined; root.role = undefined;
          return;
        } catch (error) {
          // The resumed guards can throw before BCE.resume owns the transition.
          this.retireParkOwner(parked);
          // Invalidated roots must skip old-world Native cleanup even if the
          // original failure was a plain callback Error rather than cancellation.
          if (this.cleanupUnsafe(root) && !isOwnedBattleCancelled(error)) this.markUnsafeFailure(error);
          if (!isOwnedBattleCancelled(error) || execution.snapshot().error !== null) this.rememberFailure(error);
          root.live = false; root.error = error;
          throw error;
        } finally {
          if (this.park === parked) this.park = null;
        }
      }
    } catch (error) {
      if (this.mode?.root === root) this.failMode(this.mode, error);
      throw error;
    }
  }
  private ongoing() { return this.deps!.battle.getState().battleResult === this.deps!.enums().BattleResult.OnGoing; }
  private modeReady(root: NativeRoot) { return this.valid(root) && this.ongoing() && !!this.deps!.battle.getState().UI?.autoAttack; }
  private clearMode(mode: Mode) {
    if (this.mode === mode) this.mode = null;
    mode.root.member = undefined; mode.root.role = undefined;
  }
  private retireMode(mode: Mode) {
    this.clearMode(mode);
    let failed = false, failure: unknown;
    try { this.execution!.cancel(mode.owner); } catch (error) { failed = true; failure = error; }
    try { if (samePrompt(mode.prompt, this.deps!.battle.getOpenPrompt())) this.deps!.battle.closePrompt(); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
    if (failed) throw failure;
  }
  private failMode(mode: Mode, error: unknown) {
    const unsafe = this.cleanupUnsafe(mode.root);
    try { this.retireMode(mode); } catch { /* retain original callback error */ }
    if (unsafe) { mode.root.cleanupUnsafe = true; this.markUnsafeFailure(error); }
    this.rememberFailure(error); mode.root.live = false; mode.root.error = error;
  }
  private publishMode(root: NativeRoot) {
    if (this.park) throw new Error('manual parent is parked');
    const d = this.deps!, p = d.world._partyView();
    const member = p.members.findIndex((m: any, i: number) => i <= p.maxIndex && m && Number.isInteger(m.playerRole) && m.playerRole >= 0);
    if (member < 0) return;
    root.member = member; root.role = p.members[member].playerRole;
    let prompt: PromptIdentity | null = null;
    try {
      this.assertRoot(root);
      const opened = d.battle.openPrompt(member);
      prompt = opened;
      this.assertRoot(root);
      prompt = d.battle.publishOwnedPrompt(opened, 'battle.auto-mode');
      this.assertRoot(root);
      let binding!: Mode;
      const owner = this.execution!.publishAutoMode({ prompt: prompt, ready: () => this.modeReady(root) }, {
        setAutoBattle: on => {
          this.assertRoot(root);
          this.clearMode(binding); // retire private anchor before the first UI writer
          return d.battle.setAutoBattle(on);
        }
      });
      binding = { prompt, root, owner }; this.mode = binding;
    } catch (error) {
      const unsafe = this.cleanupUnsafe(root);
      try { if (prompt && samePrompt(prompt, d.battle.getOpenPrompt())) d.battle.closePrompt(); } catch { /* preserve publication error */ }
      root.member = undefined; root.role = undefined;
      if (unsafe) { root.cleanupUnsafe = true; this.markUnsafeFailure(error); }
      this.rememberFailure(error); root.live = false; root.error = error; throw error;
    }
  }
  submitAutoMode(observation: any, on: boolean): DispatchResult {
    try { observation = detachedData(observation); } catch { return { ok: false, reason: 'invalid' }; }
    if (typeof on !== 'boolean') return { ok: false, reason: 'invalid' };
    if (observation?.kind === 'battle.command') return this.stagePark(observation, { on });
    let binding: Mode | null;
    try { binding = this.matchMode(observation); } catch (error) { if (isOwnedBattleCancelled(error)) return { ok: false, reason: 'stale' }; throw error; }
    if (!binding) return { ok: false, reason: 'stale' };
    try {
      const result = this.execution!.submit(binding.owner, { prompt: binding.prompt, on });
      if (result.ok && (!this.valid(binding.root) || !samePrompt(binding.prompt, this.deps!.battle.getOpenPrompt()))) {
        this.execution!.cancel(binding.owner); this.invalidateRoot(binding.root, 'battle root changed at stage'); return { ok: false, reason: 'stale' };
      }
      return result;
    } catch (error) { this.failMode(binding, error); throw error; }
  }
  private matchMode(observation: any): Mode | null {
    const binding = this.mode, wait = this.execution!.peek();
    if (!binding || !wait || observation?.kind !== 'battle.auto-mode' || observation.revision !== wait.revision ||
      !samePrompt(observation.payload?.prompt, binding.prompt)) return null;
    try { this.assertRoot(binding.root); return this.modeReady(binding.root) && samePrompt(binding.prompt, this.deps!.battle.getOpenPrompt()) ? binding : null; }
    catch (error) { if (!isOwnedBattleCancelled(error)) this.failMode(binding, error); throw error; }
  }
  commandWait() { return this.execution?.peek() ?? null; }
  /** Detached live-parent observation. It confers no command/actor authority. */
  executionContext() {
    if (!this.owned || this.disposed) return null;
    for (const root of this.roots) {
      if (!this.valid(root) || !this.ongoing()) continue;
      const st = this.deps!.battle.getState();
      return { context: root.context, battle: root.battle, repeat: !!st.repeat, flee: !!st.flee,
        force: !!st.force, autoAttack: !!st.UI?.autoAttack, phase: st.phase,
        fleeAttempt: st.phase === this.deps!.enums().BattlePhase.PerformAction &&
          st.player?.some((player: any, member: number) => member <= this.deps!.world._partyView().maxIndex &&
            player?.action?.actionType === this.deps!.enums().BattleActionType.Flee) === true };
    }
    return null;
  }
  private matching(observation: any): Park | null {
    const park = this.park, wait = this.execution?.peek();
    if (!park || !wait || !observation || observation.kind !== 'battle.command' || observation.revision !== wait.revision ||
      !samePrompt(observation.payload?.prompt, wait.payload.prompt)) return null;
    try {
      this.assertRoot(park.root);
      if (!this.ready(park.root)) { this.invalidateRoot(park.root, 'battle actor no longer ready'); return null; }
      return park;
    } catch (error) {
      if (!isOwnedBattleCancelled(error)) this.failPark(park, error);
      throw error;
    }
  }
  submitCommand(observation: any, choice: CommandChoice): DispatchResult { return this.stagePark(observation, { choice }); }
  private stagePark(observation: any, response: { choice: CommandChoice } | { on: boolean }): DispatchResult {
    // Reject malformed plain DTO copies without retiring the legal live wait.
    try { observation = detachedData(observation); } catch { return { ok: false, reason: 'invalid' }; }
    let park: Park | null;
    try { park = this.matching(observation); } catch (error) {
      if (isOwnedBattleCancelled(error)) return { ok: false, reason: 'stale' };
      throw error;
    }
    if (!park) return { ok: false, reason: 'stale' };
    try {
      const result = this.execution!.submit(park.owner, { prompt: park.prompt, ...response });
      if (result.ok) {
        // Recheck after synchronous C2 subscribers before releasing native Promise.
        if (!this.valid(park.root) || !this.ready(park.root)) {
          // A source hook can run reentrantly while scheduler.stage is guarded.
          // Its rejection already settled the park; retire after stage unlocks.
          this.execution!.cancel(park.owner);
          this.invalidateRoot(park.root, 'battle root changed at stage');
          return { ok: false, reason: 'stale' };
        }
        park.resolve('stage');
      }
      return result;
    } catch (error) { this.failPark(park, error); throw error; }
  }
  cancelCommand(observation: any): DispatchResult {
    try { observation = detachedData(observation); } catch { return { ok: false, reason: 'invalid' }; }
    if (observation?.kind === 'battle.auto-mode') {
      let mode: Mode | null;
      try { mode = this.matchMode(observation); } catch (error) { if (isOwnedBattleCancelled(error)) return { ok: false, reason: 'stale' }; throw error; }
      if (!mode) return { ok: false, reason: 'stale' };
      try { this.retireMode(mode); return { ok: true }; } catch (error) { this.failMode(mode, error); throw error; }
    }
    let park: Park | null;
    try { park = this.matching(observation); } catch (error) {
      if (isOwnedBattleCancelled(error)) return { ok: false, reason: 'stale' };
      throw error;
    }
    if (!park) return { ok: false, reason: 'stale' };
    try {
      const result = this.execution!.cancel(park.owner);
      if (result.ok) { park.retry = true; this.park = null; park.resolve('retry'); }
      return result;
    } catch (error) { this.failPark(park, error); throw error; }
  }
  dispose() {
    this.disposed = true;
    let failed = false, failure: unknown;
    for (const cleanup of [() => this.invalidate('runtime disposed'), () => this.execution?.dispose(), () => this.unsubscribeParty?.()]) {
      try { cleanup(); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    this.unsubscribeParty = null;
    if (failed) throw failure;
  }
}
export const battleCommandRuntime = new BattleCommandRuntime();
