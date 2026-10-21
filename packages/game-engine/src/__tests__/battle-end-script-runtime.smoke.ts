import assert from 'node:assert/strict';
const mod = await import('../services/battle-end-script-runtime').catch(() => null);
assert.ok(mod, 'owned child requires a private scheduler runtime');
const { BattleEndScriptRuntime, validateBattleEndScriptProfile } = mod;
const {createBattleEndScriptCursor}=await import('../services/battle-end-script-cursor');
assert.throws(() => validateBattleEndScriptProfile('owned-cursor', 'legacy', 'owned-command', 'owned-parent'));
const queue = [{ isEnemy: true, index: 0, dexterity: 10 }];
let starts=0;
let slot: any = { objectID: 1, scriptOnBattleEnd: 10 }, valid = true, rebases = 0, releases = 0, prepare: () => boolean = () => true;
const cap = {}, vm = { identity: 'runtime', owns: () => true }, runner = { getExecutionRuntime: () => vm, scriptSuccess: true, curEquipPart: -1 };
const scopes = new Set<any>();
const deps: any = { scripts: { validate: () => {
            if (!valid)
                throw new Error('retired');
            return runner;
        }, observe: () => ({ id: 'parent', context: 'ctx', battle: 1 }), onRetire: () => () => { } }, world: { registerCancellableExecutionScope: (s: any) => scopes.add(s), releaseCancellableExecutionScope: (s: any) => scopes.delete(s) }, loop: { rewardsScriptState:()=>({result:3,party:'[]'}),captureRewardsScriptRegion:()=>({}), assertRewardsScriptParent: () => { }, prepareRewardsScriptPause: () => prepare(), releaseRewardsScriptPause: () => releases++, rewardsScriptEligible: () => true, suspendRewardsScriptPause: () => {starts++;return () => rebases++;} } };
const rt = new BattleEndScriptRuntime();
rt.install('owned-cursor', deps);
const cursor = () => createBattleEndScriptCursor({ kind: 'enemy-battle-end', enemyIndex: 0, objectId: 1, eventId: 0, configuredEntry: 10, resolvedEntry: 10, invocationIndex: 0, version:1, returnPolicy:'discard' }, 10, 0, { scriptSuccess: true, curEquipPart: -1 });
const c = cursor(), l = rt.capture(cap, runner as any, c, () => ({ enemy: slot, queue, queueEntry: queue[0], queueIndex: 0 }))!;
c.frames[0].frameWait = { frame: 0, remainingFrames: 2, stage: 'sleep', remainingMs: 100 };
const request = rt.requestBattleEndScriptPause();
const gate = rt.pauseAt(l)!;
assert.ok(gate);
const dto = rt.observe()!;
assert.equal(dto.state, 'paused');
const getter = { ...dto };
Object.defineProperty(getter, 'state', { get: () => { throw new Error('accessed'); }, enumerable: true });
const rejected = rt.resume(getter);
assert.equal(rejected.ok, false);
if (!rejected.ok)
    assert.equal(rejected.reason, 'invalid');
assert.equal(rt.resume({ ...dto, revision: 999 }).ok, false);
assert.equal(rebases, 0);
assert.equal(rt.cancelRequest(request).ok, false);
assert.equal(rt.resume(JSON.parse(JSON.stringify(dto))).ok, true);
await gate;
assert.equal(rebases, 1);
assert.equal(rt.resume(dto).ok, false);
rt.release(l);
assert.equal(scopes.size, 0);
const l2 = rt.capture(cap, runner as any, cursor(), () => ({ enemy: slot, queue, queueEntry: queue[0], queueIndex: 0 }))!;
l2.cursor.frames[0].frameWait = { frame: 0, remainingFrames: 1, stage: 'sleep', remainingMs: 100 };
const r2 = rt.requestBattleEndScriptPause();
let replacement: any;
prepare = () => { assert.equal(rt.cancelRequest(r2).ok, true); replacement = rt.requestBattleEndScriptPause(); return true; };
assert.equal(rt.pauseAt(l2), null);
assert.equal(rt.observe()!.state, 'requested');
assert.equal(rt.observe()!.request, replacement.request);
assert.equal(rebases, 1);
assert.equal(starts,1,'cancel/replace observer releases reservation before any timing start');
assert.equal(rt.cancelRequest(Object.assign(Object.create(null), replacement)).ok, true);
rt.release(l2);
const l3 = rt.capture(cap, runner as any, cursor(), () => ({ enemy: slot, queue, queueEntry: queue[0], queueIndex: 0 }))!;
rt.requestBattleEndScriptPause();
slot = { objectID: 1, scriptOnBattleEnd: 10 };
assert.equal(rt.observe()!.state, 'retired');
assert.equal(rt.liveReferences, 0);
rt.release(l3);
const l4 = rt.capture(cap, runner as any, cursor(), () => ({ enemy: slot, queue, queueEntry: queue[0], queueIndex: 0 }))!;
assert.equal(typeof rt.bindFrame, 'function', 'the exact live child VM frames must be validated');
rt.bindFrame(l4, {} as any);
vm.owns = () => false;
assert.equal(rt.observe()!.state, 'retired');
assert.equal(rt.liveReferences, 0);
rt.release(l4);
vm.owns = () => true;
const pendingChild = rt.capture(cap, runner as any, cursor(), () => ({ enemy: slot, queue, queueEntry: queue[0], queueIndex: 0 }))!;
const unfulfilled = rt.requestBattleEndScriptPause();
rt.release(pendingChild);
assert.equal(rt.cancelRequest(unfulfilled).ok, false);
const nextChild = rt.capture(cap, runner as any, cursor(), () => ({ enemy: slot, queue, queueEntry: queue[0], queueIndex: 0 }))!;
nextChild.cursor.frames[0].frameWait = { frame: 0, remainingFrames: 1, stage: 'sleep', remainingMs: 100 };
assert.equal(rt.observe()!.state, 'running');
assert.equal(rt.pauseAt(nextChild), null, 'returned unfulfilled request cannot park the next child');
rt.release(nextChild);
let enemies=[slot];const traversal=rt.capture(cap,runner as any,cursor(),()=>({enemy:enemies[0],enemyList:enemies}))!;enemies=[...enemies];assert.equal(rt.observe()!.state,'retired','foreign traversal array replacement cannot retain authority through the same slot reference');rt.release(traversal);
let dynamicMax=0;prepare=()=>true;
const dynamic=rt.capture(cap,runner as any,cursor(),()=>({enemy:slot,enemyList:enemies,maxEnemyIndex:dynamicMax}))!;
dynamicMax=1;assert.equal(rt.observe()!.state,'running','native opaque clone may grow original traversal while running');
dynamic.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};rt.requestBattleEndScriptPause();
const dynamicGate=rt.pauseAt(dynamic)!;assert.ok(dynamicGate);const dynamicAnswer=rt.observe()!;dynamicMax=2;
assert.equal(rt.resume(dynamicAnswer).ok,false,'foreign maximum change while parked invalidates exact wait');await assert.rejects(dynamicGate);rt.release(dynamic);
let frozen={result:3,party:'[0,0]'};deps.loop.rewardsScriptState=()=>({...frozen});prepare=()=>true;
const mutation=rt.capture(cap,runner as any,cursor(),()=>({enemy:slot}))!;mutation.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};rt.requestBattleEndScriptPause();const mutationGate=rt.pauseAt(mutation)!;frozen.result=0;
assert.equal(rt.resume(rt.observe()).ok,false,'foreign result change while parked must refuse before wake');await assert.rejects(mutationGate);rt.release(mutation);
let quiescent=true;deps.loop.prepareRewardsScriptPause=()=>quiescent;
const busy=rt.capture(cap,runner as any,cursor(),()=>({enemy:slot}))!;busy.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};rt.requestBattleEndScriptPause();const busyGate=rt.pauseAt(busy)!;quiescent=false;assert.equal(rt.resume(rt.observe()).ok,false,'command conflict must refuse before native wake');await assert.rejects(busyGate);rt.release(busy);
quiescent=true;
const startReplace=rt.capture(cap,runner as any,cursor(),()=>({enemy:slot}))!;startReplace.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};const startRequest=rt.requestBattleEndScriptPause();let replacementAtStart:any;deps.loop.suspendRewardsScriptPause=()=>{assert.equal(rt.cancelRequest(startRequest).ok,true);replacementAtStart=rt.requestBattleEndScriptPause();return ()=>{};};
assert.equal(rt.pauseAt(startReplace),null,'synchronous start sample cancellation cannot publish the old request');assert.equal(rt.observe()!.state,'requested');assert.equal(rt.observe()!.request,replacementAtStart.request);rt.release(startReplace);
rt.dispose();
// The original service getter can initialize data. The rewards-only quiescence
// path must refuse an absent component without calling that creating getter.
{
 const {BattleCommandRuntime}=await import('../services/battle-command-runtime');
 let data:any=null,creates=0;
 const writer={world:()=>1,peek:()=>data};
 const command=new BattleCommandRuntime();command.install('owned-command',{world:{getWorldWriter:()=>writer},battle:{getOpenPrompt:()=>null,submitCommand:()=>({ok:false}),requestAutoBattle:()=>({ok:false}),acceptPendingCommand:()=>null,acceptAutoRequest:()=>null,closePrompt:()=>{},getCommands:()=>{creates++;return data??={open:null,pending:null,autoRequest:null};}},global:()=>({}),enums:()=>({})} as any);
 assert.equal(command.rewardsPauseQuiescent(),false,'absent command component must refuse without initialization');assert.equal(creates,0,'rewards quiescence is a non-creating read');
 data={open:null,pending:null,autoRequest:null};assert.equal(command.rewardsPauseQuiescent(),true);for(const field of ['open','pending','autoRequest']){data[field]={};assert.equal(command.rewardsPauseQuiescent(),false);data[field]=null;}assert.equal(creates,0);command.dispose();
}
// Scope retirement from scheduler readiness happens while cancel is guarded.
// After that transition exits the exact old wait must be retired too.
{
 const reentrant=new BattleEndScriptRuntime();
 const local={...deps,loop:{...deps.loop,prepareRewardsScriptPause:()=>true,suspendRewardsScriptPause:()=>()=>{}}};reentrant.install('owned-cursor',local);
 let retireInReady=false,child:any;
 child=reentrant.capture(cap,runner as any,cursor(),()=>{if(retireInReady&&(reentrant as any).scheduler.inTransition)child.scope.clear();return {enemy:slot};})!;
 child.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};reentrant.requestBattleEndScriptPause();const gate=reentrant.pauseAt(child)!;const dto=reentrant.observe()!;
 retireInReady=true;assert.equal(reentrant.resume(dto).ok,false);await assert.rejects(gate);
 assert.equal((reentrant as any).scheduler.peek(),null,'retirement inside readiness must clear the old wait after transition');
 const fresh=reentrant.capture(cap,runner as any,cursor(),()=>({enemy:slot}))!;reentrant.release(fresh);reentrant.dispose();assert.equal(scopes.size,0);
}
// Running controls and region validation must reject a removed component before
// the parent validator reaches the original creating getCommands() getter.
{
 const {BattleCommandRuntime}=await import('../services/battle-command-runtime');
 const {BattleLoopRuntime}=await import('../services/battle-loop-runtime');
 const {BattleScriptExecution}=await import('../services/battle-script-execution');
 const {ScriptExecutionRuntime}=await import('../services/script-execution-runtime');
 let data:any={context:'non-creating',open:null,pending:null,autoRequest:null},creates=0;
 const native={},global={},state={battleResult:3},vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true,curEquipPart:-1};
 const worldScopes=new Set<any>(),writer={world:()=>1,peek:()=>data},world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>worldScopes.add(s),releaseCancellableExecutionScope:(s:any)=>worldScopes.delete(s)};
 const battle={getState:()=>state,getModule:()=>native,battleInstance:1,isInBattle:()=>true,getCommands:()=>{if(!data){creates++;data={context:'non-creating',open:null,pending:null,autoRequest:null};}return data;},getOpenPrompt:()=>data?.open??null,submitCommand:()=>({ok:false}),requestAutoBattle:()=>({ok:false}),acceptPendingCommand:()=>null,acceptAutoRequest:()=>null,closePrompt:()=>{}};
 const command=new BattleCommandRuntime();command.install('owned-command',{world,battle,global:()=>global,enums:()=>({})} as any);
 const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});const parent=scripts.begin(runner as any)!;scripts.bind(parent,native);
 const loop=new BattleLoopRuntime();loop.install('round-boundary',{world,battle,scripts,commands:command,global:()=>global,ongoing:()=>false});const root=command.capture(native),main=loop.capture(parent,native,root)!;loop.activate(main);loop.release(main);command.release(root);scripts.phase(parent,'rewards');const region=loop.enterRewardsScriptRegion(parent,native,()=>1000)!;
 const childRuntime=new BattleEndScriptRuntime();childRuntime.install('owned-cursor',{world,scripts,loop});const enemy={objectID:1,scriptOnBattleEnd:10};
 for(const operation of ['observe','request','cancel']){
  data={context:'non-creating',open:null,pending:null,autoRequest:null};const child=childRuntime.capture(parent,runner,cursor(),()=>({enemy}))!;
  const request=childRuntime.requestBattleEndScriptPause();data=null;
  if(operation==='observe')assert.equal(childRuntime.observe()!.state,'retired','running observation refuses removed commands');else if(operation==='request')assert.equal(childRuntime.requestBattleEndScriptPause().ok,false);else assert.equal(childRuntime.cancelRequest(request).ok,false);
  assert.equal(creates,0,'running control cannot recreate the command component');assert.equal(data,null);childRuntime.release(child);
 }
 data=null;assert.throws(()=>loop.assertRewardsScriptParent(parent,region));assert.equal(creates,0);
 childRuntime.dispose();loop.leaveRewardsScriptRegion(parent,region);scripts.finish(parent,true);loop.dispose();command.dispose();assert.equal(worldScopes.size,0);
}
// A source retired by a synchronous timing probe never publishes its gate.
// Its rejection must be consumed locally, while the native guard will unwind.
{
 const unpublished=new BattleEndScriptRuntime();let child:any;
 const local={...deps,loop:{...deps.loop,prepareRewardsScriptPause:()=>true,suspendRewardsScriptPause:()=>{child.scope.clear();return null;}}};unpublished.install('owned-cursor',local);
 child=unpublished.capture(cap,runner as any,cursor(),()=>({enemy:slot}))!;child.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};unpublished.requestBattleEndScriptPause();
 const unhandled:unknown[]=[],listener=(error:unknown)=>unhandled.push(error);process.on('unhandledRejection',listener);
 assert.equal(unpublished.pauseAt(child),null);await new Promise<void>(resolve=>setImmediate(resolve));process.removeListener('unhandledRejection',listener);
 assert.deepEqual(unhandled,[],'unpublished gate rejection has no external unhandled rejection');unpublished.release(child);unpublished.dispose();assert.equal(scopes.size,0);
}
// A state/binding probe can replace a still-pending request before RAW starts.
{
 const probing=new BattleEndScriptRuntime();let replace=false,request:any,replacement:any,starts=0;
 const local={...deps,loop:{...deps.loop,prepareRewardsScriptPause:()=>true,rewardsScriptState:()=>{if(replace){replace=false;assert.equal(probing.cancelRequest(request).ok,true);replacement=probing.requestBattleEndScriptPause();}return {result:3,party:'[]'};},suspendRewardsScriptPause:(_:unknown,guard:()=>boolean)=>{if(!guard())return null;starts++;return ()=>{};}}};probing.install('owned-cursor',local);
 const child=probing.capture(cap,runner as any,cursor(),()=>({enemy:slot}))!;child.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};request=probing.requestBattleEndScriptPause();replace=true;
 assert.equal(probing.pauseAt(child),null);assert.equal(starts,0);assert.equal(probing.observe()!.state,'requested');assert.equal(probing.observe()!.request,replacement.request);
 const next=probing.pauseAt(child)!;assert.ok(next,'replacement belongs to the next eligible cut');assert.equal(probing.resume(probing.observe()).ok,true);await next;assert.equal(starts,1);probing.release(child);probing.dispose();assert.equal(scopes.size,0);
}
// Healthy command busy state defers the pending request without retiring it.
{
 const deferred=new BattleEndScriptRuntime();let quiescent=false,starts=0;
 const local={...deps,loop:{...deps.loop,prepareRewardsScriptPause:()=>quiescent,suspendRewardsScriptPause:()=>{starts++;return ()=>{};}}};deferred.install('owned-cursor',local);
 const child=deferred.capture(cap,runner as any,cursor(),()=>({enemy:slot}))!;child.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};const request=deferred.requestBattleEndScriptPause();
 assert.equal(deferred.pauseAt(child),null);assert.equal(deferred.observe()!.state,'requested');assert.equal(deferred.observe()!.request,request.request);assert.equal(deferred.liveReferences,1);assert.equal(starts,0);
 quiescent=true;const gate=deferred.pauseAt(child)!;assert.ok(gate);assert.equal(deferred.resume(deferred.observe()).ok,true);await gate;assert.equal(starts,1);deferred.release(child);deferred.dispose();assert.equal(scopes.size,0);
}
// Late probes run only after earlier cut validation succeeds and the gate is
// installed. Native-style finally release must never reject an unseen promise.
{
 let cases=0;const unseen:unknown[]=[];
 for(const probe of ['binding','max','state'])for(const retire of [false,true])for(const primary of [false,null,undefined]){
  const late=new BattleEndScriptRuntime();let child:any,armed=false,triggered=false,timingStarts=0;
  const fail=()=>{if(!armed||!child.reject||triggered)return;triggered=true;if(retire)child.scope.clear();throw primary;};
  const local={...deps,loop:{...deps.loop,prepareRewardsScriptPause:()=>true,rewardsScriptState:()=>{if(probe==='state')fail();return {result:3,party:'[]'};},suspendRewardsScriptPause:(_:unknown,guard:()=>boolean)=>{if(!guard())return null;timingStarts++;return ()=>{};}}};late.install('owned-cursor',local);
  child=late.capture(cap,runner as any,cursor(),()=>{if(probe==='binding')fail();return {enemy:slot,get maxEnemyIndex(){if(probe==='max')fail();return 0;}};})!;
  child.cursor.frames[0].frameWait={frame:0,remainingFrames:1,stage:'sleep',remainingMs:16};late.requestBattleEndScriptPause();armed=true;
  const unhandled:unknown[]=[],listener=(error:unknown)=>unhandled.push(error);process.on('unhandledRejection',listener);
  let caught=false,error:unknown;
  try{late.pauseAt(child);}catch(value){caught=true;error=value;}finally{late.release(child,error,caught);}
  await new Promise<void>(resolve=>setImmediate(resolve));process.removeListener('unhandledRejection',listener);
  assert.equal(triggered,true,`${probe} reached after gate allocation`);assert.equal(caught,true);assert.equal(error,primary,'native primary falsy failure is preserved');
  if(unhandled.length)unseen.push({probe,retire,primary:String(primary),rejections:unhandled.map(value=>String(value))});
  assert.equal(timingStarts,0);assert.equal((late as any).scheduler.peek(),null);assert.equal(late.liveReferences,0);assert.equal(scopes.size,0);late.dispose();cases++;
 }
 assert.deepEqual(unseen,[],'all late binding/max/state primitive and retirement cases consume only the unpublished gate');
 console.log(`END LATE PROBES PASSED (${cases} post-allocation primitive/retirement cases; no unseen rejection)`);
}
console.log('BATTLE-END-SCRIPT-RUNTIME PASSED (private source, non-creating controls, quiescence, replacement, unpublished gate, reentrant retirement)');
