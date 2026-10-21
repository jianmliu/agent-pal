import assert from 'node:assert/strict';
import input from '../services/input-service';
import {createBattleRewardCursor} from '../services/battle-reward-cursor';
import {createRewardWaitScope} from '../services/battle-reward-wait';
const oldPerf=globalThis.performance,oldTimer=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let now=100,reads=0,sleeps=0,wake!:()=>void;
const perf={now:()=>{reads++;return now;}};Object.defineProperty(globalThis,'performance',{value:perf,configurable:true});
(globalThis as any).setTimeout=(callback:any)=>{sleeps++;wake=callback;return 9;};(globalThis as any).clearTimeout=()=>{};
try{
 const c=createBattleRewardCursor(1,1,false),gate=Promise.resolve(),scope=createRewardWaitScope(c,()=>gate,()=>({kind:'browser-performance',performance:perf,now:perf.now}));scope.token=7;
 const gen=(input.waitForKey as any)(3000,scope),first=gen.next();
 assert.equal(first.value,gate,'park after native continue decision before arming its sleep');assert.equal(sleeps,0);assert.equal(reads,2);input.fire('keydown',2);input.clear();
 scope.shift(5000);now+=5000;const sleep=gen.next();assert.equal(sleeps,1);assert.equal(reads,2,'resume must reuse its sampled native continue decision');wake();await sleep.value;
 assert.equal(c.wait!.remaining,3000);const done=gen.next();assert.equal(done.done,true);assert.equal(reads,3);assert.equal(c.wait,null);
}finally{Object.defineProperty(globalThis,'performance',{value:oldPerf,configurable:true});globalThis.setTimeout=oldTimer;globalThis.clearTimeout=oldClear;}
console.log('BATTLE-REWARD-WAIT PASSED');
const bridge:any=await import('../services/wait-points');
assert.equal(typeof bridge.withOwnedRewardWait,'function','owned reward waits require strict own-token metadata scope');
const world=(await import('../services/world-service')).default,wait=(await import('../ecs/components/wait')),writer=world.getWorldWriter(),stack=wait.waitStack(writer);
stack.clear();
const cursor=createBattleRewardCursor(1,1,false),pageScope=createRewardWaitScope(cursor,()=>Promise.resolve(),()=>({kind:'browser-performance',performance:globalThis.performance,now:globalThis.performance.now}));
const body=function*(){pageScope.begin(pageScope.token,3000,performance.now()+3000,{performance,now:performance.now});pageScope.poll(performance.now(),true);const gate=pageScope.pause()!;yield gate;yield Promise.resolve();return 1;};
const wrapped=bridge.withOwnedRewardWait(pageScope,3000,body);wrapped.next();const token=pageScope.token;assert.equal(stack.respond(token,{advance:true}).ok,true);wrapped.next();assert.ok(writer.peek(writer.world(),wait.WaitStackComponent)!.frames.at(-1)!.response,'control-gate resume retains queued W4 until original sleep continuation');assert.equal(wrapped.next().done,true);assert.equal(writer.peek(writer.world(),wait.WaitStackComponent)!.frames.length,0);
const own=createRewardWaitScope(createBattleRewardCursor(1,1,false),()=>null,()=>({kind:'process'})),foreign=bridge.withOwnedRewardWait(own,3000,function*(){yield Promise.resolve();});foreign.next();const newer=stack.push('dialog',{speaker:null,text:'foreign'});foreign.return();assert.equal(writer.peek(writer.world(),wait.WaitStackComponent)!.frames.at(-1)!.token,newer,'own cleanup preserves newer foreign scopes');stack.clear();
const cleared=createRewardWaitScope(createBattleRewardCursor(1,1,false),()=>null,()=>({kind:'process'})),clearGen=bridge.withOwnedRewardWait(cleared,3000,function*(){yield Promise.resolve();});clearGen.next();world.getRegistry().removeComponent(writer.world(),'WaitStack');clearGen.return();assert.equal(world.getRegistry().getComponent(writer.world(),'WaitStack'),undefined,'strict finalizer never recreates a cleared component');
// Even a falsy timer-cancellation failure must settle the exact native sleep promise.
const savedSet=globalThis.setTimeout,savedClear=globalThis.clearTimeout;
(globalThis as any).setTimeout=()=>99;(globalThis as any).clearTimeout=()=>{throw false;};
try{
 const timed=createRewardWaitScope(createBattleRewardCursor(1,1,false),()=>null,()=>({kind:'process'}));timed.token=99;
 const g=(input.waitForKey as any)(3000,timed),sleep=g.next().value;let rejected:any='pending';void sleep.catch((e:any)=>{rejected=e;});
 let caught=false;try{timed.close(false);}catch(e){caught=true;assert.equal(e,false);}assert.equal(caught,true);
 await Promise.resolve();await Promise.resolve();assert.equal(rejected,false,'canceled scoped timer settles the exact yielded promise even when clear throws');
 try{g.throw(false);}catch(e){assert.equal(e,false);}
}finally{globalThis.setTimeout=savedSet;globalThis.clearTimeout=savedClear;}
const retired=createRewardWaitScope(createBattleRewardCursor(1,1,false),()=>null,()=>({kind:'process'}));retired.close();input.keyPress=2;
assert.throws(()=>(input.waitForKey as any)(3000,retired).next(),/retired/);assert.equal(input.keyPress,2,'retired private scope refuses before native clear or deadline samples');
for(const primary of [false,null,undefined]){
 stack.clear();const scope=createRewardWaitScope(createBattleRewardCursor(1,1,false),()=>null,()=>({kind:'process'}));
 let caught=false;try{bridge.withOwnedRewardWait(scope,3000,()=>{throw primary;}).next();}catch(e){caught=true;assert.equal(e,primary);}assert.equal(caught,true);assert.equal(writer.peek(writer.world(),wait.WaitStackComponent)!.frames.length,0,'factory failure cleans the exact already-declared reward frame');
}

for(const primary of [false,null,undefined]){stack.clear();const scope=createRewardWaitScope(createBattleRewardCursor(1,1,false),()=>null,()=>({kind:'process'}));scope.setTimer(()=>{throw primary;});const gen=bridge.withOwnedRewardWait(scope,3000,function*(){yield Promise.resolve();});gen.next();const newer=stack.push('dialog',{speaker:null,text:'foreign'});let caught=false;try{gen.return();}catch(e){caught=true;assert.equal(e,primary);}assert.equal(caught,true);assert.deepEqual(writer.peek(writer.world(),wait.WaitStackComponent)!.frames.map(f=>f.token),[newer],'falsy close continues exact-token cleanup preserving foreign scope');}
stack.clear();const missing=createRewardWaitScope(createBattleRewardCursor(1,1,false),()=>null,()=>({kind:'process'})),missingGen=bridge.withOwnedRewardWait(missing,3000,function*(){yield Promise.resolve();});missingGen.next();world.getRegistry().destroyEntity(writer.world());missingGen.return();assert.deepEqual(world.getRegistry().getEntitiesByTag('world'),[],'old strict wait finalizer never recreates deleted world tag');
