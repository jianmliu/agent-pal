#!/usr/bin/env node
/**
 * bytecode-compiler-demo.mjs — 字节码静态编译器与跨场景/连通分量拓扑规划器实机演示
 *
 * 运行方式：
 *   node apps/agent-pal/src/bytecode-compiler-demo.mjs [--data <pal-data-dir>]
 *
 * 演示内容（基于《仙剑奇侠传》真实数据表，融合 Claude Opus 5.5 + GPT-6.1-Sol 双模型范式）：
 *   1. 神木林 (Scene 192)：静态编译 54 条树藤跳跃边 (0044)，混合寻路飞跃悬崖孤岛
 *   2. 锁妖塔铁索浮板层 (Scene 185)：9 个孤岛 + 66 条双向浮板边 (0070/007A)，跨深渊寻路 & 109 步缩短至 3 步
 *   3. 试炼窟 (Scene 203 & Scenes 217–219)：006E 相对偏移塌陷踏板解析 + 15 个孤岛的跨楼层换乘拓扑规划
 *   4. 锁妖塔铜门机关层 (Scene 156)：静态反查“哪个地板机关控制哪扇铜门” (0024/0049)
 *   5. 女娲遗迹全图解锁 (Scenes 216–226)：嵌墙绳索/暗门 (search:true, tm=1..3) + 同场景 0059 传送阵 + 73 边统一拓扑图
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBytecodeCompilerFromDir } from './bytecode-compiler.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFlagIdx = process.argv.indexOf('--data');
const defaultDataDir = path.resolve(here, '..', 'pal-data');
const dataDir = dataFlagIdx >= 0 && process.argv[dataFlagIdx + 1]
  ? path.resolve(process.argv[dataFlagIdx + 1])
  : defaultDataDir;

if (!fs.existsSync(path.join(dataDir, 'manifest.json'))) {
  const { bootEngine } = await import('./engine.mjs');
  const { dumpData } = await import('./data-dump.mjs');
  const e = await bootEngine();
  await dumpData(e, dataDir, { maps: 'all' });
}

const bc = createBytecodeCompilerFromDir(dataDir);

console.log('================================================================================');
console.log(' 演示 1：神木林 (Scene 192) — 静态编译树藤跳跃边 (0044) 并跨悬崖混合寻路');
console.log('================================================================================');
const c192 = await bc.connectedComponents(192);
const vines192 = bc.compileTeleLinks(192);
console.log(`• 神木林被悬崖切分为 ${c192.count} 个独立步行孤岛，静态编译出 ${vines192.length} 条树藤跳跃边`);
console.log('• 前 3 条树藤边示例:', vines192.slice(0, 3));

const vineNoTele = await bc.planHybridPath({
  scene: 192,
  start: [111, 138],
  goal: [101, 125],
  useTeleports: false
});
const vineWithTele = await bc.planHybridPath({
  scene: 192,
  start: [111, 138],
  goal: [101, 125],
  useTeleports: true
});
console.log('• 跨树冠悬崖寻路 (111,138) -> (101,125):');
console.log('  - 普通网格寻路 (useTeleports: false):', vineNoTele);
console.log('  - 字节码混合寻路 (useTeleports: true):', vineWithTele);

console.log('\n================================================================================');
console.log(' 演示 2：锁妖塔浮板层 (Scene 185) — 9 个孤岛 + 66 条双向移动浮板边 (0070/007A)');
console.log('================================================================================');
const c185 = await bc.connectedComponents(185);
const platforms185 = bc.compileTeleLinks(185);
console.log(`• 锁妖塔 Scene 185 含 ${c185.count} 个独立孤岛，静态编译出 ${platforms185.length} 条双向浮板有向边`);
console.log('• 第一组往返浮板边:', platforms185.slice(0, 2));

const gapNoTele = await bc.planHybridPath({
  scene: 185,
  start: [66, 105],
  goal: [64, 99],
  useTeleports: false
});
const gapWithTele = await bc.planHybridPath({
  scene: 185,
  start: [66, 105],
  goal: [64, 99],
  useTeleports: true
});
console.log('• 跨深渊孤岛 (66,105) -> (64,99):');
console.log('  - 普通网格寻路 (useTeleports: false):', gapNoTele);
console.log('  - 字节码混合寻路 (useTeleports: true):', gapWithTele);

const detourPath = await bc.planHybridPath({
  scene: 185,
  start: [108, 122],
  goal: [92, 105],
  useTeleports: false
});
const shortcutPath = await bc.planHybridPath({
  scene: 185,
  start: [108, 122],
  goal: [92, 105],
  useTeleports: true
});
console.log('• 同层浮板抄近道 (108,122) -> (92,105):');
console.log(`  - 普通步行绕圈: 共 ${detourPath.steps.length} 步`);
console.log(`  - 踩 T3203 浮板捷径: 共 ${shortcutPath.steps.length} 步 ->`, shortcutPath.steps);

console.log('\n================================================================================');
console.log(' 演示 3：试炼窟 (Scene 203 & Scenes 217–219) — 相对偏移踏板与跨楼层孤岛换乘图');
console.log('================================================================================');
const rel203 = bc.compileRelJumps(203);
console.log(`• 试炼窟滑坡层 (Scene 203) 静态提取出 ${rel203.length} 个 006E 相对位移踏板，前 3 个:`);
console.log(' ', rel203.slice(0, 3));

for (const sc of [217, 218, 219]) {
  const c = await bc.connectedComponents(sc);
  console.log(`• 试炼窟深层 Scene ${sc}: 切分为 ${c.count} 个独立步行孤岛`);
}
const caveEdges = await bc.buildRegionGraph([217, 218, 219]);
const caveRoute = bc.planRegionRoute('217:1', '219:1', caveEdges);
console.log(`• 试炼窟 Scenes 217–219 共构建 ${caveEdges.length} 条跨层孤岛换乘边`);
console.log('• 从顶层孤岛 217:1 到深层孤岛 219:1 的 4 段自动换乘方案:');
for (const [i, step] of caveRoute.entries()) {
  console.log(`  [${i + 1}] ${step.from} -> ${step.to} (通过出口对象 id=${step.id} @(${step.gx},${step.gy}), triggerMode=${step.tm})`);
}

console.log('\n================================================================================');
console.log(' 演示 4：锁妖塔铜门层 (Scene 156) — 机关与铜门的字节码因果反查');
console.log('================================================================================');
for (const id of [2621, 2628, 2635]) {
  const e = bc.eoOf(id);
  const ops = bc.scriptOps(e.triggerScript, 20).filter((s) => ['0024', '0049'].includes(s.op));
  console.log(
    `• 机关板 obj=${id} @(${e.gx},${e.gy}) 触发后修改对象:`,
    ops.map((o) => `${o.op}(targetObj=${o.operands[0]}, val=${o.operands[1]})`)
  );
}
console.log('• 反向查询“谁控制了铜门 obj=2619”:', bc.whoMutatesObject(2619));
console.log('  调用源追溯:', bc.traceCallers(bc.whoMutatesObject(2619)[0].split(' ')[0] | 0, 1)[0].callers);

console.log('\n================================================================================');
console.log(' 演示 5：女娲遗迹全图解锁 (Scenes 216–226) — 嵌墙暗门 (search:true) + 同场景 0059 传送阵');
console.log('================================================================================');
const nuwaScenes = [216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226];
const nuwaEdges = await bc.buildRegionGraph(nuwaScenes);
const searchEdges = nuwaEdges.filter((e) => e.search);
const intraEdges = nuwaEdges.filter((e) => e.intraScene);
console.log(
  `• 试炼窟+女娲遗迹 (Scenes 216–226) 统一拓扑图共 ${nuwaEdges.length} 条有向换乘边:` +
  ` 跨场景触碰=${nuwaEdges.length - searchEdges.length - intraEdges.length},` +
  ` 嵌墙绳索/暗门(search:true)=${searchEdges.length},` +
  ` 场景内跨孤岛传送(intraScene)=${intraEdges.length}`
);
console.log(
  '• 嵌在 # 墙壁上的按空格暗门/绳索出口 (前 5 条):',
  searchEdges.slice(0, 5).map((e) => `#${e.id}(${e.from}->${e.to} @${e.gx},${e.gy} tm=${e.tm})`)
);
console.log(
  `• 五神石迷宫同场景 0059+0046 传送阵: Scene 225 提取 ${bc.compileTeleLinks(225).length} 条,` +
  ` Scene 226 提取 ${bc.compileTeleLinks(226).length} 条`
);
const deepRoute = bc.planRegionRoute('216:1', '226:1', nuwaEdges);
console.log(`• 从试炼窟入口 (216:1) 直通女娲遗迹最深处神石密室 (226:1) 的 ${deepRoute.length} 段全自动换乘路径:`);
for (const [i, step] of deepRoute.entries()) {
  const tag = step.search ? ' [需按空格触发暗门/绳索]' : step.intraScene ? ' [同场景 0059 传送阵]' : '';
  console.log(`  [${String(i + 1).padStart(2, ' ')}] ${step.from} -> ${step.to} (obj=#${step.id} @(${step.gx},${step.gy}), tm=${step.tm})${tag}`);
}

process.exit(0);
