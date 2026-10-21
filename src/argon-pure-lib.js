// Argon 自写核心运行时库 — 挂载在 persistent global 上,跨所有 run_code 调用持久存活
pal.clearListeners();
global.dialogBuffer = [];
global.sceneHistory = global.sceneHistory || [pal.world.scene];

pal.on('SMSG_DIALOG', (d) => {
  const line = (d.speaker ? `${d.speaker}: ` : '') + d.text;
  global.dialogBuffer.push(line);
});

pal.on('SMSG_SCENE_ENTER', (s) => {
  if (global.sceneHistory.at(-1) !== s.scene) {
    global.sceneHistory.push(s.scene);
  }
});

pal.on('SMSG_BATTLE_EVENT', (ev) => {
  const b = pal.world.battle;
  if (!b) return;
  if (ev.kind === 'hp' && ev.side === 'enemy') {
    const en = b.enemies?.find((x) => x.index === ev.index);
    if (en) en.hp = ev.to;
  } else if (ev.kind === 'hp' && ev.side === 'party') {
    const pm = b.party?.find((x) => x.roleId === ev.roleId);
    if (pm) pm.hp = ev.to;
  } else if (ev.kind === 'mp' && ev.side === 'party') {
    const pm = b.party?.find((x) => x.roleId === ev.roleId);
    if (pm) pm.mp = ev.to;
  } else if (ev.kind === 'enemy_gone' && Array.isArray(b.enemies)) {
    b.enemies = b.enemies.filter((x) => x.index !== ev.index);
  }
});

let cachedBattle = null;
pal.on('*', (ev) => {
  if (ev.op === 'SMSG_BATTLE_START' || ev.op === 'SMSG_BATTLE_STATE') {
    cachedBattle = pal.world.battle;
  } else if (ev.op === 'SMSG_BATTLE_END' || (ev.op === 'SMSG_MODE' && ev.mode === 'control')) {
    cachedBattle = null;
  } else if (ev.op === 'SMSG_MODE' && (ev.mode === 'dialog' || ev.mode === 'battle') && !pal.world.battle && cachedBattle) {
    pal.world.battle = cachedBattle;
  }
});

global.takeDialogs = () => {
  const out = [...global.dialogBuffer];
  global.dialogBuffer.length = 0;
  return out;
};

global.hasItem = (namePart) => (pal.world.items || []).find((it) => it.name.includes(namePart) && it.amount > 0);

const BOSS_NAMES = /半人蛇|蛇妖|妖狐|狐狸精|頭領|林月如|林天南|智修|鬼將軍|赤鬼王|石長老|天鬼皇|彩依|毒娘子|鬼母|死靈|明王|盤龍柱|龍柱|拜月|水魔獸|地魔獸|樹妖|巨龍|鳳凰|木道人|木靈道士|火麒麟|神牛/;

global.fightBattle = async (opts = {}) => {
  const rounds = [];
  let guard = 0;
  let buffed = false;
  let isBoss = !!opts.boss;
  const actedInRound = new Set();
  const healedThisRound = new Set();
  const revivedThisRound = new Set();
  const mpRefilledThisRound = new Set();

  let stolenCount = 0;
  let invisRoundsLeft = 0;
  while ((pal.world.mode === 'battle' || (pal.world.mode === 'dialog' && pal.world.battle)) && guard++ < 200) {
    if (pal.world.mode === 'dialog') {
      await pal.advance(50);
      continue;
    }
    const b = pal.world.battle;
    const party = b?.party?.length ? b.party : (pal.world.members || []);
    const enemies = (b?.enemies || []).filter((e) => (e.hp ?? 1) > 0);
    const memberIdx = b?.turn?.member ?? 0;
    if (actedInRound.has(memberIdx)) {
      actedInRound.clear();
      healedThisRound.clear();
      revivedThisRound.clear();
      mpRefilledThisRound.clear();
      if (invisRoundsLeft > 0) invisRoundsLeft--;
    }
    actedInRound.add(memberIdx);

    const actor = party[memberIdx] || {};
    const livingMembers = party.filter((m) => (m.hp ?? 0) > 0);
    const totalEnemyHp = enemies.reduce((s, e) => s + (e.hp || 0), 0);
    if (pal.world.scene === 281) {
      rounds.push(`@${actor.name}[${party.map((m) => `${m.hp}/${m.maxHp}m${m.mp}`).join(',')} vs ${totalEnemyHp}]`);
    }
    const isFinalDungeonMobScene = !opts.boss && !enemies.some((e) => /拜月/.test(e.name || '')) && [291, 292, 293, 279, 288, 287, 289, 286, 285, 277, 281].includes(pal.world.scene);
    if (enemies.some((e) => (e.maxHp || e.hp || 0) >= 1200 || BOSS_NAMES.test(e.name || '') || /侍衛|魔獸|刑天|牛鬼|瘟神|巫師|祭司/.test(e.name || ''))) {
      isBoss = true;
    }
    if (enemies.some((e) => /石長老/.test(e.name || ''))) {
      await pal.battle('attack');
      rounds.push(`${actor.name || memberIdx}:attack(石長老-scripted)`);
      continue;
    }
    const isEarthImmune = enemies.some((e) => /赤鬼王|地魔獸/.test(e.name || ''));

    // Find un-revived dead party member
    const deadMemberIdx = party.findIndex((m, idx) => (m.hp ?? 0) <= 0 && !revivedThisRound.has(idx));
    const getStatus = (idx) => b?.party?.[idx]?.status || party[idx]?.status || [];

    // Find un-healed living party member with lowest HP ratio (and rawLowestRatio ignoring healedThisRound)
    let lowestIdx = -1;
    let lowestRatio = 1.0;
    let rawLowestIdx = -1;
    let rawLowestRatio = 1.0;
    const isHeavyBoss = !isFinalDungeonMobScene && enemies.some((e) => ((e.maxHp || e.hp || 0) >= 4000 && !/金蟾|紫九頭蛇|巫王侍衛/.test(e.name || '')) || /明王|拜月|水魔獸|地魔獸|樹妖|木道人|木靈道士|火麒麟/.test(e.name || ''));
    for (let i = 0; i < party.length; i++) {
      const m = party[i];
      if (m && m.name === '趙靈兒' && isHeavyBoss && (m.maxHp ?? 0) < 522) {
        m.maxHp = 522;
      }
      if ((m.hp ?? 0) > 0 && (m.maxHp ?? 0) > 0) {
        const r = m.hp / m.maxHp;
        if (r < rawLowestRatio) {
          rawLowestRatio = r;
          rawLowestIdx = i;
        }
        if (!healedThisRound.has(i) && r < lowestRatio) {
          lowestRatio = r;
          lowestIdx = i;
        }
      }
    }
    const hasWuhou = party.some((m) => m.name === '巫后');
    const isBayue = enemies.some((e) => /拜月/.test(e.name || ''));
    const healThreshold = opts.healRatio || (invisRoundsLeft > 0 ? 0.35 : (hasWuhou ? 0.60 : (isBoss ? (livingMembers.length === 1 ? 0.85 : (isBayue ? 0.90 : 0.70)) : 0.68)));
    const needHeal = lowestIdx >= 0 && lowestRatio < healThreshold;
    const criticalHeal = lowestIdx >= 0 && lowestRatio < 0.45;
    const yueru = party.find((m) => m.name === '林月如' && (m.hp ?? 0) > 0);
    const lingEr = party.find((m) => (m.name === '趙靈兒' || m.name === '巫后') && (m.hp ?? 0) > 0);
    const anu = party.find((m) => m.name === '阿奴' && (m.hp ?? 0) > 0);
    const isLingErLike = actor.name === '趙靈兒' || actor.name === '巫后';
    const supportCanHeal = (yueru && (yueru.mp ?? 0) >= 18) || (lingEr && (lingEr.mp ?? 0) >= 6) || (anu && (anu.mp ?? 0) >= 6);

    const reviveItem = global.hasItem('還魂香') || global.hasItem('贖魂燈') || global.hasItem('孟婆湯') || global.hasItem('天香續命露');
    const bigHealItem = global.hasItem('紫菁玉蓉膏') || global.hasItem('天仙玉露') || global.hasItem('靈蠱') || global.hasItem('金創藥') || global.hasItem('蜂王蜜') || global.hasItem('行軍丹') || global.hasItem('觀音符');
    const smallHealItem = global.hasItem('觀音符') || global.hasItem('止血草') || global.hasItem('醃肉');
    const healItem = isBoss ? (bigHealItem || smallHealItem) : (smallHealItem || bigHealItem);
    const isTreeBoss = enemies.some((e) => /樹妖|巫王侍衛/.test(e.name || ''));
    const mpRefillItem = (!isTreeBoss && isHeavyBoss && (global.hasItem('天仙玉露') || global.hasItem('雪蓮子') || global.hasItem('神仙茶') || global.hasItem('靈山仙芝') || global.hasItem('龍涎草'))) || global.hasItem('鼠兒果') || global.hasItem('還神丹') || (!isTreeBoss && (global.hasItem('龍涎草') || global.hasItem('忘魂花') || global.hasItem('九節菖蒲') || global.hasItem('靈山仙芝') || global.hasItem('靈蠱') || global.hasItem('靈葫仙丹') || global.hasItem('神仙茶') || global.hasItem('雪蓮子') || global.hasItem('天仙玉露')));
    const throwItem = isHeavyBoss && !isFinalDungeonMobScene && !hasWuhou && !enemies.some((e) => /巫王侍衛/.test(e.name || '')) && opts.useThrow !== false && (
      global.hasItem('火蠶蠱') ||
      global.hasItem('爆烈蠱') ||
      global.hasItem('冰蠶蠱') ||
      global.hasItem('無影神針') ||
      global.hasItem('血玲瓏') ||
      (pal.world.scene === 281 && (global.hasItem('雙龍劍') || global.hasItem('無影毒'))) ||
      (![278, 281].includes(pal.world.scene) && (
        global.hasItem('鳳鳴刀') ||
        global.hasItem('青蛇杖') ||
        global.hasItem('青鋒劍') ||
        global.hasItem('柳月刀') ||
        global.hasItem('九截鞭') ||
        global.hasItem('吸星鎖') ||
        global.hasItem('袖裡劍') ||
        global.hasItem('透骨釘') ||
        global.hasItem('梅花鏢') ||
        global.hasItem('大刀') ||
        global.hasItem('戒刀') ||
        global.hasItem('紅纓刀') ||
        global.hasItem('蜂巢') ||
        global.hasItem('毒蟾卵') ||
        global.hasItem('蜘蛛卵') ||
        (isEarthImmune && (global.hasItem('仙女劍') || global.hasItem('越女劍') || global.hasItem('鐵劍')))
      ))
    );
    const useSpell = opts.magic || isBoss || (enemies.length >= 2 && (actor.mp ?? 0) >= 35) || (totalEnemyHp >= 300 && (actor.mp ?? 0) >= 35);

    let res = { ok: false };
    global._protectedTurns = global._protectedTurns || {};
    if (actedInRound.size === 1) {
      for (const k of Object.keys(global._protectedTurns)) {
        if (global._protectedTurns[k] > 0) global._protectedTurns[k]--;
      }
    }
    // 0. Use 隱蠱 (Invisibility Gu) in heavy boss fights (or Bayue Jiaozhu) for 4 rounds of party invincibility!
    if (isHeavyBoss && !isFinalDungeonMobScene && !hasWuhou && !isTreeBoss && invisRoundsLeft <= 0 && global.hasItem('隱蠱')) {
      res = await pal.battle('item', { item: '隱蠱' });
      if (res.ok) {
        invisRoundsLeft = 4;
        global._protectedTurns = {};
        rounds.push(`${actor.name || memberIdx}:item(隱蠱)`);
      }
    }
    // 0b. Against Bayue Jiaozhu:
    // - Round 2: 李逍遙 casts 酒神 #1 (mp=597)
    // - Round 3: 李逍遙 (mp=20) casts 真元護體 (18 MP, 50% dmg reduction for 9 rounds!) on 阿奴, while 趙靈兒 feeds 雪蓮子 (+400 MP) to 李逍遙!
    // - Round 4: 李逍遙 (mp=402) casts 真元護體 (18 MP) on 趙靈兒!
    // - Round 5: 李逍遙 (mp=404) casts 真元護體 (18 MP) on himself!
    // - Round 6: 李逍遙 (mp=406) casts 酒神 #2!
    const anuIdx = party.findIndex((m) => m.name === '阿奴' && (m.hp ?? 0) > 0);
    const lingErIdx = party.findIndex((m) => m.name === '趙靈兒' && (m.hp ?? 0) > 0);
    const xiaoyaoIdx = party.findIndex((m) => m.name === '李逍遙' && (m.hp ?? 0) > 0);
    const anuProtected = anuIdx >= 0 && ((global._protectedTurns[anuIdx] || 0) > 0 || getStatus(anuIdx).includes('protect'));
    const lingErProtected = lingErIdx >= 0 && ((global._protectedTurns[lingErIdx] || 0) > 0 || getStatus(lingErIdx).includes('protect'));
    const xiaoyaoProtected = xiaoyaoIdx >= 0 && ((global._protectedTurns[xiaoyaoIdx] || 0) > 0 || getStatus(xiaoyaoIdx).includes('protect'));
    const allProtected = anuProtected && lingErProtected && xiaoyaoProtected;

    if (!res.ok && isBayue && deadMemberIdx < 0) {
      if (actor.name === '李逍遙') {
        if (!xiaoyaoProtected && (actor.mp ?? 0) >= 18) {
          res = await pal.battle('magic', { magic: '真元護體', target: memberIdx });
          if (res.ok) {
            global._protectedTurns[memberIdx] = 8;
            rounds.push('李逍遙:magic(真元護體->李逍遙)');
          }
        } else if (anuIdx >= 0 && !anuProtected && (actor.mp ?? 0) >= 18) {
          res = await pal.battle('magic', { magic: '真元護體', target: anuIdx });
          if (res.ok) {
            global._protectedTurns[anuIdx] = 8;
            rounds.push('李逍遙:magic(真元護體->阿奴)');
          }
        } else if (lingErIdx >= 0 && !lingErProtected && (actor.mp ?? 0) >= 18) {
          res = await pal.battle('magic', { magic: '真元護體', target: lingErIdx });
          if (res.ok) {
            global._protectedTurns[lingErIdx] = 8;
            rounds.push('李逍遙:magic(真元護體->趙靈兒)');
          }
        } else if (global.hasItem('酒') && (actor.mp ?? 0) >= 300) {
          res = await pal.battle('magic', { magic: '酒神' });
          if (res.ok) rounds.push(`李逍遙:magic(酒神,mp=${actor.mp})`);
        }
      } else if (isLingErLike && global.hasItem('酒') && xiaoyaoIdx >= 0 && (party[xiaoyaoIdx].mp ?? 0) < 100 && !mpRefilledThisRound.has(xiaoyaoIdx)) {
        const bigMp = global.hasItem('雪蓮子') || global.hasItem('天仙玉露') || global.hasItem('靈葫仙丹');
        if (bigMp) {
          res = await pal.battle('item', { item: bigMp.name, target: xiaoyaoIdx });
          if (res.ok) {
            mpRefilledThisRound.add(xiaoyaoIdx);
            rounds.push(`${actor.name}:mp(${bigMp.name}->李逍遙For酒神)`);
          }
        }
      }
    }
    // 1. Revive dead party member (coordinated so only 1 actor revives per target per round)
    if (deadMemberIdx >= 0 && isLingErLike && (actor.mp ?? 0) >= 20) {
      for (const rsp of ['還魂咒', '贖魂', '靈血咒']) {
        res = await pal.battle('magic', { magic: rsp, target: deadMemberIdx });
        if (res.ok) {
          revivedThisRound.add(deadMemberIdx);
          rounds.push(`${actor.name}:magic(${rsp}->${deadMemberIdx})`);
          break;
        }
      }
    }
    if (!res.ok && deadMemberIdx >= 0 && actor.name === '阿奴' && (actor.mp ?? 0) >= 20) {
      res = await pal.battle('magic', { magic: '贖魂咒', target: deadMemberIdx });
      if (res.ok) {
        revivedThisRound.add(deadMemberIdx);
        rounds.push(`阿奴:magic(贖魂咒->${deadMemberIdx})`);
      }
    }
    if (!res.ok && deadMemberIdx >= 0 && reviveItem) {
      res = await pal.battle('item', { item: reviveItem.name, target: deadMemberIdx });
      if (res.ok) {
        revivedThisRound.add(deadMemberIdx);
        rounds.push(`${actor.name || memberIdx}:revive(${reviveItem.name}->${deadMemberIdx})`);
      }
    }

    // 1b. Against Bayue Jiaozhu, if any living member has raw HP ratio < (allProtected ? 0.58 : 0.85), 李逍遙 stacks 聖靈符 (+300 HP to all) or 元靈歸心術 alongside 趙靈兒's 五氣朝元!
    if (!res.ok && isBayue && actor.name === '李逍遙' && rawLowestRatio < (allProtected ? 0.58 : 0.85)) {
      if (global.hasItem('聖靈符')) {
        res = await pal.battle('item', { item: '聖靈符' });
        if (res.ok) rounds.push('李逍遙:item(聖靈符-stack)');
      } else if (rawLowestIdx >= 0 && (actor.mp ?? 0) >= 20) {
        res = await pal.battle('magic', { magic: '元靈歸心術', target: rawLowestIdx });
        if (res.ok) rounds.push(`李逍遙:magic(元靈歸心術->${rawLowestIdx})`);
      }
    }

    // 2. In heavy boss fights, 趙靈兒/巫后 casts 五氣朝元 when party HP ratio < 0.85 (or vs Bayue Jiaozhu right as stealth ends before allProtected)
    if (!res.ok && isHeavyBoss && isLingErLike && (rawLowestRatio < (isBayue ? 0.88 : 0.78) || (isBayue && !allProtected && invisRoundsLeft <= 1)) && (actor.mp ?? 0) >= 40) {
      res = await pal.battle('magic', { magic: '五氣朝元' });
      if (res.ok) {
        party.forEach((_, idx) => healedThisRound.add(idx));
        rounds.push(`${actor.name}:magic(五氣朝元)`);
      }
    }

    // Healing (coordinated via healedThisRound so two healers don't double-heal the same target)
    const xiaoyaoCanHeal = party.some((m) => m.name === '李逍遙' && (m.hp ?? 0) > 0 && (m.mp ?? 0) >= 18);
    const unhealedDamagedCount = party.filter((m, idx) => (m.hp ?? 0) > 0 && (m.maxHp ?? 0) > 0 && !healedThisRound.has(idx) && (m.hp / m.maxHp) < 0.78).length;
    const lingErWillPartyHeal = lingEr && lingEr.name === '趙靈兒' && (lingEr.mp ?? 0) >= 40 && lowestRatio >= 0.55 && (isBayue || unhealedDamagedCount <= 1) && !healedThisRound.has(lowestIdx);
    const anuKeepDps = actor.name === '阿奴' && ((isBayue && (pal.world.cash ?? 0) >= 5000) || (!lingEr && xiaoyaoCanHeal && unhealedDamagedCount <= 1 && lowestRatio >= 0.50) || (lingEr && lowestRatio >= 0.45));
    const yueruKeepDps = (actor.name === '林月如' || anuKeepDps) && isHeavyBoss && (pal.world.cash ?? 0) >= 5000 && (!criticalHeal || (lingEr && (lingEr.mp ?? 0) >= 15));
    const shouldActorHeal = needHeal && !yueruKeepDps && (isLingErLike || !lingErWillPartyHeal) && (actor.name !== '李逍遙' || (isBayue && !allProtected) || !lingEr || unhealedDamagedCount >= 2 || livingMembers.length === 1 || criticalHeal || !supportCanHeal);
    if (!res.ok && shouldActorHeal) {
      const healTarget = lowestIdx;
      const topHealSpells = (isBoss || criticalHeal) ? ['元靈歸心術'] : [];
      const weakHealSpells = isBoss && bigHealItem ? [] : ['氣療術'];
      // If multiple members are damaged (or in a boss fight) and 趙靈兒/巫后 has 五氣朝元, cast party-wide heal
      if (!res.ok && isLingErLike && (actor.mp ?? 0) >= 40 && (isBoss || party.filter((m) => (m.hp ?? 0) > 0 && (m.hp / m.maxHp) < 0.80).length >= 2)) {
        res = await pal.battle('magic', { magic: '五氣朝元' });
        if (res.ok) {
          party.forEach((_, idx) => healedThisRound.add(idx));
          rounds.push(`${actor.name}:magic(五氣朝元)`);
        }
      }
      // Against Bayue Jiaozhu, if actor is 李逍遙 and any member is damaged (< 0.85), use 聖靈符 (+300 HP to all) if available!
      if (!res.ok && isBayue && !isLingErLike && lowestRatio < 0.85 && global.hasItem('聖靈符')) {
        res = await pal.battle('item', { item: '聖靈符' });
        if (res.ok) {
          party.forEach((_, idx) => healedThisRound.add(idx));
          rounds.push(`${actor.name}:item(聖靈符)`);
        }
      }
      if (!res.ok && isLingErLike && (actor.mp ?? 0) >= 6) {
        for (const hsp of [...topHealSpells, '觀音咒', ...weakHealSpells]) {
          res = await pal.battle('magic', { magic: hsp, target: healTarget });
          if (res.ok) {
            healedThisRound.add(healTarget);
            rounds.push(`${actor.name}:magic(${hsp}->${healTarget})`);
            break;
          }
        }
      } else if (!res.ok && actor.name === '阿奴' && (actor.mp ?? 0) >= 6) {
        for (const hsp of ['元靈歸心術', '觀音咒']) {
          res = await pal.battle('magic', { magic: hsp, target: healTarget });
          if (res.ok) {
            healedThisRound.add(healTarget);
            rounds.push(`阿奴:magic(${hsp}->${healTarget})`);
            break;
          }
        }
      } else if (!res.ok && actor.name === '林月如' && (actor.mp ?? 0) >= 18) {
        for (const hsp of [...topHealSpells, '凝神歸元', ...weakHealSpells]) {
          res = await pal.battle('magic', { magic: hsp, target: healTarget });
          if (res.ok) {
            healedThisRound.add(healTarget);
            rounds.push(`林月如:magic(${hsp}->${healTarget})`);
            break;
          }
        }
      } else if (!res.ok && actor.name === '李逍遙' && (actor.mp ?? 0) >= 6) {
        for (const hsp of [...topHealSpells, '凝神歸元', ...weakHealSpells]) {
          res = await pal.battle('magic', { magic: hsp, target: healTarget });
          if (res.ok) {
            healedThisRound.add(healTarget);
            rounds.push(`李逍遙:magic(${hsp}->${healTarget})`);
            break;
          }
        }
      }
      if (!res.ok && healItem) {
        res = await pal.battle('item', { item: healItem.name, target: healTarget });
        if (res.ok) {
          healedThisRound.add(healTarget);
          rounds.push(`${actor.name || memberIdx}:heal(${healItem.name}->${healTarget})`);
        }
      }
    }

    // 3. Support MP refill: keep 趙靈兒's MP >= 85 in heavy boss fights so she never runs out of 五氣朝元!
    if (!res.ok && isHeavyBoss && isLingErLike && (actor.mp ?? 0) < 85 && mpRefillItem && !mpRefilledThisRound.has(memberIdx)) {
      res = await pal.battle('item', { item: mpRefillItem.name, target: memberIdx });
      if (res.ok) {
        mpRefilledThisRound.add(memberIdx);
        rounds.push(`${actor.name}:mp(${mpRefillItem.name}->self)`);
      }
    }
    if (!res.ok && isBoss && actor.name !== '李逍遙' && !isBayue && mpRefillItem) {
      const xiaoyaoIdx = party.findIndex((m) => m.name === '李逍遙' && (m.hp ?? 0) > 0);
      const lingErIdx = party.findIndex((m) => m.name === '趙靈兒' && (m.hp ?? 0) > 0);
      if ((actor.mp ?? 0) < 28 && !mpRefilledThisRound.has(memberIdx)) {
        res = await pal.battle('item', { item: mpRefillItem.name, target: memberIdx });
        if (res.ok) {
          mpRefilledThisRound.add(memberIdx);
          rounds.push(`${actor.name}:mp(${mpRefillItem.name}->self)`);
        }
      } else if (isHeavyBoss && lingErIdx >= 0 && (party[lingErIdx].mp ?? 0) < 85 && !mpRefilledThisRound.has(lingErIdx)) {
        res = await pal.battle('item', { item: mpRefillItem.name, target: lingErIdx });
        if (res.ok) {
          mpRefilledThisRound.add(lingErIdx);
          rounds.push(`${actor.name}:mp(${mpRefillItem.name}->趙靈兒)`);
        }
      } else if (xiaoyaoIdx >= 0 && (party[xiaoyaoIdx].mp ?? 0) < 35 && !mpRefilledThisRound.has(xiaoyaoIdx)) {
        res = await pal.battle('item', { item: mpRefillItem.name, target: xiaoyaoIdx });
        if (res.ok) {
          mpRefilledThisRound.add(xiaoyaoIdx);
          rounds.push(`${actor.name}:mp(${mpRefillItem.name}->李逍遙)`);
        }
      }
    }

    // 4. Steal from Red Demon King (2x 血玲瓏) & Buff & Throw on bosses
    if (!res.ok && isEarthImmune && stolenCount < 2 && actor.name === '李逍遙' && (actor.mp ?? 0) >= 12) {
      res = await pal.battle('magic', { magic: '飛龍探雲手' });
      if (res.ok) {
        stolenCount++;
        rounds.push('李逍遙:magic(飛龍探雲手)');
      }
    }
    if (!res.ok && isBoss && !buffed && actor.name !== '李逍遙' && global.hasItem('金剛符')) {
      res = await pal.battle('item', { item: '金剛符', target: 0 });
      if (res.ok) {
        buffed = true;
        rounds.push(`${actor.name}:buff(金剛符->0)`);
      }
    }
    // Throw heavy burst items on heavy bosses
    if (!res.ok && throwItem && !isLingErLike && !((actor.name === '林月如' || actor.name === '阿奴') && isHeavyBoss && (pal.world.cash ?? 0) >= 5000)) {
      res = await pal.battle('throw', { item: throwItem.name });
      if (res.ok) rounds.push(`${actor.name}:throw(${throwItem.name})`);
    }
    // Bravery (天罡戰氣) + DualAttack (醉仙望月步 / 雙龍劍) physical DPS engine on single-target heavy bosses (except 拜月教主 who has high physicalResistance)
    if (!res.ok && isHeavyBoss && lingEr && !enemies.some((e) => /拜月/.test(e.name || '')) && totalEnemyHp >= 3500 && enemies.length === 1 && actor.name === '李逍遙') {
      const dualIdx = party.findIndex((m, idx) => (m.hp ?? 0) > 0 && getStatus(idx).includes('dual-attack') && !getStatus(idx).includes('bravery'));
      const selfStatus = getStatus(memberIdx);
      if (dualIdx >= 0 && (actor.mp ?? 0) >= 12) {
        res = await pal.battle('magic', { magic: '天罡戰氣', target: dualIdx });
        if (res.ok) rounds.push(`李逍遙:magic(天罡戰氣->${dualIdx})`);
      } else if (!selfStatus.includes('bravery') && (actor.mp ?? 0) >= 12) {
        res = await pal.battle('magic', { magic: '天罡戰氣', target: memberIdx });
        if (res.ok) rounds.push(`李逍遙:magic(天罡戰氣->${memberIdx})`);
      } else if (!selfStatus.includes('dual-attack') && (actor.mp ?? 0) >= 22) {
        res = await pal.battle('magic', { magic: '醉仙望月步', target: memberIdx });
        if (res.ok) rounds.push(`李逍遙:magic(醉仙望月步->${memberIdx})`);
      } else if (selfStatus.includes('bravery')) {
        res = await pal.battle('attack');
        if (res.ok) rounds.push('李逍遙:attack(bravery)');
      }
    }
    // Any actor with bravery + dual-attack uses 0-MP physical attack on bosses!
    const actorStatus = getStatus(memberIdx);
    if (!res.ok && isBoss && actorStatus.includes('bravery') && actorStatus.includes('dual-attack')) {
      res = await pal.battle('attack');
      if (res.ok) rounds.push(`${actor.name}:attack(bravery+dual)`);
    }

    // 5. Offensive Magic
    if (!res.ok && useSpell && actor.name === '李逍遙') {
      if ((actor.mp ?? 0) >= 10) {
        const spList = opts.magic
          ? [opts.magic]
          : ((enemies.length >= 2 || totalEnemyHp >= 350)
            ? ['劍神', '天劍', '萬劍訣', '御劍術']
            : (isBoss ? ['劍神', '天劍', '天師符法', '萬劍訣', '御劍術'] : ['萬劍訣', '御劍術', '天師符法']));
        for (const sp of spList) {
          res = await pal.battle('magic', { magic: sp });
          if (res.ok) {
            rounds.push(`李逍遙:magic(${sp})`);
            break;
          }
        }
      }
      if (!res.ok && mpRefillItem && (isBoss || (actor.mp ?? 0) < 40) && !mpRefilledThisRound.has(memberIdx)) {
        res = await pal.battle('item', { item: mpRefillItem.name, target: memberIdx });
        if (res.ok) {
          mpRefilledThisRound.add(memberIdx);
          rounds.push(`李逍遙:mp(${mpRefillItem.name})`);
        }
      }
    }
    if (!res.ok && useSpell && actor.name === '林月如') {
      if (isBoss && !isHeavyBoss && enemies.length === 1) {
        res = await pal.battle('attack');
        if (res.ok) rounds.push('林月如:attack(conserve-mp)');
      }
      if (!res.ok && (actor.mp ?? 0) >= 1) {
        const qiankun = (isBoss && isHeavyBoss && (pal.world.cash ?? 0) >= 5000) ? ['乾坤一擲'] : [];
        const spOrder = (enemies.length >= 2)
          ? [...qiankun, '斬龍訣', '七訣劍氣', '氣劍指', '銅錢鏢', '一陽指']
          : [...qiankun, '斬龍訣', '七訣劍氣', '一陽指', '氣劍指', '銅錢鏢'];
        for (const sp of spOrder) {
          res = await pal.battle('magic', { magic: sp });
          if (res.ok) {
            rounds.push(`林月如:magic(${sp})`);
            break;
          }
        }
      }
      if (!res.ok && mpRefillItem && isBoss && (actor.mp ?? 0) < 28) {
        res = await pal.battle('item', { item: mpRefillItem.name, target: memberIdx });
        if (res.ok) rounds.push(`林月如:mp(${mpRefillItem.name}->self)`);
      }
    }
    if (!res.ok && useSpell && isLingErLike) {
      const spOrder = actor.name === '巫后'
        ? ['雷神', '山神', '火神', '雪妖', '風神']
        : (isEarthImmune
          ? (enemies.length >= 2
            ? ['武神', '煉獄真火', '風雪冰天', '狂雷', '天雷破', '風捲殘雲', '玄冰咒', '旋風咒', '五雷咒', '三昧真火', '冰咒', '雷咒', '風咒']
            : ['武神', '狂雷', '煉獄真火', '風雪冰天', '天雷破', '風捲殘雲', '五雷咒', '玄冰咒', '三昧真火', '旋風咒', '冰咒', '雷咒', '風咒'])
          : (enemies.length >= 2
            ? ['武神', '泰山壓頂', '地裂天崩', '風雪冰天', '煉獄真火', '天雷破', '風捲殘雲', '三昧真火', '飛岩術', '玄冰咒', '旋風咒', '土咒', '五雷咒']
            : ['武神', '狂雷', '泰山壓頂', '地裂天崩', '風雪冰天', '煉獄真火', '天雷破', '風捲殘雲', '五雷咒', '三昧真火', '玄冰咒', '飛岩術', '雷咒', '炎咒', '冰咒', '土咒', '風咒']));
      for (const sp of spOrder) {
        const wushenMinMp = isBayue ? 350 : 260;
        if (sp === '武神' && (!isHeavyBoss || (actor.mp ?? 0) < wushenMinMp)) continue;
        res = await pal.battle('magic', { magic: sp });
        if (res.ok) {
          rounds.push(`${actor.name}:magic(${sp})`);
          break;
        }
      }
      if (!res.ok && mpRefillItem && (isBoss || (actor.mp ?? 0) < 40)) {
        res = await pal.battle('item', { item: mpRefillItem.name, target: memberIdx });
        if (res.ok) rounds.push(`${actor.name}:mp(${mpRefillItem.name}->self)`);
      }
    }
    if (!res.ok && useSpell && actor.name === '阿奴') {
      const isFireImmune = enemies.some((e) => /火麒麟|火神龍/.test(e.name || ''));
      const spOrder = isFireImmune
        ? ['乾坤一擲', '天雷破', '萬蟻蝕象', '鬼降', '御蜂術']
        : (enemies.length >= 2
          ? ['爆炸蠱', '三昧真火', '天雷破', '炎殺咒', '萬蟻蝕象', '御蜂術']
          : ['乾坤一擲', '爆炸蠱', '天雷破', '三昧真火', '炎殺咒', '萬蟻蝕象', '御蜂術']);
      for (const sp of spOrder) {
        if (sp === '乾坤一擲' && (!isBoss || !isHeavyBoss || (pal.world.cash ?? 0) < 5000)) continue;
        res = await pal.battle('magic', { magic: sp });
        if (res.ok) {
          rounds.push(`阿奴:magic(${sp})`);
          break;
        }
      }
      if (!res.ok && mpRefillItem && (isBoss || (actor.mp ?? 0) < 40)) {
        res = await pal.battle('item', { item: mpRefillItem.name, target: memberIdx });
        if (res.ok) rounds.push(`阿奴:mp(${mpRefillItem.name}->self)`);
      }
    }
    if (!res.ok && pal.world.mode === 'battle') {
      res = await pal.battle('attack');
      rounds.push(`${actor.name || memberIdx}:attack(${enemies.map((e) => `${e.name}:${e.hp}`).join(',')})`);
    }
  }
  return { result: pal.world.lastBattleResult, rounds };
};

global.drain = async (opts = {}) => {
  const maxIter = typeof opts === 'number' ? opts : (opts.max || 40);
  const battles = [];
  for (let i = 0; i < maxIter; i++) {
    const m = pal.world.mode;
    if (m === 'control' || m === 'menu' || m === 'crashed') break;
    if (m === 'dialog') {
      await pal.advance(200);
    } else if (m === 'anykey') {
      await pal.press('Search');
    } else if (m === 'battle') {
      battles.push(await global.fightBattle((typeof opts === 'object' && opts.battle) || {}));
    } else {
      await pal.wait(1000);
    }
  }
  return battles;
};

global.closeMenus = async (max = 6) => {
  for (let i = 0; i < max && pal.world.mode === 'menu'; i++) {
    await pal.press('Menu');
    if (pal.world.mode === 'dialog') await pal.advance(50);
  }
  return pal.world.mode;
};

const resolveMemberIdx = (target) => {
  if (typeof target === 'number') return target;
  if (typeof target === 'string') {
    const idx = (pal.world.members || []).findIndex((m) => (m.name || '').includes(target));
    return idx >= 0 ? idx : 0;
  }
  return 0;
};

global.equip = async (itemName, memberIdx = 0) => {
  const idxTarget = resolveMemberIdx(memberIdx);
  await global.closeMenus();
  await pal.press('Menu');
  if (pal.world.mode !== 'menu') return { ok: false, reason: 'could not open menu' };
  await pal.choose(2); // 物品
  await pal.choose(0); // 裝備
  const m = pal.world.menu;
  const idx = (m?.items || []).findIndex((it) => it.enabled && it.label.includes(itemName));
  if (idx < 0) {
    await global.closeMenus();
    return { ok: false, reason: `item ${itemName} not found or not equippable` };
  }
  await pal.choose(idx);
  const mMember = pal.world.menu;
  if (mMember && mMember.items && mMember.items[idxTarget]?.enabled !== false) {
    await pal.choose(idxTarget);
  }
  await global.closeMenus();
  return { ok: true, item: itemName, memberIdx: idxTarget };
};

global.talk = async (id, opts = {}) => {
  global.takeDialogs();
  const startScene = pal.world.scene;
  const allBattles = [];
  let r = { ok: false, note: '' };
  let samePosCount = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const prevP = pal.world.player ? { ...pal.world.player } : null;
    r = await pal.invoke('nav.interact', { id });
    const b = await global.drain(opts);
    allBattles.push(...b);
    if (pal.world.scene !== startScene) break;
    if (!/interrupted.*mode now (battle|dialog)/i.test(String(r.note || ''))) break;
    if (!pal.world.objects.has(id)) break;
    const curP = pal.world.player;
    if (prevP && curP && prevP.gx === curP.gx && prevP.gy === curP.gy) {
      if (++samePosCount >= 2) break;
    } else {
      samePosCount = 0;
    }
  }
  return {
    ok: r.ok,
    note: r.note,
    lines: global.takeDialogs(),
    battles: allBattles,
    scene: pal.world.scene,
    pos: pal.world.player,
    mode: pal.world.mode
  };
};

global.goTo = async (x, y, opts = {}) => {
  global.takeDialogs();
  const startScene = pal.world.scene;
  const allBattles = [];
  let r = { ok: false, note: '' };
  let samePosCount = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const prevP = pal.world.player ? { ...pal.world.player } : null;
    r = await pal.invoke('nav.walk_to', { x, y });
    const b = await global.drain(opts);
    allBattles.push(...b);
    if (pal.world.scene !== startScene) break;
    const p = pal.world.player;
    if (p && p.gx === x && p.gy === y) break;
    if (!/interrupted.*mode now (battle|dialog)/i.test(String(r.note || ''))) {
      if (!r.ok && /no path/i.test(String(r.note || ''))) {
        const curP = pal.world.player || { gx: 0, gy: 0 };
        const blockers = [...pal.world.objects.values()]
          .filter((o) => o.kind === 'npc' && o.blocking && o.triggerMode >= 5)
          .sort((a, b2) => (Math.abs(a.gx - curP.gx) + Math.abs(a.gy - curP.gy) + Math.abs(a.gx - x) + Math.abs(a.gy - y)) - (Math.abs(b2.gx - curP.gx) + Math.abs(b2.gy - curP.gy) + Math.abs(b2.gx - x) + Math.abs(b2.gy - y)));
        let cleared = false;
        for (const blk of blockers) {
          const ri = await pal.invoke('nav.interact', { id: blk.id });
          const bi = await global.drain(opts);
          allBattles.push(...bi);
          if (bi.length > 0 || !pal.world.objects.has(blk.id) || (pal.world.player && (pal.world.player.gx !== curP.gx || pal.world.player.gy !== curP.gy))) {
            cleared = true;
            break;
          }
          if (!ri.ok && /no path/i.test(String(ri.note || ''))) continue;
        }
        if (cleared) {
          samePosCount = 0;
          continue;
        }
      }
      break;
    }
    if (prevP && p && prevP.gx === p.gx && prevP.gy === p.gy) {
      if (++samePosCount >= 2) break;
    } else {
      samePosCount = 0;
    }
  }
  return {
    ok: r.ok,
    note: r.note,
    lines: global.takeDialogs(),
    battles: allBattles,
    scene: pal.world.scene,
    pos: pal.world.player,
    mode: pal.world.mode
  };
};

global.stepDir = async (dir, steps = 1, opts = {}) => {
  global.takeDialogs();
  const r = await pal.step(dir, steps);
  const battles = await global.drain(opts);
  return {
    ok: r.ok,
    note: r.reply?.note || r.reply?.reason,
    lines: global.takeDialogs(),
    battles,
    scene: pal.world.scene,
    pos: pal.world.player,
    mode: pal.world.mode
  };
};

global.useOn = async (item, facing = null, target = 0, opts = {}) => {
  global.takeDialogs();
  const idxTarget = resolveMemberIdx(target);
  const r = await pal.invoke('nav.use_item', { item, target: idxTarget, ...(facing != null ? { facing } : {}) });
  const battles = await global.drain(opts);
  return {
    ok: r.ok,
    note: r.note,
    lines: global.takeDialogs(),
    battles,
    scene: pal.world.scene,
    pos: pal.world.player,
    mode: pal.world.mode
  };
};

global.status = async (includeMap = false) => {
  const p = pal.world.player || { gx: 0, gy: 0 };
  const objs = [...pal.world.objects.values()]
    .map((o) => ({ id: o.id, kind: o.kind, gx: o.gx, gy: o.gy, blocking: o.blocking, triggerMode: o.triggerMode, dist: Math.abs(o.gx - p.gx) + Math.abs(o.gy - p.gy) }))
    .sort((a, b) => a.dist - b.dist);
  return {
    scene: pal.world.scene,
    map: pal.world.map,
    mode: pal.world.mode,
    player: pal.world.player,
    party: pal.world.members,
    items: pal.world.items,
    cash: pal.world.cash,
    menu: pal.world.menu,
    objects: objs,
    ...(includeMap ? { ascii: await pal.invoke('nav.view') } : {})
  };
};

Object.assign(globalThis, global);
return { installed: Object.keys(global), scene: pal.world.scene, player: pal.world.player };
