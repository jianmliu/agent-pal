import assert from 'node:assert/strict';
import {BattleLoopRuntime} from '../services/battle-loop-runtime';
import {BattleScriptExecution} from '../services/battle-script-execution';
import {ScriptExecutionRuntime} from '../services/script-execution-runtime';
import {suspendBattleTimeCharging} from '../services/battle-systems';
const vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true},raw={},native={},global={},writer={},scopes=new Set<any>();
const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
const battle={getState:()=>raw,getModule:()=>native,getCommands:()=>({context:'child-clock'}),battleInstance:1};
const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});const cap=scripts.begin(runner as any)!;scripts.bind(cap,native);
const runtime=new BattleLoopRuntime();runtime.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},assertRoot:()=>{}},ongoing:()=>true});
let now=13916.666666666666,logical=now,reads=0,rebases=0;const old=(globalThis as any).hrtime,read=()=>{reads++;return now;};(globalThis as any).hrtime=read;
try{
const live=runtime.capture(cap,native,{},(...args:any[])=>{const end=(suspendBattleTimeCharging as any)(...args);return (ticks?:number)=>{rebases++;return end(ticks);};},undefined,read)!;runtime.activate(live);
for(const duration of [5000,27000]){
 assert.equal(runtime.prepareChildPause(cap),true);const before=reads,end=runtime.suspendChildPause(cap),anchor=runtime.presentationTime(now);
 // Control polling lands on an integer raw time, while native frame time retains thirds of a microsecond.
 now=Math.ceil(now)+duration;assert.equal(runtime.presentationTime(now),anchor);end();assert.equal(reads-before,2,'exactly one actual raw read feeds each start/end sample');assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000);
 const after=reads;end();assert.equal(reads,after,'dead lease does not read/rebase');runtime.releaseChildPause(cap);
 if(duration===5000){now+=0.0006;logical+=0.0006;runtime.requestBattlePause();const anchor=runtime.presentationTime(now),beforeOuter=reads,gate=runtime.pauseAt(live,'initial-combat')!,dto=runtime.observe()!;assert.equal(runtime.presentationTime(now),anchor,'outer park freezes the same phase-compensated anchor');now=Math.ceil(now)+5000;assert.equal(runtime.presentationTime(now),anchor);assert.equal(runtime.resume(dto).ok,true);await gate;assert.equal(runtime.presentationTime(now),anchor,'outer resume cannot lose the child fractional phase');assert.equal(reads-beforeOuter,2);}
 for(const delta of [73.66666666666667,62.5,62.5,62.5,41.666666666666664]){now+=delta;logical+=delta;assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000,'fractional phase must preserve subsequent native integer microsecond observations');}
}
assert.equal(rebases,3);runtime.release(live);assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000,'fractional scalar survives original parent rewards');scripts.finish(cap,true);runtime.dispose();assert.equal(scopes.size,0);
}finally{(globalThis as any).hrtime=old;}
console.log('BATTLE-POISON-CLOCK PASSED (fractional advancing phase; repeated 5s/27s; one start/end sample; dead handle; reward lifetime)');
