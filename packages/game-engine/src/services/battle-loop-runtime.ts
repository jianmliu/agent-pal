import {PartyComponent} from '../ecs/components/party';
import {BattleCommandsComponent} from '../ecs/components/battle-commands';
import {createBattleLoopCursor, advanceBattleLoopCursor, noteCompletedBattleRound, finishBattleLoopCursor, type BattleLoopCursor, type BattleLoopStage} from './battle-loop-cursor';
import {ExecutionScheduler, detachedData, type ExecutionOwner, type DispatchResult} from './execution-scheduler';
import {OwnedBattleCancelled, isOwnedBattleCancelled} from './battle-command-runtime';
import type {BattleScriptExecution} from './battle-script-execution';
export type BattleExecutionProfile = 'legacy' | 'round-boundary';
export type BattlePauseBoundary = 'initial-combat' | 'completed-round';
export function validateBattleExecutionProfile(profile: unknown, command: unknown, script: unknown): asserts profile is BattleExecutionProfile {
  if (profile !== 'legacy' && profile !== 'round-boundary') throw new TypeError('unknown battle execution profile');
  if (profile === 'round-boundary' && (command !== 'owned-command' || script !== 'owned-parent')) throw new TypeError('round-boundary requires owned-command and owned-parent');
}
interface Dependencies {
  battle: {getState(): any; getModule(): unknown; getCommands(): any; battleInstance: number};
  world: {getWorldWriter(): unknown; _partyView(): any; registerCancellableExecutionScope(scope: any): void; releaseCancellableExecutionScope(scope: any): void};
  scripts: BattleScriptExecution;
  commands: {assertRoot(root: any): void; preparePauseBoundary(root: any): boolean; releasePauseBoundary(root: any): void; rewardsPauseQuiescent?(): boolean};
  party?: {subscribe(listener: (event: any) => void): () => void};
  global(): unknown; ongoing(): boolean; preBattle?(): boolean;
}
export interface BattleLoopObservation {
  id: string; parent: string; context: string; battle: number; runtime: string;
  state: 'running' | 'requested' | 'paused' | 'retired'; cursor: BattleLoopCursor;
  boundary: BattlePauseBoundary | null; revision: number | null; request: number | null;
}
interface Live {
  parent: unknown; native: unknown; root: any; cursor: BattleLoopCursor; observation: BattleLoopObservation;
  activateTiming:((basis?:{raw:number;basis:number;writer:number})=>void)|null; suspendTiming: ((startedTicks?:number) => (endedTicks?:number) => number | void) | null; resumeTiming: (() => number | void) | null;
  readClock:(()=>number)|null; failed:boolean; failure:unknown;
  region: object | null; chargeBasis: {raw:number; basis:number; writer:number} | null; captureChargeBasis:(()=>{raw:number;basis:number;writer:number})|null;
  active: boolean; raw: unknown; world: unknown; global: unknown; party: string;
  scope: {clear(): void; check(): void}; unsubscribe: (() => void) | null;
  handle: object; frameToken: object | null; request: number | null; completion: boolean; completedFrame: number; owner: ExecutionOwner<'battle.pause'> | null;
  wake: (() => void) | null; reject: ((error: unknown) => void) | null;
}
const unwrap=(value:any)=>{while(value?.__raw__&&value.__raw__!==value)value=value.__raw__;return value;};
const completionHandles=new WeakMap<object,Live>();
const loopContexts=new WeakMap<object,{handle:object; token:object}>();
export function copyBattleLoopContext(source:object|undefined,target:object):void {if(source){const proof=loopContexts.get(source);if(proof)loopContexts.set(target,proof);}}
/** Internal native return signal. Not a method on the public headless runtime surface. */
export function markCompletedBattleRound(context:object):void {
  const proof=loopContexts.get(context),l=proof?completionHandles.get(proof.handle):undefined;
  if(l&&l.active&&l.frameToken===proof!.token&&l.cursor.nextStage==='frame')l.completion=true;
}
let sequence=0, requestSequence=0, presentationDomainSequence=0;
/** Private authority indexed by exact native source, never exposed in events. */
export class BattleLoopRuntime {
  private enabled=false; private installed=false; private disposed=false; private deps:Dependencies|null=null;
  private presentationLease:{domain:number;id:string;offsetTicks:number;phaseMs:number;phaseMode:boolean;parkedTicks:number|null;active:boolean;unsubscribe:(()=>void)|null}|null=null;
  private returnedParents=new WeakMap<object,number>();
  private rewardWonParents=new WeakMap<object,{domain:number;read:()=>number;native:unknown;runtime:string}>();
  private rewardSettlementRegions=new WeakSet<object>();
  private rewardEndRegions=new WeakMap<object,object>();
  private settledRewardParents=new WeakSet<object>();
  private rewardsRegions=new WeakMap<object,{token:object;domain:number;native:unknown;read:()=>number;context:string;writer:unknown;entity:number}>();
  private rewardsPauseHandles=new WeakMap<object,object>();
  private rewardsTiming=new WeakMap<object,{parent:object;region:object;domain:number;start:number;read:()=>number;guard:()=>boolean}>();
  private current:Live|null=null; private last:BattleLoopObservation|null=null;
  private capturedParents=new WeakSet<object>();
  private live=new Set<Live>(); private parents=new WeakMap<object,Live>();
  private scheduler=new ExecutionScheduler<'battle.pause',BattleLoopObservation,boolean,boolean>();
  private unsubscribeParty:(()=>void)|null=null;
  get liveReferences(){return this.live.size;}
  get owned(){return this.enabled;}
  install(profile:unknown,deps:Dependencies):void {
    if(profile!=='legacy'&&profile!=='round-boundary')throw new TypeError('unknown battle execution profile');
    if(this.installed)throw new Error('battle execution profile is boot-only');
    this.installed=true;this.enabled=profile==='round-boundary';this.deps=deps;
    if(this.enabled&&deps.party)this.unsubscribeParty=deps.party.subscribe(event=>{
      if(event.type==='disposed')this.invalidate('party adapter disposed');
      else if(event.type==='party'||event.type==='snapshot')this.check();
    });
  }
  private partyKey(){const p=this.deps!.world._partyView();return JSON.stringify([p.maxIndex,p.members.slice(0,p.maxIndex+1).map((m:any)=>m?.playerRole??null)]);}
  capture(parent:unknown,native:unknown,root:any,suspendTiming?:(startedTicks?:number)=>(endedTicks?:number)=>number|void,activateTiming?:(basis?:{raw:number;basis:number;writer:number})=>void,readClock?:()=>number,captureChargeBasis?:()=>{raw:number;basis:number;writer:number}):Live|null {
    if(!this.enabled)return null;
    if(this.disposed)throw new OwnedBattleCancelled('runtime disposed');
    if(this.current)throw new Error('battle loop already active');
    const d=this.deps!,runner=d.scripts.validate(parent,undefined,native),obs=d.scripts.observe()!;
    if(this.capturedParents.has(parent as object))throw new Error('native battle loop parent already captured');
    d.commands.assertRoot(root);
    // Recovery is confined to a newly validated native parent after the old task settled.
    if(this.scheduler.inTransition||this.scheduler.peek())throw new Error('battle pause transition is still active');
    if(this.scheduler.snapshot().error!==null)this.scheduler.clearError();
    this.capturedParents.add(parent as object);
    const cursor=createBattleLoopCursor();
    const live:Live={parent,native,root,cursor,activateTiming:activateTiming||null,suspendTiming:suspendTiming||null,resumeTiming:null,region:null,chargeBasis:null,captureChargeBasis:captureChargeBasis||null,readClock:readClock||null,failed:false,failure:undefined,active:false,raw:unwrap(d.battle.getState()),world:d.world.getWorldWriter(),global:d.global(),party:this.partyKey(),
      observation:{id:`battle-loop:${++sequence}`,parent:obs.id,context:obs.context!,battle:obs.battle!,runtime:runner.getExecutionRuntime().identity,state:'running',cursor,boundary:null,revision:null,request:null},
      handle:Object.freeze({}),frameToken:null,request:null,completion:false,completedFrame:-1,owner:null,wake:null,reject:null,
      scope:{clear:()=>this.retire(live,'world disposed'),check:()=>this.checkLive(live)},unsubscribe:null};
    this.current=live;this.live.add(live);completionHandles.set(live.handle,live);this.parents.set(parent as object,live);
    try {
      const lease={domain:++presentationDomainSequence,id:obs.id,offsetTicks:0,phaseMs:0,phaseMode:false,parkedTicks:null as number|null,active:false,unsubscribe:null as (()=>void)|null};this.presentationLease=lease;
      lease.unsubscribe=d.scripts.onRetire(parent,()=>{if(this.presentationLease===lease)this.presentationLease=null;lease.unsubscribe=null;});
      d.world.registerCancellableExecutionScope(live.scope);live.unsubscribe=d.scripts.onRetire(parent,(error,failed)=>this.retire(live,'battle parent retired',error,failed));}
    catch(error){this.release(live,error,true);throw error;}
    return live;
  }
  private valid(live:Live):boolean {
    if(!this.live.has(live)||this.disposed)return false;
    const d=this.deps!;
    d.scripts.validate(live.parent,undefined,live.native);d.commands.assertRoot(live.root);
    return live.raw===unwrap(d.battle.getState())&&live.world===d.world.getWorldWriter()&&live.global===d.global()&&live.party===this.partyKey()&&
      live.observation.context===d.battle.getCommands().context&&live.observation.battle===d.battle.battleInstance&&live.native===d.battle.getModule();
  }
  private checkLive(live:Live):boolean {
    try {if(this.valid(live))return true;}catch(error) {
      if(!isOwnedBattleCancelled(error)&&(live.failed||this.live.has(live))){this.retire(live,'battle loop validation failed',error,true);throw error;}
    }
    this.retire(live,'native battle loop changed');return false;
  }
  check():void {if(this.current)this.checkLive(this.current);}
  /** Private scalar clock domain; no public observation or raw sample authorizes it. */
  presentationDomain():number|null {return this.presentationLease?.active?this.presentationLease.domain:null;}
  /** Native combat presentation deadlines use active time; the global clock is unchanged. */
  presentationTime(now:number):number {
    const lease=this.presentationLease;
    // Integer microseconds avoid exponent-dependent drift after a long parked interval.
    return lease?.active ? ((lease.parkedTicks??Math.round((now-lease.phaseMs)*1000))-lease.offsetTicks)/1000 : now;
  }
  activate(live:Live|null):void {if(live){this.assert(live);live.active=true;if(this.presentationLease?.id===live.observation.parent)this.presentationLease.active=true;live.activateTiming?.(live.chargeBasis??undefined);live.activateTiming=null;live.chargeBasis=null;live.captureChargeBasis=null;}}
  assert(live:Live):void {if(!this.checkLive(live)){if(live.failed)throw live.failure;throw new OwnedBattleCancelled('native battle loop changed');}}
  stage(live:Live):BattleLoopStage {this.assert(live);return live.cursor.nextStage;}
  advance(live:Live,stage:BattleLoopStage):void {this.assert(live);advanceBattleLoopCursor(live.cursor,stage);}
  beginFrame(live:Live):void {this.assert(live);live.frameToken=Object.freeze({});live.completion=false;}
  bindContext<T extends object>(context:T,parent:unknown):T {
    const l=parent&&typeof parent==='object'?this.parents.get(parent):null;
    if(l?.frameToken&&this.live.has(l)&&l.cursor.nextStage==='frame')loopContexts.set(context,{handle:l.handle,token:l.frameToken});
    return context;
  }
  consumeCompletedRound(live:Live):boolean {const done=live.completion;live.completion=false;live.frameToken=null;if(done)this.completedRound(live);return done;}
  completedRound(live:Live):void {
    this.assert(live);
    if(live.completedFrame===live.cursor.frame)throw new Error('duplicate round completion');
    noteCompletedBattleRound(live.cursor);live.completedFrame=live.cursor.frame;
  }
  /** Native traversal lifetime proof is distinct from eligibility for a new park. */
  enterPreBattleRegion(l:Live|null):object|null {
    if(!l)return null;
    this.assert(l);
    if(l.active||l.region||!this.deps!.scripts.hasPhase(l.parent,'pre-battle'))throw new OwnedBattleCancelled('invalid prebattle region');
    l.region=Object.freeze({});l.chargeBasis=l.captureChargeBasis?.()??null;
    if(this.presentationLease?.id===l.observation.parent)this.presentationLease.active=true;
    return l.region;
  }
  leavePreBattleRegion(l:Live|null,region:object|null):void {if(l&&l.region===region)l.region=null;}
  assertPreBattleParent(parent:unknown,region?:object):void {
    const l=parent&&typeof parent==='object'?this.parents.get(parent):undefined;
    if(!l||l.active||!l.region||(region!==undefined&&l.region!==region))throw new OwnedBattleCancelled('prebattle region retired');
    this.assert(l);
    if(!this.deps!.scripts.hasPhase(l.parent,'pre-battle'))throw new OwnedBattleCancelled('prebattle parent phase changed');
  }
  capturePreBattleRegion(parent:unknown):object {this.assertPreBattleParent(parent);return this.parents.get(parent as object)!.region!;}
  preBattleEligible(parent:unknown):boolean {
    this.assertPreBattleParent(parent);
    return !!this.deps!.preBattle?.();
  }
  preparePreBattlePause(parent:unknown):boolean {
    const l=parent&&typeof parent==='object'?this.parents.get(parent):undefined;
    if(!l||l.owner||!this.preBattleEligible(parent))return false;
    return this.deps!.commands.preparePauseBoundary(l.root);
  }
  suspendPreBattlePause(parent:unknown):()=>void {
    this.assertPreBattleParent(parent);
    if(!this.preBattleEligible(parent))throw new OwnedBattleCancelled('prebattle result changed');
    return this.startChildTiming(this.parents.get(parent as object)!);
  }
  private rewardsCommands(expected?:unknown,expectedEntity?:number):any {
    const writer=this.deps!.world.getWorldWriter() as any;if(expected!==undefined&&writer!==expected)throw new OwnedBattleCancelled('rewards WorldWriter replaced');
    const registry=writer.registry;if(registry){const entity=registry.getEntitiesByTag('world')[0];return entity===undefined||(expectedEntity!==undefined&&entity!==expectedEntity)?null:writer.peek(entity,BattleCommandsComponent);}
    return writer.peek(writer.world(),BattleCommandsComponent);
  }
  /** Private post-loop authority; no retired loop/root is recaptured. */
  enterRewardsScriptRegion(parent:unknown,native:unknown,readClock:()=>number):object|null {
    if(!this.enabled)return null;
    const key=parent as object, proof=this.returnedParents.get(key),lease=this.presentationLease;
    if(this.disposed||!proof||!lease||proof!==lease.domain||this.rewardsRegions.has(key))throw new OwnedBattleCancelled('rewards region unavailable');
    const commands=this.rewardsCommands();if(!commands)throw new OwnedBattleCancelled('rewards commands retired');
    const writer=this.deps!.world.getWorldWriter() as any;if(!writer.peek(writer.registry?writer.registry.getEntitiesByTag('world')[0]:writer.world(),PartyComponent))throw new OwnedBattleCancelled('rewards party retired');
    this.deps!.scripts.validate(parent,undefined,native);if(!this.deps!.scripts.hasPhase(parent,'rewards'))throw new OwnedBattleCancelled('rewards region unavailable');
    const token=Object.freeze({});this.rewardsRegions.set(key,{token,domain:lease.domain,native,read:readClock,context:commands.context,writer,entity:writer.registry?writer.registry.getEntitiesByTag('world')[0]:writer.world()});return token;
  }
  rewardSettlementRuntime(parent:unknown,native:unknown):string {
    const proof=this.rewardWonParents.get(parent as object);if(!proof||proof.native!==native||this.settledRewardParents.has(parent as object)||this.presentationLease?.domain!==proof.domain)throw new OwnedBattleCancelled('native Won settlement unavailable');return proof.runtime;
  }
  captureRewardSettlement(parent:unknown,native:unknown):object {
    const key=parent as object,proof=this.rewardWonParents.get(key);
    if(!proof||proof.native!==native||this.settledRewardParents.has(key)||this.presentationLease?.domain!==proof.domain)throw new OwnedBattleCancelled('native Won settlement unavailable');
    this.settledRewardParents.add(key);this.rewardWonParents.delete(key);
    const region=this.enterRewardsScriptRegion(parent,native,proof.read);
    if(!region)throw new OwnedBattleCancelled('native Won settlement unavailable');
    this.rewardSettlementRegions.add(region);return region;
  }
  enterRewardEndScripts(parent:unknown,token:object):void {this.assertRewardsScriptParent(parent,token);if(!this.rewardSettlementRegions.has(token)||this.rewardEndRegions.has(parent as object))throw new OwnedBattleCancelled('nested reward end region unavailable');this.rewardEndRegions.set(parent as object,token);}
  leaveRewardEndScripts(parent:unknown,token:object):void {if(this.rewardEndRegions.get(parent as object)===token)this.rewardEndRegions.delete(parent as object);}
  assertRewardsScriptParent(parent:unknown,token?:object):void {
    const region=this.rewardsRegions.get(parent as object),lease=this.presentationLease;
    if(this.disposed||!region||!lease||region.domain!==lease.domain||(token!==undefined&&region.token!==token))throw new OwnedBattleCancelled('rewards region retired');
    const commands=this.rewardsCommands(region.writer,region.entity);if(!commands||commands.context!==region.context)throw new OwnedBattleCancelled('rewards commands retired');
    const writer=this.deps!.world.getWorldWriter() as any;if(!writer.peek(writer.registry?writer.registry.getEntitiesByTag('world')[0]:writer.world(),PartyComponent))throw new OwnedBattleCancelled('rewards party retired');
    this.deps!.scripts.validate(parent,undefined,region.native);
    if(!this.deps!.scripts.hasPhase(parent,'rewards'))throw new OwnedBattleCancelled('rewards parent phase changed');
  }
  captureRewardsScriptRegion(parent:unknown):object {this.assertRewardsScriptParent(parent);const token=this.rewardsRegions.get(parent as object)!.token;if(this.rewardSettlementRegions.has(token)&&this.rewardEndRegions.get(parent as object)!==token)throw new OwnedBattleCancelled('reward end traversal not active');return token;}
  rewardsScriptState(parent:unknown):{result:unknown;party:string} {this.assertRewardsScriptParent(parent);return {result:this.deps!.battle.getState().battleResult,party:this.partyKey()};}
  rewardsScriptEligible(parent:unknown):boolean {this.assertRewardsScriptParent(parent);return true;}
  prepareRewardsScriptPause(parent:unknown):boolean {const region=this.rewardsRegions.get(parent as object);if(!region||!this.rewardsCommands(region.writer,region.entity))throw new OwnedBattleCancelled('rewards world retired');if(this.deps!.commands.rewardsPauseQuiescent?.()!==true)return false;this.assertRewardsScriptParent(parent);return true;}
  releaseRewardsScriptPause(parent:unknown):void {
    const handle=this.rewardsPauseHandles.get(parent as object);if(!handle)return;this.rewardsPauseHandles.delete(parent as object);
    const ticket=this.rewardsTiming.get(handle);this.rewardsTiming.delete(handle);if(ticket&&this.presentationLease?.domain===ticket.domain)this.presentationLease.parkedTicks=null;
  }
  leaveRewardsScriptRegion(parent:unknown,token:object|null):void {if(this.rewardsRegions.get(parent as object)?.token===token){this.releaseRewardsScriptPause(parent);this.leaveRewardEndScripts(parent,token);this.rewardSettlementRegions.delete(token);this.rewardsRegions.delete(parent as object);}}
  suspendRewardsScriptPause(parent:unknown,guard:()=>boolean=()=>true):(()=>number|void)|null {
    this.assertRewardsScriptParent(parent);
    if(!guard())return null;
    const region=this.rewardsRegions.get(parent as object)!,lease=this.presentationLease!,start=region.read();
    this.assertRewardsScriptParent(parent,region.token);
    if(this.presentationLease!==lease)throw new OwnedBattleCancelled('rewards timing lease changed');
    if(!guard()||!this.prepareRewardsScriptPause(parent)||!guard())return null;
    const handle=Object.freeze({});this.rewardsTiming.set(handle,{parent:parent as object,region:region.token,domain:lease.domain,start,read:region.read,guard});this.rewardsPauseHandles.set(parent as object,handle);
    lease.phaseMode=true;lease.parkedTicks=Math.round((start-lease.phaseMs)*1000);
    return ()=>this.endRewardsTiming(handle);
  }
  private endRewardsTiming(handle:object):number|void {
    const ticket=this.rewardsTiming.get(handle);if(!ticket)return;this.rewardsTiming.delete(handle);this.rewardsPauseHandles.delete(ticket.parent);
    const lease=this.presentationLease,region=this.rewardsRegions.get(ticket.parent);
    if(!lease||lease.domain!==ticket.domain||region?.token!==ticket.region)return;
    this.assertRewardsScriptParent(ticket.parent,ticket.region);
    if(!ticket.guard()||!this.prepareRewardsScriptPause(ticket.parent)||!ticket.guard())throw new OwnedBattleCancelled('rewards commands changed');
    const ended=ticket.read();this.assertRewardsScriptParent(ticket.parent,ticket.region);
    if(this.presentationLease!==lease||!ticket.guard()||!this.prepareRewardsScriptPause(ticket.parent)||!ticket.guard())throw new OwnedBattleCancelled('rewards timing lease changed');
    const elapsed=ended-ticket.start;if(!Number.isFinite(elapsed)||elapsed<0)throw new Error('invalid rewards pause interval');
    const ticks=Math.round(elapsed*1000);lease.offsetTicks+=ticks;lease.phaseMs+=elapsed-ticks/1000;
    const carry=Math.round(lease.phaseMs*1000);lease.offsetTicks+=carry;lease.phaseMs-=carry/1000;lease.parkedTicks=null;return elapsed;
  }
  /** Internal exact-parent handoff for active combat retains its original conditions. */
  assertChildParent(parent:unknown):void {
    const l=parent&&typeof parent==='object'?this.parents.get(parent):undefined;
    if(!l||!l.active)throw new OwnedBattleCancelled('child battle loop retired');this.assert(l);
  }
  prepareChildPause(parent:unknown):boolean {
    const l=parent&&typeof parent==='object'?this.parents.get(parent):undefined;
    if(!l||!l.active||l.owner||!this.checkLive(l)||!this.deps!.ongoing())return false;
    return this.deps!.commands.preparePauseBoundary(l.root);
  }
  releaseChildPause(parent:unknown):void {
    const l=parent&&typeof parent==='object'?this.parents.get(parent):undefined;
    if(l)this.deps!.commands.releasePauseBoundary(l.root);
  }
  private childTiming=new WeakMap<object,{domain:number;id:string;end:(endedTicks?:number)=>number|void;rawStart:number|null;read:(()=>number)|null}>();
  suspendChildPause(parent:unknown):()=>void {
    const l=parent&&typeof parent==='object'?this.parents.get(parent):undefined;
    if(!l||!l.active)throw new OwnedBattleCancelled('child battle loop retired');this.assert(l);
    return this.startChildTiming(l);
  }
  private startChildTiming(l:Live):()=>void {
    const lease=this.presentationLease,id=l.observation.parent;
    if(!lease||lease.id!==id)throw new OwnedBattleCancelled('timing lease changed');
    const rawStart=l.readClock?l.readClock():null,ticks=rawStart===null?undefined:Math.round(rawStart*1000);
    if(this.presentationLease!==lease)throw new OwnedBattleCancelled('timing lease changed');
    this.assert(l);
    const end=l.suspendTiming?.(ticks)||(()=>{}),handle=Object.freeze({});
    if(this.presentationLease!==lease)throw new OwnedBattleCancelled('timing lease changed');
    this.childTiming.set(handle,{domain:lease.domain,id,end,rawStart,read:l.readClock});
    lease.phaseMode=true;if(rawStart!==null)lease.parkedTicks=Math.round((rawStart-lease.phaseMs)*1000);
    // Closure retains only a dead handle; no Live/Runner/World aliases survive in it.
    return ()=>this.endChildTiming(handle);
  }
  private endChildTiming(handle:object):void {
    const ticket=this.childTiming.get(handle);if(!ticket)return;this.childTiming.delete(handle);
    const lease=this.presentationLease;if(!lease||lease.domain!==ticket.domain)return;
    const rawEnd=ticket.read?ticket.read():null;
    if(this.presentationLease!==lease)return;
    const duration=ticket.end(rawEnd===null?undefined:Math.round(rawEnd*1000));
    if(this.presentationLease!==lease)return;
    if(typeof duration==='number'&&Number.isFinite(duration)&&duration>=0){
      const ticks=Math.round(duration*1000);lease.offsetTicks+=ticks;
      if(rawEnd!==null&&ticket.rawStart!==null){
        lease.phaseMs+=(rawEnd-ticket.rawStart)-ticks/1000;
        const carry=Math.round(lease.phaseMs*1000);
        lease.offsetTicks+=carry;lease.phaseMs-=carry/1000;
      }
    }
    lease.parkedTicks=null;
  }
  requestBattlePause():any {
    if(!this.enabled||!this.current||!this.checkLive(this.current))return {ok:false,reason:'unsupported'};
    const l=this.current;if(l.request!==null||l.owner)return {ok:false,reason:'busy'};
    l.request=++requestSequence;l.observation.state='requested';l.observation.request=l.request;
    return {ok:true,id:l.observation.id,parent:l.observation.parent,context:l.observation.context,battle:l.observation.battle,request:l.request};
  }
  cancelRequest(value:unknown):DispatchResult {
    let dto:any;try{dto=detachedData(value);}catch{return {ok:false,reason:'invalid'};}
    const l=this.current;if(!l||!this.checkLive(l)||l.owner||l.request===null)return {ok:false,reason:'stale'};
    const expected={ok:true,id:l.observation.id,parent:l.observation.parent,context:l.observation.context,battle:l.observation.battle,request:l.request};
    if(!this.equal(dto,expected))return {ok:false,reason:'stale'};
    l.request=null;l.observation.request=null;l.observation.state='running';return {ok:true};
  }
  private equal(a:any,b:any):boolean {
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;
    const keys=Object.keys(b);return Object.keys(a).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(a,k)&&this.equal(a[k],b[k]));
  }
  observe():BattleLoopObservation|null {this.check();const l=this.current;return detachedData(l?{...l.observation,cursor:{...l.cursor}}:this.last);}
  pauseAt(live:Live|null,boundary:BattlePauseBoundary):Promise<void>|null {
    if(!live)return null;this.assert(live);
    const d=this.deps!;
    if(!live.active||live.request===null||live.owner||!d.ongoing())return null;
    if((boundary==='initial-combat'&&(live.cursor.frame!==0||live.cursor.nextStage!=='frame'))||
       (boundary==='completed-round'&&(live.completedFrame!==live.cursor.frame||live.cursor.nextStage!=='dispatch-command')))throw new Error('invalid pause boundary');
    const request=live.request;
    if(!d.commands.preparePauseBoundary(live.root))return null;
    // Exact prompt retirement may cancel or replace this request synchronously.
    this.assert(live);if(!d.ongoing()||live.request!==request||live.observation.state!=='requested') {d.commands.releasePauseBoundary(live.root);return null;}
    let resolve!:()=>void,reject!:(e:unknown)=>void;const gate=new Promise<void>((a,b)=>{resolve=a;reject=b;});
    // Share one raw microsecond sample with suspension and the frozen presentation anchor.
    if(this.presentationLease?.id===live.observation.parent&&this.presentationLease.phaseMode){
      // After a child cut, outer cuts use the same scalar phase and single-sample lease.
      live.resumeTiming=this.suspendChildPause(live.parent);
    }else {
      const startedTicks=live.readClock?Math.round(live.readClock()*1000):undefined;
      live.resumeTiming=live.suspendTiming?.(startedTicks)||null;
      if(this.presentationLease?.id===live.observation.parent&&startedTicks!==undefined)this.presentationLease.parkedTicks=startedTicks;
    }
    live.wake=resolve;live.reject=reject;live.observation.state='paused';live.observation.boundary=boundary;
    const payload={...live.observation,cursor:{...live.cursor}};
    try {
      live.owner=this.scheduler.publish('battle.pause',payload,{
        ready:()=>this.valid(live)&&d.ongoing(),stage:()=>({ok:true}),accept:()=>true,
        commit:()=>{
          // Scheduler retired before these callbacks. Keep gate rejection reachable until they return.
          const timing=live.resumeTiming;live.resumeTiming=null;const duration=timing?.();
          if(this.presentationLease?.id===live.observation.parent){if(typeof duration==='number'&&Number.isFinite(duration)&&duration>=0)this.presentationLease.offsetTicks+=Math.round(duration*1000);this.presentationLease.parkedTicks=null;}
          d.commands.releasePauseBoundary(live.root);this.assert(live);
          live.owner=null;live.request=null;live.observation.request=null;live.observation.state='running';
          live.observation.boundary=null;live.observation.revision=null;live.wake=null;live.reject=null;resolve();
        },cancel:()=>{}
      });live.observation.revision=live.owner.revision;
    }catch(error){live.wake=null;live.reject=null;d.commands.releasePauseBoundary(live.root);throw error;}
    return gate;
  }
  resume(value:unknown):DispatchResult {
    let dto:any;try{dto=detachedData(value);}catch{return {ok:false,reason:'invalid'};}
    const l=this.current;if(!l||!this.checkLive(l)||!l.owner||!this.equal(dto,this.observe()))return {ok:false,reason:'stale'};
    const owner=l.owner,staged=this.scheduler.stage(owner,'battle.pause',true);if(!staged.ok)return staged;
    try {const result=this.scheduler.resume(owner,'battle.pause');if(!result.ok)this.retire(l,'pause no longer eligible');return result;}
    catch(error){this.retire(l,'pause failure',error,true);throw error;}
    finally {if(!this.live.has(l))this.scheduler.cancel(owner,'battle.pause');}
  }
  private retire(live:Live,reason:string,error?:unknown,failed=false):void {
    if(!this.live.delete(live))return;
    live.failed=failed;live.failure=error;
    if(reason!=='battle loop returned'&&this.presentationLease?.id===live.observation.parent){this.presentationLease.unsubscribe?.();this.presentationLease=null;}
    completionHandles.delete(live.handle);this.parents.delete(live.parent as object);live.unsubscribe?.();live.unsubscribe=null;
    const owner=live.owner,reject=live.reject;live.owner=null;live.wake=null;live.reject=null;live.resumeTiming=null;live.suspendTiming=null;live.activateTiming=null;live.region=null;live.chargeBasis=null;live.captureChargeBasis=null;live.readClock=null;live.request=null;live.completion=false;live.frameToken=null;
    live.observation.state='retired';live.observation.request=null;
    if(this.current===live){this.current=null;this.last=detachedData({...live.observation,cursor:{...live.cursor}});}
    try{if(owner)this.scheduler.cancel(owner,'battle.pause');}catch{/* retain native primary error */}
    try{this.deps!.commands.releasePauseBoundary(live.root);}catch{/* metadata cleanup */}
    try{this.deps!.world.releaseCancellableExecutionScope(live.scope);}catch{/* metadata cleanup */}
    reject?.(failed?error:new OwnedBattleCancelled(reason));
  }
  release(live:Live|null,error?:unknown,failed=false,nativeResult?:unknown):void {if(live){if(this.live.has(live)&&!failed&&nativeResult===3&&live.readClock&&this.presentationLease?.id===live.observation.parent)this.rewardWonParents.set(live.parent as object,{domain:this.presentationLease.domain,read:live.readClock,native:live.native,runtime:live.observation.runtime});if(this.live.has(live)&&!failed&&this.presentationLease?.id===live.observation.parent)this.returnedParents.set(live.parent as object,this.presentationLease.domain);if(this.live.has(live))finishBattleLoopCursor(live.cursor);this.retire(live,'battle loop returned',error,failed);}}
  invalidate(reason:string):void {if(this.current)this.retire(this.current,reason);}
  dispose():void {this.invalidate('runtime disposed');this.disposed=true;this.unsubscribeParty?.();this.unsubscribeParty=null;this.presentationLease?.unsubscribe?.();this.presentationLease=null;this.scheduler.dispose();this.deps=null;}
}
export const battleLoopRuntime=new BattleLoopRuntime();
