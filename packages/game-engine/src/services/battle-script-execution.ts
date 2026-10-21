import {readRewardNativeRuntime} from './battle-reward-runtime';
import {releaseBattleRewardTask} from './battle-reward-fence';
import { copyBattleLoopContext } from './battle-loop-runtime';
import type { ScriptExecutionFrame, ScriptExecutionRuntime, BattleScriptFrameObservation } from './script-execution-runtime';

export type BattleScriptProfile = 'legacy' | 'owned-parent';
export type BattleScriptPhase = 'starting' | 'pre-battle' | 'combat' | 'rewards' | 'cleanup';
export interface BattleParentObservation {
  id: string; context: string | null; battle: number | null; phase: BattleScriptPhase;
  status: 'running' | 'completed' | 'failed' | 'retired';
  invoker: {runtime: string; frame: number} | null;
  children: BattleScriptFrameObservation[];
}
interface Runner { getExecutionRuntime(): ScriptExecutionRuntime; runTriggerScript(entry: number, event: number, parent?: ScriptExecutionFrame, authority?: unknown): Promise<number>; scriptSuccess: boolean }
interface Dependencies {
  battle: {getState(): any; getCommands(): {context: string}; battleInstance: number; getModule(): unknown};
  world: {getWorldWriter(): any; registerCancellableExecutionScope(scope: any): void; releaseCancellableExecutionScope(scope: any): void};
  global(): any;
}
interface LiveParent {
  runner: Runner; runtime: ScriptExecutionRuntime; invoker: ScriptExecutionFrame | null;
  native: unknown; raw: unknown; world: unknown; global: unknown;
  observation: BattleParentObservation; scope: {clear(): void; check(): void}; bound: boolean;
}
const unwrap = (value: any) => { while (value?.__raw__ && value.__raw__ !== value) value = value.__raw__; return value; };
// Internal native transport only. Tokens never become context/event/DTO fields.
const nativeContextParents = new WeakMap<object, unknown>();
export function bindNativeBattleScriptContext<T extends object>(context: T, parent: unknown): T {
  if (parent !== undefined && parent !== null) nativeContextParents.set(context,parent);
  return context;
}
export function copyNativeBattleScriptContext<T extends object>(source: object | undefined, target: T): T {
  copyBattleLoopContext(source,target);
  if (source && nativeContextParents.has(source)) nativeContextParents.set(target,nativeContextParents.get(source));
  return target;
}
export function nativeBattleScriptContextParent(context: object | undefined): unknown {
  return context ? nativeContextParents.get(context) : undefined;
}
const nativeTaskFinishListeners=new WeakMap<object,Set<()=>void>>();
/** Registers only on an authentic active native task; no callback handle or early-fire API. */
export function onBattleScriptTaskFinish(cap:unknown,callback:()=>void):void {
 const listeners=cap&&typeof cap==='object'?nativeTaskFinishListeners.get(cap as object):undefined;
 if(!listeners)throw new Error('invalid or finished native battle task');
 listeners.add(callback);
}
let parentSequence = 0;
/** Opaque capabilities and live aliases never appear in snapshots or checkpoints. */
export class BattleScriptExecution {
  private profile: BattleScriptProfile = 'legacy';
  private installed = false;
  private disposed = false;
  private deps: Dependencies | null = null;
  private successes = new WeakMap<object, boolean>();
  // Reservations outlive metadata retirement until the actual Native task settles.
  // Both indexes contain only scalar identities, never Runner/World/generator aliases.
  private taskRecords = new WeakMap<object, {runtime: string; id: string}>();
  private tasks = new Map<string, Set<string>>();
  get opaqueTasks() { return [...this.tasks.values()].reduce((sum, tasks) => sum + tasks.size,0); }
  hasOpaqueTask(runner: Runner): boolean { return this.owned && this.tasks.has(readRewardNativeRuntime(runner).identity); }
  private retirementListeners = new WeakMap<object, Set<(error?: unknown, failed?: boolean) => void>>();
  private parents = new Map<object, LiveParent>();
  private current: object | null = null;
  private last: BattleParentObservation | null = null;
  get owned() { return this.profile === 'owned-parent'; }
  get liveReferences() { return this.parents.size; }
  install(profile: unknown, deps: Dependencies): void {
    if (profile !== 'legacy' && profile !== 'owned-parent') throw new TypeError('unknown battle script profile');
    if (this.installed) throw new Error('battle script profile is boot-only');
    this.installed = true; this.profile = profile; this.deps = deps;
  }
  begin(runner: Runner, invoker?: ScriptExecutionFrame): object | null {
    if (!this.owned) return null;
    if (this.disposed) throw new Error('battle script runtime disposed');
    if (this.current || this.tasks.size) throw new Error('owned battle script invocation is already active');
    const runtime = readRewardNativeRuntime(runner);
    if (invoker && !runtime.owns(invoker,runner)) throw new Error('battle invoker is not owned by selected Runner');
    const cap = Object.freeze({});
    const observation: BattleParentObservation = {id: `${runtime.identity}:native-battle:${++parentSequence}`, context: null, battle: null,
      phase: 'starting', status: 'running', invoker: invoker ? {runtime: runtime.identity, frame: invoker.id} : null, children: []};
    const scope = {clear: () => this.retire(cap, 'retired'), check: () => { if (!this.checkedMatches(cap,this.parents.get(cap))) this.retire(cap, 'retired'); }};
    this.parents.set(cap, {runner, runtime, invoker: invoker || null, native: null, raw: null, world: null, global: null, observation, scope, bound: false});
    this.taskRecords.set(cap,{runtime: runtime.identity,id: observation.id});
    nativeTaskFinishListeners.set(cap,new Set());
    this.tasks.set(runtime.identity,new Set([observation.id]));
    this.successes.set(cap, runner.scriptSuccess !== false);
    this.current = cap;
    try { this.deps!.world.registerCancellableExecutionScope(scope); } catch (error) { this.finish(cap,false); throw error; }
    return cap;
  }
  bind(cap: unknown, native: unknown): void {
    const parent = this.require(cap);
    if (parent.bound) throw new Error('battle parent is already bound');
    const d = this.deps!;
    parent.raw = unwrap(d.battle.getState()); parent.native = native;
    parent.world = d.world.getWorldWriter(); parent.global = d.global();
    parent.observation.context = d.battle.getCommands().context; parent.observation.battle = d.battle.battleInstance;
    parent.observation.phase = 'pre-battle'; parent.bound = true;
  }
  private require(cap: unknown): LiveParent {
    const parent = cap && typeof cap === 'object' ? this.parents.get(cap) : undefined;
    if (!parent) throw new Error('invalid or retired battle script authority');
    return parent;
  }
  private matches(parent?: LiveParent): boolean {
    if (!parent || !parent.bound) return !!parent;
    const d = this.deps!;
    return parent.raw === unwrap(d.battle.getState()) && parent.world === d.world.getWorldWriter() &&
      parent.native === d.battle.getModule() && parent.global === d.global() && parent.observation.context === d.battle.getCommands().context && parent.observation.battle === d.battle.battleInstance;
  }
  private checkedMatches(cap: unknown, parent?: LiveParent): boolean {
    try { return this.matches(parent); } catch (error) { this.retire(cap,'failed',error,true); throw error; }
  }
  validate(cap: unknown, runner?: Runner, native?: unknown): Runner {
    const parent = this.require(cap);
    if (runner && (parent.runner !== runner || parent.runtime !== readRewardNativeRuntime(runner))) throw new Error('battle script Runner mismatch');
    if (!parent.bound || !this.checkedMatches(cap,parent) || (native !== undefined && parent.native !== native)) {
      this.retire(cap, 'retired'); throw new Error('battle script context changed');
    }
    if (parent.invoker && !parent.runtime.owns(parent.invoker,parent.runner)) { this.retire(cap,'retired'); throw new Error('battle script invoker retired'); }
    return parent.runner;
  }
  success(cap: unknown): boolean {
    if (!cap || typeof cap !== 'object' || !this.successes.has(cap)) throw new Error('invalid battle script success source');
    const parent = this.parents.get(cap);
    const success = parent?.runner.scriptSuccess;
    return typeof success === 'boolean' ? success : this.successes.get(cap)!;
  }
  recordSuccess(cap: unknown, success: boolean): void {
    if (cap && typeof cap === 'object' && this.successes.has(cap)) this.successes.set(cap, success);
  }
  enter(cap: unknown, runner: Runner, frame: ScriptExecutionFrame): void {
    this.validate(cap,runner);
    const parent = this.require(cap);
    if (!parent.runtime.owns(frame,runner)) throw new Error('battle child frame Runner mismatch');
    parent.runtime.attachBattleOrigin(frame,parent.observation.id);
  }
  /** Internal exact-capability phase check; detached observations confer no authority. */
  hasPhase(cap: unknown, phase: BattleScriptPhase): boolean {this.validate(cap);return this.require(cap).observation.phase===phase;}
  phase(cap: unknown, phase: BattleScriptPhase): void { if (cap && typeof cap === 'object') { const parent = this.parents.get(cap); if (parent) parent.observation.phase = phase; } }
  invalidate(boundOnly = false): void {
    if (this.current && (!boundOnly || this.parents.get(this.current)?.bound)) this.retire(this.current,'retired');
  }
  finish(cap: unknown, completed: boolean): void {
    try {this.retire(cap,completed ? 'completed' : 'failed');}
    finally {
      if(cap&&typeof cap==='object'){
        const task=this.taskRecords.get(cap);
        if(task){this.taskRecords.delete(cap);const tasks=this.tasks.get(task.runtime);tasks?.delete(task.id);if(!tasks?.size)this.tasks.delete(task.runtime);}
        const listeners=nativeTaskFinishListeners.get(cap);nativeTaskFinishListeners.delete(cap);
        releaseBattleRewardTask(cap);
        // Invalidate the exact task before callbacks; callback failures cannot replace a native primary.
        for(const callback of listeners||[])try{callback();}catch{}
      }
    }
  }
  /** Internal lifetime notification; does not expose the native owner through DTOs. */
  onRetire(cap: unknown, callback: (error?: unknown, failed?: boolean) => void): () => void {
    this.require(cap);
    let listeners = this.retirementListeners.get(cap as object);
    if (!listeners) { listeners = new Set(); this.retirementListeners.set(cap as object,listeners); }
    listeners.add(callback); return () => { listeners!.delete(callback); };
  }
  private retire(cap: unknown, status: BattleParentObservation['status'], error?: unknown, failed = false): void {
    if (!cap || typeof cap !== 'object') return;
    const parent = this.parents.get(cap);
    if (!parent) return;
    try { const success = parent.runner.scriptSuccess; if (typeof success === 'boolean') this.successes.set(cap,success); } catch { /* preserve an existing body error */ }
    this.parents.delete(cap);
    const listeners=this.retirementListeners.get(cap);this.retirementListeners.delete(cap);
    for(const callback of listeners || []) { try { callback(error,failed); } catch { /* retain native primary failure */ } }
    parent.observation.children = parent.runtime.battleFrames(parent.observation.id);
    parent.observation.status = status;
    parent.runtime.retireBattleOrigin(parent.observation.id);
    if (this.current === cap) { this.current = null; this.last = parent.observation; }
    // Retirement is bookkeeping, never arbitrary Native cancellation. Cleanup cannot replace a body error.
    try { this.deps!.world.releaseCancellableExecutionScope(parent.scope); } catch { /* metadata release only */ }
  }
  observe(): BattleParentObservation | null {
    const parent = this.current && this.parents.get(this.current);
    if (parent && !this.checkedMatches(this.current,parent)) this.retire(this.current,'retired');
    const live = this.current && this.parents.get(this.current);
    const value = live ? {...live.observation, children: live.runtime.battleFrames(live.observation.id)} : this.last;
    return value ? {...value, invoker: value.invoker ? {...value.invoker} : null, children: value.children.map(row => ({...row}))} : null;
  }
  dispose(): void { this.invalidate(); this.disposed = true; this.deps = null; }
}
export const battleScriptExecution = new BattleScriptExecution();
