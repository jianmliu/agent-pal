# Claude Opus 5.5 `--pure` Mode Full Playthrough Report & Cross-Model Comparison

## 1. Executive Summary

- **Model**: `claude-opus-5-5` (Claude Opus 5.5)
- **Mode**: `agent-pal --pure --seed 1 --http 8087 --modules nav` (Zero pre-packaged `pal.*` helper scripts; only L0 primitives + raw `pal-data/*.json` + `run_code` sandbox + basic `nav` module)
- **Start State**: Fresh game (`新的故事`, `Scene 1`, `李逍遙 Lv1`, `0` cash)
- **End State**: Full game completion (`Scene 281`, defeated `拜月教主` `32,760 HP` with `酒神` finisher, completed ending sequence `4342..4434`, saved `Slot 98` pre-boss and `Slot 99` post-ending)
- **Final Party (`Slot 99`)**: `李逍遙 Lv54`、`阿奴 Lv52`、`趙靈兒 Lv50` (`cash: 21,159` remaining after spending `64,000` cash on `12+` `乾坤一擲` throws during the final battle)
- **Total Rounds**: 2 relay rounds (Round 1: `939` tool calls / `115.3 min` from `Scene 1` to `Scene 231` 10-years-ago underwater maze; Round 2: `514` tool calls / `113.3 min` from `Scene 231` to `Scene 281` ending)
- **Total Tool Calls**: `1,453` MCP tool calls (`1,390` `run_code` calls + `63` direct L0/nav calls)
- **Total Wall-Clock Duration**: `228.5 minutes` (~`3.81 hours`)
- **Artifacts**:
  - Save file (96 populated slots `Slot 1`–`99`): [`apps/agent-pal/saves/opus-pure-saves.json`](file:///Volumes/T7-Data/pal/pal-classic/apps/agent-pal/saves/opus-pure-saves.json)
  - Self-coded runtime library (`1,427` lines, `76` distinct `global.*` functions/tables across iterative versions): [`apps/agent-pal/src/opus-pure-lib.js`](file:///Volumes/T7-Data/pal/pal-classic/apps/agent-pal/src/opus-pure-lib.js)
  - Full relay log: [`apps/agent-pal/runs/opus-pure/claude-relay.log`](file:///Volumes/T7-Data/pal/pal-classic/apps/agent-pal/runs/opus-pure/claude-relay.log)

---

## 2. Playthrough Timeline & Key Milestones (`Slots 1–99`)

| Slot Range | Chapter / Region | Scenes | Party & Levels | Key Autonomous Engineering & Story Milestones |
| :--- | :--- | :--- | :--- | :--- |
| `Slot 1–4` | 余杭鎮・仙靈島 | `1–21` | `李逍遙 Lv1→2` | Built bytecode disassembler (`global.dis`, `global.sum`, `global.whoSets`, `global.whoRuns`); parsed lotus-leaf teleport scripts (`0070`) into `global.teleLinks` and solved all 6 Asura statues (`Slot 2`), got `紫金丹` (`Slot 3`), cured Aunt Li (`Slot 4`). |
| `Slot 5–11` | 山神廟・十里坡・余杭客棧 | `1–19` | `李逍遙 Lv2→7`, `趙靈兒 Lv8` | Learned `御劍術` (`Slot 5`), rescued `趙靈兒` (`Slot 6`), built `global.sweep` / `global.grind` to auto-grind 十里坡 to `Lv7` (`Slot 9`), defeated `苗人頭領` (`Slot 10`). |
| `Slot 12–20` | 蘇州城・林家堡・隱龍窟 | `22–47` | `李逍遙 Lv7→10`, `趙靈兒 Lv8`, `林月如 Lv7→8` | Defeated `林月如` in tournament (`Slot 15`), built connected-component cross-scene planner (`global.reachSet`, `global.planTo`), cleared `隱龍窟` (`蛇妖男` + `狐狸精`, `Slot 18–20`). |
| `Slot 21–34` | 白河村・玉佛寺・將軍塚・血池・鬼陰山 | `49–77` | `李逍遙 Lv10→14`, `趙靈兒 Lv9→13`, `林月如 Lv9→13` | Collected 3 ingredients for `六神丹`, defeated `智修大師` for `玉佛珠` (`Slot 23`), equipped `玉佛珠` to open `將軍塚` (`Slot 25`), defeated `鬼將軍` (`Slot 28`), solved all 9 blood-pool drain switches and defeated `赤鬼王` (`Slot 31`), survived `石長老` (`Slot 34`). |
| `Slot 35–43` | 揚州城・蛤蟆山・京城碼頭 | `80–106` | `李逍遙 Lv14→17`, `林月如 Lv13→16` | Caught `女飛賊` at night (`Slot 35`), retrieved `紫金葫蘆` from well maze (`Slot 38`), defeated `姬三娘` to free `林月如` (`Slot 41`), cleared `蛤蟆山` (`Slot 42`), sailed to `京城` (`Slot 43`). |
| `Slot 44–54` | 京城尚書府・黑蜘蛛森林・蜀山 | `100–160` | `李逍遙 Lv17→18`, `林月如 Lv16→17` | Pawned spare gear for `金蛇鞭`/`精鐵戰甲` (`Slot 45`), wrote `SURVIVE_FOES` to survive `林天南` duel (`Slot 46`), delivered ritual items + wine to `酒劍仙` (`Slot 49`), cleared `黑蜘蛛森林` & `毒娘子` (`Slot 51`), flew to `蜀山`, got `玉佛珠` & `酒神咒` (`Slot 53–54`). |
| `Slot 55–74` | 鎖妖塔 (1F–8F + 姜清 + 鎮獄明王 + 七星盤龍柱) | `144–168` | `李逍遙 Lv18→26`, `林月如 Lv17→25`, `趙靈兒 Lv25→27` | Built `global.crawl` to traverse `鎖妖塔` 1F–8F, solved `天書` riddle (`Slot 62`) and 7F floor switches (`Slot 63`), defeated `鎮獄明王` (`13,723 HP`, `Slot 66`), built `global.DRAGON_WEAK` / `global.dragonPlan4` to slay all 7 elemental dragons in `Scene 144` (`Slot 67–74`). |
| `Slot 75–88` | 聖姑家・神木林・樹洞・大理・火麒麟洞 | `174–212` | `李逍遙 Lv26→31`, `阿奴 Lv28→30` | Extended `global.teleLinks` to parse `0044` (ride-vine) edges and fed bananas to blocking monkeys to solve the 27-jump vine maze in `Scene 192` (`Slot 77–79`), soloed `鳳凰` (`3,300 HP`, `Slot 81`), looted `磐龍劍`/`紫金冠` (`Slot 82`), defeated `火眼麒麟` (`4,900 HP`, `Slot 88`). |
| `Slot 89–97` | 女媧神殿・十年前南紹与水底迷宮・山神廟 | `203–257` | `巫后 Lv48`, `李逍遙 Lv31→34` | Built `global.relJumps` to model `006E` sliding floor pads in `Scene 203` (`Slot 89`), entered 10-years-ago flashback (`Slot 90`), retrieved `天蛇杖` (`Slot 92`), defeated `水魔獸/八頭蛇` (`8,600 HP`, `Slot 93 & 96`), traded `木劍` for `水靈珠` (`Slot 95/97`). |
| `Slot 92–94` (R2) | 試煉窟刷齊 36 隻傀儡蟲・趙靈兒歸隊 | `173–226` | `李逍遙 Lv34→36`, `阿奴 Lv31→33`, `趙靈兒 Lv27` | Built connected-component region-graph planner (`global.compsOf`, `global.regionGraph`, `global.farmTour`) and `飛龍探雲手` steal-and-kill AI (`global.farmAct2`) in `試煉窟` (`Scenes 217–219`) to farm all **36/36 `傀儡蟲`** (`Slot 93`), used `土靈珠` to exit and revive `趙靈兒` (`Slot 92`). |
| `Slot 88–91` (R2) | 黑苗戰場・女媧神殿授衣・祭壇祈雨・地魔獸 | `259–272` | `李逍遙 Lv36`, `阿奴 Lv34`, `趙靈兒 Lv28` | Built `global.walk3` to fight through `Scene 259–263` soldier blockades, received `聖靈珠`/`聖靈披風`/`天蛇杖` (`Slot 88`), placed all 5 elemental pearls on altar pedestals (`Scene 272`), defeated `地魔獸`, entered `Scene 291`. |
| `Slot 79–99` (R2) | 地底密道・南紹王宮地牢・樹妖・拜月教主・大結局 | `278–293` | `李逍遙 Lv36→54`, `阿奴 Lv34→52`, `趙靈兒 Lv28→50` | Used `隱蠱` invisibility + `global.walk5` step-checkpointing to clear `Scenes 291–293` & `279–288`; fixed `b.prompt.revision` turn-lag bug in `runFight`; farmed to `$118,565` (`Lv53/51/49`) in `Scenes 285/287` (`Slot 86`); defeated `樹妖` (`14,180 HP`, `Slot 87`); saved `Slot 98` (`$85,165` cash); defeated `拜月教主` (`32,760 HP`) with `12× 乾坤一擲` + `金剛咒/真元護體` + `五氣朝元` + `酒神` finisher (`Slot 88`); drove ending sequence `4342..4434` and saved `Slot 99`. |

---

## 3. Side-by-Side Comparison: Argon vs. Claude Opus 5.5 in `--pure` Mode

| Dimension | Argon (`--pure --seed 1`) | Claude Opus 5.5 (`--pure --seed 1`) |
| :--- | :--- | :--- |
| **Completion Status** | **100% Full Playthrough (`Scene 1` → `Scene 281` Ending, `Slots 1–99`)** | **100% Full Playthrough (`Scene 1` → `Scene 281` Ending, `Slots 1–99`)** |
| **Total Tool Calls** | `475` (`449` `run_code` + `26` L0/nav) | `1,453` (`1,390` `run_code` + `63` L0/nav) |
| **Wall-Clock Time** | `102.7 min` (~`1.71 hours`, 1 session) | `228.5 min` (~`3.81 hours`, 2 relay rounds) |
| **Self-Coded Library Size** | `730` lines / `35.7 KB` ([`argon-pure-lib.js`](file:///Volumes/T7-Data/pal/pal-classic/apps/agent-pal/src/argon-pure-lib.js)) | `1,427` lines / `217.7 KB` ([`opus-pure-lib.js`](file:///Volumes/T7-Data/pal/pal-classic/apps/agent-pal/src/opus-pure-lib.js)) |
| **Final Party Levels (`Slot 99`)** | `李逍遙 Lv37`、`阿奴 Lv36`、`趙靈兒 Lv30` | `李逍遙 Lv54`、`阿奴 Lv52`、`趙靈兒 Lv50` |
| **Bytecode Reverse-Engineering** | `findTexts`, `dumpScript`, `whoRefs`, `findSceneChange`, `findItemScripts` | `dis`, `sum`, `whoSets`, `whoRuns`, `chainBack`, `storyObjs`, `storyCands`, `ctx`, `scriptOps` |
| **Intra-Scene Special Mechanics Pathfinding** | Custom BFS with dynamic obstacle bypass (`stepAround`, `bfsStep`) + explicit script inspection for lotus leaves / vines / sliding tiles | Unified generalized graph BFS (`path2`) that automatically parses `0070`/`0046` teleports (`teleLinks`), `0044` vine rides, and `006E` relative-jump floor pads (`relJumps`) directly from bytecode |
| **Cross-Scene Navigation Architecture** | Scene-level exit graph + `goScene` / `clearDungeon` | Connected-component region graph (`compsOf` + `regionGraph` + `goNode` + `travel5`) modeling pockets within segmented scenes (`隱龍窟`, `試煉窟`, `王宮地牢`) |
| **36 `傀儡蟲` Quest Strategy** | Purchased `傀儡蟲` from 大理城 shop (`Scene 207`, `100` cash each) + looted 聖姑家 | Built an autonomous `試煉窟` (`Scenes 217–219`) connected-component farmer (`farmTour` + `farmAct2` with `飛龍探雲手` steal + kill) to farm all 36 `傀儡蟲` from monsters |
| **Final Boss (`拜月教主` `32,760 HP`) Strategy** | Used `隱蠱` (party-wide invisibility every 3 rounds) + `酒神` (`9×`) + `乾坤一擲` (`Lv37` low-level tactical clear) | Used `真元護體`/`金剛咒` defense buffs + `五氣朝元`/`元靈歸心術` dual-healer rotation + farmed `$118.5k` cash (`Lv53` high-level stat-and-economy clear with `12× 乾坤一擲` + `酒神` finisher) |
| **Self-Debugging Highlights** | Diagnosed `仙靈島` statue state bits, `將軍塚`/`血池` switch graph, `鎖妖塔` 7F bridge toggles, and `隱蠱` (`005C`) invisibility counter | Diagnosed `0044` vine self-loop bug, `006E` signed 16-bit relative offset math, `b.prompt.revision` one-turn battle lag, `仙女劍` double-turn counter (`002D:8,32760`), and `walk5` stale-slot reload bug |
