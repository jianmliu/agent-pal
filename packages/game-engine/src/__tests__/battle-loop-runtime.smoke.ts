import assert from 'node:assert/strict';
import {BattleScriptExecution} from '../services/battle-script-execution';
import {ScriptExecutionRuntime} from '../services/script-execution-runtime';
const mod=await import('../services/battle-loop-runtime').catch(()=>null);
assert.ok(mod,'production live battle loop runtime is required');
const {BattleLoopRuntime,markCompletedBattleRound}=mod;
assert.equal(typeof (BattleLoopRuntime.prototype as any).markCompletedRound,'undefined','public runtime must not accept event contexts as round proof');
const scopes=new Set<any>();let raw={},writer={},context='one',instance=1;
const native={},global={},vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true};
const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:1}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
const battle={getModule:()=>native,getState:()=>raw,getCommands:()=>({context}),get battleInstance(){return instance;}};
const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});
const cap=scripts.begin(runner as any)!;scripts.bind(cap,native);
const runtime=new BattleLoopRuntime();runtime.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,assertRoot:()=>{},releasePauseBoundary:()=>{}},ongoing:()=>true});
assert.equal(runtime.requestBattlePause().ok,false);
const live=runtime.capture(cap,native,{})!;const request=runtime.requestBattlePause();assert.equal(request.ok,true);assert.equal(runtime.requestBattlePause().reason,'busy');
runtime.activate(live);const gate=runtime.pauseAt(live,'initial-combat')!;assert.ok(gate);const dto=runtime.observe()!;assert.equal(dto.state,'paused');
const edited=structuredClone(dto);edited.cursor.frame=999;assert.equal(runtime.resume(edited).ok,false);
assert.equal(runtime.resume({...dto,revision:dto.revision!+1}).ok,false);
assert.equal(runtime.resume(JSON.parse(JSON.stringify(dto))).ok,true);assert.equal(runtime.observe()!.state,'running');assert.equal(runtime.resume(dto).ok,false);await gate;
const r=runtime.requestBattlePause();
const nullRequest=Object.assign(Object.create(null),r);
assert.equal(runtime.cancelRequest(Object.assign(Object.create(null),r,{hasOwnProperty:false})).ok,false,'own hasOwnProperty key cannot spoof the exact DTO');
assert.equal(runtime.observe()!.state,'requested');assert.equal(runtime.cancelRequest(nullRequest).ok,true,'null-prototype JSON DTO remains supported');assert.equal(runtime.cancelRequest(r).ok,false);
runtime.beginFrame(live);const retained=runtime.bindContext({},cap);const json=JSON.parse(JSON.stringify(retained));markCompletedBattleRound(json);runtime.advance(live,'frame');assert.equal(runtime.consumeCompletedRound(live),false);
// Only the exact private context ticket can report successful exhaustion.
markCompletedBattleRound(retained);assert.equal(runtime.consumeCompletedRound(live),false,'late old stage cannot mark');runtime.completedRound(live);assert.equal(runtime.observe()!.cursor.completedRounds,1);
assert.throws(()=>runtime.completedRound(live),/completion/);
const pending=runtime.requestBattlePause();writer={};assert.equal(runtime.observe()!.state,'retired');assert.equal(runtime.cancelRequest(pending).ok,false);assert.equal(runtime.liveReferences,0);
runtime.release(live);scripts.finish(cap,true);assert.equal(scopes.size,0);runtime.dispose();
{
 const rt=new BattleLoopRuntime();rt.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,assertRoot:()=>{},releasePauseBoundary:()=>{}},ongoing:()=>true});
 const c=scripts.begin(runner as any)!;scripts.bind(c,native);let rebases=0;
 const l=rt.capture(c,native,{},()=>()=>{rebases++;return 100;})!;rt.activate(l);rt.beginFrame(l);const oldContext=rt.bindContext({},c);
 rt.requestBattlePause();const gate=rt.pauseAt(l,'initial-combat')!;const dto=rt.observe()!;assert.equal(rt.presentationTime(1000),1000);
 assert.equal(rt.resume({...dto,revision:999}).ok,false);assert.equal(rebases,0);assert.equal(rt.resume(dto).ok,true);await gate;assert.equal(rt.presentationTime(1000),900);assert.equal(rt.resume(dto).ok,false);assert.equal(rebases,1);
 rt.release(l);assert.equal(rt.presentationTime(1000),900,'scalar timing lease survives combat main through rewards/end');scripts.finish(c,true);assert.equal(rt.presentationTime(1000),1000);
 const next=scripts.begin(runner as any)!;scripts.bind(next,native);const fresh=rt.capture(next,native,{})!;rt.activate(fresh);rt.beginFrame(fresh);markCompletedBattleRound(oldContext);rt.advance(fresh,'frame');assert.equal(rt.consumeCompletedRound(fresh),false,'old retained contexts cannot prove new frame completion');rt.release(fresh);scripts.finish(next,true);rt.dispose();
}
for(const value of [undefined,null,false]){
 const rt=new BattleLoopRuntime();rt.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>{throw value;},assertRoot:()=>{},releasePauseBoundary:()=>{}},ongoing:()=>true});
 const c=scripts.begin(runner as any)!;scripts.bind(c,native);const l=rt.capture(c,native,{});rt.activate(l);rt.requestBattlePause();let caught=false;try{rt.pauseAt(l,'initial-combat');}catch(e){caught=true;assert.equal(e,value);}assert.ok(caught);rt.release(l,value,true);scripts.finish(c,false);rt.dispose();
}
for(const value of [undefined,null,false]){
 const rt=new BattleLoopRuntime();rt.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,assertRoot:()=>{},releasePauseBoundary:()=>{}},ongoing:()=>true});
 const c=scripts.begin(runner as any)!;scripts.bind(c,native);const l=rt.capture(c,native,{},()=>()=>{throw value;})!;rt.activate(l);rt.requestBattlePause();const gate=rt.pauseAt(l,'initial-combat')!;const caught=gate.then(()=>({failed:false,value:null}),error=>({failed:true,value:error}));let thrown=false;try{rt.resume(rt.observe());}catch(error){thrown=true;assert.equal(error,value);}assert.equal(thrown,true);const result=await Promise.race([caught,new Promise<{failed:boolean;value:unknown}>(resolve=>setTimeout(()=>resolve({failed:false,value:'unsettled'}),50))]);assert.equal(result.failed,true,'failed resume must settle original native gate');assert.equal(result.value,value);assert.equal(rt.liveReferences,0);assert.throws(()=>rt.capture(c,native,{}),/already captured/,'unsettled old native parent cannot reset sticky scheduler failure');scripts.finish(c,false);
 const next=scripts.begin(runner as any)!;scripts.bind(next,native);const fresh=rt.capture(next,native,{})!;rt.activate(fresh);rt.requestBattlePause();let freshGate:Promise<void>|null=null;assert.doesNotThrow(()=>{freshGate=rt.pauseAt(fresh,'initial-combat');},'settled failure must not poison next native generation');const freshDTO=rt.observe()!;rt.release(l,value,true);assert.equal(rt.observe()!.id,freshDTO.id,'old finally cannot retire replacement');assert.equal(rt.resume(freshDTO).ok,true);await freshGate;rt.release(fresh);scripts.finish(next,true);rt.dispose();
}
console.log('BATTLE-LOOP-RUNTIME PASSED (resume failure + private signal + identity contracts)');
