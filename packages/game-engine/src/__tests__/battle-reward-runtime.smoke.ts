import assert from 'node:assert/strict';
import {createBattleRewardCursor} from '../services/battle-reward-cursor';
const api:any=await import('../services/battle-reward-runtime').catch(()=>({}));
assert.equal(typeof api.BattleRewardRuntime,'function','victory reward pause needs a live settlement owner');
const ActualRuntime=api.BattleRewardRuntime,parents:object[]=[],nativeLifetimes=new Map<object,any>();const {BattleScriptExecution}=await import('../services/battle-script-execution');
class ProjectedRuntime extends ActualRuntime {capture(_:unknown,native:unknown,cursor:unknown,read:unknown){const parent={};parents.push(parent);this.beginSettlement(parent,native);return super.capture(parent,native,cursor,read);}}
const rt=new ProjectedRuntime(),parent={},region={},source={},runner={getExecutionRuntime:()=>execution},execution={identity:'runner',battleFrames:()=>[],retireBattleOrigin(){}},world={registerCancellableExecutionScope(){},releaseCancellableExecutionScope(){}};
let quiescent=true,timing=0;const deps:any={world,scripts:{validate:()=>runner,observe:()=>({id:'parent',context:'context',battle:1}),onRetire:()=>()=>{}},loop:{rewardSettlementRuntime:()=>'runner',captureRewardSettlement:()=>region,assertRewardsScriptParent(){},prepareRewardsScriptPause:()=>quiescent,rewardsScriptState:()=>({result:3,party:'[0]'}),suspendRewardsScriptPause:(_:any,guard:any)=>guard()?(()=>{timing++;}):null,releaseRewardsScriptPause(){},enterRewardEndScripts(){},leaveRewardEndScripts(){},leaveRewardsScriptRegion(){}}};
rt.install('owned-cursor',deps);
assert.equal(rt.requestBattleRewardPause().reason,'unsupported');
const c=createBattleRewardCursor(0,0,false),l=rt.capture(parent,source,c,()=>({source}))!;
const request=rt.requestBattleRewardPause();assert.equal(request.ok,true);assert.equal(rt.requestBattleRewardPause().reason,'busy');
assert.equal(rt.cancelRequest({...request,request:request.request+1}).ok,false);
c.stage='before-end-scripts';const gate=rt.pauseAt(l)!;assert.ok(gate);const dto=rt.observe();assert.equal(dto.state,'paused');
assert.equal(rt.resume({...dto,cursor:{...dto.cursor,cash:1}}).ok,false);
assert.equal(rt.resume(JSON.parse(JSON.stringify(dto))).ok,true);await gate;assert.equal(timing,1);assert.equal(rt.resume(dto).ok,false);
rt.enterEndScripts(l);assert.equal(rt.requestBattleRewardPause().reason,'unsupported');
c.stage='before-recovery';rt.requestBattleRewardPause();quiescent=false;assert.equal(rt.pauseAt(l),null);quiescent=true;
c.stage='returned';rt.release(l);assert.equal(rt.liveReferences,0);assert.equal(rt.observe().state,'returned');
console.log('BATTLE-REWARD-RUNTIME PASSED');
const loopApi:any=await import('../services/battle-loop-runtime');
assert.equal(typeof loopApi.BattleLoopRuntime.prototype.captureRewardSettlement,'function','only actual successful main grants settlement authority');
for(const value of [false,null,undefined]){
 let leaves=0;const failing=new ProjectedRuntime();failing.install('owned-cursor',{...deps,loop:{...deps.loop,leaveRewardsScriptRegion(){leaves++;}}});
 let caught=false;try{failing.capture(parent,source,createBattleRewardCursor(1,1,false),()=>{throw value;});}catch(e){caught=true;assert.equal(e,value);}
 assert.equal(caught,true);assert.equal(failing.liveReferences,0);assert.equal(leaves,1,'failed initial binding must release its newly consumed private settlement region');
}
assert.equal(typeof loopApi.BattleLoopRuntime.prototype.enterRewardEndScripts,'function','end child authority must be nested only inside the actual end traversal');
assert.equal(typeof loopApi.BattleLoopRuntime.prototype.leaveRewardEndScripts,'function');
assert.equal(l.binding.source,null,'settled owner clears retained native source aliases');assert.equal(l.runner,null);assert.equal(l.runtime,null);assert.equal(l.parent,null);assert.equal(l.region,null);
for(const value of [false,null,undefined]){
 let leaves=0;const rt=new ProjectedRuntime();rt.install('owned-cursor',{...deps,scripts:{...deps.scripts,validate:()=>({getExecutionRuntime(){throw value;}})},loop:{...deps.loop,leaveRewardsScriptRegion(){leaves++;}}});
 let caught=false;try{rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>({source}));}catch(e){caught=true;assert.equal(e,value);}assert.equal(caught,true);assert.equal(leaves,1,'runtime identity capture failure releases exact newly acquired settlement');
}
for(const value of [false,null,undefined]){
 let released=0,leaves=0;const rt=new ProjectedRuntime();rt.install('owned-cursor',{...deps,scripts:{...deps.scripts,onRetire:()=>()=>{throw value;}},world:{registerCancellableExecutionScope(){},releaseCancellableExecutionScope(){released++;}},loop:{...deps.loop,leaveRewardsScriptRegion(){leaves++;}}});const child=rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>({source}));child.cursor.stage='returned';let caught=false;try{rt.release(child);}catch(e){caught=true;assert.equal(e,value);}assert.equal(caught,true);assert.equal(leaves,1,'unsubscribe failure cannot abandon native region cleanup');assert.equal(released,1);assert.equal(rt.liveReferences,0);assert.equal(child.binding.source,null);
}
for(const value of [false,null,undefined]){
 let reenter=false,child:any;const rt=new ProjectedRuntime();rt.install('owned-cursor',{...deps,loop:{...deps.loop,prepareRewardsScriptPause(){if(reenter){child.scope.clear();throw value;}return true;}}});child=rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>({source}));child.cursor.stage='before-recovery';rt.requestBattleRewardPause();const gate=rt.pauseAt(child);const dto=rt.observe();const rejected=gate.then(()=>({failed:false}),(e:unknown)=>({failed:true,value:e}));reenter=true;let caught=false;try{rt.resume(dto);}catch(e){caught=true;assert.equal(e,value);}assert.equal(caught,true,'reentrant retirement cannot swallow a falsy primary readiness failure');const out=await rejected;assert.equal(out.failed,true);assert.equal(out.value,value,'exact old native gate settles with synchronous readiness primary');assert.equal(rt.liveReferences,0);assert.equal(rt.scheduler.peek(),null);
}
const input=(await import('../services/input-service')).default,{createRewardWaitScope}=await import('../services/battle-reward-wait');
for(const value of [false,null,undefined]){
 const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;(globalThis as any).setTimeout=()=>55;(globalThis as any).clearTimeout=()=>{};
 try{let fail=false,child:any;const rt=new ProjectedRuntime();rt.install('owned-cursor',deps);child=rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>{if(fail){child.scope.clear();throw value;}return {source};});const scope=createRewardWaitScope(child.cursor,()=>null,()=>({kind:'process'}));scope.token=10;rt.setWait(child,scope);const gen=(input.waitForKey as any)(3000,scope),sleep=gen.next().value,result=sleep.then(()=>({failed:false}),(e:unknown)=>({failed:true,value:e}));fail=true;let caught=false;try{rt.requestBattleRewardPause();}catch(e){caught=true;assert.equal(e,value);}assert.equal(caught,true);const out=await result;assert.equal(out.value,value,'running native sleep settles exact late reentrant source failure');try{gen.throw(value);}catch(e){assert.equal(e,value);}assert.equal(rt.liveReferences,0);}finally{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
}
for(const mutation of ['pc','identity','register']){
 const frame={currentPC:4},vm={identity:'frozen',activeFrames:[frame],snapshot:()=>({activeFrames:vm.activeFrames.map(f=>({...f}))})},runner={getExecutionRuntime:()=>vm,scriptSuccess:true,curEquipPart:0};
 const rt=new ProjectedRuntime();rt.install('owned-cursor',{...deps,scripts:{...deps.scripts,validate:()=>runner},loop:{...deps.loop,rewardSettlementRuntime:()=>vm.identity}});const child=rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>({source}));child.cursor.stage='before-recovery';rt.requestBattleRewardPause();const gate=rt.pauseAt(child),dto=rt.observe();
 if(mutation==='pc')frame.currentPC++;else if(mutation==='identity')vm.activeFrames=[{...frame}];else runner.scriptSuccess=false;
 assert.equal(rt.resume(dto).ok,false,`parked parent ${mutation} must refuse before effects`);await assert.rejects(gate);assert.equal(rt.liveReferences,0);
}
for(const data of [{value:Infinity},{value:NaN},new Date(),{get value(){throw new Error('accessor executed');}}]){
 let leaves=0;const rt=new ProjectedRuntime();rt.install('owned-cursor',{...deps,loop:{...deps.loop,leaveRewardsScriptRegion(){leaves++;}}});assert.throws(()=>rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>({source,data})),TypeError,'invalid initial detached source data refuses before native normalize writes');assert.equal(leaves,1);assert.equal(rt.liveReferences,0);
}


for(const mutation of ['helper-frame','helper-pc','helper-runtime','helper-success','helper-equip','helper-getter-runtime','helper-false','helper-null','helper-undefined']){
 const frame={currentPC:4},vm={identity:'helper-binding',activeFrames:[frame],snapshot:()=>({activeFrames:vm.activeFrames.map(f=>({...f}))})};
 const helper:any={executionRuntime:vm,getExecutionRuntime(){return this.executionRuntime;},scriptSuccess:true,curEquipPart:0};
 const fence=await import('../services/battle-reward-fence');fence.registerRewardRunnerIdentity(helper,vm.identity);
 const lifetime=new BattleScriptExecution();lifetime.install('owned-parent',{world}as any);const parent=lifetime.begin(runner as any)!;nativeLifetimes.set(parent,lifetime);const rt=new ActualRuntime();parents.push(parent);rt.install('owned-cursor',deps);rt.beginSettlement(parent,source,{module:helper});const child=rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>({source,helpers:[helper]}));
 const readerApi=await import('../services/battle-reward-runtime');const lookalike={getExecutionRuntime(){assert.equal(readerApi.rewardServiceProviderProbeActive(),false,'scalar lookalike never acquires private active-lease probe');return vm;}};fence.registerRewardRunnerIdentity(lookalike,vm.identity);assert.equal(readerApi.readRewardNativeRuntime(lookalike),vm);const actualGetter=helper.getExecutionRuntime;helper.getExecutionRuntime=()=>{assert.equal(readerApi.rewardServiceProviderProbeActive(),true,'exact retained helper invokes provider inside guard');return actualGetter.call(helper);};assert.equal(readerApi.readRewardNativeRuntime(helper),vm);helper.getExecutionRuntime=actualGetter;assert.equal(readerApi.rewardServiceProviderProbeActive(),false);
 child.cursor.stage='before-recovery';rt.requestBattleRewardPause();const gate=rt.pauseAt(child),dto=rt.observe();const beforeTiming:number=timing;
 const replacement={...vm,activeFrames:[...vm.activeFrames]};
 if(mutation==='helper-frame')vm.activeFrames=[{...frame}];else if(mutation==='helper-pc')frame.currentPC++;else if(mutation==='helper-runtime')helper.executionRuntime=replacement;else if(mutation==='helper-getter-runtime')helper.getExecutionRuntime=()=>replacement;else if(mutation==='helper-success')helper.scriptSuccess=false;else if(mutation==='helper-equip')helper.curEquipPart=1;
 else{const value=mutation==='helper-false'?false:mutation==='helper-null'?null:undefined;helper.getExecutionRuntime=()=>{throw value;};let caught=false;try{rt.resume(dto);}catch(e){caught=true;assert.equal(e,value);}assert.equal(caught,true);const failure=await gate.then(()=>({failed:false,value:1}),(e:unknown)=>({failed:true,value:e}));assert.equal(failure.failed,true);assert.equal(failure.value,value);assert.equal(timing,beforeTiming);assert.equal(rt.liveReferences,0);assert.deepEqual(child.vmBindings,[]);continue;}
 assert.equal(rt.resume(dto).ok,false,mutation);await assert.rejects(gate);assert.equal(timing,beforeTiming,'distinct helper refusal precedes RAW return sample/wake');assert.equal(rt.liveReferences,0);assert.deepEqual(child.vmBindings,[]);
}
const runnerApi=await import('../services/script-runner'),fenceApi=await import('../services/battle-reward-fence');
for(const kind of ['trigger','auto']as const){assert.throws(()=>runnerApi.invokeRewardNativeWorld({},kind,1,0),/opaque|provenance/);assert.throws(()=>runnerApi.invokeRewardNativeWorld({},kind,1,0,{}),/opaque|provenance/);assert.throws(()=>fenceApi.invokeRewardWorldDispatch(kind,1,0),/opaque|provenance/);}
for(const hooks of [undefined,null,{}, {rewardBegin(){},invoke(){return 0;}}])assert.throws(()=>runnerApi.consumeRewardWorldEntry(hooks),/opaque|provenance/,'caller-supplied hooks cannot register private native World entry');
const worldApi=await import('../js/pal/play');
let fakeValidatorCalls=0;assert.throws(()=>worldApi.installRewardWorldEntryConsumer(()=>{fakeValidatorCalls++;}),/already installed/);assert.equal(fakeValidatorCalls,0);
for(const kind of ['trigger','auto']as const){const fakeHooks={invoke:()=>0};assert.equal(worldApi.consumeRewardWorldCallSite(fakeHooks as any,{},kind,1,0),false,'caller-supplied hooks/tokens cannot issue lexical World proof');assert.equal(worldApi.consumeRewardWorldCallSite(fakeHooks as any,undefined,kind,1,0),false);}
console.log('BATTLE-REWARD DISTINCT HELPER/UNPROVED WORLD PASSED (9 helper mutations;6 bridge refusals;4 fake lexical hook/token refusals;4 unregistered entry refusals)');

const {releaseBattleRewardTask,battleRewardTaskCount}=await import('../services/battle-reward-fence');for(const parent of parents){const lifetime=nativeLifetimes.get(parent);if(lifetime)lifetime.finish(parent,false);else releaseBattleRewardTask(parent);}assert.equal(battleRewardTaskCount(),0);

// Authentic native finish survives metadata retirement; no callback or task handle is returned.
const {onBattleScriptTaskFinish}=await import('../services/battle-script-execution');
for(const cap of [undefined,null,{},Object.freeze({id:'parent'})])assert.throws(()=>onBattleScriptTaskFinish(cap,()=>{throw new Error('forged callback');}),/invalid|finished/);
const finishLifetime=new BattleScriptExecution();finishLifetime.install('owned-parent',{world}as any);const finishParent=finishLifetime.begin(runner as any)!;let finished=0;
assert.equal(onBattleScriptTaskFinish(finishParent,()=>{finished++;assert.equal(finishLifetime.opaqueTasks,0);assert.throws(()=>onBattleScriptTaskFinish(finishParent,()=>{}),/finished/);}),undefined);
finishLifetime.invalidate();assert.equal(finished,0,'metadata retirement never releases native lifetime');finishLifetime.finish(finishParent,false);assert.equal(finished,1);finishLifetime.finish(finishParent,false);assert.equal(finished,1);
console.log('BATTLE-REWARD EXACT NATIVE FINISH PASSED (4 forged cap refusals; metadata retirement; once-only callback after task invalidation)');

// A caller-provided scalar-id lookalike cannot acquire an actual receiver read guard.
const {readRewardNativeRuntime,rewardServiceProviderProbeActive}=await import('../services/battle-reward-runtime');
let fakeReads=0;const fakeReader={getExecutionRuntime(){fakeReads++;assert.equal(rewardServiceProviderProbeActive(),false);return {identity:'runner'};}};
const {registerRewardRunnerIdentity}=await import('../services/battle-reward-fence');registerRewardRunnerIdentity(fakeReader,'runner');assert.equal(readRewardNativeRuntime(fakeReader).identity,'runner');assert.equal(fakeReads,1);assert.equal(rewardServiceProviderProbeActive(),false);
console.log('BATTLE-REWARD FIXED RECEIVER READER PASSED (unretained scalar lookalike unchanged; no guard/callback issuer)');

// Publication wrappers may retire or throw after the stock scheduler has produced an owner.
for(const seam of ['retire','false','null','undefined','newer','false-live','null-live','undefined-live']){
 const selected=process.env.REWARD_PUBLICATION_SEAM;if(selected&&selected!==seam)continue;
 let child:any;const rt=new ProjectedRuntime();rt.install('owned-cursor',deps);child=rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>({source}));child.cursor.stage='before-recovery';rt.requestBattleRewardPause();
 const original=rt.scheduler.publish.bind(rt.scheduler);let newer:any;const primary=seam.startsWith('false')?false:seam.startsWith('null')?null:undefined;
 rt.scheduler.publish=(...args:any[])=>{const owner=original(...args);if(!seam.endsWith('-live'))child.scope.clear();if(seam==='newer'){rt.scheduler.cancel(owner,'battle.rewards');newer=original('battle.rewards',{foreign:true},{ready:()=>true,stage:()=>({ok:true}),accept:()=>true,commit:()=>{},cancel:()=>{}});}if(seam!=='retire')throw primary;return owner;};
 if(seam==='retire'){const gate=rt.pauseAt(child);assert.ok(gate);await assert.rejects(gate);}else{let caught=false;try{rt.pauseAt(child);}catch(e){caught=true;assert.equal(e,primary);}assert.equal(caught,true);await new Promise<void>(resolve=>queueMicrotask(resolve));}
 assert.equal(rt.liveReferences,0);if(newer){assert.equal(rt.scheduler.peek()?.revision,newer.revision,'cleanup never cancels newer owner');rt.scheduler.cancel(newer,'battle.rewards');}else assert.equal(rt.scheduler.peek(),null,'stock publication owner is cleaned after wrapper retirement/failure');
}
if(process.env.REWARD_PUBLICATION_SEAM){console.log('BATTLE-REWARD PUBLICATION SEAM PASSED');process.exit(0);}

// Publication payload observation is fallible/reentrant after timing preparation.
{
 let armed=false,child:any,retired=0;const rt=new ProjectedRuntime();rt.install('owned-cursor',deps);
 child=rt.capture(parent,source,createBattleRewardCursor(1,1,false),()=>{if(armed){armed=false;retired++;child.scope.clear();}return {source};});child.cursor.stage='before-recovery';rt.requestBattleRewardPause();
 const observe=rt.observe;rt.observe=function(){if(this.current?.reject&&!this.current.owner&&this.current.observation.state==='paused')armed=true;return observe.call(this);};
 const gate=rt.pauseAt(child);if(gate)await assert.rejects(gate);await new Promise<void>(resolve=>queueMicrotask(resolve));
 assert.equal(retired,1);assert.equal(rt.liveReferences,0);assert.equal(rt.scheduler.peek(),null,'publication observation retirement must never leave a late ticket');
 const next=rt.capture({},source,createBattleRewardCursor(1,1,false),()=>({source}));next.cursor.stage='before-recovery';rt.requestBattleRewardPause();rt.observe=observe;const nextGate=rt.pauseAt(next);assert.equal(rt.resume(rt.observe()).ok,true);await nextGate;rt.release(next);
}
console.log('BATTLE-REWARD PUBLICATION RETIREMENT PASSED (payload source retirement; no late ticket; successor pause/resume)');
