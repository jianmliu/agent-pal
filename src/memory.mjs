/**
 * memory — agent 自己积累的地图记忆(agent-wow「agent 自建能力」那一层的最小版)。
 *
 * 全自动,不靠人工整理地图:
 *  - exits:走路/走一步时发生跳变(换场景或瞬移),记「场景 A 的触发器 X → 场景 B 某格」。
 *  - npcs:interact 打开对白时,第一个不是主角的说话人就是这个物体的名字;observe 时顺手记位置。
 * 地图是静态世界知识,跨存读档、跨运行都有效,所以落盘(默认与存档同目录 memory.json)。
 */
import fs from 'node:fs';
import path from 'node:path';

export function createMemory(file, { sceneName = () => null } = {}) {
  const label = (scene) => { const n = sceneName(scene); return n ? `scene ${scene} (${n})` : `scene ${scene}`; };
  let data = { exits: {}, npcs: {}, visited: {} };
  if (file) {
    try { data = { exits: {}, npcs: {}, visited: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* 新文件 */ }
  }
  // 走过的格子:每个场景一个集合,落盘成整数数组(gx * 1024 + gy)。连跑接力每轮换进程,不落盘就全忘了
  // (第 55–56 轮:AI 在死路场景 289 里转了两轮多,不知道 287 还有一个没走过的出口)。
  const CELL = (gx, gy) => gx * 1024 + gy;
  const visited = new Map(Object.entries(data.visited || {}).map(([sc, cells]) => [Number(sc), new Set(cells)]));
  let dirtyCells = 0;
  const flush = () => {
    if (!file) return;
    data.visited = Object.fromEntries([...visited].map(([sc, set]) => [sc, [...set]]));
    dirtyCells = 0;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1)); } catch { /* 记不住不影响玩 */ }
  };
  const k = (scene, id) => `${scene}:${id}`;

  function npcsNear(scene, gx, gy, r = 12) {
    const out = [];
    for (const [key, n] of Object.entries(data.npcs)) {
      if (!n.name || !key.startsWith(`${scene}:`)) continue;
      if (Math.abs(n.gx - gx) <= r && Math.abs(n.gy - gy) <= r) out.push(n.name);
    }
    return [...new Set(out)];
  }

  function describeExit(e) {
    const near = npcsNear(e.to.scene, e.to.gx, e.to.gy);
    return `→ ${label(e.to.scene)} (${e.to.gx},${e.to.gy})${near.length ? ` near ${near.join('、')}` : ''}${e.count > 1 ? ` [used ${e.count}×]` : ''}`;
  }

  return {
    file,
    recordExit({ scene, triggerId, at, to }) {
      const key = k(scene, triggerId ?? `@${at.gx},${at.gy}`);
      const prev = data.exits[key];
      data.exits[key] = { scene, triggerId, at, to, count: (prev?.count || 0) + 1 };
      flush();
    },
    exit: (scene, id) => data.exits[k(scene, id)] || null,
    /** 记下站过的一格;攒够一批再落盘(换场景时 recordExit 也会落盘) */
    recordCell(scene, gx, gy) {
      if (!(scene > 0)) return;
      let set = visited.get(scene);
      if (!set) visited.set(scene, set = new Set());
      const c = CELL(gx, gy);
      if (set.has(c)) return;
      set.add(c);
      if (++dirtyCells >= 150) flush();
    },
    wasAt: (scene, gx, gy) => !!visited.get(scene)?.has(CELL(gx, gy)),
    visitedCells: (scene) => [...(visited.get(scene) || [])].map((c) => ({ gx: Math.floor(c / 1024), gy: c % 1024 })),
    /** 去过的场景:站过格子的,或走过出口的两头(旧 memory 文件只有出口记录) */
    visitedScenes() {
      const out = new Set(visited.keys());
      for (const e of Object.values(data.exits)) { out.add(e.scene); if (e.to?.scene != null) out.add(e.to.scene); }
      return out;
    },
    exitsIn: (scene) => Object.values(data.exits).filter((e) => e.scene === scene),
    describeExit,
    recordNpc(scene, id, patch) {
      const key = k(scene, id);
      const prev = data.npcs[key] || {};
      const next = { ...prev, ...patch };
      if (JSON.stringify(prev) === JSON.stringify(next)) return;
      data.npcs[key] = next;
      if (patch.name && patch.name !== prev.name) flush();   // 位置变动不必每次落盘
    },
    npcName: (scene, id) => data.npcs[k(scene, id)]?.name || null,
    npcsNear,
    /** map 工具:全部已知出口,按场景分组。 */
    describe() {
      const byScene = new Map();
      for (const e of Object.values(data.exits)) {
        if (!byScene.has(e.scene)) byScene.set(e.scene, []);
        byScene.get(e.scene).push(e);
      }
      if (!byScene.size) return 'No exits remembered yet. They are recorded automatically whenever you walk through one.';
      const lines = [];
      for (const [scene, list] of [...byScene].sort((a, b) => a[0] - b[0])) {
        const here = [...new Set(Object.entries(data.npcs).filter(([key, n]) => key.startsWith(`${scene}:`) && n.name).map(([, n]) => n.name))];
        lines.push(`${label(scene)}${here.length ? ` (people met here: ${here.join('、')})` : ''}`);
        for (const e of list) lines.push(`  exit ${e.triggerId != null ? `id=${e.triggerId} ` : ''}at (${e.at.gx},${e.at.gy}) ${describeExit(e)}`);
      }
      return lines.join('\n');
    },
    flush
  };
}
