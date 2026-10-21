/**
 * 经验结构(ALLEXPERIENCE)的读写一致性。不起引擎、不要资产。
 *
 * EXPERIENCE 的字段都是 WORD,pal-formats 的标量访问器:setter 把原值存进缓存、截断后的值写进字节,getter 读缓存。
 * 以前战斗结算把浮点数 / 超 65535 的值写进去,读到的与存档(字节)不一致;读档只拷字节,getter 还是上一局的值。
 * 守住:mutateExpState 之后、setExpStruct 之后,getter 与字节一致(以字节为准,同 SDLPAL 的 (WORD)dwExp)。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:exp-state
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import worldService from '../services/world-service';
import stateService from '../services/state-service';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };
const AllExperience = g.AllExperience;

const word = (entry: any, k: number) => new DataView(entry.uint8Array.buffer, entry.uint8Array.byteOffset, 8).getUint16(k * 2, true);
const agrees = (entry: any) => entry.exp === word(entry, 0) && entry.level === word(entry, 2) && entry.count === word(entry, 3);

worldService.setExpStruct(new AllExperience(new Uint8Array(AllExperience.size)));
const exp = () => stateService.getGlobal('exp') as any;

// ---- 写入:浮点 / 溢出 / 负数 → 读到的与字节一致 -------------------------------------------
worldService.mutateExpState((x: any) => { x.healthExp[1].exp = 215.83; x.healthExp[1].count = 70000; x.attackExp[1].exp = -1; return x; });
assert.equal(exp().healthExp[1].exp, 215, 'a float is truncated like (WORD)dwExp');
assert.equal(exp().healthExp[1].count, 70000 & 0xffff, 'an overflowing count wraps');
assert.equal(exp().attackExp[1].exp, 0xffff);
assert.ok(agrees(exp().healthExp[1]) && agrees(exp().attackExp[1]), 'getters agree with the saved bytes');

// ---- 第二次读档:只拷字节进现有结构体,getter 也要换成新值 ------------------------------------
const loaded = new AllExperience(new Uint8Array(AllExperience.size));
loaded.primaryExp[0].exp = 1234;
loaded.primaryExp[0].level = 9;
worldService.setExpStruct(loaded);
assert.equal(exp().primaryExp[0].exp, 1234, 'the loaded value is visible through the getter');
assert.equal(exp().primaryExp[0].level, 9);
assert.equal(exp().healthExp[1].exp, 0, 'the previous session value is gone');
assert.ok(agrees(exp().primaryExp[0]) && agrees(exp().healthExp[1]));

console.log('exp-state: ok');
