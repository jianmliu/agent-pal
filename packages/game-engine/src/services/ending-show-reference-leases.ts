import {sha256} from 'viem';
import {sameJsonValue} from './script-json-value';
import type {EndingShowCursor,EndingShowLease} from './script-ending-show-cursor';
export const endingShowDigest=(bytes:Uint8Array|number[])=>sha256(bytes instanceof Uint8Array?bytes:Uint8Array.from(bytes));
interface Binding {surface:any;screen:Uint8Array;reader:any;decompress:any}
interface Row {owner:string;binding:Binding;front:Uint8Array;backup:Uint8Array;bitmap:Uint8Array;target:Uint8Array;source:unknown;progress?:{revision:number;snapshot:unknown}}
let sequence=0;
const source=(c:EndingShowCursor)=>({opcodePC:c.opcodePC,nextPC:c.nextPC,operation:c.operation,operands:[...c.operands],chunk:c.chunk,fade:c.fade,debug:c.debug,bitmapDigest:c.bitmapDigest,targetDigest:c.targetDigest});
/** Actual resources and detached target stay runtime-owned. No reader calls during validation. */
export class EndingShowReferenceLeases {
 private generation=1;private rows=new Map<string,Row>();
 acquire(owner:string,c:EndingShowCursor,binding:Binding,bitmap:Uint8Array,target:Uint8Array):EndingShowLease {
  if(sequence===Number.MAX_SAFE_INTEGER)throw new Error('Ending show lease identities exhausted');
  const id=`ending-show-reference-${++sequence}`;
  this.rows.set(id,{owner,binding:{...binding},front:binding.surface.byteBuffer,backup:binding.surface.backup,bitmap,target,source:source(c)});
  return {id,generation:this.generation,owner};
 }
 resolve(lease:EndingShowLease,owner:string,c:EndingShowCursor,binding:Binding,receiver:any):Row|null {
  const r=this.rows.get(lease.id),b=r?.binding;
  return !!r&&!!b&&lease.generation===this.generation&&lease.owner===owner&&r?.owner===owner&&b?.surface===receiver&&binding.surface===receiver&&b.screen===binding.screen&&binding.screen===receiver.byteBuffer&&b.reader===binding.reader&&b.decompress===binding.decompress&&r.front===receiver.byteBuffer&&r.backup===receiver.backup&&sameJsonValue(r.source,source(c))?r:null;
 }
 publish(lease:EndingShowLease,c:EndingShowCursor,revision:number):void {const r=this.rows.get(lease.id);if(r&&lease.generation===this.generation&&r.owner===lease.owner)r.progress={revision,snapshot:this.snapshot(c)};}
 matchesProgress(lease:EndingShowLease,c:EndingShowCursor,revision:number):boolean {const r=this.rows.get(lease.id);return !!r?.progress&&r.progress.revision===revision&&sameJsonValue(r.progress.snapshot,this.snapshot(c));}
 private snapshot(c:EndingShowCursor):unknown {const {bitmap,target,lease,...p}=c;return {...p,operands:[...p.operands]};}
 consumeProgress(lease:EndingShowLease):void {const r=this.rows.get(lease.id);if(r&&lease.generation===this.generation&&r.owner===lease.owner)delete r.progress;}
 release(lease:EndingShowLease):void {if(lease.generation===this.generation&&this.rows.get(lease.id)?.owner===lease.owner)this.rows.delete(lease.id);}
 get hasReferences():boolean{return this.rows.size>0;}
 releaseOwner(owner:string):void {for(const [id,r]of this.rows)if(r.owner===owner)this.rows.delete(id);}
 transfer(owner:string,next:string):void {for(const r of this.rows.values())if(r.owner===owner)r.owner=next;}
 clear():void {this.rows.clear();if(this.generation<Number.MAX_SAFE_INTEGER)this.generation++;}
}
const scopes=new WeakMap<object,EndingShowReferenceLeases>();
export function endingShowLeases(surface:object):EndingShowReferenceLeases {let s=scopes.get(surface);if(!s){s=new EndingShowReferenceLeases();scopes.set(surface,s);}return s;}
