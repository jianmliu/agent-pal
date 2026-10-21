import {sameJsonValue} from './script-json-value';
export interface GeneratedDialogLease {id:string;generation:number;owner:string}
export type GeneratedDialogPhase='preclear'|'wait-enter'|'gesture'|'compose'|'screen'|'poll-sleep'|'poll-check'|'wait-exit'|'box-free'|'box-update'|'generated-end'|'shadow-reset'|'done';
/** All timer values are relative milliseconds. Native Date epoch is lease-local. */
export interface GeneratedDialogCursor {
  source:'collect-transform';operation:0x34;opcodePC:number;nextPC:number;operands:number[];
  ownerKind:'trigger'|'auto';eventId:number;mode:'classic'|'suppressed';
  phase:GeneratedDialogPhase;site:'preclear'|'generated';lease:GeneratedDialogLease;
  collectBound:number|null;sample:number|null;cap:number|null;index:number|null;itemId:number|null;
  word42:number[]|null;wordItem:number[]|null;raw:number[]|null;
  poll:number;gameSpeed:number|null;requestedMs:number;remainingMs:number;elapsedMs:number;activeWorkMs:number;acknowledged:boolean;
  hasBox:boolean;rect:{x:number;y:number;w:number;h:number}|null;
  offsetX:0;offsetY:-10;shadow:5;
}
export interface GeneratedDialogWait {
  kind:'generated-dialog';opcodePC:number;nextPC:number;site:GeneratedDialogCursor['site'];poll:number;
  requestedMs:number;remainingMs:number;
  prompt:{kind:'advance';options:[{label:'Continue';value:true}]};
}
const phases:GeneratedDialogPhase[]=['preclear','wait-enter','gesture','compose','screen','poll-sleep','poll-check','wait-exit','box-free','box-update','generated-end','shadow-reset','done'];
const keys=['source','operation','opcodePC','nextPC','operands','ownerKind','eventId','mode','phase','site','lease','collectBound','sample','cap','index','itemId','word42','wordItem','raw','poll','gameSpeed','requestedMs','remainingMs','elapsedMs','activeWorkMs','acknowledged','hasBox','rect','offsetX','offsetY','shadow'];
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const dense=(v:any):v is number[]=>Array.isArray(v)&&Object.keys(v).length===v.length&&Array.from({length:v.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(v,i));
const bytes=(v:any):v is number[]=>dense(v)&&v.every(n=>integer(n)&&n<=255);
export function createGeneratedDialogCursor(pc:number,sc:any,ownerKind:GeneratedDialogCursor['ownerKind'],eventId:number,mode:GeneratedDialogCursor['mode'],lease:GeneratedDialogLease):GeneratedDialogCursor {
  return {source:'collect-transform',operation:0x34,opcodePC:pc,nextPC:pc+1,operands:Array.from(sc.operand),ownerKind,eventId,mode,phase:'preclear',site:'preclear',lease:{...lease},collectBound:null,sample:null,cap:null,index:null,itemId:null,word42:null,wordItem:null,raw:null,poll:0,gameSpeed:null,requestedMs:0,remainingMs:0,elapsedMs:0,activeWorkMs:0,acknowledged:false,hasBox:false,rect:null,offsetX:0,offsetY:-10,shadow:5};
}
export function validateGeneratedDialogCursor(c:GeneratedDialogCursor,sc:any,pc:number,kind:GeneratedDialogCursor['ownerKind'],eventId:number):boolean {
  if(!c||Object.keys(c).length!==keys.length||!Object.keys(c).every(k=>keys.includes(k))||c.source!=='collect-transform'||c.operation!==0x34||sc?.operation!==0x34||c.opcodePC!==pc||c.nextPC!==pc+1||c.ownerKind!==kind||c.eventId!==eventId||!integer(eventId)||eventId>65535||!dense(c.operands)||c.operands.length<3||c.operands.some(n=>!integer(n)||n>65535)||!sameJsonValue(c.operands,Array.from(sc.operand))||!['classic','suppressed'].includes(c.mode)||!phases.includes(c.phase)||!['preclear','generated'].includes(c.site)||c.offsetX!==0||c.offsetY!==-10||c.shadow!==5)return false;
  const l=c.lease;
  if(!l||Object.keys(l).length!==3||Object.keys(l).some(k=>!['id','generation','owner'].includes(k))||typeof l.id!=='string'||!l.id||typeof l.owner!=='string'||!l.owner||!integer(l.generation)||l.generation<1)return false;
  if(!integer(c.poll)||!finite(c.requestedMs)||!finite(c.remainingMs)||c.remainingMs>c.requestedMs||!finite(c.elapsedMs)||!finite(c.activeWorkMs)||typeof c.acknowledged!=='boolean'||typeof c.hasBox!=='boolean')return false;
  if(c.gameSpeed!==null&&(!finite(c.gameSpeed)||c.gameSpeed<=0))return false;
  if(c.requestedMs>0&&(c.gameSpeed===null||c.requestedMs!==100/c.gameSpeed))return false;
  if(c.phase==='poll-sleep'?(c.poll<1||c.requestedMs<=0||c.remainingMs<=0):c.phase==='poll-check'&&(c.poll<1||c.requestedMs<=0||c.remainingMs!==0))return false;
  if(c.rect!==null&&(!c.rect||Object.keys(c.rect).length!==4||Object.keys(c.rect).some(k=>!['x','y','w','h'].includes(k))||Object.values(c.rect).some(v=>!Number.isSafeInteger(v))||c.rect.w<0||c.rect.h<0))return false;
  if(c.hasBox!==(c.rect!==null))return false;
  if(c.site==='preclear')return [c.collectBound,c.sample,c.cap,c.index,c.itemId,c.word42,c.wordItem,c.raw].every(v=>v===null)&&!c.hasBox&&c.phase!=='box-free'&&c.phase!=='box-update'&&c.phase!=='generated-end'&&c.phase!=='shadow-reset';
  if(!integer(c.collectBound)||c.collectBound<1||!integer(c.sample)||c.sample<1||c.sample>c.collectBound||c.cap!==Math.min(c.sample,9)||c.index!==c.cap-1||!integer(c.itemId)||c.itemId>65535||!bytes(c.word42)||!bytes(c.wordItem)||!bytes(c.raw))return false;
  return sameJsonValue(c.raw,c.word42.concat([64],c.wordItem,[64]))&&!(c.mode==='suppressed'&&c.hasBox);
}
export function generatedDialogWait(c:GeneratedDialogCursor):GeneratedDialogWait {
  return {kind:'generated-dialog',opcodePC:c.opcodePC,nextPC:c.opcodePC,site:c.site,poll:c.poll,requestedMs:c.requestedMs,remainingMs:c.remainingMs,prompt:{kind:'advance',options:[{label:'Continue',value:true}]}};
}
/** One return fulfills only the outstanding relative sleep; overshoot never funds future polls. */
export function advanceGeneratedDialogPoll(c:GeneratedDialogCursor,elapsed:number):void {
  if(c.phase!=='poll-sleep'||!finite(elapsed)||!Number.isFinite(c.elapsedMs+elapsed))throw new Error('Invalid generated dialog elapsed return');
  c.elapsedMs+=elapsed;c.remainingMs=Math.max(0,c.remainingMs-elapsed);
  if(c.remainingMs===0)c.phase='poll-check';
}
