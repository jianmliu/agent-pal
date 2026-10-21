import {denseEndingBytes,type EndingShowLease} from './script-ending-show-cursor';
import {sameJsonValue} from './script-json-value';
import {validateTimedFadeArgs,type TimedFadeArgs} from './script-timed-fade-cursor';
export interface EndingAnimationCursor {
 opcodePC:number;nextPC:number;operation:0x96;operands:number[];
 phase:'sleep'|'fade';frameIndex:number;girlPos:number;requestedMs:number;remainingMs:number;nominalMs:50;args:TimedFadeArgs|null;
 upper:number[];lower:number[];upperDigest:string;lowerDigest:string;lease:EndingShowLease|null;
}
export function createEndingAnimationCursor(pc:number,sc:any,entry:any):EndingAnimationCursor {
 return {opcodePC:pc,nextPC:pc+1,operation:0x96,operands:Array.from(sc.operand),phase:'sleep',frameIndex:0,girlPos:180,requestedMs:0,remainingMs:0,nominalMs:50,args:null,upper:Array.from(entry.upper),lower:Array.from(entry.lower),upperDigest:'',lowerDigest:'',lease:null};
}
export function validateEndingAnimationCursor(c:EndingAnimationCursor,sc:any,pc:number):boolean {
 const fields=['opcodePC','nextPC','operation','operands','phase','frameIndex','girlPos','requestedMs','remainingMs','nominalMs','args','upper','lower','upperDigest','lowerDigest','lease'];
 return !!c&&Object.keys(c).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(c,k))&&c.operation===0x96&&sc?.operation===0x96&&c.opcodePC===pc&&c.nextPC===pc+1&&Array.isArray(c.operands)&&c.operands.length>=3&&Object.keys(c.operands).length===c.operands.length&&Array.from({length:c.operands.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(c.operands,i)&&Number.isInteger(c.operands[i])&&c.operands[i]>=0&&c.operands[i]<=65535)&&sameJsonValue(c.operands,Array.from(sc.operand))&&['sleep','fade'].includes(c.phase)&&Number.isInteger(c.frameIndex)&&c.frameIndex>=0&&c.frameIndex<400&&c.girlPos===Math.max(80,180-Math.floor((c.frameIndex+1)/2))&&c.nominalMs===50&&Number.isFinite(c.requestedMs)&&c.requestedMs>=0&&Number.isFinite(c.remainingMs)&&c.remainingMs>=0&&c.remainingMs<=c.requestedMs&&(c.phase==='fade'?validateTimedFadeArgs(c.args)&&c.args?.family==='in'&&c.args.time===1&&c.requestedMs===0&&c.remainingMs===0:c.args===null)&&denseEndingBytes(c.upper)&&c.upper.length===64000&&denseEndingBytes(c.lower)&&c.lower.length===64000&&[c.upperDigest,c.lowerDigest].every(x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x))&&!!c.lease&&Object.keys(c.lease).length===3&&typeof c.lease.id==='string'&&!!c.lease.id&&Number.isSafeInteger(c.lease.generation)&&c.lease.generation>0&&typeof c.lease.owner==='string'&&!!c.lease.owner;
}
