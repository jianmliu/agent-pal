/** Trigger redraw progress. Renderer buffers remain in the matching live environment. */
export interface RedrawCursor {
  opcodePC:number;nextPC:number;operation:5;operands:number[];
  previousOverlay:string|null;branch:'rng'|'battle'|'normal'|null;
  phase:'clear'|'branch'|'gestures'|'compose'|'screen'|'sleep'|'final';
  requestedMs:number;remainingMs:number;
}
export function validateRedrawCursor(c:RedrawCursor,sc:any,pc:number):boolean {
  return !!c && c.operation===5 && sc?.operation===5 && c.opcodePC===pc && c.nextPC===pc+1 &&
    Array.isArray(c.operands) && JSON.stringify(c.operands)===JSON.stringify(Array.from(sc.operand)) &&
    (c.previousOverlay===null || typeof c.previousOverlay==='string') &&
    c.requestedMs===(sc.operand[1]||1)*60 && Number.isFinite(c.remainingMs) && c.remainingMs>=0 && c.remainingMs<=c.requestedMs &&
    (c.phase==='clear' ? c.branch===null && c.remainingMs===0 : ['sleep','compose'].includes(c.phase) && c.branch==='normal');
}
