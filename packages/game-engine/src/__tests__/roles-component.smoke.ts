/**
 * 角色数值 / 经验 / 装备加成组件(docs/specs/agent-pal-m2.md D3,写穿)。不起引擎、不要资产。
 *
 * 守住:每个写口结束时组件 = 活结构体的字节(逐字);内容没变不记变更日志;
 * 回调里嵌套的写入不丢;D5d 起回调拿的是组件现做的草稿,活结构体是原地投影(身份与字段数组别名不变)。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:roles-component
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { PlayerRolesComponent, ExperienceComponent, EquipmentEffectComponent, wordsOf, roleWord } from '../ecs/components/roles';
import { PLAYER_ROLE_FIELDS } from '../services/player-role-fields';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };
const ROLES = g.Const.MAX_PLAYER_ROLES;
const field = (name: string) => PLAYER_ROLE_FIELDS.findIndex(([n]: any) => n === name);
const w = worldService.getWorldWriter();
const comp = (def: any) => w.get(w.world(), def) as any;
const liveRoles = () => (stateService.getGameData('playerRoles') as any);

// ---- 角色数值 ---------------------------------------------------------------------------
worldService.setPlayerRoles(new g.PlayerRoles(new Uint8Array(g.PlayerRoles.size)));
worldService.setPlayerHP(2, 321);
assert.equal(roleWord(comp(PlayerRolesComponent).words, field('HP'), 2, ROLES), 321, 'setPlayerHP reaches the component');
assert.deepEqual(comp(PlayerRolesComponent).words, wordsOf(liveRoles()), 'component = live struct bytes');

// 嵌套:回调里 _setPlayerRoleArrayValue 经 getPlayerRoles() 写活结构体
worldService.mutatePlayerRoles((roles: any) => {
  roles.attackStrength[1] = 40;
  worldService._setPlayerRoleArrayValue('defense', 1, 55);
  return roles;
});
const words = comp(PlayerRolesComponent).words;
assert.equal(roleWord(words, field('attackStrength'), 1, ROLES), 40);
assert.equal(roleWord(words, field('defense'), 1, ROLES), 55, 'a nested write through the live struct is kept');

worldService.setPlayerRoleWord(field('magicStrength'), 0, 70000);   // WORD 截断
assert.equal(roleWord(comp(PlayerRolesComponent).words, field('magicStrength'), 0, ROLES), 70000 & 0xffff);

// ---- D5d 倒置:回调拿的是草稿,不是活结构体;活结构体是原地投影 -------------------------------
const liveBefore = liveRoles();
const hpAlias = liveBefore.HP;                                         // 战斗 Stats 组件持有这种别名
let sawDraft = false;
worldService.mutatePlayerRoles((roles: any) => {
  sawDraft = roles !== liveBefore;
  roles.HP[3] = 99;
  assert.equal(liveBefore.HP[3], 0, 'the live struct is untouched until the write commits');
  return roles;
});
assert.ok(sawDraft, 'mutatePlayerRoles hands the callback a draft (inversion is active, not the legacy path)');
assert.equal(liveRoles(), liveBefore, 'the live struct keeps its identity');
assert.equal(hpAlias[3], 99, 'field-array aliases see the projected value');
assert.equal(roleWord(comp(PlayerRolesComponent).words, field('HP'), 3, ROLES), 99);

const seq = w.lastSeq;
worldService.setPlayerHP(2, 321);                                     // 值没变
assert.equal(w.lastSeq, seq, 'an unchanged write records nothing');

// ---- 经验 ---------------------------------------------------------------------------------
worldService.setExpStruct(new g.AllExperience(new Uint8Array(g.AllExperience.size)));
worldService.mutateExpState((x: any) => { x.primaryExp[3].exp = 1234; x.healthExp[3].count = 5; return x; });
assert.deepEqual(comp(ExperienceComponent).words, wordsOf(stateService.getGlobal('exp')), 'exp component = live bytes');
assert.ok(comp(ExperienceComponent).words.includes(1234));

// ---- 装备加成 -----------------------------------------------------------------------------
worldService.setEquipmentEffectWord(3, field('attackStrength'), 0, 9);
const tables = comp(EquipmentEffectComponent).tables;
assert.equal(tables.length, g.Const.MAX_PLAYER_EQUIPMENTS + 1);
assert.equal(roleWord(tables[3], field('attackStrength'), 0, ROLES), 9);
worldService.resetEquipmentEffects();
assert.ok(comp(EquipmentEffectComponent).tables.every((t: number[]) => t.every((x) => x === 0)), 'reset reaches the component');

console.log('roles-component: ok');
