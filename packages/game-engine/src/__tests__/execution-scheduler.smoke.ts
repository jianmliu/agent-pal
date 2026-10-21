import assert from 'node:assert/strict';
import { ExecutionScheduler, type ExecutionAdapter } from '../services/execution-scheduler';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; };
const fixture = () => {
  const s = new ExecutionScheduler<'test', { member: number }, number, number>();
  const log: string[] = [];
  let ready = true, taken: number | null = null;
  const hooks = {
    ready: () => ready,
    stage: (n: number) => { log.push('stage'); if (n < 0) return { ok: false as const, reason: 'invalid' }; taken = n; return { ok: true as const }; },
    accept: () => { log.push('accept-close'); const n = taken; taken = null; return n; },
    commit: (n: number) => { log.push(`commit:${n}`); },
    cancel: () => { log.push('cancel'); taken = null; }
  };
  return { s, log, hooks, ready: (v: boolean) => { ready = v; } };
};
check('stage only then close and retire before commit', () => {
  const { s, log, hooks } = fixture();
  const owner = s.publish('test', { member: 0 }, { ...hooks, commit: n => {
    assert.equal(s.peek(), null); assert.equal(s.stage(owner, 'test', 9).ok, false);
    assert.equal(s.resume(owner, 'test').ok, false); assert.throws(() => s.publish('test', { member: 1 }, hooks), /transition/);
    hooks.commit(n);
  } });
  assert.equal(owner.revision, 1); assert.throws(() => s.publish('test', { member: 1 }, hooks), /active/);
  assert.equal(s.stage(owner, 'test', -1).ok, false); assert.equal(s.peek()!.state, 'waiting');
  assert.equal(s.stage(owner, 'wrong' as any, 4).ok, false);
  assert.equal(s.stage({ ...owner }, 'test', 4).ok, false);
  assert.equal(s.stage(owner, 'test', 4).ok, true); assert.deepEqual(log, ['stage', 'stage']);
  assert.equal(s.stage(owner, 'test', 5).ok, false);
  assert.equal(s.resume(owner, 'test').ok, true); assert.deepEqual(log, ['stage', 'stage', 'accept-close', 'commit:4']);
  assert.equal(s.resume(owner, 'test').ok, false);
  assert.equal(s.publish('test', { member: 1 }, hooks).revision, 2);
});
check('detached observations never authorize a restored or edited wait', () => {
  const { s, hooks } = fixture(); const payload = { member: 0 };
  const owner = s.publish('test', payload, hooks); payload.member = 9;
  const observation = s.peek()!; observation.payload.member = 8;
  assert.equal(s.peek()!.payload.member, 0);
  const json = JSON.parse(JSON.stringify(s.snapshot()));
  assert.equal(s.stage(json.wait, 'test', 1).ok, false);
  assert.equal(s.stage({ ...owner, kind: 'other', revision: 999 } as any, 'test', 1).ok, false);
  assert.equal(s.stage(owner, 'test', 1).ok, true);
});
check('unready and null accept preserve the staged request', () => {
  const { s, hooks, log, ready } = fixture(); let accept = false;
  const owner = s.publish('test', { member: 0 }, { ...hooks, accept: () => accept ? hooks.accept() : null });
  s.stage(owner, 'test', 1); ready(false); assert.equal(s.resume(owner, 'test').ok, false);
  ready(true); assert.equal(s.resume(owner, 'test').ok, false); assert.equal(s.peek()!.state, 'staged');
  accept = true; assert.equal(s.resume(owner, 'test').ok, true); assert.deepEqual(log, ['stage', 'accept-close', 'commit:1']);
});
check('cancel dispose and fresh generations', () => {
  const { s, hooks, log } = fixture(); const a = s.publish('test', { member: 0 }, hooks);
  assert.equal(s.cancel({ ...a }, 'test').ok, false); assert.equal(s.cancel(a, 'test').ok, true);
  const b = s.publish('test', { member: 0 }, hooks); assert.equal(b.revision, 2);
  assert.equal(s.cancel(a, 'test').ok, false); s.dispose(); s.dispose();
  assert.deepEqual(log, ['cancel', 'cancel']); assert.equal(s.stage(b, 'test', 1).ok, false);
  assert.throws(() => s.publish('test', { member: 0 }, hooks), /disposed/);
});
for (const phase of ['ready', 'stage', 'accept', 'commit', 'cancel'] as const) check(`throw in ${phase} retires and cleans once`, () => {
  const { s, hooks, log } = fixture(); const broken = { ...hooks, [phase]: () => { throw new Error(phase); } };
  const a = s.publish('test', { member: 0 }, broken);
  if (phase === 'cancel') assert.throws(() => s.cancel(a, 'test'), /cancel/);
  else if (phase === 'stage') assert.throws(() => s.stage(a, 'test', 1), /stage/);
  else { s.stage(a, 'test', 1); assert.throws(() => s.resume(a, 'test'), new RegExp(phase)); }
  assert.equal(s.peek(), null); assert.equal(s.resume(a, 'test').ok, false);
  assert.ok(s.snapshot().error); s.clearError(); assert.equal(s.publish('test', { member: 0 }, hooks).revision, 2);
  assert.ok(log.filter(x => x === 'cancel').length <= 1);
});
for (const phase of ['stage', 'accept', 'cancel'] as const) check(`reentrant ${phase} cannot override owner`, () => {
  const { s, hooks } = fixture(); let owner: any;
  const original = hooks[phase];
  owner = s.publish('test', { member: 0 }, { ...hooks, [phase]: (...args: any[]) => {
    assert.equal(s.stage(owner, 'test', 2).ok, false); assert.equal(s.resume(owner, 'test').ok, false);
    assert.equal(s.cancel(owner, 'test').ok, false); assert.throws(() => s.publish('test', { member: 1 }, hooks), /transition/);
    return (original as any)(...args);
  } });
  if (phase === 'cancel') s.cancel(owner, 'test'); else { s.stage(owner, 'test', 1); s.resume(owner, 'test'); }
});
check('reject impure DTOs and asynchronous callbacks', () => {
  const { s, hooks } = fixture();
  for (const dto of [{ member: NaN }, { member: 1, callback: () => {} }, { member: 1, date: new Date() }, { member: 1, sparse: [0, , 2] }, { get member() { throw new Error('getter evaluated'); } }]) {
    assert.throws(() => s.publish('test', dto as any, hooks), /pure/);
  }
  assert.throws(() => s.publish('test', { member: 0 }, { ...hooks, stage: (async () => ({ ok: true })) as any }), /synchronous/);
  const a = s.publish('test', { member: 0 }, { ...hooks, stage: (() => ({ then: () => {} })) as any });
  assert.throws(() => s.stage(a, 'test', 1), /synchronous/); assert.equal(s.peek(), null);
});
check('false accept preserves staged request', () => {
  const { s, hooks } = fixture(); let allow = false;
  const a = s.publish('test', { member: 0 }, { ...hooks, accept: () => allow ? hooks.accept() : false });
  s.stage(a, 'test', 1); assert.equal(s.resume(a, 'test').ok, false); assert.equal(s.peek()!.state, 'staged');
  allow = true; assert.equal(s.resume(a, 'test').ok, true);
});
check('cross-runtime owner and stale cancel cannot close current generation', () => {
  const left = fixture(), right = fixture();
  const a = left.s.publish('test', { member: 0 }, left.hooks), b = right.s.publish('test', { member: 0 }, right.hooks);
  assert.equal(left.s.stage(b, 'test', 1).ok, false); assert.equal(left.s.cancel(b, 'test').ok, false);
  left.s.cancel(a, 'test'); const c = left.s.publish('test', { member: 1 }, left.hooks);
  assert.equal(left.s.cancel(a, 'test').ok, false); assert.equal(left.s.stage(c, 'test', 1).ok, true);
});
for (const phase of ['ready', 'accept', 'commit', 'cancel'] as const) check(`thenable ${phase} retires without retry`, () => {
  const { s, hooks, log } = fixture();
  const a = s.publish('test', { member: 0 }, { ...hooks, [phase]: (() => ({ then: () => {} })) as any });
  s.stage(a, 'test', 1);
  assert.throws(() => phase === 'cancel' ? s.cancel(a, 'test') : s.resume(a, 'test'), /synchronous/);
  assert.equal(s.peek(), null); assert.equal(s.resume(a, 'test').ok, false);
  assert.ok(log.filter(x => x === 'cancel').length <= 1);
});
check('prototype adapter retains captured callbacks and receiver', () => {
  class Adapter implements ExecutionAdapter<number, number> {
    pending: number | null = null;
    log: string[] = [];
    ready() { this.log.push('ready'); return true; }
    stage(n: number) { this.log.push('stage'); this.pending = n; return { ok: true as const }; }
    accept() { this.log.push('accept'); const n = this.pending; this.pending = null; return n; }
    commit(n: number) { this.log.push(`commit:${n}`); }
    cancel() { this.log.push('cancel'); this.pending = null; }
  }
  const s = new ExecutionScheduler<'test', { member: number }, number, number>();
  const adapter = new Adapter();
  const a = s.publish('test', { member: 0 }, adapter);
  adapter.stage = () => { throw new Error('callback swapped'); };
  assert.equal(s.stage(a, 'test', 3).ok, true); assert.equal(s.resume(a, 'test').ok, true);
  assert.deepEqual(adapter.log, ['stage', 'ready', 'accept', 'commit:3']);
  const next = new Adapter(); const b = s.publish('test', { member: 1 }, next);
  assert.equal(s.stage(b, 'test', 4).ok, true); assert.equal(s.cancel(b, 'test').ok, true);
  assert.deepEqual(next.log, ['stage', 'cancel']); assert.equal(next.pending, null);
});
check('getter callbacks are read once and use the registered receiver', () => {
  const { s } = fixture(); const reads: Record<string, number> = {}, log: string[] = [];
  const adapter: any = { pending: null, log };
  const callbacks: any = {
    ready: function(this: any) { this.log.push('ready'); return true; },
    stage: function(this: any, n: number) { this.pending = n; this.log.push('stage'); return { ok: true }; },
    accept: function(this: any) { const n = this.pending; this.pending = null; this.log.push('accept'); return n; },
    commit: function(this: any, n: number) { this.log.push(`commit:${n}`); },
    cancel: function(this: any) { this.pending = null; this.log.push('cancel'); }
  };
  for (const name of Object.keys(callbacks)) Object.defineProperty(adapter, name, {
    enumerable: true,
    get() { reads[name] = (reads[name] ?? 0) + 1; return reads[name] === 1 ? callbacks[name] : () => { throw new Error('callback reread'); }; }
  });
  const a = s.publish('test', { member: 0 }, adapter);
  assert.deepEqual(reads, { ready: 1, stage: 1, accept: 1, commit: 1, cancel: 1 });
  assert.equal(s.stage(a, 'test', 5).ok, true); assert.equal(s.resume(a, 'test').ok, true);
  assert.deepEqual(log, ['stage', 'ready', 'accept', 'commit:5']);
  assert.deepEqual(reads, { ready: 1, stage: 1, accept: 1, commit: 1, cancel: 1 });
});
check('callback getter cannot publish an overlapping owner during registration', () => {
  const { s, hooks } = fixture(); let reads = 0;
  const adapter = { ...hooks, get ready() {
    reads++;
    assert.throws(() => s.publish('test', { member: 8 }, hooks), /transition/);
    return hooks.ready;
  } };
  const a = s.publish('test', { member: 0 }, adapter);
  assert.equal(reads, 1); assert.equal(a.revision, 1); assert.equal(s.peek()!.payload.member, 0);
  assert.equal(s.stage(a, 'test', 1).ok, true); assert.equal(s.resume(a, 'test').ok, true);
});
check('invalid registration callbacks allocate nothing and permit retry', () => {
  const { s, hooks, log } = fixture();
  assert.throws(() => s.publish('test', { member: 0 }, { ...hooks, get ready() { return (async () => true) as any; } }), /synchronous/);
  assert.equal(s.snapshot().revision, 0); assert.equal(s.peek(), null); assert.deepEqual(log, []);
  assert.equal(s.publish('test', { member: 1 }, hooks).revision, 1);
});
check('safe revision overflow checked before callback effects', () => {
  const { hooks, log } = fixture(); const s = new ExecutionScheduler<'test', { member: number }, number, number>({ initialRevision: Number.MAX_SAFE_INTEGER });
  assert.throws(() => s.publish('test', { member: 0 }, hooks), /overflow/); assert.deepEqual(log, []);
  assert.throws(() => new ExecutionScheduler({ initialRevision: -1 }), /revision/);
});
console.log(`execution-scheduler: ok (${count} cases)`);

check('publication attempts consume only the exact stock owner once', () => {
  const {s,hooks}=fixture(),attempt={};const a=s.publish('test',{member:0},hooks,attempt);
  assert.equal(s.ownsPublication({},a,'test'),false);assert.equal(s.cancelPublication({},'test').ok,false);assert.equal(s.peek()?.revision,a.revision);
  assert.equal(s.ownsPublication(attempt,a,'test'),true);s.cancel(a,'test');const b=s.publish('test',{member:1},hooks);
  assert.equal(s.cancelPublication(attempt,'test').ok,false);assert.equal(s.peek()?.revision,b.revision);s.cancel(b,'test');
  assert.throws(()=>s.publish('test',{member:2},hooks,attempt),/attempt/);
  const next={};const c=s.publish('test',{member:3},hooks,next);s.forgetPublication(next);assert.equal(s.cancelPublication(next,'test').ok,false);assert.equal(s.peek()?.revision,c.revision);s.cancel(c,'test');
  const last={};s.publish('test',{member:4},hooks,last);assert.equal(s.cancelPublication(last,'test').ok,true);assert.equal(s.cancelPublication(last,'test').ok,false);assert.equal(s.peek(),null);
});
console.log('EXECUTION-SCHEDULER PUBLICATION ATTEMPTS PASSED (fake/reuse/consumed/forgotten/newer owner)');
