import {denseEndingBytes,type EndingShowLease} from './script-ending-show-cursor';
import {sameJsonValue} from './script-json-value';
import {validateTimedFadeArgs,type TimedFadeArgs} from './script-timed-fade-cursor';
export interface EndingScrollCursor {
 opcodePC:number;nextPC:number;operation:0xa4;operands:number[];chunk:number;speed:number;down:true;debug:boolean;specialPrefixDone:boolean;
 phase:'sleep'|'fade';frameIndex:number;requestedMs:number;remainingMs:number;args:TimedFadeArgs|null;
 bitmap:number[];target:number[];bitmapDigest:string;targetDigest:string;lease:EndingShowLease|null;
}
export function createEndingScrollCursor(pc:number,sc:any,entry:any):EndingScrollCursor {
 return {opcodePC:pc,nextPC:pc+1,operation:0xa4,operands:Array.from(sc.operand),chunk:sc.operand[0],speed:sc.operand[2]||1,down:true,debug:entry.debugFBP,specialPrefixDone:sc.operand[0]===0x44,phase:'sleep',frameIndex:0,requestedMs:0,remainingMs:0,args:null,bitmap:Array.from(entry.bitmap),target:Array.from(entry.p),bitmapDigest:'',targetDigest:'',lease:null};
}
export function validateEndingScrollCursor(c:EndingScrollCursor,sc:any,pc:number):boolean {
 const fields=['opcodePC','nextPC','operation','operands','chunk','speed','down','debug','specialPrefixDone','phase','frameIndex','requestedMs','remainingMs','args','bitmap','target','bitmapDigest','targetDigest','lease'];
 return !!c&&Object.keys(c).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(c,k))&&c.operation===0xa4&&sc?.operation===0xa4&&c.opcodePC===pc&&c.nextPC===pc+1&&Array.isArray(c.operands)&&c.operands.length>=3&&Object.keys(c.operands).length===c.operands.length&&Array.from({length:c.operands.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(c.operands,i)&&Number.isInteger(c.operands[i])&&c.operands[i]>=0&&c.operands[i]<=65535)&&sameJsonValue(c.operands,Array.from(sc.operand))&&c.chunk===c.operands[0]&&c.speed===(c.operands[2]||1)&&c.down===true&&typeof c.debug==='boolean'&&c.specialPrefixDone===(c.chunk===0x44)&&['sleep','fade'].includes(c.phase)&&Number.isInteger(c.frameIndex)&&c.frameIndex>=0&&c.frameIndex<220&&Number.isFinite(c.requestedMs)&&c.requestedMs>=0&&Number.isFinite(c.remainingMs)&&c.remainingMs>=0&&c.remainingMs<=c.requestedMs&&(c.phase==='fade'?validateTimedFadeArgs(c.args)&&c.args?.family==='in'&&c.args.time===1&&c.requestedMs===0&&c.remainingMs===0:c.args===null)&&denseEndingBytes(c.bitmap)&&denseEndingBytes(c.target)&&c.target.length===64000&&[c.bitmapDigest,c.targetDigest].every(x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x))&&!!c.lease&&Object.keys(c.lease).length===3&&typeof c.lease.id==='string'&&!!c.lease.id&&Number.isSafeInteger(c.lease.generation)&&c.lease.generation>0&&typeof c.lease.owner==='string'&&!!c.lease.owner;
}
