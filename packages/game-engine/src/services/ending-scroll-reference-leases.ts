import Surface from '../js/pal/surface';
import worldService from './world-service';
import {endingShowDigest} from './ending-show-reference-leases';
import {sameJsonValue} from './script-json-value';
import type {EndingShowLease} from './script-ending-show-cursor';
import type {EndingScrollCursor} from './script-ending-scroll-cursor';
import type {ScriptDelayCheckpoint} from './script-delay-checkpoint';
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
interface Row {owner:string;binding:any;front:Uint8Array;backup:Uint8Array;bitmap:Uint8Array;target:any;rect:any;dstrect:any;source:any;physical:any;wave:any;checkpoint:any;functions:any[];ctx:any;handler:any;locals:any;prefixWave:any;prefixLocals:any}
let sequence=0;
const source=(c:EndingScrollCursor)=>({pc:c.opcodePC,next:c.nextPC,operands:c.operands,chunk:c.chunk,speed:c.speed,down:c.down,debug:c.debug,special:c.specialPrefixDone,bitmap:c.bitmapDigest,target:c.targetDigest});
const physical=(s:any)=>({front:endingShowDigest(s.byteBuffer),backup:endingShowDigest(s.backup),palette:clone(s.getPalette()),rgba:endingShowDigest(new Uint8Array(s.ctx.getImageData(0,0,320,200).data.buffer)),shake:Surface.shakeTime,level:Surface.shakeLevel});
const wave=(b:any)=>({index:b.scene.index,wave:worldService.getScreenWave(),progress:worldService.getWaveProgression()});
const functions=(s:any)=>[s.updateScreen,s.getRect,s.putRect,s.blit,s.blitSurface,s.blitRLE,s.backupScreen,s.setPalette,s.getPalette,s.ctx.getImageData,s.ctx.putImageData,s.panoramaHandler?.shouldCaptureUi,s.panoramaHandler?.isActive,s.panoramaHandler?.renderUiBuffer];
/** Matching-runtime ownership: authoritative complete checkpoint plus current physical child paint. */
export class EndingScrollReferenceLeases {
 private generation=1;private rows=new Map<string,Row>();
 acquire(owner:string,c:EndingScrollCursor,b:any,entry:any):EndingShowLease {
  if(sequence===Number.MAX_SAFE_INTEGER)throw new Error('Ending scroll identities exhausted');
  const id=`ending-scroll-${++sequence}`,s=b.surface;
  this.rows.set(id,{owner,binding:b,front:s.byteBuffer,backup:s.backup,bitmap:entry.bitmap,target:entry.p,rect:entry.rect,dstrect:entry.dstrect,source:clone(source(c)),physical:null,wave:null,checkpoint:null,functions:functions(s),ctx:s.ctx,handler:s.panoramaHandler,locals:null,prefixWave:null,prefixLocals:null});
  return {id,generation:this.generation,owner};
 }
 resolve(l:EndingShowLease,owner:string,c:EndingScrollCursor,b:any,s:any):Row|null {
  const r=this.rows.get(l.id),a=r?.binding;
  return r&&l.generation===this.generation&&l.owner===owner&&r.owner===owner&&a.surface===s&&b.surface===s&&a.screen===b.screen&&b.screen===s.byteBuffer&&a.reader===b.reader&&a.decompress===b.decompress&&a.initGeneration===b.initGeneration&&a.resourceGeneration===b.resourceGeneration&&a.scene.service===b.scene.service&&a.scene.surface===b.scene.surface&&b.scene.surface===s&&a.scene.apply===b.scene.apply&&a.scene.adapterApply===b.scene.adapterApply&&a.scene.getIndex===b.scene.getIndex&&a.begin===b.begin&&a.step===b.step&&a.finish===b.finish&&r.front===s.byteBuffer&&r.backup===s.backup&&r.ctx===s.ctx&&r.handler===s.panoramaHandler&&r.functions.every((f,i)=>f===functions(s)[i])&&sameJsonValue(r.source,source(c))?r:null;
 }
 completePrefix(l:EndingShowLease,b:any):void {const r=this.rows.get(l.id);if(!r||r.owner!==l.owner||l.generation!==this.generation)throw new Error('Missing ending scroll prefix');r.prefixWave=wave(b);r.prefixLocals=clone({rect:r.rect,dstrect:r.dstrect,width:r.target.width,height:r.target.height});}
 publish(l:EndingShowLease,cp:ScriptDelayCheckpoint,b:any):void {const r=this.rows.get(l.id);if(!r||r.owner!==l.owner||l.generation!==this.generation)throw new Error('Missing ending scroll reference');const c=cp.frames.find(f=>f.endingScroll?.lease?.id===l.id)?.endingScroll;if(!c||!this.resolve(l,cp.id,c,b,b.surface)||!this.bytesMatch(r,c))throw new Error('Ending scroll source or renderer binding changed before publication');if(r.prefixWave&&!sameJsonValue(r.prefixWave,wave(b))||r.prefixLocals&&!sameJsonValue(r.prefixLocals,{rect:r.rect,dstrect:r.dstrect,width:r.target.width,height:r.target.height}))throw new Error('Ending scroll completed wave or rectangle prefix changed');r.physical=physical(b.surface);r.wave=wave(b);r.locals=clone({rect:r.rect,dstrect:r.dstrect,width:r.target.width,height:r.target.height});r.checkpoint=clone(cp);}
 matches(l:EndingShowLease,cp:ScriptDelayCheckpoint,b:any):boolean {const r=this.rows.get(l.id);return !!r?.checkpoint&&sameJsonValue(r.checkpoint,cp)&&sameJsonValue(r.physical,physical(b.surface))&&sameJsonValue(r.wave,wave(b))&&sameJsonValue(r.locals,{rect:r.rect,dstrect:r.dstrect,width:r.target.width,height:r.target.height});}
 bytesMatch(r:Row,c:EndingScrollCursor):boolean{return endingShowDigest(c.bitmap)===c.bitmapDigest&&endingShowDigest(r.bitmap)===c.bitmapDigest&&endingShowDigest(c.target)===c.targetDigest&&endingShowDigest(r.target)===c.targetDigest;}
 consume(l:EndingShowLease):void {const r=this.rows.get(l.id);if(r)r.checkpoint=null;}
 release(l:EndingShowLease):void {if(l.generation===this.generation&&this.rows.get(l.id)?.owner===l.owner)this.rows.delete(l.id);}
 get hasReferences():boolean{return this.rows.size>0;}
 releaseOwner(owner:string):void {for(const [id,r]of this.rows)if(r.owner===owner)this.rows.delete(id);}
 transfer(owner:string,next:string):void {for(const r of this.rows.values())if(r.owner===owner)r.owner=next;}
 clear():void {this.rows.clear();if(this.generation<Number.MAX_SAFE_INTEGER)this.generation++;}
}
const scopes=new WeakMap<object,EndingScrollReferenceLeases>();
export function endingScrollLeases(s:object):EndingScrollReferenceLeases {let scope=scopes.get(s);if(!scope){scope=new EndingScrollReferenceLeases();scopes.set(s,scope);}return scope;}
