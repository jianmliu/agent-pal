/**
 * WorldWriter / 类型化组件 / 等待栈的单元测试(docs/specs/agent-pal-waits.md W1)。
 * 纯模块,不起引擎、不要资产。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:registry
 */
import assert from 'node:assert/strict';
import createEntityRegistry from '../ecs/entity-registry';
import { defineComponent } from '../ecs/component';
import { WorldWriter, hashString, toPlain } from '../ecs/world-writer';
import { WaitStackComponent, waitStack } from '../ecs/components/wait';

interface Pos { x: number; y: number; tags?: string[] }
const PosC = defineComponent<Pos>('Pos', {
  create: () => ({ x: 0, y: 0 }),
  validate(v: unknown) {
    const p = v as Pos;
    if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new Error('Pos: x/y must be integers');
  }
});
const NoteC = defineComponent<{ text: string }>('Note', { create: () => ({ text: '' }) });

function fresh(limit?: number) {
  const registry = createEntityRegistry();
  const writer = new WorldWriter(registry, { journalLimit: limit });
  return { registry, writer };
}

function writesAreCopies() {
  const { registry, writer } = fresh();
  const e = registry.createEntity();
  const input: Pos = { x: 1, y: 2, tags: ['a'] };
  writer.set(e, PosC, input);
  input.x = 99;
  input.tags!.push('b');
  assert.deepEqual(writer.get(e, PosC), { x: 1, y: 2, tags: ['a'] }, 'mutating the input after set must not change the store');
  const read = writer.get(e, PosC)!;
  read.y = 77;
  assert.equal(writer.get(e, PosC)!.y, 2, 'mutating a read value must not change the store');
  assert.equal(writer.getOrCreate(registry.createEntity(), PosC).x, 0, 'getOrCreate falls back to the default');
}

function rejectsNonPlainData() {
  const { registry, writer } = fresh();
  const e = registry.createEntity();
  const proxied = new Proxy({ x: 1, y: 1 }, { get: (t, k) => (k === '__raw__' ? t : (t as any)[k]) });
  assert.throws(() => writer.set(e, PosC, proxied), /state proxy/);
  assert.throws(() => writer.set(e, NoteC, { text: 'a', f: () => 1 } as any), /not plain data/);
  assert.throws(() => writer.set(e, NoteC, { text: new Map() } as any), /not a plain object/);
  assert.throws(() => writer.set(e, PosC, { x: NaN, y: 1 }), /x\/y must be integers|finite/);
  assert.throws(() => writer.set(e, PosC, { x: 1.5, y: 1 }), /integers/, 'validate runs before the write');
  assert.equal(registry.hasComponent(e, 'Pos'), false, 'rejected writes leave no trace');
  assert.equal(writer.lastSeq, 0, 'rejected writes are not journaled');
}

function journal() {
  const { registry, writer } = fresh();
  const a = registry.createEntity();
  const b = registry.createEntity();
  writer.set(a, PosC, { x: 1, y: 1 });
  writer.update(b, PosC, (p) => ({ ...p, x: p.x + 5 }));
  writer.remove(a, PosC);
  assert.equal(writer.remove(a, PosC), false, 'removing a missing component is a no-op');
  const all = writer.changesSince(0);
  assert.deepEqual(all.map((c) => [c.seq, c.op, c.entity, c.component]), [[1, 'set', a, 'Pos'], [2, 'set', b, 'Pos'], [3, 'remove', a, 'Pos']]);
  assert.deepEqual(all[1].value, { x: 5, y: 0 });
  assert.deepEqual(writer.changesSince(2).map((c) => c.seq), [3], 'readers resume from the last seq they saw');
  (all[1].value as Pos).x = 1000;
  assert.equal((writer.changesSince(1)[0].value as Pos).x, 5, 'journal entries are copies too');

  const small = fresh(16);
  const e = small.registry.createEntity();
  for (let i = 0; i < 40; i++) small.writer.set(e, PosC, { x: i, y: 0 });
  assert.equal(small.writer.lastSeq, 40);
  assert.equal(small.writer.oldestSeq, 25, 'journal keeps the most recent entries; oldestSeq tells readers when to resnapshot');
  assert.equal(small.writer.changesSince(0).length, 16);
}

function snapshots() {
  const one = fresh();
  const two = fresh();
  // 同样的状态、不同的写入顺序 → 同一个快照、同一个哈希
  const [a1, b1] = [one.registry.createEntity(), one.registry.createEntity()];
  const [a2, b2] = [two.registry.createEntity(), two.registry.createEntity()];
  one.writer.set(a1, PosC, { y: 2, x: 1 } as Pos);
  one.writer.set(b1, NoteC, { text: 'hi' });
  two.writer.set(b2, NoteC, { text: 'hi' });
  two.writer.set(a2, PosC, { x: 1, y: 2 });
  const defs = [NoteC, PosC];
  assert.equal(one.writer.hash(defs), two.writer.hash([PosC, NoteC]), 'hash ignores write order and def order');
  assert.deepEqual(one.writer.snapshot(defs), two.writer.snapshot(defs));

  const snap = one.writer.snapshot(defs);
  const before = one.writer.hash(defs);
  one.writer.set(a1, PosC, { x: 9, y: 9 });
  one.writer.remove(b1, NoteC);
  const extra = one.registry.createEntity();
  one.writer.set(extra, PosC, { x: 3, y: 3 });
  assert.notEqual(one.writer.hash(defs), before);
  one.writer.restore(snap, defs);
  assert.equal(one.writer.hash(defs), before, 'restore brings back exactly the snapshot (and drops components not in it)');
  assert.equal(one.registry.hasComponent(extra, 'Pos'), false);
  assert.equal(one.writer.changesSince(0).at(-1)!.op, 'restore');
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(snap))), JSON.stringify(snap), 'snapshots are plain JSON');

  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.match(hashString(''), /^[0-9a-f]{16}$/);
  assert.deepEqual(Object.keys(toPlain({ b: 1, a: 2 })), ['a', 'b']);
}

function worldSingleton() {
  const { registry, writer } = fresh();
  const w = writer.world();
  assert.equal(writer.world(), w, 'one world entity');
  registry.clear();
  const w2 = writer.world();
  assert.ok(registry.hasEntity(w2), 'recreated after registry.clear()');
}

function waits() {
  const { registry, writer } = fresh();
  const ws = waitStack(writer);
  assert.equal(ws.top(), null);
  const t1 = ws.push('control', { scene: 1, x: 60, y: 40, direction: 0 }, 10);
  const t2 = ws.push('menu.list', { title: '系統', items: [{ label: '物品', enabled: true, value: 1 }, { label: '仙術', enabled: true, value: 2 }], index: 0, cancelable: true });
  const t3 = ws.push('menu.items', { title: null, items: [], index: 0, cancelable: true, columns: 3, purpose: 'use' });
  assert.ok(t1 < t2 && t2 < t3, 'tokens increase');
  assert.equal(ws.depth(), 3);
  assert.equal(ws.top()!.token, t3);

  assert.equal(ws.update(t2, { index: 1 }), true, 'cursor updates go into the payload');
  ws.pop(t3);
  assert.equal(ws.top()!.kind, 'menu.list');
  assert.equal((ws.top()!.payload as any).index, 1);

  // 回应:只接受栈顶的当前 token
  assert.deepEqual(ws.respond(t1, { advance: true }), { ok: false, reason: 'stale' }, 'not the top');
  assert.deepEqual(ws.respond(t3, { choose: 0 }), { ok: false, reason: 'stale' }, 'already popped');
  assert.deepEqual(ws.respond(t2, { choose: 1 }), { ok: true });
  assert.deepEqual(ws.respond(t2, { choose: 0 }), { ok: false, reason: 'busy' }, 'one pending response at a time');
  assert.deepEqual(ws.takeResponse(t2), { choose: 1 });
  assert.equal(ws.takeResponse(t2), null, 'taken once');

  // 内层没正常退出:弹外层时连同上面的一起弹掉
  const t4 = ws.push('dialog', { speaker: '李大娘', text: '逍遙!' });
  ws.pop(t2);
  assert.equal(ws.depth(), 1);
  assert.equal(ws.top()!.token, t1);
  assert.equal(ws.pop(t4), false, 'already gone');

  // 清空(新游戏 / 读档)与 registry.clear() 都不会重发旧 token
  ws.clear();
  const t5 = ws.push('anykey', {});
  assert.ok(t5 > t4);
  registry.clear();
  const t6 = ws.push('dialog', { speaker: null, text: '…' });
  assert.ok(t6 > t5, `token after registry.clear() must not repeat (${t6} > ${t5})`);
  assert.equal(ws.depth(), 1);

  // 坏数据被组件校验拦下
  assert.throws(() => writer.set(writer.world(), WaitStackComponent, { frames: [{ token: 1, kind: 'nope', payload: {}, since: 0, response: null }], nextToken: 2 } as any), /unknown kind/);
  assert.throws(() => writer.set(writer.world(), WaitStackComponent, { frames: [], nextToken: 0 }), /bad shape/);

  // 全程可快照
  const snap = writer.snapshot([WaitStackComponent]);
  assert.equal(snap.components.WaitStack.length, 1);
}

const tests: Array<[string, () => void]> = [
  ['writes and reads are copies', writesAreCopies],
  ['rejects proxies / functions / maps / bad values', rejectsNonPlainData],
  ['change journal', journal],
  ['snapshot / restore / hash', snapshots],
  ['world singleton', worldSingleton],
  ['wait stack', waits]
];
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n     ${(err as Error).stack}`); }
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log(`all ${tests.length} passed`);
