/**
 * 战斗事件日志(docs/specs/agent-pal-m5.md B3)。不起引擎、不要资产。
 *
 * 守住:开战 / 每帧 / 结束的事件顺序;血量变化逐次记(复活后又倒下不被压掉);敌人离场、新出现(召唤);
 * 轮到谁只在变化时发一次、离开选指令后再回来会重发;战斗外的帧不记;since(seq) 只给新的。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:battle-events
 */
import assert from 'node:assert/strict';
import { BattleEventLog, type BattleView } from '../services/battle-events';

const view = (over: Partial<BattleView> = {}): BattleView => ({
  isBoss: false,
  enemies: [{ index: 0, objectID: 419, hp: 350 }, { index: 1, objectID: 419, hp: 350 }],
  party: [{ role: 0, hp: 100, mp: 50, level: 5 }, { role: 2, hp: 80, mp: 40, level: 5 }],
  cash: 1000, promptMember: null, expGained: 0, cashGained: 0, ...over
});
const types = (evs: any[]) => evs.map((e) => e.type + (e.side ? ':' + e.side : ''));

const log = new BattleEventLog();
log.frame(view());                                            // 战斗外:不记
assert.equal(log.lastSeq, 0);

log.start(view());
log.frame(view({ promptMember: 0 }));
log.frame(view({ promptMember: 0 }));                          // 没变:不重发
log.frame(view({ promptMember: 1 }));
let seq = log.lastSeq;
assert.deepEqual(types(log.since(0)), ['start', 'prompt', 'prompt']);

// 一回合:敌 0 掉血,队员 0 被打倒、复活、又倒下;敌 1 离场;位置 2 出现召唤物
log.frame(view({ enemies: [{ index: 0, objectID: 419, hp: 200 }, { index: 1, objectID: 419, hp: 350 }], party: [{ role: 0, hp: 0, mp: 50, level: 5 }, { role: 2, hp: 80, mp: 40, level: 5 }] }));
log.frame(view({ enemies: [{ index: 0, objectID: 419, hp: 200 }, { index: 1, objectID: 0, hp: 350 }], party: [{ role: 0, hp: 36, mp: 50, level: 5 }, { role: 2, hp: 80, mp: 40, level: 5 }] }));
log.frame(view({ enemies: [{ index: 0, objectID: 419, hp: 200 }, { index: 1, objectID: 0, hp: 350 }, { index: 2, objectID: 500, hp: 90 }], party: [{ role: 0, hp: 0, mp: 50, level: 5 }, { role: 2, hp: 80, mp: 40, level: 5 }], promptMember: 1 }));
const round = log.since(seq);
assert.deepEqual(types(round), ['hp:enemy', 'hp:party', 'gone', 'hp:party', 'hp:enemy', 'hp:party', 'prompt']);
assert.deepEqual(round.filter((e: any) => e.side === 'party').map((e: any) => [e.from, e.to]), [[100, 0], [0, 36], [36, 0]], 'revived then knocked out again is all there');
assert.deepEqual([(round[4] as any).index, (round[4] as any).from, (round[4] as any).to], [2, 0, 90], 'a summoned enemy appears from 0');
assert.equal((round[2] as any).killed, false, 'an enemy that leaves with HP left ran away');
assert.equal(round[round.length - 1].type, 'prompt', 'back to the same member after acting: prompted again');

seq = log.lastSeq;
// 同一帧里被打空并清掉:先补血量变化,再记离场(killed)
log.end(3, view({ enemies: [{ index: 0, objectID: 0, hp: -40 }, { index: 1, objectID: 0, hp: 350 }, { index: 2, objectID: 0, hp: 0 }], party: [{ role: 0, hp: 0, mp: 50, level: 6 }, { role: 2, hp: 99, mp: 40, level: 5 }], cash: 1021, expGained: 27, cashGained: 21 }));
const end = log.since(seq);
assert.deepEqual(types(end), ['hp:enemy', 'gone', 'hp:enemy', 'gone', 'hp:party', 'end']);
assert.deepEqual(end.filter((e: any) => e.type === 'gone').map((e: any) => e.killed), [true, true]);
const last: any = end[end.length - 1];
assert.deepEqual([last.result, last.expGained, last.cash, last.party[0].level], [3, 27, 1021, 6]);
assert.equal(log.inBattle, false);

log.frame(view({ promptMember: 0 }));                          // 结束后:不记
assert.equal(log.lastSeq, last.seq);
assert.deepEqual(log.since(log.lastSeq), []);

// 战斗实例编号:同一场的事件同号,下一场加一;上一场的提示不带到这一场
assert.ok(log.since(0).every((e: any) => e.battle === 1), 'every event of the first battle carries battle 1');
log.start(view());
log.frame(view({ promptMember: 0 }));
const second = log.since(last.seq);
assert.deepEqual(second.map((e: any) => [e.type, e.battle]), [['start', 2], ['prompt', 2]], 'the next battle is 2, and prompts again from scratch');
assert.equal(log.battle, 2);

const owned = new BattleEventLog();
owned.start(view());
const completed = view({ enemies: [{ index: 0, objectID: 0, hp: 0 }, { index: 1, objectID: 419, hp: 350 }], promptMember: 0, promptRevision: 1 });
const promptSeq = owned.ownedPrompt(0, 0, 1, completed);
assert.deepEqual(types(owned.since(0)), ['start', 'hp:enemy', 'gone', 'prompt'], 'completed native changes precede owned publication');
assert.equal(owned.ownedPrompt(0, 0, 1, completed), null, 'same owned identity is deduplicated');
owned.frame(completed);
assert.equal(owned.lastSeq, promptSeq, 'later frame does not duplicate HP/gone/prompt');
owned.ownedPrompt(0, 0, 2, completed);
assert.equal(owned.since(promptSeq!).length, 1, 'same-member fresh revision publishes once');
owned.end(3, completed);
assert.equal(owned.since(0).at(-1)?.type, 'end');

console.log('battle-events: ok');
