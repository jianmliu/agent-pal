import { validateDelayCheckpoint } from '../services/script-delay-checkpoint';
import assert from 'node:assert/strict';
import { createEquipmentCursor, advanceEquipmentCursor, validateEquipmentCursor } from '../services/script-equipment-cursor';
const c = createEquipmentCursor();
assert.deepEqual(c, { resetDone: false, role: 0, part: 0, pending: null });
c.resetDone = true;
for (let role = 0; role < 6; role++)
    for (let part = 0; part < 6; part++) {
        assert.equal(c.role, role);
        assert.equal(c.part, part);
        advanceEquipmentCursor(c);
    }
assert.equal(c.role, 6);
assert.equal(c.part, 0);
assert.equal(validateEquipmentCursor(c), true);
assert.equal(validateEquipmentCursor({ ...c, part: 1 }), false);
console.log('script-equipment-cursor smoke passed');
const pending = { itemId: 274, scriptEntry: 10, role: 2, part: 5 };
const helper = { kind: 'equipment', currentPC: 0, continuationPC: 0, eventId: 0, loopSafetyCounter: 0, equipmentCursor: { resetDone: true, role: 2, part: 5, pending }, parentReturn: { kind: 'equipment-item', ...pending } };
const leaf = { kind: 'trigger', currentPC: 11, continuationPC: 10, eventId: 2, loopSafetyCounter: 2, parentReturn: null };
const checkpoint = { version: 2, id: 'helper-model', revision: 0, registers: { scriptSuccess: false, curEquipPart: 5 }, frames: [helper, leaf], wait: { kind: 'delay', opcodePC: 11, nextPC: 12, requestedMs: 80, remainingMs: 80 } };
const read = (pc: number) => { assert.notEqual(pc, 0, 'equipment helper never reads a fake instruction'); return { operation: pc === 11 ? 0x85 : pc === 20 ? 0x75 : 0, operand: pc === 20 ? [3, 1, 0] : [1, 0, 0] }; };
const readItem=(itemId:number)=>itemId===274?{item:{}}:null;
assert.equal(validateDelayCheckpoint(checkpoint, read,readItem), null);
const party = { kind: 'auto', currentPC: 20, continuationPC: 20, eventId: 1, loopSafetyCounter: 0, parentReturn: { kind: 'party-equipment', opcodePC: 20, nextPC: 21 }, partyEquipmentCursor: { opcodePC: 20, nextPC: 21, operands: [3, 1, 0], assignmentDone: true, resourcesDone: true, poisonResetDone: true } };
assert.equal(validateDelayCheckpoint({ ...checkpoint, frames: [party, helper, leaf] }, read,readItem), null);
for (const change of [
    (x: any) => x.frames[0].equipmentCursor.resetDone = false,
    (x: any) => x.frames[0].equipmentCursor.role = 6,
    (x: any) => x.frames[0].equipmentCursor.part = -1,
    (x: any) => x.frames[0].equipmentCursor.pending.itemId = 65536,
    (x: any) => x.frames[0].equipmentCursor.pending.scriptEntry = -1,
    (x: any) => x.frames[0].equipmentCursor.pending.role = 1,
    (x: any) => x.frames[0].equipmentCursor.pending.part = 0,
    (x: any) => x.frames[0].parentReturn.itemId++,
    (x: any) => x.frames[1].eventId = 1,
    (x: any) => x.frames[0].parentReturn = null,
    (x: any) => x.frames[0].currentPC = 10,
    (x: any) => x.version = 1,
]) {
    const broken = JSON.parse(JSON.stringify(checkpoint));
    change(broken);
    assert.ok(validateDelayCheckpoint(broken, read,readItem));
}
for (const field of ['assignmentDone', 'resourcesDone', 'poisonResetDone']) {
    const broken = JSON.parse(JSON.stringify({ ...checkpoint, frames: [party, helper, leaf] }));
    broken.frames[0].partyEquipmentCursor[field] = false;
    assert.ok(validateDelayCheckpoint(broken, read,readItem));
}
console.log('script-equipment-checkpoint smoke passed');

assert.equal(validateDelayCheckpoint(checkpoint,read,itemId=>itemId===274?{item:{}}:null),null);
assert.ok(validateDelayCheckpoint(checkpoint,read,()=>null));
assert.ok(validateDelayCheckpoint(checkpoint,read));
