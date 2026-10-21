/**
 * state-view — 判分读的唯一一层「引擎状态」(docs/specs/agent-pal-bench.md §4.1)。
 *
 * bench 里只有这个文件贴着引擎:脚本虚拟机迁上 ECS、加 PAL 线协议之后,只换这里的实现,
 * 题目与谓词不动。读数刻意**不消耗**任何给模型看的东西:对白走 engine 的全量对白日志 e.dialogLog
 * 自己记「看过哪条」,不调 observe()(observe 会把「新文字」标成已读,模型就看不到了)。
 *
 * 用法:const tracker = createStateTracker(e, a); 每次工具调用后 tracker.update(); tracker.view()
 */

const big5dec = (() => { try { return new TextDecoder('big5'); } catch { return null; } })();
const BATTLE_RESULT = { 3: 'won', 1: 'lost', 0xffff: 'fled', 0: 'terminated' };

export function createStateTracker(e, a, { battleMetrics = null } = {}) {
  const { worldService: ws, dialogService, ui } = e;
  const word = (n) => {
    try {
      const w = ui.getWord(n);
      if (typeof w === 'string') return w.replace(/ +$/, '').trim();
      if (w && big5dec) return big5dec.decode(new Uint8Array(w)).replace(/ +$/, '').trim();
    } catch { /* */ }
    return '';
  };
  const roleVal = (field, role) => { try { return Number(ws._getPlayerRoleArrayValue(field, role, 0)) || 0; } catch { return 0; } };

  const seen = new Set();          // dialogService 历史条目(按引用)
  const textLog = [];
  const visitedScenes = new Set();
  const battles = [];
  let cur = null;                  // 进行中的战斗

  function update() {
    const scene = ws.getSceneId();
    visitedScenes.add(scene);

    for (const h of e.dialogLog || dialogService.getHistory?.() || []) {
      if (!h || seen.has(h)) continue;
      seen.add(h);
      const t = String(h.text || '').trim();
      if (!t) continue;
      const sp = h.source ? String(h.source).trim() : '';
      if (sp && t === sp) continue;                   // 说话人名行
      textLog.push(sp ? `${sp}：${t}` : t);
    }

    const inBattle = !!ws.isInBattle();
    const st = e.services.battle.getState?.();
    if (inBattle) {
      cur ??= { enemyTeam: st?.enemyTeam ?? null, result: null };
      if (st?.battleResult != null) cur.result = st.battleResult;
    } else if (cur) {
      const r = st?.battleResult ?? cur.result;
      battles.push({ enemyTeam: cur.enemyTeam, outcome: BATTLE_RESULT[r] ?? `result-${r}` });
      cur = null;
    }
  }

  function view() {
    const p = a.playerPos();
    const party = (ws.getParty() || []).slice(0, (ws.getMaxPartyMemberIndex?.() ?? 0) + 1).map((m) => {
      const roleId = m?.playerRole;
      return {
        roleId,
        name: word(roleVal('name', roleId)) || `role${roleId}`,
        level: roleVal('level', roleId),
        hp: roleVal('HP', roleId), maxHp: roleVal('maxHP', roleId),
        mp: roleVal('MP', roleId), maxMp: roleVal('maxMP', roleId)
      };
    });
    const inventory = (ws.getInventory() || [])
      .filter((it) => it && it.item)
      .map((it) => ({ itemId: it.item, name: word(it.item), amount: it.amount ?? 0 }));
    // 与 agent.objects() 同一编号(interact 用的 id):entry.id ?? entry.index + 1;状态在 entry.state 里
    const eventObjects = (ws.getEventObjectsInCurrentScene?.() || [])
      .filter((en) => en && en.state)
      .map((en) => ({
        idx: en.id ?? en.index + 1,
        state: en.state.state,
        triggerScript: en.state.triggerScript,
        autoScript: en.state.autoScript
      }));
    return {
      scene: ws.getSceneId(),
      pos: { gx: p.gx, gy: p.gy },
      visitedScenes: [...visitedScenes],
      party,
      inventory,
      cash: Number(ws.getCash?.() ?? 0),
      mode: a.mode(),
      inBattle: !!ws.isInBattle(),
      battles: battleMetrics ? battleMetrics.snapshot().completed : [...battles],
      ...(battleMetrics ? { battleTelemetry: battleMetrics.snapshot(), enemies: (e.services.battle.getState()?.enemy || []).filter(x=>x?.objectID).map(x=>({objectId:x.objectID,hp:x.e?.health})) } : {}),
      eventObjects,
      textLog: [...textLog]
    };
  }

  return { update, view };
}
