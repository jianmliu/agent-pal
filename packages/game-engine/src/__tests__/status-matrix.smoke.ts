/**
 * 状态 / 中毒矩阵的写口(docs/specs/agent-pal-m2.md §2.1,D0)。
 * 不起引擎、不要资产:真的 worldService + 真的 script-runner 实例,只调它的矩阵写方法。
 *
 * 守住:
 *  - 脚本设的状态写进真相源(Global.playerStatus),之后任何人读矩阵(战斗系统、agent 观察)都不会把它冲掉
 *  - 读矩阵不改状态:getPlayerStatusMatrix() 前后状态一致
 *  - 中毒写入同样落到真相源
 *
 * Run: pnpm --filter @onchainpal/game-engine test:status-matrix
 */
import assert from 'node:assert/strict';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { getPlayerStatusValue } from '../services/player-state-adapter';

// script-runner 会拉进 js/pal 模块,它们加载时要全局 log
const g = globalThis as any;
g.log ??= { trace() {}, debug() {}, info() {}, warn() {}, error() {}, log() {} };
const { default: scriptRunner } = await import('../services/script-runner');

const ROLES = 6, STATUSES = 16, POISONS = 16;
const sr = scriptRunner as any;

// 最小的真相源:与 game.clearPlayerStatus 一样是普通二维数组;中毒是 {poisonID, poisonScript} 对象
stateService.setGlobal('playerStatus', Array.from({ length: ROLES }, () => new Array(STATUSES).fill(0)));
stateService.setGlobal('poisonStatus', Array.from({ length: POISONS }, () => Array.from({ length: ROLES }, () => ({ poisonID: 0, poisonScript: 0 }))));
worldService.syncStatusMatrices();

const truth = (role: number, status: number) => (stateService.getGlobal('playerStatus') as number[][])[role][status];

// ---- 状态:脚本写 → 真相源有、读不冲掉 -------------------------------------------
sr.setPlayerStatus(2, 3, 5);
assert.equal(getPlayerStatusValue(2, 3), 5, 'readers see the script-set status');
assert.equal(truth(2, 3), 5, 'the script-set status reaches Global.playerStatus');
worldService.getPlayerStatusMatrix();                    // 战斗系统 / agent 观察都会这样读
assert.equal(getPlayerStatusValue(2, 3), 5, 'reading the matrix must not wipe a script-set status');

// 战斗系统的写口与脚本写口交替:两边的写都要留下
worldService.mutatePlayerStatusEntry(2, (row) => { row[4] = 7; return row; });
assert.equal(getPlayerStatusValue(2, 3), 5, 'a worldService write keeps the earlier script write');
assert.equal(getPlayerStatusValue(2, 4), 7);
sr.setPlayerStatus(2, 3, 0);
assert.equal(truth(2, 3), 0, 'clearing via the script path reaches Global too');
assert.equal(truth(2, 4), 7);

// ---- 中毒:脚本写 → 真相源有 -------------------------------------------------------
const poisonTruth = () => (stateService.getGlobal('poisonStatus') as any[][]);
sr.partyIndexOfRole = () => 1;                          // 不起队伍:角色固定在队伍下标 1
sr.poisonLevelOf = () => 0;
worldService.mutatePoisonStatus((m: any[][]) => { m[0][1].poisonID = 9; m[0][1].poisonScript = 100; return m; });
sr.curePoisonByKind(0, 9);
worldService.getPoisonStatusMatrix();
assert.equal(poisonTruth()[0][1].poisonID, 0, 'curing via the script path reaches Global.poisonStatus');

console.log('status-matrix: ok');
