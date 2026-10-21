/** Completed native movement awaiting scene composition or its owned 16ms tail.
 * World positions are deliberately not used to reconstruct the completed decision. */
export interface NpcMotionCursor {
 opcodePC:number;operation:number;operands:number[];eventId:number;
 targetId:number;targetPresent:boolean;movementCompleted:boolean;
 returnPC:number;nextPC:number;phase:'compose'|'sleep';remainingMs:number;
}
export const isNpcMotionOpcode=(operation:number):boolean=>[0x10,0x11,0x6c,0x7c,0x82].includes(operation);
export function validateNpcMotionCursor(c:NpcMotionCursor,sc:any,pc:number,eventId:number):boolean {
 const word=(v:unknown)=>Number.isSafeInteger(v) && (v as number)>=0 && (v as number)<=0xffff;
 return !!c && isNpcMotionOpcode(c.operation) && c.operation===sc?.operation && c.opcodePC===pc && c.eventId===eventId && word(c.targetId) && typeof c.targetPresent==='boolean' &&
 Array.isArray(c.operands) && JSON.stringify(c.operands)===JSON.stringify(Array.from(sc.operand)) &&
 c.nextPC===pc+1 && ['compose','sleep'].includes(c.phase) && Number.isFinite(c.remainingMs) && c.remainingMs>=0 && c.remainingMs<=16 &&
 c.movementCompleted===(c.operation===0x6c) && c.returnPC===(c.operation===0x6c?pc+1:pc) && (c.operation===0x6c || c.targetId===eventId);
}
