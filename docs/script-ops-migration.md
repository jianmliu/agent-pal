# 脚本虚拟机 opcode 迁移清单

> [agent-pal.md](./agent-pal.md) §6.2 / §7 M2–M5 的落地清单:把 `services/script-runner.ts` 的全部 opcode
> 按 `ops/*.ts` 领域分好,标出每条在 ECS 后要变成的 `wait`,以及黄金轨迹目前覆盖到哪里。
> 行号以 d24d26f(本文首次提交)时的 `script-runner.ts` 为准,之后的修复会让行号偏移;覆盖次数取自 `apps/agent-pal/golden/traces/*.ops.json.gz`(基线 v2:4c40f74 / #46 重录的 63 条,加上 #48 的
> `classic-19-thief-escape`,#53 寻路修复后又重录了一部分;只说明场景走到了哪些 opcode,对应的行为由 `golden:verify` 锁住)。
> 覆盖列、各领域标题与总览表由 `node apps/agent-pal/src/ops-coverage.mjs --write` 从库里的轨迹和测试算出,
> `test:ops-coverage` 在 CI 里核对 —— 重录轨迹或加了解释器回归测试后跑一次 `--write` 即可。

Owned execution update (2026-10-09, SPEC/QUALITY and layered regression passed):0038 has a distinct version2 teleport-child return and full matching-runtime checkpoint/source authority. It discards the child continuation and keeps live child success/world changes; saved child waits restore without reselecting or writing back scene teleport entries. Auto remains one instruction, and ineligible operand0 jumps remain native. Existing supported child waits and atomic006D child writes are covered; battle/resource loading, durable world bundles and unified scheduling remain later work. See [teleport design](../superpowers/specs/2026-10-09-teleport-child-design.md). Current goldens stay v6.

Atomic scene/event increment (2026-10-09): manual trigger and auto support006D scene enter/teleport edits,006F conditional state copy to the executing event, and0071 unsigned amplitude/signed SHORT wave progression. Dense uint16 operands are required before effects. A matching006F source without an executing event explicitly rejects in manual mode; Native preserves its existing TypeError. Scene0/missing scenes and unmatched/missing event sources keep Native no-op behavior. Valid0049/004B/006F event writes use the existing World mutator, retaining raw row aliases and byte/component/journal projection. These operations finish before existing waits; restoring the following wait skips their completed prefix. Plain legacy delay/input retain their existing Runner compatibility, while teleport/World compositions retain their established publication authority. No new global consume-once contract or component authority inversion is introduced.

Atomic player status increment (2026-10-10): manual trigger/auto support002B/002C cures,002D/002F status changes and005D/0061 poison branches. Dense own uint16 operands reject before effects; Native semantics and existing StatusMatrices writers remain unchanged. Delay/input JSON restoration skips completed prefix writes. Evidence:299 named actual-asset checks, independent SPEC/QUALITY, two targeted goldens and73 shadow comparisons; see [verification](../superpowers/specs/2026-10-10-atomic-player-status-verification.md). The other five opcodes have no golden hits and are covered by parsed-asset fixtures. Unified scheduling and paired bundles remain later work.

Atomic player vitals increment (2026-10-10): manual trigger/auto admit001B/001C/001D/0022/005F/0074 through existing writers and Native semantics, with dense own uint16 preflight and completed-prefix retention across delay/input restoration. Evidence:578 named checks, two related short goldens/101 shadow comparisons and independent reviews; see [verification](../superpowers/specs/2026-10-10-atomic-player-vitals-verification.md). Real battle-resurrection golden coverage remains a separate open item.

Atomic inventory/equipment increment (2026-10-10): manual trigger/auto001F/0020/0023 retain Native inventory/active-equipment count, quantity/role/effect semantics and existing writers. Dense own uint16 rejection precedes effects, and JSON delay/input restoration skips completed writes. [Verification](../superpowers/specs/2026-10-10-atomic-inventory-equipment-verification.md):676 named checks,3 equipment-flow phases,2 targeted goldens/125 shadow comparisons; no full corpus or new scheduler/Command authority.

Atomic event metadata increment (2026-10-10): manual trigger/auto0024/0025/007E accept dense own uint16 operands. Existing entry setters/resolver semantics remain unchanged;007E uses the World mutator for byte/component/journal consistency. Held self-change/self-clear calls restore across delay/input without replacing the selected program or repeating prefix effects. [Verification](../superpowers/specs/2026-10-10-atomic-event-metadata-verification.md):218 named actual-resource checks, independent SPEC/QUALITY,2 targeted goldens/79 shadow steps/46 battle frames. No scheduler, battle Command or paired-bundle changes.

## 图例

- **入口**:`T` = `runTriggerScript` 里自己处理,`A` = `runAutoScript` 里自己处理,`I` = `interpretInstruction`。
  同一 opcode 出现 `T/A/I` 中的多个,说明两个入口语义不同(见下文「trigger 与 auto 的差异」),迁移时要按 `origin` 分支。
- **wait**:ECS 后这条指令可能挂起线程的原因(§2 表)。`—` = 纯函数,立即返回 `next`。
  `call` = 压栈调用另一段脚本;`load` = 今天 `await res.loadResources`,sim 预加载后变同步。
- **覆盖**:68 条黄金轨迹里该 opcode 被取指的次数(trace hook 只记 opcode,不分入口);`·` = 未覆盖。
  后缀「(回归)」= `apps/agent-pal/test/` 里有用真实数据单条执行它的解释器回归测试(直接设状态的夹具,不是沿剧情走到,
  不计入黄金轨迹覆盖;总览表单列「解释器回归」)。
- **桩**:今天的实现是空的或核心逻辑被注释掉,行为与 SDLPAL 不一致。

## 总览

| 领域 | 条数 | 已覆盖 | 解释器回归 | 带 wait | 桩 |
|---|---|---|---|---|---|
| `control` | 16 | 11 | 16 | 5 | 0(另有 2 条空实现,已修) |
| `dialog` | 8 | 7 | 8 | 3 | 1(已修) |
| `movement` | 28 | 24 | 28 | 11 | 0 |
| `party` | 24 | 14 | 24 | 3 | 0 |
| `status` | 7 | 2 | 7 | 0 | 0 |
| `inventory` | 9 | 5 | 9 | 3 | 1(已修) |
| `scene` | 20 | 17 | 20 | 2 | 0 |
| `presentation` | 27 | 18 | 27 | 16 | 0 |
| `battle` | 27 | **15** | 27 | 8 | 8(已修) |
| **合计** | **166** | **113** | **166** | **51** | **10(已修)** |

`0x0032`、`0x0048`、`0x009D` 没有分支,走 `default` 打 “Invalid Instruction”。
§6.2 列了 8 个 `ops/*` 文件,这里多加一个 `dialog`,对应 M3 的对话/选择原生化,和其余领域的迁移节奏不同。

## 建议的批次

### 补充的解释器行为回归

`apps/agent-pal/test/equipment-opcodes.test.mjs` 对真实游戏数据里的 `0018`、`0023`、`0058`、`0086`
执行单指令回归：装备物品守恒与重复装备、按角色卸装及重复卸装、物品数量边界、仅背包与已装备的区别、
队伍成员与非队伍角色的装备条件。实际入口为 `98FC`、`4331`、`7D93`、`8038`、`4009`。

第二批加入 `001E`、`001F`、`0020`、`008F`：银两不足不扣钱且跳转、刚好够钱时扣至零、默认一件、数量上限 99、
先背包后装备的移除顺序与不足时的跳转/尽力移除分支、奇数银两减半时向零取整。两批共 23 项检查。
新增入口包括 `045C`、`1FE9`、`04DA`、`0894`、`4332`、`803C`、`2A33`、`56AF`。

它补充迁移前的行为保护，但不增加上表黄金轨迹覆盖数：夹具直接设置状态，不是沿剧情走到该指令。
部分装备计数边界夹具绕过物品菜单限制，直接写装备槽，旨在保护解释器对状态的处理规则。
玉佛珠门禁测试止于 `4009` 的跳转结果，整段拒绝对白、传送和地图渲染仍需剧情轨迹覆盖。

`apps/agent-pal/test/equipment-flow.test.mjs` 补充组合回归：读取外部 `12.rpg`，通过实际装备菜单换上玉佛珠、
换回原饰品并存读档，检查装备/背包守恒、其他队员装备与银两不变、门禁分支随装备变化、原存档文件未改写。
它包含真实菜单与存读档，但门禁仍直接执行单条指令，不计为整段门禁黄金剧情覆盖。

### 角色数值与复活行为回归

角色数值补充测试：`apps/agent-pal/test/vitals-opcodes.test.mjs` 对 `001B`、`001C`、`001D`、`0022`、`005A`、
`005F`、`0074` 执行 23 项回归，覆盖角色/全队范围、数值上下限、死亡与复活、状态保留和满血跳转。
实际入口包括 `9928`、`9923`、`6F5E`、`9932`、`9A71`、`993E`、`21BB`、`9942`、`A438`、`1B5B`、
`9A38`、`9A0C`、`1913`。仍为直接状态夹具与单指令行为保护，不计入黄金剧情覆盖。

状态来源一致性：解释器写 `status-matrices` 信号，worldService 镜像信号到旧全局表，getter 返回信号快照。
复活测试默认检查清除状态后再读 world API 仍为零；`test:player-status-source` 无资产回归保护读取纯度、
单项修改、清空、旧表替换、生命周期，以及玩家状态与毒状态的独立更新。

### 玩家中毒与状态行为回归

`apps/agent-pal/test/status-opcodes.test.mjs` 覆盖状态领域全部 7 个 opcode（`0029`、`002B`、`002C`、
`002D`、`002F`、`005D`、`0061`），31 项检查；累计补充单指令回归达 22 个 opcode、77 项检查，
另有 3 阶段装备菜单存读档回归。保护抗毒边界、重复/满毒槽、毒脚本伤害与续执行入口、角色 ID 与队伍下标、
按 ID/等级解毒、死亡/傀儡、状态刷新与永久状态、毒条件精确跳转。实际入口包括 `99B9`、`A485`、
`99BE`、`9AA9`、`99D9`、`9B63`、`9A6F`、`9883`、`9926`、`9A08`、`9A5B`。
读取毒状态采用解释器同一适配器，未修改独立的旧毒状态 getter。真实 DOS 数据没有全队 `002C`，
因此该分支尚未覆盖；夹具直接写入毒槽以覆盖重复、满槽与等级边界。仍不增加黄金剧情覆盖数。

### 法术学习与伤害行为回归

`apps/agent-pal/test/magic-opcodes.test.mjs` 对 `0055`、`0056`、`0057`、`0088` 执行 12 项检查。
保护学习的重复/满槽/空洞、角色目标、忘记法术只清匹配槽、对象到法术表映射、MP 默认倍率与消耗、
银两伤害的取整和 5000 上限。入口为 `6BE9`、`0E24`、`A4A6`、`A46C`、`A466`。
累计补充单指令回归为 26 个 opcode、89 项检查。实际数据缺少 `0055` 事件角色、`0056` 明确角色、
`0057` 自定义倍率指令，这些分支未覆盖。本批不改变生产代码或黄金剧情覆盖。

### 场景与事件行为回归

`apps/agent-pal/test/scene-opcodes.test.mjs` 对 `0024`、`0025`、`0049`、`004B`、`0052`、
`006D`、`006F`、`0094`、`0095` 执行 20 项检查：事件一基下标、`FFFF` 当前事件、
目标与邻居字段隔离、隐藏时长/状态翻转、场景入口保留/清空、同步状态条件与精确分支（含目标零）。
实际入口包括 `1273`、`13D6`、`11EB`、`0D39`、`0D13`、`9C99`、`9CCF`、`9D00`、
`16EA`、`4196`、`198C`、`1242`、`5192`、`24DD`、`9B9D`。累计补充回归达 35 个 opcode、
109 项检查。事件比较仅覆盖选定执行/目标/相邻对象；渲染、碰撞缓存、调度仍需集成覆盖。
本批不改变生产代码或黄金剧情覆盖。

### 完整回归与执行审计

`test:all-opcodes` 汇总 11 个领域测试的实际执行证据，当前为 **166/166 个 opcode、238 项检查**。
每个领域只在行为断言通过后收集取指；汇总检查与本清单完全一致，并拒绝缺失或多余条目。
静态覆盖表用于追踪测试清单，完整执行证据另见 `docs/opcode-regression-report.json`；缺资产的跳过不算验证。

剩余批次分别是控制流/对话 24 条、角色 10 条、移动及剩余场景 39 条、战斗 27 条、商店炼妖 4 条、
画面音频 27 条。行为回归含明确标注的委托参数/等待契约，不能等同于完整寻路、像素/音频或完整战斗验证。
`0072` 和仅 auto 入口的 `00A7`（原清单漏项）的真实 DOS 指令不存在，因此用合成指令验证空操作；各领域使用合成操作数补充明确边界。
本结果不表示 VM 已迁移，也不增加黄金剧情覆盖数（当前 109/166，全部来自剧情轨迹）。

### 迁移顺序

每批都要求 `golden:verify` 逐条指令一致。**先补覆盖再迁移**:没被覆盖的 opcode 迁错了,黄金轨迹也发现不了。

要找某条未覆盖 opcode 该去剧情哪里打,在有游戏资源的机器上跑
`pnpm --filter @onchainpal/agent-pal opcode:roots -- --out /tmp/opcode-roots.md`:列出每条能从哪些场景、事件对象、
物品/法术/敌人脚本走到(见 `apps/agent-pal/src/opcode-roots.mjs` 开头的说明)。

1. **M2:数据进组件**。`party`、`status`、`inventory` 的非菜单部分全是同步读写,不需要 wait,
   改成写 `WorldWriter` 就行,风险最低。问题是黄金轨迹覆盖只有 13/40;解释器回归已补 15 条(装备 / 物品 / 银两 / HP·MP / 复活,见上),
   但那是单条夹具,还要用 `--seed` 玩到第一次加队、中毒、买药的剧情,再用 `from-run` 补场景。
2. **M3:dialog + 商店**。`0x000A`、`0xFFFF`、`0x0026/0x0027`、`0x0034`、`0x004D` 变成 `wait: dialog/choice/shop`。
   对话覆盖已经比较好(7/8,只差 `0x004D`)。
3. **M4 第 1 批:control**。要先定好 `ScriptThread`(PC、`callStack`、`idleFrames`),所有 `0x0004` 嵌套调用都靠它。
4. **M4 第 2 批:scene + movement**。movement 里 11 条带 `move`/`frames` wait,而且有 RETRY 模式(见下)。
5. **M4 第 3 批:presentation**。16 条 `fx`,无头时立即完成;画面客户端订阅 `SMSG_FX`。
6. **M5:battle**。覆盖 5/27,只有开战(`0x0007`)、设战场(`0x004A`)、敌人用法术(`0x0067`)、「不是同类第一只则跳转」(`0x0091`)
   和敌人逃跑(`0x0069`,#48 的 `classic-19-thief-escape`);伤害、中毒、偷窃、我方逃跑、分身/召唤/变身、战斗结果等都没覆盖。先补一个从剧情 `0x0007` 开战、
   用法术和物品、并打到敌人分身或召唤的场景。

## 迁移前先修的桩(行为 ≠ SDLPAL)

这些不是迁移本身的工作,但不修的话,黄金轨迹会把错的行为当成基准录进去。
下表已全部按 SDLPAL `script.c` 修复;修复时又发现三处同类问题,一并列入。

| op | 原状 | 修复 |
|---|---|---|
| `0x0058` 物品不足则跳转 | 判断被注释,永远不跳 | 已修。依赖的 `getItemAmount` 读错了字段(`objectID`,库存条目实际是 `item`),一直返回 0,连带战斗里用/投物品被改成防御/普攻 |
| `0x0091` 不是同类第一只则跳转 | 永远不跳;注释把语义写成「不止一只」 | 已修 |
| `0x003A` 我方逃跑 | 非 boss 分支为空 | 已修 |
| `0x0042` / `0x0066` 模拟法术 / 掷武器 | `simulateMagic` 被注释;`0x0066` 伤害公式也不对 | 已修 |
| `0x0092` 我方施法动画 | 整段注释 | 已修 |
| `0x0069` / `0x006A` 敌人逃跑 / 偷窃 | 直接 `await` 生成器,函数体从未执行(新发现) | 已修 |
| `0x009C` / `0x009E` / `0x009F` 分身 / 召唤 / 变身 | 空的 | 已修 |
| `0x004D` 等任意键 | 空的 | 已修;等待时 `dialogService` 标记 `awaitingInput`,agent-pal 看到的是 `dialog` |
| `0x004E` 读最近存档 | 只淡出,`initGameData` 被注释 | 已修;排队到 `play.startFrame` 下一帧开头读档 |
| `0x00A0` 退出游戏 | 空的 | 调 `game.shutdown()`;Win95 片尾和额外制作名单未移植 |
| `0x0002`(trigger 与 auto) | `evtObj` 没判空 | 已修 |

以上修复只做了打包和类型检查。基线 v1 里只有 `0x0091`(2 次)被覆盖到;基线 v2 又多了 `0x0069`(2 次,#48 的
`classic-19-thief-escape`)。`0x0002` 本身执行得很多,但修的是判空分支,未必走到;其余改到的 opcode 仍然没有轨迹、没有在游戏里跑过。

### 已修:直接 `await` 生成器

`surface.*` 的淡入淡出/震屏、`rng.play`、`ending.*` 都是生成器函数,而下面这些分支直接 `await` 了它们,
只拿到生成器对象,**效果从未执行**。现已全部改为经 `resolveUiTask` / `co` 驱动:

`0x0035` 震屏 · `0x0037` RNG 动画 · `0x004F` 变红 · `0x0050` 淡出 · `0x0051` / `0x0093` 淡入 ·
`0x0073` / `0x009B` 淡入到场景 · `0x0076` / `0x00A4` / `0x00A5` FBP 图 · `0x0080` 日夜渐变 ·
`0x008C` 颜色渐变 · `0x0096` 片尾动画

其中 `0x0050`、`0x0073`、`0x0035` 和 `0x008C` 在黄金轨迹里有覆盖(次数见清单)。修复改变了虚拟时间和帧哈希,
已在基线 v1(#32)里重录。

## 迁移时要处理的模式

- **RETRY**:`0x0010`、`0x0011`、`0x007C`、`0x0082` 没走到目标时先 `scriptEntry--`,再画一帧、`sleepByFrame(1)`,
  返回以后这条指令会被重新执行。迁移后统一成 `{ next: pc, wait: { kind: 'move', entity } }`,
  由 `npc-move-system` 推进,到了以后再恢复线程。
- **trigger 与 auto 的差异**:`0x0000`–`0x0009` 在两个入口里语义不同。
  auto 每帧只执行一条;`0x0003`/`0x0006` 跳转后会在同一帧递归执行;`0x0009` 只计数,不阻塞;
  两个入口还各用一个空闲计数器(`scriptIdleFrame` 和 `scriptIdleFrameCountAuto`)。
  `OpDef.run` 要按 `t.origin === 'auto'` 分支,两个计数器都要进 `ScriptThread`(§6.2 只写了一个 `idleFrames`)。
- **直接写字段**:`0x0040`、`0x0049`、`0x004B`、`0x0052`、`0x006C`、`0x006F`、`0x007D`、`0x007E`、`0x0081`、`0x0084`
  会直接改事件对象字段,不经过 `worldService.mutateEventObjectById`,所以这些修改不会出现在状态 diff 里。
  迁到 `WorldWriter` 以后,黄金轨迹里「本步改动的事件对象编号」可能变多;这是改正,不是回归,需要重录。
- **嵌套调用**:`0x0004`、`0x0028`、`0x0038` 会 `await this.runTriggerScript(...)`,迁移后要改成 `callStack.push`。
  `0x0028` 是从战斗里调用的,要等 M5 一起迁。
- **跳转偏移**:`interpretInstruction` 返回的是 `entry + 1`,所以里面的跳转都写成 `operand - 1`。
  改成 `run()` 直接返回 `next` 以后,要把这个 `- 1` 去掉。
- **随机数**:`0x0006`、`0x00A2`、`0x0029`、`0x002E`、`0x0028`、`0x0034`、`0x0066` 会消耗随机数。
  抽取的顺序和次数必须保持不变,否则黄金轨迹里的随机数计数会对不上。

## 清单

### control —— 控制流

落点:`ops/control.ts` · 阶段:M4 第 1 批 · 16 条,黄金轨迹覆盖 11 条,解释器回归 16 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `0000` | 结束（续点不变） | T/A | 1488 | — | 45660(回归) | trigger 结束 / auto 原地停 |
| `0001` | 结束（续点=下一条） | T/A | 1491 | — | 35980(回归) |  |
| `0002` | 挂起 N 次后继续（续点=op0） | T/A | 1495 | frames(auto) | 89301(回归) | `evtObj` 未判空(T 与 A) |
| `0003` | 有限次跳转 | T/A | 1509 | — | 434926(回归) | auto 版同帧递归 |
| `0004` | 调用子脚本 | T/A | 1522 | call | 117(回归) | → `callStack.push` |
| `0006` | 按概率跳转 | T/A | 1548 | — | 39290(回归) | RNG |
| `0008` | 替换入口为下一条 | T | 1570 | — | 8(回归) |  |
| `0009` | 等 N 帧 | T/A | 1575 | frames | 24501(回归) | trigger 版每帧跑 `play.update` |
| `0041` | 标记脚本失败 | I | 2398 | — | ·(回归) | 写 `scriptSuccess` |
| `004E` | 读最近存档（游戏结束） | I | 2498 | fx + load | ·(回归) | 已修：下一帧读档 |
| `0072` | 未知（空操作） | I | 2785 | — | ·(回归) | DOS 无指令，合成夹具 |
| `0078` | 未知（空操作） | I | 2858 | — | 30(回归) |  |
| `0085` | 延时 | I | 3118 | frames | 34(回归) | `sleep(ms)` → 帧数 |
| `00A0` | 退出游戏 | I | 3371 | — | ·(回归) | 已修：调 `game.shutdown` |
| `00A2` | 随机跳到后 N 条之一 | I | 3416 | — | 8(回归) | RNG |
| `00A7` | 自动脚本空操作 | A | 1852 | — | ·(回归) | 原清单遗漏，DOS 无指令，合成夹具 |

### dialog —— 对话 / 选择

落点:`ops/dialog.ts` · 阶段:M3 · 8 条,黄金轨迹覆盖 7 条,解释器回归 8 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `000A` | 是/否，选否跳转 | T | 1592 | choice | 8(回归) | 已发 `dialogService.publishChoice` |
| `003B` | 对话框：居中 | T | 1612 | — | 57(回归) | 开框，不阻塞 |
| `003C` | 对话框：上方+头像 | T | 1618 | — | 725(回归) |  |
| `003D` | 对话框：下方+头像 | T | 1624 | — | 820(回归) |  |
| `003E` | 对话框：居中窗口 | T | 1630 | — | 90(回归) |  |
| `004D` | 等任意键 | I | 2493 | dialog | ·(回归) | 已修（原为桩） |
| `008E` | 清对话、恢复画面 | T | 1636 | — | 174(回归) |  |
| `FFFF` | 显示一行台词 | T/A | 1642 | dialog | 5526(回归) | storygraph 优先 |

### movement —— 移动

落点:`ops/movement.ts` · 阶段:M4 · 28 条,黄金轨迹覆盖 24 条,解释器回归 28 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `000B` | NPC 朝南走一步 | I | 1785 | — | 3419(回归) | 0x000B–0x000E 同一分支 |
| `000C` | NPC 朝西走一步 | I | 1786 | — | 4802(回归) |  |
| `000D` | NPC 朝北走一步 | I | 1787 | — | 3339(回归) |  |
| `000E` | NPC 朝东走一步 | I | 1788 | — | 4869(回归) |  |
| `000F` | 设 NPC 朝向/帧 | I | 1798 | — | 45820(回归) |  |
| `0010` | NPC 走到 (x,y) | I | 1808 | move | 3384(回归) | RETRY（`scriptEntry--`） |
| `0011` | NPC 慢速走到 (x,y) | I | 1819 | move | 8674(回归) | RETRY |
| `0012` | 设事件对象位置（相对队伍） | I | 1837 | — | ·(回归) |  |
| `0013` | 设事件对象位置 | I | 1850 | — | 12(回归) |  |
| `0014` | 设事件对象姿势 | I | 1863 | — | 33361(回归) |  |
| `0015` | 设队员朝向/姿势 | I | 1876 | — | 1662(回归) |  |
| `0016` | 设事件对象朝向/姿势 | I | 1888 | — | 1046(回归) |  |
| `003F` | 乘事件对象移动（慢） | I | 2386 | move | ·(回归) | `partyRideEventObject` |
| `0044` | 乘事件对象移动（常速） | I | 2414 | move | 4(回归) |  |
| `004C` | 追逐玩家 | I | 2483 | — | 327141(回归) | `monsterChasePlayer` |
| `0062` | 暂停追逐 | I | 2636 | — | ·(回归) | 写追逐旗标 |
| `0063` | 加速追逐 | I | 2641 | — | ·(回归) |  |
| `006C` | NPC 位移一步 | I | 2702 | frames | 2682(回归) | 直接改 `current.x/y` |
| `006E` | 队伍位移一步 | I | 2738 | — | 1364(回归) |  |
| `0070` | 队伍走到 (x,y) | I | 2776 | move | 78(回归) | `partyWalkTo` |
| `007A` | 队伍快走到 (x,y) | I | 2876 | move | 238(回归) |  |
| `007B` | 队伍最快走到 (x,y) | I | 2880 | move | 78(回归) |  |
| `007C` | NPC 直走到 (x,y) | I | 2884 | move | 340(回归) | RETRY |
| `007D` | 移动事件对象 | I | 2902 | — | 2551(回归) | 直接写字段 |
| `0082` | NPC 快速直走到 (x,y) | I | 3057 | move | 132(回归) | RETRY |
| `0087` | 事件对象原地动画 | I | 3154 | — | 206722(回归) |  |
| `0097` | 乘事件对象移动（快） | I | 3267 | move | 4(回归) |  |
| `00A1` | 队员全部聚到队首位置 | I | 3375 | — | 2(回归) |  |

### party —— 队伍与角色属性

落点:`ops/party.ts` · 阶段:M2 → M4 · 24 条,黄金轨迹覆盖 14 条,解释器回归 24 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `0017` | 设额外属性（装备效果） | I | 1901 | — | 40878(回归) |  |
| `0018` | 装备物品 | I | 1906 | — | 24224(回归) | 触发 `updateEquipments` |
| `0019` | 增减角色属性 | I | 1926 | — | ·(回归) |  |
| `001A` | 设角色属性 | I | 1931 | — | 1710(回归) |  |
| `001B` | 增减 HP | I | 1945 | — | 82(回归) |  |
| `001C` | 增减 MP | I | 1957 | — | 2(回归) |  |
| `001D` | 增减 HP+MP | I | 1969 | — | 16(回归) |  |
| `0022` | 复活 | I | 2032 | — | 10(回归) |  |
| `0023` | 卸下装备 | I | 2061 | — | ·(回归) |  |
| `0030` | 按百分比临时加属性 | I | 2267 | — | 2(回归) |  |
| `0031` | 临时换战斗形象 | I | 2278 | — | ·(回归) |  |
| `0055` | 学会法术 | I | 2533 | — | 10(回归) |  |
| `0056` | 忘记法术 | I | 2543 | — | ·(回归) |  |
| `0057` | 按 MP 设法术伤害 | I | 2553 | — | ·(回归) |  |
| `005A` | HP 减半 | I | 2585 | — | ·(回归) |  |
| `005F` | 立即阵亡 | I | 2619 | — | ·(回归) |  |
| `0065` | 设角色形象 | I | 2658 | load | 242(回归) | `res.loadResources` |
| `0074` | 非全员满血则跳转 | I | 2798 | — | ·(回归) |  |
| `0075` | 设队伍成员 | I | 2813 | load | 124(回归) | `res.loadResources` + `updateEquipments` |
| `0079` | 某人在队则跳转 | I | 2861 | — | 6(回归) |  |
| `0086` | 未装备某物则跳转 | I | 3131 | — | ·(回归) |  |
| `0088` | 按钱数设法术伤害 | I | 3160 | — | 2(回归) | 也扣钱 |
| `008D` | 升级 | I | 3193 | — | ·(回归) |  |
| `0098` | 设跟随者 | I | 3271 | load | 2(回归) | `res.loadResources` |

### status —— 中毒 / 状态（我方）

落点:`ops/status.ts` · 阶段:M2 → M4 · 7 条,黄金轨迹覆盖 2 条,解释器回归 7 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `0029` | 玩家中毒 | I | 2191 | — | 24(回归) | RNG |
| `002B` | 按毒 ID 解毒（玩家） | I | 2227 | — | ·(回归) |  |
| `002C` | 按等级解毒 | I | 2237 | — | ·(回归) |  |
| `002D` | 设玩家状态 | I | 2247 | — | 814(回归) |  |
| `002F` | 解除玩家状态 | I | 2263 | — | ·(回归) |  |
| `005D` | 玩家没中某毒则跳转 | I | 2604 | — | ·(回归) |  |
| `0061` | 玩家没中毒则跳转 | I | 2630 | — | ·(回归) |  |

### inventory —— 物品 / 银两 / 商店

落点:`ops/inventory.ts` · 阶段:M2 / M3（商店） · 9 条,黄金轨迹覆盖 5 条,解释器回归 9 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `001E` | 增减银两（不够则跳转） | I | 1981 | — | 32(回归) |  |
| `001F` | 得到物品 | I | 1989 | — | 186(回归) |  |
| `0020` | 失去物品（含卸装备） | I | 1993 | — | 34(回归) |  |
| `0026` | 买东西菜单 | I | 2116 | shop | ·(回归) |  |
| `0027` | 卖东西菜单 | I | 2123 | shop | ·(回归) |  |
| `0033` | 收妖（计数） | I | 2287 | — | ·(回归) |  |
| `0034` | 炼妖成物品 | I | 2295 | dialog | ·(回归) | owned trigger/auto：同运行时 classic/suppressed、相对 poll、真实 Scene/fade；详见 [0034 验证记录](vm-generated-item-dialog.md) |
| `0058` | 物品不足则跳转 | I | 2565 | — | 10(回归) | 已修（原为桩） |
| `008F` | 银两减半 | I | 3197 | — | 2(回归) |  |

### scene —— 事件对象与场景

落点:`ops/scene.ts` · 阶段:M4 · 20 条,黄金轨迹覆盖 17 条,解释器回归 20 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `0024` | 设事件对象自动脚本入口 | I | 2084 | — | 387(回归) |  |
| `0025` | 设事件对象触发脚本入口 | I | 2100 | — | 283(回归) |  |
| `0038` | 传送出场景（土遁） | I | 2345 | call | 2(回归) | 嵌套 `runTriggerScript` |
| `0040` | 设触发方式 | I | 2390 | — | 150(回归) | 直接写字段 |
| `0046` | 设队伍在地图上的位置 | I | 2422 | — | 650(回归) | 写视口/轨迹 |
| `0049` | 设事件对象状态 | I | 2469 | — | 1299(回归) | 直接写字段 |
| `004B` | 事件对象短暂失效 | I | 2479 | — | ·(回归) | 直接写 `vanishTime` |
| `0052` | 事件对象隐藏一段时间 | I | 2520 | — | 472(回归) | 直接写字段 |
| `0059` | 切换场景 | I | 2572 | — | 492(回归) | 设加载旗标，下一帧加载 |
| `006D` | 设场景进入/传送脚本 | I | 2717 | — | 78(回归) |  |
| `006F` | 同步事件对象状态 | I | 2768 | — | 4672(回归) | 直接写字段 |
| `007E` | 设事件对象图层 | I | 2911 | — | 10(回归) |  |
| `0081` | 没面朝某对象则跳转 | I | 3026 | — | 24(回归) |  |
| `0083` | 事件对象不在区域内则跳转 | I | 3071 | — | 309(回归) |  |
| `0084` | 把用掉的物品放成事件对象 | I | 3092 | — | ·(回归) | `scene.checkObstacle` |
| `0090` | 设物件脚本 | I | 3202 | — | 2(回归) |  |
| `0094` | 事件对象状态为某值则跳转 | I | 3251 | — | 6(回归) |  |
| `0095` | 当前场景为某场景则跳转 | I | 3257 | — | 2(回归) |  |
| `0099` | 换场景地图 | I | 3305 | load | ·(回归) | `res.loadResources` |
| `009A` | 批量设事件对象状态 | I | 3326 | — | 14(回归) |  |

### presentation —— 画面与音频

落点:`ops/presentation.ts` · 阶段:M4 · 27 条,黄金轨迹覆盖 18 条,解释器回归 27 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `0005` | 重绘画面 | T | 1526 | frames | 1680(回归) | `sleep(op1*60)` |
| `0035` | 震屏 | I | 2323 | fx | 24(回归) |  |
| `0036` | 设当前 RNG 动画 | I | 2332 | — | 2(回归) |  |
| `0037` | 播 RNG 动画 | I | 2336 | fx | 2(回归) | `rng.play` |
| `0043` | 设背景音乐 | I | 2409 | — | 237(回归) |  |
| `0045` | 设战斗音乐 | I | 2418 | — | 124(回归) |  |
| `0047` | 播音效 | I | 2463 | — | 623(回归) |  |
| `004F` | 屏幕变红（游戏结束） | I | 2503 | fx | ·(回归) |  |
| `0050` | 淡出 | I | 2507 | fx | 968(回归) |  |
| `0051` | 淡入 | I | 2513 | fx | ·(回归) |  |
| `0053` | 日间调色板 | I | 2525 | — | 2(回归) |  |
| `0054` | 夜间调色板 | I | 2529 | — | 4(回归) |  |
| `0071` | 屏幕波动 | I | 2780 | — | 30(回归) | 写旗标 |
| `0073` | 淡入到场景 | I | 2788 | fx | 104(回归) |  |
| `0076` | 显示 FBP 图 | I | 2845 | fx | ·(回归) |  |
| `0077` | 停止音乐 | I | 2854 | — | 46(回归) |  |
| `007F` | 移动视口 | I | 2917 | frames | 266(回归) | 103 行，最长分支 |
| `0080` | 日/夜调色板渐变 | I | 3020 | fx | ·(回归) |  |
| `008B` | 换调色板 | I | 3180 | — | 20(回归) |  |
| `008C` | 颜色渐变 | I | 3188 | fx | 16(回归) |  |
| `0093` | 淡入（期间更新场景） | I | 3245 | fx | 4(回归) |  |
| `0096` | 片尾动画 | I | 3263 | fx | ·(回归) | owned trigger/auto：经典同一运行时 renderer，显式可信 root clock；详见0096设计 |
| `009B` | 淡入到当前场景 | I | 3349 | fx | ·(回归) |  |
| `00A3` | 播 CD 音轨 | I | 3420 | — | 2(回归) |  |
| `00A4` | 卷动 FBP 图 | I | 3425 | fx | ·(回归) |  |
| `00A5` | FBP 图 + 精灵特效 | I | 3440 | fx | ·(回归) |  |
| `00A6` | 备份画面 | I | 3450 | — | ·(回归) |  |

### battle —— 战斗内

落点:`ops/battle.ts` · 阶段:M5 · 27 条,黄金轨迹覆盖 15 条,解释器回归 27 条

| op | 名称 | 入口 | 行 | wait | 覆盖 | 备注 |
|---|---|---|---|---|---|---|
| `0007` | 开战 | T | 1557 | battle | 261(回归) | 胜/负/逃三路跳转 |
| `0021` | 伤害敌人 | I | 2019 | — | 4(回归) |  |
| `0028` | 敌人中毒 | I | 2129 | call | 4(回归) | RNG；嵌套脚本 |
| `002A` | 按毒 ID 解毒（敌人） | I | 2206 | — | ·(回归) |  |
| `002E` | 设敌人状态 | I | 2251 | — | ·(回归) | RNG |
| `0039` | 吸敌人血 | I | 2360 | — | ·(回归) |  |
| `003A` | 我方逃跑 | I | 2377 | battle | 2(回归) | 已修（原为桩） |
| `0042` | 模拟法术 | I | 2402 | battle | 6(回归) | 已修（原为桩） |
| `004A` | 设战场 | I | 2475 | — | 110(回归) |  |
| `005B` | 敌人 HP 减半 | I | 2590 | — | ·(回归) |  |
| `005C` | 隐身一段时间 | I | 2600 | — | ·(回归) |  |
| `005E` | 敌人没中某毒则跳转 | I | 2610 | — | ·(回归) |  |
| `0060` | 敌人即死 | I | 2626 | — | ·(回归) |  |
| `0064` | 敌人 HP 高于百分比则跳转 | I | 2646 | — | ·(回归) |  |
| `0066` | 掷武器 | I | 2669 | battle | ·(回归) | 已修（原为桩） |
| `0067` | 敌人使用法术 | I | 2679 | — | 78(回归) |  |
| `0068` | 轮到敌人则跳转 | I | 2684 | — | 34(回归) |  |
| `0069` | 敌人逃跑 | I | 2690 | battle | 2(回归) | 已修（原先 await 生成器空跑） |
| `006A` | 偷窃 | I | 2694 | battle | 2(回归) | 已修（原先 await 生成器空跑） |
| `006B` | 吹飞敌人 | I | 2698 | — | ·(回归) |  |
| `0089` | 设战斗结果 | I | 3172 | — | 6(回归) |  |
| `008A` | 下一战自动战斗 | I | 3176 | — | 2(回归) |  |
| `0091` | 敌人不止一只则跳转 | I | 3206 | — | 54(回归) | 已修（原为桩） |
| `0092` | 我方施法动画 | I | 3218 | fx | ·(回归) | 已修（原为桩） |
| `009C` | 敌人分身 | I | 3359 | — | 6(回归) | 已修（原为桩） |
| `009E` | 敌人召唤 | I | 3363 | — | 2(回归) | 已修（原为桩） |
| `009F` | 敌人变身 | I | 3367 | — | ·(回归) | 已修（原为桩） |
