import assert from 'node:assert/strict';
import {BattleLoopRuntime} from '../services/battle-loop-runtime';
import {BattleScriptExecution} from '../services/battle-script-execution';
import {ScriptExecutionRuntime} from '../services/script-execution-runtime';
import {suspendBattleTimeCharging} from '../services/battle-systems';
const vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true},raw={battleResult:1001},native={},global={},writer={world:()=>1,peek:()=>({context:'child-clock'})},scopes=new Set<any>();
const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
const battle={getState:()=>raw,getModule:()=>native,getCommands:()=>({context:'child-clock'}),battleInstance:1};
const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});const cap=scripts.begin(runner as any)!;scripts.bind(cap,native);
const runtime=new BattleLoopRuntime();runtime.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},assertRoot:()=>{},rewardsPauseQuiescent:()=>true},ongoing:()=>raw.battleResult===1000,preBattle:()=>raw.battleResult===1001});
let now=13916.666666666666,logical=now,reads=0,rebases=0;const old=(globalThis as any).hrtime,read=()=>{reads++;return now;};(globalThis as any).hrtime=read;
try{
const live=runtime.capture(cap,native,{},undefined,undefined,read)!;
assert.equal(typeof runtime.enterRewardsScriptRegion,'function','actual successful main return requires private post-loop region');
assert.throws(()=>runtime.enterRewardsScriptRegion(cap,native,read));
runtime.activate(live);runtime.release(live);assert.equal(runtime.liveReferences,0);assert.equal(typeof (runtime as any).returnedParents.get(cap),'number','successful-main proof retains only a scalar domain');
scripts.phase(cap,'rewards');const region=runtime.enterRewardsScriptRegion(cap,native,read)!;
assert.equal(reads,0,'post-loop acquisition has no raw sample');
for(const duration of [5000,27000]){
 assert.equal(runtime.prepareRewardsScriptPause(cap),true);const before:number=reads,end=runtime.suspendRewardsScriptPause(cap)!,anchor=runtime.presentationTime(now);
 // Control polling lands on an integer raw time, while native frame time retains thirds of a microsecond.
 now=Math.ceil(now)+duration;assert.equal(runtime.presentationTime(now),anchor);end();assert.equal(reads-before,2,'exactly one actual raw read feeds each start/end sample');assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000);
 const after:number=reads;end();assert.equal(reads,after,'dead lease does not read/rebase');runtime.releaseRewardsScriptPause(cap);

 for(const delta of [73.66666666666667,62.5,62.5,62.5,41.666666666666664]){now+=delta;logical+=delta;assert.equal(runtime.presentationTime(now),Math.round(logical*1000)/1000,'fractional phase must preserve subsequent native integer microsecond observations');}
}
assert.equal(rebases,0,'rewards never activate charging suspension');runtime.leaveRewardsScriptRegion(cap,region);scripts.finish(cap,true);runtime.dispose();assert.equal(scopes.size,0);
}finally{(globalThis as any).hrtime=old;}
// RAW callbacks can replace private phase/context/region while retaining the
// same presentation domain, or settle this parent and establish a new one.
let replacementChecks=0;
for(const stage of ['start','end'])for(const mutation of ['phase','context','region','parent']){
 let rawTime=1000.125,reads=0,context='replacement-clock',onRead:(()=>void)|null=null;
 const state={battleResult:3},native={},global={},writer={world:()=>1,peek:()=>({context})},scopes=new Set<any>(),vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true};
 const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
 const battle={getState:()=>state,getModule:()=>native,getCommands:()=>({context}),battleInstance:1};
 const scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});let parent=scripts.begin(runner as any)!;scripts.bind(parent,native);
 const loop=new BattleLoopRuntime();loop.install('round-boundary',{world,battle,scripts,commands:{assertRoot:()=>{},preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},rewardsPauseQuiescent:()=>true},global:()=>global,ongoing:()=>false});
 const read=()=>{reads++;const action=onRead;onRead=null;action?.();return rawTime;};
 const main=loop.capture(parent,native,{})!;loop.activate(main);loop.release(main);scripts.phase(parent,'rewards');let region=loop.enterRewardsScriptRegion(parent,native,read)!;
 const oldParent=parent,oldRegion=region,domain=loop.presentationDomain();let end:(()=>void)|null=null;
 if(stage==='end'){end=loop.suspendRewardsScriptPause(parent)!;rawTime+=5000.333333333333;}
 onRead=()=>{if(mutation==='phase')scripts.phase(parent,'combat');else if(mutation==='context')context='foreign';else if(mutation==='region')loop.leaveRewardsScriptRegion(parent,region);else {scripts.invalidate();scripts.finish(parent,false);parent=scripts.begin(runner as any)!;scripts.bind(parent,native);const next=loop.capture(parent,native,{})!;loop.activate(next);loop.release(next);scripts.phase(parent,'rewards');region=loop.enterRewardsScriptRegion(parent,native,read)!;}};
 assert.throws(()=>stage==='start'?loop.suspendRewardsScriptPause(oldParent):end!(),`RAW ${stage} ${mutation} replacement must refuse before interval/wake`);
 assert.equal(reads,stage==='start'?1:2,'only the attempted genuine raw sample runs');
 if(mutation!=='parent')assert.equal(loop.presentationDomain(),domain,'private phase/context/region checks cannot rely only on domain replacement');
 const before=reads;end?.();assert.equal(reads,before,'retired old ticket is readless after failed end');
 const anchor=loop.presentationTime(rawTime);loop.releaseRewardsScriptPause(oldParent);if(mutation==='parent')assert.equal(loop.presentationTime(rawTime),anchor,'old ticket abort never touches the new domain');
 loop.leaveRewardsScriptRegion(oldParent,oldRegion);loop.leaveRewardsScriptRegion(parent,region);scripts.finish(parent,true);loop.dispose();assert.equal(scopes.size,0);replacementChecks++;
}
// An old rewards ticket must not alter a later native recompute/first charge.
{
 const systems=await import('../services/battle-systems'),{battleLoopRuntime:shared}=await import('../services/battle-loop-runtime'),{BattleComponents}=await import('../ecs/index');
 let rawTime=1000.125,rawReads=0,chargeStarts=0,chargeActivates=0;
 const previousClock=(globalThis as any).hrtime,previousFrame=(globalThis as any).FrameTime;
 (globalThis as any).FrameTime=50;(globalThis as any).hrtime=()=>{rawReads++;return rawTime;};
 const state={battleResult:1000,UI:{},hidingTime:0},native={},writer={world:()=>1,peek:()=>({context:'later-native'})},global={},scopes=new Set<any>();
 const world={getWorldWriter:()=>writer,_partyView:()=>({maxIndex:0,members:[{playerRole:0}]}),registerCancellableExecutionScope:(s:any)=>scopes.add(s),releaseCancellableExecutionScope:(s:any)=>scopes.delete(s)};
 const vm=new ScriptExecutionRuntime(),runner={getExecutionRuntime:()=>vm,scriptSuccess:true},battle={getState:()=>state,getModule:()=>native,getCommands:()=>({context:'later-native'}),battleInstance:1},scripts=new BattleScriptExecution();scripts.install('owned-parent',{world,battle,global:()=>global});
 shared.install('round-boundary',{world,battle,scripts,global:()=>global,commands:{assertRoot:()=>{},preparePauseBoundary:()=>true,releasePauseBoundary:()=>{},rewardsPauseQuiescent:()=>true},ongoing:()=>true});
 const charge=(ticks?:number)=>{chargeStarts++;return systems.suspendBattleTimeCharging(ticks);},activate=(basis?:any)=>{chargeActivates++;systems.activateBattleTimeCharging(basis);};
 const meter=()=>({state:0,timeMeter:0}),chargeMeter=(time:any)=>systems.timeChargeSystem({battleService:{getRegistry:()=>({iterateEntitiesWith:()=>[1],getComponent:(_:number,name:string)=>name===BattleComponents.BattleActor?{type:'enemy',index:0}:name===BattleComponents.Time?{stateRef:time}:null}),getState:()=>state},battle:{getEnemyDexterity:()=>10}});
 try {
  const unit=systems.recomputeTimeChargingUnit(),parent=scripts.begin(runner as any)!;scripts.bind(parent,native);const main=shared.capture(parent,native,{},charge,activate,()=>{rawReads++;return rawTime;})!;shared.activate(main);rawTime+=125;const initial=meter();chargeMeter(initial);assert.equal(initial.timeMeter,unit*10*(125/50));shared.release(main);scripts.phase(parent,'rewards');const region=shared.enterRewardsScriptRegion(parent,native,()=>{rawReads++;return rawTime;})!;
  const before=rawReads,end=shared.suspendRewardsScriptPause(parent)!;rawTime+=5000.333333333333;end();assert.equal(rawReads-before,2);assert.equal(chargeStarts,0);assert.equal(chargeActivates,1,'rewards never reactivate charging');shared.leaveRewardsScriptRegion(parent,region);scripts.finish(parent,true);
  const freshUnit=systems.recomputeTimeChargingUnit(),fresh=scripts.begin(runner as any)!;scripts.bind(fresh,native);const next=shared.capture(fresh,native,{},charge,activate,()=>{rawReads++;return rawTime;})!;shared.activate(next);const reads=rawReads;end();assert.equal(rawReads,reads,'dead old reward ticket cannot sample/rebase the fresh parent');rawTime+=125;const first=meter();chargeMeter(first);assert.equal(first.timeMeter,freshUnit*10*(125/50),'later original recompute and first charging delta remain exact');shared.release(next);scripts.finish(fresh,true);assert.equal(scopes.size,0);
 } finally {shared.dispose();(globalThis as any).hrtime=previousClock;(globalThis as any).FrameTime=previousFrame;}
}
console.log(`BATTLE-END-SCRIPT-CLOCK PASSED (5s/27s fractional carry; one start/end RAW; ${replacementChecks} synchronous replacement cases; dead old tickets; later native recompute/first charge)`);
