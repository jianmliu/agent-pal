/**
 * PAL_X / PAL_Y 与 SDLPAL 一致取有符号 16 位(#define PAL_X(xy) (SHORT)((xy) & 0xFFFF))。
 * 曾写成无符号:敌人逃跑(0x0069)把敌人往左滑到 x + w <= 0 才停,x 一过 0 就绕成 65xxx,
 * 动画永不结束 —— 扬州客栈女飛賊那场剧情战卡死。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:pal-pos
 */
import assert from 'node:assert/strict';
import { PAL_X, PAL_Y, PAL_XY } from '../js/pal/pal-global';

for (const [x, y] of [[0, 0], [160, 100], [-1, 5], [-5, -7], [319, 199], [32767, -32768], [-32768, 32767]]) {
  const pos = PAL_XY(x, y);
  assert.equal(PAL_X(pos), x, `PAL_X(PAL_XY(${x}, ${y}))`);
  assert.equal(PAL_Y(pos), y, `PAL_Y(PAL_XY(${x}, ${y}))`);
}

// enemyEscape 的循环形状:每帧 x -= 5,直到 x + w <= 0 —— 必须在有限帧内结束
let pos = PAL_XY(70, 120);
const w = 48;
let frames = 0;
for (;;) {
  const x = PAL_X(pos) - 5;
  pos = PAL_XY(x, PAL_Y(pos));
  frames++;
  if (x + w <= 0) break;
  assert.ok(frames < 1000, 'enemy slide-out never leaves the screen');
}
assert.equal(PAL_Y(pos), 120);
console.log(`pal-pos smoke ok (slide-out ${frames} frames)`);
