# Agent-PAL (`--pure` Coding Harness & Replay Edition)

**Agent-PAL** 是一个面向 1995 DOS 经典原版《仙剑奇侠传》（*Chinese Paladin*）的 **无头确定性引擎 + `--pure` 智能体编程框架（Agentic Coding Harness）+ 实时观战与回放（`.palrec` / MP4）** 独立仓库。

本仓库剥离了前端网页游乐场、移动端外壳、TUI 终端、剧情编辑器等无关模块，只保留 **让前沿编程大模型（如 Gemini 4 Argon、GPT-6.1-Sol、Claude Opus 5.5）在 `--pure` 模式下全自主写代码打穿整部游戏所需的核心代码与回放工具链**。

---

## 1. 核心特性

1. **纯净 `--pure` 协议与自编程沙箱 (`src/l0.mjs`, `src/pure.mjs`, `src/code-runner.mjs`)**
   - 仅向大模型暴露 L0 协议原语（`observe`, `step`, `search`, `advance`, `choose`, `battle`, `use_item`, `press`, `wait`, `save`, `load`, `list_saves`）、静态数据表导出（`pal-data/*.json`）、热加载模块（`module_reload`）与持久化 JavaScript 沙箱（`run_code`）。
   - 智能体无任何预置攻略或白盒内存外挂，必须靠 `SMSG_*` 事件包重建世界状态，并通过现场编写与演进 `global.*` JavaScript 函数库完成 293 个场景、11 章主线与最终 Boss 拜月教主（`32,760 HP`）的端到端通关。
2. **确定性锁步虚拟时钟 (`src/clock.mjs`, `--seed 1`)**
   - 接管 `Date.now` / `setTimeout` 与引擎随机数发生器，保证相同种子下跨模型评测与 JSONL 轨迹重放 100% 比特级可复现。
3. **融合版静态字节码拓扑编译器 (`src/bytecode-compiler.mjs`)**
   - 融合 **Claude Opus 5.5** 与 **GPT-6.1-Sol** 在 `--pure` 通关过程中独立发明的字节码编译算法：自动从 `scripts.json` 编译 `0x0044` 树藤跳跃、`0x0070`/`0x007A` 双向移动浮板、`0x006E` 相对偏移塌陷滑坡、嵌墙暗门/绳索（`triggerMode 1..3`, `search: true`）、同场景 `0x0059 + 0x0046` 五神石传送阵，以及跨场景多连通分量（孤岛）换乘图。
4. **Agent-PAL-Bench 评测基准 (`bench/`)**
   - **题库模式 (`bench run`)**：覆盖 23 道经典迷宫、剧情锁与 Boss 战切片任务（`tasks/*.json`），支持 `A`（纯像素）、`B`（标准无攻略）、`C`（开卷带攻略）三档评测、参考解自动校验（`bench check`）、确定性重放防篡改核验（`bench verify`）与帕累托前沿 HTML 排行榜（`bench board`）。
   - **拜月决战与端到端通关模式 (`bench baiyue` & `--pure`)**：支持从不同难度存档起点（标准、禁酒神、蓝量受限、脆弱高危）或从 `Scene 1` 新游戏全自主打通最终 Boss 拜月教主（`32,760 HP`）。
   - **闭卷知识测验 (`bench quiz`)**：不开游戏、按 `bench/quiz/*.json` 检验模型对剧情/迷宫的先验记忆，量化“知道（Know）”与“做到（Do）”之间的执行鸿沟。
5. **直播观战、无损录制与多倍速回放 (`src/host.mjs`, `src/palrec.mjs`, `src/replay.mjs`)**
   - **实时观战与录制 (`--host 8090 --record`)**：浏览器打开 `http://127.0.0.1:8090/watch` 实时观看 AI 操作、状态栏、小地图与对白时间线，同时边跑边落盘为 `.palrec` 增量调色板录像文件。
   - **免引擎交互式回放 (`agent-pal replay`)**：无需游戏资产或启动引擎，直接在浏览器中以 `0.25x–8x` 倍速拖动进度条回放任意 `.palrec` 录像。
   - **视频渲染导出 (`agent-pal export` / `src/record-replay.mjs`)**：支持将 `.palrec` 录像（含内置 WAV 音效与背景音乐）直接混流导出为高清像素放大 MP4，或将 `--seed` 确定性运行日志（`.jsonl`）重放渲染为 MP4。

---

## 2. 目录结构

```text
agent-pal/
├── bin/
│   └── agent-pal.mjs                 # CLI 入口 (MCP stdio / HTTP RPC / live host / replay / export / data dump)
├── src/
│   ├── engine.mjs                    # 无头 DOS 仙剑引擎启动器与底层探针
│   ├── clock.mjs                     # --seed 确定性虚拟时钟与锁步驱动器
│   ├── l0.mjs                        # L0 协议状态快照、差分 (SMSG_*) 与指令映射 (CMSG_*)
│   ├── pure.mjs                      # --pure 模式 MCP 工具定义与协议分发
│   ├── code-runner.mjs               # run_code 持久化 JS 沙箱 (pal.world / global.* / 动态工具注册)
│   ├── modules.mjs                   # L2 外部进程模块加载与热重载 (module_reload)
│   ├── data-dump.mjs                 # 原始 MKF 数据表静态导出器 (scenes / objects / scripts / maps)
│   ├── bytecode-compiler.mjs         # 融合版静态字节码编译器与跨场景/多孤岛拓扑规划器
│   ├── bytecode-compiler-demo.mjs    # 五大典型迷宫 (神木林/锁妖塔/试炼窟/铜门/女娲遗迹) 实机演示
│   ├── argon-pure-lib.js             # Gemini 4 Argon 全程自编写运行时库 (731 行)
│   ├── gpt61-pure-lib.js             # GPT-6.1-Sol 全程自编写运行时库 (135 行单行函数式)
│   ├── opus-pure-lib.js              # Claude Opus 5.5 全程自编写运行时库 (1,427 行)
│   ├── host.mjs & host-client.html   # 浏览器远程观战页与 WebSocket 帧增量流
│   ├── palrec.mjs                    # .palrec 调色板帧 + 音效 + 观战时间线录制与读取器
│   ├── replay.mjs                    # .palrec 浏览器交互式回放服务
│   ├── record.mjs & record-replay.mjs# 确定性 JSONL 运行日志重放转 MP4 视频
│   └── mcp.mjs                       # MCP stdio & HTTP JSON-RPC 服务端
├── modules/
│   ├── nav/                          # 纯 L0 协议单场景网格寻路与视野模块
│   └── pure-walker/                  # 纯 L0 协议最小示例模块
├── bench/
│   ├── bench.mjs                     # Agent-PAL-Bench 命令行入口 (run / baiyue / quiz / check / verify / board)
│   ├── tasks/                        # 23 道标准化评测题目定义 (含拜月专项与各章经典切片)
│   ├── reference/                    # 每道题各随机种子的确定性参考解与 par 步数
│   ├── quiz/                         # 23 道配对闭卷知识测验题库
│   └── saves/                        # 评测题目压缩起始存档库 (.json.gz)
├── scripts/
│   ├── palrec-replay.mjs             # 启动 .palrec 浏览器回放服务
│   ├── palrec-export.mjs             # 将 .palrec 导出为带音效/BGM 的 MP4 视频
│   ├── palrec-capture.mjs            # 用无头浏览器录制带观战 HUD 面板的回放视频
│   └── pack-npx.mjs                  # 打包单文件可执行 npx 发布包
├── test/                             # 核心单元测试 (L0 / code-runner / modules / nav / palrec / replay / compiler)
├── docs/                             # 三大模型通关报告与深度对比文章 (中/英)
└── packages/
    ├── agent-pal-protocol/           # Agent-PAL CMSG_*/SMSG_* 协议与世界模型定义
    └── game-engine/                  # 1995 DOS 仙剑核心引擎
```

---

## 3. 快速开始

### 3.1 安装依赖与构建引擎

```bash
pnpm install
pnpm run build:engine
```

### 3.2 启动 `--pure` 模式供 AI 智能体游玩

1. **MCP Stdio 模式（接入 Claude Code / Codex / Gemini CLI）**：
   ```bash
   node bin/agent-pal.mjs --pure --seed 1 --modules modules --assets /path/to/pal-assets
   ```
2. **HTTP JSON-RPC 持久服务模式（适合长程接力或脚本驱动）**：
   ```bash
   node bin/agent-pal.mjs --pure --seed 1 --http 8086 --modules modules --assets /path/to/pal-assets
   ```
3. **带浏览器实时观战 + `.palrec` 全程录像模式**：
   ```bash
   node bin/agent-pal.mjs --pure --host 8090 --http 8086 --modules modules --record ./recordings --assets /path/to/pal-assets
   # 浏览器打开 http://127.0.0.1:8090/watch 即可实时观战
   ```
4. **真人玩家手工游玩 / 人机同局协作模式 (`--host 8090`)**：
   ```bash
   # 纯手工游玩（实时时钟 + 原生音效 + 小地图 + 0.5x~4x 调速 + 自动边玩边录 .palrec）
   pnpm run play:record
   # 人机同局协作（不要带 --seed）：浏览器打开 http://127.0.0.1:8090/，AI 通过 --http 8086 或 --mcp 接入同一局
   node bin/agent-pal.mjs --pure --host 8090 --http 8086 --modules modules --speed 4 --record ./recordings
   ```
   - **📖 剧情自动原速 (`剧情1×`)**：仅在 `--host` 人机协作时生效（无头 AI 模式不受影响）。勾选后，AI 跑图/打怪保持 `2×~4×` 加速；一旦进入剧情对话（`dialog`）或过场演出（`busy`），自动降回 `1×` 原版速度并放缓 AI 翻页节奏，过场结束后自动恢复原加速档位。
   - **🎮 按键即接管 ↔ 🤖 一键交回 AI**：在浏览器按下任意游戏按键（或点击 `🎮 接管` / 按 `` ` `` 键）即可立即中断 AI 当前正在执行的 `run_code` / 寻路循环并由真人接管；点击 `🤖 交回 AI`（或再按 `` ` `` 键）即可将控制权交还 AI，服务端自动通过 `l0.sync()` 将真人操作后的最新场景、坐标、队伍与背包状态同步至 `pal.world` 与各模块。

### 3.3 回放与视频导出 (`Replay`)

1. **在浏览器中交互式回放 `.palrec` 录像（支持暂停、拖动进度条、`0.25x–8x` 倍速，无需游戏资源）**：
   ```bash
   node bin/agent-pal.mjs replay ./recordings/run-xxx.palrec --port 8096
   # 浏览器打开 http://127.0.0.1:8096/replay
   ```
2. **将 `.palrec` 录像直接导出为 MP4 视频（自动合成内置音效与可选背景音乐）**：
   ```bash
   node bin/agent-pal.mjs export ./recordings/run-xxx.palrec -o playthrough.mp4 --scale 4
   ```
3. **将确定性模式（`--seed`）下的 JSONL 运行日志重放渲染为 MP4 视频**：
   ```bash
   node src/record-replay.mjs ./runs/run-xxx.jsonl ./replayed.mp4
   ```

### 3.4 运行 Agent-PAL-Bench（题库模式 / 拜月通关模式 / 闭卷测验）

```bash
# 1. 校验全部 23 道题库与配对闭卷测验格式
node bin/agent-pal.mjs bench validate

# 2. 在确定性虚拟时钟下回放验证题库参考解
node bin/agent-pal.mjs bench check opening-serve-dishes classic28-tower-gate

# 3. 题库模式：评测指定模型在指定档位 (A=像素 / B=标准 / C=开卷 / P=Pure编程档) 下的闯关表现
node bin/agent-pal.mjs bench run --model anthropic:claude-opus-4-6 --tier B --tasks opening-serve-dishes,classic08-leave-area

# 4. Tier P (Pure 编程档)：禁用官方 walk_to/interact/map，考察模型用 run_code + global + pal.readData 现场编程解题
node bin/agent-pal.mjs bench run --model ollama:kimi-k3:cloud --tier P --tasks opening-serve-dishes,pal-ch1-meet-linger

# 5. 拜月通关模式：运行最终 Boss 拜月教主专项基准 (支持 --tier B 或 --tier P)
node bin/agent-pal.mjs bench run --model ollama:deepseek-v4-pro:0813-cloud --tier P --tasks baiyue-single-origin

# 5. 闭卷测验模式：测量模型先验记忆分 (Prior Knowledge vs. Execution Gap)
node bin/agent-pal.mjs bench quiz --model google/gemini-4-argon

# 6. 确定性重放防篡改核验与生成 HTML 排行榜
node bin/agent-pal.mjs bench verify ./bench/out/<run-dir>
node bin/agent-pal.mjs bench board --out ./bench/out/board.html
```

### 3.5 运行静态字节码拓扑编译器实机演示与测试套件

```bash
# 运行全部单元测试与 --pure 冒烟测试
pnpm test

# 运行五大非线性迷宫（神木林/锁妖塔/试炼窟/铜门/女娲遗迹 16 段换乘）字节码编译演示
pnpm run demo:compiler
```

---

## 4. 技术报告（Technical Report）、专题论文与 `--pure` 通关档案

### 4.1 Agent-PAL-Bench 技术报告与综述博客
- **📄 主技术报告（Technical Report v0.4）**：
  - **PDF 正式排版稿**：[`docs/agent-pal-bench-draft.pdf`](./docs/agent-pal-bench-draft.pdf)
  - **中文版**：[*Agent-PAL-Bench：以经典中文角色扮演游戏评测文本智能体的长程决策能力* (`docs/agent-pal-bench-draft.md`)](./docs/agent-pal-bench-draft.md)
  - **英文版**：[*Agent-PAL-Bench: Evaluating Long-Horizon Decision-Making in a Chinese Role-Playing Game Through Text-Based Interaction* (`docs/agent-pal-bench-draft.en.md`)](./docs/agent-pal-bench-draft.en.md)
  - **LaTeX 源码**：[`docs/agent-pal-bench-draft.tex`](./docs/agent-pal-bench-draft.tex)
- **⚔️ 华山论剑全景综述博客**：
  - [《大模型华山论剑，广发英雄帖：外来三剑客（Argon、Claude、GPT）更厉害，还是中国模型更懂中国传统游戏？》(`docs/huashan-sword-summit-blog.zh.md`)](./docs/huashan-sword-summit-blog.zh.md)
- **🔬 四大代表性关卡认知行为与反事实消融专题报告（对应技术报告 `§5.8–§5.11`）**：
  1. **祈雨祭坛 (`§5.8`)**：[《大理祈雨祭坛 45° 等距旋转陷阱、十万字内省死循环与 1 步认知探针》(`docs/rain-altar-epistemic-trap.zh.md`)](./docs/rain-altar-epistemic-trap.zh.md)
  2. **白河采药 (`§5.9`)**：[《白河村三味药材：先验攻略污染、零样本清图开销与止损弹性》(`docs/baihe-luck-vs-character.zh.md`)](./docs/baihe-luck-vs-character.zh.md)
  3. **扬州葫芦 (`§5.11`)**：[《扬州女飞贼与紫金葫芦长链：局部错误先验锚定、漏捡自省与跨场景空间图复用》(`docs/yangzhou-gourd-long-horizon.zh.md`)](./docs/yangzhou-gourd-long-horizon.zh.md)
  4. **拜月决战 (`§5.10`)**：[《南诏王宫拜月决战：双层先验结构、禁招反事实消融与批量结算控制变量消元法》(`docs/baiyue-prior-vs-reflection.zh.md`)](./docs/baiyue-prior-vs-reflection.zh.md)
- **📊 72 局经 `bench verify` 核验的评测轨迹与交互式排行榜**：
  - 轨迹归档目录：[`bench/out/`](./bench/out/) ｜ 帕累托前沿看板：[`bench/out/board.html`](./bench/out/board.html)

### 4.2 三大前沿模型 `--pure` 全自主通关文档与代码库（对应技术报告 `§5.7`）
- **深度对比文章**：
  - 中文版：[docs/three-models-play-agent-pal.zh.md](./docs/three-models-play-agent-pal.zh.md)
  - 英文版：[docs/three-models-play-agent-pal.md](./docs/three-models-play-agent-pal.md)
- **分模型通关报告与自编写代码库**：
  - **Gemini 4 Argon**：[通关报告](./docs/argon-pure-playthrough-report.md) ｜ [自编写库 `src/argon-pure-lib.js`](./src/argon-pure-lib.js)（731 行）
  - **GPT-6.1-Sol**：[通关报告](./docs/gpt61-pure-playthrough-report.md) ｜ [自编写库 `src/gpt61-pure-lib.js`](./src/gpt61-pure-lib.js)（135 行）
  - **Claude Opus 5.5**：[通关报告](./docs/opus-pure-playthrough-report.md) ｜ [自编写库 `src/opus-pure-lib.js`](./src/opus-pure-lib.js)（1,427 行）

---

## 5. 引用格式（Citation）

如果您在学术论文、技术报告或评测文章中引用 **Agent-PAL-Bench 技术报告** 或使用本仓库代码与评测轨迹，请使用以下 BibTeX 条目：

```bibtex
@misc{liu2026agentpalbench,
  title        = {Agent-PAL-Bench: Evaluating Long-Horizon Decision-Making in a Chinese Role-Playing Game Through Text-Based Interaction},
  author       = {Liu, Jianming},
  year         = {2026},
  howpublished = {\url{https://github.com/jianmliu/agent-pal}},
  note         = {Technical report and open-source benchmark}
}
```
