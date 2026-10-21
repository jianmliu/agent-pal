import Surface from '../js/pal/surface';
import worldService from './world-service';
import {endingShowDigest} from './ending-show-reference-leases';
import {sameJsonValue} from './script-json-value';
import type {EndingShowLease} from './script-ending-show-cursor';
import type {EndingAnimationCursor} from './script-ending-animation-cursor';
import type {ScriptDelayCheckpoint} from './script-delay-checkpoint';
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
interface Row {owner:string;binding:any;front:Uint8Array;backup:Uint8Array;upper:any;lower:any;rect:any;dstrect:any;entry:any;sprites:any[];source:any;physical:any;wave:any;checkpoint:any;functions:any[];ctx:any;handler:any;locals:any;prefixWave:any;prefixLocals:any}
let sequence=0;
const spriteBinding=(sprite:any)=>{const buf=sprite.buf,reader=sprite.reader,view=reader?reader._dataview:null;if(!(buf instanceof Uint8Array)||reader&&!(view instanceof DataView))throw new Error('Unsupported animation Sprite binding');return {sprite,buf,buffer:buf.buffer,offset:buf.byteOffset,length:buf.byteLength,digest:endingShowDigest(buf),reader,view,viewBuffer:view?.buffer,viewOffset:view?.byteOffset,viewLength:view?.byteLength,littleEndian:reader?.littleEndian,getFrame:sprite.getFrame,getFrameOffset:sprite.getFrameOffset,getUint16:reader?.getUint16};};
const sameSprite=(a:any,sprite:any)=>{const b:any=spriteBinding(sprite);return Object.keys(a).every(k=>a[k]===b[k]);};
const locals=(r:Row)=>({srcrect:r.entry.srcrect,dstrect:r.entry.dstrect,girlPos:r.entry.girlPos,upperWidth:r.upper.width,upperHeight:r.upper.height,lowerWidth:r.lower.width,lowerHeight:r.lower.height});
const source=(c:EndingAnimationCursor)=>({pc:c.opcodePC,next:c.nextPC,operands:c.operands,upper:c.upperDigest,lower:c.lowerDigest});
const physical=(s:any)=>({front:endingShowDigest(s.byteBuffer),backup:endingShowDigest(s.backup),palette:clone(s.getPalette()),rgba:endingShowDigest(new Uint8Array(s.ctx.getImageData(0,0,320,200).data.buffer)),shake:Surface.shakeTime,level:Surface.shakeLevel});
const wave=(b:any)=>({index:b.scene.index,wave:worldService.getScreenWave(),progress:worldService.getWaveProgression()});
const functions=(s:any)=>[(Surface as any).consumeShakeFrame,s.updateScreen,s.getRect,s.putRect,s.blit,s.blitSurface,s.blitRLE,s.blitFBP,s.blitRLEWithColorShift,s.blitRLEWithMonoColorAndColorShift,s.blitRLEMonoColor,s.backupScreen,s.setPalette,s.getPalette,s.ctx.getImageData,s.ctx.putImageData,s.panoramaHandler?.shouldCaptureUi,s.panoramaHandler?.isActive,s.panoramaHandler?.renderUiBuffer];
export function captureEndingAnimationBinding(b:any):any {
 const s=b.surface;return {...b,renderer:{front:s.byteBuffer,backup:s.backup,ctx:s.ctx,handler:s.panoramaHandler,functions:functions(s),width:s.width,height:s.height,pitch:s.pitch}};
}
/** Matching-runtime ownership: authoritative complete checkpoint plus current physical child paint. */
export class EndingAnimationReferenceLeases {
 private generation=1;private rows=new Map<string,Row>();
 acquire(owner:string,c:EndingAnimationCursor,b:any,entry:any):EndingShowLease {
  if(sequence===Number.MAX_SAFE_INTEGER)throw new Error('Ending animation identities exhausted');
  const id=`ending-animation-${++sequence}`,v=b.renderer;
  if(!v)throw new Error('Animation renderer must be captured before entry');
  this.rows.set(id,{owner,binding:b,front:v.front,backup:v.backup,upper:entry.upper,lower:entry.lower,rect:entry.srcrect,dstrect:entry.dstrect,entry,sprites:[spriteBinding(entry.sprite),spriteBinding(entry.girl)],source:clone(source(c)),physical:null,wave:null,checkpoint:null,functions:v.functions,ctx:v.ctx,handler:v.handler,locals:null,prefixWave:null,prefixLocals:null});
  return {id,generation:this.generation,owner};
 }
 resolve(l:EndingShowLease,owner:string,c:EndingAnimationCursor,b:any,s:any):Row|null {
  const r=this.rows.get(l.id),a=r?.binding;
  return r&&l.generation===this.generation&&l.owner===owner&&r.owner===owner&&a.surface===s&&b.surface===s&&a.renderer.width===s.width&&a.renderer.height===s.height&&a.renderer.pitch===s.pitch&&a.screen===b.screen&&b.screen===s.byteBuffer&&a.reader===b.reader&&a.decompress===b.decompress&&a.initGeneration===b.initGeneration&&a.resourceGeneration===b.resourceGeneration&&a.scene.service===b.scene.service&&a.scene.surface===b.scene.surface&&b.scene.surface===s&&a.scene.apply===b.scene.apply&&a.scene.adapterApply===b.scene.adapterApply&&a.scene.getIndex===b.scene.getIndex&&a.begin===b.begin&&a.step===b.step&&a.finish===b.finish&&r.entry.upper===r.upper&&r.entry.lower===r.lower&&r.entry.srcrect===r.rect&&r.entry.dstrect===r.dstrect&&r.front===s.byteBuffer&&r.backup===s.backup&&r.ctx===s.ctx&&r.handler===s.panoramaHandler&&r.functions.every((f,i)=>f===functions(s)[i])&&sameJsonValue(r.source,source(c))&&sameSprite(r.sprites[0],r.entry.sprite)&&sameSprite(r.sprites[1],r.entry.girl)?r:null;
 }
 completePrefix(l:EndingShowLease,b:any):void {const r=this.rows.get(l.id);if(!r||r.owner!==l.owner||l.generation!==this.generation)throw new Error('Missing ending animation prefix');r.prefixWave=wave(b);r.prefixLocals=clone(locals(r));}
 publish(l:EndingShowLease,cp:ScriptDelayCheckpoint,b:any):void {const r=this.rows.get(l.id);if(!r||r.owner!==l.owner||l.generation!==this.generation)throw new Error('Missing ending animation reference');const c=cp.frames.find(f=>f.endingAnimation?.lease?.id===l.id)?.endingAnimation;if(!c||!this.resolve(l,cp.id,c,b,b.surface)||!this.bytesMatch(r,c))throw new Error('Ending animation source or renderer binding changed before publication');if(r.prefixWave&&!sameJsonValue(r.prefixWave,wave(b))||r.prefixLocals&&!sameJsonValue(r.prefixLocals,locals(r)))throw new Error('Ending animation completed wave or rectangle prefix changed');const currentPhysical=physical(b.surface),currentWave=wave(b),currentLocals=clone(locals(r));if(!this.resolve(l,cp.id,c,b,b.surface)||!this.bytesMatch(r,c)||!sameJsonValue(r.prefixWave,currentWave)||!sameJsonValue(r.prefixLocals,currentLocals))throw new Error('Ending animation source or completed prefix changed during physical capture');r.physical=currentPhysical;r.wave=currentWave;r.locals=currentLocals;r.checkpoint=clone(cp);}
 matches(l:EndingShowLease,cp:ScriptDelayCheckpoint,b:any):boolean {const r=this.rows.get(l.id);return !!r?.checkpoint&&sameJsonValue(r.prefixWave,wave(b))&&sameJsonValue(r.prefixLocals,locals(r))&&sameJsonValue(r.checkpoint,cp)&&sameJsonValue(r.physical,physical(b.surface))&&sameJsonValue(r.wave,wave(b))&&sameJsonValue(r.locals,locals(r));}
 /** Final consumption fence: no getPalette/getImageData or rendering callback. */
 matchesPublishedBindings(l:EndingShowLease,cp:ScriptDelayCheckpoint,b:any):boolean {
  const r=this.rows.get(l.id),s=b.surface;
  return !!r?.checkpoint&&sameJsonValue(r.checkpoint,cp)&&sameJsonValue(r.prefixWave,wave(b))&&sameJsonValue(r.prefixLocals,locals(r))&&r.physical.front===endingShowDigest(s.byteBuffer)&&r.physical.backup===endingShowDigest(s.backup)&&sameJsonValue(r.physical.palette,s.palette)&&r.physical.shake===Surface.shakeTime&&r.physical.level===Surface.shakeLevel;
 }
 bytesMatch(r:Row,c:EndingAnimationCursor):boolean{return endingShowDigest(c.upper)===c.upperDigest&&endingShowDigest(r.upper)===c.upperDigest&&endingShowDigest(c.lower)===c.lowerDigest&&endingShowDigest(r.lower)===c.lowerDigest;}
 consume(l:EndingShowLease):void {const r=this.rows.get(l.id);if(r)r.checkpoint=null;}
 release(l:EndingShowLease):void {if(l.generation===this.generation&&this.rows.get(l.id)?.owner===l.owner)this.rows.delete(l.id);}
 get hasReferences():boolean{return this.rows.size>0;}
 releaseOwner(owner:string):void {for(const [id,r]of this.rows)if(r.owner===owner)this.rows.delete(id);}
 transfer(owner:string,next:string):void {for(const r of this.rows.values())if(r.owner===owner)r.owner=next;}
 clear():void {this.rows.clear();if(this.generation<Number.MAX_SAFE_INTEGER)this.generation++;}
}
const scopes=new WeakMap<object,EndingAnimationReferenceLeases>();
export function endingAnimationLeases(s:object):EndingAnimationReferenceLeases {let scope=scopes.get(s);if(!scope){scope=new EndingAnimationReferenceLeases();scopes.set(s,scope);}return scope;}
