/** Captured legacy locals for a poison opcode waiting for its trigger child. */
export interface PoisonPending {target:number;partyIndex?:number;slot:number;childEntry:number;childEventId:number}
export interface PoisonCursor {opcodePC:number;nextPC:number;poisonId:number;all:boolean;kind:'player'|'enemy';targets:number[];index:number;pending:PoisonPending|null}
const word=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=0xffff;
export function validatePoisonCursor(c:PoisonCursor,sc:any,pc:number,event:number):boolean {
  if(!c || c.opcodePC!==pc || c.nextPC!==pc+1 || !word(c.poisonId) || c.poisonId!==sc?.operand?.[1] || typeof c.all!=='boolean' || c.all!==!!sc.operand[0] || c.kind!==(sc.operation===0x29?'player':sc.operation===0x28?'enemy':null) || !Array.isArray(c.targets) || c.targets.length>5 || !c.targets.every(v=>word(v) && v<(c.kind==='player'?6:5)) || !Number.isSafeInteger(c.index) || c.index<0 || c.index>=c.targets.length || (!c.all && (c.targets.length!==1 || c.targets[0]!==event))) return false;
  if(c.kind==='enemy' && c.all && !c.targets.every((v,i)=>v===i)) return false;
  const p=c.pending;
  return !!p && p.target===c.targets[c.index] && word(p.target) && word(p.childEntry) && word(p.childEventId) && Number.isInteger(p.slot) && p.slot>=0 && p.slot<16 && (c.kind==='player' ? Number.isInteger(p.partyIndex) && p.partyIndex!>=0 && p.partyIndex!<5 && p.childEventId===p.target : p.partyIndex===undefined && p.childEventId===event);
}
