/**
 * 背包 / 钱 / 背包光标组件(docs/specs/agent-pal-m2.md D1)。不起引擎、不要资产。
 *
 * 守住:
 *  - 写口(mutateInventory / setCash / adjustCash / setInventoryMenuIndex / compressInventory)只写组件,
 *    Global 与切片是投影,写完与组件逐字段一致
 *  - 草稿槽位的数值语义与 SDLPAL 结构体相同:同一回调里 USHORT 减到 0 以下读到的是回绕值
 *  - 旧路径(他处直接 setGlobal、整表灌入)导入回组件
 *  - 存档编码取自组件
 *
 * Run: pnpm --filter @onchainpal/game-engine test:inventory-component
 */
import assert from 'node:assert/strict';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { InventoryComponent } from '../ecs/components/inventory';
import { inventorySignals } from '../state/slices/inventory';

const g = globalThis as any;
g.Const ??= {};
g.Const.MAX_INVENTORY = 8;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };   // syncAll 的尾迹同步要用
const CAP = 8;

// 最小的旧真相源:与结构体同形的普通对象
stateService.setGlobal('inventory', Array.from({ length: CAP }, () => ({ item: 0, amount: 0, amountInUse: 0 })));
stateService.setGlobal('cash', 0);
stateService.setGlobal('curInvMenuItem', 0);
worldService.syncAll();

const w = worldService.getWorldWriter();
const comp = () => w.get(w.world(), InventoryComponent)!;
const legacy = () => (stateService.getGlobal('inventory') as any[]).map((s) => [s.item, s.amount, s.amountInUse]);
const fromComp = () => comp().slots.map((s) => [s.item, s.amount, s.amountInUse]);
const sliceItems = () => (inventorySignals().items.value as any[]).map((s) => [s.item, s.amount, s.amountInUse]);
const consistent = (what: string) => {
  assert.deepEqual(legacy(), fromComp(), `${what}: Global.inventory is a projection of the component`);
  assert.deepEqual(sliceItems().slice(0, CAP), fromComp(), `${what}: the slice is a projection too`);
};

// ---- 写入只经组件,投影一致 -------------------------------------------------------
worldService.mutateInventory((inv) => { inv[0].item = 100; inv[0].amount = 3; inv[1].item = 101; inv[1].amount = 1; return inv; });
consistent('mutate');
assert.deepEqual(comp().slots[0], { item: 100, amount: 3, amountInUse: 0 });

// ---- 结构体数值语义:同一回调里读到的是回绕后的值 --------------------------------------
let seen = -999;
worldService.mutateInventory((inv) => { inv[1].amount -= 2; seen = inv[1].amount; inv[1].amountInUse = 0x8000; return inv; });
assert.equal(seen, 65535, 'USHORT amount wraps inside the callback, as the struct did');
assert.equal(comp().slots[1].amountInUse, -32768, 'SHORT amountInUse wraps');
consistent('wrap');

// 回调整体返回新数组(短于容量)→ 补空槽
worldService.mutateInventory(() => [{ item: 5, amount: 2, amountInUse: 0 }] as any);
assert.equal(comp().slots.length, CAP);
assert.deepEqual(comp().slots[0], { item: 5, amount: 2, amountInUse: 0 });
assert.deepEqual(comp().slots[1], { item: 0, amount: 0, amountInUse: 0 });
consistent('replace');

// ---- 压缩:去掉 item 0 / amount 0,后面的往前挪 --------------------------------------
worldService.mutateInventory((inv) => {
  inv[0].item = 7; inv[0].amount = 0;
  inv[1].item = 8; inv[1].amount = 4;
  inv[3].item = 9; inv[3].amount = 1; inv[3].amountInUse = 1;
  return inv;
});
worldService.compressInventory();
assert.deepEqual(fromComp().slice(0, 3), [[8, 4, 0], [9, 1, 1], [0, 0, 0]]);
consistent('compress');
const seqBefore = w.lastSeq;
worldService.compressInventory();
assert.equal(w.lastSeq, seqBefore, 'compressing an already compact inventory writes nothing');

// ---- 钱 / 光标 ----------------------------------------------------------------------
worldService.setCash(500);
assert.equal(worldService.adjustCash(-120), 380);
assert.equal(comp().cash, 380);
assert.equal(worldService.getCash(), 380);
assert.equal(stateService.getGlobal('cash'), 380, 'Global.cash is a projection');
assert.equal(inventorySignals().cash.value, 380, 'the cash slice is a projection');
worldService.setInventoryMenuIndex(5.7);
assert.equal(worldService.getInventoryMenuIndex(), 5);
assert.equal(stateService.getGlobal('curInvMenuItem'), 5);

// 回调里嵌套写钱:两边的写都要留下
worldService.mutateInventory((inv) => { inv[2].item = 55; inv[2].amount = 1; worldService.adjustCash(7); return inv; });
assert.equal(comp().cash, 387, 'a cash write nested in mutateInventory is not overwritten');
assert.deepEqual(comp().slots[2], { item: 55, amount: 1, amountInUse: 0 });

// ---- 旧路径写 Global → 导入组件 -------------------------------------------------------
stateService.setGlobal('cash', 42);
assert.equal(worldService.getCash(), 42, 'a legacy setGlobal(cash) is imported into the component');
const replaced = Array.from({ length: CAP }, (_, i) => ({ item: i === 0 ? 300 : 0, amount: i === 0 ? 9 : 0, amountInUse: 0 }));
worldService.setInventoryStruct(replaced as any);
assert.deepEqual(comp().slots[0], { item: 300, amount: 9, amountInUse: 0 }, 'setInventoryStruct imports');

// ---- 存档编码取自组件 -------------------------------------------------------------------
const target = Array.from({ length: CAP }, () => ({ item: -1, amount: -1, amountInUse: -1 }));
worldService.encodeInventoryInto(target);
assert.deepEqual(target.map((s) => [s.item, s.amount, s.amountInUse]), fromComp());

console.log('inventory-component: ok');
