import assert from 'node:assert/strict';
import { BattleCommandRuntime, OwnedBattleCancelled } from '../services/battle-command-runtime';
import {BattleLoopRuntime,markCompletedBattleRound} from '../services/battle-loop-runtime';
import {BattleScriptExecution} from '../services/battle-script-execution';
import {ScriptExecutionRuntime} from '../services/script-execution-runtime';
import { samePrompt, type PromptIdentity } from '../ecs/components/battle-commands';
let count = 0;
function fixture() {
  let open: PromptIdentity | null = null, request: { on: boolean } | null = null, revision = 0;
  const commands = { context: 'mode' }, global = { autoBattle: true }, writer = {}, scopes = new Set<any>();
  const party = { maxIndex: 0, members: [{ playerRole: 0 }] };
  let raw = { battleResult: 1000, UI: { autoAttack: true, curPlayerIndex: 0 }, phase: 1, player: [{ state: 2 }] };
  const log: string[] = [], runtime = new BattleCommandRuntime(),native={};
  const battle = {
    getModule:()=>native, getState: () => raw, getCommands: () => commands, battleInstance: 1, isInBattle: () => true,
    getOpenPrompt: () => open, openPrompt: (member: number) => open = { context: commands.context, battle: 1, revision: ++revision, member, role: party.members[member].playerRole },
    publishOwnedPrompt: (p: PromptIdentity) => p,
    closePrompt: () => { log.push('close'); open = request = null; },
    submitCommand: () => ({ ok: false as const, reason: 'invalid' }),
    requestAutoBattle: (p: PromptIdentity, on: boolean) => { assert.ok(samePrompt(p, open)); request = { on }; log.push('stage'); return { ok: true as const }; },
    acceptPendingCommand: () => null,
    acceptAutoRequest: (p: PromptIdentity) => { if (!samePrompt(p, open) || !request) return null; const taken = request; open = request = null; log.push('accept-close'); return taken; },
    setAutoBattle: (on: boolean): unknown => { assert.equal(runtime.commandWait(), null); assert.equal(open, null); raw.UI.autoAttack = on; log.push('setter'); return undefined; }
  };
  const world={ _getPlayerRoleArrayValue: () => 0, getPlayerStatusMatrix: () => [[100]], getWorldWriter: () => writer, _partyView: () => party, registerCancellableExecutionScope: (s:any) => scopes.add(s), releaseCancellableExecutionScope: (s:any) => scopes.delete(s) };
  runtime.install('owned-command', { battle, global: () => global,world,
    enums: () => ({ BattleResult: { OnGoing: 1000 } }) });
  const root = runtime.capture(native)!;
  assert.equal(typeof runtime.preparePauseBoundary,'function','command runtime requires exact pause handoff');
  const frame = () => { assert.equal(runtime.afterFrame(root).next().done, true); };
  frame();
  return { runtime, root, battle, world, native, commands, party, raw, global, scopes, log, frame, replace: () => { raw = { ...raw }; } };
}
for(const replace of process.argv.includes('--replace-only')?[true]:[false,true]){
 const f=fixture(),old=f.runtime.commandWait()!,scripts=new BattleScriptExecution(),loop=new BattleLoopRuntime();
 const vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true};
 scripts.install('owned-parent',{world:f.world,battle:f.battle,global:()=>f.global});const parent=scripts.begin(runner as any)!;scripts.bind(parent,f.native);
 loop.install('round-boundary',{world:f.world,battle:f.battle,scripts,commands:f.runtime,global:()=>f.global,ongoing:()=>true});
 let reads=0,suspends=0,replacement:any=null;const live=loop.capture(parent,f.native,f.root,()=>{suspends++;return()=>0;},undefined,()=>{reads++;return 1000;})!;loop.activate(live);
 const requested=loop.requestBattlePause(),close=f.battle.closePrompt;let once=true;
 f.battle.closePrompt=()=>{close();if(once){once=false;assert.equal(loop.cancelRequest(requested).ok,true);if(replace){replacement=loop.requestBattlePause();assert.equal(replacement.ok,true);}}};
 assert.equal(loop.pauseAt(live,'initial-combat'),null,'retirement callback cancellation must prevent the old pause attempt');
 assert.equal(reads,0);assert.equal(suspends,0,'cancelled attempt cannot freeze/rebase time');assert.equal(loop.observe()!.state,replace?'requested':'running');
 assert.equal(loop.observe()!.request,replace?replacement.request:null);f.frame();assert.ok(f.runtime.commandWait()!.revision>old.revision,'reservation released for ordinary fresh auto-mode publication');
 assert.equal(f.runtime.submitAutoMode(old,false).ok,false);assert.equal(f.global.autoBattle,true);assert.equal(f.raw.UI.autoAttack,true);
 if(replace){
  loop.beginFrame(live);const context=loop.bindContext({},parent);markCompletedBattleRound(context);loop.advance(live,'frame');assert.equal(loop.consumeCompletedRound(live),true);
  const gate=loop.pauseAt(live,'completed-round')!;assert.ok(gate);const dto=loop.observe()!;assert.equal(dto.request,replacement.request);assert.equal(dto.cursor.completedRounds,1);assert.equal(loop.resume(dto).ok,true);await gate;assert.equal(reads,1);assert.equal(suspends,1);
 }
 loop.release(live);scripts.finish(parent,true);loop.dispose();f.runtime.release(f.root);assert.equal(f.scopes.size,0);count++;
}

{
  const f=fixture(),old=f.runtime.commandWait()!;
  assert.equal(f.runtime.preparePauseBoundary(f.root),true);
  assert.equal(f.runtime.commandWait(),null);assert.equal(f.raw.UI.autoAttack,true);assert.equal(f.global.autoBattle,true);
  assert.equal(f.runtime.submitAutoMode(old,false).ok,false);
  assert.throws(f.frame,/paused/);f.runtime.releasePauseBoundary(f.root);f.frame();assert.ok(f.runtime.commandWait()!.revision>old.revision);
  f.runtime.release(f.root);count++;
}
{
  const f=fixture(),old=f.runtime.commandWait()!,stage=f.battle.requestAutoBattle;
  f.battle.requestAutoBattle=(...args)=>{assert.equal(f.runtime.preparePauseBoundary(f.root),false,'in-progress scheduler stage cannot hand off');return stage(...args);};
  assert.equal(f.runtime.submitAutoMode(old,false).ok,true);f.frame();assert.equal(f.raw.UI.autoAttack,false);f.runtime.release(f.root);count++;
}
{
  const f=fixture(),old=f.runtime.commandWait()!;assert.equal(f.runtime.submitAutoMode(old,false).ok,true);
  assert.equal(f.runtime.preparePauseBoundary(f.root),false);assert.equal(f.runtime.commandWait()!.state,'staged');
  f.frame();assert.equal(f.raw.UI.autoAttack,false);f.runtime.release(f.root);count++;
}
{
  const f = fixture(), error = new Error('native child original'), secondary = new Error('release close secondary');
  f.battle.closePrompt = () => { throw secondary; };
  assert.doesNotThrow(() => f.runtime.release(f.root, error));
  assert.equal(f.runtime.commandWait(), null); assert.equal(f.runtime.lastError?.message, error.message); count++;
}
{
  const f=fixture(), error=new Error('changed-world native child'); f.commands.context='new';
  f.runtime.release(f.root,error);
  assert.equal(f.runtime.shouldBypassNativeCleanup(error),true,'body error after destructive identity loss keeps unsafe cleanup classification'); count++;
}
{
  const f=fixture(); f.battle.closePrompt=()=>{throw new Error('secondary after undefined body throw');};
  assert.doesNotThrow(()=>f.runtime.release(f.root,undefined,true));
  assert.equal(f.runtime.commandWait(),null); assert.equal(f.runtime.lastError?.message,'undefined'); count++;
}
for (const staged of [false, true]) for (const result of [3, 1, 0xffff, 0]) {
  const f = fixture(), wait = f.runtime.commandWait()!;
  if (staged) assert.equal(f.runtime.submitAutoMode(wait, false).ok, true);
  f.raw.battleResult = result;
  assert.equal(f.runtime.submitAutoMode(wait, false).ok, false);
  f.frame(); assert.equal(f.runtime.commandWait(), null); assert.equal(f.battle.getOpenPrompt(), null);
  assert.equal(f.root.live, true); assert.equal(f.root.error, undefined); assert.equal(f.raw.UI.autoAttack, true);
  assert.equal(f.log.includes('setter'), false); f.runtime.release(f.root); count++;
}
{
  const f = fixture(), wait = f.runtime.commandWait()!;
  f.raw.UI.curPlayerIndex = 77; f.raw.phase = 88; f.raw.player[0].state = 99;
  for (const scope of f.scopes) scope.check(); f.frame(); assert.deepEqual(f.runtime.commandWait(), wait);
  assert.equal(f.runtime.submitAutoMode(wait, false).ok, true); f.frame();
  assert.equal(f.raw.UI.autoAttack, false); assert.equal(f.global.autoBattle, true); assert.equal(f.root.live, true);
  assert.deepEqual(f.log, ['stage', 'accept-close', 'setter']); f.runtime.release(f.root); count++;
}
for (const change of ['context', 'raw', 'party', 'inactive', 'world', 'runtime']) for (const staged of [false, true]) {
  const f = fixture(), wait = f.runtime.commandWait()!;
  if (staged) f.runtime.submitAutoMode(wait, false);
  if (change === 'context') f.commands.context = 'other';
  if (change === 'raw') f.replace();
  if (change === 'party') f.party.members[0].playerRole = 1;
  if (change === 'inactive') f.party.maxIndex = -1;
  if (change === 'world') f.root.clear(); else if (change === 'runtime') f.runtime.dispose(); else for (const scope of f.scopes) scope.check();
  assert.equal(f.runtime.commandWait(), null); assert.equal(f.battle.getOpenPrompt(), null);
  assert.throws(f.frame, OwnedBattleCancelled); assert.equal(f.log.includes('setter'), false); f.runtime.release(f.root); count++;
}
for (const phase of ['stage','ready','accept','setter','cancel']) {
  const f = fixture(), wait = f.runtime.commandWait()!, error = new Error(`mode ${phase}`);
  if (phase === 'stage') f.battle.requestAutoBattle = () => { throw error; };
  if (phase === 'cancel') f.battle.closePrompt = () => { throw error; };
  if (phase !== 'cancel') {
    if (phase === 'stage') assert.throws(() => f.runtime.submitAutoMode(wait, false), e => e === error);
    else {
      f.runtime.submitAutoMode(wait, false);
      if (phase === 'ready') f.battle.getState = () => { throw error; };
      if (phase === 'accept') f.battle.acceptAutoRequest = () => { throw error; };
      if (phase === 'setter') f.battle.setAutoBattle = () => { throw error; };
      assert.throws(f.frame, e => e === error);
    }
  } else assert.throws(() => f.runtime.cancelCommand(wait), e => e === error);
  f.runtime.release(f.root, error);
  assert.equal(f.runtime.commandWait(), null); assert.equal(f.runtime.lastError?.message, error.message);
  assert.equal(f.runtime.submitAutoMode(wait, false).ok, false); count++;
}
{
  const f=fixture(), wait=f.runtime.commandWait()!, error=new Error('mode publication subscriber');
  f.runtime.cancelCommand(wait);
  f.battle.publishOwnedPrompt=()=>{throw error;};
  assert.throws(f.frame,e=>e===error); assert.equal(f.battle.getOpenPrompt(),null);
  assert.equal(f.runtime.commandWait(),null); assert.equal(f.runtime.lastError?.message,error.message); f.runtime.release(f.root,error); count++;
}
{
  const f=fixture(), wait=f.runtime.commandWait()!, error=new Error('mode foreign stage');
  f.battle.requestAutoBattle=()=>{f.battle.openPrompt(0);throw error;};
  assert.throws(()=>f.runtime.submitAutoMode(wait,false),e=>e===error);
  const foreign=f.battle.getOpenPrompt(); assert.ok(foreign); assert.notEqual(foreign.revision,wait.payload.prompt.revision);
  assert.deepEqual(f.battle.getOpenPrompt(),foreign); f.runtime.release(f.root,error); count++;
}
{
  const f=fixture(), wait=f.runtime.commandWait()!;
  f.runtime.submitAutoMode(wait,false);
  f.battle.setAutoBattle=()=>Promise.resolve();
  assert.throws(f.frame,/must be synchronous/); assert.equal(f.runtime.commandWait(),null);
  assert.equal(f.runtime.lastError?.message,'execution callbacks must be synchronous');
  f.runtime.release(f.root); f.battle.setAutoBattle=on=>{f.raw.UI.autoAttack=on;};
  const root=f.runtime.capture({})!; assert.equal(f.runtime.afterFrame(root).next().done,true);
  const fresh=f.runtime.commandWait()!; assert.ok(fresh); assert.notEqual(fresh.revision,wait.revision);
  assert.equal(f.runtime.submitAutoMode(fresh,false).ok,true); f.runtime.afterFrame(root).next(); assert.equal(f.runtime.commandWait(),null);
  assert.equal(f.runtime.lastError?.message,'execution callbacks must be synchronous'); f.runtime.release(root); count++;
}
{
  const f=fixture(), wait=f.runtime.commandWait()!, stage=f.battle.requestAutoBattle;
  f.battle.requestAutoBattle=(id,on)=>{const result=stage(id,on); f.commands.context='stage replacement'; f.runtime.invalidate('context changed at stage'); return result;};
  assert.equal(f.runtime.submitAutoMode(wait,false).ok,false);
  assert.equal(f.runtime.commandWait(),null); assert.equal(f.battle.getOpenPrompt(),null);
  assert.equal(f.log.includes('setter'),false); assert.throws(f.frame,OwnedBattleCancelled); f.runtime.release(f.root); count++;
}
process.stderr.write(`MODE RUNTIME PASSED (${count} pure contracts)\n`);
