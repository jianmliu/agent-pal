import {sameJsonValue} from './script-json-value';
export interface EndingShowLease {id:string;generation:number;owner:string}
export interface EndingShowCursor {
 opcodePC:number;nextPC:number;operation:0x76|0xa5;operands:number[];phase:'sleep';chunk:number;fade:number;debug:boolean;
 bitmap:number[];target:number[];step:number;requestedMs:number;remainingMs:number;
 frontDigest:string;backupDigest:string;bitmapDigest:string;targetDigest:string;lease:EndingShowLease|null;
}
const keys=(v:any,fields:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(v,k));
export const denseEndingBytes=(a:unknown):a is number[]=>{
 if(!Array.isArray(a))return false;
 const count=Object.keys(a).length;
 if(count!==a.length)return false;
 const length=a.length;
 // A Proxy can change/coerce its second length read; retain Array.from semantics there.
 if(length!==count)return Array.from({length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(a,i)&&Number.isInteger(a[i])&&a[i]>=0&&a[i]<=255);
 for(let i=0;i<length;i++){
  // Preserve the original three conditional reads, including mutable accessors.
  if(!(Object.prototype.hasOwnProperty.call(a,i)&&Number.isInteger(a[i])&&a[i]>=0&&a[i]<=255))return false;
 }
 return true;
};
const digest=(s:unknown)=>typeof s==='string'&&/^0x[0-9a-f]{64}$/.test(s);
export function createEndingShowCursor(pc:number,sc:any,bitmap:Uint8Array,target:Uint8Array,debug:boolean):EndingShowCursor {
 return {opcodePC:pc,nextPC:pc+1,operation:sc.operation,operands:Array.from(sc.operand),phase:'sleep',chunk:sc.operand[0],fade:sc.operand[sc.operation===0x76?1:2],debug,bitmap:Array.from(bitmap),target:Array.from(target),step:0,requestedMs:0,remainingMs:0,frontDigest:'',backupDigest:'',bitmapDigest:'',targetDigest:'',lease:null};
}
export function validateEndingShowCursor(c:EndingShowCursor,sc:any,pc:number):boolean {
 return keys(c,['opcodePC','nextPC','operation','operands','phase','chunk','fade','debug','bitmap','target','step','requestedMs','remainingMs','frontDigest','backupDigest','bitmapDigest','targetDigest','lease'])&&[0x76,0xa5].includes(c.operation)&&sc?.operation===c.operation&&c.opcodePC===pc&&c.nextPC===pc+1&&denseEndingBytes(c.bitmap)&&denseEndingBytes(c.target)&&c.target.length===64000&&Array.isArray(c.operands)&&c.operands.length>=3&&Object.keys(c.operands).length===c.operands.length&&Array.from({length:c.operands.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(c.operands,i)&&Number.isInteger(c.operands[i])&&c.operands[i]>=0&&c.operands[i]<=65535)&&sameJsonValue(c.operands,Array.from(sc.operand))&&c.chunk===c.operands[0]&&c.fade===c.operands[c.operation===0x76?1:2]&&c.fade>0&&c.phase==='sleep'&&typeof c.debug==='boolean'&&Number.isInteger(c.step)&&c.step>=0&&c.step<96&&Number.isFinite(c.requestedMs)&&c.requestedMs>=0&&Number.isFinite(c.remainingMs)&&c.remainingMs>=0&&c.remainingMs<=c.requestedMs&&[c.frontDigest,c.backupDigest,c.bitmapDigest,c.targetDigest].every(digest)&&keys(c.lease,['id','generation','owner'])&&typeof c.lease!.id==='string'&&c.lease!.id.length>0&&Number.isSafeInteger(c.lease!.generation)&&c.lease!.generation>0&&typeof c.lease!.owner==='string'&&c.lease!.owner.length>0;
}
