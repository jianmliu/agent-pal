import { ExecutionScheduler, detachedData, type ExecutionOwner, type DispatchResult } from './execution-scheduler';
import { copyPreBattleScriptCursor, writePreBattleScriptReturn, type BattlePreBattleScriptCursor } from './battle-prebattle-script-cursor';
import { OwnedBattleCancelled, isOwnedBattleCancelled } from './battle-command-runtime';
import type { BattleScriptExecution } from './battle-script-execution';
import type { BattleLoopRuntime } from './battle-loop-runtime';
export type BattlePreBattleScriptProfile = 'legacy' | 'owned-cursor';
export function validateBattlePreBattleScriptProfile(profile: unknown, execution: unknown, command: unknown, script: unknown): void {
    if (profile !== 'legacy' && profile !== 'owned-cursor')
        throw new TypeError('unknown battle prebattle script profile');
    if (profile === 'owned-cursor' && (execution !== 'round-boundary' || command !== 'owned-command' || script !== 'owned-parent'))
        throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
}
export interface PreBattleScriptBinding {
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
export interface BattlePreBattleScriptObservation {
    id: string;
    parent: string;
    context: string;
    battle: number;
    runtime: string;
    state: 'running' | 'requested' | 'paused' | 'returned' | 'retired';
    request: number | null;
    revision: number | null;
    cursor: BattlePreBattleScriptCursor;
}
interface Live {
    parent: unknown;
    region: object;
    maxEnemyIndex: number | undefined;
    runner: Runner;
    runtime: ReturnType<Runner['getExecutionRuntime']>;
    frames: Set<any>;
    cursor: BattlePreBattleScriptCursor;
    enemy: unknown;
    enemyList: unknown;
    objectId: number;
    entry: number;
    returning: boolean;
    returnBound: boolean;
    readBinding: (() => PreBattleScriptBinding) | null;
    observation: BattlePreBattleScriptObservation;
    scope: {
        clear(): void;
        check(): void;
    };
    unsubscribe: (() => void) | null;
    owner: ExecutionOwner<'battle.prebattle-script'> | null;
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
export class BattlePreBattleScriptRuntime {
    private installed = false;
    private enabled = false;
    private disposed = false;
    private deps: Dependencies | null = null;
    private current: Live | null = null;
    private last: BattlePreBattleScriptObservation | null = null;
    private live = new Set<Live>();
    private scheduler = new ExecutionScheduler<'battle.prebattle-script', BattlePreBattleScriptObservation, boolean, boolean>();
    get owned() { return this.enabled; }
    get liveReferences() { return this.live.size; }
    install(profile: unknown, deps: Dependencies): void {
        if (profile !== 'legacy' && profile !== 'owned-cursor')
            throw new TypeError('unknown battle prebattle script profile');
        if (this.installed)
            throw new Error('battle prebattle script profile is boot-only');
        this.installed = true;
        this.enabled = profile === 'owned-cursor';
        this.deps = deps;
    }
    capture(parent: unknown, runner: Runner, cursor: BattlePreBattleScriptCursor, readBinding: () => PreBattleScriptBinding): Live | null {
        if (!this.enabled)
            return null;
        if (this.disposed || this.current)
            throw new Error('prebattle script child already active or disposed');
        const d = this.deps!;
        d.scripts.validate(parent, runner as any);
        const p = d.scripts.observe()!, binding = readBinding(), enemy = binding.enemy;
        if (!enemy || enemy.objectID !== cursor.source.objectId)
            throw new OwnedBattleCancelled('prebattle script slot changed');
        if (this.scheduler.inTransition || this.scheduler.peek())
            throw new Error('prebattle script scheduler transition active');
        if (this.scheduler.snapshot().error !== null)
            this.scheduler.clearError();
        const observation: BattlePreBattleScriptObservation = { id: `battle-prebattle-script:${++sequence}`, parent: p.id, context: p.context!, battle: p.battle!, runtime: runner.getExecutionRuntime().identity, state: 'running', request: null, revision: null, cursor };
        const field = 'scriptOnTurnStart';
        const l: Live = { parent, region:d.loop.capturePreBattleRegion(parent), maxEnemyIndex:binding.maxEnemyIndex, runner, runtime: runner.getExecutionRuntime(), frames: new Set(), cursor,
            enemy: unwrap(enemy), enemyList:unwrap(binding.enemyList), objectId: enemy.objectID, entry: enemy[field],
            returning: false, returnBound: false, readBinding, observation, unsubscribe: null, owner: null, request: null, wake: null, reject: null,
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
            throw new Error('unowned prebattle script child frame');
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
        this.deps!.scripts.validate(l.parent, l.runner as any);
        this.deps!.loop.assertPreBattleParent(l.parent,l.region);
        if (l.observation.state === 'paused' && !this.deps!.loop.preBattleEligible(l.parent)) return false;
        return l.runtime === l.runner.getExecutionRuntime() && [...l.frames].every(frame => l.runtime.owns(frame, l.runner));
    }
    private valid(l: Live): boolean {
        if (!this.validParent(l))
            return false;
        const binding = l.readBinding!(), enemy = binding.enemy;
        const field = 'scriptOnTurnStart';
        if (unwrap(binding.enemyList)!==l.enemyList || (l.observation.state === 'paused' && !Object.is(binding.maxEnemyIndex,l.maxEnemyIndex)) || unwrap(enemy) !== l.enemy || enemy?.objectID !== l.objectId)
            return false;
        if (Object.is(enemy[field], l.entry))
            return true;
        const next = l.cursor.nextEntry;
        const expected = (Number.isFinite(next) && next! > 0 ? next : l.cursor.source.resolvedEntry);
        if (l.returning && !l.returnBound && l.cursor.stage === 'write-next-entry' && enemy[field] === expected) {
            l.entry = enemy[field];
            l.returnBound = true;
            return true;
        }
        return false;
    }
    private check(l: Live): boolean {
        try {
            if (this.valid(l))
                return true;
        }
        catch (error) {
            if (!isOwnedBattleCancelled(error) && (l.failed || this.live.has(l))) {
                this.retire(l, 'prebattle script validation failed', error, true);
                throw error;
            }
        }
        this.retire(l, 'prebattle script slot changed');
        return false;
    }
    assert(l: Live): void {
        if (!this.check(l)) {
            if (l.failed)
                throw l.failure;
            throw new OwnedBattleCancelled('prebattle script child retired');
        }
    }
    requestBattlePreBattleScriptPause(): any {
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
    observe(): BattlePreBattleScriptObservation | null {
        const l = this.current;
        if (l)
            this.check(l);
        const live = this.current;
        if (live)
            live.cursor.registers = { scriptSuccess: live.runner.scriptSuccess, curEquipPart: live.runner.curEquipPart };
        return live ? detachedData({ ...live.observation, cursor: copyPreBattleScriptCursor(live.cursor) }) : detachedData(this.last);
    }
    pauseAt(l: Live): Promise<void> | null {
        this.assert(l);
        const f = l.cursor.frames[l.cursor.frames.length - 1];
        if (!this.deps!.loop.preBattleEligible(l.parent) || l.request === null || l.owner || f.effect !== 'explicit' || f.frameWait?.stage !== 'sleep')
            return null;
        const d = this.deps!, request = l.request;
        if (!d.loop.preparePreBattlePause(l.parent))
            return null;
        if (!this.check(l) || l.request !== request || l.observation.state !== 'requested' || !d.loop.preBattleEligible(l.parent)) {
            d.loop.releaseChildPause(l.parent);
            return null;
        }
        let resolve!: () => void, reject!: (error: unknown) => void;
        const gate = new Promise<void>((a, b) => { resolve = a; reject = b; });
        l.wake = resolve;
        l.reject = reject;
        // The native traversal may grow through original opaque gameplay. Freeze
        // its current maximum only for this actual parked wait.
        l.maxEnemyIndex=l.readBinding!().maxEnemyIndex;
        l.observation.state = 'paused';
        try {
            l.endTiming = d.loop.suspendPreBattlePause(l.parent);
            l.owner = this.scheduler.publish('battle.prebattle-script', this.observe()!, { ready: () => this.valid(l), stage: () => ({ ok: true }), accept: () => true, commit: () => {
                    const end = l.endTiming;
                    l.endTiming = null;
                    end?.();
                    d.loop.releaseChildPause(l.parent);
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
            // Publication failed before the caller could receive this gate. Consume only
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
        const owner = l.owner, staged = this.scheduler.stage(owner, 'battle.prebattle-script', true);
        if (!staged.ok)
            return staged;
        try {
            const result = this.scheduler.resume(owner, 'battle.prebattle-script');
            if (!result.ok)
                this.retire(l, 'pause ineligible');
            return result;
        }
        catch (error) {
            this.retire(l, 'resume failed', error, true);
            throw error;
        }
    }
    writeReturned(l: Live, writer: (entry: number) => void): void {
        this.assert(l);
        l.returning = true;
        l.returnBound = false;
        try {
            writePreBattleScriptReturn(l.cursor, writer);
        }
        finally {
            l.returning = false;
        }
    }
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
        l.returning = false;
        l.observation.state = reason === 'child returned' && !failed && l.cursor.stage === 'returned' ? 'returned' : 'retired';
        l.observation.request = null;
        l.observation.revision = null;
        if (this.current === l) {
            this.current = null;
            this.last = detachedData({ ...l.observation, cursor: copyPreBattleScriptCursor(l.cursor) });
        }
        try {
            if (owner)
                this.scheduler.cancel(owner, 'battle.prebattle-script');
        }
        catch { /* retain primary error */ }
        try {
            this.deps!.loop.releaseChildPause(l.parent);
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
export const battlePreBattleScriptRuntime = new BattlePreBattleScriptRuntime();
