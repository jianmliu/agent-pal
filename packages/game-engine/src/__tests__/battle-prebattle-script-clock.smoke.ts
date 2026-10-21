import assert from 'node:assert/strict';
import {BattleLoopRuntime} from '../services/battle-loop-runtime';
import {BattleScriptExecution} from '../services/battle-script-execution';
import {ScriptExecutionRuntime} from '../services/script-execution-runtime';
import {suspendBattleTimeCharging} from '../services/battle-systems';
const vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true},raw={battleResult:1001},native={},global={},writer={},scopes=new Set<any>();
const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
const battle={getState:()=>raw,getModule:()=>native,getCommands:()=>({context:'child-clock'}),battleInstance:1};
const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});const cap=scripts.begin(runner as any)!;scripts.bind(cap,native);
const runtime=new BattleLoopRuntime();runtime.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},assertRoot:()=>{}},ongoing:()=>raw.battleResult===1000,preBattle:()=>raw.battleResult===1001});
let now=13916.666666666666,logical=now,reads=0,rebases=0;const old=(globalThis as any).hrtime,read=()=>{reads++;return now;};(globalThis as any).hrtime=read;
try{
const live=runtime.capture(cap,native,{},(...args:any[])=>{const end=(suspendBattleTimeCharging as any)(...args);return (ticks?:number)=>{rebases++;return end(ticks);};},undefined,read)!;assert.equal(typeof runtime.enterPreBattleRegion,'function','inactive native prebattle region requires phase authority');
const actualObserve=scripts.observe.bind(scripts);scripts.phase(cap,'combat');scripts.observe=()=>({...actualObserve()!,phase:'pre-battle'});assert.throws(()=>runtime.enterPreBattleRegion(live),'forged public phase DTO cannot authorize a private region');scripts.observe=actualObserve;scripts.phase(cap,'pre-battle');
const region=runtime.enterPreBattleRegion(live);
assert.throws(()=>runtime.assertChildParent(cap),'combat authority stays inactive');
for(const duration of [5000,27000]){
 assert.equal(runtime.preparePreBattlePause(cap),true);const before=reads,end=runtime.suspendPreBattlePause(cap),anchor=runtime.presentationTime(now);
 // Control polling lands on an integer raw time, while native frame time retains thirds of a microsecond.
 now=Math.ceil(now)+duration;assert.equal(runtime.presentationTime(now),anchor);end();assert.equal(reads-before,2,'exactly one actual raw read feeds each start/end sample');assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000);
 const after=reads;end();assert.equal(reads,after,'dead lease does not read/rebase');runtime.releaseChildPause(cap);

 for(const delta of [73.66666666666667,62.5,62.5,62.5,41.666666666666664]){now+=delta;logical+=delta;assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000,'fractional phase must preserve subsequent native integer microsecond observations');}
}
assert.equal(rebases,2);runtime.leavePreBattleRegion(live,region);raw.battleResult=1000;scripts.phase(cap,'combat');runtime.activate(live);runtime.assertChildParent(cap);runtime.release(live);assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000,'fractional scalar survives original parent rewards');scripts.finish(cap,true);runtime.dispose();assert.equal(scopes.size,0);
}finally{(globalThis as any).hrtime=old;}
console.log('BATTLE-PREBATTLE-SCRIPT-CLOCK PASSED (fractional advancing phase; repeated 5s/27s; one start/end sample; dead handle; reward lifetime)');
// A synchronous raw sample may retire the exact parent and establish a new lease.
{
 const raw={battleResult:1001},native={},global={},writer={},vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true};
 const scopes=new Set<any>(),world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(x:any)=>scopes.add(x),releaseCancellableExecutionScope:(x:any)=>scopes.delete(x)};
 const battle={getState:()=>raw,getModule:()=>native,getCommands:()=>({context:'sample-replacement'}),battleInstance:1};
 const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});const oldCap=scripts.begin(runner as any)!;scripts.bind(oldCap,native);
 const local=new BattleLoopRuntime();local.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},assertRoot:()=>{}},ongoing:()=>raw.battleResult===1000,preBattle:()=>raw.battleResult===1001});
 let reads=0,starts=0,onRead:(()=>void)|null=null,freshCap:any,freshLive:any,freshRegion:any;
 const read=()=>{reads++;onRead?.();return 1000.125;},suspend=(ticks?:number)=>{starts++;return suspendBattleTimeCharging(ticks);};
 const oldLive=local.capture(oldCap,native,{},suspend,undefined,read)!;local.enterPreBattleRegion(oldLive);
 onRead=()=>{onRead=null;local.release(oldLive);scripts.finish(oldCap,true);freshCap=scripts.begin(runner as any)!;scripts.bind(freshCap,native);freshLive=local.capture(freshCap,native,{},suspend,undefined,read)!;freshRegion=local.enterPreBattleRegion(freshLive);};
 assert.throws(()=>local.suspendPreBattlePause(oldCap),/native battle loop changed|timing lease changed/,'raw sample replacement cannot attach an old timing ticket to the new lease');
 assert.equal(reads,1);assert.equal(starts,0,'original timing adapter cannot run after its exact lease changed');assert.equal(local.presentationTime(1000.125),1000.125);
 local.leavePreBattleRegion(freshLive,freshRegion);local.release(freshLive);scripts.finish(freshCap,true);local.dispose();assert.equal(scopes.size,0);
 console.log('BATTLE-PREBATTLE-START-SAMPLE PASSED (exact old lease before/after raw sample; replacement untouched)');
}
// A recent 125ms anchor is below the native 500ms clamp, and differs from one FrameTime.
const systems=await import('../services/battle-systems');
const {battleLoopRuntime: shared}=await import('../services/battle-loop-runtime');
const {BattleComponents}=await import('../ecs/index');
let rawTime=1000.125,chargeReads=0;
const previousClock=(globalThis as any).hrtime,previousFrame=(globalThis as any).FrameTime;
(globalThis as any).FrameTime=50;(globalThis as any).hrtime=()=>{chargeReads++;return rawTime;};
try {
 const state={battleResult:1001,UI:{},hidingTime:0},native={},writer={},global={},scopes=new Set<any>();
 const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
 const vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true};
 const battle={getState:()=>state,getModule:()=>native,getCommands:()=>({context:'origin'}),battleInstance:1};
 const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});const cap=scripts.begin(runner as any)!;scripts.bind(cap,native);
 shared.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},assertRoot:()=>{}},ongoing:()=>state.battleResult===1000,preBattle:()=>state.battleResult===1001});
 const unit=systems.recomputeTimeChargingUnit();assert.equal(chargeReads,1,'original writer reads clock once');
 const live=shared.capture(cap,native,{},systems.suspendBattleTimeCharging,systems.activateBattleTimeCharging,()=>{chargeReads++;return rawTime;},systems.captureBattleTimeChargingBasis)!;
 const region=shared.enterPreBattleRegion(live);assert.equal(chargeReads,1,'capture of original anchor basis is scalar only');
 rawTime+=10;for(const duration of [5000,27000]){const before:number=chargeReads;const end=shared.suspendPreBattlePause(cap);rawTime+=duration;end();assert.equal(chargeReads-before,2);}
 shared.leavePreBattleRegion(live,region);state.battleResult=1000;scripts.phase(cap,'combat');shared.activate(live);rawTime+=115;
 const time={state:0,timeMeter:0};
 const registry={iterateEntitiesWith:()=>[1],getComponent:(_:number,name:string)=>name===BattleComponents.BattleActor?{type:'enemy',index:0}:name===BattleComponents.Time?{stateRef:time}:null};
 systems.timeChargeSystem({battleService:{getRegistry:()=>registry,getState:()=>state},battle:{getEnemyDexterity:()=>10}});
 assert.equal(time.timeMeter,unit*10*(125/50),'first native charging delta must preserve original recent anchor rather than hitting clamp');
 const originAudit=process.argv.find(x=>x.startsWith('--origin-audit='))?.slice(15);
 if(originAudit==='cross-parent')systems.recomputeTimeChargingUnit(); // exact original writer in old active domain
 shared.release(live);scripts.finish(cap,true);assert.equal(scopes.size,0);
 if(originAudit){
  state.battleResult=1001;
  if(originAudit==='same-value'){rawTime=40000.123456;systems.recomputeTimeChargingUnit();}
  const fresh=scripts.begin(runner as any)!;scripts.bind(fresh,native);
  const current=shared.capture(fresh,native,{},systems.suspendBattleTimeCharging,systems.activateBattleTimeCharging,()=>{chargeReads++;return rawTime;},systems.captureBattleTimeChargingBasis)!;
  const captureReads=chargeReads,region=shared.enterPreBattleRegion(current);assert.equal(chargeReads,captureReads,'new-parent basis capture adds no clock read');
  if(originAudit==='same-value'){const before:number=chargeReads;systems.recomputeTimeChargingUnit();assert.equal(chargeReads-before,1,'same-valued new native writer keeps its original one read');}
  shared.leavePreBattleRegion(current,region);state.battleResult=1000;scripts.phase(fresh,'combat');shared.activate(current);rawTime+=125;
  const freshTime={state:0,timeMeter:0};
  const freshRegistry={iterateEntitiesWith:()=>[1],getComponent:(_:number,name:string)=>name===BattleComponents.BattleActor?{type:'enemy',index:0}:name===BattleComponents.Time?{stateRef:freshTime}:null};
  systems.timeChargeSystem({battleService:{getRegistry:()=>freshRegistry,getState:()=>state},battle:{getEnemyDexterity:()=>10}});
  assert.equal(freshTime.timeMeter,unit*10*(125/50),`original writer provenance must survive ${originAudit} window`);
  shared.release(current);scripts.finish(fresh,true);assert.equal(scopes.size,0);console.log(`BATTLE-PREBATTLE-NATIVE-ORIGIN PASSED (${originAudit})`);
 }
 shared.dispose();
} finally {(globalThis as any).hrtime=previousClock;(globalThis as any).FrameTime=previousFrame;}
