import {readRewardNativeRuntime} from './battle-reward-runtime';
import { ExecutionScheduler, detachedData, type ExecutionOwner, type DispatchResult } from './execution-scheduler';
import { copyEndScriptCursor, discardBattleEndScriptReturn, type BattleEndScriptCursor, type BattleEndScriptPublicCursor } from './battle-end-script-cursor';
import { OwnedBattleCancelled, isOwnedBattleCancelled } from './battle-command-runtime';
import type { BattleScriptExecution } from './battle-script-execution';
import type { BattleLoopRuntime } from './battle-loop-runtime';
export type BattleEndScriptProfile = 'legacy' | 'owned-cursor';
export function validateBattleEndScriptProfile(profile: unknown, execution: unknown, command: unknown, script: unknown): void {
    if (profile !== 'legacy' && profile !== 'owned-cursor')
        throw new TypeError('unknown battle end script profile');
    if (profile === 'owned-cursor' && (execution !== 'round-boundary' || command !== 'owned-command' || script !== 'owned-parent'))
        throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
}
export interface EndScriptBinding {
    enemy: any;
    maxEnemyIndex?: number;
    enemyList?: any;
}
interface Runner {
    getExecutionRuntime(): {
        identity: string;
        owns(frame: any, owner?: object): boolean;
    };
    scriptSuccess: boolean;
    curEquipPart: number;
}
interface Dependencies {
    scripts: BattleScriptExecution;
    loop: BattleLoopRuntime;
    world: {
        registerCancellableExecutionScope(scope: any): void;
        releaseCancellableExecutionScope(scope: any): void;
    };
}
export interface BattleEndScriptObservation {
    id: string;
    parent: string;
    context: string;
    battle: number;
    runtime: string;
    state: 'running' | 'requested' | 'paused' | 'returned' | 'retired';
    request: number | null;
    revision: number | null;
    cursor: BattleEndScriptPublicCursor;
}
interface Live {
    parent: unknown;
    region: object;
    maxEnemyIndex: number | undefined;
    runner: Runner;
    runtime: ReturnType<Runner['getExecutionRuntime']>;
    frames: Set<any>;
    cursor: BattleEndScriptCursor;
    enemy: unknown;
    enemyList: unknown;
    objectId: number;
    entry: number;
    parkedState: {result:unknown;party:string}|null;
    readBinding: (() => EndScriptBinding) | null;
    observation: BattleEndScriptObservation;
    scope: {
        clear(): void;
        check(): void;
    };
    unsubscribe: (() => void) | null;
    owner: ExecutionOwner<'battle.end-script'> | null;
    request: number | null;
    wake: (() => void) | null;
    reject: ((error: unknown) => void) | null;
    endTiming: (() => void) | null;
    failed: boolean;
    failure: unknown;
}
let sequence = 0, requests = 0;
const unwrap = (v: any) => {
    while (v?.__raw__ && v.__raw__ !== v)
        v = v.__raw__;
    return v;
};
function equal(a: any, b: any): boolean {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
        return a === b;
    const keys = Object.keys(b);
    return Object.keys(a).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(a, k) && equal(a[k], b[k]));
}
/** Private exact-child authority. DTOs can answer a live scheduler wait but cannot manufacture one. */
export class BattleEndScriptRuntime {
    private installed = false;
    private enabled = false;
    private disposed = false;
    private deps: Dependencies | null = null;
    private current: Live | null = null;
    private last: BattleEndScriptObservation | null = null;
    private live = new Set<Live>();
    private scheduler = new ExecutionScheduler<'battle.end-script', BattleEndScriptObservation, boolean, boolean>();
    get owned() { return this.enabled; }
    get liveReferences() { return this.live.size; }
    install(profile: unknown, deps: Dependencies): void {
        if (profile !== 'legacy' && profile !== 'owned-cursor')
            throw new TypeError('unknown battle end script profile');
        if (this.installed)
            throw new Error('battle end script profile is boot-only');
        this.installed = true;
        this.enabled = profile === 'owned-cursor';
        this.deps = deps;
    }
    capture(parent: unknown, runner: Runner, cursor: BattleEndScriptCursor, readBinding: () => EndScriptBinding): Live | null {
        if (!this.enabled)
            return null;
        if (this.disposed || this.current)
            throw new Error('end script child already active or disposed');
        const d = this.deps!;
        d.scripts.validate(parent, runner as any);
        const p = d.scripts.observe()!, binding = readBinding(), enemy = binding.enemy;
        if (!enemy || enemy.objectID !== cursor.source.objectId)
            throw new OwnedBattleCancelled('end script slot changed');
        if (this.scheduler.inTransition || this.scheduler.peek())
            throw new Error('end script scheduler transition active');
        if (this.scheduler.snapshot().error !== null)
            this.scheduler.clearError();
        const observation: BattleEndScriptObservation = { id: `battle-end-script:${++sequence}`, parent: p.id, context: p.context!, battle: p.battle!, runtime: readRewardNativeRuntime(runner).identity, state: 'running', request: null, revision: null, cursor: copyEndScriptCursor(cursor) };
        const field = 'scriptOnBattleEnd';
        const l: Live = { parent, region:d.loop.captureRewardsScriptRegion(parent), maxEnemyIndex:binding.maxEnemyIndex, runner, runtime: readRewardNativeRuntime(runner), frames: new Set(), cursor,
            enemy: unwrap(enemy), enemyList:unwrap(binding.enemyList), objectId: enemy.objectID, entry: enemy[field],
            parkedState: null, readBinding, observation, unsubscribe: null, owner: null, request: null, wake: null, reject: null,
            endTiming: null, failed: false, failure: undefined, scope: { clear: () => this.retire(l, 'world disposed'), check: () => this.check(l) } };
        this.current = l;
        this.live.add(l);
        try {
            d.world.registerCancellableExecutionScope(l.scope);
            l.unsubscribe = d.scripts.onRetire(parent, (error, failed) => this.retire(l, 'parent retired', error, failed));
        }
        catch (error) {
            this.retire(l, 'capture failed', error, true);
            throw error;
        }
        return l;
    }
    bindFrame(l: Live, frame: any): void {
        this.assert(l);
        if (!l.runtime.owns(frame, l.runner))
            throw new Error('unowned end script child frame');
        l.frames.add(frame);
    }
    releaseFrame(l: Live, frame: any): void { l.frames.delete(frame); }
    inheritFrame(parent: any, frame: any, runner: Runner): Live | null {
        const l = this.current;
        if (!l || l.runner !== runner || !parent || !l.frames.has(parent))
            return null;
        this.bindFrame(l, frame);
        return l;
    }
    /** Acknowledgement inside the selected original transform writer, before its notification. */
    noteEnemyTransformed(frame: any, index: number, enemy: any): void {
        const l = this.current;
        if (!l || !frame || !l.frames.has(frame) || l.cursor.source.enemyIndex !== index)
            return;
        if (!this.validParent(l) || unwrap(enemy) !== l.enemy)
            throw new OwnedBattleCancelled('enemy transform target changed');
        l.objectId = enemy.objectID;
    }
    private validParent(l: Live): boolean {
        if (!this.live.has(l) || this.disposed || !l.readBinding)
            return false;
        if(l.runtime !== readRewardNativeRuntime(l.runner) || ![...l.frames].every(frame=>l.runtime.owns(frame,l.runner)))return false;
        this.deps!.loop.assertRewardsScriptParent(l.parent,l.region);
        this.deps!.scripts.validate(l.parent, l.runner as any);
        if (l.observation.state === 'paused' && (!this.deps!.loop.prepareRewardsScriptPause(l.parent) || !equal(this.deps!.loop.rewardsScriptState(l.parent), l.parkedState))) return false;
        return l.runtime === readRewardNativeRuntime(l.runner) && [...l.frames].every(frame => l.runtime.owns(frame, l.runner));
    }
    private valid(l: Live): boolean {
        if (!this.validParent(l))
            return false;
        const binding = l.readBinding!(), enemy = binding.enemy;
        const field = 'scriptOnBattleEnd';
        if (unwrap(binding.enemyList)!==l.enemyList || (l.observation.state === 'paused' && !Object.is(binding.maxEnemyIndex,l.maxEnemyIndex)) || unwrap(enemy) !== l.enemy || enemy?.objectID !== l.objectId)
            return false;
        return Object.is(enemy[field],l.entry);
    }
    private check(l: Live): boolean {
        try {
            if (this.valid(l))
                return true;
        }
        catch (error) {
            if (!isOwnedBattleCancelled(error) && (l.failed || this.live.has(l))) {
                this.retire(l, 'end script validation failed', error, true);
                throw error;
            }
        }
        this.retire(l, 'end script slot changed');
        return false;
    }
    assert(l: Live): void {
        if (!this.check(l)) {
            if (l.failed)
                throw l.failure;
            throw new OwnedBattleCancelled('end script child retired');
        }
    }
    requestBattleEndScriptPause(): any {
        const l = this.current;
        if (!this.enabled || !l || !this.check(l))
            return { ok: false, reason: 'unsupported' };
        if (l.request !== null || l.owner)
            return { ok: false, reason: 'busy' };
        l.request = ++requests;
        l.observation.state = 'requested';
        l.observation.request = l.request;
        return this.requestDTO(l);
    }
    private requestDTO(l: Live) { return { ok: true, id: l.observation.id, parent: l.observation.parent, context: l.observation.context, battle: l.observation.battle, request: l.request }; }
    cancelRequest(value: unknown): DispatchResult {
        let dto: any;
        try {
            dto = detachedData(value);
        }
        catch {
            return { ok: false, reason: 'invalid' };
        }
        const l = this.current;
        if (!l || !this.check(l) || l.owner || l.request === null || !equal(dto, this.requestDTO(l)))
            return { ok: false, reason: 'stale' };
        l.request = null;
        l.observation.request = null;
        l.observation.state = 'running';
        return { ok: true };
    }
    observe(): BattleEndScriptObservation | null {
        const l = this.current;
        if (l)
            this.check(l);
        const live = this.current;
        if (live)
            live.cursor.registers = { scriptSuccess: live.runner.scriptSuccess, curEquipPart: live.runner.curEquipPart };
        return live ? detachedData({ ...live.observation, cursor: copyEndScriptCursor(live.cursor) }) : detachedData(this.last);
    }
    pauseAt(l: Live): Promise<void> | null {
        this.assert(l);
        const f = l.cursor.frames[l.cursor.frames.length - 1];
        if (!this.deps!.loop.rewardsScriptEligible(l.parent) || l.request === null || l.owner || f.effect !== 'explicit' || f.frameWait?.stage !== 'sleep')
            return null;
        const d = this.deps!, request = l.request;
        if (!d.loop.prepareRewardsScriptPause(l.parent))
            return null;
        if (!this.check(l) || l.request !== request || l.observation.state !== 'requested' || !d.loop.rewardsScriptEligible(l.parent)) {
            d.loop.releaseRewardsScriptPause(l.parent);
            return null;
        }
        let resolve!: () => void, reject!: (error: unknown) => void;
        const gate = new Promise<void>((a, b) => { resolve = a; reject = b; });
        l.wake = resolve;
        l.reject = reject;
        try {
            // Every fallible/reentrant probe after installing reject belongs to
            // this unpublished-gate cleanup boundary, including state capture.
            // The native traversal may grow while running; freeze only this cut.
            l.maxEnemyIndex=l.readBinding!().maxEnemyIndex;
            l.parkedState = d.loop.rewardsScriptState(l.parent);
            l.observation.state = 'paused';
            l.endTiming = d.loop.suspendRewardsScriptPause(l.parent,()=>this.check(l)&&l.request===request&&l.observation.state==='paused');
            if(!l.endTiming||!this.check(l)||l.request!==request||l.observation.state!=='paused') {
                void gate.catch(()=>{}); // Only this never-published gate is consumed here.
                d.loop.releaseRewardsScriptPause(l.parent);l.endTiming=null;l.wake=null;l.reject=null;l.parkedState=null;
                if(this.live.has(l)){l.observation.state=l.request===null?'running':'requested';l.observation.revision=null;}
                return null;
            }
            l.owner = this.scheduler.publish('battle.end-script', this.observe()!, { ready: () => this.valid(l), stage: () => ({ ok: true }), accept: () => true, commit: () => {
                    const end = l.endTiming;
                    l.endTiming = null;
                    end?.();
                    d.loop.releaseRewardsScriptPause(l.parent);
                    this.assert(l);
                    l.owner = null;
                    l.request = null;
                    l.observation.request = null;
                    l.observation.revision = null;
                    l.observation.state = 'running';
                    l.wake = null;
                    l.reject = null;
                    resolve();
                }, cancel: () => { } });
            l.observation.revision = l.owner.revision;
        }
        catch (error) {
            // A probe or publication failed before the caller received this gate. Consume only
            // this unpublished rejection; the synchronous primary failure still escapes.
            void gate.catch(() => { });
            this.retire(l, 'pause failure', error, true);
            throw error;
        }
        return gate;
    }
    resume(value: unknown): DispatchResult {
        let dto: any;
        try {
            dto = detachedData(value);
        }
        catch {
            return { ok: false, reason: 'invalid' };
        }
        const l = this.current;
        if (!l || !this.check(l) || !l.owner || !equal(dto, this.observe()))
            return { ok: false, reason: 'stale' };
        const owner = l.owner;
        try {
            const staged=this.scheduler.stage(owner,'battle.end-script',true);
            if(!staged.ok){if(staged.reason!=='busy')this.retire(l,'pause ineligible');return staged;}
            const result = this.scheduler.resume(owner, 'battle.end-script');
            if (!result.ok) this.retire(l, 'pause ineligible');
            return result;
        }
        catch (error) {this.retire(l, 'resume failed', error, true);throw error;}
        finally {
            // A scope can retire reentrantly while the scheduler is guarded.
            // Once that transition has exited, retire only this exact old ticket.
            if(!this.live.has(l)){try{this.scheduler.cancel(owner,'battle.end-script');}catch{/* retain primary failure */}}
        }
    }
    discardReturned(l: Live): void {this.assert(l);discardBattleEndScriptReturn(l.cursor);}
    release(l: Live | null, error?: unknown, failed = false): void {
        if (l)
            this.retire(l, 'child returned', error, failed);
    }
    private retire(l: Live, reason: string, error?: unknown, failed = false): void {
        if (!this.live.delete(l))
            return;
        l.failed = failed;
        l.failure = error;
        const owner = l.owner, reject = l.reject;
        l.owner = null;
        l.wake = null;
        l.reject = null;
        l.endTiming = null;
        l.request = null;
        l.readBinding = null;
        l.enemy = null;
        l.enemyList = null;
        l.frames.clear();
        l.unsubscribe?.();
        l.unsubscribe = null;
        l.parkedState = null;
        l.observation.state = reason === 'child returned' && !failed && l.cursor.stage === 'returned' ? 'returned' : 'retired';
        l.observation.request = null;
        l.observation.revision = null;
        if (this.current === l) {
            this.current = null;
            this.last = detachedData({ ...l.observation, cursor: copyEndScriptCursor(l.cursor) });
        }
        try {
            if (owner)
                this.scheduler.cancel(owner, 'battle.end-script');
        }
        catch { /* retain primary error */ }
        try {
            this.deps!.loop.releaseRewardsScriptPause(l.parent);
        }
        catch { /* metadata cleanup */ }
        try {
            this.deps!.world.releaseCancellableExecutionScope(l.scope);
        }
        catch { /* metadata cleanup */ }
        reject?.(failed ? error : new OwnedBattleCancelled(reason));
    }
    dispose(): void {
        if (this.current)
            this.retire(this.current, 'runtime disposed');
        this.disposed = true;
        this.scheduler.dispose();
        this.deps = null;
    }
}
export const battleEndScriptRuntime = new BattleEndScriptRuntime();
