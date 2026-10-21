/**
 * prompt — 基准的统一提示词(spec §7.1:同一份系统提示,按档位裁剪)。内置循环与外部 agent 共用。
 */
export const PROMPT_VERSION = 3;   // 3:B / C 档加 cast(地图上施法)

const TIER_HINTS = {
  A: '你只能看画面(screenshot)和按键(press / wait)。方向键在旋转网格上移动一格;回车 / 空格确认,Esc 取消 / 开菜单。',
  B: '先读 observe 的输出:模式(control 可走动 / dialog 对白 / menu 菜单 / battle 战斗 / busy 过场)、位置、队伍、新出现的文字、附近物体(NPC、可调查点、出口)。对白用 advance 一次推完;和 NPC 说话用 interact(id);出口一般是 touch-trigger,用 walk_to / step 走过去;菜单用 choose。战后回血可以用 cast 在地图上施回复术(省药),也可以用 use_item 吃药。',
};
// C = B 的全部说明 + 查资料(只写「同 B」的话模型根本看不到 B 的说明)
TIER_HINTS.C = `${TIER_HINTS.B}\n另外可以用 guide 查攻略 / 剧本,用 atlas 看本场景的标注全图。`;
TIER_HINTS.P = '你处于 Pure 编程档(Tier P):没有内置寻路(walk_to)或高层互动工具(interact / map),只有底层 L0 协议原语(observe / step / search / advance / choose / battle / use_item / press / wait / save / load / list_saves)以及内联 JavaScript 沙盒工具 `run_code`。在 `run_code` 中:1) `pal.world` 保存由 SMSG_* 消息构建的实时世界状态(scene, map, mode, player, gx, gy, facing, objectList, members, items, cash, dialog, menu, battle);2) 可调用 `await pal.step(dir, n)`、`await pal.interact()`、`await pal.advance()`、`await pal.choose(i)`、`await pal.battle(type, extra)` 或 `await pal.send({ op: "CMSG_..." })` 推进游戏;3) `global` 对象跨 `run_code` 调用持久保留,请把自写的 BFS/A* 寻路函数、已探明的障碍物、地图连通记忆与战斗策略保存在 `global` 上复用;4) 可通过 `await pal.readData("scenes.json")` / `"objects.json"` / `"script.json"` 按需查阅静态数据表。旋转网格坐标:up = gy-1, down = gy+1, left = gx-1, right = gx+1。';

export function systemPrompt(tier) {
  return [
    '你在通过工具亲自玩经典 RPG《仙剑奇侠传》(1995 DOS 版)。这是一项基准测试:在尽量少的工具调用内完成指定任务。',
    TIER_HINTS[tier],
    '每次工具调用都会返回新的观察。读对白弄清楚当前该做什么(谁让你去哪、找谁、拿什么)。卡住时换思路:跟其他 NPC 说话、调查可调查点、换个出口;不要在同一处反复撞。',
    '任务是否完成由裁判判定:完成时工具结果里会出现「[bench] TASK COMPLETE」,看到就停。没看到这行就说明还没完成 —— 不要自己宣布完成,继续调用工具。只用提供的工具,每一轮都应该调用工具推进游戏。'
  ].join('\n\n');
}

export function firstMessage(task, intro) {
  return `任务:${task.brief}\n\n当前观察:\n${intro}`;
}
