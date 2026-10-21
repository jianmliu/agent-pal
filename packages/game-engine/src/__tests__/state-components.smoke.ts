/**
 * 世界状态清单 / 快照 / 哈希 / 组件编码存档(docs/specs/agent-pal-m2.md §7 D5a)。不起引擎、不要资产。
 *
 * 守住:writer 里存的是冻结原件(peek 不拷贝、改不动);状态哈希不含实体 id、只随状态变;
 * encodeStateSaveParts 按 SDLPAL 布局编码(背包槽、事件对象 16 个 WORD)。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:state-components
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { InventoryComponent } from '../ecs/components/inventory';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };
const CAP = Number(g.Const?.MAX_INVENTORY) || 256;
const EventObject = g.EventObject;

stateService.setGlobal('inventory', Array.from({ length: CAP }, () => ({ item: 0, amount: 0, amountInUse: 0 })));
stateService.setGlobal('cash', 0);
worldService.syncAll();
const events = Array.from({ length: 4 }, () => new EventObject(new Uint8Array(EventObject.size)));
worldService.setEventObjectTable(events as any);
worldService.captureWorldTables();

const w = worldService.getWorldWriter();

// ---- 冻结原件 -----------------------------------------------------------------------------
worldService.mutateInventory((inv) => { inv[0].item = 100; inv[0].amount = 3; inv[0].amountInUse = -1; return inv; });
const inv = w.peek(w.world(), InventoryComponent)!;
assert.ok(Object.isFrozen(inv) && Object.isFrozen(inv.slots[0]), 'stored component values are deep-frozen');
assert.throws(() => { (inv.slots[0] as any).amount = 9; }, TypeError, 'peek hands out the original, which cannot be mutated');
assert.equal(w.get(w.world(), InventoryComponent)!.slots[0].amount, 3);
assert.ok(!Object.isFrozen(w.get(w.world(), InventoryComponent)), 'get still returns a mutable copy');

// ---- 状态哈希 -----------------------------------------------------------------------------
const h0 = worldService.stateHash();
const snap = worldService.getStateSnapshot();
assert.equal(snap.eventObjects.length, 4, 'event objects are keyed by index, not entity id');
worldService.captureWorldTables();
assert.equal(worldService.stateHash(), h0, 'an unchanged frame keeps the hash');
events[1].x = 77;
worldService.captureWorldTables();
const h1 = worldService.stateHash();
assert.notEqual(h1, h0, 'a state change changes the hash');
events[1].x = 0;
worldService.captureWorldTables();
assert.equal(worldService.stateHash(), h0, 'reverting the state restores the hash');

// ---- 组件 → 存档分区 ------------------------------------------------------------------------
worldService.mutateEventObject(2, (e: any) => { e.x = 640; e.state = -1; return e; });
const parts = worldService.encodeStateSaveParts({ inventory: CAP * 6, eventObject: 4 * 32 });
assert.deepEqual(Array.from(parts.inventory.subarray(0, 6)), [100, 0, 3, 0, 0xff, 0xff], 'INVENTORY: item / amount / amountInUse (SHORT -1)');
assert.deepEqual(Array.from(parts.eventObject.subarray(2 * 32 + 2, 2 * 32 + 4)), [640 & 0xff, 640 >> 8], 'EVENTOBJECT[2].x');
assert.deepEqual(Array.from(parts.eventObject.subarray(2 * 32 + 12, 2 * 32 + 14)), [0xff, 0xff], 'EVENTOBJECT[2].state = -1');
assert.equal(parts.party, undefined, 'only the parts that were asked for');
assert.deepEqual(Array.from(parts.eventObject.subarray(2 * 32, 3 * 32)), Array.from(events[2].uint8Array.subarray(0, 32)), 'same bytes as the live struct');

console.log('state-components: ok');
