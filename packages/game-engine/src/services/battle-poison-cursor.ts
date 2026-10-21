import {type ChildFrame,type ChildCursor,createChildCursor,selectChildFrame,commitChildFrame,pushChildFrame,returnChildFrame,writeChildReturn,copyChildCursor} from './battle-child-script-cursor';
import {detachedData} from './execution-scheduler';
export interface PoisonSource {side:'party'|'enemy';actor:number;slot:number;poisonId:number}
export type PoisonChildFrame = ChildFrame;
export type BattlePoisonCursor = ChildCursor<PoisonSource>;
const integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;
export function validatePoisonCursor(c:BattlePoisonCursor):void {
  if(c.version!==1||!['party','enemy'].includes(c.source.side)||![c.source.actor,c.source.slot].every(n=>integer(n))||!integer(c.source.poisonId,1)||
    !['execute-script','write-next-entry','returned'].includes(c.stage)||c.frames.length>256||
    (c.stage==='execute-script'?c.frames.length===0:c.frames.length!==0)||
    (c.nextEntry!==null&&!integer(c.nextEntry))||typeof c.registers.scriptSuccess!=='boolean'||!integer(c.registers.curEquipPart,-1))throw new TypeError('invalid poison cursor');
  for(const f of c.frames){if(![f.entry,f.currentPC,f.continuationPC,f.eventId,f.loopSafetyCounter].every(n=>integer(n))||typeof f.ended!=='boolean'||!['explicit','opaque'].includes(f.effect)||
    (f.parentReturn&&(!integer(f.parentReturn.opcodePC)||!integer(f.parentReturn.nextPC)||f.parentReturn.returnPolicy!=='discard'))||
    (f.frameWait&&(!integer(f.frameWait.frame)||!integer(f.frameWait.remainingFrames,1)||!['update','present','sleep'].includes(f.frameWait.stage)||!Number.isFinite(f.frameWait.remainingMs)||f.frameWait.remainingMs<0)))throw new TypeError('invalid poison frame');}
}
export function createBattlePoisonCursor(source:PoisonSource,entry:number,eventId:number,registers:BattlePoisonCursor['registers']):BattlePoisonCursor {
  const c=createChildCursor({...source},entry,eventId,registers);validatePoisonCursor(c);return c;
}
export function selectPoisonFrame(c:BattlePoisonCursor):PoisonChildFrame {validatePoisonCursor(c);if(c.stage!=='execute-script')throw new Error('poison child returned');return selectChildFrame(c);}
export function commitPoisonFrame(c:BattlePoisonCursor,f:PoisonChildFrame):void {validatePoisonCursor(c);commitChildFrame(c,f);}
export function pushPoisonFrame(c:BattlePoisonCursor,entry:number,eventId:number):void {validatePoisonCursor(c);pushChildFrame(c,entry,eventId);}
export function returnPoisonFrame(c:BattlePoisonCursor,nextEntry:number):void {selectPoisonFrame(c);if(!integer(nextEntry))throw new TypeError('invalid poison return');returnChildFrame(c,nextEntry);}
export function writePoisonReturn(c:BattlePoisonCursor,writer:(entry:number)=>void):void {validatePoisonCursor(c);if(c.stage!=='write-next-entry'||c.nextEntry===null)throw new Error('poison return already written');writeChildReturn(c,writer);}
export function copyPoisonCursor(c:BattlePoisonCursor):BattlePoisonCursor {validatePoisonCursor(c);return copyChildCursor(c);}
