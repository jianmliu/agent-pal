/**
 * 战斗快照(docs/specs/agent-pal-m5.md B1)。不起引擎、不要资产。
 *
 * 守住:只取可序列化的字段(精灵 / 画面 / 场景缓冲不进);字节结构体记 WORD;类型化数组记普通数组;
 * 结构体拷贝的访问器缓存 `_x_value` 记成公开名;纯读(不改状态);同一状态哈希稳定、状态变了哈希变。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:battle-snapshot
 */
import assert from 'node:assert/strict';
import { battleSnapshot, battleStateHash } from '../services/battle-snapshot';

class Sprite { frames = [1, 2, 3]; draw() { return 0; } }
class BattleAction { actionType = 2; actionID = 0; target = 1; remainingTime = 0; }

const poison = { uint8Array: Uint8Array.from([0x34, 0x12, 0x02, 0x00]) };
const state: any = {
  maxEnemyIndex: 0, phase: 1, battleResult: 1000, flee: false, curAction: 0, expGained: 9, cashGained: 7,
  sceneBuf: new Uint8Array(64000), background: { pixels: new Uint8Array(10) }, effectSprite: new Sprite(),
  player: [{ timeMeter: 18.5, pos: 11534536, state: 1, action: new BattleAction(), sprite: new Sprite(), defending: false }],
  enemy: [{ objectID: 419, e: { _health_value: 350, _level_value: 8 }, status: [0, 0, 1], poisons: [poison], sprite: new Sprite(), state: 0 }],
  actionQueue: [{ isEnemy: true, dexterity: 40, index: 0 }],
  UI: { state: 1, menuState: 0, curPlayerIndex: 0, autoAttack: false, showNum: [{ x: 1 }], msg: 'x' }
};
const before = JSON.stringify(Object.keys(state));

const snap: any = battleSnapshot(state);
assert.equal(snap.version, 1);
assert.ok(!('sceneBuf' in snap) && !('background' in snap) && !('effectSprite' in snap), 'resource objects are not part of the snapshot');
assert.ok(!('sprite' in snap.player[0]) && !('sprite' in snap.enemy[0]), 'fighter sprites are not part of the snapshot');
assert.deepEqual(snap.player[0].action, { actionID: 0, actionType: 2, remainingTime: 0, target: 1 }, 'a data object (BattleAction) is kept');
assert.deepEqual(snap.enemy[0].e, { health: 350, level: 8 }, 'struct-copy cache fields use public names');
assert.deepEqual(snap.enemy[0].poisons, [{ words: [0x1234, 2] }], 'byte structs are recorded as WORDs');
assert.deepEqual(snap.actionQueue, [{ isEnemy: true, dexterity: 40, index: 0 }]);
assert.deepEqual(snap.UI, { state: 1, menuState: 0, curPlayerIndex: 0, autoAttack: false }, 'only UI scalars');
assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, 'JSON round trip');
assert.equal(JSON.stringify(Object.keys(state)), before, 'read-only');

const h = battleStateHash(state);
assert.equal(battleStateHash(state), h, 'stable hash');
state.player[0].timeMeter = 19;
assert.notEqual(battleStateHash(state), h, 'a state change changes the hash');
state.player[0].sprite = new Sprite();
state.player[0].timeMeter = 18.5;
assert.equal(battleStateHash(state), h, 'sprites do not affect the hash');
assert.equal(battleSnapshot(null), null);

console.log('battle-snapshot: ok');
