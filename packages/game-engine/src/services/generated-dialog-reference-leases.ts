import {generatedResourceObserver,generatedPlain} from './generated-dialog-observation';
import {sameJsonValue} from './script-json-value';
import type {GeneratedDialogLease} from './script-generated-dialog-cursor';
const clone=(value:any)=>JSON.parse(JSON.stringify(value));
/** Callback-capable observations are supplied before the trusted-clock fence.
 * This class never calls a renderer, codec, loader, getter or work provider. */
export interface GeneratedObservation {refs:unknown[];values:unknown}
export interface GeneratedDomainBinding extends GeneratedObservation {surface:object;ui:object}
interface Row {
  owner:string;binding:GeneratedDomainBinding;reads:Array<{site:string;observation:GeneratedObservation;observe?:()=>GeneratedObservation}>;
  completedPrefix:unknown;checkpoint:unknown;physical:GeneratedObservation|null;state:unknown;
  rendererPrefix?:unknown;waitPrefix?:unknown;
  work?:unknown;runtime?:{wait:GeneratedObservation;renderer:GeneratedObservation;work:unknown;observeWait:()=>GeneratedObservation;observeRenderer:()=>GeneratedObservation};
}
let sequence=0;
const capture=(v:GeneratedObservation):GeneratedObservation=>({refs:[...v.refs],values:clone(v.values)});
const same=(a:GeneratedObservation,b:GeneratedObservation):boolean=>a.refs.length===b.refs.length&&a.refs.every((r,i)=>r===b.refs[i])&&sameJsonValue(a.values,b.values);
export class GeneratedDialogReferenceLeases {
  private generation=1;private rows=new Map<string,Row>();
  private roots=new Map<string,{binding:GeneratedObservation;frames:Map<number,unknown>;checkpoint:unknown;physical:GeneratedObservation|null;state:unknown;reads:Row['reads'];sources:Set<string>}>();
  markNativeFrame(owner:string,index:number,marker:unknown,binding:GeneratedObservation):void {
    let root=this.roots.get(owner);
    if(!root){root={binding:capture(binding),frames:new Map(),checkpoint:null,physical:null,state:null,reads:[],sources:new Set()};this.roots.set(owner,root);}
    if(!same(root.binding,binding))throw new Error('Generated native root binding changed');
    root.frames.set(index,clone(marker));
  }
  nativeFrame(owner:string,index:number):unknown {return this.roots.get(owner)?.frames.get(index);}
  finishNativeFrame(owner:string,index:number):void {this.roots.get(owner)?.frames.delete(index);}
  hasRoot(owner:string):boolean {return this.roots.has(owner);}
  sealRootSource(owner:string,lease:GeneratedDialogLease):void {const root=this.roots.get(owner);if(!root)return;const row=this.require(lease);if(root.sources.has(lease.id))throw new Error('Generated completed source cannot be sealed twice');root.sources.add(lease.id);root.reads.push(...row.reads);}
  consumeRoot(owner:string):void {const root=this.roots.get(owner);if(root)root.checkpoint=null;}
  publishRoot(owner:string,checkpoint:unknown,binding:GeneratedObservation,physical:GeneratedObservation,state:unknown):void {
    const root=this.roots.get(owner);if(!root)return;
    if(!same(root.binding,binding)||!root.reads.every(r=>same(r.observation,r.observe?r.observe():r.observation)))throw new Error('Generated native root source changed before publication');
    root.checkpoint=clone(checkpoint);root.physical=capture(physical);root.state=clone(state);
  }
  matchesRoot(owner:string,checkpoint:unknown,binding:GeneratedObservation,physical:GeneratedObservation,state:unknown):boolean {
    const root=this.roots.get(owner);
    return !!root?.checkpoint&&!!root.physical&&same(root.binding,binding)&&sameJsonValue(root.checkpoint,checkpoint)&&same(root.physical,physical)&&sameJsonValue(root.state,state)&&root.reads.every(r=>same(r.observation,r.observe?r.observe():r.observation));
  }
  acquire(owner:string,binding:GeneratedDomainBinding):GeneratedDialogLease {
    if(sequence===Number.MAX_SAFE_INTEGER)throw new Error('Generated dialog identities exhausted');
    const id=`generated-dialog-${++sequence}`;
    this.rows.set(id,{owner,binding:{surface:binding.surface,ui:binding.ui,...capture(binding)},reads:[],completedPrefix:null,checkpoint:null,physical:null,state:null});
    return {id,generation:this.generation,owner};
  }
  resolve(lease:GeneratedDialogLease,owner:string,binding:GeneratedDomainBinding):Row|null {
    const row=this.rows.get(lease.id);
    return row&&lease.generation===this.generation&&lease.owner===owner&&row.owner===owner&&row.binding.surface===binding.surface&&row.binding.ui===binding.ui&&same(row.binding,binding)?row:null;
  }
  private require(lease:GeneratedDialogLease):Row {
    const row=this.rows.get(lease.id);
    if(!row||lease.generation!==this.generation||row.owner!==lease.owner)throw new Error('Missing or expired generated dialog reference');
    return row;
  }
  /** Stage B receives one observation AFTER that actual native read occurs. */
  captureRead(lease:GeneratedDialogLease,site:string,observation:GeneratedObservation,observe?:()=>GeneratedObservation):void {
    const row=this.require(lease);
    if(row.reads.some(r=>r.site===site))throw new Error('Generated dialog selected read cannot be repeated');
    row.reads.push({site,observation:capture(observation),observe});
  }
  completePrefix(lease:GeneratedDialogLease,prefix:unknown):void {
    const row=this.require(lease);
    if(row.completedPrefix!==null)throw new Error('Generated dialog completed prefix cannot be refreshed');
    row.completedPrefix=clone(prefix);
  }
  bindRendererPrefix(lease:GeneratedDialogLease,prefix:unknown):void {const row=this.require(lease);if(row.rendererPrefix!==undefined)throw new Error('Generated renderer prefix already bound');row.rendererPrefix=prefix;}
  bindWaitPrefix(lease:GeneratedDialogLease,prefix:unknown):void {const row=this.require(lease);row.waitPrefix=prefix;}
  getPrefixes(lease:GeneratedDialogLease):{renderer:unknown;wait:unknown} {const row=this.require(lease);return {renderer:row.rendererPrefix,wait:row.waitPrefix};}
  observeReads(lease:GeneratedDialogLease):GeneratedObservation[] {return this.require(lease).reads.map(read=>read.observe?read.observe():capture(read.observation));}
  setWork(lease:GeneratedDialogLease,value:unknown):void {this.require(lease).work=value;}
  getWork(lease:GeneratedDialogLease):unknown {return this.require(lease).work;}
  readsMatch(lease:GeneratedDialogLease,observations:GeneratedObservation[]):boolean {
    const row=this.rows.get(lease.id);
    return !!row&&lease.generation===this.generation&&row.owner===lease.owner&&row.reads.length===observations.length&&row.reads.every((r,i)=>same(r.observation,observations[i]));
  }
  publish(lease:GeneratedDialogLease,checkpoint:unknown,binding:GeneratedDomainBinding,physical:GeneratedObservation,state:unknown,reads:GeneratedObservation[],prefix?:unknown):void {
    const row=this.resolve(lease,lease.owner,binding);
    if(!row||!this.readsMatch(lease,reads)||prefix!==undefined&&!sameJsonValue(row.completedPrefix,prefix))throw new Error('Generated dialog source or completed prefix changed before publication');
    const cp=clone(checkpoint),paint=capture(physical),presentation=clone(state);
    // Sealing JSON can invoke toJSON/getters. Recheck the already-captured
    // immutable bindings after cloning; never adopt a replacement reference.
    if(!this.resolve(lease,lease.owner,binding)||!this.readsMatch(lease,reads)||prefix!==undefined&&!sameJsonValue(row.completedPrefix,prefix))throw new Error('Generated dialog binding changed during publication');
    const observeWait=generatedResourceObserver(row.waitPrefix,()=>row.waitPrefix),observeRenderer=generatedResourceObserver(row.rendererPrefix,()=>row.rendererPrefix);
    row.checkpoint=cp;row.physical=paint;row.state=presentation;row.runtime={wait:observeWait(),renderer:observeRenderer(),work:generatedPlain(row.work),observeWait,observeRenderer};
  }
  matches(lease:GeneratedDialogLease,checkpoint:unknown,binding:GeneratedDomainBinding,physical:GeneratedObservation,state:unknown,reads:GeneratedObservation[],prefix?:unknown):boolean {
    const row=this.resolve(lease,lease.owner,binding);
    return !!row?.checkpoint&&!!row.physical&&!!row.runtime&&same(row.runtime.renderer,row.runtime.observeRenderer())&&same(row.runtime.wait,row.runtime.observeWait())&&sameJsonValue(row.runtime.work,generatedPlain(row.work))&&sameJsonValue(row.checkpoint,checkpoint)&&same(row.physical,physical)&&sameJsonValue(row.state,state)&&this.readsMatch(lease,reads)&&(prefix===undefined||sameJsonValue(row.completedPrefix,prefix));
  }
  consume(lease:GeneratedDialogLease):void {this.require(lease).checkpoint=null;}
  release(lease:GeneratedDialogLease):void {if(lease.generation===this.generation&&this.rows.get(lease.id)?.owner===lease.owner)this.rows.delete(lease.id);}
  releaseOwner(owner:string):void {for(const [id,row]of this.rows)if(row.owner===owner)this.rows.delete(id);this.roots.delete(owner);}
  hasOwner(owner:string):boolean {return this.roots.has(owner)||[...this.rows.values()].some(row=>row.owner===owner);}
  transfer(owner:string,next:string):void {for(const row of this.rows.values())if(row.owner===owner)row.owner=next;const root=this.roots.get(owner);if(root){this.roots.delete(owner);this.roots.set(next,root);}}
  get hasReferences():boolean{return this.rows.size>0||this.roots.size>0;}
  clear():void {this.rows.clear();this.roots.clear();if(this.generation<Number.MAX_SAFE_INTEGER)this.generation++;}
}
const scopes=new WeakMap<object,GeneratedDialogReferenceLeases>();
export function generatedDialogLeases(surface:object):GeneratedDialogReferenceLeases {
  let scope=scopes.get(surface);if(!scope){scope=new GeneratedDialogReferenceLeases();scopes.set(surface,scope);}return scope;
}
