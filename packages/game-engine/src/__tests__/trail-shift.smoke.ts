/**
 * 尾迹后移(docs/specs/agent-pal-m2.md D2b)。不起引擎、不要资产。
 *
 * SDLPAL 对 TRAIL 数组做 memmove:后移一格只是逐字段复制。以前 script-runner 的 partyWalkTo /
 * 乘事件对象 / 0x006E 把条目换成新的普通对象,条目就与 Global.trail 的字节脱钩,存档里的尾迹是旧的。
 * 守住:后移之后条目还是原来那几个结构体对象,字节里是后移后的值。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:trail-shift
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';

const g = globalThis as any;
g.log ??= { trace() {}, debug() {}, info() {}, warn() {}, error() {}, log() {} };
const { shiftTrailInPlace } = await import('../services/script-runner');

// 与 Global.trail 一样:5 个 TRAIL 结构体共用一块字节(每个 x / y / direction 三个 WORD)
const Trail = g.Trail;
const bytes = new Uint8Array(Trail.size * 5);
const trail: any[] = Array.from({ length: 5 }, (_, i) => new Trail(new Uint8Array(bytes.buffer, i * Trail.size, Trail.size)));
trail.forEach((t, i) => { t.x = 10 * i; t.y = 100 + i; t.direction = i % 4; });
const before = trail.slice();

shiftTrailInPlace(trail);
trail[0].x = 999;

assert.ok(trail.every((t, i) => t === before[i]), 'entries are still the same struct objects');
assert.notEqual(trail[0], trail[1], 'no aliasing between trail[0] and trail[1]');
assert.deepEqual(trail.map((t) => [t.x, t.y, t.direction]), [[999, 100, 0], [0, 100, 0], [10, 101, 1], [20, 102, 2], [30, 103, 3]]);
const words = new Uint16Array(bytes.buffer);
assert.deepEqual(Array.from(words.subarray(0, 6)), [999, 100, 0, 0, 100, 0], 'the shift and the later write both reach the bytes');

console.log('trail-shift: ok');
