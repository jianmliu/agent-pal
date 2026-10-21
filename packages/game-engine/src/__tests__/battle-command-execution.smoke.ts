import assert from 'node:assert/strict';
import { BattleCommandExecution, type BattleExecutionBinding, type CommandContinuation, type AutoModeContinuation } from '../services/battle-command-execution';
import type { PromptIdentity, CommandChoice } from '../ecs/components/battle-commands';
import { samePrompt } from '../ecs/components/battle-commands';
let count = 0;
const check = (name: string, run: () => void) => { run(); count++; };
const attack = { actionType: 2, actionID: 0, target: 0 };
function fixture() {
  let open: PromptIdentity | null = { context: 'run', battle: 1, revision: 1, member: 0, role: 2 };
  let choice: CommandChoice | null = null, mode: { on: boolean } | null = null, ready = true;
  const log: string[] = [];
  const service = {
    getOpenPrompt: () => open,
    submitCommand: (id: PromptIdentity, c: CommandChoice) => {
      if (!samePrompt(id, open)) return { ok: false as const, reason: 'stale' };
      if (choice || mode) return { ok: false as const, reason: 'busy' };
      if ('actionType' in c && c.actionType < 0) return { ok: false as const, reason: 'invalid' };
      choice = { ...c }; log.push('stage-command'); return { ok: true as const };
    },
    requestAutoBattle: (id: PromptIdentity, on: boolean) => {
      if (!samePrompt(id, open)) return { ok: false as const, reason: 'stale' };
      if (choice || mode) return { ok: false as const, reason: 'busy' };
      mode = { on }; log.push('stage-mode'); return { ok: true as const };
    },
    acceptPendingCommand: (id: PromptIdentity) => { if (!samePrompt(id, open) || !choice) return null; const c = choice; open = choice = mode = null; log.push('accept-close'); return c; },
    acceptAutoRequest: (id: PromptIdentity) => { if (!samePrompt(id, open) || !mode) return null; const m = mode; open = choice = mode = null; log.push('accept-close'); return m; },
    closePrompt: () => { open = choice = mode = null; log.push('close'); }
  };
  const e = new BattleCommandExecution(service);
  const binding = { prompt: { ...open! }, ready: () => ready };
  return { e, service, log, binding, ready: (v: boolean) => { ready = v; }, foreign: () => { open = { ...binding.prompt, revision: 9 }; choice = { ...attack }; }, open: () => open };
}
check('registered command consumer closes and retires before real callback', () => {
  const { e, service, log, binding } = fixture(); let owner: any;
  owner = e.publishCommand(binding, { context: { uiToWait: true }, commitCommand: (member, c, context) => {
    assert.equal(e.peek(), null); assert.equal(e.submit(owner, { prompt: binding.prompt, choice: attack }).ok, false);
    assert.equal(service.acceptPendingCommand(binding.prompt), null); assert.equal(service.acceptAutoRequest(binding.prompt), null);
    assert.equal(e.resume(owner).ok, false); assert.deepEqual([member, c, context], [0, attack, { uiToWait: true }]); log.push('commit');
  } });
  assert.equal(e.submit(owner, { prompt: binding.prompt, choice: attack }).ok, true); assert.deepEqual(log, ['stage-command']);
  assert.equal(e.resume(owner).ok, true); assert.deepEqual(log, ['stage-command', 'accept-close', 'commit']);
});
check('wrong prompt kind and mixed payload refuse without occupying request', () => {
  const { e, log, binding } = fixture(); const a = e.publishCommand(binding, { context: {}, commitCommand: () => {} });
  for (const response of [null, [], { prompt: { ...binding.prompt, role: 4 }, choice: attack }, { prompt: binding.prompt, on: true }, { prompt: binding.prompt, choice: attack, on: true }, { prompt: binding.prompt, choice: { actionType: NaN, actionID: 0, target: 0 } }]) {
    assert.equal(e.submit(a, response as any).ok, false);
  }
  assert.equal(e.submit(a, { prompt: binding.prompt, choice: { ...attack, actionType: -1 } }).ok, false);
  assert.deepEqual(log, []); assert.equal(e.submit(a, { prompt: binding.prompt, choice: attack }).ok, true);
});
for (const on of [true, false]) check(`mode ${on} stages without UI write`, () => {
  const { e, service, log, binding } = fixture(); const a = e.publishAutoMode(binding, { setAutoBattle: value => { assert.equal(value, on); log.push('set-mode'); } });
  assert.equal(e.submit(a, { prompt: binding.prompt, on }).ok, true); assert.deepEqual(log, ['stage-mode']);
  assert.equal(service.acceptPendingCommand(binding.prompt), null); assert.ok(service.getOpenPrompt());
  assert.equal(e.resume(a).ok, true); assert.deepEqual(log, ['stage-mode', 'accept-close', 'set-mode']);
});
check('live readiness gates resume and stale role closes only owned prompt', () => {
  const { e, log, binding, ready } = fixture(); const a = e.publishCommand(binding, { context: {}, commitCommand: () => log.push('commit') });
  e.submit(a, { prompt: binding.prompt, choice: attack }); ready(false); assert.equal(e.resume(a).ok, false);
  assert.deepEqual(log, ['stage-command']); ready(true); assert.equal(e.resume(a).ok, true);
});
for (const phase of ['cancel', 'dispose', 'error'] as const) check(`${phase} preserves foreign prompt`, () => {
  const { e, log, binding, foreign, open } = fixture(); const a = e.publishCommand(binding, { context: {}, commitCommand: () => log.push('commit') });
  e.submit(a, { prompt: binding.prompt, choice: attack }); foreign();
  if (phase === 'cancel') e.cancel(a); else if (phase === 'dispose') e.dispose(); else assert.equal(e.resume(a).ok, false);
  assert.equal(open()!.revision, 9); assert.deepEqual(log, ['stage-command']); assert.equal(e.resume(a).ok, false);
});
check('DTO mutation cannot move active actor and JSON cannot restore continuation', () => {
  const { e, log, binding } = fixture(); const a = e.publishCommand(binding, { context: {}, commitCommand: member => log.push(`commit:${member}`) });
  binding.prompt.member = 1; const dto = e.peek()!; dto.payload.prompt.member = 2;
  assert.equal(e.submit(JSON.parse(JSON.stringify(dto)) as any, { prompt: dto.payload.prompt, choice: attack }).ok, false);
  const original = { ...binding.prompt, member: 0 };
  assert.equal(e.submit(a, { prompt: original, choice: attack }).ok, true); assert.equal(e.resume(a).ok, true);
  assert.deepEqual(log, ['stage-command', 'accept-close', 'commit:0']);
});
check('class binding and command continuation preserve captured receivers', () => {
  const { e, binding, log } = fixture();
  class Binding implements BattleExecutionBinding {
    prompt = binding.prompt;
    readyCalls = 0;
    ready() { this.readyCalls++; return true; }
  }
  class Continuation implements CommandContinuation<{ uiToWait: boolean }> {
    context = { uiToWait: true };
    commits = 0;
    commitCommand(member: number, choice: CommandChoice, context: { uiToWait: boolean }) {
      this.commits++; assert.deepEqual([member, choice, context], [0, attack, { uiToWait: true }]);
    }
  }
  const captured = new Binding(), continuation = new Continuation();
  const a = e.publishCommand(captured, continuation);
  captured.ready = () => { throw new Error('swapped readiness'); };
  continuation.commitCommand = () => { throw new Error('swapped commit'); };
  assert.equal(e.submit(a, { prompt: binding.prompt, choice: attack }).ok, true);
  assert.equal(e.resume(a).ok, true); assert.equal(captured.readyCalls, 1); assert.equal(continuation.commits, 1);
  assert.deepEqual(log, ['stage-command', 'accept-close']);
});
check('class auto continuation preserves receiver and callback capture', () => {
  const { e, binding } = fixture();
  class Continuation implements AutoModeContinuation {
    writes: boolean[] = [];
    setAutoBattle(on: boolean) { this.writes.push(on); }
  }
  const continuation = new Continuation(); const a = e.publishAutoMode(binding, continuation);
  continuation.setAutoBattle = () => { throw new Error('swapped mode callback'); };
  assert.equal(e.submit(a, { prompt: binding.prompt, on: false }).ok, true);
  assert.equal(e.resume(a).ok, true); assert.deepEqual(continuation.writes, [false]);
});
check('battle callback getters are captured once', () => {
  const { e, binding } = fixture(); let readyReads = 0, commitReads = 0;
  const bound = { prompt: binding.prompt, get ready() { readyReads++; return () => true; } };
  const continuation = { context: {}, get commitCommand() { commitReads++; return () => {}; } };
  const a = e.publishCommand(bound, continuation);
  assert.deepEqual([readyReads, commitReads], [1, 1]);
  e.submit(a, { prompt: binding.prompt, choice: attack }); assert.equal(e.resume(a).ok, true);
  assert.deepEqual([readyReads, commitReads], [1, 1]);
});
for (const on of [true, false]) check(`manual decision accepts exclusive mode ${on}`, () => {
  const { e, service, log, binding } = fixture();
  const continuation = { context: { uiToWait: true }, commitCommand() { log.push('command'); }, setAutoBattle(value: boolean) {
    assert.equal(this, continuation); assert.equal(value, on); assert.equal(e.peek(), null); assert.equal(service.getOpenPrompt(), null); log.push('mode');
  } };
  const owner = e.publishDecision(binding, continuation);
  assert.equal(e.submit(owner, { prompt: binding.prompt, choice: attack, on } as any).ok, false);
  assert.equal(e.submit(owner, { prompt: binding.prompt, on }).ok, true);
  assert.equal(service.acceptPendingCommand(binding.prompt), null);
  assert.equal(e.submit(owner, { prompt: binding.prompt, choice: attack }).ok, false);
  assert.equal(e.resume(owner).ok, true); assert.deepEqual(log, ['stage-mode', 'accept-close', 'mode']);
});
console.log(`battle-command-execution: ok (${count} cases)`);
