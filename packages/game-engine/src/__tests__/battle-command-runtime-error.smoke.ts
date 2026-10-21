import assert from 'node:assert/strict';
import { BattleCommandRuntime, OwnedBattleCancelled } from '../services/battle-command-runtime';
import { samePrompt, type PromptIdentity } from '../ecs/components/battle-commands';
let checks = 0;
function fixture(controlled?: string) {
  let open: PromptIdentity | null = null, pending: any = null, revision = 0;
  const global = { inBattle: true, autoBattle: false }, scopes = new Set<any>();
  const state = { battleResult: 1000, phase: 0, enemyCleared: false, player: [{ state: 1 }], UI: { state: 1, menuState: 0, curPlayerIndex: 0, autoAttack: false } };
  if (controlled === 'repeat' || controlled === 'force' || controlled === 'flee') (state as any)[controlled] = true;
  const status = [[]] as number[][];
  if (controlled === 'sleep') status[0][2] = 1;
  const commands = { context: 'test' }, party = { maxIndex: 0, members: [{ playerRole: 0 }] }, writer = {};
  let writes = 0, onStage: (() => void) | null = null;
  const battle = {
    getState: () => state, getCommands: () => commands, battleInstance: 1, isInBattle: () => global.inBattle,
    getOpenPrompt: () => open,
    publishOwnedPrompt: (prompt: PromptIdentity) => ({ ...prompt }),
    openPrompt: (member: number) => (open = { context: commands.context, battle: 1, revision: ++revision, member, role: 0 }),
    setAutoBattle: (on: boolean) => { state.UI.autoAttack = on; },
    closePrompt: () => { open = pending = null; },
    submitCommand: (id: PromptIdentity, choice: any) => { if (!samePrompt(id, open)) return { ok: false as const, reason: 'stale' }; pending = choice; onStage?.(); return { ok: true as const }; },
    requestAutoBattle: () => ({ ok: false as const, reason: 'unsupported' }),
    acceptPendingCommand: () => { const out = pending; open = pending = null; return out; },
    acceptAutoRequest: () => null
  };
  const runtime = new BattleCommandRuntime();
  runtime.install('owned-command', { battle, world: { _getPlayerRoleArrayValue: () => 100, getPlayerStatusMatrix: () => status, getWorldWriter: () => writer, _partyView: () => party, registerCancellableExecutionScope: (s: any) => scopes.add(s), releaseCancellableExecutionScope: (s: any) => scopes.delete(s) }, global: () => global,
    enums: () => ({ PlayerStatus: { Sleep: 2, Paralyzed: 3, Confused: 4 }, BattleResult: { OnGoing: 1000 }, BattlePhase: { SelectAction: 0 }, BattleUIState: { SelectMove: 1 }, BattleMenuState: { Main: 0 }, FighterState: { Com: 1 } }) });
  const root = runtime.capture({ commitCommand: () => { writes++; } })!;
  const parent = runtime.afterFrame(root), wake = parent.next().value;
  return { battle, runtime, root, parent, wake, state, commands, scopes, party, writes: () => writes, stage: (fn: () => void) => { onStage = fn; } };
}

const choice = { actionType: 2, actionID: 0, target: 0 };
const selected = process.env.PAL_RUNTIME_ERROR_CASE;
async function check(name: string, fn: () => Promise<void>) { if (selected && selected !== name) return; await fn(); checks++; }
async function rejected(wake: Promise<any>, error: unknown) {
  const value = await Promise.race([wake.then(() => 'resolved', e => e), new Promise(resolve => setTimeout(() => resolve('orphan'), 30))]);
  assert.equal(value, error, 'private park must reject with exact original error, never remain orphaned');
}
function unwind(f: ReturnType<typeof fixture>, error: unknown) { assert.throws(() => f.parent.throw(error), e => e === error); f.runtime.release(f.root); }
async function fresh(f: ReturnType<typeof fixture>, commit = () => {}) {
  f.state.UI.state = 1; f.state.player[0].state = 1;
  const root = f.runtime.capture({ commitCommand: commit })!, parent = f.runtime.afterFrame(root);
  const wake = parent.next().value, wait = f.runtime.commandWait()!; assert.ok(wait);
  assert.equal(f.runtime.submitCommand(wait, choice).ok, true);
  parent.next(await wake); assert.equal(f.runtime.commandWait(), null); f.runtime.release(root);
}
await check('malformed-observation', async () => {
  const f = fixture(), old = f.runtime.commandWait()!;
  const malformed = { ...old, payload: { prompt: { ...old.payload.prompt, extra: undefined } } };
  assert.deepEqual(f.runtime.submitCommand(malformed,choice),{ok:false,reason:'invalid'});
  assert.deepEqual(f.runtime.commandWait(),old,'malformed response preserves the legal live wait');
  assert.equal(f.runtime.submitCommand(old,choice).ok,true); f.parent.next(await f.wake);
  assert.equal(f.writes(),1); f.runtime.release(f.root);
});
for (const phase of ['pre-stage','post-stage']) await check(phase, async () => {
  const f = fixture(), old = f.runtime.commandWait()!, error = new Error(`${phase} root getter error`);
  const getState = f.battle.getState;
  const poison = () => { f.battle.getState = () => { throw error; }; };
  if (phase==='pre-stage') poison(); else f.stage(poison);
  assert.throws(() => f.runtime.submitCommand(old,choice),e=>e===error);
  assert.equal(f.runtime.commandWait(),null,'failure must defensively retire exact BCE owner even outside stage transition');
  assert.equal(f.writes(),0);
  await rejected(f.wake,error); unwind(f,error); f.battle.getState=getState; f.stage(()=>{}); await fresh(f);
});
await check('resumed-parent', async () => {
  const f = fixture(), old = f.runtime.commandWait()!, error = new Error('resumed parent root guard');
  const getState = f.battle.getState;
  assert.equal(f.runtime.submitCommand(old,choice).ok,true);
  const reason = await f.wake;
  // This failure is inside the actual resumed parent body, after submission
  // has returned and before BCE.resume can retire its own wait.
  f.battle.getState = () => { throw error; };
  assert.throws(() => f.parent.next(reason), e => e === error);
  assert.equal(f.runtime.commandWait(),null,'resumed guard failure retires the staged BCE owner');
  assert.equal(f.writes(),0); assert.equal(f.runtime.submitCommand(old,choice).ok,false);
  f.runtime.release(f.root); f.battle.getState=getState; await fresh(f);
});
await check('stage', async () => {
  const f = fixture(), old = f.runtime.commandWait()!, error = new Error('original stage error');
  const submit = f.battle.submitCommand;
  f.battle.submitCommand = () => { throw error; };
  assert.throws(() => f.runtime.submitCommand(old, choice), e => e === error);
  assert.equal(f.runtime.commandWait(), null); await rejected(f.wake, error);
  assert.equal(f.runtime.submitCommand(old, choice).ok, false); assert.equal(f.writes(), 0);
  unwind(f,error); f.battle.submitCommand = submit; await fresh(f);
  assert.equal(f.runtime.lastError!.message,error.message,'safe recovery retains error visibility');
});
await check('cancel', async () => {
  const f = fixture(), old = f.runtime.commandWait()!, error = new Error('original close error');
  const close = f.battle.closePrompt; f.battle.closePrompt = () => { close(); throw error; };
  assert.throws(() => f.runtime.cancelCommand(old), e => e === error);
  assert.equal(f.runtime.commandWait(), null); await rejected(f.wake,error);
  assert.equal(f.writes(), 0); unwind(f,error); f.battle.closePrompt = close; await fresh(f);
});
await check('invalidate', async () => {
  const f = fixture(), error = new Error('lifecycle close error'), close = f.battle.closePrompt;
  f.battle.closePrompt = () => { close(); throw error; };
  assert.throws(() => f.runtime.invalidate('raw battle replaced'), e => e === error);
  await rejected(f.wake,error); unwind(f,error); f.battle.closePrompt = close; await fresh(f);
});
await check('scope-clear', async () => {
  const f = fixture(), error = new Error('World scope close error'), close = f.battle.closePrompt;
  f.battle.closePrompt = () => { close(); throw error; };
  assert.throws(() => [...f.scopes][0].clear(), e => e === error);
  await rejected(f.wake,error); assert.equal(f.runtime.commandWait(),null);
  assert.equal(f.runtime.shouldBypassNativeCleanup(error),true);
  assert.equal(f.runtime.shouldBypassNativeCleanup(error),false,'unsafe marker consumed once, never reclassifies later reused error');
  unwind(f,error); f.battle.closePrompt = close; await fresh(f);
  const summary = f.runtime.lastError!; summary.message = 'detached edit';
  assert.equal(f.runtime.lastError!.message,error.message);
});
await check('dispose', async () => {
  const f = fixture(), error = new Error('dispose close error'), close = f.battle.closePrompt;
  f.battle.closePrompt = () => { close(); throw error; };
  assert.throws(() => f.runtime.dispose(), e => e === error);
  await rejected(f.wake,error); assert.equal(f.runtime.commandWait(), null); assert.equal(f.writes(),0);
  unwind(f,error);
});
await check('accepted-invalidation', async () => {
  const f = fixture(), old = f.runtime.commandWait()!, accept = f.battle.acceptPendingCommand;
  f.battle.acceptPendingCommand = () => { const choice = accept(); f.commands.context = 'new'; f.runtime.invalidate('command context changed'); return choice; };
  assert.equal(f.runtime.submitCommand(old,choice).ok,true); const reason = await f.wake;
  let error: unknown; try { f.parent.next(reason); } catch (e) { error=e; }
  assert.ok(error instanceof OwnedBattleCancelled); assert.equal(f.writes(),0);
  assert.equal(f.runtime.commandWait(),null); assert.equal(f.runtime.submitCommand(old,choice).ok,false);
  const beforeRelease = f.runtime.capture({ commitCommand: () => assert.fail('must not commit before old root retirement') })!;
  assert.throws(() => f.runtime.afterFrame(beforeRelease).next(), /clear scheduler error/, 'unretired old root prevents error recovery');
  f.runtime.release(beforeRelease);
  f.runtime.release(f.root); f.battle.acceptPendingCommand = accept; await fresh(f);
});
await check('writer', async () => {
  const f = fixture(), old = f.runtime.commandWait()!, error = new Error('partial writer error'); let effects = 0;
  f.root.native.commitCommand = () => { effects++; throw error; };
  f.runtime.submitCommand(old,choice); const reason = await f.wake;
  assert.throws(() => f.parent.next(reason), e => e === error);
  assert.equal(effects,1); assert.equal(f.runtime.commandWait(),null);
  f.runtime.release(f.root); await fresh(f, () => { effects++; }); assert.equal(effects,2,'fresh root commits new choice once; failed choice is not replayed');
});
await check('foreign', async () => {
  const f = fixture(), old = f.runtime.commandWait()!, error = new Error('stage replaced prompt');
  f.battle.submitCommand = () => { f.battle.openPrompt(0); throw error; };
  assert.throws(() => f.runtime.submitCommand(old,choice), e => e === error);
  const foreign = f.battle.getOpenPrompt(); assert.ok(foreign); assert.notEqual(foreign.revision,old.payload.prompt.revision);
  await rejected(f.wake,error); assert.deepEqual(f.battle.getOpenPrompt(),foreign);
  unwind(f,error);
});
process.stderr.write(`RUNTIME ERROR CONTRACTS PASSED (${checks})\n`);
