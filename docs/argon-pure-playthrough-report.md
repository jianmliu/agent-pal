# `--pure` Mode Autonomous Playthrough & Self-Coding Report

## 1. Overview

This document records the complete autonomous playthrough of *Chinese Paladin* (《仙劍奇俠傳》 1995 DOS) from **"新的故事" (`Scene 1`, `李逍遙 Lv1`)** to the **Final Boss (`拜月教主`, `32,760 HP`)** and **Full Ending Sequence (`4342..4434`)** in `--pure --seed 1` mode.

Unlike the default `assist` (L1) mode—which exposes 20+ pre-built high-level tools (`walk_to`, `interact`, `cross_portal`, `fight`, `equip`, `buy`, `guide`, `plan`) with direct access to internal engine memory (`worldService`)—this playthrough operated strictly under the **`--pure` (L0 protocol + dynamic self-coding)** boundary:

- **Exposed MCP Surface**: `protocol_send`, `protocol_observe`, `run_code`, `module_reload`, and the L0-only `nav` module (`nav__walk_to`, `nav__interact`, `nav__use_item`, `nav__view`).
- **State Reconstruction**: `pal.world` in [`apps/agent-pal/src/code-runner.mjs`](../../apps/agent-pal/src/code-runner.mjs) is reconstructed exclusively from `SMSG_*` server packets (`SMSG_SCENE_ENTER`, `SMSG_PLAYER_UPDATE`, `SMSG_OBJECT_UPDATE`, `SMSG_PARTY_UPDATE`, `SMSG_INVENTORY_UPDATE`, `SMSG_DIALOG`, `SMSG_CHOICE`, `SMSG_BATTLE_*`, `SMSG_MODE`).
- **Action Primitives**: All game progression goes through `CMSG_*` client packets (`CMSG_MOVE`, `CMSG_INTERACT`, `CMSG_DIALOG_ADVANCE`, `CMSG_CHOICE`, `CMSG_BATTLE_ACTION`, `CMSG_MENU_USE_ITEM`, `CMSG_KEY`, `CMSG_WAIT`, `CMSG_SAVE`, `CMSG_LOAD`).

---

## 2. Infrastructure & Self-Coded Runtime Library

1. **Session Code Runner ([`apps/agent-pal/src/code-runner.mjs`](../../apps/agent-pal/src/code-runner.mjs))**:
   - Implements `createCodeRunner`, providing a persistent `global` object across `run_code` invocations, `SMSG_*` event listeners (`pal.on` / `pal.off`), dynamic MCP tool registration (`pal.registerTool` / `pal.unregisterTool`), static data-table access (`pal.readData`), and deadline enforcement (`RunCodeAbortedError`).
2. **Hot-Reloadable Module Loader ([`apps/agent-pal/src/modules.mjs`](../../apps/agent-pal/src/modules.mjs))**:
   - Supports runtime `module_reload` (`reload` / `load` / `unload` / `list`), automatically delivering a fresh `SMSG_HELLO` + full snapshot to newly loaded or reloaded modules.
3. **Agent-Authored Runtime Library ([`apps/agent-pal/src/argon-pure-lib.js`](../../apps/agent-pal/src/argon-pure-lib.js))**:
   - Authored and iteratively evolved by the agent during the playthrough inside `run_code`:
     - `global.goTo(x, y, opts)`: Wraps `nav.walk_to` with a 40-step closed-loop recovery state machine that automatically handles mid-path random encounters, story dialogs, and blocking `triggerMode >= 5` monsters.
     - `global.talk(id, opts)`: Wraps `nav.interact` with automatic post-interaction dialog/battle draining.
     - `global.equip(itemName, targetMemberIdx)`: Pure-L0 menu state machine (`CMSG_KEY("Menu")` $\to$ `CMSG_CHOICE(1)` $\to$ `CMSG_CHOICE(1)` $\to$ item selection $\to$ member selection $\to$ `closeMenus()`).
     - `global.drain(opts)`: Unified convergence loop handling `dialog` (`pal.advance`), `anykey` (`pal.press('Search')` for `0x004D` screens), `battle` (`global.fightBattle`), and `busy` (`pal.wait`).
     - `global.fightBattle(opts)`: 478-line multi-actor tactical combat engine with per-round action deduplication (`healedThisRound`, `revivedThisRound`, `mpRefilledThisRound`), real-time `SMSG_BATTLE_EVENT` HP tracking, and boss-specific mechanics.

---

## 3. Comparison: Agent-Authored `--pure` Toolkit vs. Built-in `assist` (L1) Toolkit

| Dimension | Built-in `assist` L1 Toolkit ([`src/agent.mjs`](../../apps/agent-pal/src/agent.mjs)) | Agent-Authored `--pure` Toolkit ([`src/argon-pure-lib.js`](../../apps/agent-pal/src/argon-pure-lib.js)) |
| :--- | :--- | :--- |
| **Engine Visibility** | **White-box**: Reads `worldService` memory, script table opcodes (`0x001B`–`0x0022`, `0x0039`), and internal wait stack (`waitsSvc().top()`). Directly mutates player facing and menu cursor indices. | **Black-box (L0 Protocol)**: Reconstructs state purely from `SMSG_*` packets and dispatches `CMSG_*` commands. |
| **Navigation & Interruption Recovery** | `walk_to` aborts and returns to the LLM whenever a battle or dialog interrupts movement. | `global.goTo` automatically fights interrupting battles, drains dialogs, clears blocking `triggerMode >= 5` monsters, and resumes pathfinding to `(x, y)` in a single call. |
| **Combat Automation** | `grindTurn` (32 lines) only supports basic healing (`< 45%` HP), AoE spells, and normal attacks; forbids `乾坤一擲`, throws, `隱蠱`, `酒神`, and status buffs. | `global.fightBattle` (478 lines) coordinates multi-member healing/revival without duplicate casts, manages `隱蠱` stealth windows, refreshes `真元護體` (`50%` damage reduction), chains `雪蓮子` + `酒神`, and adapts to scripted/elemental bosses. |
| **Equipment & Menus** | Directly sets internal menu cursor via `probes.menu.setIndex(idx)`. | Drives the in-game menu hierarchy via `CMSG_KEY("Menu")` and `CMSG_CHOICE(idx)`. |

---

## 4. Playthrough Milestones (`Slots 1–99`)

All 99 save slots (`AGENT-PAL-META-1` through `AGENT-PAL-META-99`) were generated deterministically under `--seed 1`:

| Chapter | Scenes | Highlights & Bosses Defeated | Save Slots |
| :--- | :--- | :--- | :--- |
| **Ch. 1: 餘杭鎮 & 仙靈島** | `Scenes 1–19` | `破天鎚`, 6-statue puzzle, `趙靈兒` joins, `苗人頭領 ×3`, learned `御劍術` | `Slots 1–6` |
| **Ch. 2: 蘇州城 & 隱龍窟** | `Scenes 20–56` | `林月如` duel, `比武招親`, `蛇妖男` & `狐妖女` | `Slots 7–19` |
| **Ch. 3: 白河村、玉佛寺、將軍塚、鬼陰山** | `Scenes 57–83` | `智修大師` (`玉佛珠`), `鬼將軍`, `赤鬼王` (`土靈珠`), `石長老` (scripted) | `Slots 20–29` |
| **Ch. 4: 揚州城 & 蛤蟆山** | `Scenes 84–108` | `女飛賊` / `姬三娘`, `金蟾鬼母` & `蛤蟆精` (`五毒珠`) | `Slots 30–36` |
| **Ch. 5: 京城 & 蜘蛛森林** | `Scenes 109–142` | `彩依`, `毒娘子` (`雷靈珠`), `酒劍仙` ritual | `Slots 37–39` |
| **Ch. 6: 蜀山 & 鎖妖塔** | `Scenes 143–172` | `鎮獄明王`, 7 pillar dragons (`七星磐龍柱`), rescued `趙靈兒` | `Slots 40–49` |
| **Ch. 7: 聖姑家、神木林、火麒麟洞** | `Scenes 173–204` | `阿奴` joins, `鳳凰` (`風靈珠`), `火眼麒麟` (`火靈珠` & `麒麟角`) | `Slots 50–70` |
| **Ch. 8: 十年前南詔國** | `Scenes 217–256` | `巫后` escort, `水魔獸`, obtained `水靈珠` | `Slots 71–89` |
| **Ch. 9: 試煉窟 & 女媧遺跡** | `Scenes 195–234` | Collected `36隻傀儡蟲`, learned `武神` / `風神` / `雷神` / `山神` / `雪妖` | `Slots 90–93` |
| **Ch. 10: 五靈珠祈雨祭壇** | `Scenes 174, 259–291` | Revived `趙靈兒`, solved 5-pearl altar, defeated `地魔獸` | `Slots 94–96` |
| **Ch. 11: 無底深淵、南詔王宮、拜月教主 & 結局** | `Scenes 291–278, 281` | Defeated `殿前侍衛`, `巫后` (illusion), `雙頭怪`, `樹妖`, and **Final Boss `拜月教主` (`32,760 HP`)**; completed full ending (`4342..4434`) | `Slots 97–99` |

---

## 5. Final Boss (`拜月教主`, `32,760 HP`) Zero-Death Victory Analysis

- **Preparation (`Slot 98`)**:
  - Cleared `Scene 278` (`2× 巫王侍衛` + `樹妖`, `+15,000 EXP`) to reach **`李逍遙 Lv42` (`738 HP / 597 MP`)**, **`趙靈兒 Lv35` (`691 HP / 458 MP`)**, **`阿奴 Lv40` (`654 HP / 562 MP`)**.
  - Equipped **`風靈珠`** (`+50%` Wind resistance) on **`趙靈兒`** via `global.equip('風靈珠', '趙靈兒')`.
- **Execution (`battle 81` $\to$ `Slot 99`)**:
  - **Round 1**: `李逍遙` uses `隱蠱` (3 rounds of party stealth), `趙靈兒` casts `武神`, `阿奴` casts `乾坤一擲` (`32,760` $\to$ `30,715 HP`).
  - **Rounds 2–4**: `李逍遙` casts `真元護體` (`PlayerStatus.Protect`, halving all physical and magic damage for 8 rounds) on himself, `阿奴`, and `趙靈兒` before stealth expires, while `趙靈兒` and `阿奴` reduce `拜月教主` to `22,539 HP`.
  - **Rounds 5–7**: `李逍遙` casts `酒神` #1 (`mp=579`, `-4,837 HP`), `趙靈兒` feeds `雪蓮子` (`+400 MP`) to `李逍遙`, and `李逍遙` casts `酒神` #2 (`mp=420`, `-3,572 HP`), bringing `拜月教主` down to `7,225 HP`.
  - **Rounds 8–11**: `李逍遙` throws `雙龍劍` and `無影毒` and refreshes `真元護體`, `趙靈兒` maintains party HP with `五氣朝元` / `觀音咒`, and `阿奴` finishes `拜月教主` (`7,225` $\to$ `0 HP`) with `乾坤一擲` and `爆炸蠱` (**`0` deaths**, `+30,000 EXP`, final party: **`李逍遙 Lv43`**, **`趙靈兒 Lv37`**, **`阿奴 Lv42`**).
