# agent-pal

让 AI agent 当玩家，玩 1995 年的经典 RPG《仙剑奇侠传》DOS 版。

agent-pal 在你的电脑上跑一个无头的仙剑引擎，通过 [MCP](https://modelcontextprotocol.io) 把游戏变成一组工具：看画面、走路、对话、调查、打仗、用道具、存读档、查地图。任何支持 MCP 的 AI 客户端（Claude Code、Claude Desktop 等）都可以接上来玩。

## 准备：自备游戏资源

游戏资源不随包分发。你需要一份自己的《仙剑奇侠传》DOS 版，游戏目录里要有 `PAT.MKF`、`MAP.MKF`、`SSS.MKF` 等文件。下面用 `/path/to/PAL` 代表这个目录。

需要 Node.js 20 或更新版本。

## 接入 Claude Code

```bash
claude mcp add pal -- npx -y @jianmliu/agent-pal --assets /path/to/PAL
```

然后在 Claude Code 里说一句"用 pal 工具开一局新游戏，帮我玩仙剑"就可以了。

## 接入其他 MCP 客户端

在客户端的 MCP 配置里加一个 stdio 服务：

```json
{
  "mcpServers": {
    "pal": {
      "command": "npx",
      "args": ["-y", "@jianmliu/agent-pal", "--assets", "/path/to/PAL"]
    }
  }
}
```

不走 MCP 的程序可以用 HTTP：`npx @jianmliu/agent-pal --assets /path/to/PAL --http 8086`，然后向 `http://localhost:8086/rpc` 发 JSON-RPC。

## 有哪些工具

| 类别 | 工具 |
|---|---|
| 看 | `observe`（模式、位置、队伍、新对白、附近小地图）· `map`（本场景所有出口和物体）· `panorama`（整张地图的全景图） |
| 走 | `walk_to`（整张地图寻路，走不通时给出跨场景绕路）· `step` |
| 互动 | `interact`（走到人旁边对话或调查）· `search` · `advance`（推进对白）· `choose`（选菜单） |
| 道具和仙术 | `use_item` · `equip`（穿戴装备） · `cast`（地图上施放仙术） |
| 战斗 | `battle`（攻击、防御、逃跑、自动、仙术、物品、投掷）· `grind`（自动找打得过的怪练级） |
| 存档 | `save` · `load` · `list_saves` |
| 其他 | `press` · `wait` · `screenshot` |

运行 `npx @jianmliu/agent-pal --help` 查看全部选项。

## 存档和日志放在哪

默认在 `~/.agent-pal`：

- `saves.json`：存档。标题画面选「舊的回憶」可以读档，第 5 格是自动存档。
- `memory.json`：AI 走过的地图记忆。
- `runs/`：每次会话的工具调用日志。

用环境变量 `AGENT_PAL_HOME` 可以换一个位置。

## 提示档位

`AGENT_PAL_HINTS` 控制给 AI 多少"读游戏脚本得来的答案"：

- `full`（默认）：标出开关会打开哪扇门、哪件道具该对谁用、NPC 会查你带没带什么，并给出踩开关的绕路。适合想让 AI 顺利推进的时候。
- `standard`：只给真人玩家在画面上看得到的信息，机关和道具用法要 AI 自己摸索。适合比较不同模型的能力。

## 攻略和标注地图（可选）

如果你有攻略文本或标注地图，可以让 AI 在卡住时查阅：

- `AGENT_PAL_GUIDE`：攻略文本文件路径（支持 .txt 和 .docx，多个用 `:` 分隔），开启 `guide` 工具。
- `AGENT_PAL_ATLAS_INDEX`：标注地图索引，开启 `atlas` 工具。

这些资料同样不随包分发。

## 源码

[github.com/jianmliu/pal-classic](https://github.com/jianmliu/pal-classic)（`apps/agent-pal`）。
