/**
 * 状态 / 中毒矩阵组件(docs/specs/agent-pal-m2.md D2a)。不起引擎、不要资产。
 * 状态切片的旧语义另由 test:player-status-source(#63)与 test:status-matrix(D0)守住;这里补组件这一侧:
 *  - 写口只写组件;状态切片、Global.playerStatus、Global.poisonStatus 是投影,写完与组件一致
 *  - 中毒条目草稿按 WORD 截断(同 POISONSTATUS 结构体)
 *  - Global 整表灌入 / 直接 setGlobal 导入回组件
 *  - 存档编码取自组件
 *
 * Run: pnpm --filter @onchainpal/game-engine test:status-component
 */
import assert from 'node:assert/strict';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { StatusMatricesComponent } from '../ecs/components/status';
import { getPlayerStatusMatrixValue, getPoisonStatusMatrixValue } from '../state/slices/status-matrices';

(globalThis as any).Direction ??= { South: 0, West: 1, North: 2, East: 3 };   // 初始化的默认尾迹要用
const POISONS = 3, ROLES = 2;
stateService.setGlobal('playerStatus', [[0, 0], [0, 0]]);
stateService.setGlobal('poisonStatus', Array.from({ length: POISONS }, () => Array.from({ length: ROLES }, () => ({ poisonID: 0, poisonScript: 0 }))));
worldService.syncStatusMatrices();

const w = worldService.getWorldWriter();
const comp = () => w.get(w.world(), StatusMatricesComponent)!;
const poisonGlobal = () => (stateService.getGlobal('poisonStatus') as any[][]).map((r) => r.map((e) => [e.poisonID, e.poisonScript]));
const poisonComp = () => comp().poison.map((r) => r!.map((e) => [e!.poisonID, e!.poisonScript]));

// ---- 状态:写组件 → 切片与 Global 是投影 ---------------------------------------------
worldService.mutatePlayerStatus((m) => { m[1][0] = 7; return m; });
assert.deepEqual(comp().status, [[0, 0], [7, 0]]);
assert.deepEqual(getPlayerStatusMatrixValue(), [[0, 0], [7, 0]]);
assert.deepEqual(stateService.getGlobal('playerStatus'), [[0, 0], [7, 0]]);
// 旧矩阵的行是稀疏数组:没设过的状态是空洞(undefined),投影后仍是空洞而不是 0
worldService.mutatePlayerStatus((m) => { m[2] = []; m[2][3] = 5; return m; });
const sparse = (stateService.getGlobal('playerStatus') as any[])[2];
assert.equal(sparse.length, 4);
assert.ok(!(0 in sparse) && sparse[3] === 5, 'holes stay holes in the projection');
assert.ok(!(0 in (getPlayerStatusMatrixValue()[2] as any[])), 'and in the slice');

// ---- 中毒:草稿按 WORD 截断,投影到 Global 与切片 -------------------------------------
let seen = -1;
worldService.mutatePoisonStatus((m: any) => { m[0][1].poisonID = 9; m[2][0].poisonScript = -1; seen = m[2][0].poisonScript; return m; });
assert.equal(seen, 0xffff, 'poisonScript wraps like the WORD struct field');
assert.deepEqual(poisonComp(), [[[0, 0], [9, 0]], [[0, 0], [0, 0]], [[0, 0xffff], [0, 0]]]);
assert.deepEqual(poisonGlobal(), poisonComp(), 'Global.poisonStatus is a projection');
assert.equal((getPoisonStatusMatrixValue()[0] as any)[1].poisonID, 9, 'the poison slice follows Global');

worldService.resetPoisonStatusMatrix();
assert.deepEqual(poisonGlobal(), poisonComp());
assert.ok(poisonComp().every((r) => r.every(([id, sc]) => id === 0 && sc === 0)), 'reset clears');

// ---- 旧路径导入 ---------------------------------------------------------------------------
stateService.setGlobal('poisonStatus', [[{ poisonID: 4, poisonScript: 5 }]]);
assert.deepEqual(poisonComp(), [[[4, 5]]], 'a legacy setGlobal(poisonStatus) is imported');
worldService.setPlayerStatusStruct([[1, 2], [3, 4]]);
assert.deepEqual(comp().status, [[1, 2], [3, 4]], 'setPlayerStatusStruct is imported');

// ---- 存档编码取自组件 ---------------------------------------------------------------------
const target = [[{ poisonID: 99, poisonScript: 99 }, { poisonID: 99, poisonScript: 99 }]];
worldService.encodePoisonInto(target);
assert.deepEqual(target, [[{ poisonID: 4, poisonScript: 5 }, { poisonID: 0, poisonScript: 0 }]]);

console.log('status-component: ok');
