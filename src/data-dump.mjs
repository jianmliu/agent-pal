/**
 * data-dump — `agent-pal data dump`(docs/specs/agent-pal.md §5.3,M2 的数据部分)。
 *
 * 把原始游戏数据导成 JSON「攻略本」:场景表、事件对象初始状态、每张地图的可走格(寻路要的障碍数据)、
 * 物件表(物品 / 仙术 / 敌人 / 毒)、商店、敌队、队员、升级表、词表、对白表,
 * 以及脚本反汇编(每条指令的 opcode 名、操作数、跳转目标、最近的数据入口;控制流见 script-graph.mjs)。
 *
 * 直接解 SSS / DATA 原始分块(引擎启动后结构体构造器与 readTypedArray 都在全局),不开新游戏:
 * 拿到的是**初始**值 —— 引擎里的 GameData 会随游戏推进改写、读档时整表替换。
 * 输出是确定的(排序、不带时间戳),manifest 记各数据源的哈希,方便判断两份导出是否来自同一套资产。
 *
 * 坐标:地图格与 agent 工具一致的「旋转网格」(上下左右方向键 = gy-1 / gy+1 / gx-1 / gx+1)。
 * 半格 (tx, ty, h) 的站立点 x = 32tx + 16h、y = 16ty + 8h,对应 gx = tx + ty + h、gy = ty - tx + 64。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decodeScript, hex, nearestEntry, OBJECT_SCRIPT_FIELDS, readOpsDoc, successors } from './script-graph.mjs';

export const DUMP_FORMAT = 'agent-pal-data-dump';
export const DUMP_VERSION = 2;    // 2: + scripts.json / script-entries.json

// 经典版物件编号分段(同 SDLPAL)。没有类型标记,导出时用表间引用逐条核对(verifyKinds),不对就报错。
export const KIND_RANGES = { item: [0x3d, 0x126], magic: [0x127, 0x18d], enemy: [0x18e, 0x226], poison: [0x227, 0xffff] };
export const kindOf = (id) => Object.entries(KIND_RANGES).find(([, [lo, hi]]) => id >= lo && id <= hi)?.[0] ?? 'other';

const ITEM_FLAGS = [[1, 'usable'], [2, 'equipable'], [4, 'throwable'], [8, 'consuming'], [16, 'applyToAll'], [32, 'sellable']];
const MAGIC_FLAGS = [[1, 'usableOutsideBattle'], [2, 'usableInBattle'], [8, 'usableToEnemy'], [16, 'applyToAll']];
const EQUIP_FIRST = 64;          // ItemFlag.EquipableByPlayerRole_First,按角色号左移
const EQUIP_SLOTS = ['head', 'cloak', 'body', 'weapon', 'feet', 'accessory'];
const ROLES = 6;
const GRID = 192;                // gx、gy 都落在 0..191
const GY_OFF = 64;

const big5 = (() => { try { return new TextDecoder('big5'); } catch { return null; } })();
const sha = (...parts) => { const h = createHash('sha1'); for (const p of parts) h.update(p); return h.digest('hex').slice(0, 16); };
const flagNames = (v, table) => table.filter(([bit]) => v & bit).map(([, n]) => n);

/** 结构体实例 → 纯对象(字段是实例上的 getter;_x_value 是缓存、uint8Array 是底层字节,都跳过)。 */
function plain(s) {
  const out = {};
  for (const k of Object.keys(s)) {
    if (k.startsWith('_') || k === 'uint8Array') continue;
    let v;
    try { v = s[k]; } catch { continue; }
    out[k] = norm(v);
  }
  return out;
}
function norm(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v.uint8Array && !ArrayBuffer.isView(v) && typeof v.length !== 'number') return plain(v);
  if (typeof v.length === 'number') return Array.from({ length: v.length }, (_, i) => norm(v[i]));
  return plain(v);
}

/**
 * 导出。e = bootEngine() 的返回值(标题画面即可)。返回 manifest。
 * @param {string} outDir
 * @param {{ maps?: 'used' | 'all', log?: (s: string) => void }} [opts]
 */
export async function dumpData(e, outDir, opts = {}) {
  const log = opts.log || (() => {});
  const G = globalThis;
  const R = G.readTypedArray;
  const files = G.Files;
  if (typeof R !== 'function' || !files?.SSS || !files?.DATA) throw new Error('engine data layer not ready (readTypedArray / Files.SSS / Files.DATA missing)');
  const word = (n) => { try { return e.word(n); } catch { return ''; } };
  const chunk = (mkf, i) => mkf.readChunk(i);
  const fingerprint = {};
  const take = (name, mkf, ...idx) => { const bufs = idx.map((i) => chunk(mkf, i)); fingerprint[name] = sha(fingerprint[name] || '', ...bufs.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength))); return bufs; };

  fs.mkdirSync(path.join(outDir, 'maps'), { recursive: true });
  const written = [];
  const write = (rel, data) => {
    const file = path.join(outDir, rel);
    fs.writeFileSync(file, JSON.stringify(data, null, rel.startsWith('maps/') ? 0 : 1) + '\n');
    written.push(rel);
  };

  // ---- SSS:事件对象 / 场景 / 物件 / 对白索引 --------------------------------------------
  const [eoBytes, sceneBytes, objBytes, msgIdx] = take('SSS', files.SSS, 0, 1, 2, 3);
  const eventObjects = R(G.EventObject, eoBytes);
  const sceneTable = R(G.Scene, sceneBytes);
  const objectTable = R(G.ObjectUnion, objBytes);

  // 场景 id 从 1 起;最后一条是哨兵(只用它的 eventObjectIndex 给最后一个场景收尾)
  const scenes = [];
  const sceneOfEo = new Int32Array(eventObjects.length).fill(0);
  for (let i = 0; i + 1 < sceneTable.length; i++) {
    const s = sceneTable[i], start = s.eventObjectIndex, end = sceneTable[i + 1].eventObjectIndex;
    for (let k = start; k < end && k < eventObjects.length; k++) sceneOfEo[k] = i + 1;
    scenes.push({ id: i + 1, mapNum: s.mapNum, scriptOnEnter: s.scriptOnEnter, scriptOnTeleport: s.scriptOnTeleport, eventObjects: end > start ? { first: start + 1, last: end, count: end - start } : { first: null, last: null, count: 0 } });
  }
  write('scenes.json', scenes);

  // 事件对象:初始状态。kind 与 agent / L0 同一分类(只看精灵与触发方式,不读脚本推断)
  write('event-objects.json', eventObjects.map((o, i) => {
    const a = Math.round(o.x / 16), b = Math.round(o.y / 8);
    const kind = o.spriteNum ? 'npc' : o.triggerMode >= 4 ? 'touch-trigger' : o.triggerMode > 0 ? 'search-spot' : 'scenery';
    return {
      id: i + 1, scene: sceneOfEo[i] || null, x: o.x, y: o.y, gx: Math.floor((a + b) / 2), gy: Math.floor((b - a) / 2) + GY_OFF,
      layer: o.layer, state: o.state, triggerMode: o.triggerMode, kind,
      triggerScript: o.triggerScript, autoScript: o.autoScript, spriteNum: o.spriteNum, direction: o.direction, vanishTime: o.vanishTime
    };
  }));

  // ---- DATA:商店 / 敌人 / 敌队 / 队员 / 仙术 / 战场 / 升级 -------------------------------------
  const [storeB, enemyB, teamB, roleB, magicB, fieldB, lvMagicB, , , , , , , , lvExpB] = take('DATA', files.DATA, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14);
  const stores = R(G.Store, storeB);
  const enemies = R(G.Enemy, enemyB);
  const teams = R(G.EnemyTeam, teamB);
  const roles = new G.PlayerRoles(roleB);
  const magics = R(G.Magic, magicB);
  const fields = R(G.BattleField, fieldB);
  const lvMagic = R(G.LevelUpMagicAll, lvMagicB);
  const lvExp = Array.from(new Uint16Array(lvExpB.buffer.slice(lvExpB.byteOffset, lvExpB.byteOffset + lvExpB.byteLength)));

  const nz = (id) => id && id !== 0xffff;
  const storeItems = stores.map((s) => Array.from(s.items).filter(nz));
  const teamMembers = teams.map((t) => Array.from(t.enemy).filter(nz));
  const roleArr = (field) => { const v = roles[field]; return Array.from({ length: ROLES }, (_, r) => (v && v[r] != null ? Number(v[r]) : null)); };
  const roleMagic = Array.from({ length: ROLES }, (_, r) => Array.from({ length: roles.magic?.length || 0 }, (_, slot) => roles.magic[slot]?.[r]).filter(nz));
  const lvMagicRows = lvMagic.flatMap((row) => Array.from({ length: row.m?.length || 0 }, (_, r) => ({ role: r, level: row.m[r].level, magic: row.m[r].magic })).filter((x) => nz(x.magic)));

  // ---- 物件:按编号段分类,再用表间引用核对 -------------------------------------------------
  const verify = verifyKinds({ storeItems, teamMembers, roleMagic, lvMagicRows, objectTable, magics, enemies });
  const objects = objectTable.map((o, id) => {
    const kind = kindOf(id);
    const base = { id, kind, name: word(id) || null };
    if (kind === 'item') {
      const it = o.item;
      const equip = Array.from({ length: ROLES }, (_, r) => r).filter((r) => it.flags & (EQUIP_FIRST << r));
      return { ...base, item: { price: it.price, flags: flagNames(it.flags, ITEM_FLAGS), equipableBy: equip, bitmap: it.bitmap, scriptOnUse: it.scriptOnUse, scriptOnEquip: it.scriptOnEquip, scriptOnThrow: it.scriptOnThrow } };
    }
    if (kind === 'magic') {
      const m = o.magic;
      return { ...base, magic: { flags: flagNames(m.flags, MAGIC_FLAGS), scriptOnSuccess: m.scriptOnSuccess, scriptOnUse: m.scriptOnUse, magicNumber: m.magicNumber, ...(magics[m.magicNumber] ? plain(magics[m.magicNumber]) : {}) } };
    }
    if (kind === 'enemy') {
      const en = o.enemy;
      return { ...base, enemy: { enemyID: en.enemyID, resistanceToSorcery: en.resistanceToSorcery, scriptOnTurnStart: en.scriptOnTurnStart, scriptOnBattleEnd: en.scriptOnBattleEnd, scriptOnReady: en.scriptOnReady, ...(enemies[en.enemyID] ? plain(enemies[en.enemyID]) : {}) } };
    }
    if (kind === 'poison') return { ...base, poison: plain(o.poison) };
    return base;
  });
  write('objects.json', objects);

  const named = (id) => ({ id, name: word(id) || null });
  write('stores.json', storeItems.map((items, id) => ({ id, items: items.map((i) => ({ ...named(i), price: objectTable[i]?.item?.price ?? null })) })));
  write('enemy-teams.json', teamMembers.map((ids, id) => ({ id, enemies: ids.map(named) })));
  write('party.json', Array.from({ length: ROLES }, (_, r) => {
    const one = (f) => roleArr(f)[r];
    const equipment = {};
    EQUIP_SLOTS.forEach((slot, i) => { const id = roles.equipment?.[i]?.[r]; if (nz(id)) equipment[slot] = named(id); });
    return {
      role: r, name: word(one('name')) || null, nameWord: one('name'),
      level: one('level'), hp: one('HP'), maxHp: one('maxHP'), mp: one('MP'), maxMp: one('maxMP'),
      attackStrength: one('attackStrength'), magicStrength: one('magicStrength'), defense: one('defense'), dexterity: one('dexterity'), fleeRate: one('fleeRate'), poisonResistance: one('poisonResistance'),
      elementalResistance: Array.from({ length: roles.elementalResistance?.length || 0 }, (_, i) => roles.elementalResistance[i]?.[r] ?? null),
      equipment,
      magic: roleMagic[r].map(named),
      cooperativeMagic: nz(one('cooperativeMagic')) ? named(one('cooperativeMagic')) : null
    };
  }));
  write('level-up.json', {
    exp: lvExp.map((exp, level) => ({ level, exp })).filter((x) => x.level > 0 && x.level <= (G.Const?.MAX_LEVELS ?? 99)),
    magic: lvMagicRows.map((x) => ({ ...x, name: word(x.magic) || null }))
  });
  write('battle-fields.json', fields.map((f, id) => ({ id, ...plain(f) })));

  // ---- 文本:词表 + 对白 ---------------------------------------------------------------------
  const wordCount = objectTable.length;          // 词表至少覆盖全部物件名;再往后是界面用词
  const words = [];
  for (let i = 0; ; i++) {
    let w = '';
    try { w = word(i); } catch { break; }
    if (i >= wordCount && i > 0 && !w && !word(i + 1) && !word(i + 2)) break;   // 连续空 = 到尾了
    words.push(w);
    if (i > 5000) break;
  }
  write('words.json', words);
  const msgOffsets = new Uint32Array(msgIdx.buffer.slice(msgIdx.byteOffset, msgIdx.byteOffset + msgIdx.byteLength));
  const messages = [];
  for (let i = 0; i + 1 < msgOffsets.length; i++) {
    let t = '';
    try { const raw = e.ui.getMsg(i); t = raw && big5 ? big5.decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw)).replace(/\0+$/, '') : ''; } catch { /* */ }
    messages.push(t);
  }
  fingerprint.messages = sha(messages.join('\n'));
  write('messages.json', messages);

  // ---- 脚本:反汇编 + 数据入口 ---------------------------------------------------------------
  const [scriptBytes] = take('SSS', files.SSS, 4);
  const script = decodeScript(scriptBytes);
  const entryRefs = new Map();
  const ref = (addr, r) => { addr = Number(addr); if (!addr) return; if (!entryRefs.has(addr)) entryRefs.set(addr, []); entryRefs.get(addr).push(r); };
  for (const sc of scenes) {
    ref(sc.scriptOnEnter, { from: 'scene', id: sc.id, field: 'scriptOnEnter' });
    ref(sc.scriptOnTeleport, { from: 'scene', id: sc.id, field: 'scriptOnTeleport' });
  }
  eventObjects.forEach((o, i) => {
    ref(o.triggerScript, { from: 'eventObject', id: i + 1, scene: sceneOfEo[i] || null, field: 'triggerScript' });
    ref(o.autoScript, { from: 'eventObject', id: i + 1, scene: sceneOfEo[i] || null, field: 'autoScript' });
  });
  objectTable.forEach((o, id) => {
    const kind = kindOf(id);
    for (const [f, field] of Object.entries(OBJECT_SCRIPT_FIELDS[kind])) ref(o.data[f], { from: 'object', id, kind, name: word(id) || null, field });
  });
  const dataEntries = [...entryRefs.keys()];
  // 脚本自己装上去的入口(0x0024 / 0x0025 / 0x006D / 0x0090):也是入口,但可达性只从数据入口算
  script.forEach((_, i) => {
    for (const { to, kind } of successors(script, i)) if (kind === 'install') ref(to, { from: 'script', addr: i, op: hex(script[i].op) });
  });
  const opsDoc = readOpsDoc();
  fingerprint.opsDoc = sha([...opsDoc].map(([op, v]) => `${op}:${v.name}`).join('\n'));
  const reach = nearestEntry(script, dataEntries);
  let reachable = 0;
  const rows = script.map((ins, addr) => {
    const row = { addr, op: hex(ins.op), name: opsDoc.get(ins.op)?.name ?? null, operands: ins.a };
    const jumps = successors(script, addr).filter((x) => x.kind !== 'next');
    if (jumps.length) row.jumps = jumps;
    if (ins.op === 0xffff) row.text = messages[ins.a[0]] ?? null;     // 显示一行台词:操作数 0 = 对白号
    if (reach.entry[addr] >= 0) { row.entry = reach.entry[addr]; row.depth = reach.depth[addr]; reachable++; }
    return row;
  });
  // 一条一行:数万行,单行 JSON 不好 diff,缩进又太大
  const writeLines = (rel, list) => { fs.writeFileSync(path.join(outDir, rel), '[\n' + list.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n'); written.push(rel); };
  writeLines('scripts.json', rows);
  writeLines('script-entries.json', [...entryRefs.keys()].sort((a, b) => a - b).map((addr) => ({ addr, refs: entryRefs.get(addr) })));

  // ---- 地图:每张地图的可走格(旋转网格) -------------------------------------------------------
  const MapClass = e.sceneService.getMap?.()?.constructor;
  if (!MapClass?.fromFile) throw new Error('map decoder not reachable (sceneService.getMap().constructor.fromFile)');
  // 标题画面时 MAP / GOP 还只是空壳(开新游戏才加载):显式加载,不为此开游戏
  await e.services.resource.loadMKF('MAP', 'GOP');
  const MAP = e.services.resource.getMKF('MAP'), GOP = e.services.resource.getMKF('GOP');
  const mapScenes = new Map();
  for (const s of scenes) if (s.mapNum || s.eventObjects.count) { if (!mapScenes.has(s.mapNum)) mapScenes.set(s.mapNum, []); mapScenes.get(s.mapNum).push(s.id); }
  const mapNums = opts.maps === 'all'
    ? Array.from({ length: MAP.chunkCount ?? MAP.count ?? 0 }, (_, i) => i)
    : [...mapScenes.keys()].sort((a, b) => a - b);
  const mapIndex = [];
  for (const mapNum of mapNums) {
    let map = null;
    try { map = MapClass.fromFile(mapNum, MAP, GOP); } catch { /* */ }
    if (!map) { mapIndex.push({ mapNum, scenes: mapScenes.get(mapNum) || [], missing: true }); continue; }
    const g = mapGrid(map);
    // 指纹取 MKF 里的原始(压缩)分块:解出来的 tiles 视图会被解码缓存复用,两次导出字节不一定相同
    const raw = MAP.readChunk(mapNum);
    fingerprint.MAP = sha(fingerprint.MAP || '', Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength));
    write(`maps/${mapNum}.json`, { mapNum, scenes: mapScenes.get(mapNum) || [], ...g });
    mapIndex.push({ mapNum, scenes: mapScenes.get(mapNum) || [], walkable: g.walkable, blocked: g.blocked });
    log(`map ${mapNum}: ${g.walkable} walkable, ${g.blocked} blocked`);
  }
  write('maps.json', mapIndex);

  const manifest = {
    format: DUMP_FORMAT,
    version: DUMP_VERSION,
    spec: 'docs/specs/agent-pal.md §5.3',
    sources: fingerprint,
    counts: { scenes: scenes.length, eventObjects: eventObjects.length, objects: objects.length, stores: stores.length, enemies: enemies.length, enemyTeams: teams.length, magic: magics.length, battleFields: fields.length, words: words.length, messages: messages.length, scripts: script.length, scriptEntries: entryRefs.size, maps: mapIndex.filter((m) => !m.missing).length },
    kindRanges: Object.fromEntries(Object.entries(KIND_RANGES).map(([k, [lo, hi]]) => [k, [lo, Math.min(hi, objects.length - 1)]])),
    kindCheck: verify,
    scripts: {
      opNames: 'docs/specs/script-ops-migration.md (sources.opsDoc)',
      controlFlow: 'apps/agent-pal/src/script-graph.mjs (SDLPAL script.c); conditional jumps count both ways, so "entry" is a may-reach over-approximation',
      reachableFromData: reachable,
      unreachableFromData: script.length - reachable
    },
    grid: {
      size: GRID,
      legend: { '.': 'walkable', '#': 'blocked (map obstacle bit; event objects that block are in event-objects.json, state >= 2)', ' ': 'void (no tile on either layer)' },
      fromHalfTile: 'gx = tx + ty + h, gy = ty - tx + 64 (half-tile tx 0..63, ty 0..127, h 0..1)',
      toPixels: 'x = (gx - (gy - 64)) * 16, y = (gx + (gy - 64)) * 8',
      moves: 'up = gy - 1, down = gy + 1, left = gx - 1, right = gx + 1'
    },
    files: [...written, 'manifest.json'].sort()
  };
  write('manifest.json', manifest);
  return manifest;
}

/** 一张地图 → 旋转网格的可走格。与 agent.mjs blockedAt / voidAt 同一判定(只看地图格,不含事件对象)。 */
export function mapGrid(map) {
  const rows = Array.from({ length: GRID }, () => new Array(GRID).fill(' '));
  let walkable = 0, blocked = 0;
  const hasBitmap = (tx, ty, h, layer) => { try { return !!map.getTileBitmap(tx, ty, h, layer); } catch { return false; } };
  for (let ty = 0; ty < 128; ty++) {
    for (let tx = 0; tx < 64; tx++) {
      for (let h = 0; h < 2; h++) {
        if (!hasBitmap(tx, ty, h, 0) && !hasBitmap(tx, ty, h, 1)) continue;   // 虚空
        const gx = tx + ty + h, gy = ty - tx + GY_OFF;
        if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
        const isBlocked = map.isTileBlocked(tx, ty, h);
        rows[gy][gx] = isBlocked ? '#' : '.';
        if (isBlocked) blocked++; else walkable++;
      }
    }
  }
  return { walkable, blocked, rows: rows.map((r) => r.join('').replace(/\s+$/, '')) };
}

/** 编号分段 vs 表间引用:商店里的必须是物品、敌队里的必须是敌人、队员会的仙术必须是仙术。 */
function verifyKinds({ storeItems, teamMembers, roleMagic, lvMagicRows, objectTable, magics, enemies }) {
  const problems = [];
  const expect = (ids, kind, where) => { for (const id of ids) if (kindOf(id) !== kind) problems.push(`${where}: object ${id} (0x${id.toString(16)}) is referenced as ${kind} but falls in the ${kindOf(id)} range`); };
  storeItems.forEach((ids, s) => expect(ids, 'item', `store ${s}`));
  teamMembers.forEach((ids, t) => expect(ids, 'enemy', `enemy team ${t}`));
  roleMagic.forEach((ids, r) => expect(ids, 'magic', `role ${r} magic`));
  expect(lvMagicRows.map((x) => x.magic), 'magic', 'level-up magic');
  for (let id = 0; id < objectTable.length; id++) {
    const k = kindOf(id);
    if (k === 'magic' && !(objectTable[id].magic.magicNumber < magics.length)) problems.push(`magic object ${id}: magicNumber ${objectTable[id].magic.magicNumber} out of range`);
    if (k === 'enemy' && !(objectTable[id].enemy.enemyID < enemies.length)) problems.push(`enemy object ${id}: enemyID ${objectTable[id].enemy.enemyID} out of range`);
  }
  if (problems.length) throw new Error(`object kind ranges disagree with the data:\n  ${problems.slice(0, 20).join('\n  ')}`);
  const refs = storeItems.flat().length + teamMembers.flat().length + roleMagic.flat().length + lvMagicRows.length;
  return { ok: true, referencesChecked: refs };
}
