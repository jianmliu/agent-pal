# GPT-6.1-Sol `--pure` Mode Full Playthrough Report & Three-Model Comparison

## 1. Executive Summary

- **Model**: `gpt-6.1-sol` (GPT-6.1-Sol, `model_reasoning_effort = "medium"`, via Codex CLI `0.162.0-alpha.17.2`)
- **Mode**: `agent-pal --pure --seed 1 --http 8088 --modules apps/agent-pal/modules` (L0 protocol primitives + `run_code` sandbox + `module_reload` + L0-only `nav` module)
- **Start State**: Fresh game (`新的故事`, `Scene 1`, `李逍遙 Lv1`, `0` cash)
- **End State**: Full game completion (`Scene 281`, defeated `拜月教主` `32,760 HP` in `battle 1202`, completed full ending sequence `4342..4434`, saved `Slot 98` pre-boss and `Slot 99` post-ending with `global.completedEnding = true`)
- **Final Party (`Slot 99`)**: `李逍遙 Lv46`、`趙靈兒 Lv41`、`阿奴 Lv45` (`cash: 38,817` remaining from `86,803` pre-boss cash in `Slot 98`)
- **Total Sessions / Rounds**: **1 single uninterrupted session** (completed end-to-end in Round 1 without relay handoff)
- **Total Tool Calls**: `845` MCP tool calls (`844` `run_code` calls + `1` `list_saves` call)
- **Total Wall-Clock Duration**: `8,865.1 seconds` (`147.8 minutes` / `2.46 hours`, `2026-10-20T13:14:03Z` to `15:41:48Z`)
- **Exact Token Telemetry (`turn.completed`)**:
  - **Total Input Tokens**: `194,205,716` (`194.21M`)
    - **Cached Input Tokens**: `192,058,624` (`192.06M` — **98.89% cache hit rate**)
    - **Uncached Input Tokens**: `2,147,092` (`2.15M`)
  - **Total Output Tokens**: `167,033` (`167.0K`, including `65,033` `reasoning_output_tokens` and `102,000` code/text tokens)
  - **Total Tokens (Input + Output)**: `194,372,749` (`194.37M`)
- **Artifacts**:
  - Self-coded runtime library (`135` lines, `115,895` bytes): [`apps/agent-pal/src/gpt61-pure-lib.js`](../../apps/agent-pal/src/gpt61-pure-lib.js)
  - Save file (`Slots 1–99` populated, local ignored save store): `apps/agent-pal/saves/gpt61-pure-saves.json`
  - Full relay log & round summary (local ignored run logs): `apps/agent-pal/runs/gpt61-pure/gpt61-relay.log`, `apps/agent-pal/runs/gpt61-pure/gpt61-rounds.json`

---

## 2. Playthrough Timeline & Key Milestones (`Slots 1–99`)

| Time (UTC) | Save Slots | Chapter / Region | Scenes | Party Levels | Autonomous Engineering & Gameplay Highlights |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `13:14–13:26` | `Slots 1–10` | 餘杭鎮・仙靈島・十里坡 | `1–19` | `李 Lv1→8`, `靈 Lv6` | Built `global.brief`, `global.settle`, `global.buildGrid`, `global.portals`, `global.routeTo`, and `global.mazeExplore` (DFS over lotus pads `244..260` + `破天鎚` smashing `238..243`); trained at 十里坡 with `global.grind(8)` and defeated `苗人頭領`. |
| `13:26–13:38` | `Slots 11–26` | 蘇州城・林家堡・隱龍窟 | `20–49` | `李 Lv8→10`, `靈 Lv8`, `月 Lv7` | Built cross-scene BFS `global.exits` (`0x0059`), `global.sceneRoute`, and `global.navigate`; defeated `林月如`, `蛇妖男`, and `狐妖女`; reached 白河村 (`Scene 49`). |
| `13:38–13:59` | `Slots 27–49` | 白河村・玉佛寺・將軍塚・血池・鬼陰山 | `49–83` | `李 Lv10→14`, `靈 Lv9→12`, `月 Lv8→13` | Built `global.flood`, `global.landing` (`0x0046`), `global.dungeonRoute`, and `global.openSwitches`; after running out of MP on `赤鬼王`, reloaded `Slot 32` to buy `30× 還神丹` + `5× 還魂香` and defeated `赤鬼王` at `Lv12/11/11` (`Slot 46`); survived `石長老` (`Slot 49`). |
| `13:59–14:15` | `Slots 50–64` | 揚州城・蛤蟆山・京城・黑蜘蛛森林 | `80–139` | `李 Lv14→21`, `月 Lv13→20` | Built `global.safeGo` and `global.safeTalk` (masking non-target exit radii on the 192×192 grid); defeated `女飛賊`/`姬三娘`, `金蟾鬼母`, survived `林天南`, and defeated `毒娘子` (`Slot 64`). |
| `14:15–14:43` | `Slots 65–72`, `12` | 蜀山・鎖妖塔 (9F→1F)・七星盤龍柱 | `143–172` | `李 Lv21→26`, `月 Lv20→24`, `靈 Lv24` | Extended `global.exits` to compile intra-scene teleports (`0x0046`, `0x0044`, `0x007A`, `0x007B`, `0x0070`) and search-triggered portals (`triggerMode 1..3`); defeated `姜清`, `天鬼皇`, `鎮獄明王`, and all 7 pillar dragons (`Scene 144`). |
| `14:43–15:05` | `Slots 73–78` | 聖姑家・神木林・桃花源・火麒麟洞・十年前南詔 | `173–257` | `李 Lv26→34`, `奴 Lv26→34` | Built elemental & physical resistance-aware `global.fight` reading `enemy.physicalResistance` and `enemy.elemResistance[0..4]` from `global.data.objects`; defeated `鳳凰`, `木道人`, `火眼麒麟`, and `水魔獸`, obtaining `水靈珠` (`Slot 78`). |
| `15:05–15:15` | `Slots 79–90` | 試煉窟 (`36隻傀儡蟲`) & 女媧遺跡 | `195–234`, `173` | `李 Lv34→35`, `奴 Lv34` | Used `global.positionRoute` and `global.dungeonRoute` to traverse `試煉窟` (`Scenes 217–224`) and collect all **36 `傀儡蟲` in 9 minutes** (`15:05:59Z` to `15:15:14Z`), reached 女媧遺跡 (`Slot 89`), and revived `趙靈兒` (`Slot 90`). |
| `15:15–15:41` | `Slots 91–99`, `8–11` | 五靈珠祭壇・南詔王宮・拜月教主・大結局 | `259–293`, `278–281` | `李 Lv35→46`, `靈 Lv27→41`, `奴 Lv34→45` | Placed 5 elemental pearls on altar (`Slot 91`), defeated `地魔獸` (`Slot 92`), cleared abyss & dungeon (`Slots 93–97`); reached `Scene 281` at `Lv40/33/38` (`Slot 8`), optimized resistance/MP-regen gear (`Slots 10–11`) and leveled to `Lv45/40/44` (`Slot 98`, `$86,803` cash); defeated `拜月教主` (`32,760 HP`) via `global.finalFight`, played full ending `4342..4434`, and saved `Slot 99` (`Lv46/41/45`, `$38,817` cash). |

---

## 3. Self-Coded Runtime Architecture ([`apps/agent-pal/src/gpt61-pure-lib.js`](../../apps/agent-pal/src/gpt61-pure-lib.js))

1. **Ultra-Compact One-Liner Coding Style (`135` lines, `167.0K` total output tokens)**:
   - Unlike Argon (`731` formatted lines) and Claude Opus 5.5 (`1,427` lines), GPT-6.1-Sol authored its persistent `global.*` helpers as dense, single-line functional definitions and appended incremental overrides to [`src/gpt61-pure-lib.js`](../../apps/agent-pal/src/gpt61-pure-lib.js). This minimized code generation overhead (`102,000` non-reasoning output tokens across the entire 2.46-hour playthrough).
2. **Independent Discovery of Bytecode-Compiled Region Graph Routing (`global.flood`, `global.exits`, `global.dungeonRoute`, `global.positionRoute`)**:
   - Converging independently with Claude Opus 5.5's topology compiler, GPT-6.1-Sol built a static bytecode analyzer over `global.data.scripts` and `maps/<mapNum>.json`:
     - Flood-fills walkable tiles (`rows[y][x] === '.'`) while masking non-target exit trigger radii (`triggerMode - 3`) so traversal within a region never accidentally steps on an unintended portal (`global.safeGo`).
     - Extracts cross-scene transitions (`0x0059` + `0x0046` landing half-tile conversion `half(p) = { x: p[0]+p[1]+p[2], y: p[1]-p[0]+64 }`), intra-scene coordinate warps (`0x0044`, `0x0046`, `0x007A`, `0x007B`, `0x0070`), and interactive `search` portals (`triggerMode 1..3` without battle/dialog blockers).
     - Performs BFS over `(scene, connectedComponentKey)` pairs in `global.dungeonRoute(targetScene)` and `global.positionRoute(targetScene, x, y)`.
3. **Resistance-Aware Tactical Combat & Final Boss State Machine (`global.fight`, `global.finalFight`)**:
   - Dynamically parses each character's spell list from battle prompt notes (`now <name>'s command (spells: ...)`), queries `global.data.objects` for `enemy.physicalResistance` and `enemy.elemResistance[0..4]`, and ranks offensive spells by resistance-weighted expected AoE/single-target damage.
   - When `physicalOkay` (`physicalResistance < 8`) holds on bosses, `李逍遙` automatically buffs `天罡戰氣 (311)` + `醉仙望月步 (390)` for double-hit critical physical attacks.
   - In `global.finalFight` against `拜月教主` (`32,760 HP`), `李逍遙` maintains party-wide `真元護體 (310)`, casts `酒神 (370)` when summoned adds appear, and sustains `天罡戰氣` + `醉仙望月步`; `趙靈兒` maintains `五氣朝元 (300)` party healing and `金剛咒 (309)` with automatic MP potion refills; and `阿奴` casts `乾坤一擲 (394)` every turn (`$47,986` cash spent).

---

## 4. Three-Model `--pure --seed 1` Comparison: Argon vs. GPT-6.1-Sol vs. Claude Opus 5.5

| Dimension | Argon (`--pure --seed 1`) | GPT-6.1-Sol (`effort=medium`, `--pure --seed 1`) | Claude Opus 5.5 (`effort=medium`, `--pure --seed 1`) |
| :--- | :--- | :--- | :--- |
| **Completion Status** | **100% (`Scene 1 → 281` Ending, `Slots 1–99`)** | **100% (`Scene 1 → 281` Ending, `Slots 1–99`)** | **100% (`Scene 1 → 281` Ending, `Slots 1–99`)** |
| **Sessions / Continuity** | 1 conversation (3 server segments; Segment 1: `475` MCP calls / `102.7 min`) | **1 single uninterrupted session** (`Round 1`) | 2 relay rounds (`Round 1` + `Round 2`) |
| **Total API Turns / MCP Calls** | `1,738` turns / `1,704` tool calls across all 3 segments (`475` in Segment 1) | **`~846` turns / `845` MCP tool calls** (`844` `run_code` + `1` `list_saves`) | `1,458` turns (`942` R1 + `516` R2) / `1,453` MCP tool calls (`1,390` `run_code`) |
| **Wall-Clock Time** | `102.7 min` (Segment 1) / `~8.9 h` active across 3 segments | **`147.8 min` (`2.46 hours`, single session)** | `228.5 min` (`3.81 hours`, 2 relay rounds) |
| **Total Input Tokens** | **`243,312,014`** (`243.31M` exact across all 3 segments; `51.09M` in Seg 1) | **`194,205,716`** (`194.21M` exact) | **`~720M`** (`~458M` R1 + `~262M` R2, reconstructed from exact cost) |
| **Cached Input Tokens & Hit Rate** | `236,651,999` (`236.65M`, **97.26%**) | `192,058,624` (`192.06M`, **98.89%**) | `~718M` (`cache_read`, **~99.7%**) |
| **Uncached Input Tokens** | `6,660,015` (`6.66M`) | **`2,147,092` (`2.15M`)** | `~2.1M` (`input` + `cache_creation`) |
| **Total Output Tokens** | `1,356,000` (`1.36M` exact across all 3 segments; `218.3K` in Seg 1) | **`167,033` (`167.0K` exact; `65.0K` reasoning + `102.0K` code/text)** | `~500K` (`~180K` JS code + `~60K` text + `~260K` thinking) |
| **CLI Reported API Cost (USD)** | — | — | **`$165.2123`** (`$105.0820` R1 + `$60.1303` R2 at `tier_4_20_cache_read_0_20`) |
| **Self-Coded Library** | [`src/argon-pure-lib.js`](../../apps/agent-pal/src/argon-pure-lib.js) (`731` lines / `35.7 KB`) | [`src/gpt61-pure-lib.js`](../../apps/agent-pal/src/gpt61-pure-lib.js) (`135` lines / `115.9 KB`) | [`src/opus-pure-lib.js`](../../apps/agent-pal/src/opus-pure-lib.js) (`1,427` lines / `217.7 KB`) |
| **Spatial & Dungeon Architecture** | Closed-loop `global.goTo` recovery wrapper around `nav.walk_to` + dynamic blocker clearing (`triggerMode >= 5`) | Connected-component flood-fill + bytecode portal compiler (`global.flood`, `global.exits`, `global.dungeonRoute`, `global.positionRoute`) | Generalized bytecode hybrid BFS (`path2`) + connected-component region graph (`compsOf`, `regionGraph`, `farmTour`) |
| **Trial Cave (`36隻傀儡蟲`) Strategy** | Collected in `Scenes 217–220` + shop/loot | Traversed via `global.positionRoute` in **9 minutes** (`Slots 79–89`, `Lv34`) | Built `farmTour` + `飛龍探雲手` steal-and-kill loop across `Scenes 217–219` |
| **Final Party Levels (`Slot 99`)** | `李 Lv43 / 靈 Lv37 / 奴 Lv42` | `李 Lv46 / 靈 Lv41 / 奴 Lv45` | `李 Lv54 / 靈 Lv50 / 奴 Lv52` |
| **Final Boss (`拜月教主`, `32,760 HP`) Strategy** | Low-level tactical burst: `隱蠱` stealth + `真元護體` + `雪蓮子` + `2× 酒神` + `乾坤一擲` (11 rounds, 0 deaths) | Balanced shield-regen + `乾坤一擲`: `真元護體` + `五氣朝元` + `天罡/醉仙` + `酒神` (adds) + `乾坤一擲` (`$47,986` spent) | High-level economic attrition: farmed `$118.5k` cash, `金剛咒` + `真元護體` + `12+ 乾坤一擲` (`$64,006` spent) + `酒神` finisher |
