/** Pure state for PAL_UpdateEquipments. Capture destinations before entering a child. */
export interface EquipmentPending {
  itemId: number;
  scriptEntry: number;
  role: number;
  part: number;
}
export interface EquipmentCursor {
  resetDone: boolean;
  role: number;
  part: number;
  pending: EquipmentPending | null;
}
/** Native party/resource/poison work completes before publishing a helper checkpoint. */
export interface PartyEquipmentCursor {
  opcodePC: number;
  nextPC: number;
  operands: number[];
  assignmentDone: true;
  resourcesDone: true;
  poisonResetDone: true;
}
export function createEquipmentCursor(): EquipmentCursor {
  return { resetDone: false, role: 0, part: 0, pending: null };
}
export function advanceEquipmentCursor(c: EquipmentCursor): void {
  c.pending = null;
  if (++c.part === 6) {
    c.part = 0;
    c.role++;
  }
}
const word = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 0xffff;
export function validateEquipmentCursor(c: any): c is EquipmentCursor {
  if (!c || typeof c.resetDone !== 'boolean' || !Number.isInteger(c.role) || c.role < 0 || c.role > 6 ||
      !Number.isInteger(c.part) || c.part < 0 || c.part > 5 || (c.role === 6 && c.part !== 0) ||
      (!c.resetDone && (c.role !== 0 || c.part !== 0 || c.pending !== null))) return false;
  const p = c.pending;
  return p === null || !!(c.resetDone && c.role < 6 && p && word(p.itemId) && p.itemId > 0 &&
    word(p.scriptEntry) && p.scriptEntry > 0 && p.role === c.role && p.part === c.part);
}
export function validatePartyEquipmentCursor(c: any, sc: any, pc: number): c is PartyEquipmentCursor {
  return !!c && sc?.operation === 0x75 && c.opcodePC === pc && c.nextPC === pc + 1 &&
    c.assignmentDone === true && c.resourcesDone === true && c.poisonResetDone === true &&
    Array.isArray(c.operands) && c.operands.length === 3 &&
    c.operands.every((v: any, i: number) => word(v) && v === sc.operand[i]);
}
