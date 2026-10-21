import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import world from '../services/world-service';
import state from '../services/state-service';
import { statusSignals, updatePlayerStatusMatrix, mutatePlayerStatusMatrix, getPlayerStatusMatrixValue, mutatePoisonStatusMatrix, getPoisonStatusMatrixValue } from '../state/slices/status-matrices';

const initial = () => [[5, 1000], [9, 0]];
state.setGlobal('playerStatus', initial());
world.init();
assert.deepEqual(getPlayerStatusMatrixValue(), initial(), 'initial legacy data must be imported');

// This is the same write path as script-runner's removePlayerStatus.
mutatePlayerStatusMatrix((rows) => { (rows[0] as number[])[0] = 0; return rows; });
assert.equal((world.getPlayerStatus(0) as number[])[0], 0, 'world getter must not restore cleared status');
assert.equal((getPlayerStatusMatrixValue()[0] as number[])[0], 0);
assert.equal((state.getGlobal('playerStatus') as number[][])[0][0], 0, 'legacy consumers must see the cleared status too');

let emissions = 0;
const stop = statusSignals().player.subscribe(() => emissions++);
const beforeRead = emissions;
const snapshot = world.getPlayerStatusMatrix();
world.getPlayerStatus(0);
assert.equal(emissions, beforeRead, 'getters must not emit state changes');
(snapshot[0] as number[])[0] = 88;
assert.equal((getPlayerStatusMatrixValue()[0] as number[])[0], 0, 'returned snapshot must not alias authoritative state');
stop();

world.mutatePlayerStatusEntry(1, (row) => { row[0] = 3; return row; });
assert.deepEqual(getPlayerStatusMatrixValue(), [[0, 1000], [3, 0]], 'editing another role must retain the cleared status');
state.setGlobal('poisonStatus', []);
assert.deepEqual(getPlayerStatusMatrixValue(), [[0, 1000], [3, 0]], 'poison updates must not overwrite player status');

state.setGlobal('poisonStatus', [[{ poisonID: 7, poisonScript: 11 }]]);
mutatePoisonStatusMatrix((rows) => { (rows[0] as any)[0].poisonID = 0; return rows; });
world.mutatePlayerStatusEntry(1, (row) => { row[0] = 4; return row; });
assert.equal((getPoisonStatusMatrixValue()[0] as any)[0].poisonID, 0, 'player status mirroring must not reimport stale poison state');

const replacement = [[4, 1000], [2, 0]];
world.setPlayerStatusStruct(replacement);
assert.deepEqual(getPlayerStatusMatrixValue(), [[4, 1000], [2, 0]], 'explicit legacy replacement must update authoritative state');
replacement[0][0] = 6;
world.setPlayerStatusStruct(replacement);
assert.deepEqual(getPlayerStatusMatrixValue(), [[6, 1000], [2, 0]], 'explicit replacement of the same legacy reference must also publish');
world.resetPlayerStatusMatrix();
assert.deepEqual(getPlayerStatusMatrixValue(), [[0, 0], [0, 0]], 'reset must clear signal state, including permanent status');
assert.deepEqual(state.getGlobal('playerStatus'), [[0, 0], [0, 0]], 'reset must clear legacy state too');

// Compatibility: typed rows survive snapshot cloning and clearing.
world.setPlayerStatusStruct([{ uint8Array: new Uint8Array([3, 4]) }] as any);
world.resetPlayerStatusMatrix();
assert.deepEqual(Array.from((getPlayerStatusMatrixValue()[0] as any).uint8Array), [0, 0]);

world.dispose();
state.setGlobal('playerStatus', [[7, 0]]);
world.init();
assert.deepEqual(getPlayerStatusMatrixValue(), [[7, 0]], 'reinitialization imports the replacement before subscribing');
updatePlayerStatusMatrix([[0, 0]]);
assert.deepEqual(state.getGlobal('playerStatus'), [[0, 0]], 'signal mirroring must resume after reinitialization');
world.init(); // Already initialized: no duplicate subscriptions.
updatePlayerStatusMatrix([[2, 0]]);
assert.deepEqual(world.getPlayerStatusMatrix(), [[2, 0]]);
world.dispose();
console.log('player-status-source smoke: ok');
