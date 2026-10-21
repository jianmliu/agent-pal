import {sha256} from 'viem';
import type {ScreenAliasLease,ScreenFadeSource,ScreenFadeProgress} from './script-screen-fade-cursor';
import {sameJsonValue} from './script-json-value';
export const screenFadeDigest=(bytes:Uint8Array|number[])=>sha256(bytes instanceof Uint8Array?bytes:Uint8Array.from(bytes));
interface AliasRow {owner:string;front:Uint8Array;backup:Uint8Array;source:{opcodePC:number;operation:number;operands:number[];previousOverlay:string|null};targetDigest:string;progress?:Record<string,unknown>}
/** Scoped to a renderer; same-renderer cold runners share native aliases, not copies. */
let leaseSequence=0;
function nextLeaseId():string {
 if(leaseSequence===Number.MAX_SAFE_INTEGER)throw new Error('Screen fade lease identities exhausted');
 return `screen-fade-reference-${++leaseSequence}`;
}
export class ScreenFadeReferenceLeases {
private generation=1;private rows=new Map<string,AliasRow>();
 acquire(owner:string,source:ScreenFadeSource,front:Uint8Array,backup:Uint8Array,targetDigest:string):ScreenAliasLease {
  const id=nextLeaseId();this.rows.set(id,{owner,front,backup,source:{opcodePC:source.opcodePC,operation:source.operation,operands:[...source.operands],previousOverlay:source.previousOverlay},targetDigest});return {id,generation:this.generation,owner};
 }
 resolve(lease:ScreenAliasLease,owner:string,source:ScreenFadeSource,surface:any):AliasRow|null {
  const row=this.rows.get(lease.id);return lease.generation===this.generation&&lease.owner===owner&&row?.owner===owner&&row.front===surface.byteBuffer&&row.backup===surface.backup&&row.source.opcodePC===source.opcodePC&&row.source.operation===source.operation&&row.source.previousOverlay===source.previousOverlay&&sameJsonValue(row.source.operands,source.operands)&&row.targetDigest===source.screen?.targetDigest?row:null;
 }
 publish(lease:ScreenAliasLease,p:ScreenFadeProgress):void {
  const row=this.rows.get(lease.id);if(row&&lease.generation===this.generation&&row.owner===lease.owner)row.progress=this.progress(p);
 }
 matchesProgress(lease:ScreenAliasLease,p:ScreenFadeProgress):boolean {const row=this.rows.get(lease.id);return !!row?.progress&&sameJsonValue(row.progress,this.progress(p));}
 private progress(p:ScreenFadeProgress):Record<string,unknown> {const {target,lease,...progress}=p;return {...progress};}
 /** A successfully consumed full wait is in flight until its next prefix publishes. */
 consumeProgress(lease:ScreenAliasLease):void {const row=this.rows.get(lease.id);if(row&&lease.generation===this.generation&&row.owner===lease.owner)delete row.progress;}
 release(lease:ScreenAliasLease):void {if(lease.generation===this.generation&&this.rows.get(lease.id)?.owner===lease.owner)this.rows.delete(lease.id);}
 get hasReferences():boolean {return this.rows.size>0;}
 releaseOwner(owner:string):void {for(const [id,row]of this.rows)if(row.owner===owner)this.rows.delete(id);}
 transfer(owner:string,next:string):void {for(const row of this.rows.values())if(row.owner===owner)row.owner=next;}
 clear():void {this.rows.clear();if(this.generation<Number.MAX_SAFE_INTEGER)this.generation++;}
}
const renderers=new WeakMap<object,ScreenFadeReferenceLeases>();
export function screenFadeLeases(surface:object):ScreenFadeReferenceLeases {let leases=renderers.get(surface);if(!leases){leases=new ScreenFadeReferenceLeases();renderers.set(surface,leases);}return leases;}
