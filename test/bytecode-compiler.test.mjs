/**
 * bytecode-compiler.test.mjs — 字节码静态编译器与跨场景/孤岛拓扑规划器单元测试
 */
import assert from 'node:assert/strict';
import {
  blockToGrid,
  trigRadius,
  exitReachRadius,
  signed16,
  createBytecodeCompiler
} from '../src/bytecode-compiler.mjs';

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  process.stdout.write(`  ✓ ${name}\n`);
};

// Inverse helper for test fixture construction: grid (gx, gy) -> block (bx, by, h=0)
function gridToBlock(gx, gy) {
  // gx = bx + by, gy = by - bx + 64  =>  by = (gx + gy - 64)/2, bx = (gx - gy + 64)/2
  return [(gx - gy + 64) / 2, (gx + gy - 64) / 2, 0];
}

await t('基础坐标换算: blockToGrid / trigRadius / signed16', () => {
  const [bx, by, h] = gridToBlock(10, 64);
  assert.deepEqual(blockToGrid(bx, by, h), [10, 64]);
  assert.equal(trigRadius(1), 0);
  assert.equal(trigRadius(4), 0);
  assert.equal(trigRadius(5), 1);
  assert.equal(trigRadius(6), 2);
  assert.equal(exitReachRadius(1), 2);
  assert.equal(exitReachRadius(2), 2);
  assert.equal(exitReachRadius(3), 2);
  assert.equal(exitReachRadius(4), 0);
  assert.equal(exitReachRadius(5), 1);
  assert.equal(signed16(32), 32);
  assert.equal(signed16(65504), -32);
});

await t('compileTeleLinks & compileRelJumps: 解析 0070 双向浮板、0044 乘藤与 006E 相对位移踏板', () => {
  const scripts = [
    // Object 101: 0070 two-way moving platform between (2,64) and (8,64)
    { addr: 100, op: '0044', operands: gridToBlock(2, 64) },
    { addr: 101, op: '0070', operands: gridToBlock(8, 64) },
    { addr: 102, op: '0001', operands: [] },
    { addr: 103, op: '0044', operands: gridToBlock(8, 64) },
    { addr: 104, op: '0070', operands: gridToBlock(2, 64) },
    { addr: 105, op: '0000', operands: [] },

    // Object 102: 0044 vine ride from (4,64) to (12,64)
    { addr: 200, op: '0044', operands: gridToBlock(12, 64) },
    { addr: 201, op: '0000', operands: [] },

    // Object 103: 006E relative offset pad (dx=+64, dy=+32 => dgx = 64/32 + 32/16 = +4, dgy = 32/16 - 64/32 = 0)
    { addr: 300, op: '006E', operands: [64, 32, 0] },
    { addr: 301, op: '0000', operands: [] }
  ];

  const eventObjects = [
    { id: 101, scene: 1, gx: 2, gy: 64, triggerMode: 4, triggerScript: 100, state: 1 },
    { id: 102, scene: 1, gx: 4, gy: 64, triggerMode: 4, triggerScript: 200, state: 1 },
    { id: 103, scene: 1, gx: 6, gy: 64, triggerMode: 5, triggerScript: 300, state: 1 }
  ];

  const compiler = createBytecodeCompiler({ scenes: [{ id: 1, mapNum: 1 }], eventObjects, scripts });
  const links = compiler.compileTeleLinks(1);
  assert.equal(links.length, 4);
  assert.deepEqual(links[0], { id: 101, from: [8, 64], to: [8, 64] });
  assert.deepEqual(links[1], { id: 101, from: [2, 64], to: [2, 64] });
  assert.deepEqual(links[2], { id: 102, from: [4, 64], to: [12, 64], ride: true });
  assert.deepEqual(links[3], { id: 103, from: [6, 64], to: [10, 64], relative: true });

  const rels = compiler.compileRelJumps(1);
  assert.equal(rels.length, 1);
  assert.deepEqual(rels[0], { id: 103, at: [6, 64], R: 1, rel: [4, 0] });
});

await t('planHybridPath (path2): 步行 + 传送阵跨越墙壁隔离带 + 规避非目标场景出口', async () => {
  // 地图: 左右两个孤岛，中间被 '#' 墙完全隔断 (x=0..3 为左岛，x=5..8 为右岛)
  const rows = [
    '#########',
    '....#....',
    '....#....',
    '#########'
  ];
  // 传送阵 id=50 在 (3,1) -> 传送到右岛 (5,1)
  // 场景出口 id=99 在 (1,2) -> 切换到场景 2，寻路去右岛时必须自动避开 (1,2)
  const scripts = [
    { addr: 500, op: '0070', operands: gridToBlock(5, 1) },
    { addr: 501, op: '0000', operands: [] },
    { addr: 900, op: '0059', operands: [2] },
    { addr: 901, op: '0000', operands: [] }
  ];
  const eventObjects = [
    { id: 50, scene: 1, gx: 3, gy: 1, triggerMode: 4, triggerScript: 500, state: 1 },
    { id: 99, scene: 1, gx: 1, gy: 2, triggerMode: 4, triggerScript: 900, state: 1 }
  ];
  const compiler = createBytecodeCompiler({
    scenes: [{ id: 1, mapNum: 1 }],
    eventObjects,
    scripts,
    loadMapRows: () => rows
  });

  // 禁用传送时无法跨越墙壁
  const noTele = await compiler.planHybridPath({
    scene: 1,
    start: [0, 1],
    goal: [7, 1],
    useTeleports: false
  });
  assert.equal(noTele, null);

  // 启用字节码传送边时自动算出: 走到 (3,1) -> 触发 T50 飞到 (5,1) -> 走到 (7,1)
  const hybrid = await compiler.planHybridPath({
    scene: 1,
    start: [0, 1],
    goal: [7, 1],
    useTeleports: true
  });
  assert.ok(hybrid);
  assert.equal(hybrid.end, '7,1');
  assert.deepEqual(hybrid.steps, ['right', 'right', 'right', 'T50', 'right', 'right']);
});

await t('连通分量与跨场景多孤岛拓扑规划: connectedComponents / buildRegionGraph / planMultiSceneRoute', async () => {
  // 场景 1: 单一区域 '.......'
  // 场景 2: 被墙分成左岛 (x=0..2) 与右岛 (x=4..6)，宝物在右岛 (6,1)
  // 场景 1 有两个出口去场景 2:
  //   - 出口 10 落点在场景 2 左岛 (1,1) (死胡同)
  //   - 出口 11 落点在场景 2 右岛 (5,1) (可达宝物 (6,1))
  const map1 = ['#######', '.......', '#######'];
  const map2 = ['#######', '...#...', '#######'];

  const scripts = [
    // Exit 10 -> Scene 2 @ (1,1)
    { addr: 10, op: '0046', operands: gridToBlock(1, 1) },
    { addr: 11, op: '0059', operands: [2] },
    { addr: 12, op: '0000', operands: [] },
    // Exit 11 -> Scene 2 @ (5,1)
    { addr: 20, op: '0046', operands: gridToBlock(5, 1) },
    { addr: 21, op: '0059', operands: [2] },
    { addr: 22, op: '0000', operands: [] }
  ];
  const eventObjects = [
    { id: 10, scene: 1, gx: 1, gy: 1, triggerMode: 4, triggerScript: 10, state: 1 },
    { id: 11, scene: 1, gx: 5, gy: 1, triggerMode: 4, triggerScript: 20, state: 1 }
  ];
  const compiler = createBytecodeCompiler({
    scenes: [
      { id: 1, mapNum: 1 },
      { id: 2, mapNum: 2 }
    ],
    eventObjects,
    scripts,
    loadMapRows: (m) => (m === 1 ? map1 : map2)
  });

  const c2 = await compiler.connectedComponents(2);
  assert.equal(c2.count, 2, '场景 2 应被切分为 2 个独立步行孤岛');
  assert.notEqual(compiler.compAt(c2, 1, 1, 0), compiler.compAt(c2, 6, 1, 0));

  const regEdges = await compiler.buildRegionGraph([1, 2]);
  assert.equal(regEdges.length, 2);
  const regRoute = compiler.planRegionRoute('1:0', `2:${compiler.compAt(c2, 6, 1, 0)}`, regEdges);
  assert.equal(regRoute.length, 1);
  assert.equal(regRoute[0].id, 11, '孤岛换乘图应精准选中通往右岛的出口 11');

  const route = await compiler.planMultiSceneRoute({
    fromScene: 1,
    startPos: [3, 1],
    toScene: 2,
    targetPos: [6, 1],
    targetRadius: 0
  });
  assert.ok(route);
  assert.equal(route.length, 1);
  assert.equal(route[0].exit, 11, 'planMultiSceneRoute 应排除死胡同出口 10，选择出口 11');
});

await t('机关因果反查与对象分类: isFoe / isDoor / isLoot / isSwitch / whoMutatesObject / traceCallers', () => {
  const scripts = [
    // Enemy script (0007)
    { addr: 10, op: '0007', operands: [55, 0] },
    { addr: 11, op: '0000', operands: [] },
    // Loot script (001F + FFFF)
    { addr: 20, op: 'FFFF', operands: [], text: '發現止血草' },
    { addr: 21, op: '001F', operands: [101, 1] },
    { addr: 22, op: '0000', operands: [] },
    // Switch script (0049 mutating door object 88)
    { addr: 30, op: '0049', operands: [88, 0] },
    { addr: 31, op: '0024', operands: [88, 0] },
    { addr: 32, op: '0000', operands: [] }
  ];
  const eventObjects = [
    { id: 1, scene: 1, gx: 1, gy: 1, triggerMode: 5, triggerScript: 10, state: 2 },
    { id: 2, scene: 1, gx: 2, gy: 1, triggerMode: 1, triggerScript: 20, state: 1 },
    { id: 3, scene: 1, gx: 3, gy: 1, triggerMode: 4, triggerScript: 30, state: 1 },
    { id: 88, scene: 1, gx: 4, gy: 1, triggerMode: 0, triggerScript: 20, state: 2 }
  ];
  const compiler = createBytecodeCompiler({ scenes: [{ id: 1, mapNum: 1 }], eventObjects, scripts });

  assert.equal(compiler.isFoe(1), true);
  assert.equal(compiler.isLoot(2), true);
  assert.equal(compiler.isSwitch(3), true);
  assert.equal(compiler.isDoor(88), true);

  const mutators = compiler.whoMutatesObject(88);
  assert.equal(mutators.length, 2);
  const trace = compiler.traceCallers(31);
  assert.ok(trace[0].callers.includes('trig obj 3@1'));
});

await t('GPT-6.1-Sol 增强 1: 嵌在 # 墙壁上的按空格隐藏出口 (triggerMode 1..3, search: true)', async () => {
  // 场景 1 顶部墙壁 (3,0) 上嵌有一个绳索/暗门出口 id=200 (triggerMode=1)，通往场景 2 (1,1)
  // 玩家站在 (3,1) 即可通过 exitReachRadius(1)=2 触及该墙壁上的搜索型出口
  const map1 = ['#######', '.......', '#######'];
  const map2 = ['#######', '.......', '#######'];
  const scripts = [
    { addr: 40, op: '0046', operands: gridToBlock(1, 1) },
    { addr: 41, op: '0059', operands: [2] },
    { addr: 42, op: '0000', operands: [] }
  ];
  const eventObjects = [
    { id: 200, scene: 1, gx: 3, gy: 0, triggerMode: 1, triggerScript: 40, state: 2 }
  ];
  const compiler = createBytecodeCompiler({
    scenes: [
      { id: 1, mapNum: 1 },
      { id: 2, mapNum: 2 }
    ],
    eventObjects,
    scripts,
    loadMapRows: (m) => (m === 1 ? map1 : map2)
  });

  const exits = compiler.sceneExits(1);
  assert.equal(exits.length, 1);
  assert.equal(exits[0].search, true);

  const reachable = await compiler.reachableExits(1, [1, 1]);
  assert.deepEqual(reachable, [200]);

  const route = await compiler.planMultiSceneRoute({
    fromScene: 1,
    startPos: [1, 1],
    toScene: 2,
    targetPos: [5, 1]
  });
  assert.ok(route);
  assert.equal(route.length, 1);
  assert.equal(route[0].exit, 200);
  assert.equal(route[0].search, true);
});

await t('GPT-6.1-Sol 增强 2: 同场景 0059+0046 传送阵、007B 瞬移与跨岛+跨场景统一拓扑图', async () => {
  // 场景 1 被切分为左岛 (x=0..2) 与右岛 (x=4..6)
  // 左岛 (2,1) 有一个同场景 0059+0046 传送阵 id=301，将玩家传送到同场景右岛 (4,1)
  // 右岛 (6,1) 有跨场景出口 id=302 通往场景 2 (1,1)
  const map1 = ['#######', '...#...', '#######'];
  const map2 = ['#######', '.......', '#######'];
  const scripts = [
    // Object 301: Same-scene 0059(1) + 0046(4,1) teleporter (like Nüwa Ruins Scenes 221/223/225/226)
    { addr: 100, op: '0059', operands: [1] },
    { addr: 101, op: '0046', operands: gridToBlock(4, 1) },
    { addr: 102, op: '0000', operands: [] },
    // Object 302: Cross-scene exit to Scene 2 (1,1)
    { addr: 200, op: '0046', operands: gridToBlock(1, 1) },
    { addr: 201, op: '0059', operands: [2] },
    { addr: 202, op: '0000', operands: [] },
    // Object 303: 007B fast-walk warp in Scene 2 from (2,1) to (5,1)
    { addr: 300, op: '007B', operands: gridToBlock(5, 1) },
    { addr: 301, op: '0000', operands: [] }
  ];
  const eventObjects = [
    { id: 301, scene: 1, gx: 2, gy: 1, triggerMode: 4, triggerScript: 100, state: 1 },
    { id: 302, scene: 1, gx: 6, gy: 1, triggerMode: 4, triggerScript: 200, state: 1 },
    { id: 303, scene: 2, gx: 2, gy: 1, triggerMode: 4, triggerScript: 300, state: 1 }
  ];
  const compiler = createBytecodeCompiler({
    scenes: [
      { id: 1, mapNum: 1 },
      { id: 2, mapNum: 2 }
    ],
    eventObjects,
    scripts,
    loadMapRows: (m) => (m === 1 ? map1 : map2)
  });

  // 1. sceneExits 默认不含同场景，开启 includeSameScene 后包含 id=301
  assert.equal(compiler.sceneExits(1).length, 1);
  const allExits = compiler.sceneExits(1, { includeSameScene: true });
  assert.equal(allExits.length, 2);
  assert.equal(allExits.find((e) => e.id === 301).sameScene, true);

  // 2. compileTeleLinks 自动收录同场景 0059+0046 传送阵与 007B 瞬移
  const links1 = compiler.compileTeleLinks(1);
  assert.equal(links1.length, 1);
  assert.deepEqual(links1[0], { id: 301, from: [2, 1], to: [4, 1], sameSceneExit: true });

  const links2 = compiler.compileTeleLinks(2);
  assert.equal(links2.length, 1);
  assert.deepEqual(links2[0], { id: 303, from: [2, 1], to: [5, 1] });

  // 3. 统一 buildRegionGraph 同时包含场景内跨岛边 (1:0 -> 1:1) 与跨场景边 (1:1 -> 2:0)
  const edges = await compiler.buildRegionGraph([1, 2]);
  assert.equal(edges.length, 2);
  const regRoute = compiler.planRegionRoute('1:0', '2:0', edges);
  assert.equal(regRoute.length, 2);
  assert.equal(regRoute[0].intraScene, true);
  assert.equal(regRoute[0].id, 301);
  assert.equal(regRoute[1].id, 302);
});

await t('GPT-6.1-Sol 增强 3: 运行时动态碰撞自学习 (recordBlockedTile / recordBlockedStep)', async () => {
  // 两条走廊连接 (0,1) 与 (4,1)：上路 y=1 较短，下路 y=2 绕行
  const rows = [
    '#####',
    '.....',
    '.....',
    '#####'
  ];
  const compiler = createBytecodeCompiler({
    scenes: [{ id: 1, mapNum: 1 }],
    eventObjects: [],
    scripts: [],
    loadMapRows: () => rows
  });

  const direct = await compiler.planHybridPath({
    scene: 1,
    start: [0, 1],
    goal: [4, 1]
  });
  assert.equal(direct.steps.length, 4);

  // 模拟在 (1,1) 往右走 ('right' => +1, 0) 发生运行时卡死，自动标记 (2,1) 为动态障碍
  const blockedCoord = compiler.recordBlockedStep(1, 1, 1, 'right');
  assert.equal(blockedCoord, '2,1');
  assert.ok(compiler.getRuntimeBlocks(1).has('2,1'));

  // 再次规划时自动绕开 (2,1)，改走下路 y=2
  const rerouted = await compiler.planHybridPath({
    scene: 1,
    start: [0, 1],
    goal: [4, 1]
  });
  assert.ok(rerouted);
  assert.ok(rerouted.steps.length > 4);
  assert.equal(rerouted.steps[0], 'down');

  compiler.clearRuntimeBlocks(1);
  assert.equal(compiler.getRuntimeBlocks(1).size, 0);
});

process.stdout.write(`\nBYTECODE COMPILER TESTS PASSED ✅ (${n})\n`);
