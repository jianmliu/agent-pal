/**
 * 随机数状态存取(docs/specs/agent-pal-m5.md B2)。
 *
 * 守住:getState → 接着抽 N 个 → setState 回去 → 再抽 N 个,两段序列完全一样,draws 也接得上;
 * 状态经 JSON 往返照样能恢复;非法状态报错且不改现状。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:random-state
 */
import assert from 'node:assert/strict';
import randomService, { random, setRandomSeed, getRandomState, setRandomState } from '../services/random';

setRandomSeed(42);
for (let i = 0; i < 100; i++) random();
const saved = JSON.parse(JSON.stringify(getRandomState()));
assert.deepEqual(saved, { seeded: true, state: saved.state, draws: 100 });

const first = Array.from({ length: 50 }, () => random());
assert.equal(getRandomState().draws, 150);

setRandomState(saved);
assert.deepEqual(getRandomState(), saved, 'state restored, draw count included');
const second = Array.from({ length: 50 }, () => random());
assert.deepEqual(second, first, 'the sequence continues exactly as it did the first time');
assert.equal(getRandomState().draws, 150);

// setSeed 不能代替:它把 draws 归零
setRandomSeed(saved.state);
assert.equal(getRandomState().draws, 0);

const before = getRandomState();
for (const bad of [null, {}, { state: -1 }, { state: 1.5 }, { state: 2 ** 32 }, { state: 1, draws: -1 }]) {
  assert.throws(() => setRandomState(bad as any), /setRandomState/);
}
assert.deepEqual(getRandomState(), before, 'a rejected state changes nothing');
assert.equal(typeof randomService.setState, 'function');

console.log('random-state: ok');
