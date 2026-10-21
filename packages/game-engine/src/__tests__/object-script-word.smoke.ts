import assert from 'node:assert/strict';
import { ObjectUnion } from '../js/pal/pal-global';
import world from '../services/world-service';
const bytes = new Uint8Array(ObjectUnion.size);
new DataView(bytes.buffer).setUint16(4, 123, true);
const initial = new ObjectUnion(bytes);
assert.equal(initial.poison.playerScript, 123); // cache a typed union view first
world.setObjectTable([initial]);
world.setObjectScriptValue(0, 2, 321);
const changed = (globalThis as any).GameData.object[0];
assert.equal(changed.data[2], 321, 'object data indexes are WORD indexes');
assert.equal(changed.poison.playerScript, 321, 'cached union view must agree with data write');
assert.deepEqual(Array.from(changed.uint8Array).slice(4, 6), [65, 1]);
world.setObjectTable([{ data: new Uint16Array([7, 8, 123, 10, 11, 12]) }]);
world.setObjectScriptValue(0, 2, 321);
assert.deepEqual(Array.from((globalThis as any).GameData.object[0].data), [7, 8, 321, 10, 11, 12]);
// 读档后的形态:物件表与各条目共用存档缓冲区(表上带 uint8Array,存档按它整表拷)。写要落进共用字节,条目不能被换
const shared = new Uint8Array(ObjectUnion.size * 2);
const rows: any = [0, 1].map((i) => new ObjectUnion(shared.subarray(i * ObjectUnion.size, (i + 1) * ObjectUnion.size)));
rows.uint8Array = shared;
world.setObjectTable(rows);
const held = (globalThis as any).GameData.object[1];
held.magic;                                                     // 先缓存一个视图
world.setObjectScriptValue(1, 3, 0x1234);
assert.equal((globalThis as any).GameData.object[1], held, 'the entry is written in place, not replaced');
assert.equal(new DataView(shared.buffer).getUint16(ObjectUnion.size + 6, true), 0x1234, 'the write reaches the shared save buffer');
assert.equal(held.magic.scriptOnUse, 0x1234, 'a cached union view is rebuilt from the bytes');
world.dispose();
console.log('object-script-word smoke: ok');
