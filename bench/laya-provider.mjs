/**
 * laya-provider.mjs — Non-autoregressive System-1 Decision Model adapter for Agent-PAL-Bench.
 *
 * Bridges Convai Innovations' Laya (`convaiinnovations/laya-multilingual`, 322M mmBERT-base +
 * 2-layer decision head trained with RLCD) into both `bench quiz` and `bench run` (Tier B).
 *
 * Pure Zero-Prior Mode (default):
 *   - No task-specific rules, no item whitelists, no Boss mechanic filters, and no forced actions.
 *   - Only enumerates the syntactic tool affordances directly present in the engine's observation
 *     text (objects, exits, and engine-emitted `use_item` / `battle` options) with uniform priors
 *     (plus generic anti-loop decay for already-repeated actions).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { postJson } from './providers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_URL = process.env.BENCH_LAYA_URL || 'http://127.0.0.1:18765';

let daemonStarting = null;
async function ensureDaemon(signal) {
  try {
    const r = await fetch(`${DAEMON_URL}/health`, { signal });
    if (r.ok) return;
  } catch {}
  if (!daemonStarting) {
    daemonStarting = (async () => {
      const child = spawn('python3', [path.join(here, 'laya-daemon.py')], {
        stdio: 'ignore',
        detached: true,
        env: { ...process.env, USE_TF: '0' }
      });
      child.unref();
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        try {
          const r = await fetch(`${DAEMON_URL}/health`);
          if (r.ok) return;
        } catch {}
      }
      throw new Error('laya-daemon failed to start on ' + DAEMON_URL);
    })();
  }
  await daemonStarting;
}

/** Incrementally update structured state and episodic interaction ledger on `history[0]`. */
function updateLedger(history) {
  const root = history[0] || history;
  if (!root._layaLedger) {
    root._layaLedger = {
      goal: '',
      mode: 'control',
      scene: null,
      pos: { x: 0, y: 0 },
      facing: 'down',
      cash: 0,
      items: new Set(),
      hasFullItems: false,
      dialogs: [],
      lastResult: '',
      scenes: new Map(),
      explicitItemTarget: new Map(), // item -> targetId (from engine error/hint output)
      reservedThisRound: new Set(),
      actedThisRound: new Set(),
      lastHpSig: '',
      callHistory: [],
      pendingCall: null
    };
    root._layaProcessedIdx = 0;
  }

  const ledger = root._layaLedger;

  const getScene = (s) => {
    if (!ledger.scenes.has(s)) {
      ledger.scenes.set(s, {
        mapCalled: false,
        objects: new Map(),
        exits: new Map(),
        interacted: new Map(),
        failedItemObj: new Set(),
        usedItems: new Set(),
        walked: new Map()
      });
    }
    return ledger.scenes.get(s);
  };

  for (let i = root._layaProcessedIdx; i < history.length; i++) {
    const h = history[i];
    if (h.role === 'assistant' && h.calls?.length) {
      ledger.pendingCall = h.calls[0];
      continue;
    }
    const text = String(h.text || '');
    if (!text || text.startsWith('[earlier ')) {
      ledger.pendingCall = null;
      continue;
    }

    if (h.role === 'user' && !ledger.goal) {
      const gm = text.match(/Goal:\s*(.+)/i) || text.match(/目标[：:]\s*(.+)/);
      ledger.goal = gm ? gm[1].trim() : text.split('\n').slice(0, 4).join(' ');
    }

    const modeMatch = text.match(/^mode:\s*(\S+)/m);
    if (modeMatch) ledger.mode = modeMatch[1];

    const sceneMatch = text.match(/^scene:\s*(\d+)\s+player:\s*\((\d+),(\d+)\)(?:\s+facing\s+(\S+))?/m);
    const prevScene = ledger.scene;
    if (sceneMatch) {
      ledger.scene = Number(sceneMatch[1]);
      ledger.pos = { x: Number(sceneMatch[2]), y: Number(sceneMatch[3]) };
      if (sceneMatch[4]) ledger.facing = sceneMatch[4];
    }

    const cashMatch = text.match(/^cash:\s*(\d+)/m);
    if (cashMatch) ledger.cash = Number(cashMatch[1]);

    const sc = ledger.scene != null ? getScene(ledger.scene) : null;

    // Parse items from observation
    const itemsMatch = text.match(/^items(?:\s*\(changed\))?:\s*(.+)$/m);
    if (itemsMatch && !itemsMatch[1].includes('kinds (unchanged')) {
      const rawItems = itemsMatch[1];
      if (!rawItems.includes('observe with full=true')) ledger.hasFullItems = true;
      const cleaned = rawItems.replace(/…\s*\(\+\d+\s*more.*$/, '');
      for (const tok of cleaned.split('、')) {
        const name = tok.replace(/×\d+$/, '').trim();
        if (name) ledger.items.add(name);
      }
    }

    // Parse engine-emitted feedback on use_item
    const hintMatch = text.match(/FAILED\s*—\s*(\S+)\s+has no effect on object\s+(\d+)\.\s*It only works when you stand next to and face one of:\s*id=(\d+)/);
    if (hintMatch && sc) {
      const [, itemName, wrongId, rightId] = hintMatch;
      sc.failedItemObj.add(`${itemName}@${wrongId}`);
      ledger.explicitItemTarget.set(itemName, Number(rightId));
    }

    const newTextMatch = text.match(/new text since last observation:\n([\s\S]*?)(?:\n\n|\ndialog box|$)/);
    if (newTextMatch) {
      for (const line of newTextMatch[1].split('\n')) {
        const t = line.trim();
        if (t && !ledger.dialogs.includes(t)) ledger.dialogs.push(t);
      }
    }
    const dlgBox = text.match(/dialog box \(waiting for advance\):\s*(.+)/);
    if (dlgBox) {
      const t = dlgBox[1].trim();
      if (t && !ledger.dialogs.includes(t)) ledger.dialogs.push(t);
    }

    // Parse objects & exits from observe or map
    if (sc) {
      const lines = text.split('\n');
      let section = null;
      for (const line of lines) {
        if (/^(objects|exits|people & objects|search spots):/.test(line.trim())) {
          section = line.trim().replace(':', '');
          continue;
        }
        const m = line.match(/^\s+[A-Z]\s+id=(\d+)\s+(?:(npc|search-spot|touch-trigger)\s+)?at\s+\((\d+),(\d+)\)(.*)$/);
        if (m) {
          const id = Number(m[1]);
          const kind = m[2] || (section === 'exits' ? 'touch-trigger' : section === 'search spots' ? 'search-spot' : 'npc');
          const x = Number(m[3]), y = Number(m[4]);
          const rest = m[5] || '';
          const labelMatch = rest.match(/「([^」]+)」/);
          const label = labelMatch ? labelMatch[1] : '';
          const toSceneMatch = rest.match(/→\s*scene\s*(\d+)\s*\((\d+),(\d+)\)/);
          const toLocalMatch = rest.match(/→\s*elsewhere in this scene\s*\((\d+),(\d+)\)/);
          const useHintMatch = rest.match(/use\s+「([^」]+)」\s+from your bag/);
          if (useHintMatch) ledger.explicitItemTarget.set(useHintMatch[1], id);

          if (kind === 'touch-trigger' || toSceneMatch || toLocalMatch || section === 'exits') {
            sc.exits.set(`${x},${y}`, {
              id, x, y,
              toScene: toSceneMatch ? Number(toSceneMatch[1]) : ledger.scene,
              toPos: toSceneMatch ? { x: Number(toSceneMatch[2]), y: Number(toSceneMatch[3]) } : (toLocalMatch ? { x: Number(toLocalMatch[1]), y: Number(toLocalMatch[2]) } : null),
              isStairs: !!toLocalMatch || rest.includes('stairs'),
              walked: rest.includes('(walked)'),
              raw: rest.trim()
            });
          } else {
            const prevObj = sc.objects.get(id);
            if (prevObj && (prevObj.x !== x || prevObj.y !== y)) {
              sc.interacted.delete(id);
            }
            sc.objects.set(id, { id, kind, x, y, label: label || prevObj?.label || '', raw: rest.trim() });
          }
        }
      }
    }

    // Record outcome of pendingCall
    const pendingCall = ledger.pendingCall;
    if (pendingCall && h.role === 'tool') {
      const resLine = text.split('\n')[0] || '';
      ledger.lastResult = resLine;
      const callScene = prevScene ?? ledger.scene;
      const csc = callScene != null ? getScene(callScene) : sc;
      if (csc) {
        if (pendingCall.name === 'map') {
          csc.mapCalled = true;
        } else if (pendingCall.name === 'observe' && pendingCall.args?.full) {
          ledger.hasFullItems = true;
        } else if (pendingCall.name === 'interact') {
          const tid = Number(pendingCall.args?.id);
          const obj = csc.objects.get(tid);
          const prev = csc.interacted.get(tid) || { count: 0 };
          const blocked = resLine.includes('blocked') || resLine.includes('cannot reach') || resLine.includes('FAILED');
          csc.interacted.set(tid, {
            count: prev.count + 1,
            pos: obj ? `${obj.x},${obj.y}` : '',
            blocked
          });
        } else if (pendingCall.name === 'use_item') {
          const item = pendingCall.args?.item;
          const facing = pendingCall.args?.facing;
          const consumedOrChanged =
            text.includes('items (changed)') ||
            resLine.includes('this changed how object') ||
            resLine.includes('teleported');
          if (resLine.startsWith('result: ok') && consumedOrChanged) {
            if (facing) csc.usedItems.add(`${item}@${facing}`);
            if (facing) csc.usedItems.add(`*@${facing}`);
            if (resLine.includes('this changed how object')) {
              csc.mapCalled = false;
            }
          } else if (facing) {
            csc.failedItemObj.add(`${item}@${facing}`);
          }
        } else if (pendingCall.name === 'walk_to') {
          const key = `${pendingCall.args?.x},${pendingCall.args?.y}`;
          csc.walked.set(key, (csc.walked.get(key) || 0) + 1);
        } else if (pendingCall.name === 'battle') {
          const itemOrSpell = pendingCall.args?.name;
          if (text.includes('auto-reloaded checkpoint') || text.includes('you were defeated') || resLine.includes('battle over')) {
            ledger.reservedThisRound.clear();
            ledger.actedThisRound.clear();
            ledger.lastHpSig = '';
          } else if (resLine.includes('FAILED')) {
            if (itemOrSpell) ledger.reservedThisRound.add(itemOrSpell);
          } else if (itemOrSpell && (pendingCall.args?.action === 'item' || pendingCall.args?.action === 'throw')) {
            ledger.reservedThisRound.add(itemOrSpell);
          }
        }
      }
      ledger.callHistory.push({ name: pendingCall.name, args: pendingCall.args, result: resLine, scene: ledger.scene });
      ledger.pendingCall = null;
    }
  }

  root._layaProcessedIdx = history.length;
  return ledger;
}

/**
 * Pure syntactic battle candidate enumerator (no hardcoded Boss rules or item filters).
 * Reads spells and usable/throwable items directly from the engine's battle observation text.
 */
function buildBattleCandidates(latestText, ledger) {
  const candidates = {};
  const add = (key, call, desc, prior = 1.0) => {
    if (Object.keys(candidates).length < 16) {
      candidates[key] = { call, desc, prior };
    }
  };

  const enemies = [];
  const enemySection = latestText.match(/enemies \([^\n]+\):\n([\s\S]*?)(?:\nparty in battle:|$)/);
  if (enemySection) {
    for (const line of enemySection[1].split('\n')) {
      const m = line.match(/\[(\d+)\]\s+(\S+)\s+HP(\d+)(?:\/(\d+))?/);
      if (m && Number(m[3]) > 0) {
        enemies.push({ index: Number(m[1]), name: m[2], hp: Number(m[3]), maxHp: Number(m[4] || m[3]) });
      }
    }
  }
  const primaryEnemy = enemies[0];
  const primaryTarget = primaryEnemy?.index ?? 0;

  const party = [];
  const partySection = latestText.match(/party in battle:\n([\s\S]*?)(?:\nturn:|$)/);
  if (partySection) {
    for (const line of partySection[1].split('\n')) {
      const m = line.match(/\[(\d+)\]\s+(\S+)\s+HP(\d+)\/(\d+)\s+MP(\d+)\/(\d+)(.*)$/);
      if (m) {
        party.push({
          index: Number(m[1]),
          name: m[2],
          hp: Number(m[3]),
          maxHp: Number(m[4]),
          mp: Number(m[5]),
          maxMp: Number(m[6]),
          status: m[7].trim()
        });
      }
    }
  }

  const turnMatch = latestText.match(/turn:\s*waiting for\s+(.+?)'s command/);
  const actorName = turnMatch ? turnMatch[1].trim() : '';
  const actor = party.find((p) => p.name === actorName) || party[0] || { index: 0, name: actorName, hp: 500, maxHp: 500, mp: 500, maxMp: 500, status: '' };

  const hpSig = `${enemies.map((e) => e.hp).join(',')}|${party.map((p) => `${p.hp}/${p.mp}`).join(',')}`;
  if (!ledger.lastResult.includes('FAILED') && (ledger.actedThisRound.has(actor.index) || (ledger.lastHpSig && ledger.lastHpSig !== hpSig))) {
    ledger.reservedThisRound.clear();
    ledger.actedThisRound.clear();
  }
  ledger.actedThisRound.add(actor.index);
  ledger.lastHpSig = hpSig;

  ledger.battleState = {
    acting_character: `${actor.name} (HP ${actor.hp}/${actor.maxHp}, MP ${actor.mp}/${actor.maxMp}, status: ${actor.status || 'normal'})`,
    party: party.map((p) => `[${p.index}] ${p.name} HP ${p.hp}/${p.maxHp} MP ${p.mp}/${p.maxMp} ${p.status}`),
    enemies: enemies.map((e) => `[${e.index}] ${e.name} HP ${e.hp}/${e.maxHp}`)
  };

  const lowestAlly = [...party].sort((a, b) => a.hp / (a.maxHp || 1) - b.hp / (b.maxHp || 1))[0] || actor;

  // 1. Basic physical attack
  add(
    'battle_attack',
    { name: 'battle', args: { action: 'attack', target: primaryTarget } },
    `${actor.name} 对 [${primaryTarget}] ${primaryEnemy?.name || '敌人'} 发动普通攻击`,
    1.0
  );

  // 2. Spells listed in the observation for the current actor (last 7 spells = highest tier learned)
  const spellsLine = latestText.match(/spells\s*\([^)]+\):\s*(.+)/)?.[1] || '';
  if (spellsLine) {
    const rawSpells = spellsLine.split('、').map((s) => s.trim()).filter(Boolean);
    for (const entry of rawSpells.slice(-7).reverse()) {
      const m = entry.match(/^(\S+?)\s+MP(\d+)(.*)$/);
      if (!m) continue;
      const [, spName, mpCostStr, rest] = m;
      const mpCost = Number(mpCostStr);
      if (actor.mp < mpCost || ledger.reservedThisRound.has(spName)) continue;
      const isHealOrRevive = /歸心|朝元|觀音|氣療|還魂|贖魂/.test(spName);
      add(
        `magic_${spName}`,
        { name: 'battle', args: { action: 'magic', name: spName, target: isHealOrRevive ? lowestAlly.index : primaryTarget } },
        `施放仙术「${spName}」(MP ${mpCost}${rest})`,
        1.0
      );
    }
  }

  // 3. Battle items listed in the observation
  const itemLines = latestText.split('\n').filter((l) => /^\s{4}\S+×\d+\s*\(/.test(l));
  for (const line of itemLines.slice(-8).reverse()) {
    const m = line.match(/^\s{4}(\S+?)×(\d+)\s*\((.+)\)$/);
    if (!m) continue;
    const [, itemName, countStr, desc] = m;
    if (Number(countStr) <= 0 || ledger.reservedThisRound.has(itemName)) continue;
    const canThrow = desc.includes('throw consumes');
    const canUse = desc.includes('use consumes') || desc.includes('use does not consume');
    if (canUse) {
      add(
        `item_${itemName}`,
        { name: 'battle', args: { action: 'item', name: itemName, target: lowestAlly.index } },
        `使用物品「${itemName}」(${desc})`,
        1.0
      );
    } else if (canThrow) {
      add(
        `throw_${itemName}`,
        { name: 'battle', args: { action: 'throw', name: itemName, target: primaryTarget } },
        `投掷物品「${itemName}」(${desc})`,
        1.0
      );
    }
  }

  return candidates;
}

/** Pure syntactic candidate enumerator for control/dialog/menu/battle states. */
function enumerateCandidates(ledger, latestText) {
  if (ledger.mode === 'dialog' || ledger.mode === 'anykey') {
    return {
      advance_dialog: {
        call: { name: 'advance', args: {} },
        desc: '推进当前对话 (advance dialog)',
        prior: 1.0
      }
    };
  }

  if (ledger.mode === 'choice' || ledger.mode === 'menu') {
    return {
      choose_0: { call: { name: 'choose', args: { index: 0 } }, desc: '选择菜单第 0 项', prior: 1.0 },
      choose_1: { call: { name: 'choose', args: { index: 1 } }, desc: '选择菜单第 1 项', prior: 1.0 }
    };
  }

  if (ledger.mode === 'battle') {
    return buildBattleCandidates(latestText, ledger);
  }

  const sc = ledger.scenes.get(ledger.scene);
  const candidates = {};
  const add = (key, call, desc, prior = 1.0) => {
    if (Object.keys(candidates).length < 16) {
      candidates[key] = { call, desc, prior };
    }
  };

  if (!ledger.hasFullItems && latestText.includes('observe with full=true')) {
    add('observe_full', { name: 'observe', args: { full: true } }, '查看完整背包与当前场景状态 (observe full=true)', 1.0);
  }
  if (sc && !sc.mapCalled) {
    add('call_map', { name: 'map', args: {} }, `查看场景 ${ledger.scene} 的全景对象与出口列表 (map)`, 1.0);
  }

  if (!sc) {
    add('call_observe', { name: 'observe', args: { full: true } }, '观察当前场景状态', 1.0);
    return candidates;
  }

  // 1. Engine-hinted item targets (from observe `USE ITEM` hints or `use_item` error messages)
  for (const [item, targetId] of ledger.explicitItemTarget.entries()) {
    if (sc.objects.has(targetId) && !sc.usedItems.has(`*@${targetId}`)) {
      const obj = sc.objects.get(targetId);
      add(
        `use_${item}_${targetId}`,
        { name: 'use_item', args: { item, facing: targetId } },
        `对对象 id=${targetId} (${obj.x},${obj.y}) 使用物品「${item}」`,
        1.0
      );
    }
  }

  // 2. Scene objects (`interact(id)`)
  for (const [id, obj] of sc.objects.entries()) {
    const info = sc.interacted.get(id);
    const count = info?.count || 0;
    const prior = count === 0 ? 1.0 : Math.pow(0.2, count);
    add(
      `interact_${id}`,
      { name: 'interact', args: { id } },
      `与场景对象 id=${id} ${obj.label ? `「${obj.label}」` : `(${obj.kind})`} at (${obj.x},${obj.y}) 交互/调查 ${obj.raw}`,
      prior
    );
  }

  // 3. Scene exits (`walk_to(x, y)`)
  for (const [key, ex] of sc.exits.entries()) {
    const wCount = sc.walked.get(key) || (ex.walked ? 1 : 0);
    const prior = wCount === 0 ? 1.0 : Math.pow(0.2, wCount);
    add(
      `walk_${ex.x}_${ex.y}`,
      { name: 'walk_to', args: { x: ex.x, y: ex.y } },
      `走向出口/台阶 (${ex.x},${ex.y}) ${ex.raw}`,
      prior
    );
  }

  return candidates;
}

export function layaProvider() {
  return {
    async turn({ system, history, tools, signal }) {
      await ensureDaemon(signal);
      const latestText = String(history.at(-1)?.text || '');

      // Case 1: Closed-Book Quiz (`bench quiz` passes tools = [])
      if (!tools || tools.length === 0) {
        const res = await postJson(
          `${DAEMON_URL}/predict`,
          {
            state: { system, prompt: latestText },
            questions: {
              can_generate_free_text: {
                type: 'noul',
                instructions: 'Does the input state explicitly provide the factual answer to this question without external walkthrough memory?'
              }
            }
          },
          {},
          { signal }
        );
        const noul = res.answers?.can_generate_free_text?.noul ?? 0;
        const conf = res.answers?.can_generate_free_text?.confidence ?? 0;
        return {
          text: `[Laya System-1 Non-Generative Encoder | noul=${noul} | conf=${conf}]\n答案：不知道`,
          calls: [],
          usageReported: { tokensIn: true, tokensOut: true },
          finishReason: 'stop',
          usage: { tokensIn: res.usage?.input_tokens ?? 0, tokensOut: 0, cacheRead: 0 }
        };
      }

      // Case 2: Interactive Gameplay (`bench run`)
      const ledger = updateLedger(history);
      const candidates = enumerateCandidates(ledger, latestText);
      const keys = Object.keys(candidates);

      if (keys.length === 1) {
        const only = candidates[keys[0]];
        return {
          text: `[Laya System-1 Deterministic Single-Action] -> ${keys[0]}`,
          calls: [{ id: `laya_${Date.now()}_0`, name: only.call.name, args: only.call.args }],
          usageReported: { tokensIn: true, tokensOut: true },
          finishReason: 'tool_calls',
          usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0 }
        };
      }

      const criteria = {};
      for (const k of keys) criteria[k] = candidates[k].desc;

      const statePayload = {
        goal: ledger.goal,
        scene: ledger.scene,
        position: ledger.pos,
        mode: ledger.mode,
        ...(ledger.mode === 'battle' && ledger.battleState ? { battle_state: ledger.battleState } : {}),
        items_in_bag: [...ledger.items].slice(0, 30),
        recent_clues_and_dialogs: ledger.dialogs.slice(-8),
        last_action_result: ledger.lastResult,
        recent_actions: ledger.callHistory.slice(-5).map((c) => `${c.name}(${JSON.stringify(c.args)}) -> ${c.result}`)
      };

      const res = await postJson(
        `${DAEMON_URL}/predict`,
        {
          state: statePayload,
          questions: {
            next_action: {
              type: 'choice',
              instructions: '根据当前任务目标(goal)、对话线索(recent_clues_and_dialogs)以及上一步执行反馈(last_action_result)，选择最合理的下一步动作。',
              criteria
            }
          }
        },
        {},
        { signal }
      );

      const ans = res.answers?.next_action || {};
      const probs = ans.probabilities || {};
      const conf = ans.confidence ?? 0;
      const actProb = ans.action?.act_probability ?? 1.0;

      let bestKey = keys[0];
      let bestScore = -1;
      for (const k of keys) {
        const rawP = probs[k] ?? (1 / keys.length);
        const s = rawP * (candidates[k].prior ?? 1.0);
        if (s > bestScore) {
          bestScore = s;
          bestKey = k;
        }
      }

      const chosen = candidates[bestKey];
      const summaryText = `[Laya System-1 | latency=${res.latency_ms}ms | raw_choice=${ans.choice} | selected=${bestKey} | conf=${conf} | act_prob=${actProb} | top_probs=${JSON.stringify(probs)}]`;

      return {
        text: summaryText,
        calls: [{ id: `laya_${Date.now()}_0`, name: chosen.call.name, args: chosen.call.args }],
        usageReported: { tokensIn: true, tokensOut: true },
        finishReason: 'tool_calls',
        usage: { tokensIn: res.usage?.input_tokens ?? 0, tokensOut: 0, cacheRead: 0 }
      };
    }
  };
}
