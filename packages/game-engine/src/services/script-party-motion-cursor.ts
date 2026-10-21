import type {WorldUpdateCursor} from './world-update-cursor';
/** Private native helper locals, retained independently of child-mutated world state. */
export interface PartyMotionCursor {
 opcodePC:number;nextPC:number;operation:number;operands:number[];eventId:number;
 family:'walk'|'ride'|'viewport';speed:number;targetX:number;targetY:number;
 viewport:number;partyOffset:number;offsetX:number;offsetY:number;lastPartyIndex:number;iteration:number;
 phase:'move'|'gestures'|'world'|'compose'|'screen'|'measure'|'sleep'|'final'|'done';remainingMs:number;
 worldUpdate?:WorldUpdateCursor;
}
export const motionFamily=(op:number):PartyMotionCursor['family']|null=>[0x70,0x7a,0x7b].includes(op)?'walk':[0x3f,0x44,0x97].includes(op)?'ride':op===0x7f?'viewport':null;
export const motionSpeed=(op:number)=>[0x70,0x3f].includes(op)?2:[0x7a,0x44].includes(op)?4:[0x7b,0x97].includes(op)?8:0;
export function validatePartyMotionCursor(c:PartyMotionCursor,sc:any,pc:number,eventId:number):boolean {
 const int=(n:unknown)=>Number.isInteger(n) && (n as number)>=-2147483648 && (n as number)<=2147483647;
 if(!c || !motionFamily(c.operation) || c.operation!==sc?.operation || c.opcodePC!==pc || c.nextPC!==pc+1 || c.eventId!==eventId || c.family!==motionFamily(c.operation) || c.speed!==motionSpeed(c.operation) || !Array.isArray(c.operands) || JSON.stringify(c.operands)!==JSON.stringify(Array.from(sc.operand)))return false;
 if(![c.targetX,c.targetY,c.viewport,c.partyOffset,c.offsetX,c.offsetY,c.lastPartyIndex,c.iteration].every(int) || c.lastPartyIndex<0 || c.lastPartyIndex>0x10005 || c.iteration<0 || c.iteration>32768 || !['world','sleep','compose'].includes(c.phase) || !Number.isFinite(c.remainingMs) || c.remainingMs<0 || c.remainingMs>16)return false;
 if(c.worldUpdate!==undefined && (!c.worldUpdate || typeof c.worldUpdate!=='object' || Array.isArray(c.worldUpdate)))return false;
 const [x,y,z]=c.operands;
 if(c.family==='walk' && c.phase==='sleep' && (c.offsetX!==c.targetX-(c.viewport&0xffff)-(c.partyOffset&0xffff) || c.offsetY!==c.targetY-((c.viewport>>16)&0xffff)-((c.partyOffset>>16)&0xffff)))return false;
 if(c.family!=='viewport' && (c.iteration!==0 || c.lastPartyIndex!==0))return false;
 if(c.family==='viewport' && ((x===0 && y===0 && c.phase!=='compose') || c.iteration>=Math.max(1,(z<<16)>>16) || (z===0xffff && c.phase==='world')))return false;

 return c.targetX===(c.family==='viewport'?x*32-160:x*32+z*16) && c.targetY===(c.family==='viewport'?y*16-112:y*16+z*8) && (c.phase==='world'?!!c.worldUpdate && c.remainingMs===0:!c.worldUpdate);
}
