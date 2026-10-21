import type {WorldReferenceLease} from './world-reference-leases';
export interface WorldCompositionSelection {
 site:'entry-compose'|'proximity-compose';sceneId:number;eventId:number;eventIndex:number|null;
 lease?:WorldReferenceLease;
}
/** Stable script and owned internal render boundaries. */
export interface WorldUpdateCursor {
  composition?:WorldCompositionSelection;
  sceneId:number;
  phase:'entry'|'entry-return'|'entry-compose'|'proximity-compose'|'proximity'|'proximity-return'|'auto'|'auto-return'|'done';
  eventIds:number[]; index:number;
  viewport:number; partyOffset:number;
  pendingReturn:null | {field:'scriptOnEnter'|'triggerScript'|'autoScript';eventId:number;entry:number;kind:'trigger'|'auto'};
}
export interface FrameWaitCursor {
  opcodePC:number; nextPC:number; frameCount:number; trigger:boolean; gestures:boolean;
  frameIndex:number; phase:'clear'|'gestures'|'world'|'compose'|'screen'|'sleep'; remainingMs:number;
  worldUpdate?:WorldUpdateCursor;
}
export interface WorldUpdateHooks {
  compose?:(cursor:WorldUpdateCursor,raw?:object)=>Promise<void>;
  resolveComposition?:(cursor:WorldUpdateCursor)=>any;
  releaseComposition?:(cursor:WorldUpdateCursor)=>void;
  invoke:(kind:'trigger'|'auto',entry:number,eventId:number,cursor:WorldUpdateCursor)=>Promise<number>;
}

/** Shared pure validation for opcode 0009 and motion-owned world children. */
export function validateWorldUpdateCursor(u:WorldUpdateCursor,read:(pc:number)=>any):boolean {
 const integer=(v:unknown):v is number=>typeof v==='number' && Number.isSafeInteger(v) && v>=0;
 const packed=(v:unknown)=>Number.isInteger(v) && (v as number)>=-2147483648 && (v as number)<=2147483647;
 const keys=['sceneId','phase','eventIds','index','viewport','partyOffset','pendingReturn',...(u?.composition!==undefined?['composition']:[])];
 if(!u || Object.keys(u).length!==keys.length || Object.keys(u).some(k=>!keys.includes(k)) || !integer(u.sceneId) || !Array.isArray(u.eventIds) || Object.keys(u.eventIds).length!==u.eventIds.length || !Array.from(u.eventIds).every(id=>integer(id)&&id>0&&id<=0xffff) || new Set(u.eventIds).size!==u.eventIds.length || !integer(u.index) || u.index>u.eventIds.length || !packed(u.viewport) || !packed(u.partyOffset))return false;
 if(u.composition!==undefined) {
  const c=u.composition,keys=['site','sceneId','eventId','eventIndex',...(u.phase==='proximity-compose'?['lease']:[])];
  if(!c || Object.keys(c).length!==keys.length || Object.keys(c).some(k=>!keys.includes(k)) || c.site!==u.phase || c.sceneId!==u.sceneId || u.pendingReturn!==null)return false;
  if(c.site==='entry-compose')return c.eventId===0xffff && c.eventIndex===null && u.index===0 && u.eventIds.length===0;
  const l=c.lease;
  return c.site==='proximity-compose' && integer(c.eventIndex) && integer(c.eventId) && c.eventId>0 && c.eventId<=0xffff && u.index<u.eventIds.length && u.eventIds[u.index]===c.eventId && !!l && Object.keys(l).length===3 && Object.keys(l).every(k=>['id','generation','owner'].includes(k)) && typeof l.id==='string' && !!l.id && integer(l.generation) && l.generation>0 && typeof l.owner==='string' && !!l.owner;
 }
 const p=u.pendingReturn;if(!p || !['entry-return','proximity-return','auto-return'].includes(u.phase) || !integer(p.eventId) || p.eventId>0xffff || !integer(p.entry))return false;
 const sc=read(p.entry);if(!sc || !integer(sc.operation) || sc.operation>0xffff || !sc.operand || sc.operand.length<3 || !Array.from(sc.operand).every(v=>integer(v)&&v<=0xffff))return false;
 if(!['scriptOnEnter','triggerScript','autoScript'].includes(p.field) || p.kind!==(p.field==='autoScript'?'auto':'trigger'))return false;
 return p.field==='scriptOnEnter'?u.phase==='entry-return'&&p.eventId===0xffff:u.phase===(p.field==='triggerScript'?'proximity-return':'auto-return')&&u.index<u.eventIds.length&&u.eventIds[u.index]===p.eventId;
}

export interface WorldCursorEntry {id:number|null;index:number|null;state:Record<string,unknown>|null}
/** Keep the original world traversal order across a child and scene change. */
export function orderWorldCursorEntries(entries:WorldCursorEntry[],cursor:WorldUpdateCursor,lookup:(id:number)=>WorldCursorEntry|null):Array<WorldCursorEntry|undefined> {
 const byId=new Map(entries.map(entry=>[entry.id,entry])),pendingId=cursor.composition?.eventId ?? cursor.pendingReturn?.eventId;
 if(pendingId!==undefined){
  const pending=byId.get(pendingId) || lookup(pendingId);
  // The invocation is already owned. Even a removed object cannot cancel its
  // child; the empty state reaches the saved-return branch before rereading it.
  byId.set(pendingId,pending?.state?pending:{id:pendingId,index:pending?.index??null,state:{}});
 }
 return cursor.eventIds.map(id=>byId.get(id));
}
