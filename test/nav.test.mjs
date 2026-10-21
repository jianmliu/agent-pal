/** nav 模块规划逻辑的单元测试(modules/nav/planner.mjs)。用 ASCII 小地图当 data dump,不需要游戏资产。 */
import assert from 'node:assert/strict';
import { createPlanner, DIRS } from '../modules/nav/planner.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; process.stdout.write(`  ✓ ${name}\n`); };

/** rows: 字符串数组(第 0 行 = gy 0);objects: [{ id, gx, gy, kind, triggerMode, blocking }] */
function world(rows, player, objects = []) {
  return createPlanner({
    cell: (x, y) => rows[y]?.[x] ?? ' ',
    objects: () => objects,
    player: () => player
  });
}
/** 按方向序列从起点走,返回终点(并断言每一步都踩在 '.' 或允许的格上由调用方保证)。 */
const follow = (p, dirs) => dirs.reduce((c, d) => ({ gx: c.gx + DIRS[d][0], gy: c.gy + DIRS[d][1] }), { gx: p.gx, gy: p.gy });
const trigger = (id, gx, gy, triggerMode = 5) => ({ id, gx, gy, kind: 'touch-trigger', triggerMode, blocking: false });
const npc = (id, gx, gy, blocking = true) => ({ id, gx, gy, kind: 'npc', triggerMode: 1, blocking });

t('绕墙:BFS 走最短路,不穿墙', () => {
  const rows = [
    '.......',
    '.#####.',
    '.......'
  ];
  const p = { gx: 3, gy: 0, facing: 'down' };
  const { dirs, target } = world(rows, p).planWalk(3, 2);
  assert.deepEqual(target, { gx: 3, gy: 2 });
  assert.equal(dirs.length, 8);                                  // 绕到两端再回来:3 + 2 + 3
  assert.deepEqual(follow(p, dirs), { gx: 3, gy: 2 });
});

t('非目标的触碰触发器范围要绕开;目标就在范围里则可进', () => {
  // 上下是墙的走廊(地图外是虚空,而门附近 +2 的虚空可走 —— 不封住就会从地图外绕过去)
  const rows = ['#########', '.........', '.........', '.........', '#########'];
  const p = { gx: 0, gy: 2, facing: 'right' };
  const door = trigger(9, 4, 2, 5);                              // 范围 = Chebyshev ≤ 1:(3..5, 1..3) 整段走廊被挡
  assert.equal(world(rows, p, [door]).planWalk(8, 2).dirs, null, '整条走廊被门的范围截断');
  const into = world(rows, p, [door]).planWalk(4, 2);
  assert.deepEqual(follow(p, into.dirs), { gx: 4, gy: 2 }, '目标就是那扇门:可以走进去');
});

t('虚空:离门 +2 以内可走,其余不可走', () => {
  const rows = ['....   ', '....   ', '....   '];
  const p = { gx: 0, gy: 1, facing: 'right' };
  assert.equal(world(rows, p).planWalk(6, 1).dirs, null, '没有门:虚空走不过去');
  const door = trigger(9, 6, 1, 4);                              // 范围 0,门附近 +2 的虚空可走
  const r = world(rows, p, [door]).planWalk(6, 1);
  assert.deepEqual(follow(p, r.dirs), { gx: 6, gy: 1 });
});

t('目标站不上去(门洞在墙上):退到最近可站格 —— 门口那格在门的范围里也要选(回归)', () => {
  // 门 (2,3) 范围 1;目标 (3,3) 是墙。最近可站格 (2,3)/(3,2) 都在门的范围里,MVP 照样会走上去触发
  const rows = [
    '.....',
    '.....',
    '.....',
    '##.##'
  ];
  const p = { gx: 2, gy: 0, facing: 'down' };
  const door = trigger(9, 2, 3, 5);
  const r = world(rows, p, [door]).planWalk(3, 3);
  assert.ok(r.dirs, 'should find the doorway');
  const end = follow(p, r.dirs);
  assert.ok(Math.abs(end.gx - 3) + Math.abs(end.gy - 3) === 1, `ended next to the target, got (${end.gx},${end.gy})`);
});

t('实心 NPC 堵住唯一通道:先当墙(无路),再忽略它规划', () => {
  const rows = ['#####', '.....', '#####'];
  const p = { gx: 0, gy: 1, facing: 'right' };
  const r = world(rows, p, [npc(5, 2, 1)]).planWalk(4, 1);
  assert.deepEqual(follow(p, r.dirs), { gx: 4, gy: 1 }, '退一步:当它会走开');
});

t('extraBlocked:执行时撞上的格下次规划绕开', () => {
  const rows = ['.....', '.....', '.....'];
  const p = { gx: 0, gy: 1, facing: 'right' };
  const plain = world(rows, p).planWalk(4, 1);
  assert.deepEqual(plain.dirs, ['right', 'right', 'right', 'right']);
  const detour = world(rows, p).planWalk(4, 1, { extraBlocked: new Set(['2,1']) });
  assert.ok(!detour.dirs.every((d) => d === 'right'));
  assert.deepEqual(follow(p, detour.dirs), { gx: 4, gy: 1 });
});

t('选边:按站位离主角的距离排,墙 / 实心格不当站位', () => {
  const rows = ['.....', '.#...', '.....', '.....'];
  const o = npc(3, 2, 1);
  const sides = world(rows, { gx: 2, gy: 3, facing: 'up' }, [o]).approachSides(o);
  assert.equal(sides[0].gx === 2 && sides[0].gy === 2, true, '最近的站位是正下方 (2,2)');
  assert.ok(!sides.some((s) => s.gx === 1 && s.gy === 1), '(1,1) 是墙,不当站位');
});

t('转身:实心目标朝它走一步;调查点退一格再走回来;已面朝不动', () => {
  const rows = ['.....', '.....', '.....', '.....'];             // 站位 (2,2) 身后 (2,3) 要在图内(图外是虚空)
  const solid = npc(3, 2, 1, true);
  const spot = { id: 4, gx: 2, gy: 1, kind: 'search-spot', triggerMode: 1, blocking: false };
  const c = { dir: 'up', gx: 2, gy: 2 };
  assert.deepEqual(world(rows, { gx: 2, gy: 2, facing: 'left' }, [solid]).turnMoves(c, solid), ['up']);
  assert.deepEqual(world(rows, { gx: 2, gy: 2, facing: 'left' }, [spot]).turnMoves(c, spot), ['down', 'up']);
  assert.deepEqual(world(rows, { gx: 2, gy: 2, facing: 'up' }, [spot]).turnMoves(c, spot), []);
  const walled = ['.....', '.....', '.....', '#####'];
  const c2 = { dir: 'up', gx: 2, gy: 2 };
  assert.equal(world(walled, { gx: 2, gy: 2, facing: 'left' }, [spot]).turnMoves(c2, spot), null, '身后是墙:退不了');
});

t('兜底 BFS:对实心目标用「撞上去转身」,对调查点让最后一步朝它走进站位', () => {
  const rows = ['.....', '.....', '.....'];
  const solid = npc(3, 2, 1, true);
  const sidesOf = (o) => Object.keys(DIRS).map((dir) => ({ dir, gx: o.gx - DIRS[dir][0], gy: o.gy - DIRS[dir][1] }));
  const a = world(rows, { gx: 2, gy: 2, facing: 'left' }, [solid]).planFacing(sidesOf(solid), solid);
  assert.deepEqual(a.actions, [{ dir: 'up', turn: true }], '站在正下方,朝上撞一下就转过去了');
  const spot = { id: 4, gx: 2, gy: 0, kind: 'search-spot', triggerMode: 1, blocking: false };
  const b = world(rows, { gx: 2, gy: 2, facing: 'left' }, [spot]).planFacing(sidesOf(spot), spot);
  assert.equal(b.actions.at(-1).turn, false);
  assert.equal(b.actions.at(-1).dir, b.side.dir, '最后一步的方向 = 面朝目标的方向');
  assert.ok(!b.actions.some((x) => x.turn), '调查点不实心,不能靠撞');
});

t('已经站在别的触发范围里:那个范围不当墙,能走出来', () => {
  const rows = ['#########', '.........', '#########'];
  const p = { gx: 3, gy: 1, facing: 'right' };
  const zone = trigger(9, 4, 1, 5);                              // 范围 1:主角 (3,1) 就在里面
  const r = world(rows, p, [zone]).planWalk(8, 1);
  assert.deepEqual(follow(p, r.dirs), { gx: 8, gy: 1 });
});

t('隐形墙(无精灵的 scenery,实心)在「忽略物体」退路里仍是墙', () => {
  const rows = ['#####', '.....', '#####'];
  const p = { gx: 0, gy: 1, facing: 'right' };
  const wall = { id: 7, gx: 2, gy: 1, kind: 'scenery', triggerMode: 0, blocking: true };
  assert.equal(world(rows, p, [wall]).planWalk(4, 1).dirs, null, '隐形墙不会走开,不能穿');
  const end = world(rows, p, [wall]).planWalk(2, 1);
  assert.deepEqual(end.target, { gx: 1, gy: 1 }, '目标就是隐形墙:停在它跟前');
});

t('紧挨着的站位被隐形墙占了:triggerMode 2 的 NPC 隔一格搜(书中仙,回归)', () => {
  // 书中仙 (3,1) 三面是墙,唯一的入口格 (2,1) 是隐形墙;站 (1,1) 朝右搜索能够着
  const rows = ['#######', '...####', '#######'];
  const wall = { id: 7, gx: 2, gy: 1, kind: 'scenery', triggerMode: 0, blocking: true };
  const sage = { id: 8, gx: 3, gy: 1, kind: 'npc', triggerMode: 2, blocking: true };
  const p = { gx: 0, gy: 1, facing: 'left' };
  const pl = world(rows, p, [wall, sage]);
  const sides = pl.approachSides(sage);
  assert.ok(!sides.some((c) => c.k === 1), '紧挨着的四格都站不上');
  assert.deepEqual([sides[0].gx, sides[0].gy, sides[0].dir, sides[0].k], [1, 1, 'right', 2], '最先试隔一格的 (1,1),朝右');
  assert.deepEqual(pl.turnMoves({ ...sides[0] }, sage), ['right'], '面前是隐形墙:朝它走一步就转过去');
  const one = { ...sage, triggerMode: 1 };
  assert.equal(world(rows, p, [wall, one]).approachSides(one).length, 0, 'triggerMode 1 只够得着紧挨的一格');
});

t('inTriggerZone', () => {
  const pl = world(['...'], { gx: 0, gy: 0, facing: 'down' }, [trigger(1, 5, 5, 6)]);
  assert.equal(pl.inTriggerZone(7, 7), true);
  assert.equal(pl.inTriggerZone(8, 5), false);
});

process.stdout.write(`\nNAV TESTS PASSED ✅ (${n})\n`);
