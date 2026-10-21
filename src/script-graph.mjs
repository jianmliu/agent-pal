/**
 * script-graph — 脚本(SSS.MKF #4)的控制流:opcode 名、跳转 / 调用 / 安装目标、可达性。
 * opcode-roots(未覆盖 opcode 的入口)与 data dump(脚本反汇编)共用,控制流表只此一份。
 *
 * 控制流按 SDLPAL script.c 逐条对照:
 *  - 顺序执行:除 0x0000 外都连下一条。0x0001 结束时把下一条存为续点(trigger 的 wNextScriptEntry、
 *    auto 的 wScriptEntry++),下次触发从那里继续,所以也算一条边(resume)。0x0002 / 0x0003 计数为 0 时总是跳走。
 *  - 跳转 / 调用:TARGETS 里列出的操作数(`wScriptEntry = rgwOperand[n] - 1` 以及 trigger / auto 自己处理的 0x0002–0x000A)。
 *  - 0x00A2 随机跳到后 N 条之一(+= rand(0, N-1),再 +1)。
 *  - 安装:0x0024 / 0x0025 设事件对象脚本、0x006D 设场景脚本、0x0090 设物件脚本 —— 目标不马上执行,之后由数据触发。
 * 条件跳转两边都算,所以「可达」是过近似:可能走到,不保证一定走到。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OPS_DOC = path.resolve(HERE, '../docs/script-ops-migration.md');

export const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');

export const TARGETS = {
  0x0002: [0], 0x0003: [0], 0x0004: [0], 0x0006: [1], 0x0007: [1, 2], 0x000A: [0],
  0x001E: [1], 0x0020: [2], 0x002E: [2], 0x0033: [0], 0x0034: [0], 0x0038: [0], 0x003A: [0],
  0x0058: [2], 0x005D: [1], 0x005E: [1], 0x0061: [0], 0x0064: [1], 0x0068: [0], 0x0074: [0],
  0x0079: [1], 0x0081: [2], 0x0083: [2], 0x0084: [2], 0x0086: [2], 0x0091: [0], 0x0094: [2],
  0x0095: [1], 0x009C: [1], 0x009E: [2]
};
export const INSTALLS = { 0x0024: [1], 0x0025: [1], 0x006D: [1, 2], 0x0090: [1] };

function fallsThrough(ins) {
  if (ins.op === 0x0000) return false;
  return !((ins.op === 0x0002 || ins.op === 0x0003) && ins.a[1] === 0);
}

/** 第 i 条指令的出边:[{ to, kind }],kind = next | resume | jump | call | random | install。 */
export function successors(script, i) {
  const ins = script[i];
  const out = [];
  const add = (to, kind) => { if (to > 0 && to < script.length) out.push({ to, kind }); };
  if (fallsThrough(ins)) add(i + 1, ins.op === 0x0001 ? 'resume' : 'next');
  if (ins.op === 0x00A2) for (let k = 2; k <= ins.a[0]; k++) add(i + k, 'random');
  for (const k of TARGETS[ins.op] || []) add(ins.a[k], ins.op === 0x0004 ? 'call' : 'jump');
  for (const k of INSTALLS[ins.op] || []) add(ins.a[k], 'install');
  return out;
}

/** 反向邻接表:pred[i] = 能走到 i 的 [来源地址, 边类型]。 */
export function buildPredecessors(script) {
  const pred = Array.from({ length: script.length }, () => []);
  script.forEach((_, i) => { for (const { to, kind } of successors(script, i)) pred[to].push([i, kind]); });
  return pred;
}

/** 从 start 反向 BFS,遇到 roots(Map<地址, 说明[]>)里登记的入口就记下:[{ addr, depth, roots }],按距离排序。 */
export function findRoots(start, pred, roots, limit = 20000) {
  const seen = new Map([[start, 0]]);
  const queue = [start];
  const found = [];
  for (let qi = 0; qi < queue.length && seen.size < limit; qi++) {
    const at = queue[qi];
    const d = seen.get(at);
    if (roots.has(at)) found.push({ addr: at, depth: d, roots: roots.get(at) });
    for (const [from] of pred[at]) {
      if (!seen.has(from)) { seen.set(from, d + 1); queue.push(from); }
    }
  }
  return found;
}

/**
 * 从所有入口同时正向 BFS:每条指令最近的入口地址与步数(走不到 = -1)。
 * 入口按地址升序入队,同距离时取地址小的,结果确定。
 */
export function nearestEntry(script, entryAddrs) {
  const entry = new Int32Array(script.length).fill(-1);
  const depth = new Int32Array(script.length).fill(-1);
  const queue = [];
  for (const a of [...new Set(entryAddrs)].filter((a) => a > 0 && a < script.length).sort((x, y) => x - y)) {
    entry[a] = a; depth[a] = 0; queue.push(a);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const at = queue[qi];
    for (const { to } of successors(script, at)) {
      if (depth[to] !== -1) continue;
      entry[to] = entry[at]; depth[to] = depth[at] + 1; queue.push(to);
    }
  }
  return { entry, depth };
}

/** SSS.MKF #4 的原始字节 → [{ op, a: [3] }](每条 4 个 WORD,小端)。 */
export function decodeScript(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = [];
  for (let i = 0; i + 8 <= u8.byteLength; i += 8) {
    out.push({ op: dv.getUint16(i, true), a: [dv.getUint16(i + 2, true), dv.getUint16(i + 4, true), dv.getUint16(i + 6, true)] });
  }
  return out;
}

/** 迁移清单里的 opcode 表:Map<op, { domain, name }>。读不到文档时返回空表(反汇编只缺名字)。 */
export function readOpsDoc(file = OPS_DOC) {
  const ops = new Map();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ops; }
  let domain = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^### (\w+) ——/);
    if (h) { domain = h[1]; continue; }
    const m = line.match(/^\| `([0-9A-Fa-f]{4})` \| ([^|]*)\|/);
    if (m && domain) ops.set(parseInt(m[1], 16), { domain, name: m[2].trim() });
  }
  return ops;
}

// 物件脚本字段(DOS 布局,下标 = rgwData 的 WORD 位置;见 SDLPAL global.h 的 OBJECT_* 联合体)。
export const OBJECT_SCRIPT_FIELDS = {
  item: { 2: 'scriptOnUse', 3: 'scriptOnEquip', 4: 'scriptOnThrow' },
  magic: { 2: 'scriptOnSuccess', 3: 'scriptOnUse' },
  enemy: { 2: 'scriptOnTurnStart', 3: 'scriptOnBattleEnd', 4: 'scriptOnReady' },
  poison: { 2: 'playerScript', 4: 'enemyScript' },
  // 系统词条与队员(OBJECT_PLAYER):只有队员用这两个字段,其余为 0
  other: { 2: 'scriptOnFriendDeath', 3: 'scriptOnDying' }
};
