# agent-pal-bench —— 不同 AI 玩经典仙剑的效率基准

> **状态**:进行中 · **M0 已完成**(2026-10-08):`apps/agent-pal/bench/` —— 状态视图、谓词、题目校验、`bench state` / `check` / `validate`,
> 3 道题 × 3 颗种子的参考解全部判为成功;**M1 已完成**:`bench run` / `score`、内置循环(Ollama / OpenAI 兼容 / Anthropic / replay)、
> claude CLI 外部通道(§7、§12.2)。地基在 agent-pal(确定性无头运行、存档起步、运行日志、黄金轨迹);
> 本文定义题目格式、状态视图与谓词、档位、指标、runner 与可复现规则。
> 关联:[agent-pal](agent-pal.md)(无头客户端与工具面)· agent-wow(对标:无头客户端里让模型打通新手区)·
> aigg-world 的 GCC 计价(§11)。

**一句话**:同一份存档、同一颗种子、同一套工具、同一个预算,让不同模型去完成同一个仙剑里的目标;
比**谁做成了、花了多少步 / 多少 token / 多少钱**。锁步时钟让「想得慢」不吃亏,确定性让每一局都能重放核验。

## 1. 为什么现在能做:地基已经齐了

| 基准需要 | agent-pal 现状 |
|---|---|
| 同输入 → 同结果 | `--seed N` 确定性模式:虚拟时钟(`clock.mjs`)+ 引擎随机数设种;同存档 + 同种子 + 同指令序列 ⇒ 同一条轨迹;`determinism-check.mjs` 逐步比对 |
| 思考快慢不影响结果 | 锁步:时间只在工具调用期间推进,两次调用之间游戏静止 |
| 固定起点 | 场景可从存档起步(`start.rpg` 原版 DOS 存档 / `start.saves` 存档槽);已有 51 个原版经典存档场景 |
| 全程记录 | MCP 每次调用写一行 JSONL 到 `runs/`(工具、参数、结果、期间对白与换场) |
| 事后重放 | `golden.mjs from-run` 把一次 `--seed` 会话转成可原样重放的场景 |
| 模型无关接口 | 工具面经 MCP(stdio)/ HTTP JSON-RPC 暴露,工具清单见 [agent-pal](agent-pal.md) §5 |

**差的**:「考题与评分」——黄金轨迹是回归基准,没有目标;以及一个能驱动不同模型、记 token、判分的 runner。

## 2. 目标与非目标

- **目标**:可重复地比较模型在**长程、部分可观测、带剧情与战斗**的任务上的成功率与效率;给出可信的排行
  (每一局都能重放核验);区分「会规划」与「背过攻略」(§5 档位)。
- **非目标**:不发布游戏资产、攻略、全图(版权,见 §10);不做实时反应速度测试(锁步刻意去掉这一维);
  不比较 agent 框架的工程花活 —— 内置循环统一提示词与工具,外部 agent 单列(§7.2)。

## 3. 题目(task)

一题 = 起点 + 目标 + 预算 + 档位。放在 `apps/agent-pal/bench/tasks/<id>.json`:

```jsonc
{
  "id": "yuhang-wine-to-drunk-taoist",        // 稳定 id;改目标就升 version
  "version": 1,
  "title": "把桂花酒送到醉道士手里",
  "difficulty": 2,                            // 1 跑腿 · 2 多步剧情 · 3 迷宫 / 战斗 · 4 章节级
  "start": { "rpg": "01.rpg" },               // 或 { "saves": "x.saves.json.gz", "slot": 1 }(文件在 bench/saves/)或 { "newGame": true }
  "seeds": [42, 43, 44],                      // 每颗种子一局
  "brief": "你在余杭镇。把桂花酒交给醉道士,直到他提出约你去十里坡。",   // 给模型的任务说明(不含解法)
  "goal": { "all": [ { "textSeen": "十里坡" }, { "not": { "hasItem": { "name": "桂花酒" } } } ] },
  "milestones": [                             // 部分分:按顺序或无序命中
    { "id": "got-wine",   "when": { "hasItem": { "name": "桂花酒" } } },
    { "id": "met-taoist", "when": { "textSeen": "醉道士" } }
  ],
  "fail": { "any": [ { "partyWiped": true } ] },   // 可选:立判失败
  "budget": { "toolCalls": 150, "tokens": 400000, "virtualSeconds": 3600 },
  "tiers": ["B", "C"],                        // 本题开放的档位(§5)
  "disallowTools": ["save", "load"]           // 可选:挑战题禁用的工具(从档位工具清单里去掉)
}
```

**出题方法**(不要凭记忆写场景号 / 物品号):先用参考解(人或强模型,`--seed` 模式)把目标打通一遍,
在终点用 `bench state` 导出状态视图,从中挑**能区分「做到 / 没做到」的最少几个条件**写成 goal;
milestones 取参考解途中的关键状态。参考解本身存进 `bench/reference/<id>.jsonl`,同时是这题「可解」的证明。

## 4. 状态视图(StateView)与谓词

### 4.1 状态视图

判分**不读原始存档字节**,只读一层稳定的状态视图 —— 这是 bench 里唯一贴着引擎的代码。
引擎后续要把脚本虚拟机迁上 ECS、再加 PAL 线协议([agent-pal](agent-pal.md) §2、§4),到时只换这一层的实现,
题目与谓词不动。

| 字段 | 来源(今天) |
|---|---|
| `scene`、`pos {gx, gy}` | `worldService.getSceneId()`、`agent.playerPos()` |
| `visitedScenes` | `agent.stats().visitedScenes` |
| `party[] {roleId, name, level, hp, mp}` | `getParty()` / `getPlayerRoles()` / `getPlayerStatusMatrix()` |
| `inventory[] {itemId, name, amount}` | `getInventory()` + 物品名表 |
| `cash` | `getCash()` |
| `mode`、`inBattle` | `agent.mode()`、`isInBattle()` |
| `battles[] {enemyTeam, outcome, rounds, hpLost}` | 战斗服务;由 runner 在战斗结束时追加 |
| `eventObjects(scene)[] {idx, state, triggerScript}` | `getEventObjectsInCurrentScene()`(只能看当前场景) |
| `textLog[]` | 对白 / 系统文字的历史(observe 的新增文本累积) |

注意:**经典仙剑没有全局剧情旗标**,剧情进度藏在各场景事件物体的状态与触发脚本里,而且只能看当前场景的。
所以优先用**可观察的结果**出题(到了哪、拿到什么、谁入队、打赢谁、出现了哪句话),`eventObject` 谓词只在
「必须在某个场景里确认某个物体状态」时用。

### 4.2 谓词

JSON 组合式,runner 在**每次工具调用之后**求值(模型看不到):

| 谓词 | 真当 |
|---|---|
| `sceneIs: n` / `sceneVisited: n` | 当前场景是 n / 到过 n |
| `at: {scene, gx, gy, r?}` | 在某场景某格半径 r 内 |
| `hasItem: {id \| name, min?}` | 背包里有,数量 ≥ min(默认 1) |
| `partyIncludes: roleId \| name` | 队伍里有某角色 |
| `levelAtLeast: {role?, n}` · `cashAtLeast: n` | 等级 / 银两达标 |
| `battleWon: {enemyTeam?}` · `partyWiped: true` | 赢过某场战斗 / 全灭 |
| `battleFled: {enemyTeam?}` · `memberDown: true` | 逃过某场战斗 / 队伍里有人倒下(HP 0;maxHp 0 的空位不算) |
| `textSeen: "子串" \| {regex}` | 文字历史里出现过 |
| `eventObject: {scene, idx, state?, triggerScript?}` | 当前在该场景且该物体状态吻合 |
| `all` / `any` / `not` | 组合 |

## 5. 档位(tier):同一题,不同可用工具

| 档 | 可用工具 | 测什么 |
|---|---|---|
| **A 像素** | `screenshot` · `press` · `wait` | 看图理解 + 底层操作(最难) |
| **B 结构化**(默认) | A + `observe` · `walk_to` · `step` · `interact` · `search` · `advance` · `choose` · `use_item` · `cast` · `battle` · `map` · `save` · `load` · `list_saves` | 规划与执行 |
| **C 开卷** | B + `guide`(攻略 / 剧本)· `atlas`(全图) | 用外部知识 |

- **B 与 C 的差距本身是一项结果**:模型多半读过仙剑攻略,这个差距量出它有多依赖背下来的知识。
- `map`(agent 自建的地图记忆,`memory.json`)默认跨运行持久 —— **每局必须从空记忆开始**,存档目录同样每局隔离,
  否则后跑的局沾了先跑的光。
- 题目用 `tiers` 声明自己开放哪些档;成绩按档分开排行,不跨档比较。
- **A 档的实现(M3)**:工具结果只给成败(`ok` / `FAILED — 原因`,去掉「mode now …」这类结构化提示)+ 调用后的画面
  (`screenshot` 同款 640×400 PNG;`screenshot` 本身不推进游戏);开局第一条消息附当前画面,没有 observe 文字。
  内置循环里画面随工具结果走:超出最近 6 条的旧结果连画面一起省略(占位提示改为「call screenshot」;B / C 档的占位文字不变)。
  三家适配器各按自家格式附图 —— Anthropic:`tool_result` 内容是 [文字, image];OpenAI:tool 消息只能是文字,
  同一轮的画面紧跟在这些 tool 消息之后合成一条 user 消息;Gemini:`inlineData` 紧跟在对应的 `functionResponse` 后。
  外部 agent 通道的工具结果同样附 `image` content;它拿不到开局附图,开局提示让它先调 `screenshot`。
  **目前没有题开放 A 档**(各题 `tiers` 都是 B / C):哪些题在纯画面下公平可解要逐题判断,开放前用 `bench check` 不够
  (参考解是 B 档动作),需要另录 A 档参考解或只做无参考解的试跑。

### 5.1 提示档位(hints):与工具档位正交

agent-pal 能静态读游戏脚本,得出真人玩家只能靠试错 / 对话线索 / 查攻略才知道的「答案」:开关会打开哪扇门、
哪件道具该对哪个物体用或该放在哪个场景、NPC 会检查你带没带某物品(数量)。`AGENT_PAL_HINTS`(agent 选项 `hints`)控制给不给:

| 提示档 | 给什么 | 用在哪 |
|---|---|---|
| **full**(agent-pal 默认) | 以上全部(observe / map / panorama 标开关效果、`USE ITEM`、物品门槛;`use_item` 用错地方时说该去哪用) | 日常试玩、录像、跑通关 |
| **standard**(bench 默认) | 只给加入这些分析之前就有的信息;开关只是普通触发器 / 调查点,道具用法靠 AI 自己摸索 | 排行榜成绩 |

- `bench run --hints standard|full`(默认 standard);`run.json`、每局结果与日志 `start` 都记 `hints`,续跑核对它,
  `verify` 按日志里的档位重放。加这个字段之前的运行没有 `hints`,当作 standard(当时还没有这些提示)。
- 排行页把 `hints: full` 的运行单独成档(「B · full hints」),不与 standard 混排。
- **standard 与 full 的差距本身是一项结果**(同 B / C 之差):量出模型自己摸索机关、记线索、跨场景推理的能力。

## 6. 指标

每一局(题 × 种子 × 模型 × 档)产出:

| 指标 | 定义 |
|---|---|
| **success** | 预算内 goal 为真(内置循环:调用、token、虚拟时间三项预算;外部 agent 只看调用与虚拟时间,见 §7.2) |
| **progress** | 成功局 = 1;失败局 = 命中的 milestones / (总数 + 1) —— goal 算最后一格,所以命中全部 milestones 但没到 goal 不会和成功同分(只有 1 个 milestone 的题,到过它 = 0.5) |
| **toolCalls** | 到成功(或耗尽)为止的工具调用数;另记无效调用(参数错、`ok:false`)占比 |
| **virtualSeconds** | 游戏内虚拟时间(锁步下与机器快慢无关) |
| **tokensIn / tokensOut / cost** | 由 runner 内置循环逐轮累计;cost 按价目表(随结果一起冻结版本) |
| **stuck** | 连续 K 次推进游戏的调用(默认 20)状态视图无任何变化即判卡死并提前终止;只看画面 / 查资料的调用(`screenshot` / `guide` / `atlas`)不计入,也不打断计数 |
| **crash** | agent-pal 报 `crashed` 模式 |
| **battle** | 战斗场次、胜负、回合、掉血 |

**聚合**:每题按种子求 success 率与均值 ± 标准差;总分 = 各题 success 率均值(主排序),同分比
**成功局的平均 cost**(越低越好)。另画 success × cost 的帕累托图 —— 「便宜但常失败」和「贵但稳」都看得见。

排行页(`bench board`,`bench/board.mjs`):把 `bench/out/` 下(或指定的)各次运行重新 score,写一个自包含的静态
HTML(不连外网、不引脚本,默认 `bench/out/board.html`)。按档位分开排;外部 agent 单列、不上帕累托图;cost 未知的
成绩不上图、同分排后;每行标重放核验状态 —— `verify.json` 按局记文件名与指纹(成绩 + 日志的 sha256),现在的每一局
都核过、通过、指纹未变才算「已核验」,否则如实标「核验不一致 / 核验已过期 / 未核验」(核验后重跑或替换了成绩,局数
不变也会被发现);题集不同的运行 score 不可直接比,另给每题 × 每次运行的 success 率矩阵,行按「题 + 版本」分,
列头带运行 id。
种子数不少于 3;报告里写明种子与方差,单局结论不作数。

## 7. Runner

`apps/agent-pal/bench/`(纯 node,无新依赖优先):

```
bench run  --model <provider:model> [--tier B] [--tasks a,b] [--seeds 42,43] [--jobs N] [--wall s] [--out bench/out/<runId>]
bench score bench/out/<runId>             # 汇总成 summary.json + 表格(M1 已实现)
bench check [id...] [--write-par]         # 参考解回放验题;--write-par 把到达步数写成 par(M0/M1)
bench state --task <id> [--seed N] [--steps f] [--observe]   # 出题辅助(M0)
bench verify bench/out/<runId> [或其中一局的 .jsonl]   # 重放核验,写 verify.json(§8,M2 已实现)
bench board [runDir...] [--out f.html]       # 排行页:多次运行汇总成自包含 HTML(§6,M2 已实现)
```

`<provider:model>`:`ollama:` / `openai:` / `anthropic:` / `gemini:`(内置循环)、`replay:<task>`(按参考解出招,零成本验链路)、
`claude-cli:<model>`(外部 agent,§7.2)。产物:`run.json`(模型、档位、题与种子、代码 commit、提示版本)、
`episodes/<task>__s<seed>.json`(每局结果)/ `.jsonl`(逐步日志:start / turn / call / end)、`summary.json`。
已完成的局跳过,`run` 可续跑。续跑前核对 `run.json` 的冻结元数据:模型、档位、提示版本、代码版本、题目 / 题目版本 / 种子
任何一项和这次不同就拒绝(列出差异),免得两套配置的局混进同一张 summary。代码版本 = HEAD + 整个工作区是否有改动
(`-dirty`;引擎等其他包的改动也算),本次运行的输出目录不算改动。

每一局:新子进程起 agent-pal(`--seed`,独立存档目录与空地图记忆)→ 按题目 `start` 进到起点 →
把 `brief` + 档位工具清单交给模型 → 循环「模型出一次工具调用 → 执行 → 记日志 → 求 goal / fail / stuck / 预算」→
终止时写 `result.json`(指标 + 终局状态视图 + 版本信息)。

### 7.1 内置循环(正式成绩)

runner 自带一个最小 tool-calling 循环,按 provider 适配(Anthropic、OpenAI、Gemini、OpenAI 兼容的本地模型):
**同一份系统提示**(以 `play-prompt.txt` 为底,按档位裁剪工具说明)、同一份工具 schema、每轮如实累计 usage。
上下文管理也统一(历史超长时按固定规则截断 / 摘要),不让各家框架的记忆技巧混进成绩。

M1 的实现(`bench/loop.mjs` · `prompt.mjs` · `providers.mjs`):第一条用户消息 = `brief` + 开局 observe;
上下文规则 = **只保留最近 6 条工具结果的全文**,更早的换成一句「已省略,需要时 observe」,模型自己的文字与调用全留;
模型只回文字不调工具时提醒一次,连续 4 轮就判 `agent-stopped`;provider 出错(重试后)判 `provider-error`。
价格只认 `bench/prices.json` 里写明的,未知价整局 cost 记 `null`、不当 0。
`prices.json` 现登记 Anthropic / OpenAI / Gemini 的官方标价(`_sources` 记来源页与核对日期,2026-10-08 核对):
一个模型一个固定价,分档价取基础档(长上下文加价、Haiku 5.5 超 100K 提示加价都不计 —— bench 每轮约 7–9k token);
提示缓存按各家缓存价计:`tokensIn` 是全部输入(含缓存读写),其中缓存读 / 写的部分按价目表的 `cacheRead` / `cacheWrite`(没登记的按输入价,即上限)。OpenAI / Gemini 隐式缓存、无写入费;Anthropic 适配器打两个显式断点 —— 系统提示(连同工具定义)和最后一条已省略的工具结果(省略后不再变,每轮后移约 2 个位置,在 20 位回看窗口内);末尾的全文观察每轮都会被省略规则改写,不打断点(写了也读不到)。每局结果另记 `tokensCached` / `tokensCacheWrite`。设了 `BENCH_*_BASE_URL` 地址覆盖(代理 / 兼容服务)时,那家的 cost 记 `null`,不套官方价。价格会变:发布成绩时冻结本文件版本。

Anthropic 有两种上下文模式。默认 `anthropic:<model>`:循环在客户端按上面的规则截断,回传只带文字与工具调用 —— **思考块不回传**(Opus 5.5、Sonnet 5.5、Fable 5.1 等新模型思考常开,而思考块绑定它之前的历史,客户端截断会让它失效,新账号直接 400)。`anthropic:<model>?context=server`:同一条规则(只留最近 6 条工具结果全文)改由服务端 context editing(`clear_tool_uses_20250919`,beta `context-management-2025-06-27`)执行;服务端清理不算改历史,历史原样回传、思考块随轮保留。两者的占位文字与清理时机略有不同,模型串不同,成绩分开记、不混比 —— 先对比两种模式的成绩与花费,再决定默认用哪个。

M3 加 `gemini:<model>`(Gemini API v1beta `generateContent`,`GEMINI_API_KEY`,`BENCH_GEMINI_BASE_URL` 可覆盖):
同一份系统提示与工具,工具 schema 裁成 Gemini 认的 OpenAPI 子集(去掉 `additionalProperties` / `default` 等;
无参工具不带 `parameters`);思考型模型 functionCall 上的 `thoughtSignature` 随历史原样回传;
usage 的思考 token(`thoughtsTokenCount`)按输出计入 `tokensOut`。价目表未登记 Gemini 价格 → cost 记 `null`。

### 7.2 外部 agent(非正式)

任何 MCP 客户端(如 Claude Code)也能直接连 agent-pal 玩同一题,runner 只负责起点、判分与重放核验;
但 token / 成本拿不到准数、提示词也不统一 —— 成绩**单列为「外部 agent」**,不进主榜。

M1 的实现(`claude-cli:<model>`,`bench/mcp-episode.mjs`):runner 先起本局 MCP 服务(HTTP,127.0.0.1 随机端口)
开机到起点,再起 `claude -p`,第一条消息与系统提示和内置循环**逐字相同**;只挂这一个 MCP 服务、关掉内置工具、
不读任何设置、不落会话。判分 / 卡死,以及**调用次数与虚拟时间**预算仍由同一个 episode 判;到点后工具只回「已结束」,
另有墙钟上限 `--wall`。token 与成本取 claude 自己 `result` 事件里的 `usage` / `total_cost_usd`(含缓存读写;
订阅登录时是按目录价折算的名义成本)—— 这个数要等 claude 退出后才拿得到,局中无法据此截断,所以**外部 agent 的
token / 成本只记录、不计入 success 判定**;与内置循环的成绩口径不同,这也是它单列、不进主榜的原因之一。
同一个服务不带 `--http` 时走 stdio,任何 MCP 客户端都能直接挂(开局观察放进 initialize 的 instructions)。

## 8. 可复现与防作弊

- **重放核验**:日志里的工具调用序列在同种子、同存档下重放,终局 goal 必须仍为真(`golden from-run` 的同一机制)。
  提交的成绩不靠信任,靠重放。

  M2 的实现(`bench verify <runDir | 某局 .jsonl>`,`bench/verify.mjs`):新子进程按日志 `start` 里的题、种子、档位
  重开一局(同一个 `createEpisode`,起点一样),把 `call` 事件按原顺序原参数再打一遍,三方对照:
  1. 每次调用后的判分快照(调用名、ok、场景、坐标、模式、虚拟时间、goal、milestones、终止原因)—— 只报第一处分歧;
  2. 终局(success / successAt、fail、stuck、crashed、milestones、调用数、无效调用数、虚拟时间、progress);
  3. 登记的成绩 `episodes/<x>.json`(score 读的就是它)必须与日志的 `end` 逐项一致,含题、题目版本、种子、档位、终止原因
     (score 按题分组、按种子取 par、统计终止原因)—— 改了成绩文件会被发现。

  终止原因只比 episode 自己判的(成功 / 失败条件 / 崩溃 / 卡死 / 调用与虚拟时间预算);token 预算、模型自己停、
  provider 出错、墙钟、客户端出错来自模型侧,重放里没有模型,不比;token / 成本也不在重放范围内。
  判定:`verified` / `mismatch` / `unverifiable`(题目版本已变)/ `no-log`(没开局就崩:不声称成功即可)/ `error`(重放子进程出错)。
  代码版本与 `run.json` 不同只提示 —— 引擎行为若真变了,对照会自己失败。整次运行的结果写 `<runDir>/verify.json`,
  有不一致就非零退出。资产指纹尚未记录(见下条)。
- **版本冻结**:`result.json` 记 bench 版本、题目版本、agent-pal / 引擎 commit、价目表版本、**资产指纹**
  (各 `.MKF` 等数据文件的哈希 —— 不同版本的游戏数据不可比)。
- **只在确定性模式下录**:非 `--seed` 模式录的会话重放会大面积落空(黄金场景 `llm-opening-long` 已演示:约一半
  寻路 / 交互因 NPC 时机不同而落空),不能作为成绩。

### 8.1 闭卷测验(训练数据污染检测)

`tier B`「不给攻略」去不掉模型训练时记住的东西,所以单独量「它记得多少」:`bench quiz --model <spec>` 不开游戏、
不给工具,按 `bench/quiz/<task>.json`(每题 3–5 问,问该题需要、但游戏不会马上告诉你的知识:下一步、找谁、
东西在哪、谜底)单轮提问,每问独立。答案只判「答案:」那一行;关键词判分(每组至少命中一个、简繁都收),
互斥选项带 `reject`(两头押算错),明说不知道 / 不确定一律算错 —— 不用模型当裁判。

读法:与同一模型的游戏成绩并排 —— 测验高、游戏低 = 记得却用不上;测验低、游戏高 = 靠现场推理而不是背攻略;
再看 B / C 档差距(有攻略后好了多少)。首测(提示 v2,61 问):claude sonnet 20%(压轴题那 5 问 0/5),
qwen2.5:3b 0%(几乎全答「不知道」)。题目与答案用自己的话写,不搬攻略原文。

## 9. 题库

第一批(M0/M1)3 道 + 第二批(M2)8 道 + 压轴题 1 道 + 补回 2 道 + 挑战题 2 道 = 16 道,全部有参考解且在 3 颗种子上判为成功(`bench check`);
出题时先读攻略定剧情位置、再扫经典存档的起点状态,题面只说「要达成什么」不说步骤,攻略文本不进仓库。

| 题 | 起点 | 难度 | 主要考 | par |
|---|---|---|---|---|
| `opening-serve-dishes` | 新游戏 | 1 | 从对白推断任务、多场景跑腿 | 36–58 |
| `wine-to-drunk-taoist` | 新游戏 | 2 | 多步剧情、用物品、面朝目标 | 42–64 |
| `classic08-leave-area` | 08 | 2 | 部分可观测下找出口(上下两层互通) | 1(参考解知道坐标,par 不代表难度) |
| `classic10-baihe-medicine` | 10 | 2 | 按药方凑三味药:采果、借钓竿钓鱼、在鹿的固定逃跑路线上放捕兽夹 | 40 |
| `classic16-guiyin-altar` | 16 | 3 | 山洞网络里找对的路(洞 74 → 73),路上有挡道的怪 | 20 |
| `classic19-yangzhou-night` | 19 | 2 | 进城投宿:隔着柜台跟掌柜说话、先开房门 | 13 |
| `classic19-yangzhou-gourd` | 19 | 3 | 扬州长链:夜里追女飞贼夺回布包 → 被失主怀疑 → 打听寡妇姬三娘 → 城墙上看她往井里丢东西 → 下井找到紫金葫芦 → 被押上公堂 | 74 |
| `classic28-tower-gate` | 28 | 3 | 锁妖塔:放出酒坛里的天鬼皇、让它破开铜门 | 67–69 |
| `classic28-tower-chain` | 28 | 3 | 锁妖塔完整链:铜门 → 先听沉思鬼的问题 → 书中仙给天书 → 回去答复、穿过它把守的通道 | 112–115 |
| `classic31-banana-monkeys` | 31 | 2 | 摘香蕉、在树洞迷宫里喂第一只小猴让路 | 22 |
| `classic40-phoenix-handkerchief` | 40 | 1 | 回到十年前,在山神庙接下老婆婆的信物 | 9 |
| `classic40-water-orb` | 40 | 3 | 长链:信物交给码头船商、买木剑、等巡逻的秀兰、开箱、跟小逍遥换水灵珠 | 83(其中约 42 次是等秀兰巡逻到身边) |
| `classic48-rain-orbs` | 48 | 2 | 空间谜题:圣灵珠放石碑、五灵珠各归其位(石碑文字只给出一半方位) | 7 |
| `pal-ch1-meet-linger-hardcore` | 新游戏 | 4 | 压轴题的一条命挑战:不许逃、不能存读档、输一场或有人倒下即失败 —— 走廊每场都得打,靠每场前回满血过关 | 102–123 |
| `pal-ch1-island-hardcore` | 岛上存档 | 4 | 同一条命规则,但从刚登上仙灵岛开始:只考走廊血量管理 + 荷叶迷阵 + 仙灵洞天,不再被前面的剧情卡点吃预算 | 30–33 |

**已补回**:锁妖塔完整链(#53 修好寻路后,par 从「只到铜门就 103」降到全链 107–113)、扬州取回紫金葫芦(#48 修好女飞贼剧情战卡死)。
**仍暂缓**:凤凰巢全程(两层传送迷宫,参考解 250+ 步)、战斗题(经典存档 02–51 数值全被改过,战斗没有压力;压轴题的新游戏起点已覆盖 Lv1 战斗)。

**压轴题** `pal-ch1-meet-linger`(新游戏 → 仙灵岛见到灵儿,攻略第 1–2 章;对标 agent-wow「通关新手村」):
开场跑腿 → 醉道士 → 婶婶给钱去买虾、在市集听说仙灵岛有仙女 → 婶婶病倒、得知岛上有仙药 → 苗人头领给破天锤 →
张四的船上岛 → 荷叶迷阵打碎六尊石像 → 踩发光地板进仙灵洞天 → 浴池边遇见那位少女。难度 3,par 100–126,预算 380 次调用。
14 个 milestone 都是剧情脚本里的必经节点(失败局也有细粒度的分);新游戏 Lv1 —— 岛上走廊的四队妖怪里有一队打不过,
要赢三队、逃一队(逃跑看随机、失败会掉血),是题库里唯一战斗与资源真有压力的题。

## 10. 版权与发布

- 游戏数据、攻略文本、全图都是第三方作品,**不进仓库、不随基准发布**(与 agent-pal 的 `guide` / `atlas` 现行做法一致)。
- 因此本基准定位为**内部 / 私有基准**:参与者自备同一版本的游戏数据,资产指纹(§8)保证版本一致;
  对外只发布题目元数据、成绩与可重放日志(日志不含资产内容)。
- C 档成绩额外注明所用攻略 / 全图的来源版本。

## 11. 与 aigg-world 的接点

「效率」可以直接以 **GCC / 推理花费**计量:模型经 ai.gg 的计价推理调用时,一局的成本就是它烧掉的 GCC ——
这正是「游戏作为 GCC 消耗 demo」的方向。M3 之后可加一档「经 ai.gg 推理」的成绩,用同一价目口径。

## 12. 里程碑

| 里程碑 | 内容 | 判据 |
|---|---|---|
| **M0** ✅ | StateView + 谓词求值 + 题目 schema + `bench state`;3 道题 + 参考解 | 参考解重放全部判为成功(3 题 × 3 种子 = 9/9) |
| **M1** ✅ | `bench run` 内置循环(2 家 provider)+ 预算 / stuck / 日志 + `bench score` | 两个模型在 3 题 × 3 种子上出完整 summary |
| **M2** | 题库扩到 8–10 题 ✅(11 题);`bench verify` ✅;排行页(success × cost)✅ | 每条成绩都能重放核验 |
| **M3** | A 像素档(管道 ✅,尚无题开放 A);更多 provider(Gemini ✅);外部 agent 通道;可选 ai.gg 计价 | 三档各有成绩 |

## 12.1 M0 的实测结论

- **起点必须与录参考解时逐字一致**:harness 起点 = 开机 settle + 标题画面的 choose 工具调用,**不再额外 settle**。
  多推进一点虚拟时间就会让 NPC 时机变化,录好的步骤落空(实测踩过)。
- **参考解按种子给**(`bySeed`):一条轨迹只保证在录它的那颗种子上可重放;开场两题用 LLM `--seed 1/2/3` 实玩的
  三条黄金轨迹各当一颗种子的参考解。
- **milestone 别挑开场就满足的**:李大娘在开场动画里就说话,「和李大娘说过话」会在第 0 步命中 —— 已删。
- **参考解证明可解,不代表难度**:`classic08-leave-area` 的参考解只要 1 次 `walk_to`(作者知道出口坐标),
  模型要先探出出口在哪(从起点 observe 看不到)。M1 可把参考解步数记成 par,作效率的参照。
- 对白历史按引用跟踪、不调 observe,判分不吃掉模型要看的「新文字」。

## 12.2 M1 的实测结论

- **预算 ≥ 3 × par**:开场题原预算 60 次调用,而参考解自己就要 47–58 步 —— 模型几乎没有探索余地,首轮 claude 全部
  耗尽或放弃。规则改为 `budget.toolCalls ≥ 3 × max(par)`(par 很小的探索题保留原预算下限),由 `test:bench` 守住;
  开场两题升 v2(174 / 192 次,token 预算同比放大)。
- **token 预算不能先于调用预算触发**:内置循环每轮都重发上下文(保留 6 条观察),实测每次调用 7–9k token;
  原先按 ~3k / 次定的 token 预算让 qwen 在 classic08 上 39 次调用就因 token 耗尽结束。规则改为
  `budget.tokens ≥ 12000 × budget.toolCalls`(test:bench 守住),三题升版本。外部通道不按 token 截断(只记录,见 §7.2)。
- **题面要说清「什么不算完成」**:`classic08` v1 写「走到任何一个新的地方」,claude 走进同一区域的另一层(场景 38)就宣布完成。
  v2 点名 35 / 38 都属本区域;提示词同时写明「完成由裁判判定,没看到 TASK COMPLETE 就继续」。
- **确定性模式下别用 setTimeout 做收尾**:引擎把计时器接到虚拟时钟,没人推进就永远不触发 —— MCP 服务收到信号后直接退出。
- **对白不能读引擎的 20 条滚动窗口**:dialogService 的 history 只留最近 20 条,一次 `advance` 连推完开场苗人过场(20+ 行)时,
  最早几行在被读到之前就滚掉了 —— 模型看到的过场从半句开始,`textSeen` 判据也可能漏判。agent-pal 现在订阅 history 增量,
  收进无上限的 `e.dialogLog`,observe 与 StateView 都读它。
- Ollama 的 OpenAI 兼容端点拒收 `content: null` 的 assistant 消息(带 tool_calls 时也一样),用空串。

## 12.3 M1 首批成绩(代码 f89acf2,tier B,3 题 × 3 种子)

| 模型 | 通道 | score | progress | 成功局调用数(中位) | cost / success | 总成本 |
|---|---|---|---|---|---|---|
| claude sonnet | 外部(claude CLI) | **100%**(9/9) | 1.00 | classic08 23 · 开场 121 · 醉道士 120 | $0.85 | $7.61 |
| qwen2.5:3b | 内置循环(Ollama) | 0%(0/9) | 0.17 | – | – | 本地 |

- 两个模型拉得开:3B 模型多半几步内自行放弃或原地打转被判卡死,无效调用率 23–48%(claude 约 13–15%);
  progress 仍有区分度(qwen 在 classic08 上都到过上层 = 0.5)。
- **成绩依赖接口版本**:同一模型同一题,rebase 到 main(#22 压缩了 observe)前后 classic08 的调用数从 7 → 8~30。
  observe / 工具的改动会改变难度,成绩必须带代码 commit(run.json 已记),跨版本不可直接比。
- 种子对开场一段几乎没影响(新代码上 seed 2 与 seed 3 的参考解虚拟时间逐毫秒相同):3 颗种子不等于 3 个独立样本,
  M2 扩题时优先用不同存档 / 不同题,而不是加种子。

## 12.4 M2 出题的实测结论

- **经典存档 02–51 全被改过**:约 1677 万钱、Lv85+、背包 20–140 件;只有 01(游戏开始)是原始数值。谜题本身完好
  (关键物品都不在起始背包里),但战斗与资源没有压力 —— 战斗题暂缓。
- **参考解会被 main 的行为改动弄坏,而且没人发现**:一天之内 main 的寻路(#20 / #22 / #29)、怪物成为实体、
  `mode` / `settle` 改读等待栈(#44)先后让参考解失效 4 次;纯 main 上 seed 2 的参考解就坏过。CI 不跑 `bench check`(要资产)。
  对策:合任何改 agent-pal 行为的 PR 前在本机跑 `bench check` + `golden.mjs verify --semantic`;最好加一个本机定时任务。
- **对时间敏感的步骤最脆**:等巡逻 NPC(秀兰)、按固定路线逃跑的鹿、会主动撞上来的怪 —— 这些参考解要按种子给(`bySeed`),
  引擎时序一改就要重推。
- **导航缺陷会冒充难度**:锁妖塔参考解近一半步数是在绕 `walk_to` 的缺陷(怪的触碰区当墙、报「不连通」),题目因此缩短到铜门为止。
  出题时遇到「工具不让做、但游戏能做」的情况,先修工具再出题,别让成绩测到工具缺陷。
  同类:`interact` 追不上巡逻中的 NPC,只能反复 `wait` 再试(水灵珠题 par 里约一半是等秀兰),值得让 interact 等目标停下。

## 12.5 压轴题与闭卷测验成绩(claude sonnet,外部通道)

压轴题 `pal-ch1-meet-linger`,3 颗种子,预算 380 次调用:

| | B 档(无攻略,代码 c2334cc) | C 档(攻略 + 全图,代码 6b059aa) |
|---|---|---|
| success | 0/3 | **1/3**(seed 2,335 次调用、$9.12 —— 首个通关) |
| progress 均值 | 0.44 | **0.69** |
| 上了仙灵岛 | 1/3 | **3/3** |
| 结束原因 | 预算耗尽 ×2、团灭 ×1 | 团灭 ×2、成功 ×1 |
| 总成本 | $27.25 | $18.48 |

闭卷测验(提示 v2,61 问):claude sonnet **20%**(压轴题那 5 问 **0/5**),qwen2.5:3b 0%。

- **卡点一:跑腿结束后不知道回厨房找婶婶。** B 档用了 120–200 次调用,C 档查一次攻略、约 5 次就过。
- **卡点二:市集的触碰触发对白。** 水生叔的话要走过他身边才触发,模型挨个 `interact` 试不出来;攻略只说「问他」,所以 C 档也要 100+ 次。
- **卡点三:Lv1 走廊的第四队妖怪。** 攻略不讲要逃;B / C 档共 3 局在这里对它开 `battle(auto)` 被团灭 —— 没看敌方阵容与自己的血量。
  唯一通关的那局也是 auto 打过去的。§12.6 的重新评估表明:走廊里根本不升级,输赢取决于每场前的血量。
- **记得 ≠ 做到**:测验里压轴题 0/5,而 B 档的进度停在的正是那几个剧情节点 —— 没有攻略时的进度来自现场推理,
  B / C 差距(0.44 → 0.69)量的是「推理」与「查到」之差。tier C 的 #83 之前的成绩无效(guide / atlas 当时没接上,等于 B 档)。

## 12.6 走廊难度重新评估与一条命挑战题

压轴题岛上走廊(场景 16)按三颗种子各跑两种不逃的打法(参考解前缀到进走廊,之后只 `battle auto` / 每场前用药回满再 auto):

| 种子 | 只 auto | 回到 80% 再 auto | 回满再 auto |
|---|---|---|---|
| 1 | 3 场全胜,过 | 过 | 过 |
| 2 | 4 场全胜,过 | 过 | 过 |
| 3 | 第 3 场输(102/150 进场) | 第 3 场输(127/150) | **过**(150/150 进场,打完剩 93) |

- **出题时的前提「Lv1 打不过第四队」是错的**:三颗种子都能不逃打穿;每场经验太少,走廊里一直是 Lv1,#68 与此无关。
- **真正的难点是血量管理**:进场前没回满就可能输。模型实战的 3 局团灭都是「受伤了还连续 auto」。基础压轴题的参考解靠逃跑过这一关。

**一条命挑战题** `pal-ch1-meet-linger-hardcore`:起点、goal、milestones 同压轴题,另加规则 ——
`fail = any[partyWiped, memberDown, battleFled]`(输一场 / 有人倒下 / 逃跑即失败),`disallowTools = [save, load, list_saves]`
(不能存读档刷血)。参考解 = 基础参考解的前缀 + 走廊「每场前回满再 auto」+ 基础参考解出走廊后的部分,三颗种子都过,
par 123 / 104 / 111,用掉 2–3 个回血物品。考的是:必打的战斗前会不会看血量、会不会把有限的药 / 食物用在刀刃上。
框架支持:原子谓词 `battleFled` / `memberDown`,题目字段 `disallowTools`(episode 按题过滤工具;test:bench 要求挑战题的参考解不用被禁的工具、不逃)。

## 12.7 一条命挑战题首批成绩(claude sonnet,外部通道,代码 e6f4bbe)

`pal-ch1-meet-linger-hardcore` × 3 颗种子,预算 380 次调用:**0/3,progress 0.58,$26.59**,三局都是预算耗尽,**0 次团灭、0 次逃跑**。

| 种子 | 里程碑 | 走廊 |
|---|---|---|
| 1 | 8/14 | 进走廊,手动打赢 3 场,102/150 时用气疗术回血,第 4 场打到一半预算耗尽 |
| 2 | **11/14** | 上岛前先去武器店换装备;走廊 4 场全胜,108/150 时用止血草;过走廊、打碎 3 尊石像 |
| 3 | 7/14 | 拿到破天锤,没来得及上船 |

- **规则写进题面后打法变了**:压轴题(普通规则)里它一路 `battle(auto)`、不看血量,3 局在走廊团灭;
  挑战题里它改成手动点名攻击、受伤就用药 / 仙术回血,还会先换装备 —— 「战斗前不看血量」是默认不当回事,不是不会。
- **谨慎要花调用**:手动攻击每一下算一次调用(一场 4–6 次,auto 只要 1 次),加上剧情卡点(回厨房找婶婶、市集触碰触发)
  照旧吃掉几十到上百次,380 次不够。挑战题的预算是按参考解 par(走廊里用 auto)× 3 定的;
  要不要给挑战题单独放宽预算,还是让「谨慎打 + 省调用」都算难度,待定(§13)。

## 12.8 岛上起点的一条命挑战题

§12.7 三局都是预算耗尽,而且大半预算花在上岛前的剧情卡点上 —— 一条命的规则只在走廊里才真正起作用,
新游戏起点把「会不会管血量」和「剧情卡点找不找得到」混在一起考了。`pal-ch1-island-hardcore` 把起点挪到刚上岛:

- **起点存档** `bench/saves/pal-ch1-island.saves.json.gz`:压轴题 seed 2 的参考解回放到进走廊前(场景 15,控制模式),
  存槽 1。题目 `start: { saves, slot: 1 }`,harness 走标题画面「读档 → 槽 1」进场,不算模型步数。
  选 seed 2 的存档是因为它带的回血物资最少(糯米糕、水果各一):三场之后就没有药 / 食物,只剩仙术,余量最紧。
  三个存档点 × 三颗种子共 9 种组合都试过,全部能一条命打通(参考解长 30–34)。
- **规则同 §12.6**:`fail = any[partyWiped, memberDown, battleFled]`,禁存读档。goal 同压轴题;
  milestones 7 个(进走廊 → 荷叶迷阵 → 石像 1 / 3 / 6 → 仙灵洞天 → 衣裳)。
- **par 31 / 33 / 30,预算 105 次调用**(≥ 3 × par)。手动打法每场多花 4–6 次调用,预算里留了余地,但不再有几百次可挥霍。
- 测验 3 问(少女的名字、几尊石像、走廊怎么不输)。题面会说出「破天锤」,所以不再问它。
- 框架:`start.saves` 只收 `bench/saves/` 下的文件名(不带目录);test:bench 检查引用的存档在库、槽位有档。
  存档字节随存档格式变:引擎改了存档里的字段时要重生成这份存档、再跑 `bench check`(与黄金基线同理)。

## 12.9 岛上挑战题首批成绩(claude sonnet,外部通道,代码 7e83dc8,提示 v3)

`pal-ch1-island-hardcore` × 3 颗种子,预算 105 次调用:**2/3,progress 0.71,$1.42**(成功局中位 86.5 次调用,par 30–33)。
同一模型在新游戏起点的挑战题上是 0/3、$26.59(§12.7)—— 起点挪到岛上后,预算不再被上岛前的剧情卡点吃掉,输赢只看走廊和迷阵。

| 种子 | 结果 | 调用 | 走廊 |
|---|---|---|---|
| 1 | ✓ | 77 | 4 场连续 `battle(auto)`、中间不回血,全赢(运气);打完才用气疗术 91→150 |
| 2 | ✗ 第 11 次调用失败 | 11 | 同样 4 场连续 auto 不回血,第 4 场(三只妖的一队)输 |
| 3 | ✓ | 96 | 第 2、3 场后各用一次气疗术回满(114→150、99→150),4 场全胜 |

- **失败的原因正是这题要考的**:两局都是「受伤了还连续 auto」,seed 1 侥幸、seed 2 输掉;只有 seed 3 每场前回满,与参考解同一打法。
  这和闭卷测验一致:「走廊里怎么才能每场都赢」sonnet 答不出(测验 2/3,记得少女是赵灵儿、六尊石像)。
- **回血手段比参考解好**:参考解吃掉糯米糕、水果;sonnet 用气疗术(每次 6 MP),一个物品没动。
- **过了走廊就顺**:两局成功局的荷叶迷阵都敲完六尊石像、找到仙灵洞天。无效调用 28%,大半是迷阵里 `walk_to` 到不连通的格子
  (16 次「no path」、8 次「blocked」)和隔着障碍 `interact`;寻路提示还有改进空间。
- **样本小**:3 局,67% 的误差很大;要下结论得多跑种子或多个模型。外部通道不按 token 截断(seed 3 用了 243 万,超过题目的 126 万),只记录。

## 13. 待定

- 挑战题的预算:按参考解 par × 3 定,但谨慎打法(手动攻击、回血)天然更费调用;是否单独放宽(§12.7)。
- 上下文截断 / 摘要的统一规则(太宽松会奖励长上下文模型,太紧会冤枉它们)。
- stuck 阈值 K 与预算的默认值,需要先跑一轮看分布再定。
- 确定性的残余:`determinism-check` 覆盖的路径之外(商店、某些脚本)是否都稳 —— M0 用参考解多种子重放来查。
- 题目泄漏:题面与参考解若公开,后续模型可能学到 —— 保留一部分题只在私下跑。


## 2026-10-14：拜月单战正式资源题

已加入四题：`baiyue-single-origin`、`baiyue-single-mana-budget`、`baiyue-single-sustain-no-wine`、`baiyue-single-fragile-stocked`。全部B档，固定种子42/43/44。存档来自本次通关slot4的干净副本；资源修改保持剧情和敌方配置不变。

题目可用 `start.setup` 指定裁判的 walk_to/advance/wait 准备步骤，用 `start.expect`核对交接状态。准备流程由check/state/run/verify共用，模型调用与虚拟时间预算从首次战斗决策起算。`battlePolicy`限制动作和逃跑法术，约束在服务端执行。

`scoring: {"secondary":"battleRounds"}`声明成功率优先、成功局平均战斗回合数其次；旧题继续成本口径，混合题集只按成功率排序，各口径分区展示。StateView记录进行中战斗、实际编队和初始/召唤敌人对象，`battleWon.enemyObject`限定拜月身份。最终获胜必须为整个战斗的won，倒地复活合法。

回合数按原生SelectAction→PerformAction开始结算计数；不能由工具数推算，不能在已经结算的毒伤终轮额外+1。回合进入episode结果、summary、逐步日志与verify。任务、存档、运行时/资产及评分元数据以指纹冻结，成绩身份必须与日志起点、终点及重放结果一致。

资源明细、操作命令和全链路测试见 `apps/agent-pal/bench/README.md` 的“拜月单战资源规划题”。本次参考解验证可解，不作为最优回合数或模型成功率结论。
