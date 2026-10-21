import assert from 'node:assert/strict';
import {suspendBattleTimeCharging} from '../services/battle-systems';
import {BattleLoopRuntime} from '../services/battle-loop-runtime';
import {BattleScriptExecution} from '../services/battle-script-execution';
import {ScriptExecutionRuntime} from '../services/script-execution-runtime';
function fixture(){
 const vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true},raw={},native={},global={},writer={},scopes=new Set<any>();
 const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
 const battle={getState:()=>raw,getModule:()=>native,getCommands:()=>({context:'clock'}),battleInstance:1};
 const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});const cap=scripts.begin(runner as any)!;scripts.bind(cap,native);
 const runtime=new BattleLoopRuntime();runtime.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},assertRoot:()=>{}},ongoing:()=>true});
 return {runtime,scripts,cap,world,native,scopes};
}
if(!process.argv.includes('--guard-only'))for(const duration of [0,5000,27000]){
 const f=fixture();let now=14000.123456,rebases=0,started=0;
 const live=f.runtime.capture(f.cap,f.native,{},()=>{started=now;return()=>{rebases++;return (Math.round(now*1000)-Math.round(started*1000))/1000;};},undefined,()=>now)!;
 f.runtime.activate(live);const initial=f.runtime.presentationTime(now);assert.equal(initial,14000.123);
 f.runtime.requestBattlePause();const gate=f.runtime.pauseAt(live,'initial-combat')!,dto=f.runtime.observe()!;
 now+=duration;assert.equal(f.runtime.presentationTime(now),initial,'private clock must freeze while parked');assert.equal(f.runtime.resume({...dto,revision:999}).ok,false);assert.equal(rebases,0);
 assert.equal(f.runtime.resume(dto).ok,true);await gate;assert.equal(f.runtime.presentationTime(now),initial);assert.equal(rebases,1);assert.equal(f.runtime.resume(dto).ok,false);now+=50;assert.equal(f.runtime.presentationTime(now),initial+50);
 f.runtime.release(live);assert.equal(f.runtime.presentationTime(now),initial+50,'clock lease persists through original reward presentation');f.scripts.finish(f.cap,true);assert.equal(f.runtime.presentationTime(now),now);f.runtime.dispose();assert.equal(f.scopes.size,0);
}
// Production suspension with a raw clock that advances on every synchronous read.
if(!process.argv.includes('--guard-only')){
 const f=fixture();let ticks=1000000,reads=0,rebases=0;const previous=(globalThis as any).hrtime;
 const read=()=>{reads++;const sample=ticks;ticks+=10;return sample/1000;};(globalThis as any).hrtime=read;
 try{
  const live=f.runtime.capture(f.cap,f.native,{},(...args:any[])=>{
   const resume=(suspendBattleTimeCharging as any)(...args);return()=>{rebases++;return resume();};
  },undefined,read)!;f.runtime.activate(live);
  let stale:any=null;
  for(const duration of [5000000,27000000]){
   f.runtime.requestBattlePause();const before=reads,gate=f.runtime.pauseAt(live,'initial-combat')!,dto=f.runtime.observe()!;
   const parked=f.runtime.presentationTime(ticks/1000);ticks+=duration;
   assert.equal(f.runtime.presentationTime(ticks/1000),parked);
   assert.equal(f.runtime.resume({...dto,revision:999}).ok,false);
   if(stale)assert.equal(f.runtime.resume(stale).ok,false);
   const beforeResume=reads;assert.equal(f.runtime.resume(dto).ok,true);await gate;
   const resumed=f.runtime.presentationTime((ticks-10)/1000);
   assert.equal(resumed,parked,'matching end sample preserves the exact parked anchor');
   const active=f.runtime.presentationTime(read());
   assert.ok(active>=parked,`advancing raw reads must not rewind the private clock: ${parked} -> ${active}`);
   assert.equal(active,parked+0.01,'exclude exactly the shared start/end interval');
   assert.equal(beforeResume-before,1,'park samples raw clock once');assert.equal(reads-beforeResume,2,'resume samples once plus explicit observation');
   const after=reads;assert.equal(f.runtime.resume(dto).ok,false);assert.equal(reads,after,'duplicate resume cannot read/rebase clock');stale=dto;
  }
  assert.equal(rebases,2);f.runtime.release(live);f.scripts.finish(f.cap,true);f.runtime.dispose();assert.equal(f.scopes.size,0);
 }finally{(globalThis as any).hrtime=previous;}
}
for(const value of [undefined,null,false]){
 const f=fixture(),live=f.runtime.capture(f.cap,f.native,{})!;f.runtime.activate(live);f.runtime.requestBattlePause();const gate=f.runtime.pauseAt(live,'initial-combat')!;const result=gate.then(()=>({failed:false,value:null}),error=>({failed:true,value:error}));
 const getter=f.world.getWorldWriter;f.world.getWorldWriter=()=>{throw value;};let caught=false;try{f.runtime.observe();}catch(error){caught=true;assert.equal(error,value);}f.world.getWorldWriter=getter;
 assert.equal(caught,true,'validation callback failure must retain its exact primary value');const out=await result;assert.equal(out.failed,true);assert.equal(out.value,value,'parent metadata retirement cannot replace original native gate failure');assert.equal(f.runtime.liveReferences,0);f.scripts.finish(f.cap,false);f.runtime.dispose();assert.equal(f.scopes.size,0);
}
for(const value of [undefined,null,false]){
 const f=fixture(),live=f.runtime.capture(f.cap,f.native,{})!;f.runtime.activate(live);f.runtime.requestBattlePause();const gate=f.runtime.pauseAt(live,'initial-combat')!;const outcome=gate.then(()=>({failed:false,value:null}),error=>({failed:true,value:error}));f.runtime.release(live,value,true);const out=await outcome;assert.equal(out.failed,true);assert.equal(out.value,value,'body unwind preserves its exact primary gate failure');f.scripts.finish(f.cap,false);f.runtime.dispose();assert.equal(f.scopes.size,0);
}
console.log('BATTLE-LOOP-CLOCK PASSED (3 elapsed/monotonic + 2 production advancing-clock pauses; 3 exact falsy guard + 3 primary unwind failures)');
