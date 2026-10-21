import {toWord} from '../ecs/components/inventory';
import {ExecutionScheduler,detachedData,type ExecutionOwner,type DispatchResult} from './execution-scheduler';
import {copyPoisonCursor,writePoisonReturn,type BattlePoisonCursor} from './battle-poison-cursor';
import {OwnedBattleCancelled,isOwnedBattleCancelled} from './battle-command-runtime';
import type {BattleScriptExecution} from './battle-script-execution';
import type {BattleLoopRuntime} from './battle-loop-runtime';
export type BattlePoisonScriptProfile='legacy'|'owned-cursor';
export function validateBattlePoisonProfile(profile:unknown,execution:unknown,command:unknown,script:unknown):void {
  if(profile!=='legacy'&&profile!=='owned-cursor')throw new TypeError('unknown battle poison script profile');
  if(profile==='owned-cursor'&&(execution!=='round-boundary'||command!=='owned-command'||script!=='owned-parent'))throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
}
interface Runner {getExecutionRuntime():{identity:string;owns(frame:any,owner?:object):boolean};scriptSuccess:boolean;curEquipPart:number}
interface Dependencies {scripts:BattleScriptExecution;loop:BattleLoopRuntime;world:{registerCancellableExecutionScope(scope:any):void;releaseCancellableExecutionScope(scope:any):void}}
export interface BattlePoisonObservation {id:string;parent:string;context:string;battle:number;runtime:string;state:'running'|'requested'|'paused'|'returned'|'retired';request:number|null;revision:number|null;cursor:BattlePoisonCursor}
interface Live {
  parent:unknown;runner:Runner;runtime:ReturnType<Runner['getExecutionRuntime']>;frames:Set<any>;cursor:BattlePoisonCursor;slot:unknown;slotId:number;slotEntry:number;returning:boolean;returnBound:boolean;readSlot:(()=>any)|null;
  observation:BattlePoisonObservation;scope:{clear():void;check():void};unsubscribe:(()=>void)|null;owner:ExecutionOwner<'battle.poison'>|null;
  request:number|null;wake:(()=>void)|null;reject:((error:unknown)=>void)|null;endTiming:(()=>void)|null;failed:boolean;failure:unknown;
}
let sequence=0,requests=0;
const unwrap=(v:any)=>{while(v?.__raw__&&v.__raw__!==v)v=v.__raw__;return v;};
function equal(a:any,b:any):boolean {if(!a||!b||typeof a!=='object'||typeof b!=='object')return a===b;const keys=Object.keys(b);return Object.keys(a).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(a,k)&&equal(a[k],b[k]));}
/** Private exact-child authority. DTOs can answer a live scheduler wait but cannot manufacture one. */
export class BattlePoisonRuntime {
  private installed=false;private enabled=false;private disposed=false;private deps:Dependencies|null=null;
  private current:Live|null=null;private last:BattlePoisonObservation|null=null;private live=new Set<Live>();
  private scheduler=new ExecutionScheduler<'battle.poison',BattlePoisonObservation,boolean,boolean>();
  get owned(){return this.enabled;}get liveReferences(){return this.live.size;}
  install(profile:unknown,deps:Dependencies):void {if(profile!=='legacy'&&profile!=='owned-cursor')throw new TypeError('unknown battle poison script profile');if(this.installed)throw new Error('battle poison profile is boot-only');this.installed=true;this.enabled=profile==='owned-cursor';this.deps=deps;}
  capture(parent:unknown,runner:Runner,cursor:BattlePoisonCursor,readSlot:()=>any):Live|null {
    if(!this.enabled)return null;if(this.disposed||this.current)throw new Error('poison child already active or disposed');
    const d=this.deps!;d.scripts.validate(parent,runner as any);const p=d.scripts.observe()!,slot=readSlot();
    if(!slot||slot.poisonID!==cursor.source.poisonId)throw new OwnedBattleCancelled('poison slot changed');
    if(this.scheduler.inTransition||this.scheduler.peek())throw new Error('poison scheduler transition active');if(this.scheduler.snapshot().error!==null)this.scheduler.clearError();
    const observation:BattlePoisonObservation={id:`battle-poison:${++sequence}`,parent:p.id,context:p.context!,battle:p.battle!,runtime:runner.getExecutionRuntime().identity,state:'running',request:null,revision:null,cursor};
    const l:Live={parent,runner,runtime:runner.getExecutionRuntime(),frames:new Set(),cursor,slot:unwrap(slot),slotId:slot.poisonID,slotEntry:slot.poisonScript,returning:false,returnBound:false,readSlot,observation,unsubscribe:null,owner:null,request:null,wake:null,reject:null,endTiming:null,failed:false,failure:undefined,scope:{clear:()=>this.retire(l,'world disposed'),check:()=>this.check(l)}};
    this.current=l;this.live.add(l);try{d.world.registerCancellableExecutionScope(l.scope);l.unsubscribe=d.scripts.onRetire(parent,(error,failed)=>this.retire(l,'parent retired',error,failed));}catch(error){this.retire(l,'capture failed',error,true);throw error;}return l;
  }
  bindFrame(l:Live,frame:any):void {this.assert(l);if(!l.runtime.owns(frame,l.runner))throw new Error('unowned poison child frame');l.frames.add(frame);}
  releaseFrame(l:Live,frame:any):void {l.frames.delete(frame);}
  inheritFrame(parent:any,frame:any,runner:Runner):Live|null {
    const l=this.current;if(!l||l.runner!==runner||!parent||!l.frames.has(parent))return null;this.bindFrame(l,frame);return l;
  }
  /** Called only by the original successful cure writers, for their actual selected slot. */
  noteSlotCleared(frame:any,side:'party'|'enemy',actor:number,slotIndex:number):void {
    const l=this.current;if(!l||!frame||!l.frames.has(frame)||l.cursor.source.side!==side||l.cursor.source.actor!==actor||l.cursor.source.slot!==slotIndex)return;
    if(!this.validParent(l))throw new OwnedBattleCancelled('poison child parent changed');
    const slot=l.readSlot!();if(!slot||slot.poisonID!==0||slot.poisonScript!==0)throw new OwnedBattleCancelled('cured poison slot changed');
    l.slot=unwrap(slot);l.slotId=0;l.slotEntry=0;
  }
  private validParent(l:Live):boolean {
    if(!this.live.has(l)||this.disposed||!l.readSlot)return false;this.deps!.scripts.validate(l.parent,l.runner as any);this.deps!.loop.assertChildParent(l.parent);
    return l.runtime===l.runner.getExecutionRuntime()&&[...l.frames].every(frame=>l.runtime.owns(frame,l.runner));
  }
  private valid(l:Live):boolean {
    if(!this.validParent(l))return false;
    const slot=l.readSlot!();
    if(unwrap(slot)===l.slot&&slot?.poisonID===l.slotId&&Object.is(slot?.poisonScript,l.slotEntry))return true;
    // Only the validated original return writer may advance its own immutable slot generation.
    // A second replacement, or any replacement while parked, retains strict identity refusal.
    const expected=l.cursor.source.side==='party'?toWord(l.cursor.nextEntry):l.cursor.nextEntry;
    if(l.returning&&!l.returnBound&&l.cursor.stage==='write-next-entry'&&slot?.poisonID===l.slotId&&slot?.poisonScript===expected){
      l.slot=unwrap(slot);l.slotEntry=slot.poisonScript;l.returnBound=true;return true;
    }
    return false;
  }
  private check(l:Live):boolean {try{if(this.valid(l))return true;}catch(error){if(!isOwnedBattleCancelled(error)&&(l.failed||this.live.has(l))){this.retire(l,'poison validation failed',error,true);throw error;}}this.retire(l,'poison slot changed');return false;}
  assert(l:Live):void {if(!this.check(l)){if(l.failed)throw l.failure;throw new OwnedBattleCancelled('poison child retired');}}
  requestBattlePoisonPause():any {const l=this.current;if(!this.enabled||!l||!this.check(l))return {ok:false,reason:'unsupported'};if(l.request!==null||l.owner)return {ok:false,reason:'busy'};l.request=++requests;l.observation.state='requested';l.observation.request=l.request;return this.requestDTO(l);}
  private requestDTO(l:Live){return {ok:true,id:l.observation.id,parent:l.observation.parent,context:l.observation.context,battle:l.observation.battle,request:l.request};}
  cancelRequest(value:unknown):DispatchResult {let dto:any;try{dto=detachedData(value);}catch{return {ok:false,reason:'invalid'};}const l=this.current;if(!l||!this.check(l)||l.owner||l.request===null||!equal(dto,this.requestDTO(l)))return {ok:false,reason:'stale'};l.request=null;l.observation.request=null;l.observation.state='running';return {ok:true};}
  observe():BattlePoisonObservation|null {const l=this.current;if(l)this.check(l);const live=this.current;if(live)live.cursor.registers={scriptSuccess:live.runner.scriptSuccess,curEquipPart:live.runner.curEquipPart};return live?detachedData({...live.observation,cursor:copyPoisonCursor(live.cursor)}):detachedData(this.last);}
  pauseAt(l:Live):Promise<void>|null {
    this.assert(l);const f=l.cursor.frames[l.cursor.frames.length-1];if(l.request===null||l.owner||f.effect!=='explicit'||f.frameWait?.stage!=='sleep')return null;
    const d=this.deps!,request=l.request;if(!d.loop.prepareChildPause(l.parent))return null;
    if(!this.check(l)||l.request!==request||l.observation.state!=='requested'){d.loop.releaseChildPause(l.parent);return null;}
    let resolve!:()=>void,reject!:(error:unknown)=>void;const gate=new Promise<void>((a,b)=>{resolve=a;reject=b;});
    l.wake=resolve;l.reject=reject;l.observation.state='paused';
    try {l.endTiming=d.loop.suspendChildPause(l.parent);l.owner=this.scheduler.publish('battle.poison',this.observe()!,{ready:()=>this.valid(l),stage:()=>({ok:true}),accept:()=>true,commit:()=>{
      const end=l.endTiming;l.endTiming=null;end?.();d.loop.releaseChildPause(l.parent);this.assert(l);
      l.owner=null;l.request=null;l.observation.request=null;l.observation.revision=null;l.observation.state='running';l.wake=null;l.reject=null;resolve();
    },cancel:()=>{}});l.observation.revision=l.owner.revision;}catch(error){
      // Publication failed before the caller could receive this gate. Consume only
      // this unpublished rejection; the synchronous primary failure still escapes.
      void gate.catch(()=>{});this.retire(l,'pause failure',error,true);throw error;
    }return gate;
  }
  resume(value:unknown):DispatchResult {
    let dto:any;try{dto=detachedData(value);}catch{return {ok:false,reason:'invalid'};}const l=this.current;
    if(!l||!this.check(l)||!l.owner||!equal(dto,this.observe()))return {ok:false,reason:'stale'};
    const owner=l.owner,staged=this.scheduler.stage(owner,'battle.poison',true);if(!staged.ok)return staged;
    try {const result=this.scheduler.resume(owner,'battle.poison');if(!result.ok)this.retire(l,'pause ineligible');return result;}catch(error){this.retire(l,'resume failed',error,true);throw error;}
  }
  writeReturned(l:Live,writer:(entry:number)=>void):void {
    this.assert(l);l.returning=true;l.returnBound=false;
    try{writePoisonReturn(l.cursor,writer);}finally{l.returning=false;}
  }
  release(l:Live|null,error?:unknown,failed=false):void {if(l)this.retire(l,'child returned',error,failed);}
  private retire(l:Live,reason:string,error?:unknown,failed=false):void {
    if(!this.live.delete(l))return;l.failed=failed;l.failure=error;const owner=l.owner,reject=l.reject;l.owner=null;l.wake=null;l.reject=null;l.endTiming=null;l.request=null;l.readSlot=null;l.frames.clear();l.unsubscribe?.();l.unsubscribe=null;
    l.returning=false;l.observation.state=reason==='child returned'&&!failed&&l.cursor.stage==='returned'?'returned':'retired';l.observation.request=null;l.observation.revision=null;if(this.current===l){this.current=null;this.last=detachedData({...l.observation,cursor:copyPoisonCursor(l.cursor)});}
    try{if(owner)this.scheduler.cancel(owner,'battle.poison');}catch{/* retain primary error */}try{this.deps!.loop.releaseChildPause(l.parent);}catch{/* metadata cleanup */}try{this.deps!.world.releaseCancellableExecutionScope(l.scope);}catch{/* metadata cleanup */}
    reject?.(failed?error:new OwnedBattleCancelled(reason));
  }
  dispose():void {if(this.current)this.retire(this.current,'runtime disposed');this.disposed=true;this.scheduler.dispose();this.deps=null;}
}
export const battlePoisonRuntime=new BattlePoisonRuntime();
