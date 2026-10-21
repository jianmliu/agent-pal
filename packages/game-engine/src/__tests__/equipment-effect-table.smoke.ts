/**
 * 装备加成表(gpGlobals->rgEquipmentEffect)。不起引擎、不要资产。
 *
 * GlobalVars 是无缓冲构造的,`equipmentEffect` 字段从没真的建出来:装备脚本(0x0017)的写入与读档后
 * PAL_UpdateEquipments 的重建全落空,穿装备不加任何属性(其它测试是手动装上这张表才绿的)。
 * 守住:不预先安装,world-service 自己建出 MAX_PLAYER_EQUIPMENTS + 1 张清零的 PLAYERROLES 表;
 * 写进去的加成读得回来,重置清零。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:equipment-effect-table
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { PLAYER_ROLE_FIELDS } from '../services/player-role-fields';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };

const before = stateService.getGlobal('equipmentEffect');
assert.ok(!Array.isArray(before), 'precondition: nothing installs the table up front (the production state)');

const table = worldService.getEquipmentEffects() as any[];
assert.ok(Array.isArray(table), 'the table is created on first use');
assert.equal(table.length, g.Const.MAX_PLAYER_EQUIPMENTS + 1, 'one table per body part, plus Extra');
assert.ok(table.every((t) => t && t.uint8Array instanceof Uint8Array && t.uint8Array.every((b: number) => b === 0)), 'zeroed PLAYERROLES structs');

const ATK = PLAYER_ROLE_FIELDS.findIndex(([name]: any) => name === 'attackStrength');
assert.ok(ATK >= 0);
worldService.setEquipmentEffectWord(3, ATK, 0, 7);            // 武器部位给 0 号角色攻击 +7(0x0017 的写法)
assert.equal((worldService.getEquipmentEffect(3) as any).attackStrength[0], 7, 'an equip script write is kept');
assert.equal((stateService.getGlobal('equipmentEffect') as any[])[3].attackStrength[0], 7);

worldService.resetEquipmentEffects();
assert.equal((worldService.getEquipmentEffect(3) as any).attackStrength[0], 0, 'reset clears it (PAL_UpdateEquipments starts from zero)');

// 清除某名角色在一个部位上的全部加成(0x0017 / 换装前先清):只清这名角色、只清这个部位;别的角色、别的部位不动。
// 也守住耗时:原先逐字段整表捕获 + 比对 + 拷贝,清一次 0.5–0.7 秒,战斗前后连着清几次,实时模式下画面冻 3 秒。
const DEF = PLAYER_ROLE_FIELDS.findIndex(([name]: any) => name === 'defense');
assert.ok(DEF >= 0 && DEF !== ATK);
const fill = () => {
  worldService.setEquipmentEffectWord(3, ATK, 0, 7);
  worldService.setEquipmentEffectWord(3, DEF, 0, 5);
  worldService.setEquipmentEffectWord(3, ATK, 1, 9);            // 另一名角色,同一部位
  worldService.setEquipmentEffectWord(2, ATK, 0, 4);            // 同一名角色,另一个部位
};
fill();
worldService.clearEquipmentEffect(3, 0);
const part3 = worldService.getEquipmentEffect(3) as any;
assert.equal(part3.attackStrength[0], 0, 'cleared for that role');
assert.equal(part3.defense[0], 0, 'every field of that role is cleared');
assert.equal(part3.attackStrength[1], 9, 'other roles on the same part are untouched');
assert.equal((worldService.getEquipmentEffect(2) as any).attackStrength[0], 4, 'other parts are untouched');
assert.equal((stateService.getGlobal('equipmentEffect') as any[])[3].attackStrength[0], 0, 'the live table sees it too');
assert.ok((worldService.getEquipmentEffect(3) as any).uint8Array.some((b: number) => b !== 0), 'role 1 bytes remain');
worldService.clearEquipmentEffect(3, 0);                         // 已经是 0:再清一次也没事
assert.equal((worldService.getEquipmentEffect(3) as any).attackStrength[1], 9);

// 数整表捕获的次数而不是掐表(CI 机器快慢不一):清一次只该有固定的几次,不随字段数增长
const ws = worldService as any;
const origCapture = ws._captureEquipmentEffects;
let captures = 0;
ws._captureEquipmentEffects = function (...args: any[]) { captures++; return origCapture.apply(this, args); };
fill(); captures = 0;
worldService.clearEquipmentEffect(3, 0);
ws._captureEquipmentEffects = origCapture;
assert.ok(captures <= 4, `clearEquipmentEffect captured the whole table ${captures} times — it must not do so once per field`);

console.log(`equipment-effect-table: ok (clear = ${captures} table captures)`);
