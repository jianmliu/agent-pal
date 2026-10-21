import {isEndingClockCapability,type EndingClockCapability,type EndingClockLane} from './script-ending-clock';
import {sha256} from 'viem';
import {sameJsonValue} from './script-json-value';
export interface EndingClockLease {id:string;generation:number;owner:string}
export interface EndingClockDescriptor {format:'ending-clock-exact-v1';lease:EndingClockLease;elapsedUnits:string}
export interface EndingClockBinding {kind:string;performance?:unknown;now?:unknown}
export function isEndingClockBinding(binding:EndingClockBinding):boolean{return binding.kind==='browser-performance'&&binding.performance!==null&&['object','function'].includes(typeof binding.performance)&&typeof binding.now==='function';}
interface SpriteBinding {sprite:any;buf:any;buffer:any;offset:number;length:number;digest:string;reader:any;view:any;viewBuffer:any;viewOffset:any;viewLength:any;littleEndian:any;getFrame:any;getFrameOffset:any;getUint16:any}
interface Row {owner:string;cap:EndingClockCapability;binding:EndingClockBinding;lane:EndingClockLane;snapshot?:unknown;sprites:Map<number,SpriteBinding>}
let sequence=0;
const keys=(v:any,fields:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(v,k));
export function validateEndingClockDescriptor(c:unknown):c is EndingClockDescriptor {
 const q=c as EndingClockDescriptor;return keys(q,['format','lease','elapsedUnits'])&&q.format==='ending-clock-exact-v1'&&keys(q.lease,['id','generation','owner'])&&typeof q.lease.id==='string'&&q.lease.id.length>0&&typeof q.lease.owner==='string'&&q.lease.owner.length>0&&Number.isSafeInteger(q.lease.generation)&&q.lease.generation>0&&typeof q.elapsedUnits==='string'&&q.elapsedUnits.length<=633&&/^(0|[1-9][0-9]*)$/.test(q.elapsedUnits);
}
export class EndingClockReferenceLeases {
 private generation=1;private rows=new Map<string,Row>();
 acquire(owner:string,cap:EndingClockCapability,binding:EndingClockBinding):EndingClockLease {
  if(!isEndingClockCapability(cap)||!isEndingClockBinding(binding))throw new Error('Ending clock requires a trusted capability and browser-performance binding');
  if(sequence===Number.MAX_SAFE_INTEGER)throw new Error('Ending clock lease identities exhausted');
  const id=`ending-clock-reference-${++sequence}`;this.rows.set(id,{owner,cap,binding:{...binding},lane:cap.createLane(),sprites:new Map()});return {id,generation:this.generation,owner};
 }
 private row(lease:EndingClockLease):Row|undefined{const r=this.rows.get(lease.id);return lease.generation===this.generation&&r?.owner===lease.owner?r:undefined;}
 lane(lease:EndingClockLease):EndingClockLane{const r=this.row(lease);if(!r)throw new Error('Missing or expired ending clock lease');return r.lane;}
 descriptor(lease:EndingClockLease):EndingClockDescriptor{return {format:'ending-clock-exact-v1',lease:{...lease},elapsedUnits:this.lane(lease).elapsedUnits};}
 resolve(cp:any,cap:EndingClockCapability|undefined,binding:EndingClockBinding):Row|null {
  if(!validateEndingClockDescriptor(cp.clock)||cp.clock.lease.owner!==cp.id)return null;const r=this.row(cp.clock.lease);
  return r&&r.cap===cap&&binding.kind==='browser-performance'&&r.binding.kind===binding.kind&&r.binding.performance===binding.performance&&r.binding.now===binding.now&&r.lane.elapsedUnits===cp.clock.elapsedUnits&&r.snapshot!==undefined&&sameJsonValue(r.snapshot,cp)?r:null;
 }
 hasOwner(owner:string):boolean{return [...this.rows.values()].some(r=>r.owner===owner);}
 private spriteBinding(sprite:any):SpriteBinding {
  const buf=sprite.buf,reader=sprite.reader,view=reader?reader._dataview:null;
  if(!(buf instanceof Uint8Array)||reader&&!(view instanceof DataView))throw new Error('Unsupported ending Sprite backing binding');
  return {sprite,buf,buffer:buf.buffer,offset:buf.byteOffset,length:buf.byteLength,digest:sha256(buf),reader,view,viewBuffer:view?.buffer,viewOffset:view?.byteOffset,viewLength:view?.byteLength,littleEndian:reader?.littleEndian,getFrame:sprite.getFrame,getFrameOffset:sprite.getFrameOffset,getUint16:reader?.getUint16};
 }
 bindSprite(lease:EndingClockLease,id:number,sprite:any):void{if(!sprite)return;const r=this.row(lease);if(!r)throw new Error('Expired ending clock lane');const current=this.spriteBinding(sprite),old=r.sprites.get(id);if(old&&!this.sameSprite(old,current))throw new Error('Ending Sprite immutable binding changed');r.sprites.set(id,current);}
 private sameSprite(a:SpriteBinding,b:SpriteBinding):boolean{return Object.keys(a).every(k=>(a as any)[k]===(b as any)[k]);}
 validateSprites(lease:EndingClockLease,peek:(id:number)=>any):boolean{const r=this.row(lease);if(!r)return false;try{for(const [id,b]of r.sprites){const sprite=peek(id);if(!sprite||!this.sameSprite(b,this.spriteBinding(sprite)))return false;}return true;}catch{return false;}}
 publish(lease:EndingClockLease,cp:unknown):void{const r=this.row(lease);if(r)r.snapshot=JSON.parse(JSON.stringify(cp));}
 consume(lease:EndingClockLease):void{const r=this.row(lease);if(r)delete r.snapshot;}
 releaseOwner(owner:string):void{for(const [id,r]of this.rows)if(r.owner===owner)this.rows.delete(id);}
 transfer(owner:string,next:string):void{for(const r of this.rows.values())if(r.owner===owner)r.owner=next;}
 clear():void{this.rows.clear();if(this.generation<Number.MAX_SAFE_INTEGER)this.generation++;}
 get hasReferences():boolean{return this.rows.size>0;}
}
const scopes=new WeakMap<object,EndingClockReferenceLeases>();
export function endingClockLeases(cap:EndingClockCapability):EndingClockReferenceLeases{let s=scopes.get(cap);if(!s){s=new EndingClockReferenceLeases();scopes.set(cap,s);}return s;}
