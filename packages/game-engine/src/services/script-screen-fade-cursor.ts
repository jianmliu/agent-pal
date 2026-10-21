import {sameJsonValue} from './script-json-value';
export interface ScreenAliasLease {id:string;generation:number;owner:string}
export interface ScreenFadeProgress {target:number[];substep:number;nominalMs:number;requestedMs:number;remainingMs:number;frontDigest:string;backupDigest:string;targetDigest:string;width:320;height:200;pitch:320;lease:ScreenAliasLease}
/** A screen helper belongs to its opcode source, never to a public helper root. */
export interface ScreenFadeSource {opcodePC:number;nextPC:number;operation:0x73|0x9b;operands:number[];previousOverlay:string|null;phase:'compose'|'screen';screen:ScreenFadeProgress|null}
const keys=(v:any,fields:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(v,k));
export const denseScreenBytes=(a:unknown):a is number[]=>Array.isArray(a)&&a.length===64000&&Object.keys(a).length===64000&&Array.from({length:64000},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(a,i)&&Number.isInteger(a[i])&&a[i]>=0&&a[i]<=255);
const digest=(s:unknown)=>typeof s==='string'&&/^0x[0-9a-f]{64}$/.test(s);
export function createScreenFadeSource(pc:number,sc:any,previousOverlay:string|null):ScreenFadeSource{return {opcodePC:pc,nextPC:pc+1,operation:sc.operation,operands:Array.from(sc.operand),previousOverlay,phase:'compose',screen:null};}
export function validateScreenFadeSource(c:ScreenFadeSource,sc:any,pc:number):boolean {
 if(!keys(c,['opcodePC','nextPC','operation','operands','previousOverlay','phase','screen'])||![0x73,0x9b].includes(c.operation)||sc?.operation!==c.operation||c.opcodePC!==pc||c.nextPC!==pc+1||!Array.isArray(c.operands)||c.operands.length<3||Object.keys(c.operands).length!==c.operands.length||!Array.from({length:c.operands.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(c.operands,i)&&Number.isInteger(c.operands[i])&&c.operands[i]>=0&&c.operands[i]<=65535)||!sameJsonValue(c.operands,Array.from(sc.operand))||!(c.previousOverlay===null||typeof c.previousOverlay==='string'))return false;
 if(c.phase==='compose')return c.screen===null;
 const p=c.screen;
 return c.phase==='screen'&&keys(p,['target','substep','nominalMs','requestedMs','remainingMs','frontDigest','backupDigest','targetDigest','width','height','pitch','lease'])&&denseScreenBytes(p!.target)&&Number.isInteger(p!.substep)&&p!.substep>=0&&p!.substep<72&&p!.nominalMs===((c.operation===0x73?c.operands[0]:2)+1)*4&&Number.isFinite(p!.requestedMs)&&p!.requestedMs>=0&&Number.isFinite(p!.remainingMs)&&p!.remainingMs>=0&&p!.remainingMs<=p!.requestedMs&&[p!.frontDigest,p!.backupDigest,p!.targetDigest].every(digest)&&p!.width===320&&p!.height===200&&p!.pitch===320&&keys(p!.lease,['id','generation','owner'])&&typeof p!.lease.id==='string'&&p!.lease.id.length>0&&Number.isSafeInteger(p!.lease.generation)&&p!.lease.generation>0&&typeof p!.lease.owner==='string'&&p!.lease.owner.length>0;
}
