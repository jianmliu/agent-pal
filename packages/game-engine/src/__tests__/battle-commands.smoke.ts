/**
 * 战斗指令组件(docs/specs/agent-pal-m5-command.md C1b)。不起引擎、不要资产。
 *
 * 守住:开战导入;writeCommitted 逐字段补丁、只写组件(不碰投影);backupPrevious 是副本;没变不记变更日志;
 * 组件与投影不一致能查出来;组件值可 JSON 往返。提交 / 状态改写 / repeat 的真实路径在 agent-pal 的
 * test:commit-command 与 golden --shadow(每个战斗帧核对组件 = 投影)里。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:battle-commands
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import battleService from '../services/battle-service';
import worldService from '../services/world-service';
import { BattleCommandsComponent } from '../ecs/components/battle-commands';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };
const act = (actionType: number, actionID: number, target: number, remainingTime = 0) => ({ actionType, actionID, target, remainingTime });
const state: any = {
  player: [{ action: act(0, 0, -1) }, { action: act(2, 0, 1), prevAction: act(3, 300, 0, 2) }, { action: null }],
  enemy: [], UI: {}
};
battleService.replaceState(state);
const w = worldService.getWorldWriter();
const live = (i: number) => (battleService.getState() as any).player[i];

// 第一次读(组件还没建):也是冻结的原件,不是可改的副本
assert.ok(Object.isFrozen(battleService.getCommands()) && Object.isFrozen(battleService.getCommands().committed), 'the first read already returns the stored original');
assert.throws(() => (battleService.getCommands().committed as any).push(null), TypeError);

// ---- 开战导入 -----------------------------------------------------------------------------
battleService.importCommitted();
assert.deepEqual(battleService.getCommands().committed, [act(0, 0, -1), act(2, 0, 1), null]);
assert.deepEqual(battleService.getCommands().previous, [null, act(3, 300, 0, 2), null]);
assert.equal(battleService.commandsProjectionMismatch(), null);
assert.ok(Object.isFrozen(battleService.getCommands()), 'the component value is the frozen original');

// ---- writeCommitted:只写组件,调用方再投影 ----------------------------------------------------
const next = battleService.writeCommitted(0, { actionType: 3, actionID: 301 });
assert.deepEqual(next, act(3, 301, -1), 'a patch keeps the other fields');
assert.deepEqual(battleService.getCommands().committed[0], act(3, 301, -1));
assert.deepEqual({ ...live(0).action }, act(0, 0, -1), 'the projection is not touched by the write');
assert.match(String(battleService.commandsProjectionMismatch()), /^committed\[0\]/, 'component ahead of the projection is detected');
Object.assign(live(0).action, next);                                  // 调用方的投影
assert.equal(battleService.commandsProjectionMismatch(), null);

const seq = w.lastSeq;
battleService.writeCommitted(0, { actionType: 3 });                    // 没变
assert.equal(w.lastSeq, seq, 'an unchanged write records nothing');

// 槽位原来没有动作对象:从零补出四个字段
assert.deepEqual(battleService.writeCommitted(2, { actionType: 3, actionID: 9, target: -1, remainingTime: 0 }), act(3, 9, -1));

// ---- backupPrevious ---------------------------------------------------------------------
const backup = battleService.backupPrevious(0)!;
assert.deepEqual(backup, act(3, 301, -1));
assert.deepEqual(battleService.getCommands().previous[0], act(3, 301, -1));
backup.target = 7;
assert.equal(battleService.getCommands().previous[0]!.target, -1, 'the returned backup is a detached copy');
battleService.writeCommitted(0, { target: 2 });
assert.equal(battleService.getCommands().previous[0]!.target, -1, 'later writes do not change the backup');
assert.match(String(battleService.commandsProjectionMismatch()), /committed\[0\]|previous\[0\]/);

// ---- setPlayerActionType:类型归一成数字,组件与投影同值;非数字不写 -----------------------------------
Object.assign(live(1).action, battleService.getCommands().committed[1]);
battleService.setPlayerActionType(1, '5' as any);
assert.equal(live(1).action.actionType, 5, 'a numeric string is stored as a number in the projection');
assert.equal(battleService.getCommands().committed[1]!.actionType, 5, '… and in the component');
battleService.setPlayerActionType(1, 'defend' as any);
assert.deepEqual([live(1).action.actionType, battleService.getCommands().committed[1]!.actionType], [5, 5], 'a non-numeric value changes neither store');
battleService.setPlayerActionType(1, (cur: any) => cur + 1);
assert.deepEqual([live(1).action.actionType, battleService.getCommands().committed[1]!.actionType], [6, 6]);

// ---- 纯数据 -------------------------------------------------------------------------------
const value = w.get(w.world(), BattleCommandsComponent)!;
assert.deepEqual(JSON.parse(JSON.stringify(value)), value, 'JSON round trip');
assert.throws(() => w.set(w.world(), BattleCommandsComponent, { ...value, committed: [{ actionType: NaN } as any] }), /BattleCommands/);

console.log('battle-commands: ok');
