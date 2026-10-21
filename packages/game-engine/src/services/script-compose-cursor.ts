import {validateTimedFadeArgs,type TimedFadeArgs} from './script-timed-fade-cursor';
import {sameJsonValue} from './script-json-value';
export type ComposeSource='generated-dialog-poll'|'frame'|'npc'|'party'|'redraw'|'palette'|'shop'|'world-entry'|'world-proximity'|'scene-fade'|'screen-fade';
export interface ComposeCursor {source:ComposeSource;opcodePC:number;operation:number;operands:number[];phase:'fade';renderPrefixDone:true;args:Extract<TimedFadeArgs,{family:'in'}>}
export function createComposeCursor(source:ComposeSource,opcodePC:number,sc:any,args:Extract<TimedFadeArgs,{family:'in'}>):ComposeCursor {
 return {source,opcodePC,operation:sc.operation,operands:Array.from(sc.operand),phase:'fade',renderPrefixDone:true,args:{...args}};
}
export function validateComposeCursor(c:ComposeCursor,sc:any,pc:number):boolean {
 const keys=['source','opcodePC','operation','operands','phase','renderPrefixDone','args'];
 return !!c && Object.keys(c).length===keys.length && Object.keys(c).every(k=>keys.includes(k)) && ['generated-dialog-poll','frame','npc','party','redraw','palette','shop','world-entry','world-proximity','scene-fade','screen-fade'].includes(c.source) && c.opcodePC===pc && c.operation===sc?.operation && Array.isArray(c.operands) && Object.keys(c.operands).length===c.operands.length && sameJsonValue(c.operands,Array.from(sc.operand)) && c.phase==='fade' && c.renderPrefixDone===true && validateTimedFadeArgs(c.args) && c.args.family==='in' && c.args.time===1;
}
/** A composition pair exists only at its owner's already-completed render prefix. */
export function composeOwnerMatches(f:any):boolean {
 const c=f.compose as ComposeCursor|undefined;if(!c)return false;
 if(c.source==='generated-dialog-poll') {
  const q=f.generatedDialog;
  return (f.kind==='trigger'||f.kind==='auto')&&q?.source==='collect-transform'&&q.operation===0x34&&q.ownerKind===f.kind&&q.opcodePC===c.opcodePC&&q.phase==='compose'&&q.remainingMs===0&&![f.endingAnimation,f.endingScroll,f.endingShow,f.screenFade,f.rng,f.sceneFade,f.frameWait,f.npcMotion,f.motion,f.redraw,f.palette,f.shopCursor,f.fadeSource,f.dialogAction,f.poisonCursor,f.partyEquipmentCursor,f.equipmentCursor].some(x=>x!==undefined);
 }
 if(c.source==='world-entry'||c.source==='world-proximity') {
  const w=f.frameWait,u=w?.worldUpdate;
  return !f.screenFade && f.kind==='trigger' && !f.motion && !f.palette && !f.npcMotion && !f.redraw && !f.shopCursor && !!w && Object.keys(w).length===9 && Object.keys(w).every(k=>['opcodePC','nextPC','frameCount','trigger','gestures','frameIndex','phase','remainingMs','worldUpdate'].includes(k)) && w.opcodePC===c.opcodePC && w.phase==='world' && w.trigger===true && w.remainingMs===0 && u?.phase===(c.source==='world-entry'?'entry-compose':'proximity-compose') && !!u.composition;
 }
 if(c.source==='screen-fade')return !!f.screenFade && f.screenFade.phase==='compose' && f.screenFade.screen===null && f.screenFade.opcodePC===c.opcodePC && ![f.sceneFade,f.rng,f.frameWait,f.npcMotion,f.motion,f.redraw,f.palette,f.shopCursor,f.fadeSource,f.dialogAction].some(x=>x!==undefined);
 if(c.source==='scene-fade')return !f.screenFade && !!f.sceneFade && f.sceneFade.phase==='compose' && f.sceneFade.opcodePC===c.opcodePC && f.sceneFade.remainingMs===0 && f.sceneFade.worldUpdate===undefined && ![f.frameWait,f.npcMotion,f.motion,f.redraw,f.palette,f.shopCursor,f.fadeSource,f.dialogAction].some(x=>x!==undefined);
 const ownerKeys:Record<Exclude<ComposeSource,'generated-dialog-poll'|'world-entry'|'world-proximity'|'scene-fade'|'screen-fade'>,string[]>={
 frame:['opcodePC','nextPC','frameCount','trigger','gestures','frameIndex','phase','remainingMs'],
 npc:['opcodePC','operation','operands','eventId','targetId','targetPresent','movementCompleted','returnPC','nextPC','phase','remainingMs'],
 party:['opcodePC','nextPC','operation','operands','eventId','family','speed','targetX','targetY','viewport','partyOffset','offsetX','offsetY','lastPartyIndex','iteration','phase','remainingMs'],
 redraw:['opcodePC','nextPC','operation','operands','previousOverlay','branch','phase','requestedMs','remainingMs'],
 palette:['opcodePC','nextPC','operation','operands','family','initialized','step','phase','remainingMs','requestedMs','frameTime','gameSpeed','paletteId','night','color','from','delay','updateScene','original','target','working','final'],
 shop:['opcodePC','nextPC','operation','operands','mode','phase','prepared','index','options','selected']};
 const owners=[f.frameWait,f.npcMotion,f.motion,f.redraw,f.palette,f.shopCursor].filter(x=>x!==undefined);
 const owner=c.source==='frame'?f.frameWait:c.source==='npc'?f.npcMotion:c.source==='party'?f.motion:c.source==='redraw'?f.redraw:c.source==='palette'?f.palette:f.shopCursor;
 const allowedKeys=ownerKeys[c.source];
 return !f.screenFade && owners.length===1 && !!owner && !!allowedKeys && Object.keys(owner).length===allowedKeys.length && Object.keys(owner).every(k=>allowedKeys.includes(k)) && owner.opcodePC===c.opcodePC && owner.phase===(c.source==='shop'?'initial':'compose') && (c.source==='shop'||owner.remainingMs===0) && owner.worldUpdate===undefined && (c.source!=='redraw'||owner.branch==='normal') && (c.source!=='palette'||owner.operation===0x80&&owner.updateScene);
}
