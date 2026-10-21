/**
 * 队伍 / 尾迹组件(docs/specs/agent-pal-m2.md D2c)。不起引擎、不要资产。
 *
 * 守住:
 *  - 写口(mutateParty / mutatePartyMember / mutateTrail / setMaxPartyMemberIndex / setFollowerCount)只写组件,
 *    Global.party / trail 等是投影,写完与组件逐字段一致;Global 里的条目对象不被替换
 *  - 草稿按 PARTY / TRAIL 结构宽度截断(SHORT x / y、WORD 其余)
 *  - mutatePartyMember 的返回值只回传、不写入(同旧写口)
 *  - 旧路径(整表灌入、直接 setGlobal)导入回组件
 *
 * Run: pnpm --filter @onchainpal/game-engine test:party-component
 */
import assert from 'node:assert/strict';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { PartyComponent } from '../ecs/components/party';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };
const blankParty = () => Array.from({ length: 5 }, (_, i) => ({ playerRole: i, x: 0, y: 0, frame: 0, imageOffset: 0 }));
const blankTrail = () => Array.from({ length: 5 }, () => ({ x: 0, y: 0, direction: 0 }));
worldService.setPartyStruct(blankParty() as any);
worldService.setTrailStruct(blankTrail());

const w = worldService.getWorldWriter();
const comp = () => w.get(w.world(), PartyComponent)!;
const pick = (rows: any[], keys: string[]) => rows.map((r) => (r ? keys.map((k) => r[k]) : r));
const MK = ['playerRole', 'x', 'y', 'frame', 'imageOffset'], TK = ['x', 'y', 'direction'];
const consistent = (what: string) => {
  assert.deepEqual(pick(stateService.getGlobal('party') as any[], MK), pick(comp().members, MK), `${what}: Global.party is a projection`);
  assert.deepEqual(pick(stateService.getGlobal('trail') as any[], TK), pick(comp().trail, TK), `${what}: Global.trail is a projection`);
};

// ---- 写口 → 组件 → 投影;Global 条目对象不换 ----------------------------------------------
const before = (stateService.getGlobal('party') as any[]).slice();
worldService.mutateParty((p) => { p[0].x = 100; p[0].y = -5; p[1].playerRole = 4; return p; });
consistent('mutateParty');
assert.ok((stateService.getGlobal('party') as any[]).every((m, i) => m === before[i]), 'party entries are updated in place');

let seen = 0;
worldService.mutateParty((p) => { p[2].x = 40000; seen = p[2].x; p[2].frame = -1; return p; });
assert.equal(seen, 40000 - 65536, 'SHORT x wraps inside the callback');
assert.equal(comp().members[2]!.frame, 0xffff, 'WORD frame wraps');
consistent('wrap');

const returned = worldService.mutatePartyMember(3, (m) => { m.frame = 7; return { playerRole: 99 } as any; });
assert.deepEqual(returned, { playerRole: 99 }, 'the returned object is handed back');
assert.equal(comp().members[3]!.playerRole, 3, 'but not written');
assert.equal(comp().members[3]!.frame, 7);
consistent('mutatePartyMember');

worldService.mutateTrail((t) => { t[0].x = 12; t[0].direction = 2; return t; });
consistent('mutateTrail');
assert.deepEqual(comp().trail[0], { x: 12, y: 0, direction: 2 });

// 回调里嵌套写同一组件的别的字段(0x0046:mutateParty 里调 mutateTrail):两边的写都要留下
worldService.mutateParty((p) => { p[0].x = 5; worldService.mutateTrail((t) => { t[1].x = 33; return t; }); return p; });
assert.equal(comp().members[0]!.x, 5);
assert.equal(comp().trail[1]!.x, 33, 'a trail write nested in mutateParty is not overwritten');
consistent('nested');

// ---- 上限 / 跟随者 ------------------------------------------------------------------------
assert.equal(worldService.setMaxPartyMemberIndex(2), 2);
assert.equal(comp().maxIndex, 2);
assert.equal(worldService.getMaxPartyMemberIndex(), 2);
worldService.setFollowerCount(1);
assert.equal(comp().followers, 1);
assert.equal(worldService.getFollowerCount(), 1);

// ---- 旧路径导入 ---------------------------------------------------------------------------
stateService.setGlobal('numFollower', 0);
assert.equal(comp().followers, 0, 'a legacy setGlobal(numFollower) is imported');
const replaced = blankParty(); replaced[0].x = 77;
worldService.setPartyStruct(replaced as any);
assert.equal(comp().members[0]!.x, 77, 'setPartyStruct imports');

console.log('party-component: ok');
