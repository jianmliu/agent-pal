/**
 * data dump 测试(需要游戏资产;没有时 --skip-if-no-assets 跳过):
 *  - 导出齐全、能解析、计数与已知事实对得上(场景 1 = 地图 12、李逍遙、觀音符 150 文、史萊姆…)
 *  - 物件分类与表间引用一致(dumpData 自己核对,不一致直接抛错)
 *  - 确定性:同一引擎导两次,逐字节相同
 *  - 地图可走格与引擎自己的障碍判定一致:开新游戏进场景 1,地图 12 每个非虚空格都与
 *    sceneService.checkObstacle(只看地图、不含事件对象)比一遍
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const say = (s) => process.stdout.write(s + '\n');
const assets = [process.env.PAL_ASSET_DIR, path.resolve(here, '../pal-assets'), path.resolve(here, '../../pal-playground/public/pal-assets')].filter(Boolean);
if (!assets.some((d) => fs.existsSync(path.join(d, 'PAT.MKF')) || fs.existsSync(path.join(d, 'pat.mkf')))) {
  say('data-dump test: PAL assets not found');
  if (process.argv.includes('--skip-if-no-assets')) { say('data-dump test: skipped'); process.exit(0); }
  process.exit(1);
}

const { bootEngine } = await import('../src/engine.mjs');
const { dumpData, DUMP_FORMAT, DUMP_VERSION } = await import('../src/data-dump.mjs');
const { createAgent, fromGrid } = await import('../src/agent.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-dump-'));
const e = await bootEngine({ log: () => {}, savesFile: path.join(tmp, 'saves.json') });
const outA = path.join(tmp, 'a'), outB = path.join(tmp, 'b');
const t0 = Date.now();
const m = await dumpData(e, outA);
say(`  dump: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${m.files.length} files`);
const j = (f) => JSON.parse(fs.readFileSync(path.join(outA, f), 'utf8'));

// ---- 齐全与已知事实 ---------------------------------------------------------------
assert.equal(m.format, DUMP_FORMAT);
assert.equal(m.version, DUMP_VERSION);
for (const f of m.files) assert.ok(fs.existsSync(path.join(outA, f)), `missing ${f}`);
assert.equal(m.kindCheck.ok, true);
assert.ok(m.kindCheck.referencesChecked > 500);
assert.deepEqual([m.counts.scenes, m.counts.objects, m.counts.words, m.counts.messages], [293, 565, 565, 12880]);
say('  ✓ files, counts, object kinds cross-checked against stores / enemy teams / magic lists');

const scenes = j('scenes.json');
assert.deepEqual(scenes[0], { id: 1, mapNum: 12, scriptOnEnter: 7952, scriptOnTeleport: 0, eventObjects: { first: 1, last: 32, count: 32 } });
const eos = j('event-objects.json');
assert.equal(eos.length, m.counts.eventObjects);
assert.equal(eos.filter((o) => o.scene === 1).length, 32);
const objects = j('objects.json');
assert.equal(objects[0x3d].name, '觀音符');
assert.equal(objects[0x3d].item.price, 150);
assert.ok(objects[0x3d].item.flags.includes('sellable'));
assert.equal(objects[0x18e].kind, 'enemy');
assert.equal(objects[0x18e].name, '史萊姆');
assert.ok(objects[0x18e].enemy.health > 0);
assert.equal(objects[0x127].kind, 'magic');
assert.ok(objects[0x127].magic.costMP >= 0);
const party = j('party.json');
assert.equal(party[0].name, '李逍遙');
assert.equal(party[0].level, 1);
const stores = j('stores.json');
// 原版数据里商店也会挂 0 文的物品(如客栈的 試煉果、舍利子),只要求都是物品
assert.ok(stores.every((st) => st.items.every((it) => objects[it.id].kind === 'item' && it.price >= 0)));
assert.equal(j('messages.json')[100], '獲得繡花鞋');
say('  ✓ known facts: scene 1 = map 12 (32 objects), 李逍遙 Lv1, 觀音符 150文, 史萊姆, store 0, message 100');

// ---- 脚本反汇编 ---------------------------------------------------------------------
const scripts = j('scripts.json');
assert.equal(scripts.length, m.counts.scripts);
assert.ok(scripts.every((r, i) => r.addr === i && /^[0-9A-F]{4}$/.test(r.op) && r.operands.length === 3));
assert.equal(m.scripts.reachableFromData + m.scripts.unreachableFromData, scripts.length);
const entries = new Map(j('script-entries.json').map((x) => [x.addr, x.refs]));
assert.equal(entries.size, m.counts.scriptEntries);
assert.ok(entries.get(7952).some((r) => r.from === 'scene' && r.id === 1 && r.field === 'scriptOnEnter'));
assert.deepEqual([scripts[7952].entry, scripts[7952].depth], [7952, 0]);
const useScript = objects[0x3d].item.scriptOnUse;
if (useScript) assert.ok(entries.get(useScript).some((r) => r.from === 'object' && r.id === 0x3d && r.kind === 'item' && r.field === 'scriptOnUse'));
const eo1 = eos[0];
if (eo1.triggerScript) assert.ok(entries.get(eo1.triggerScript).some((r) => r.from === 'eventObject' && r.id === 1 && r.scene === 1));
const lines = scripts.filter((r) => r.op === 'FFFF');
assert.ok(lines.length > 1000 && lines.every((r) => r.name === '显示一行台词'));
assert.ok(lines.filter((r) => r.text).length / lines.length > 0.99, 'dialogue lines carry their message text');
say(`  ✓ scripts: ${scripts.length} instructions, ${entries.size} entries, ${m.scripts.reachableFromData} reachable from data; scene 1 enter script = 7952, 觀音符 / event object 1 entries, ${lines.length} dialogue lines with text`);

// ---- 确定性 -----------------------------------------------------------------------
await dumpData(e, outB);
for (const f of m.files) assert.equal(fs.readFileSync(path.join(outB, f), 'utf8'), fs.readFileSync(path.join(outA, f), 'utf8'), `${f} differs between two dumps`);
say(`  ✓ deterministic: two dumps identical (${m.files.length} files)`);

// ---- 地图 vs 引擎障碍判定 -----------------------------------------------------------
const a = createAgent(e, { memoryFile: null, atlas: null });
await a.settle(60000);
await a.choose(0);                      // 新的故事
await a.advance(200);
assert.equal(e.worldService.getSceneId(), 1);
const grid = j('maps/12.json');
const PAL_XY = (x, y) => (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0;
let checked = 0, mismatches = [];
for (let gy = 0; gy < grid.rows.length; gy++) {
  const row = grid.rows[gy];
  for (let gx = 0; gx < row.length; gx++) {
    const c = row[gx];
    if (c === ' ') continue;
    const { x, y } = fromGrid(gx, gy);
    const engineBlocked = !!e.sceneService.checkObstacle(PAL_XY(x, y), false, 0);
    if (engineBlocked !== (c === '#')) mismatches.push(`(${gx},${gy}) dump=${c} engine=${engineBlocked ? '#' : '.'}`);
    checked++;
  }
}
assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} cells disagree with the engine`);
const p = a.playerPos();
assert.equal(grid.rows[p.gy][p.gx], '.', 'the player stands on a walkable cell');
say(`  ✓ map 12 matches the engine's checkObstacle on all ${checked} non-void cells; player start (${p.gx},${p.gy}) is walkable`);

fs.rmSync(tmp, { recursive: true, force: true });
say('\nDATA DUMP TESTS PASSED ✅');
process.exit(0);
