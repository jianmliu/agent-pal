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
    enums: () => ({ BattleActionType: { Flee: 5 }, PlayerStatus: { Sleep: 2, Paralyzed: 3, Confused: 4 }, BattleResult: { OnGoing: 1000 }, BattlePhase: { SelectAction: 0 }, BattleUIState: { SelectMove: 1 }, BattleMenuState: { Main: 0 }, FighterState: { Com: 1 } }) });
  const root = runtime.capture({ commitCommand: () => { writes++; } })!;
  const parent = runtime.afterFrame(root), wake = parent.next().value;
  return { runtime, root, parent, wake, state, commands, scopes, party, writes: () => writes, stage: (fn: () => void) => { onStage = fn; } };
}
for (const controlled of ['repeat', 'force', 'flee', 'sleep']) {
  const f = fixture(controlled);
  assert.equal(f.runtime.commandWait(), null, 'native policy/status readiness cannot publish an external owner');
  assert.equal(f.wake, undefined); assert.equal(f.writes(), controlled === 'repeat' || controlled === 'flee' ? 1 : 0, 'healthy native round policy commits directly at parent'); f.runtime.dispose(); checks++;
}
const choice = { actionType: 2, actionID: 0, target: 0 };
{
  const f = fixture(), wait = f.runtime.commandWait()!;
  f.stage(() => f.runtime.invalidate('command context changed'));
  assert.equal(f.runtime.submitCommand(wait, choice).ok, false);
  assert.equal(f.runtime.commandWait(), null, 'reentrant destructive stage hook must retire BCE after staging exits');
  await assert.rejects(f.wake, OwnedBattleCancelled);
  assert.equal(f.writes(), 0); checks++;
}
{
  const f = fixture(), wait = f.runtime.commandWait()!;
  assert.equal(f.runtime.submitCommand({ ...wait, kind: 'battle.auto-mode' }, choice).ok, false);
  assert.equal(f.runtime.submitCommand({ ...wait, revision: wait.revision + 1 }, choice).ok, false);
  assert.equal(f.runtime.submitCommand(wait, { on: true } as any).ok, false);
  assert.equal(f.runtime.commandWait()!.state, 'waiting');
  f.runtime.dispose(); await assert.rejects(f.wake, OwnedBattleCancelled); checks++;
}
{
  const f = fixture(), wait = f.runtime.commandWait()!;
  assert.equal(f.runtime.submitCommand(JSON.parse(JSON.stringify(wait)), choice).ok, true);
  assert.equal(f.writes(), 0);
  const reason = await f.wake;
  f.parent.next(reason);
  assert.equal(f.writes(), 1); assert.equal(f.runtime.commandWait(), null); checks++;
}
{
  const f = fixture(), wait = f.runtime.commandWait()!;
  f.runtime.submitCommand(wait, choice); const reason = await f.wake;
  f.party.members[0].playerRole = 2; for (const scope of f.scopes) scope.check();
  assert.throws(() => f.parent.next(reason), OwnedBattleCancelled);
  assert.equal(f.runtime.commandWait(), null); assert.equal(f.writes(), 0); checks++;
}
{
  const f = fixture();
  assert.throws(() => f.runtime.install('legacy', {} as any), /boot-only/);
  f.runtime.dispose(); await assert.rejects(f.wake, OwnedBattleCancelled); checks++;
}
{
  const runtime = new BattleCommandRuntime();
  assert.throws(() => runtime.install('surprise', {} as any), /unknown/);
  assert.equal(runtime.owned, false); checks++;
}
process.stderr.write(`BATTLE COMMAND RUNTIME PASSED (${checks} pure contracts)\n`);
