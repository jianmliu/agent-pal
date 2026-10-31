#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const API_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic/v1/messages';
const AUTH_TOKEN = fs.readFileSync('/Volumes/T7-Data/pal/bailian.txt', 'utf8').trim();
const MODEL = 'deepseek-v4.1-flash';
const HTTP_PORT = 8089;
const LOG_DIR = '/Volumes/T7-Data/pal/agent-pal/runs/deepseek-pure';
const SAVES_FILE = '/Volumes/T7-Data/pal/agent-pal/saves/deepseek-pure-saves.json';
const LIB_FILE = '/Volumes/T7-Data/pal/agent-pal/src/deepseek-pure-lib.js';
const RELAY_LOG = path.join(LOG_DIR, 'deepseek-relay.log');
const SUMMARY_JSON = path.join(LOG_DIR, 'deepseek-rounds.json');

const MAX_TOOLS_PER_ROUND = 80;
const MAX_PROMPT_TOKENS_PER_ROUND = 160000;
const MAX_OUTPUT_TOKENS = 8192;
const MAX_TOOL_RESULT_CHARS = 18000;
const PER_CALL_TIMEOUT_MS = 180000;

const UNIVERSAL_CYBERNETIC_PROTOCOL = `## Universal Agent Execution & Metacognitive Protocol

You are operating inside a closed-loop, stateful, partially observable environment. You must strictly adhere to the following 6 cybernetic execution laws at all times:

### Law 1: Closed-Loop Probing Over Open-Loop Speculation (Anti-Overthinking)
- This is an interactive closed-loop environment, NOT a static one-shot exam.
- **Rule**: Whenever static observation leaves >1 plausible hypothesis and a reversible or low-cost action can test them, **never spend more than 500 tokens speculating in Chain-of-Thought**. Immediately emit an epistemic probe action to let real environment feedback collapse the uncertainty.
- **Self-Doubt Circuit Breaker**: Once you have formulated a concrete action plan with valid coordinates/arguments, execute it immediately. Do NOT re-verify or second-guess the same plan more than once before acting.

### Law 2: Abstraction-Layer Inversion on Stagnation (Anti-Looping)
- Monitor \`stagnant_rounds_in_current_cluster\` in \`[HARNESS_TELEMETRY]\`.
- **Theorem**: If repeated calls to your self-written helper functions, parsers, or search routines fail to produce a novel state transition for >= 3 consecutive cycles, **the bug is inside your own abstraction layer** (e.g., an unhandled opcode/schema variant, an off-by-one offset, or an overly broad blacklist filter that masked a valid transition edge).
- **Mandatory Action when Stagnant**:
  1. **STOP** calling your existing high-level navigation/execution wrappers.
  2. Drop down to raw primitives and dump the **unfiltered, raw ground-truth data** for the current state/region.
  3. Diff the raw data against what your helper parser/filter recognized to find the exact transition edge your code ignored or blacklisted.

### Law 3: Sensor Calibration Under Deferred or Batched Feedback (Causal Attribution)
- Do NOT blindly assume every tool call produces an immediate, atomic state delta (\`delta_S_t\`). Many stateful environments use **queued/batched execution**, **asynchronous state commits**, or **coupled multi-actor outputs** (\`delta_Y = x_1 + x_2 + ... + x_k\`).
- **Rule**: If an action appears to produce zero immediate change (\`delta = 0\`), first verify whether the environment is waiting for a batch/turn commit before concluding the action is "ineffective/immune" or repeating duplicate consumable actions in the same batch.
- When measuring individual effect sizes in a coupled batch (\`delta_Y = sum(x_i)\`), use **control-variable isolation** (hold k-1 inputs at known/zero anchors and vary 1 input at a time).

### Law 4: Monotonic Policy Evolution Across Retries (Anti-Catastrophic Forgetting)
- When retrying after a failure or rollback, always inspect \`best_historical_trajectory\` in \`[HARNESS_TELEMETRY]\` before modifying your strategy.
- **Decomposition Rule**: Explicitly separate your reflection into two lists:
  1. **Validated Core Invariants (MUST KEEP)**: The exact sequence of actions/setup that enabled your \`best_historical_trajectory\` to reach its peak progress metric.
  2. **Local Failure Patch (TO MODIFY)**: The specific late-stage error that caused the most recent attempt to fail.
- **Constraint**: Your next policy \`P_{k+1}\` must preserve 100% of the Validated Core Invariants from \`P_best\` and only apply targeted patches to the failure point. Never discard a proven high-leverage setup due to recency bias from the latest attempt.

### Law 5: Post-Failure Capability Space Re-Enumeration (Anti-Policy Inertia)
- Long-horizon tasks accumulate new tools, resources, permissions, and state capabilities over time that did not exist when you wrote your early default routines.
- **Mandatory Action on Hard Failure / Rollback (\`consecutive_rollbacks_or_failures >= 1\`)**:
  - You are **FORBIDDEN** from re-running your existing default execution routine unchanged.
  - Before retrying, execute an audit script that enumerates **100% of your currently available capabilities, resources, inventory, and high-power operations** in the live state, diffs them against the subset actually used by your failing routine, and synthesizes an upgraded policy utilizing your highest-leverage unused capabilities.

### Law 6: Amortized Batch Execution & Structured State Ledgers (Action Density)
- If you have access to a programmatic execution tool (e.g., \`run_code\` / script runner), do NOT use it as a single-step REPL.
- Package repetitive micro-steps into guarded multi-step loops with explicit termination conditions (\`novel_state_reached\`, \`unexpected_mode\`, or \`max_steps\`).
- Maintain a persistent, structured **State & Hypothesis Ledger** on \`global.__harnessLedger\` (\`visited_states\`, \`tested_hypotheses\`, \`blacklisted_edges_with_reasons\`) so context resets never cause you to re-test falsified paths.`;

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(path.dirname(SAVES_FILE), { recursive: true });

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(RELAY_LOG, line);
}

async function rpc(method, params = {}) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      });
      return await res.json();
    } catch (e) {
      if (i === 4) throw e;
      await sleep(2000);
    }
  }
}

async function mcpCall(method, params = {}) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      });
      return await res.json();
    } catch (e) {
      if (i === 4) throw e;
      await sleep(2000);
    }
  }
}

async function getTools() {
  const r = await mcpCall('tools/list', {});
  const tools = r?.result?.tools || [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    input_schema: t.inputSchema || { type: 'object', properties: {} }
  }));
}

async function callMcpTool(name, args = {}) {
  const r = await mcpCall('tools/call', { name, arguments: args });
  const content = r?.result?.content;
  let text = '';
  if (Array.isArray(content)) {
    text = content.map((c) => c.text || '').join('\n');
  } else if (typeof content === 'string') {
    text = content;
  } else {
    text = JSON.stringify(r?.result ?? r?.error ?? {});
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    const half = Math.floor(MAX_TOOL_RESULT_CHARS / 2) - 100;
    text = `${text.slice(0, half)}\n... [truncated ${text.length - MAX_TOOL_RESULT_CHARS} chars] ...\n${text.slice(-half)}`;
  }
  return text;
}

async function getLiveStatus() {
  try {
    const r = await rpc('pal.run_code', {
      code: `
        await pal.observe();
        return {
          mode: pal.world.mode,
          scene: pal.world.scene,
          map: pal.world.map,
          player: pal.world.player,
          party: pal.world.members.map(m => \`\${m.name} Lv\${m.level} HP:\${m.hp}/\${m.maxHp} MP:\${m.mp}/\${m.maxMp}\`),
          cash: pal.world.cash,
          itemsCount: (pal.world.items || []).length,
          lastBattleResult: pal.world.lastBattleResult || null,
          gameOver: !!pal.world.gameOver,
          globalKeys: Object.keys(global),
          notes: global.notes || null,
          harnessLedger: global.__harnessLedger || null,
          completedEnding: !!global.completedEnding
        };
      `,
      timeout_ms: 10000
    });
    const text = r?.result?.content?.[0]?.text;
    const parsed = text ? JSON.parse(text) : null;
    const savesRes = await rpc('pal.list_saves', {});
    const savesText = savesRes?.result?.content?.[0]?.text || '';
    return { status: parsed?.result || parsed?.world || {}, savesText };
  } catch (e) {
    return { status: { error: String(e) }, savesText: '' };
  }
}

function computeHarnessTelemetry(rounds, liveStatus) {
  const { status, savesText } = liveStatus;
  const saveLines = (savesText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const currentScene = status?.scene ?? null;

  const recent8 = rounds.slice(-8);
  const state_fingerprint_history = recent8.map((r) => {
    const pCount = Array.isArray(r.partyAfter) ? r.partyAfter.length : 0;
    const sCount = (r.savesText || '').split('\n').filter(Boolean).length;
    return `R${r.round}:S${r.sceneAfter ?? '?'}_P${pCount}_Saves${sCount}`;
  });
  state_fingerprint_history.push(
    `Live:S${currentScene ?? '?'}_P${(status?.party || []).length}_Saves${saveLines.length}`
  );

  const recent15 = rounds.slice(-15);
  const state_visitation_histogram = {};
  for (const r of recent15) {
    const key = `S${r.sceneAfter ?? '?'}`;
    state_visitation_histogram[key] = (state_visitation_histogram[key] || 0) + 1;
  }

  // Count consecutive rounds trapped in a small cluster of scenes without advancing max scene
  let stagnant_rounds_in_current_cluster = 0;
  const clusterSet = new Set(currentScene != null ? [currentScene] : []);
  for (let i = rounds.length - 1; i >= 0; i--) {
    const sc = rounds[i].sceneAfter;
    if (sc == null) break;
    if (clusterSet.has(sc) || (clusterSet.size < 4 && Math.abs(sc - (currentScene || sc)) <= 12)) {
      clusterSet.add(sc);
      stagnant_rounds_in_current_cluster++;
    } else {
      break;
    }
  }

  // Detect consecutive rollbacks/failures (e.g. gameOver, defeat, or repeated failed boss attempts at same save slot)
  let consecutive_rollbacks_or_failures = 0;
  if (status?.gameOver || status?.lastBattleResult === 'defeat') {
    consecutive_rollbacks_or_failures++;
  }
  for (let i = rounds.length - 1; i >= Math.max(0, rounds.length - 6); i--) {
    const r = rounds[i];
    const h = String(r.handover || '').toLowerCase();
    const sameScene = r.sceneAfter === currentScene;
    const mentionFail =
      h.includes('gameover') ||
      h.includes('game over') ||
      h.includes('wiped') ||
      h.includes('defeat') ||
      h.includes('lost') ||
      h.includes('failed') ||
      h.includes('團滅') ||
      h.includes('团灭') ||
      h.includes('戰敗') ||
      h.includes('战败');
    if (sameScene && (mentionFail || stagnant_rounds_in_current_cluster >= 2)) {
      consecutive_rollbacks_or_failures++;
    } else {
      break;
    }
  }

  // Identify best historical trajectory across all rounds
  let bestRound = null;
  for (const r of rounds) {
    if (
      !bestRound ||
      (r.sceneAfter || 0) > (bestRound.sceneAfter || 0) ||
      ((r.sceneAfter || 0) === (bestRound.sceneAfter || 0) &&
        (r.savesText || '').length > (bestRound.savesText || '').length)
    ) {
      bestRound = r;
    }
  }
  const best_historical_trajectory = bestRound
    ? {
        round: bestRound.round,
        peak_state_id: bestRound.sceneAfter,
        party_summary: bestRound.partyAfter || [],
        handover_excerpt: String(bestRound.handover || '').slice(0, 360)
      }
    : null;

  const recent5 = rounds.slice(-5);
  const avg_tool_calls_per_round = recent5.length
    ? Number((recent5.reduce((a, r) => a + (r.toolCalls || 0), 0) / recent5.length).toFixed(1))
    : 0;

  const active_circuit_breakers = [];
  if (stagnant_rounds_in_current_cluster >= 3) {
    active_circuit_breakers.push(
      `⚠️ [CIRCUIT BREAKER — LAW 2: ABSTRACTION-LAYER INVERSION] You have remained inside state cluster {${[...clusterSet].join(', ')}} for ${stagnant_rounds_in_current_cluster} consecutive rounds without a novel state transition. Your existing high-level helpers/parsers on global have an unhandled opcode, offset error, or overly broad filter. STOP calling your existing navigation/search wrapper unchanged! Dump raw unfiltered ground-truth data and diff what your parser ignored or blacklisted.`
    );
  }
  if (consecutive_rollbacks_or_failures >= 1) {
    active_circuit_breakers.push(
      `⚠️ [CIRCUIT BREAKER — LAW 4 & LAW 5: POST-FAILURE CAPABILITY RE-ENUMERATION] You have experienced ${consecutive_rollbacks_or_failures} consecutive failure/rollback cycle(s) at the current state. You are FORBIDDEN from re-running your default execution/combat routine unchanged! Before retrying, write an audit script in run_code that enumerates 100% of your currently available capabilities, resources, inventory items, cash-based skills, and protective/stealth states, diffs them against what your failing routine actually used, and synthesizes a high-leverage policy.`
    );
  }
  if (avg_tool_calls_per_round >= 45) {
    active_circuit_breakers.push(
      `⚠️ [CIRCUIT BREAKER — LAW 6: ACTION DENSITY ALERT] Your recent average tool call count is ${avg_tool_calls_per_round} calls/round. Avoid single-step REPL micro-calls; batch repetitive multi-step sequences into guarded async loops inside run_code.`
    );
  }

  return {
    state_fingerprint_history,
    state_visitation_histogram,
    stagnant_rounds_in_current_cluster,
    consecutive_rollbacks_or_failures,
    best_historical_trajectory,
    avg_tool_calls_per_round,
    active_circuit_breakers
  };
}

function isPlaythroughComplete(status, savesText) {
  if (status?.completedEnding && savesText.includes('99')) return true;
  if (fs.existsSync(SAVES_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SAVES_FILE, 'utf8'));
      if (raw['PAL-SAVE-99'] && raw['PAL-SAVE-98']) {
        const meta99 = raw['AGENT-PAL-META-99'] ? JSON.parse(raw['AGENT-PAL-META-99']) : null;
        if (meta99 && meta99.scene === 281) return true;
      }
    } catch {}
  }
  return false;
}

function buildPrompt(round, liveStatus, lastAssistantText, rounds = []) {
  const { status, savesText } = liveStatus;
  const telemetry = computeHarnessTelemetry(rounds, liveStatus);
  const circuitBreakerBlock = telemetry.active_circuit_breakers.length
    ? `\n### 🚨 ACTIVE HARNESS CIRCUIT BREAKERS (MANDATORY COMPLIANCE)\n${telemetry.active_circuit_breakers.map((c) => `- ${c}`).join('\n')}\n`
    : '';

  return `You are playing the classic 1995 DOS RPG 《仙劍奇俠傳》 (Chinese Paladin) in **--pure** mode from start ("新的故事", Scene 1) to full game completion (Scene 281, defeating the final boss 拜月教主 32,760 HP and advancing through the full ending sequence 4342..4434).

### [HARNESS_TELEMETRY] (Objective Runtime Signals)
\`\`\`json
${JSON.stringify(
  {
    round,
    state_fingerprint_history: telemetry.state_fingerprint_history,
    state_visitation_histogram: telemetry.state_visitation_histogram,
    stagnant_rounds_in_current_cluster: telemetry.stagnant_rounds_in_current_cluster,
    consecutive_rollbacks_or_failures: telemetry.consecutive_rollbacks_or_failures,
    best_historical_trajectory: telemetry.best_historical_trajectory,
    avg_tool_calls_per_round: telemetry.avg_tool_calls_per_round
  },
  null,
  2
)}
\`\`\`
${circuitBreakerBlock}
${UNIVERSAL_CYBERNETIC_PROTOCOL}

### Current Relay Round: ${round}
- Live Game State: ${JSON.stringify(status)}
- Current Save Slots:
${savesText || '(none yet)'}
${lastAssistantText ? `- Your handover summary from the end of the previous round:\n${lastAssistantText.slice(-9000)}\n` : ''}

### --pure Mode Architecture & Self-Coding Environment
In \`--pure\` mode, you do NOT have built-in L1 assistive tools (\`grind\`, \`equip\`, \`cast\`, \`guide\`, \`map\`, \`atlas\`, \`panorama\`). Instead, you have:
1. \`run_code\`: Execute an async JavaScript function body with \`pal\`, \`global\`, \`args\`, \`console\` in scope (pass \`timeout_ms: 120000\` for long routines).
   - **Persistent \`global\`**: Everything you attach to \`global\` (e.g., \`global.step\`, \`global.clear\`, \`global.fight\`, \`global.walkTo\`, \`global.interact\`, \`global.grind\`, \`global.equipAll\`, \`global.sceneInfo\`, \`global.__harnessLedger\`) stays in memory across \`run_code\` calls and across relay rounds!
   - **Save your library to disk**: Whenever you create or update your helper library on \`global\`, also write/append a clean copy of your reusable helper library to \`${LIB_FILE}\` using \`pal.fs.writeFileSync\` or \`pal.fs.appendFileSync\`. Do NOT read any other files in \`src/\` — write all helpers yourself from scratch using only \`pal.readData(...)\` and live \`pal.world\` observations.
   - **Inside \`run_code\`, \`pal\` provides**:
     - \`pal.world\`: live world model updated on every SMSG (\`scene\`, \`map\`, \`mode\`, \`player: {gx,gy,facing}\`, \`gx\`, \`gy\`, \`facing\`, \`objects\` Map, \`objectList\` Array, \`members\` Array of \`{roleId,name,level,hp,maxHp,mp,maxMp,magics}\`, \`items\` Array of \`{item,name,amount,use,throw,equip}\`, \`cash\`, \`dialog\`, \`recentDialogs\`, \`menu\`, \`battle\`, \`lastBattleResult\`, \`gameOver\`).
     - \`await pal.observe()\`: refreshes \`pal.world\`.
     - \`await pal.step(dir, steps)\`: \`CMSG_MOVE\` (\`dir\` in \`['up','down','left','right']\`, \`up = y-1, down = y+1, left = x-1, right = x+1\`).
     - \`await pal.interact()\`: \`CMSG_INTERACT\`.
     - \`await pal.advance(max)\`: \`CMSG_DIALOG_ADVANCE\` loop while mode is \`dialog\`.
     - \`await pal.choose(index)\`: \`CMSG_CHOICE\`.
     - \`await pal.battle(type, extra)\`: \`CMSG_BATTLE_ACTION\` where \`type\` is \`'attack' | 'defend' | 'flee' | 'repeat' | 'auto' | 'magic' | 'item' | 'throw' | 'combo'\` and \`extra\` is \`{ target, magic, item }\`.
     - \`await pal.useItem(item, target)\`: \`CMSG_MENU_USE_ITEM\` (works for healing/consumable items in \`control\` mode; NOTE: to equip weapons/armor or use story key items that check script/equipment, either use the raw game menu via \`pal.press('Menu')\` / \`pal.press('UseItem')\` or \`await pal.invoke('nav__use_item', { item, target, facing })\`).
     - \`await pal.press(key, ms)\`: \`CMSG_KEY\` (\`Up\`, \`Down\`, \`Left\`, \`Right\`, \`Search\`, \`Menu\`, \`UseItem\`, \`ThrowItem\`, \`Force\`, \`Status\`, \`Auto\`, \`Defend\`, \`Flee\`, \`Repeat\`).
     - \`await pal.wait(ms)\`: \`CMSG_WAIT\`.
     - \`await pal.save(slot, note)\` / \`await pal.load(slot)\` (only in \`control\` mode).
     - \`await pal.invoke('nav__walk_to', { x, y })\`, \`await pal.invoke('nav__interact', { id })\`, \`await pal.invoke('nav__use_item', { item, target, facing })\`, \`await pal.invoke('nav__view', {})\`: calls the L2 \`nav\` module from inside \`run_code\`!
     - \`await pal.readData(relPath)\`: reads static game data JSON from \`pal-data/\` (inspect \`manifest.json\` first to see exact filenames such as \`scenes.json\`, \`event-objects.json\`, \`objects.json\`, \`scripts.json\`, \`script-entries.json\`, \`stores.json\`, \`enemy-teams.json\`, \`party.json\`, \`level-up.json\`, \`maps/<mapNum>.json\`).

### Essential Engineering & Gameplay Tips
1. **Title Screen**: If \`mode === 'menu'\` and \`scene === null\` or \`1\` at the title screen ("新的故事" / "舊的回憶"), call \`await pal.choose(0)\` and settle dialogs/waits to start the new game in Scene 1 (李逍遙房).
2. **Build & Use \`global\` Helpers in \`run_code\`**:
   - Do as much work per \`run_code\` call as possible (each \`run_code\` call can run a multi-step sequence up to \`timeout_ms: 120000\`).
   - Always handle unexpected \`dialog\`, \`menu\`, \`busy\`, or \`battle\` states inside your navigation/interaction helpers so your scripts never get stuck.
   - If \`pal.world.gameOver\` occurs or a boss wipes the party, immediately reload your latest save slot (\`await pal.load(slot)\`), then apply **Law 5 (Post-Failure Capability Space Re-Enumeration)** before retrying! Save frequently to numbered slots (1, 2, 3, ...) before bosses and after chapters!
3. **Inspection via \`pal.readData\`**:
   - Never guess coordinates or trigger conditions blindly! Write a helper on \`global\` that inspects the current scene's objects from \`pal.world.objectList\` enriched with \`event-objects.json\`, \`objects.json\`, and \`scripts.json\` so you can see exact coordinates \`(gx, gy)\`, trigger mode (\`touch\` vs \`search\`), destination scene (\`0059\`) or intra-scene coordinate warp (\`0046\` / \`0070\` / \`0044\` / \`006E\`), or required script flags.
4. **Final Goal & Completion Verification**:
   - Progress all the way through the story: 余杭鎮 -> 仙靈島 -> 盛漁村 -> 蘇州 -> 隱龍窟 -> 白河村 -> 玉佛寺 -> 黑水鎮 -> 將軍塚 -> 血池 -> 鬼陰山 -> 揚州 -> 蛤蟆洞 -> 京城 -> 蜀山 -> 鎖妖塔 -> 神木林 -> 桃源村 -> 大理城 -> 試煉窟/女媧神殿 -> 十年前南紹 -> 聖姑家 -> 南紹王宮地牢 -> 水底迷宮 -> Scene 281 (拜月水魔獸合體 / 拜月教主 32,760 HP).
   - **Save \`Slot 98\`** right before interacting with the final boss in Scene 281.
   - Defeat \`拜月教主\` in Scene 281, then advance through the entire post-boss ending sequence (\`4342..4434\`: \`busy\`/\`dialog\`/\`wait\`/\`anykey\` until the ending frames finish), and **save \`Slot 99\`** (and set \`global.completedEnding = true\`).

Now, inspect \`[HARNESS_TELEMETRY]\` and any active circuit breakers, build/refine your \`global\` helper library (and persist it to \`${LIB_FILE}\`), and drive the playthrough forward through as many chapters as you can in this round! Do NOT stop early — keep playing continuously until you finish the game or reach the turn limit.`;
}

async function anthropicCompletion(system, messages, tools) {
  let lastErr;
  for (let attempt = 0; attempt <= 5; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
      try {
        const body = {
          model: MODEL,
          system,
          messages,
          ...(tools && tools.length ? { tools } : {}),
          max_tokens: MAX_OUTPUT_TOKENS
        };
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': AUTH_TOKEN,
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const text = await res.text();
        if (res.status === 429 && text.includes('AllocationQuota')) {
          throw new Error(`FATAL_QUOTA_EXHAUSTED: ${text.slice(0, 300)}`);
        }
        if (res.status === 429 || res.status >= 500) {
          throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`), { retry: true });
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
        }
        return JSON.parse(text);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (String(err?.message || '').includes('FATAL_QUOTA_EXHAUSTED')) {
        throw err;
      }
      logLine(`[DeepSeek retry ${attempt + 1}/6] ${err?.message || err}`);
      if (attempt < 5) await sleep(3000 * 2 ** Math.min(attempt, 4));
    }
  }
  throw lastErr;
}

async function runSingleRound(round, prompt) {
  const t0 = Date.now();
  logLine(`=== Starting Round ${round} (${MODEL} via Bailian Anthropic API) ===`);

  const system = `You are an autonomous game-playing software engineer operating Agent-PAL in --pure mode. Always prefer calling \`run_code\` to inspect bytecode/data tables, evolve \`global.*\` helpers, and automate multi-step gameplay.\n\n${UNIVERSAL_CYBERNETIC_PROTOCOL}`;
  const messages = [
    {
      role: 'user',
      content: prompt
    }
  ];

  let lastAssistantText = '';
  const recentThoughts = [];
  let toolCalls = 0;
  let runCodeCalls = 0;
  let textOnlyStreak = 0;
  let lastResultSignature = '';
  let identicalResultStreak = 0;
  let usage = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_chars: 0
  };

  while (toolCalls < MAX_TOOLS_PER_ROUND) {
    const tools = await getTools();
    let resp;
    try {
      resp = await anthropicCompletion(system, messages, tools);
    } catch (err) {
      logLine(`[DeepSeek R${round} fatal API error] ${err?.message || err}`);
      if (String(err?.message || '').includes('FATAL_QUOTA_EXHAUSTED')) {
        throw err;
      }
      break;
    }

    const u = resp?.usage || {};
    const promptTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const cachedTok = u.cache_read_input_tokens || u.prompt_tokens_details?.cached_tokens || 0;
    const compTok = u.output_tokens || 0;
    usage.input_tokens += promptTok;
    usage.cached_input_tokens += cachedTok;
    usage.output_tokens += compTok;

    const contentBlocks = Array.isArray(resp?.content) ? resp.content : [];
    const toolUses = [];

    for (const b of contentBlocks) {
      if (b.type === 'thinking' && b.thinking) {
        usage.reasoning_chars += b.thinking.length;
        recentThoughts.push(b.thinking.replace(/\s+/g, ' ').slice(0, 400));
        if (recentThoughts.length > 6) recentThoughts.shift();
        logLine(`[DeepSeek R${round} think] ${b.thinking.replace(/\s+/g, ' ').slice(0, 280)}`);
      } else if (b.type === 'text' && b.text) {
        lastAssistantText = b.text;
        logLine(`[DeepSeek R${round} text] ${b.text.replace(/\s+/g, ' ').slice(0, 320)}`);
      } else if (b.type === 'tool_use') {
        toolUses.push(b);
      }
    }

    messages.push({
      role: 'assistant',
      content: contentBlocks
    });

    if (!toolUses.length) {
      textOnlyStreak++;
      const check = await getLiveStatus();
      if (isPlaythroughComplete(check.status, check.savesText)) {
        logLine(`[DeepSeek R${round}] Playthrough complete detected during text turn!`);
        break;
      }
      if (textOnlyStreak >= 3) {
        logLine(`[DeepSeek R${round}] 3 consecutive text-only turns; ending round ${round}.`);
        break;
      }
      messages.push({
        role: 'user',
        content: 'Do not stop early — call `run_code` to continue advancing the story, fighting bosses, saving slots, and progressing toward Scene 281 (Slot 98 & Slot 99).'
      });
      continue;
    }

    textOnlyStreak = 0;
    const toolResults = [];
    for (const tu of toolUses) {
      toolCalls++;
      const fnName = tu.name || '';
      if (fnName === 'run_code') runCodeCalls++;
      const parsedArgs = tu.input || {};
      const preview = JSON.stringify(parsedArgs).replace(/\s+/g, ' ').slice(0, 220);
      logLine(`[DeepSeek R${round} tool #${toolCalls}] ${fnName} ${preview}`);

      let resText = await callMcpTool(fnName, parsedArgs);
      logLine(`[DeepSeek R${round} tool_result #${toolCalls}] ${resText.replace(/\s+/g, ' ').slice(0, 280)}`);

      // Intra-round Harness Runtime Circuit Breakers (Law 2 & Law 5)
      const sig = resText.slice(0, 300);
      if (sig === lastResultSignature) {
        identicalResultStreak++;
      } else {
        lastResultSignature = sig;
        identicalResultStreak = 0;
      }

      const lowerRes = resText.toLowerCase();
      if (
        lowerRes.includes('"gameover":true') ||
        lowerRes.includes('"gameover": true') ||
        lowerRes.includes('"lastbattleresult":"defeat"') ||
        lowerRes.includes('battle over: lost')
      ) {
        resText += `\n\n[HARNESS RUNTIME CIRCUIT BREAKER — LAW 4 & LAW 5]: Hard failure / rollback detected! You are FORBIDDEN from re-running your existing default combat/execution routine unchanged. Before retrying, write a script to enumerate 100% of your currently available capabilities in pal.world (all member magics, all inventory items including stealth/throwable/buff items, and cash skills), diff them against what your failing routine used, and upgrade your policy to use your highest-leverage capabilities.`;
      } else if (identicalResultStreak >= 2) {
        resText += `\n\n[HARNESS RUNTIME CIRCUIT BREAKER — LAW 2]: Your last ${identicalResultStreak + 1} tool calls returned an identical state signature. Stop calling the same high-level helper/wrapper with the same assumptions! Inspect the raw unfiltered data/scripts to find the missing transition edge or overly broad filter.`;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: resText
      });
    }

    logLine(`[DeepSeek R${round} turn.completed] tools=${toolCalls} prompt=${promptTok} cached=${cachedTok} totalIn=${usage.input_tokens} totalCached=${usage.cached_input_tokens} totalOut=${usage.output_tokens}`);

    if (toolCalls % 5 === 0) {
      const check = await getLiveStatus();
      if (isPlaythroughComplete(check.status, check.savesText)) {
        messages.push({ role: 'user', content: toolResults });
        logLine(`[DeepSeek R${round}] Playthrough complete detected after tool #${toolCalls}!`);
        break;
      }
    }

    if (promptTok >= MAX_PROMPT_TOKENS_PER_ROUND || toolCalls >= MAX_TOOLS_PER_ROUND) {
      logLine(`[DeepSeek R${round}] Reached round limit (tools=${toolCalls}, prompt=${promptTok}); requesting handover summary before rotating to Round ${round + 1}.`);
      try {
        messages.push({
          role: 'user',
          content: [
            ...toolResults,
            {
              type: 'text',
              text: `Relay Round ${round} has reached its turn budget. Write a concise handover summary for Round ${round + 1} covering: (1) current scene/position and story milestone reached, (2) key global.* helpers you built and how to call them, (3) any map/script discoveries, and (4) the exact next story steps to execute first in Round ${round + 1}.`
            }
          ]
        });
        const sumResp = await anthropicCompletion(system, messages, []);
        const sumU = sumResp?.usage || {};
        usage.input_tokens += (sumU.input_tokens || 0) + (sumU.cache_read_input_tokens || 0) + (sumU.cache_creation_input_tokens || 0);
        usage.cached_input_tokens += sumU.cache_read_input_tokens || sumU.prompt_tokens_details?.cached_tokens || 0;
        usage.output_tokens += sumU.output_tokens || 0;
        const sumBlocks = Array.isArray(sumResp?.content) ? sumResp.content : [];
        const sumText = sumBlocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n');
        if (sumText) {
          lastAssistantText = sumText;
          logLine(`[DeepSeek R${round} handover] ${sumText.replace(/\s+/g, ' ').slice(0, 500)}`);
        }
      } catch (e) {
        logLine(`[DeepSeek R${round} handover error] ${e?.message || e}`);
      }
      break;
    }

    messages.push({
      role: 'user',
      content: toolResults
    });
  }

  if (!lastAssistantText || lastAssistantText.length < 80) {
    lastAssistantText = recentThoughts.join('\n');
  }

  const durationMs = Date.now() - t0;
  logLine(`=== Round ${round} finished (toolCalls=${toolCalls}, runCodeCalls=${runCodeCalls}, duration=${(durationMs / 1000).toFixed(1)}s) ===`);
  return { lastAssistantText, toolCalls, runCodeCalls, usage, durationMs };
}

async function main() {
  const rounds = fs.existsSync(SUMMARY_JSON)
    ? JSON.parse(fs.readFileSync(SUMMARY_JSON, 'utf8'))
    : [];
  let lastAssistantText = rounds[rounds.length - 1]?.handover || '';
  const startRound = rounds.length + 1;

  for (let round = startRound; round <= 600; round++) {
    let liveStatus = await getLiveStatus();
    if (!liveStatus.status?.scene || liveStatus.status?.mode === 'title' || (liveStatus.status?.mode === 'menu' && !liveStatus.status?.scene)) {
      let newestSlot = 78;
      try {
        const rawSaves = JSON.parse(fs.readFileSync(SAVES_FILE, 'utf8'));
        let bestAt = '';
        for (let i = 1; i <= 99; i++) {
          const raw = rawSaves[`AGENT-PAL-META-${i}`];
          if (!raw) continue;
          const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (m?.at && m.at > bestAt) {
            bestAt = m.at;
            newestSlot = i;
          }
        }
      } catch {}
      logLine(`Server is at title/scene 0 before Round ${round}; entering control mode, restoring newest Slot ${newestSlot}, and loading ${LIB_FILE}...`);
      await rpc('pal.run_code', {
        code: `
          await pal.observe();
          if (!pal.world.scene) {
            await pal.choose(1);
            await pal.wait(500);
            await pal.choose(4);
            await pal.wait(1500);
            await pal.observe();
          }
          if (pal.world.mode === 'control') {
            await pal.load(${newestSlot}).catch(() => {});
            await pal.observe();
          }
        `,
        timeout_ms: 15000
      });
      if (fs.existsSync(LIB_FILE)) {
        const libCode = fs.readFileSync(LIB_FILE, 'utf8');
        await rpc('pal.run_code', { code: `${libCode}\nreturn Object.keys(global).length;`, timeout_ms: 15000 });
      }
      liveStatus = await getLiveStatus();
    }
    logLine(`Live check before Round ${round}: scene=${liveStatus.status?.scene} mode=${liveStatus.status?.mode} party=${JSON.stringify(liveStatus.status?.party)}`);
    if (isPlaythroughComplete(liveStatus.status, liveStatus.savesText)) {
      logLine(`🎉 Playthrough COMPLETE! Slot 98 & Slot 99 verified.`);
      break;
    }
    const prompt = buildPrompt(round, liveStatus, lastAssistantText, rounds);
    const res = await runSingleRound(round, prompt);
    if (res.lastAssistantText) lastAssistantText = res.lastAssistantText;
    const afterStatus = await getLiveStatus();
    rounds.push({
      round,
      toolCalls: res.toolCalls,
      runCodeCalls: res.runCodeCalls,
      usage: res.usage,
      durationMs: res.durationMs,
      sceneAfter: afterStatus.status?.scene,
      partyAfter: afterStatus.status?.party,
      handover: res.lastAssistantText,
      savesText: afterStatus.savesText
    });
    fs.writeFileSync(SUMMARY_JSON, JSON.stringify(rounds, null, 2));
    if (isPlaythroughComplete(afterStatus.status, afterStatus.savesText)) {
      logLine(`🎉 Playthrough COMPLETE after Round ${round}!`);
      break;
    }
    await sleep(2000);
  }
}

main().catch((err) => {
  logLine(`Fatal error in DeepSeek relay runner: ${err?.stack || err}`);
  process.exit(1);
});
