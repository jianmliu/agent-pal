# agent-pal-bench 使用说明

让不同的 AI 玩经典《仙剑奇侠传》(1995 DOS 版)的指定任务,比成功率与花费。设计与口径见
[docs/specs/agent-pal-bench.md](../../../docs/specs/agent-pal-bench.md);本文只讲怎么用。

所有命令都从仓库根目录跑,入口是 `node apps/agent-pal/bench/bench.mjs <子命令>`(下文简写为 `bench`)。
结果默认写在 `apps/agent-pal/bench/out/`(跟着脚本位置走,与当前目录无关;下文简写为 `out/`)。

## 准备

| 需要 | 说明 |
|---|---|
| 游戏资产 | `PAL_ASSET_DIR` 指向游戏数据目录;不设则找 `apps/pal-playground/public/pal-assets`(或 `dist/pal-assets`) |
| 经典存档 | 从经典存档开局的题(`start.rpg`)要 `AGENT_PAL_CLASSIC_SAVES` 指向放 `01.rpg`…`51.rpg` 的目录;新游戏开局、仓库自带存档开局(`start.saves`,文件在 `saves/`)的题不需要 |
| 模型钥匙 | 见下面「模型」一节;`replay:` 与 `ollama:` 不需要 |
| 攻略与全图 | 只有 C 档要:`AGENT_PAL_GUIDE` 指向攻略 / 剧本文本,`AGENT_PAL_ATLAS_INDEX` 指向全图索引(见 [app README](../README.md));两样缺一样 C 档就拒绝开局 |

不需要资产的单元测试(CI 跑的就是它):`pnpm --filter @onchainpal/agent-pal test:bench`。

## 一次完整的跑分

```bash
bench validate                                     # 只校验题目格式(不起引擎)
bench check                                        # 每题每种子回放参考解,全部判为成功 = 题目可解
bench run --model anthropic:<model>                # 题 × 种子各一局,结果落 out/<runId>/,跑完自动打分
bench verify apps/agent-pal/bench/out/<runId>      # 按日志重放核验每局成绩,写 verify.json
bench board                                        # out/ 下所有运行汇总成排行页 out/board.html
```

先用 `bench run --model replay:<task> --tasks <task>` 跑一遍:它按参考解出招、不调模型、零成本,
`verify` 应当全部 verified —— 用来确认引擎、判分、核验整条链路在你的机器上是通的。

## 题目

`tasks/<id>.json` 是题目(起点、目标 / 里程碑 / 失败条件的谓词、预算、开放的档位),`reference/<id>.json` 是参考解
(一串工具调用)与 `par`(参考解在各种子上到达目标的调用数,打分时算效率用)。
参考解只能用模型在本题也拿得到的工具(开放的 B / C 档工具,扣掉 `disallowTools`;`grind`、`panorama` 这类不行),
否则 par 定得模型追不上:`bench check` 遇到就不回放、直接判失败,`test:bench` 也查。

| 题 | 内容 | 起点 | 档位 | par(各种子) | 调用预算 |
|---|---|---|---|---|---|
| `classic08-leave-area` | 经典存档 08:走出这片上下两层相连的区域 | 经典存档 08.rpg | B / C | 1 / 1 / 1 | 80 |
| `classic10-baihe-medicine` | 经典存档 10:白河村凑齐药材,换来六神丹 | 经典存档 10.rpg | B / C | 40 / 40 / 40 | 240 |
| `classic16-guiyin-altar` | 经典存档 16:穿过鬼阴山,找到鬼阴坛 | 经典存档 16.rpg | B / C | 20 / 20 / 20 | 80 |
| `classic19-yangzhou-gourd` | 经典存档 19:扬州城追查紫金葫芦 | 经典存档 19.rpg | B / C | 74 / 74 / 74 | 230 |
| `classic19-yangzhou-night` | 经典存档 19:在扬州客栈投宿,熬到半夜出事 | 经典存档 19.rpg | B / C | 13 / 13 / 13 | 80 |
| `classic28-tower-chain` | 经典存档 28:锁妖塔——借天鬼皇破铜门,替沉思鬼解惑后通过 | 经典存档 28.rpg | B / C | 114 / 115 / 109 | 345 |
| `classic28-tower-gate` | 经典存档 28:锁妖塔——请塔里的妖怪帮忙打开铜门 | 经典存档 28.rpg | B / C | 67 / 71 / 67 | 320 |
| `classic31-banana-monkeys` | 经典存档 31:让大树迷宫里挡路的小猴子让开 | 经典存档 31.rpg | B / C | 22 / 22 / 22 | 80 |
| `classic40-phoenix-handkerchief` | 经典存档 40:山神庙里受伤的老婆婆 | 经典存档 40.rpg | B / C | 9 / 9 / 9 | 80 |
| `classic40-water-orb` | 经典存档 40:十年前的余杭 —— 换回水灵珠 | 经典存档 40.rpg | B / C | 83 / 83 / 83 | 250 |
| `classic48-rain-orbs` | 经典存档 48:在祭坛安放宝珠,为大理祈雨 | 经典存档 48.rpg | B / C | 7 / 7 / 7 | 80 |
| `opening-serve-dishes` | 开场跑腿:把酒菜端给客栈里的两位苗人客人 | 新游戏 | B / C | 58 / 36 / 47 | 174 |
| `pal-final-preboss-reserve` | 王宫侍卫→树妖，保留隐蛊、三份酒和乾坤资金（单种子试题） | 通关分支战前独立存档 | B | 35 | 180 |
| `pal-ch1-corridor` | 初见灵儿难度梯度：从仙灵岛走廊到遇见少女 | 独立走廊入口存档 pal-ch1-corridor | B / C | 30 / 32 / 29 | 105 |
| `pal-ch1-island` | 初见灵儿难度梯度：从刚登上仙灵岛到遇见少女 | 岛上黄金存档 pal-ch1-island | B / C | 31 / 33 / 30 | 105 |
| `pal-ch1-island-hardcore` | 岛上挑战·一条命:从刚登上仙灵岛打到遇见那位少女(不逃、不存读档、不倒下) | 黄金存档 pal-ch1-island | B / C | 31 / 33 / 30 | 105 |
| `pal-ch1-meet-linger` | 压轴:从新游戏一路玩到仙灵岛遇见那位少女 | 新游戏 | B / C | 126 / 100 / 111 | 380 |
| `pal-ch1-meet-linger-hardcore` | 压轴挑战·一条命:同上,不逃、不存读档、不倒下 | 新游戏 | B / C | 123 / 102 / 111 | 380 |
| `wine-to-drunk-taoist` | 桂花酒送醉道士,引出十里坡之约 | 新游戏 | B / C | 64 / 42 / 53 | 192 |
| `baiyue-single-origin` | 拜月单战：原始资源 | 固定战前存档＋裁判开战 | B | 35 / 36 / 36 | 180 |
| `baiyue-single-mana-budget` | 拜月单战：现金紧张、补蓝充足 | 固定战前存档＋裁判开战 | B | 47 / 51 / 57 | 195 |
| `baiyue-single-sustain-no-wine` | 拜月单战：高等级、无酒神 | 固定战前存档＋裁判开战 | B | 45 / 47 / 42 | 180 |
| `baiyue-single-fragile-stocked` | 拜月单战：低等级、消耗品充足 | 固定战前存档＋裁判开战 | B | 38 / 38 / 35 | 180 |

表里的 par 与调用预算由 `test:bench` 对照 `tasks/` 与 `reference/` 核对(改了题或重录参考解要同步改表)。经典存档开局的题用种子 42 / 43 / 44,
新游戏开局的用 1 / 2 / 3。除了调用数,每题还有 token 与虚拟时间预算。

`pal-ch1-meet-linger`、`pal-ch1-island`、`pal-ch1-corridor` 共用初见灵儿的终点和普通规则，分别从新游戏、登岛、走廊起步。走廊入口存档是从登岛存档走过第一个出口、尚未接敌时另存的独立副本，原件不变；三颗种子的参考解均已回放成功。三题用来区分开场剧情与岛上探索的难度，不把一条命限制混入起点比较。它们作为不同题目列在成绩里，比较时应同时看每题成功率，避免把相近题重复计入不加说明的单一结论。

`pal-final-preboss-reserve` 从原通关分支的王宫战前槽位复制起步，要求侍卫、树妖两战结束后保留隐蛊、三份酒及至少 64,609 文；酒神、乾坤一掷、逃跑和自动战斗被禁用。参考解在种子 42 到达树妖胜后的剧情窗口，未进入拜月战。这是资源规划的单种子试题，不代表跨种子稳健性，也不等同侍卫→树妖→拜月全链任务；不同随机种子的参考策略仍需单独验证。原通关存档、录像与停止标记均不参与评测写入。

### 挑战题

挑战题是某道题的变体:起点、goal、milestones 不变,另加规则。`fail` 里用 `battleFled`(逃过战斗)、`memberDown`(有人倒下)
等原子谓词表达「做了就输」;`disallowTools` 把本题禁用的工具(如 `save` / `load`)从档位工具清单里去掉;`bench validate` 会核对这些名字确实是本题开放档位里的工具(写错名字不必等到开局才发现)。
挑战题的参考解也必须守规则(`test:bench` 会查)。例:`pal-ch1-meet-linger-hardcore`(一条命:不逃、不存读档、不倒下)。

### 出题

```bash
bench state --task <id> [--seed N] [--steps steps.json]           # 到起点(+ 若干步)后打印状态视图 JSON —— 从中挑判据
bench state --task <id> [--seed N] [--steps steps.json] --observe # 改为打印模型看到的 observe 文本 —— 用来规划参考解
bench check <id>                                                  # 回放参考解,每颗种子都要判为成功
bench check <id> --write-par                                      # 再把各种子到达目标的步数写回参考解的 par
```

起点(标题画面 → 读档 / 新游戏)由 harness 走完、不计入步数;每局独立子进程、独立存档、地图记忆不落盘。

## 档位

| 档 | 工具 | 模型看到的 |
|---|---|---|
| **A 像素** | `screenshot` · `press` · `wait` | 只有画面:每次调用的结果是成败 + 调用后的 640×400 截图,没有 observe 文字 |
| **B 结构化**(默认) | `observe` · `walk_to` · `step` · `interact` · `search` · `advance` · `choose` · `use_item` · `cast` · `battle` · `map` · `save` · `load` · `list_saves` · `press` · `wait` | observe 文本(模式、位置、队伍、新文字、附近物体) |
| **C 开卷** | B + `guide`(攻略 / 剧本)· `atlas`(全图) | 同 B,另可查攻略 |

`bench run --tier A|B|C` 选档,题目要在 `tiers` 里开放这一档才能跑。成绩按档分开排行,不跨档比较。
C 档的 `guide` / `atlas` 只查资料、不推进游戏,结果就是攻略文字或全图本身(全图作为图片附上),同样计入调用数。
C 档开跑时把所用攻略文件与全图(索引 + 每张图)的内容哈希记进 `run.json` 的 `books`;资料变了就不能续跑同一个运行目录,
排行榜的「代码」一栏下显示「资料 <id>」(悬停看各文件哈希),资料 id 不同的 C 档成绩不可直接比较。
**2026-10-08 之前跑出的 C 档成绩作废**:那时这两个工具没接上,调用一律返回「unknown tool」,等于没资料的 B 档。
**目前没有题开放 A 档**:哪些题在纯画面下公平可解要逐题判断,参考解也要另录(现有参考解是 B 档动作)。

`cast`(地图上施法,如战后用回复术回血)从提示 v3 起开放给 B / C 档。工具集变了,提示 v2 与 v3 的成绩不能直接比较:
续跑会因提示版本不同而拒绝,排行榜「代码」栏也标出提示版本。
## 模型

`--model <provider>:<model>`:

| 写法 | 需要 | 说明 |
|---|---|---|
| `anthropic:<model>` | `ANTHROPIC_API_KEY` | Anthropic Messages API。系统提示与已省略的旧结果上打提示缓存断点 |
| `anthropic:<model>?context=server` | 同上 | 上下文规则改由服务端执行,思考块随轮回传(见下) |
| `openai:<model>` | `OPENAI_API_KEY` | OpenAI Chat Completions(也可指向兼容服务,见下) |
| `gemini:<model>` | `GEMINI_API_KEY` | Gemini API(generateContent) |
| `ollama:<model>` | 本地 Ollama | 免钥,默认 `http://localhost:11434/v1`(`BENCH_OLLAMA_BASE_URL` 可改) |
| `replay:<task>` | — | 不调模型,按参考解出招:验证链路,零成本 |
| `claude-cli:<model>` | 本机装了 `claude` | **外部 agent**:`claude -p` 挂本局的 MCP 服务来玩;成绩标 external、单列,不进主榜 |

**外部 CLI 路径**:`claude:` / `codex:` / `agy:` 客户端依次找 `BENCH_CLAUDE_BIN` / `BENCH_CODEX_BIN` / `BENCH_AGY_BIN`、`~/.local/bin/<名字>`、(codex)macOS ChatGPT.app 自带的那份,最后用 PATH 里的同名命令。

**地址覆盖**:`BENCH_OPENAI_BASE_URL` / `BENCH_ANTHROPIC_BASE_URL` / `BENCH_GEMINI_BASE_URL` 可以把请求发到代理或兼容服务;
设了覆盖的那家,cost 记 `null`(请求不一定按官方价计费)。刻意不读 `ANTHROPIC_BASE_URL` —— Claude Code 会话里那个是它自己的端点。

**Anthropic 的两种上下文模式**:内置循环只保留最近 6 条工具结果的全文、更早的换成占位。默认模式在本地做这件事,
但新模型(Opus 5.5、Sonnet 5.5、Fable 5.1 等)的思考块绑定之前的历史,本地改写历史会让它们失效,所以只能不回传思考块;
`?context=server` 把同一条规则交给 Anthropic 服务端执行(不算改历史),思考块随轮保留。两种模式的模型串不同,成绩分开记。

## 跑分参数

```bash
bench run --model <spec> [--tier B] [--tasks a,b] [--seeds 42,43] [--jobs N] [--wall 1800] [--out 目录]
```

- `--tasks` / `--seeds` 不给就跑全部题、题目自己的全部种子;`--jobs` 并发局数(默认 1);`--wall` 每局墙钟上限秒数(默认 1800)。
- **续跑**:同一个 `--out` 再跑一次,已完成的局跳过。续跑前核对 `run.json` 里冻结的模型、档位、提示版本、代码版本、
  题目与种子,任何一项不同就拒绝 —— 换了配置请换个 `--out`。代码版本 = HEAD + 整个工作区有没有改动(`-dirty`)。
- 每局的终止原因:`success` / `fail-condition` / `crashed` / `stuck`(连续 20 次推进游戏的调用状态毫无变化;`screenshot` / `guide` / `atlas` 不计入) /
  `budget-toolCalls` / `budget-tokens` / `budget-virtualSeconds` / `agent-stopped`(模型连续 4 轮只说话不调工具) /
  `provider-error` / 外部 agent 的 `client-error`。

## 输出

```
out/<runId>/
  run.json                          本次运行的冻结元数据(续跑核对用)
  episodes/<task>__s<seed>.json     每局成绩(score 读的就是它)
  episodes/<task>__s<seed>.jsonl    每局逐步日志(start / turn / call / end),verify 按它重放
  episodes/<task>__s<seed>.stderr.log
  episodes/<task>__s<seed>.client.jsonl   外部 agent 的原始输出
  summary.json                      bench score 的汇总
  verify.json                       bench verify 的核验结果
out/board.html                      bench board 的排行页
```

`out/` 不进 git。

### 打分(`bench score <runDir>`)

每题:success 率、progress(成功 = 1;失败局 = 命中的里程碑 /(里程碑数 + 1))、成功局调用数中位数、par 效率、
无效调用率、token、cost。总分 = 各题 success 率的均值。传统题集同分比较成功局平均 cost；纯拜月题集同分比较成功局平均战斗回合数，成本仅作辅助。混合题集只按成功率排序，排行榜按评分口径分区。

### 花费

价格只认 `prices.json` 里登记的官方标价(Anthropic / OpenAI / Gemini,`_sources` 记来源页与核对日期);没登记的模型 cost 记 `null`,不当 0。
`tokensIn` 是全部输入(含缓存读写),其中缓存读 / 写的部分按各家缓存价算;每局另记 `tokensCached` / `tokensCacheWrite`。
一个模型只记一个价:分档计价取基础档(bench 每轮约 7–9k token,用不到高档)。价格会变,发布成绩时要冻结 `prices.json` 的版本。

### 核验(`bench verify <runDir | 某局 .jsonl>`)

新开一个子进程,按日志里的题、种子、档位重开一局,把模型当时的工具调用原样再打一遍,三方对照:每次调用后的判分快照、
终局、登记的成绩文件。每局的判定:

| 判定 | 含义 |
|---|---|
| `verified` | 全部对上 |
| `mismatch` | 有不一致(列出第一处分歧) |
| `unverifiable` | 题目版本已经变了;或 C 档本机的攻略 / 全图与 `run.json` 记的 `books` 不一致(含没配、旧运行没记) |
| `no-log` | 没开局就崩了,只要不声称成功即可 |
| `error` | 重放子进程出错 |

token 与成本不在重放范围内。代码版本和 `run.json` 不同只提示,不判失败。
核验 C 档要用跑分时的同一份资料:资料内容不进日志,换了资料重放照样能对上,所以先比指纹,对不上就不重放。

### 排行页(`bench board [runDir...] [--out f.html]`)

不给目录就汇总 `out/` 下全部运行。一个自包含的静态 HTML:按档位分开排;外部 agent 单列;success × cost 散点图
(虚线是帕累托前沿,cost 未知的不上图);每题 × 每次运行的 success 率矩阵(行按「题 + 版本」分,列头带运行 id)。

每行标核验状态:`已核验`(现在的每一局都核过、通过,且成绩与日志的指纹和核验时一致)/ `核验不一致` /
`核验已过期`(有局没核过,或核验后成绩被替换)/ `未核验`。重跑或替换了成绩,再跑一次 `bench verify` 就好。

## 闭卷测验(`bench quiz --model <spec>`)

不开游戏、不给工具,只问模型对这款游戏记得多少(训练数据污染检测,spec §8.1):

```bash
node apps/agent-pal/bench/bench.mjs quiz --model claude-cli:sonnet --jobs 6     # 或 anthropic: / openai: / gemini: / ollama:
```

- 题目:`bench/quiz/<task>.json`,每道 bench 题 3–5 问;`validate` 校验格式,`test:bench` 要求每道题都有测验。
- 判分:只判模型输出里「答案:」那一行;`accept` 每组至少命中一个关键词(简繁都收),含 `reject` 任一词、
  或明说不知道 / 不确定,都算错。不用模型当裁判。
- 输出:`bench/out/quiz-<model>-<时间>/quiz.json`(每题得分、每问的原答案与判定、token、cost)。
- 读法:与同一模型的游戏成绩、B / C 档差距并排看。

## 常见问题

- **cost 全是 `null`**:模型不在 `prices.json` 里,或者设了 `BENCH_*_BASE_URL` 覆盖。
- **续跑被拒**:`run.json` 的冻结元数据和这次不同(换了模型 / 档位 / 代码 / 题目),换个 `--out`。
- **排行页显示「核验已过期」**:核验之后又跑了局或替换了成绩;重新 `bench verify` 即可。
- **A 档跑不起来**:题目还没开放 A 档(`tiers` 里没有 `A`)。
- **外部 agent 的成本和内置循环不可比**:外部 agent 的 token / 成本由客户端自报、提示也不统一,所以单列、不进主榜。


## 拜月单战资源规划题（正式题库）

四题只开放 B 档；从固定战前存档由裁判完成 `start.setup`，确认 `start.expect` 后在三人归队、拜月HP32,760的首次战斗指令窗口交给模型。`check`、`state`、`run` 和 `verify` 共用准备流程。准备不计工具调用，虚拟时间预算从交接时起算。

| 题目后缀 | 李／灵／阿等级 | 现金 | 技能与资源变化 | 参考回合42／43／44 |
|---|---|---|---|---|
| `origin` | 46／42／45 | 64,609 | 原始库存与技能 | 12／12／14 |
| `mana-budget` | 46／42／45 | 45,000 | 灵葫3、雪莲4、仙芝2、天香3 | 16／23／21 |
| `sustain-no-wine` | 54／50／53 | 80,000 | 删除酒神；灵葫4、雪莲3、天香3、紫菁4 | 16／15／14 |
| `fragile-stocked` | 40／36／39 | 80,000 | 删除剑神与武神；灵葫6、雪莲4、天香6、紫菁6、金刚符6 | 13／13／12 |

未列出的物品与装备保留原档。等级按固定成长值同步调整血蓝、攻防、速度和经验，具体改动见各题的 `resourceConfig`；不声称是自然练级的随机结果。参考回合是可解性证据，不是最优解或模型成绩。

只提供 `observe`、`battle`、`advance`、`wait`。允许倒地复活；服务端拒绝 `auto`、`flee`、逃跑法术以及用 `referenceID` 绕过名称限制。存读档、移动、换装备和练级工具不开放。非法调用计调用数但不推进游戏。全灭、逃跑或异常结束终止本局；拜月HP归零但召唤物还活着时继续战斗。

四题使用 `owned-battle` 执行协议；一次battle调用包含非选择战斗对白的确认，并停在下一战斗指令窗口。所有战术动作仍由评测代理选择。

`battleRounds` 数的是实际动作队列开始结算的回合；最后一轮中途获胜计一轮，毒伤在轮末获胜不再额外加一。成功局缺失回合数时汇总显示未知，不能当0。胜后升级回血和现金奖励不参与回合评分。

### 跑四题

从仓库根目录执行：

```bash
baiyue_tasks=baiyue-single-origin,baiyue-single-mana-budget,baiyue-single-sustain-no-wine,baiyue-single-fragile-stocked
node apps/agent-pal/bench/bench.mjs run --model replay:auto --tasks "$baiyue_tasks" --jobs 4 --out apps/agent-pal/bench/out/baiyue-smoke
node apps/agent-pal/bench/bench.mjs verify apps/agent-pal/bench/out/baiyue-smoke
node apps/agent-pal/bench/bench.mjs board apps/agent-pal/bench/out/baiyue-smoke --out apps/agent-pal/bench/out/baiyue-smoke/board.html
```

`replay:auto` 按每局题目选择自己的参考解，可验证多题链路；原有 `replay:<task-id>` 仍指定一份参考解。正式比较模型时把 `--model` 换为已支持的 provider:model 并使用新的 `--out`。

新题的 `run.json` 冻结任务／存档指纹、实际Agent源码、Bench代码、引擎构建、Node版本和资产指纹；续跑配置不同则拒绝。`verify` 对照开局、准备步骤、逐步队伍与敌人状态、现金库存、随机数消耗、回合和结果身份。评分元数据也绑定到 `verify.json`：删改排序口径、题集或运行时后，排行榜显示核验过期。

### 全链路验收

```bash
node apps/agent-pal/bench/test/bench.test.mjs
node apps/agent-pal/bench/test/baiyue.test.mjs
node apps/agent-pal/bench/test/battle-metrics.test.mjs
pnpm --filter @onchainpal/game-engine build
node apps/agent-pal/bench/test/baiyue-e2e.mjs
```

最后一条需要本地游戏资产，不调用付费模型。它执行 validate、四题check、12局run、score、verify和board，并检查非法动作、预算起点、回合篡改与元数据删改。产物目录写在结束输出中，`acceptance.json` 表示完整验收成功。旧题的成本评分与外部agent分区保留。

## 外部 CLI 收尾与历史记账补全

Claude、Codex 和 Argon CLI 现在使用同一收尾流程：等待客户端 stdout 排空并关闭原始客户端日志，保留游戏服务的原始 `end`，追加一个 `client_finalized` 事件，再原子生成结果 JSON。事件记录客户端状态、用量，以及原游戏日志前缀和原始 CLI 日志的 SHA-256。重复收尾不会重复累计；若追加后结果文件写入中断，再次收尾可以恢复结果。

缺少有效 usage、格式异常或墙钟超时，记账状态为 `unknown` / `incomplete`，相关值为 `null`，不把缺失用量当作零。Argon 的现有文本输出没有可验证的结构化 usage，因此保持未知。成本仍是客户端报告或 runner 估算，不等于经过账单对账。

`verify` 同时核对游戏重放、原始 CLI 用量提取、记账事件和结果 JSON。新运行通过 `clientAccountingVersion: 1` 要求记账事件；旧运行保持原核验规则。排行榜核验指纹包含已绑定的 CLI 原始证据，原始证据被更改后缓存核验失效。

已有外部 CLI 运行可以直接补全记账，不调用模型：

```bash
node bench/backfill-client.mjs bench/out/<run>/episodes/<task>__s42.jsonl --backup-dir /absolute/path/to/archive
```

工具先逐字节备份原游戏日志、客户端日志、结果、run.json 和已有 verify.json，并写入哈希清单，再追加记账事件。原始 `end` 不修改；使用已有备份时内容不同会拒绝覆盖。补全后重新运行 `bench verify`。

如果核验工具已经修订，而旧运行冻结了完整运行时指纹，应使用保留的原执行版本重放：

```bash
node bench/bench.mjs verify bench/out/<run> --runtime-root /absolute/path/to/frozen-runtime
```

该目录必须包含原 `bench`、`src`、已构建引擎和可访问的资源。新核验器实际计算该目录的运行时指纹，并用其中的执行入口重放；不会跳过原有运行时/资源指纹检查。报告记录所用目录。没有原执行产物时应保留不可核验结论，不能用新版本冒充原版本。
