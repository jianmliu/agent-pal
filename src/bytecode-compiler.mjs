/**
 * bytecode-compiler.mjs — 仙剑奇侠传字节码静态编译器与跨场景/连通分量拓扑规划器
 *
 * 融合 Claude Opus 5.5 (`opus-pure-lib.js`) 与 GPT-6.1-Sol (`gpt61-pure-lib.js`) 在
 * `--pure --seed 1` 全流程通关中各自独立发明的字节码拓扑编译技术，整理而成的独立、零副作用模块。
 *
 * 核心能力：
 *  1. 坐标与字节码反汇编：`blockToGrid` (`b2g`)、`trigRadius`、`exitReachRadius`、`disassemble`、`scriptOps`
 *  2. 单场景非步行跳跃边静态编译：
 *     - `compileTeleLinks`：解析 `0070`/`007A`/`007B` 往返移动浮板/传送阵、`0044` 乘藤/乘鹤（含 `0001` 正反向分支）、
 *       `0046` 场景内瞬移、同场景 `0059+0046` 传送阵（如女娲遗迹 `Scenes 221/223/225/226` 的 46 个同场景传送点）及 `006E` 相对偏移踏板
 *     - `compileRelJumps`：专门提取试炼窟/女娲神殿等迷宫的 `006E` 相对位移陷阱踏板 (`dx, dy -> dgx, dgy`)
 *     - `planHybridPath` (`path2`)：把步行网格 `.`、绝对传送 `T<id>` 与相对偏移 `TR<id>` 融合在同一张 BFS 图中求解混合路径
 *  3. 跨场景与连通分量（孤岛级）统一拓扑编译器：
 *     - `parseExit` (`exitOf`) / `sceneExits` (`exitObjs`)：同时识别触碰型出口 (`triggerMode >= 4`) 与隐藏调查暗门/绳索 (`triggerMode 1..3`, `search: true`)
 *     - `connectedComponents` (`compsOf`) / `compAt`：将任意场景地图切分为互不连通的步行孤岛 (`0..n-1`)
 *     - `buildRegionGraph` (`regionGraph`) / `planRegionRoute`：构建 `(scene:island) -> (toScene:toIsland)` 统一换乘图（涵盖跨场景出口、同场景传送阵与调查暗门）
 *     - `reachableSet` (`reachSet`) / `reachableExits` (`reachExits`) / `planMultiSceneRoute` (`planTo`)：
 *       结合场景内传送边、调查暗门交互半径与孤岛可达性，精确规划跨多场景到达目标场景指定坐标 `(tx, ty)` 的入口序列
 *  4. 运行时碰撞自学习 (`runtimeBlocks`)：
 *     - `recordBlockedTile` / `recordBlockedStep` / `getRuntimeBlocks` / `clearRuntimeBlocks`：记录动态碰撞并在单场景与跨场景规划中自动规避
 *  5. 机关与事件字节码因果反查：
 *     - `isFoe` (`0007`)、`isLoot` (`001F`/`001E`)、`isDoor` (`triggerScript=20` 或 `0004:22`)、`isSwitch` (`0024`/`0025`/`0049`/`009A`)
 *     - `whoMutatesObject` (`whoSets`)、`whoRuns`、`traceCallers` (`chainBack`)
 */

import fs from 'node:fs';
import path from 'node:path';

export const DIRS = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0]
];

/**
 * 将引擎底层块坐标 `(bx, by, h)` 转换为等距网格坐标 `[gx, gy]`。
 */
export function blockToGrid(bx, by, h = 0) {
  const x = bx * 32 + h * 16;
  const y = by * 16 + h * 8;
  return [Math.round(x / 32 + y / 16), Math.round(y / 16 - x / 32 + 64)];
}

/**
 * 计算触碰型触发器 (`triggerMode >= 4`) 的曼哈顿/切比雪夫触发半径。
 */
export function trigRadius(triggerMode) {
  return Math.max(0, (triggerMode || 0) - 4);
}

/**
 * 计算出口的可达交互半径（融合 GPT-6.1-Sol 的 `search` 暗门机制）：
 *  - 触碰型出口 (`triggerMode >= 4`)：半径为 `trigRadius(triggerMode)` (`triggerMode - 4`)
 *  - 调查型暗门/绳索 (`1 <= triggerMode <= 3`)：通常嵌在墙体 `#` 上，玩家在曼哈頓距离 `<= 2` 的相邻地面即可调查触发
 */
export function exitReachRadius(triggerMode) {
  const tm = triggerMode || 0;
  if (tm >= 1 && tm <= 3) return 2;
  return trigRadius(tm);
}

/**
 * 将 16 位无符号操作数还原为有符号整数 (`006E` 相对位移使用)。
 */
export function signed16(v) {
  return v > 32767 ? v - 65536 : v;
}

/**
 * 创建字节码静态编译器与拓扑规划器实例。
 *
 * @param {object} data
 * @param {Array} data.scenes - `scenes.json` 数组 (`[{ id, mapNum, ... }]`)
 * @param {Array} data.eventObjects - `event-objects.json` 数组 (`[{ id, scene, gx, gy, triggerMode, triggerScript, autoScript, state, ... }]`)
 * @param {Array} data.scripts - `scripts.json` 数组 (`[{ addr, op, name, operands, text }]`)
 * @param {Array} [data.scriptEntries] - `script-entries.json` 数组 (`[{ addr, refs }]`)
 * @param {Array} [data.objects] - `objects.json` 数组
 * @param {Array} [data.stores] - `stores.json` 数组
 * @param {Array} [data.enemyTeams] - `enemy-teams.json` 数组
 * @param {(mapNum: number) => Promise<string[]|null>|string[]|null} data.loadMapRows - 按 `mapNum` 加载地图行数组 `rows`
 */
export function createBytecodeCompiler({
  scenes = [],
  eventObjects = [],
  scripts = [],
  scriptEntries = [],
  objects = [],
  stores = [],
  enemyTeams = [],
  loadMapRows
}) {
  const byAddr = new Map(scripts.map((s) => [s.addr, s]));
  const eoById = new Map(eventObjects.map((e) => [e.id, e]));
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const seMap = new Map(scriptEntries.map((e) => [e.addr, e.refs]));
  const rowsCache = new Map();
  const exitCache = new Map();
  const compCache = new Map();
  const runtimeBlocksByScene = new Map();
  let cachedSceneGraph = null;

  function getRuntimeBlocks(sceneId) {
    if (!runtimeBlocksByScene.has(sceneId)) {
      runtimeBlocksByScene.set(sceneId, new Set());
    }
    return runtimeBlocksByScene.get(sceneId);
  }

  function recordBlockedTile(sceneId, x, y) {
    const key = `${x},${y}`;
    getRuntimeBlocks(sceneId).add(key);
    return key;
  }

  function recordBlockedStep(sceneId, fromX, fromY, toXOrDir, toY) {
    let tx = toXOrDir;
    let ty = toY;
    if (typeof toXOrDir === 'string') {
      const d = DIRS.find(([name]) => name === toXOrDir);
      if (!d) return null;
      tx = fromX + d[1];
      ty = fromY + d[2];
    }
    const set = getRuntimeBlocks(sceneId);
    const targetKey = `${tx},${ty}`;
    set.add(targetKey);
    set.add(`${fromX},${fromY}>${tx},${ty}`);
    return targetKey;
  }

  function clearRuntimeBlocks(sceneId = null) {
    if (sceneId == null) runtimeBlocksByScene.clear();
    else runtimeBlocksByScene.delete(sceneId);
  }

  function eoOf(id) {
    return eoById.get(id) || null;
  }

  async function rowsOfScene(sceneId) {
    const s = sceneById.get(sceneId);
    if (!s || !loadMapRows) return null;
    const mapNum = s.mapNum;
    if (!rowsCache.has(mapNum)) {
      try {
        const rows = await loadMapRows(mapNum);
        rowsCache.set(mapNum, rows || null);
      } catch {
        rowsCache.set(mapNum, null);
      }
    }
    return rowsCache.get(mapNum);
  }

  // ---- 1. 脚本反汇编与基础扫描 --------------------------------------------------------

  /**
   * 顺序读取从 `addr` 开始的脚本指令序列（遇到 `0000` 结束）。
   */
  function scriptOps(addr, maxOps = 300) {
    if (!addr) return [];
    const out = [];
    for (let a = addr, k = 0; k < maxOps; a++, k++) {
      const s = byAddr.get(a);
      if (!s) continue;
      out.push(s);
      if (s.op === '0000' && k > 0) break;
    }
    return out;
  }

  /**
   * 反汇编从 `addr` 开始的脚本指令为可读文本。
   */
  function disassemble(addr, maxOps = 60, stopAtEnd = true) {
    const out = [];
    for (let a = addr, k = 0; k < maxOps; a++, k++) {
      const s = byAddr.get(a);
      if (!s) continue;
      out.push(`${a} ${s.op} ${s.name || ''} ${(s.operands || []).join(',')}${s.text ? ' |' + s.text : ''}`);
      if (stopAtEnd && (s.op === '0000' || s.op === '0001') && k > 0) break;
    }
    return out.join('\n');
  }

  /**
   * 过滤满足谓词 `pred(instruction)` 的所有字节码指令。
   */
  function findOps(pred) {
    return scripts
      .filter(pred)
      .map((s) => `${s.addr} ${s.op} ${s.name || ''} ${(s.operands || []).join(',')}`);
  }

  // ---- 2. 机关、门、拾取物、敌人与因果反查 ---------------------------------------------

  function isFoe(objOrId) {
    const id = typeof objOrId === 'object' ? objOrId.id : objOrId;
    const e = eoOf(id);
    if (!e || !e.triggerScript) return false;
    const s = byAddr.get(e.triggerScript);
    return !!(s && s.op === '0007');
  }

  function isDoor(objOrId) {
    const id = typeof objOrId === 'object' ? objOrId.id : objOrId;
    const e = eoOf(id);
    if (!e || !e.triggerScript) return false;
    if (e.triggerScript === 20) return true;
    const s = byAddr.get(e.triggerScript);
    return !!(s && s.op === '0004' && s.operands?.[0] === 22);
  }

  function isLoot(objOrId) {
    const id = typeof objOrId === 'object' ? objOrId.id : objOrId;
    const tm = typeof objOrId === 'object' && objOrId.triggerMode != null ? objOrId.triggerMode : eoOf(id)?.triggerMode;
    const e = eoOf(id);
    if (!e || !e.triggerScript || tm > 3) return false;
    let item = false;
    for (let a = e.triggerScript, k = 0; k < 10; a++, k++) {
      const s = byAddr.get(a);
      if (!s) continue;
      if (s.op === '001F' || s.op === '001E') item = true;
      if (s.op === 'FFFF' && !/得|獲|發現|摘|採|找到/.test(s.text || '')) return false;
      if (s.op === '0007' || s.op === '0059') return false;
      if (s.op === '0000' || s.op === '0001') break;
    }
    return item;
  }

  function isSwitch(objOrId) {
    const id = typeof objOrId === 'object' ? objOrId.id : objOrId;
    const tm = typeof objOrId === 'object' && objOrId.triggerMode != null ? objOrId.triggerMode : eoOf(id)?.triggerMode;
    if (!(tm >= 4)) return false;
    const e = eoOf(id);
    if (!e || !e.triggerScript) return false;
    if (parseExit(e.triggerScript)) return false;
    if (isFoe(id)) return false;
    const ops = scriptOps(e.triggerScript, 30);
    return ops.some((s) => s.op === '0049' || s.op === '0024' || s.op === '0025' || s.op === '009A');
  }

  /**
   * 反查哪些脚本指令修改了指定事件对象 (`0024` 改 triggerMode、`0025` 改脚本地址、`0049` 改显隐状态)。
   */
  function whoMutatesObject(objectId, scriptAddr = null) {
    return findOps(
      (s) =>
        (s.op === '0025' || s.op === '0024' || s.op === '0049') &&
        s.operands?.[0] === objectId &&
        (scriptAddr == null || s.operands?.[1] === scriptAddr)
    );
  }

  function scriptStart(addr) {
    for (let a = addr - 1; a > addr - 1500; a--) {
      const s = byAddr.get(a);
      if (s && (s.op === '0000' || s.op === '0001' || s.op === '0002')) return a + 1;
    }
    return null;
  }

  /**
   * 反查哪一个事件对象 (`triggerScript` / `autoScript`) 或哪一条跳转指令调用了包含 `addr` 的脚本块。
   */
  function whoRuns(addr) {
    const st = scriptStart(addr) || addr;
    const cands = new Set([st]);
    for (let a = st; a <= addr; a++) {
      const s = byAddr.get(a);
      if (s && s.op !== 'FFFF') cands.add(a);
    }
    const out = [];
    for (const c of cands) {
      for (const e of eventObjects) {
        if (e.triggerScript === c) out.push(`trig obj ${e.id}@${e.scene}`);
        if (e.autoScript === c) out.push(`auto obj ${e.id}@${e.scene}`);
      }
      for (const h of findOps(
        (y) => ['0025', '0024', '006D', '0004', '0003', '0006'].includes(y.op) && (y.operands || []).includes(c)
      )) {
        out.push(`${h} (in ${scriptStart(+String(h).split(' ')[0])})`);
      }
    }
    return { start: st, callers: out };
  }

  /**
   * 递归向上追溯脚本调用链（默认最多 6 层）。
   */
  function traceCallers(addr, maxDepth = 6) {
    const out = [];
    let cur = addr;
    for (let i = 0; i < maxDepth; i++) {
      const w = whoRuns(cur);
      out.push({ addr: cur, start: w.start, callers: w.callers });
      const m = w.callers.map((s) => /^(\d+) /.exec(s)).find(Boolean);
      if (!m) break;
      cur = +m[1];
    }
    return out;
  }

  // ---- 3. 跨场景出口与单场景非步行跳跃边编译 (`exitOf` / `teleLinks` / `relJumps`) --------

  /**
   * 解析脚本地址是否为场景切换出口 (`0059` 切换场景 + 可选 `0046` 落点坐标)，
   * 并标记该脚本在切换前是否包含战斗 (`0007`) 或台词 (`FFFF`)。
   */
  function parseExit(addr) {
    if (!addr) return null;
    let pos = null;
    let to = null;
    let hasDialogOrBattle = false;
    for (let a = addr, k = 0; k < 40; a++, k++) {
      const s = byAddr.get(a);
      if (!s) continue;
      if (s.op === '0046') pos = s.operands;
      if (s.op === '0059') to = s.operands[0];
      if (s.op === '0007' || s.op === 'FFFF') hasDialogOrBattle = true;
      if (s.op === '0000' || s.op === '0001') break;
    }
    return to != null ? { to, at: pos ? blockToGrid(...pos) : null, hasDialogOrBattle } : null;
  }

  /**
   * 获取指定场景的所有跨场景出口对象（含 `triggerMode >= 4` 触碰出口与 `triggerMode 1..3` 调查型暗门/绳索）。
   * 若传入 `{ includeSameScene: true }`，还会包含 `x.to === sceneId` 的同场景 `0059` 传送阵。
   */
  function sceneExits(sceneId, { includeSameScene = false } = {}) {
    const cacheKey = `${sceneId}:${includeSameScene ? 1 : 0}`;
    if (exitCache.has(cacheKey)) return exitCache.get(cacheKey);
    const out = [];
    for (const e of eventObjects.filter((x) => x.scene === sceneId && x.triggerScript)) {
      const x = parseExit(e.triggerScript);
      if (!x) continue;
      if (!includeSameScene && x.to === sceneId) continue;
      const search = e.triggerMode >= 1 && e.triggerMode <= 3;
      out.push({
        id: e.id,
        gx: e.gx,
        gy: e.gy,
        tm: e.triggerMode,
        to: x.to,
        at: x.at,
        search,
        cleanSearch: search && !x.hasDialogOrBattle,
        sameScene: x.to === sceneId
      });
    }
    exitCache.set(cacheKey, out);
    return out;
  }

  /**
   * 静态编译场景内的非步行跳跃边 (`teleLinks`)：
   *  - `007A` / `007B` / `0070` 移动浮板与双向传送阵（支持 `0001`/`0002` 分支的 `halves` 双向端点推导）
   *  - `0044` 乘藤 / 乘鹤动画跨越 (`ride: true`)
   *  - `0046` 同场景内绝对坐标瞬移
   *  - 同场景 `0059 + 0046` (`x.to === sceneId`，如女娲遗迹 `Scenes 221/223/225/226` 的 46 个同场景传送阵)
   *  - `006E` 同场景内相对偏移跳板 (`dx, dy`)
   *
   * @param {number|Array} sceneOrObjects - 场景 ID 或当前可见对象列表 `[{ id, gx, gy, triggerMode }]`
   */
  function compileTeleLinks(sceneOrObjects) {
    const explicitSceneId = typeof sceneOrObjects === 'number' ? sceneOrObjects : null;
    const objs = Array.isArray(sceneOrObjects)
      ? sceneOrObjects
      : eventObjects
          .filter((x) => x.scene === sceneOrObjects)
          .map((e) => ({ id: e.id, scene: e.scene, gx: e.gx, gy: e.gy, triggerMode: e.triggerMode }));

    const links = [];
    for (const o of objs) {
      const e = eoOf(o.id);
      const objScene = o.scene ?? e?.scene ?? explicitSceneId;
      const triggerScript = o.triggerScript ?? e?.triggerScript;
      const tm = o.triggerMode ?? e?.triggerMode ?? 0;
      if (!triggerScript || !(tm >= 4)) continue;

      const exitInfo = parseExit(triggerScript);
      if (exitInfo) {
        // 跨到其他场景的出口交由 sceneExits 处理；但若是同场景 0059+0046 传送阵 (x.to === objScene)，保留为同场景传送边！
        if (objScene != null && exitInfo.to === objScene && exitInfo.at) {
          links.push({
            id: o.id,
            from: [o.gx, o.gy],
            to: exitInfo.at,
            sameSceneExit: true
          });
        }
        continue;
      }

      const halves = [];
      let cur = { p: null, t: null };
      let X = 0;
      let Y = 0;
      let n = 0;
      let pos = null;
      let rideTarget = null;
      let bad = false;

      for (let a = triggerScript, k = 0; k < 80; a++, k++) {
        const s = byAddr.get(a);
        if (!s) continue;
        if (s.op === '0044') {
          const g = blockToGrid(...s.operands);
          cur.p = g;
          rideTarget = g;
        }
        if (s.op === '007A' || s.op === '007B' || s.op === '0070') {
          cur.t = blockToGrid(...s.operands);
        }
        if (s.op === '006E') {
          const dx = signed16(s.operands[0]);
          const dy = signed16(s.operands[1]);
          X += dx;
          Y += dy;
          n++;
        }
        if (s.op === '0046') {
          pos = blockToGrid(...s.operands);
        }
        if (s.op === '0007' || s.op === '0059') {
          bad = true;
          break;
        }
        if (s.op === '0001' || s.op === '0002' || s.op === '0000') {
          if (cur.t) halves.push(cur);
          cur = { p: null, t: null };
          if (s.op !== '0001') break;
        }
      }

      if (bad) continue;
      if (halves.length >= 2) {
        const [H1, H2] = halves;
        links.push({ id: o.id, from: H2.p || [o.gx, o.gy], to: H1.t });
        links.push({ id: o.id, from: H1.p || [o.gx, o.gy], to: H2.t });
      } else if (halves.length === 1) {
        const to =
          halves[0].t[0] === o.gx && halves[0].t[1] === o.gy && rideTarget ? rideTarget : halves[0].t;
        links.push({
          id: o.id,
          from: [o.gx, o.gy],
          to,
          ...(to === rideTarget ? { ride: true } : {})
        });
      } else if (pos) {
        const to = pos[0] === o.gx && pos[1] === o.gy && rideTarget ? rideTarget : pos;
        links.push({
          id: o.id,
          from: [o.gx, o.gy],
          to,
          ...(to === rideTarget ? { ride: true } : {})
        });
      } else if (rideTarget && (rideTarget[0] !== o.gx || rideTarget[1] !== o.gy)) {
        links.push({ id: o.id, from: [o.gx, o.gy], to: rideTarget, ride: true });
      } else if (n > 0) {
        links.push({
          id: o.id,
          from: [o.gx, o.gy],
          to: [o.gx + Math.round(X / 32 + Y / 16), o.gy + Math.round(Y / 16 - X / 32)],
          relative: true
        });
      }
    }
    return links.filter((l) => l.from && l.to);
  }

  /**
   * 专门提取 `0x006E` 相对偏移踏板（如试炼窟滑落陷阱），保留其触发半径 `R` 与相对网格偏移 `rel: [dgx, dgy]`。
   * 当玩家从触发区任意格 `(x, y)` 踩入时，落点为 `(x + dgx, y + dgy)`。
   */
  function compileRelJumps(sceneOrObjects) {
    const objs = Array.isArray(sceneOrObjects)
      ? sceneOrObjects
      : eventObjects
          .filter((x) => x.scene === sceneOrObjects)
          .map((e) => ({ id: e.id, gx: e.gx, gy: e.gy, triggerMode: e.triggerMode }));

    const out = [];
    for (const o of objs) {
      const e = eoOf(o.id);
      const a0 = o.triggerScript ?? e?.triggerScript ?? 0;
      const tm = o.triggerMode ?? e?.triggerMode ?? 0;
      if (!a0 || tm < 4) continue;
      let dx = 0;
      let dy = 0;
      let ok = true;
      let n = 0;
      for (let a = a0; a < a0 + 60; a++) {
        const s = byAddr.get(a);
        if (!s) continue;
        if (s.op === '006E') {
          dx += signed16(s.operands[0]);
          dy += signed16(s.operands[1]);
          n++;
          continue;
        }
        if (s.op === '0000') break;
        if (['0059', '0007', '0046', '007A', '0070', '0044'].includes(s.op)) {
          ok = false;
          break;
        }
      }
      if (ok && n > 0) {
        const dgx = Math.round(dx / 32 + dy / 16);
        const dgy = Math.round(dy / 16 - dx / 32);
        out.push({ id: o.id, at: [o.gx, o.gy], R: trigRadius(tm), rel: [dgx, dgy] });
      }
    }
    return out;
  }

  // ---- 4. 单场景混合字节码图 BFS (`path2`) ---------------------------------------------

  /**
   * 在单个场景内执行字节码感知的混合 BFS (`path2`)：
   * 同时考虑地形 `.`、阻挡物体、`teleLinks` 绝对传送边 (`T<id>`) 与 `relJumps` 相对位移边 (`TR<id>`)，
   * 并自动绕开非目标的场景出口触发区。
   *
   * @param {object} params
   * @param {number} [params.scene] - 场景 ID（若未传 `rows` 则自动加载）
   * @param {string[]} [params.rows] - 地图行数组（可选，直接传入免 I/O）
   * @param {{ gx: number, gy: number }|[number, number]} params.start - 起点坐标
   * @param {((x: number, y: number) => boolean)|{ gx: number, gy: number }|[number, number]} params.goal - 目标谓词或坐标
   * @param {Array} [params.liveObjects] - 当前可见对象列表
   * @param {number[]} [params.passIds] - 允许穿过的阻挡对象 ID 列表
   * @param {number[]} [params.allowIds] - 允许踩入的非传送触发器 ID 列表
   * @param {number[]} [params.avoidIds] - 需要额外保持 `avoidRadius` 距离的对象 ID 列表
   * @param {number} [params.avoidRadius] - 对 `avoidIds` 的规避半径
   * @param {Set<string>} [params.learnedBlocked] - 动态学习到的不可通行边或格集合
   * @param {boolean} [params.useTeleports=true] - 是否启用 `teleLinks` 与 `relJumps`
   */
  async function planHybridPath({
    scene,
    rows: inputRows,
    start,
    goal,
    liveObjects,
    passIds = [],
    allowIds = [],
    avoidIds = [],
    avoidRadius = 0,
    learnedBlocked = new Set(),
    useTeleports = true
  }) {
    const rows = inputRows || (await rowsOfScene(scene));
    if (!rows) return null;
    const W = (x, y) => Boolean(rows[y] && rows[y][x] === '.');

    const sx = Array.isArray(start) ? start[0] : start.gx;
    const sy = Array.isArray(start) ? start[1] : start.gy;
    const goalFn =
      typeof goal === 'function'
        ? goal
        : (x, y) => x === (Array.isArray(goal) ? goal[0] : goal.gx) && y === (Array.isArray(goal) ? goal[1] : goal.gy);

    const objs =
      liveObjects ||
      eventObjects
        .filter((e) => e.scene === scene && e.state !== 0)
        .map((e) => ({
          id: e.id,
          scene: e.scene,
          gx: e.gx,
          gy: e.gy,
          triggerMode: e.triggerMode,
          blocking: e.state >= 2
        }));

    const runtimeBlocks = scene != null ? getRuntimeBlocks(scene) : new Set();
    const mergedLearnedBlocked = new Set([...runtimeBlocks, ...(learnedBlocked || [])]);

    const objMap = new Map(objs.map((o) => [o.id, o]));
    const passSet = new Set(passIds);
    const allowSet = new Set(allowIds);
    const block = new Set(
      objs
        .filter((o) => o.blocking && !isFoe(o) && !passSet.has(o.id))
        .map((o) => `${o.gx},${o.gy}`)
    );

    const links = useTeleports ? compileTeleLinks(scene != null && !liveObjects ? scene : objs) : [];
    const tele = new Map();
    for (const l of links) {
      const lo = objMap.get(l.id) || eoOf(l.id);
      const R = lo ? trigRadius(lo.triggerMode) : 1;
      for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= R) {
            const kk = `${l.from[0] + dx},${l.from[1] + dy}`;
            if (!tele.has(kk)) tele.set(kk, l);
          }
        }
      }
    }

    const rj = useTeleports ? compileRelJumps(objs) : [];
    const relZ = new Map();
    for (const j of rj) {
      for (let dx = -j.R; dx <= j.R; dx++) {
        for (let dy = -j.R; dy <= j.R; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= j.R) {
            const kk = `${j.at[0] + dx},${j.at[1] + dy}`;
            if (!relZ.has(kk)) relZ.set(kk, j);
          }
        }
      }
    }

    const avoid = new Set();
    for (const o of objs) {
      if (allowSet.has(o.id)) continue;
      if (links.some((l) => l.id === o.id) || rj.some((j) => j.id === o.id)) continue;
      if ((o.triggerMode ?? 0) < 4) continue;
      const e = eoOf(o.id) || o;
      if (!parseExit(e.triggerScript || 0)) continue;
      const R = trigRadius(o.triggerMode);
      for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= R) avoid.add(`${o.gx + dx},${o.gy + dy}`);
        }
      }
    }

    const avoidPts = avoidIds
      .map((id) => objMap.get(id))
      .filter(Boolean)
      .map((o) => [o.gx, o.gy]);

    const startKey = `${sx},${sy}`;
    avoid.delete(startKey);
    if (goalFn(sx, sy)) return { end: startKey, steps: [] };

    const prev = new Map([[startKey, null]]);
    const q = [[sx, sy]];
    let end = null;

    while (q.length) {
      const [x, y] = q.shift();
      const k = `${x},${y}`;
      if (k !== startKey && goalFn(x, y)) {
        end = k;
        break;
      }
      if (k !== startKey && relZ.has(k)) {
        const j = relZ.get(k);
        const nx2 = x + j.rel[0];
        const ny2 = y + j.rel[1];
        const nk = `${nx2},${ny2}`;
        if (!prev.has(nk)) {
          prev.set(nk, { k, tele: `R${j.id}` });
          q.push([nx2, ny2]);
        }
        continue;
      }
      if (k !== startKey && tele.has(k)) {
        const l = tele.get(k);
        const nk = l.to.join(',');
        if (!prev.has(nk)) {
          prev.set(nk, { k, tele: String(l.id) });
          q.push(l.to);
        }
        continue;
      }
      for (const [d, dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = `${nx},${ny}`;
        if (prev.has(nk) || !W(nx, ny) || block.has(nk)) continue;
        if (mergedLearnedBlocked.has(nk) || mergedLearnedBlocked.has(`${k}>${nk}`)) continue;
        if (avoid.has(nk) && !goalFn(nx, ny)) continue;
        if (
          avoidRadius > 0 &&
          avoidPts.some(([ax, ay]) => Math.abs(ax - nx) + Math.abs(ay - ny) <= avoidRadius) &&
          !goalFn(nx, ny)
        ) {
          continue;
        }
        prev.set(nk, { k, d });
        q.push([nx, ny]);
      }
    }

    if (!end) return null;
    const steps = [];
    let c = end;
    while (prev.get(c)) {
      const v = prev.get(c);
      steps.unshift(v.d || `T${v.tele}`);
      c = v.k;
    }
    return { end, steps };
  }

  // ---- 5. 连通分量（孤岛划分）与跨场景拓扑图 (`compsOf` / `regionGraph` / `planTo`) ------

  /**
   * 将指定场景的所有可步行格 (`.`) 划分为连通分量（步行孤岛 `0..n-1`）。
   */
  async function connectedComponents(sceneId) {
    if (compCache.has(sceneId)) return compCache.get(sceneId);
    const rows = await rowsOfScene(sceneId);
    if (!rows) return null;
    const H = rows.length;
    const comp = new Map();
    let n = 0;
    for (let y = 0; y < H; y++) {
      const row = rows[y] || '';
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '.' || comp.has(`${x},${y}`)) continue;
        const q = [[x, y]];
        comp.set(`${x},${y}`, n);
        while (q.length) {
          const [a, b] = q.shift();
          for (const [, dx, dy] of DIRS) {
            const nx = a + dx;
            const ny = b + dy;
            const k = `${nx},${ny}`;
            if (!comp.has(k) && rows[ny] && rows[ny][nx] === '.') {
              comp.set(k, n);
              q.push([nx, ny]);
            }
          }
        }
        n++;
      }
    }
    const res = { comp, count: n, rows };
    compCache.set(sceneId, res);
    return res;
  }

  /**
   * 查询坐标 `(x, y)` 所属的连通分量编号（允许在半径 `R+1` 内吸附最近可走格，适应压在墙边上的触发器）。
   */
  function compAt(compInfo, x, y, R = 1) {
    if (!compInfo || !compInfo.comp) return null;
    for (let r = 0; r <= R + 1; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const c = compInfo.comp.get(`${x + dx},${y + dy}`);
          if (c != null) return c;
        }
      }
    }
    return null;
  }

  /**
   * 为一组多层迷宫场景（如试炼窟 `Scenes 216–226`）构建 `scene:island -> toScene:toIsland` 的统一有向换乘图：
   *  1. 跨场景出口 (`0059` + `0046`)，含触碰型出口 (`tm >= 4`) 与隐藏调查暗门/绳索 (`1 <= tm <= 3`, `search: true`)
   *  2. 同场景孤岛间跳跃边 (`includeIntraScene !== false`)：含 `compileTeleLinks`（`0044`/`0070`/`007A`/`007B`/`0046`/同场景 `0059`）
   *     与 `compileRelJumps` (`006E` 滑行踏板)，当起点与落点分属不同步行孤岛时自动生成 `s:from -> s:to` 换乘边
   */
  async function buildRegionGraph(sceneIds, { includeIntraScene = true } = {}) {
    const sceneSet = new Set(sceneIds);
    const edges = [];
    for (const s of sceneIds) {
      const C = await connectedComponents(s);
      if (!C) continue;
      for (const e of eventObjects.filter((ev) => ev.scene === s && ev.triggerScript)) {
        const x = parseExit(e.triggerScript);
        if (!x || !x.at || !sceneSet.has(x.to)) continue;
        const search = e.triggerMode >= 1 && e.triggerMode <= 3;
        if (search && x.hasDialogOrBattle) continue;
        const C2 = await connectedComponents(x.to);
        if (!C2) continue;
        const from = compAt(C, e.gx, e.gy, exitReachRadius(e.triggerMode));
        const to = compAt(C2, x.at[0], x.at[1], 0);
        if (from == null || to == null) continue;
        if (x.to === s && from === to) continue;
        edges.push({
          from: `${s}:${from}`,
          to: `${x.to}:${to}`,
          id: e.id,
          gx: e.gx,
          gy: e.gy,
          tm: e.triggerMode,
          state: e.state,
          search,
          intraScene: x.to === s
        });
      }

      if (includeIntraScene) {
        const seenIntra = new Set(edges.filter((e) => e.intraScene).map((e) => `${e.id}:${e.from}->${e.to}`));
        for (const l of compileTeleLinks(s)) {
          const eo = eoOf(l.id);
          const tm = eo?.triggerMode ?? 4;
          const from = compAt(C, l.from[0], l.from[1], exitReachRadius(tm));
          const to = compAt(C, l.to[0], l.to[1], 0);
          if (from == null || to == null || from === to) continue;
          const key = `${l.id}:${s}:${from}->${s}:${to}`;
          if (seenIntra.has(key)) continue;
          seenIntra.add(key);
          edges.push({
            from: `${s}:${from}`,
            to: `${s}:${to}`,
            id: l.id,
            gx: l.from[0],
            gy: l.from[1],
            tm,
            state: eo?.state ?? 1,
            search: false,
            intraScene: true,
            ride: Boolean(l.ride)
          });
        }
        for (const j of compileRelJumps(s)) {
          const eo = eoOf(j.id);
          const tm = eo?.triggerMode ?? 4;
          const from = compAt(C, j.at[0], j.at[1], j.R);
          const to = compAt(C, j.at[0] + j.rel[0], j.at[1] + j.rel[1], 0);
          if (from == null || to == null || from === to) continue;
          const key = `${j.id}:${s}:${from}->${s}:${to}`;
          if (seenIntra.has(key)) continue;
          seenIntra.add(key);
          edges.push({
            from: `${s}:${from}`,
            to: `${s}:${to}`,
            id: j.id,
            gx: j.at[0],
            gy: j.at[1],
            tm,
            state: eo?.state ?? 1,
            search: false,
            intraScene: true,
            relative: true
          });
        }
      }
    }
    return edges;
  }

  /**
   * 在 `buildRegionGraph` 生成的孤岛换乘图上用 BFS 求解从 `fromNode` (`"217:0"`) 到 `toNode` (`"219:3"`) 的换乘边序列。
   */
  function planRegionRoute(fromNode, toNode, edges, badEdgeIds = new Set()) {
    if (fromNode === toNode) return [];
    const prev = new Map([[fromNode, null]]);
    const q = [fromNode];
    while (q.length) {
      const n = q.shift();
      if (n === toNode) break;
      for (const e of edges) {
        if (badEdgeIds.has(e.id)) continue;
        if (e.from === n && !prev.has(e.to)) {
          prev.set(e.to, e);
          q.push(e.to);
        }
      }
    }
    if (!prev.has(toNode)) return null;
    const route = [];
    let c = toNode;
    while (prev.get(c)) {
      const step = prev.get(c);
      route.unshift(step);
      c = step.from;
    }
    return route;
  }

  /**
   * 计算从场景 `sceneId` 的 `start` (`[gx, gy]`) 出发（含场景内 `teleLinks` 与 `relJumps`，但不过跨场景触碰出口）
   * 所能到达的所有格集合。
   */
  async function reachableSet(sceneId, start, extraBlocked = null) {
    const rows = await rowsOfScene(sceneId);
    if (!rows || !start) return null;
    const ex = sceneExits(sceneId);
    const runtimeBlocks = getRuntimeBlocks(sceneId);
    const isBlocked = (x, y) => {
      const k = `${x},${y}`;
      return runtimeBlocks.has(k) || Boolean(extraBlocked && extraBlocked.has(k));
    };
    const W = (x, y) => Boolean(rows[y] && rows[y][x] === '.' && !isBlocked(x, y));
    const zone = new Set();
    for (const e of ex) {
      // 仅屏蔽触碰型出口 (tm >= 4)，调查型出口 (tm 1..3) 经过时不会自动触发
      if ((e.tm ?? 0) < 4) continue;
      const r = trigRadius(e.tm);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= r) zone.add(`${e.gx + dx},${e.gy + dy}`);
        }
      }
    }
    const tl = new Map();
    for (const l of compileTeleLinks(sceneId)) {
      const lo = eoOf(l.id);
      const R = lo ? trigRadius(lo.triggerMode) : 0;
      for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= R) {
            const kk = `${l.from[0] + dx},${l.from[1] + dy}`;
            if (!tl.has(kk)) tl.set(kk, l.to);
          }
        }
      }
    }
    for (const j of compileRelJumps(sceneId)) {
      for (let dx = -j.R; dx <= j.R; dx++) {
        for (let dy = -j.R; dy <= j.R; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= j.R) {
            const sx = j.at[0] + dx;
            const sy = j.at[1] + dy;
            const kk = `${sx},${sy}`;
            if (!tl.has(kk)) tl.set(kk, [sx + j.rel[0], sy + j.rel[1]]);
          }
        }
      }
    }
    const sk = start.join(',');
    const seen = new Set([sk]);
    const q = [start];
    let n = 0;
    while (q.length && n++ < 80000) {
      const [x, y] = q.shift();
      const k = `${x},${y}`;
      if (k !== sk && zone.has(k)) continue;
      if (tl.has(k)) {
        const t = tl.get(k);
        const tk = t.join(',');
        if (!seen.has(tk)) {
          seen.add(tk);
          q.push(t);
        }
      }
      for (const [, dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = `${nx},${ny}`;
        if (seen.has(nk) || !W(nx, ny)) continue;
        if (runtimeBlocks.has(`${k}>${nk}`)) continue;
        seen.add(nk);
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  /**
   * 计算从 `sceneId` 的 `start` (`[gx, gy]`) 出发可实际够到的跨场景出口 ID 列表
   * （支持触碰型出口 `tm >= 4` 与无战斗/台词阻碍的调查型暗门/绳索 `1 <= tm <= 3`）。
   */
  async function reachableExits(sceneId, start, extraBlocked = null) {
    const seen = await reachableSet(sceneId, start, extraBlocked);
    const ex = sceneExits(sceneId).filter((e) => !e.search || e.cleanSearch);
    if (!seen) return ex.map((e) => e.id);
    return ex
      .filter((e) => {
        const r = exitReachRadius(e.tm);
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) + Math.abs(dy) <= r && seen.has(`${e.gx + dx},${e.gy + dy}`)) return true;
          }
        }
        return false;
      })
      .map((e) => e.id);
  }

  /**
   * 构建全游戏粗粒度场景邻接图 `Map<sceneId, Set<toSceneId>>`。
   */
  function buildSceneGraph() {
    if (cachedSceneGraph) return cachedSceneGraph;
    const g = new Map();
    for (const e of eventObjects) {
      if (!e.triggerScript) continue;
      const x = parseExit(e.triggerScript);
      if (!x) continue;
      if (!g.has(e.scene)) g.set(e.scene, new Set());
      g.get(e.scene).add(x.to);
    }
    cachedSceneGraph = g;
    return g;
  }

  /**
   * 在粗粒度场景图上求最短场景序列。
   */
  function planScenePath(fromScene, toScene, badEdges = new Set()) {
    const g = buildSceneGraph();
    const prev = new Map([[fromScene, null]]);
    const q = [fromScene];
    while (q.length) {
      const s = q.shift();
      if (s === toScene) break;
      for (const n of g.get(s) || []) {
        if (!prev.has(n) && !badEdges.has(`${s}>${n}`)) {
          prev.set(n, s);
          q.push(n);
        }
      }
    }
    if (!prev.has(toScene)) return null;
    const p = [];
    let c = toScene;
    while (c !== fromScene) {
      p.unshift(c);
      c = prev.get(c);
    }
    return p;
  }

  /**
   * 跨多场景 + 孤岛可达性精确规划 (`planTo`)：
   * 从 `fromScene` 的 `startPos` (`[gx, gy]`) 出发，找到进入 `toScene` 后能真正步行/传送到达
   * `targetPos` (`[tx, ty]`，容差半径 `targetRadius`) 的跨场景出口序列 `[{ scene, exit, to, landing }]`。
   */
  async function planMultiSceneRoute({
    fromScene,
    startPos,
    toScene,
    targetPos,
    targetRadius = 1,
    liveBlocking = null,
    badExits = new Set()
  }) {
    const startArr = Array.isArray(startPos) ? startPos : [startPos.gx, startPos.gy];
    const [tx, ty] = Array.isArray(targetPos) ? targetPos : [targetPos.gx, targetPos.gy];
    const key = (s, c) => `${s}@${c ? c.join(',') : '?'}`;
    const startK = key(fromScene, startArr);
    const prev = new Map([[startK, null]]);
    const q = [[fromScene, startArr]];
    let goal = null;
    let n = 0;

    while (q.length && n++ < 500) {
      const [s, c] = q.shift();
      const eb = s === fromScene && c && c[0] === startArr[0] && c[1] === startArr[1] ? liveBlocking : null;
      if (s === toScene) {
        const seen = await reachableSet(s, c, eb);
        let ok = false;
        if (seen) {
          for (let dx = -targetRadius; dx <= targetRadius && !ok; dx++) {
            for (let dy = -targetRadius; dy <= targetRadius && !ok; dy++) {
              if (Math.abs(dx) + Math.abs(dy) <= targetRadius && seen.has(`${tx + dx},${ty + dy}`)) {
                ok = true;
              }
            }
          }
        }
        if (ok) {
          goal = key(s, c);
          break;
        }
      }
      const ids = await reachableExits(s, c, eb);
      for (const id of ids) {
        const e = sceneExits(s).find((x) => x.id === id);
        if (!e) continue;
        if (badExits.has(`${s}:${id}`)) continue;
        const nk = key(e.to, e.at);
        if (prev.has(nk)) continue;
        prev.set(nk, {
          from: key(s, c),
          exit: id,
          scene: s,
          to: e.to,
          landing: e.at,
          search: Boolean(e.search)
        });
        q.push([e.to, e.at]);
      }
    }

    if (!goal) return null;
    const steps = [];
    let c = goal;
    while (prev.get(c)) {
      const v = prev.get(c);
      steps.unshift({
        scene: v.scene,
        exit: v.exit,
        to: v.to,
        landing: v.landing,
        ...(v.search ? { search: true } : {})
      });
      c = v.from;
    }
    return steps;
  }

  return {
    // 基础与反汇编
    eoOf,
    rowsOfScene,
    scriptOps,
    disassemble,
    findOps,
    // 语义分类与因果反查
    isFoe,
    isDoor,
    isLoot,
    isSwitch,
    whoMutatesObject,
    whoRuns,
    traceCallers,
    // 场景内跳跃边与混合寻路
    parseExit,
    sceneExits,
    compileTeleLinks,
    compileRelJumps,
    planHybridPath,
    // 运行时碰撞自学习 (GPT-6.1-Sol 特性)
    getRuntimeBlocks,
    recordBlockedTile,
    recordBlockedStep,
    clearRuntimeBlocks,
    // 连通分量（孤岛）与跨场景精确拓扑
    connectedComponents,
    compAt,
    buildRegionGraph,
    planRegionRoute,
    reachableSet,
    reachableExits,
    buildSceneGraph,
    planScenePath,
    planMultiSceneRoute
  };
}

/**
 * 从本地 `AGENT_PAL_DATA_DIR` 目录直接构建编译器实例（适用于独立 Node 脚本或 MCP 模块）。
 */
export function createBytecodeCompilerFromDir(dataDir) {
  const readJson = (rel) => {
    const p = path.join(dataDir, rel);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  };
  return createBytecodeCompiler({
    scenes: readJson('scenes.json'),
    eventObjects: readJson('event-objects.json'),
    scripts: readJson('scripts.json'),
    scriptEntries: readJson('script-entries.json'),
    objects: readJson('objects.json'),
    stores: readJson('stores.json'),
    enemyTeams: readJson('enemy-teams.json'),
    loadMapRows: (mapNum) => {
      const p = path.join(dataDir, 'maps', `${mapNum}.json`);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).rows : null;
    }
  });
}

/**
 * 从 `run_code` 沙箱中的 `pal` 对象异步加载数据并构建编译器实例。
 */
export async function createBytecodeCompilerFromPal(pal) {
  const [scenes, eventObjects, scripts, scriptEntries, objects, stores, enemyTeams] = await Promise.all([
    pal.readData('scenes.json'),
    pal.readData('event-objects.json'),
    pal.readData('scripts.json'),
    pal.readData('script-entries.json').catch(() => []),
    pal.readData('objects.json').catch(() => []),
    pal.readData('stores.json').catch(() => []),
    pal.readData('enemy-teams.json').catch(() => [])
  ]);
  return createBytecodeCompiler({
    scenes,
    eventObjects,
    scripts,
    scriptEntries,
    objects,
    stores,
    enemyTeams,
    loadMapRows: async (mapNum) => {
      const m = await pal.readData(`maps/${mapNum}.json`);
      return m?.rows || null;
    }
  });
}
