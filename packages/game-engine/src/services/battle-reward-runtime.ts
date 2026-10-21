import {retainBattleRewardTask,battleRewardTaskCount,rewardRunnerIdentity} from './battle-reward-fence';
import type {RewardWaitScope} from './battle-reward-wait';
import { ExecutionScheduler, detachedData, type ExecutionOwner, type DispatchResult } from './execution-scheduler';
import {copyBattleRewardCursor, rewardEffectReserved, releaseRewardCursor, type BattleRewardCursor} from './battle-reward-cursor';
import { OwnedBattleCancelled, isOwnedBattleCancelled } from './battle-command-runtime';
import {onBattleScriptTaskFinish,type BattleScriptExecution} from './battle-script-execution';
import type { BattleLoopRuntime } from './battle-loop-runtime';
export type BattleRewardProfile = 'legacy' | 'owned-cursor';
export function validateBattleRewardProfile(profile: unknown, execution: unknown, command: unknown, script: unknown): void {
    if (profile !== 'legacy' && profile !== 'owned-cursor')
        throw new TypeError('unknown battle reward profile');
    if (profile === 'owned-cursor' && (execution !== 'round-boundary' || command !== 'owned-command' || script !== 'owned-parent'))
        throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
}
export interface RewardBinding {source:unknown; aliases?:unknown[]; data?:any; helpers?:Runner[];}
interface Runner { getExecutionRuntime(): {identity:string}; }
interface Dependencies {
    scripts: BattleScriptExecution;
    loop: BattleLoopRuntime;
    world: {
        registerCancellableExecutionScope(scope: any): void;
        releaseCancellableExecutionScope(scope: any): void;
    };
}
export interface BattleRewardObservation {
    id: string;
    parent: string;
    context: string;
    battle: number;
    runtime: string;
    state: 'running' | 'requested' | 'paused' | 'returned' | 'retired';
    request: number | null;
    revision: number | null;
    cursor: BattleRewardCursor;
}
export interface RewardServiceSelection {readonly service:object;readonly helper:object;readonly runtime:object;}
// Identity aliases carry no selection authority. Lazy hoisted storage avoids the existing service ESM cycle.
var rewardServiceAliases:WeakMap<object,object>|undefined;
export function registerRewardServiceFacade(facade:object,target:object):void {
 rewardServiceAliases??=new WeakMap();
 if(rewardServiceAliases.has(facade)||rewardServiceAliases.has(target))throw new Error('reward service identity already bound');
 rewardServiceAliases.set(facade,target);rewardServiceAliases.set(target,target);
}
// Read-only consumer query; only actual owned settlement probes enter this guard.
let rewardProviderProbeDepth=0;
export function rewardServiceProviderProbeActive():boolean {return rewardProviderProbeDepth>0;}
function rewardProviderProbe<T>(probe:()=>T):T {rewardProviderProbeDepth++;try{return probe();}finally{rewardProviderProbeDepth--;}}
const retainedRuntimeReaders=new WeakMap<object,Set<object>>(),parentRuntimeReaders=new WeakMap<object,readonly object[]>();
/** Fixed metadata read only; no caller callback, registration or private capability is exposed. */
export function readRewardNativeRuntime<T>(runner:{getExecutionRuntime():T}):T {
 return retainedRuntimeReaders.get(runner)?.size?rewardProviderProbe(()=>runner.getExecutionRuntime()):runner.getExecutionRuntime();
}
function retainRuntimeReaders(parent:object,runners:readonly object[]):void {
 const exact=[...new Set([...(parentRuntimeReaders.get(parent)||[]),...runners])];parentRuntimeReaders.set(parent,exact);
 for(const runner of exact){let tasks=retainedRuntimeReaders.get(runner);if(!tasks){tasks=new Set();retainedRuntimeReaders.set(runner,tasks);}tasks.add(parent);}
}
const serviceOpacity=new WeakMap<object,Set<object>>(),opacityParents=new WeakMap<object,object>();
const selectionRecords=new WeakMap<object,{parent:object;canonical:object;ids:readonly string[]}>(),serviceSelections=new WeakMap<object,Set<RewardServiceSelection>>(),originSelections=new Map<string,Set<RewardServiceSelection>>(),parentSelections=new WeakMap<object,RewardServiceSelection>();
const serviceKey=(service:object)=>rewardServiceAliases?.get(service)||service;
export function hasBattleRewardService(service:object):boolean {return !!serviceOpacity.get(serviceKey(service))?.size;}
function matchesRewardServiceSelection(binding:RewardServiceSelection):boolean {
 const record=selectionRecords.get(binding);if(!record||!serviceSelections.get(record.canonical)?.has(binding))return false;
 const selected=Object.getOwnPropertyDescriptor(record.canonical,'module'),runtime=Object.getOwnPropertyDescriptor(binding.helper,'executionRuntime');
 return !!selected&&'value'in selected&&selected.value===binding.helper&&!!runtime&&'value'in runtime&&runtime.value===binding.runtime;
}
export function assertRewardServiceSelection(binding:RewardServiceSelection):void {if(!matchesRewardServiceSelection(binding))throw new Error('Native battle task is opaque: selected helper receiver changed');}
export function assertRewardServiceProvider(binding:RewardServiceSelection):void {
 assertRewardServiceSelection(binding);
 if(rewardProviderProbe(()=>(binding.service as any).getModule())!==binding.helper||rewardProviderProbe(()=>(binding.helper as any).getExecutionRuntime())!==binding.runtime)throw new Error('Native battle task is opaque: selected helper provider changed');
 assertRewardServiceSelection(binding);
}
function retainServiceOpacity(parent:object,service:object):void {
 if(opacityParents.has(parent))throw new Error('native reward service already retained');
 const canonical=serviceKey(service);
 onBattleScriptTaskFinish(parent,()=>{
  if(opacityParents.get(parent)!==canonical)return;opacityParents.delete(parent);const readers=parentRuntimeReaders.get(parent);parentRuntimeReaders.delete(parent);for(const runner of readers||[]){const tasks=retainedRuntimeReaders.get(runner);tasks?.delete(parent);if(!tasks?.size)retainedRuntimeReaders.delete(runner);}const tasks=serviceOpacity.get(canonical);tasks?.delete(parent);if(!tasks?.size)serviceOpacity.delete(canonical);
  const binding=parentSelections.get(parent);if(!binding)return;parentSelections.delete(parent);const record=selectionRecords.get(binding);selectionRecords.delete(binding);const services=serviceSelections.get(canonical);services?.delete(binding);if(!services?.size)serviceSelections.delete(canonical);for(const id of record?.ids||[]){const origins=originSelections.get(id);origins?.delete(binding);if(!origins?.size)originSelections.delete(id);}
 });
 opacityParents.set(parent,canonical);let tasks=serviceOpacity.get(canonical);if(!tasks){tasks=new Set();serviceOpacity.set(canonical,tasks);}tasks.add(parent);
}
/** Read-only exact selection validation; no parent/grant/callback/raw-target is published. */
export function rewardServiceSelection(service:object):RewardServiceSelection|null {
 const selections=serviceSelections.get(serviceKey(service));if(!selections?.size)return null;
 if(selections.size!==1)throw new Error('Native battle task is opaque: service selection is ambiguous');
 const binding=[...selections][0];assertRewardServiceSelection(binding);return binding;
}
export function rewardRunnerServiceSelection(runner:object):RewardServiceSelection|null {
 const id=rewardRunnerIdentity(runner),selections=id?originSelections.get(id):undefined;if(!selections?.size)return null;
 if(selections.size!==1)throw new Error('Native battle task is opaque: Runner service selection is ambiguous');
 const binding=[...selections][0];assertRewardServiceSelection(binding);return binding;
}
function retainServiceSelection(parent:object,service:object,helper:object,runtime:object,ids:readonly string[]):void {
 if(parentSelections.has(parent))throw new Error('native reward service selection already retained');
 const canonical=serviceKey(service),binding=Object.freeze({service,helper,runtime}),record={parent,canonical,ids};
 parentSelections.set(parent,binding);selectionRecords.set(binding,record);let services=serviceSelections.get(canonical);if(!services){services=new Set();serviceSelections.set(canonical,services);}services.add(binding);for(const id of ids){let origins=originSelections.get(id);if(!origins){origins=new Set();originSelections.set(id,origins);}origins.add(binding);}
}
interface Live {
 parent:unknown; region:object;runner:Runner;runtime:ReturnType<Runner['getExecutionRuntime']>;
 vmBindings:{runner:Runner;runtime:ReturnType<Runner['getExecutionRuntime']>}[];
 cursor:BattleRewardCursor; binding:RewardBinding; parkedBinding:RewardBinding|null;
 parkedState:{result:unknown;party:string}|null;readBinding:(()=>RewardBinding)|null;
 observation:BattleRewardObservation;scope:{clear():void;check():void};unsubscribe:(()=>void)|null;
 owner:ExecutionOwner<'battle.rewards'>|null;request:number|null;wake:(()=>void)|null;reject:((e:unknown)=>void)|null;
 parkedFrames:unknown[]|null;parkedVm:any;parentRetired:boolean;waitScope:RewardWaitScope|null;endTiming:(()=>number|void)|null;failed:boolean;failure:unknown;
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
/** Private exact-settlement authority. DTOs can answer a live scheduler wait but cannot manufacture one. */
export class BattleRewardRuntime {
    private installed = false;
    private enabled = false;
    private disposed = false;
    private deps: Dependencies | null = null;
    private current: Live | null = null;
    private pending=new WeakMap<object,{parent:unknown;native:unknown;region:object;runner:Runner;runtime:ReturnType<Runner['getExecutionRuntime']>;helper:Runner|null;helperRuntime:ReturnType<Runner['getExecutionRuntime']>|null}>();
    private pendingParents=new WeakMap<object,object>();
    private last: BattleRewardObservation | null = null;
    private live = new Set<Live>();
    private scheduler = new ExecutionScheduler<'battle.rewards', BattleRewardObservation, boolean, boolean>();
    get owned() { return this.enabled; }
    get liveReferences() { return this.live.size; }
    get opaqueTasks(){return battleRewardTaskCount();}
    install(profile: unknown, deps: Dependencies): void {
        if (profile !== 'legacy' && profile !== 'owned-cursor')
            throw new TypeError('unknown battle reward profile');
        if (this.installed)
            throw new Error('battle reward profile is boot-only');
        this.installed = true;
        this.enabled = profile === 'owned-cursor';
        this.deps = deps;
    }
    beginSettlement(parent:unknown,native:unknown,helperService?:unknown):object {
      if(!this.enabled||this.disposed||this.current||this.pendingParents.has(parent as object))throw new Error('reward settlement unavailable');
      const d=this.deps!,callerIdentity=rewardProviderProbe(()=>d.loop.rewardSettlementRuntime(parent,native));
      if(helperService!==undefined)retainServiceOpacity(parent as object,helperService as object);
      return rewardProviderProbe(()=>{
      const runner=d.scripts.validate(parent,undefined,native);
      if(helperService!==undefined)retainRuntimeReaders(parent as object,[runner]);
      const own=(o:unknown,k:string)=>{const descriptor=Object.getOwnPropertyDescriptor(o as object,k);if(!descriptor||!('value' in descriptor))throw new TypeError('reward helper identity must be own data');return descriptor.value;};
      const helper=helperService===undefined?null:own(helperService,'module') as Runner;
      const helperIdentity=helper?rewardRunnerIdentity(helper):undefined;
      if(helper&&helperIdentity)retainRuntimeReaders(parent as object,[helper]);
      const identities=[callerIdentity,...(helper?[helperIdentity!]:[])];
      retainBattleRewardTask(parent as object,identities);
      const helperRuntime=helper?own(helper,'executionRuntime'):null;
      if(helper)retainServiceSelection(parent as object,helperService as object,helper as object,helperRuntime,identities);
      let region:object|null=null;
      try{
        if(helper&&own(helperRuntime,'identity')!==helperIdentity)throw new Error('reward helper identity changed');
        region=rewardProviderProbe(()=>d.loop.captureRewardSettlement(parent,native));
        const runtime=readRewardNativeRuntime(runner);
        if(runtime.identity!==callerIdentity||(helper&&rewardProviderProbe(()=>helper.getExecutionRuntime())!==helperRuntime))throw new Error('reward runtime identity changed');
        const token=Object.freeze({});this.pending.set(token,{parent,native,region,runner,runtime,helper,helperRuntime});this.pendingParents.set(parent as object,token);return token;
      }catch(error){if(region)try{d.loop.leaveRewardsScriptRegion(parent,region);}catch{}throw error;}
      });
    }
    closePending(token:object):void {const grant=this.pending.get(token);if(!grant)return;this.pending.delete(token);this.pendingParents.delete(grant.parent as object);this.deps!.loop.leaveRewardsScriptRegion(grant.parent,grant.region);}
    capture(parent:unknown,native:unknown,cursor:BattleRewardCursor,readBinding:()=>RewardBinding):Live|null {
      if(!this.enabled)return null;
      if(this.disposed||this.current)throw new Error('reward settlement already active or disposed');
      const token=this.pendingParents.get(parent as object),grant=token&&this.pending.get(token);
      if(!grant||grant.native!==native)throw new Error('reward settlement grant unavailable');
      this.pending.delete(token!);this.pendingParents.delete(parent as object);
      const d=this.deps!,{runner,runtime,region}=grant;
      let l:Live|null=null;
      try{
        const p=d.scripts.observe()!;
        copyBattleRewardCursor(cursor);
        const binding=rewardProviderProbe(readBinding);detachedData(binding.data??null);
        if(grant.helper&&(!(binding.helpers||[]).includes(grant.helper)))throw new Error('reward helper changed');
        if(this.scheduler.inTransition||this.scheduler.peek())throw new Error('reward scheduler transition active');
        if(this.scheduler.snapshot().error!==null)this.scheduler.clearError();
        if(runtime!==rewardProviderProbe(()=>readRewardNativeRuntime(runner)))throw new Error('reward runtime changed');
        const observation:BattleRewardObservation={id:`battle-rewards:${++sequence}`,parent:p.id,context:p.context!,battle:p.battle!,runtime:runtime.identity,state:'running',request:null,revision:null,cursor:copyBattleRewardCursor(cursor)};
        l={parent,region,runner,runtime,vmBindings:[{runner,runtime},...(grant.helper&&grant.helper!==runner?[{runner:grant.helper,runtime:grant.helperRuntime!}]:[])],cursor,binding,parkedBinding:null,parkedState:null,readBinding,observation,unsubscribe:null,owner:null,request:null,wake:null,reject:null,parkedFrames:null,parkedVm:null,parentRetired:false,waitScope:null,endTiming:null,failed:false,failure:undefined,scope:{clear:()=>this.retire(l!,'world disposed'),check:()=>this.check(l!)}};
        this.current=l;this.live.add(l);
        d.world.registerCancellableExecutionScope(l.scope);
        const captured=l;l.unsubscribe=d.scripts.onRetire(parent,(error,failed)=>{captured.parentRetired=true;this.retire(captured,'parent retired',error,failed);});
        return l;
      }catch(error){
        if(l)this.retire(l,'capture failed',error,true);
        else{try{d.loop.leaveRewardsScriptRegion(parent,region);}catch{/* retain exact capture failure */}}
        throw error;
      }
    }
    private parentFrameState(l:Live):{frames:unknown[];data:any} {
      const frames:unknown[]=[],data:any[]=[];
      for(const binding of l.vmBindings){const vm=binding.runtime as any,runner=binding.runner as any;frames.push(vm,...(Array.isArray(vm.activeFrames)?vm.activeFrames:[]));data.push({vm:typeof vm.snapshot==='function'?vm.snapshot():null,scriptSuccess:runner.scriptSuccess??null,curEquipPart:runner.curEquipPart??null});}
      return {frames,data:detachedData(data)};
    }
    private valid(l:Live):boolean {return rewardProviderProbe(()=>this.validSource(l));}
    private validSource(l:Live):boolean {
      if(!this.live.has(l)||this.disposed||!l.readBinding)return false;
      const selection=parentSelections.get(l.parent as object);if(selection&&!matchesRewardServiceSelection(selection))return false;
      this.deps!.loop.assertRewardsScriptParent(l.parent,l.region);
      this.deps!.scripts.validate(l.parent,l.runner as any);
      if(l.vmBindings.some(binding=>binding.runtime!==binding.runner.getExecutionRuntime()))return false;
      const b=l.readBinding(),basis=l.parkedBinding||l.binding;detachedData(b.data??null);copyBattleRewardCursor(l.cursor);
      if(unwrap(b.source)!==unwrap(basis.source))return false;
      if((b.helpers||[]).length!==(l.binding.helpers||[]).length||(b.helpers||[]).some((helper,index)=>helper!==(l.binding.helpers||[])[index]))return false;
      if(l.observation.state==='paused'){
       const vm=this.parentFrameState(l);if(!l.parkedFrames||vm.frames.length!==l.parkedFrames.length||vm.frames.some((f,i)=>f!==l.parkedFrames![i])||!equal(vm.data,l.parkedVm))return false;
       if(!this.deps!.loop.prepareRewardsScriptPause(l.parent)||!equal(this.deps!.loop.rewardsScriptState(l.parent),l.parkedState))return false;
       if((b.aliases||[]).length!==(basis.aliases||[]).length||(b.aliases||[]).some((v,i)=>unwrap(v)!==unwrap(basis.aliases![i])))return false;
       if(!equal(b.data??null,basis.data??null))return false;
      }
      return true;
    }
    private check(l: Live): boolean {
        try {
            if (this.valid(l))
                return true;
        }
        catch (error) {
            const parentCancellation=l.parentRetired&&!l.failed&&error instanceof Error&&['battle script context changed','battle script invoker retired','invalid or retired battle script authority'].includes(error.message);
            if (!isOwnedBattleCancelled(error)&&!parentCancellation) {
                this.retire(l, 'reward validation failed', error, true);
                throw error;
            }
        }
        this.retire(l, 'reward source changed');
        return false;
    }
    assert(l: Live): void {
        if (!this.check(l)) {
            if (l.failed)
                throw l.failure;
            throw new OwnedBattleCancelled('reward settlement retired');
        }
    }
    requestBattleRewardPause(): any {
        const l = this.current;
        if (!this.enabled || !l || l.cursor.stage==='end-scripts' || !this.check(l))
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
    observe(): BattleRewardObservation | null {
        const l = this.current;
        if (l)
            this.check(l);
        const live = this.current;
        return live ? detachedData({ ...live.observation, cursor: copyBattleRewardCursor(live.cursor) }) : detachedData(this.last);
    }
    pauseAt(l: Live): Promise<void> | null {
        this.assert(l);
        if (l.request === null || l.owner || rewardEffectReserved(l.cursor) || !['summary-wait','level-wait','hidden-wait','magic-wait','before-end-scripts','before-recovery','completed-rewards'].includes(l.cursor.stage))
            return null;
        const d = this.deps!, request = l.request;
        if (!d.loop.prepareRewardsScriptPause(l.parent))
            return null;
        if (!this.check(l) || l.request !== request || l.observation.state !== 'requested') {
            d.loop.releaseRewardsScriptPause(l.parent);
            return null;
        }
        let resolve!: () => void, reject!: (error: unknown) => void;
        const gate = new Promise<void>((a, b) => { resolve = a; reject = b; });
        l.wake = resolve;
        l.reject = reject;
        const publication = {};
        const samePark = () => this.live.has(l) && this.current === l && l.request === request && l.observation.state === 'paused';
        const eligible = () => samePark() && this.check(l) && samePark();
        const abandon = (): Promise<void> | null => {
            // A retired native consumer still owns its original rejection.
            if (!this.live.has(l) || this.current !== l) return gate;
            void gate.catch(() => {});
            d.loop.releaseRewardsScriptPause(l.parent);
            l.endTiming=null;l.wake=null;l.reject=null;l.parkedState=null;l.parkedBinding=null;l.parkedFrames=null;l.parkedVm=null;
            l.observation.state=l.request===null?'running':'requested';l.observation.revision=null;
            resolve();
            return null;
        };
        try {
            // Every fallible/reentrant probe after installing reject belongs to
            // this unpublished-gate cleanup boundary, including state capture.
            // The native traversal may grow while running; freeze only this cut.
            const binding=rewardProviderProbe(l.readBinding!);
            l.parkedBinding={source:binding.source,aliases:binding.aliases?.slice(),data:detachedData(binding.data??null)};
            l.parkedState = d.loop.rewardsScriptState(l.parent);
            const frameState=rewardProviderProbe(()=>this.parentFrameState(l));l.parkedFrames=frameState.frames;l.parkedVm=frameState.data;
            l.observation.state = 'paused';
            l.endTiming = d.loop.suspendRewardsScriptPause(l.parent,()=>this.check(l)&&l.request===request&&l.observation.state==='paused');
            if(!l.endTiming||!this.check(l)||l.request!==request||l.observation.state!=='paused') {
                void gate.catch(()=>{}); // Only this never-published gate is consumed here.
                d.loop.releaseRewardsScriptPause(l.parent);l.endTiming=null;l.wake=null;l.reject=null;l.parkedState=null;l.parkedBinding=null;
                if(this.live.has(l)){l.observation.state=l.request===null?'running':'requested';l.observation.revision=null;}
                return null;
            }
            const payload = this.observe();
            if (!eligible() || !payload || payload.id !== l.observation.id || payload.state !== 'paused' || payload.request !== request) return abandon();
            const owner = this.scheduler.publish('battle.rewards', payload, { ready: () => this.valid(l), stage: () => ({ ok: true }), accept: () => true, commit: () => {
                    const end = l.endTiming;
                    l.endTiming = null;
                    const elapsed=end?.();
                    if(l.waitScope&&typeof elapsed==='number')l.waitScope.shift(elapsed);
                    d.loop.releaseRewardsScriptPause(l.parent);
                    this.assert(l);
                    l.owner = null;
                    l.request = null;
                    l.observation.request = null;
                    l.observation.revision = null;
                    l.observation.state = 'running';
                    l.parkedBinding=null;l.parkedState=null;l.parkedFrames=null;l.parkedVm=null;
                    l.wake = null;
                    l.reject = null;
                    resolve();
                }, cancel: () => { } }, publication);
            if (!eligible() || !this.scheduler.ownsPublication(publication, owner, 'battle.rewards')) {
                this.scheduler.cancelPublication(publication, 'battle.rewards');
                return abandon();
            }
            l.owner = owner;
            l.observation.revision = owner.revision;
            this.scheduler.forgetPublication(publication);
        }
        catch (error) {
            // A probe or publication failed before the caller received this gate. Consume only
            // this unpublished rejection; the synchronous primary failure still escapes.
            void gate.catch(() => { });
            try { this.scheduler.cancelPublication(publication, 'battle.rewards'); } catch { /* retain exact primary failure */ }
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
            const staged=this.scheduler.stage(owner,'battle.rewards',true);
            if(!staged.ok){if(staged.reason!=='busy')this.retire(l,'pause ineligible');return staged;}
            const result = this.scheduler.resume(owner, 'battle.rewards');
            if (!result.ok) this.retire(l, 'pause ineligible');
            return result;
        }
        catch (error) {this.retire(l, 'resume failed', error, true);throw error;}
        finally {
            // A scope can retire reentrantly while the scheduler is guarded.
            // Once that transition has exited, retire only this exact old ticket.
            if(!this.live.has(l)){try{this.scheduler.cancel(owner,'battle.rewards');}catch{/* retain primary failure */}}
        }
    }
    setWait(l:Live,scope:RewardWaitScope|null):void {this.assert(l);l.waitScope=scope;}
    enterEndScripts(l:Live):void {this.assert(l);this.deps!.loop.enterRewardEndScripts(l.parent,l.region);l.request=null;l.observation.request=null;l.observation.state='running';l.cursor.stage='end-scripts';}
    leaveEndScripts(l:Live):void {this.deps!.loop.leaveRewardEndScripts(l.parent,l.region);this.assert(l);l.cursor.stage='before-recovery';}
    release(l: Live | null, error?: unknown, failed = false): void {
        if (l)
            this.retire(l, 'child returned', error, failed);
    }
    private retire(l: Live, reason: string, error?: unknown, failed = false): void {
        if (!this.live.delete(l)){if(failed&&!l.failed){l.failed=true;l.failure=error;}return;}
        let cleanupFailed=false,cleanupError:unknown;
        const cleanup=(fn:()=>void)=>{try{fn();}catch(e){if(!failed&&!cleanupFailed){cleanupFailed=true;cleanupError=e;}}};
        l.failed=failed;l.failure=error;
        const owner=l.owner,reject=l.reject,waitScope=l.waitScope,parent=l.parent,region=l.region,unsubscribe=l.unsubscribe;
        l.owner=null;l.wake=null;l.reject=null;l.endTiming=null;l.request=null;l.readBinding=null;l.parkedBinding=null;l.waitScope=null;l.unsubscribe=null;l.parkedState=null;l.parkedFrames=null;l.parkedVm=null;
        releaseRewardCursor(l.cursor);
        l.observation.state=reason==='child returned'&&!failed&&l.cursor.stage==='returned'?'returned':'retired';l.observation.request=null;l.observation.revision=null;
        if(this.current===l){this.current=null;cleanup(()=>{this.last=detachedData({...l.observation,cursor:copyBattleRewardCursor(l.cursor)});});}
        // Unpublish the old scheduler owner before canceling its timer or waking its native consumer.
        cleanup(()=>{if(owner)this.scheduler.cancel(owner,'battle.rewards');});
        cleanup(()=>{unsubscribe?.();});
        const cancellation=new OwnedBattleCancelled(reason);
        cleanup(()=>{waitScope?.close(failed?error:cancellation,()=>l.failed?l.failure:cancellation);});
        cleanup(()=>{this.deps!.loop.releaseRewardsScriptPause(parent);this.deps!.loop.leaveRewardsScriptRegion(parent,region);});
        cleanup(()=>{this.deps!.world.releaseCancellableExecutionScope(l.scope);});
        l.vmBindings=[];l.binding={source:null,aliases:[],data:null};l.parent=null;l.region=null as any;l.runner=null as any;l.runtime=null as any;
        if(cleanupFailed){l.failed=true;l.failure=cleanupError;l.observation.state='retired';if(this.last?.id===l.observation.id)this.last.state='retired';}
        if(reject)queueMicrotask(()=>reject(l.failed?l.failure:new OwnedBattleCancelled(reason)));
        if(cleanupFailed)throw cleanupError;
    }
    dispose(): void {
        if (this.current)
            this.retire(this.current, 'runtime disposed');
        this.disposed = true;
        this.scheduler.dispose();
        this.deps = null;
    }
}
export const battleRewardRuntime = new BattleRewardRuntime();
