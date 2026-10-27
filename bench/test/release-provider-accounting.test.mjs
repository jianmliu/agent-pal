import test from 'node:test';
import assert from 'node:assert/strict';
import {runLoop} from '../loop.mjs';
function episode(){
 const ends=[];let done=false;
 const e={tier:'B',task:{id:'fake',goal:{},budget:{toolCalls:10}},intro:'test',tools:[],result:{tokensIn:0,tokensOut:0,tokensCached:0,tokensCacheWrite:0,cost:0},ends,
 get done(){return done;},logTurn(){},addUsage(u){for(const [k,v] of Object.entries({tokensIn:u.tokensIn??0,tokensOut:u.tokensOut??0,tokensCached:u.cacheRead??0,tokensCacheWrite:u.cacheWrite??0,cost:u.cost??0}))e.result[k]+=v;},
 async call(){return {text:'ok',done:false};},finish(reason){done=true;e.result.endReason=reason||'success';ends.push(structuredClone(e.result));return e.result;}};
 return e;
}
const known={text:'thinking',calls:[],usage:{tokensIn:100,tokensOut:10,cacheRead:0,cacheWrite:0},usageReported:{tokensIn:true,tokensOut:true}};
test('first failed provider request has unknown whole-trial usage before game end is recorded',async()=>{
 const e=episode();const r=await runLoop({episode:e,model:'openai:gpt-4o',provider:{turn:async()=>{throw Error('connection reset');}}});
 assert.equal(r.accountingStatus,'incomplete');for(const k of ['tokensIn','tokensOut','tokensCached','tokensCacheWrite','cost'])assert.equal(r[k],null);
 assert.deepEqual(r.measuredUsage,{tokensIn:0,tokensOut:0,tokensCached:0,tokensCacheWrite:0,cost:0,turns:0});
 assert.equal(e.ends.length,1);assert.deepEqual(e.ends[0],r);assert.equal(r.endReason,'provider-error');
});
test('later provider failure preserves measured prefix while whole-trial usage stays null',async()=>{
 const e=episode();let n=0;const r=await runLoop({episode:e,model:'openai:gpt-4o',provider:{turn:async()=>{if(n++)throw Error('provider quota');return known;}}});
 assert.equal(r.accountingStatus,'incomplete');assert.equal(r.tokensIn,null);assert.equal(r.cost,null);assert.equal(r.measuredUsage.tokensIn,100);assert.equal(r.measuredUsage.tokensOut,10);assert.equal(r.measuredUsage.turns,1);assert.deepEqual(e.ends[0],r);
});
test('successful complete usage retains reported totals',async()=>{
 const e=episode();const r=await runLoop({episode:e,model:'openai:gpt-4o',provider:{turn:async()=>known}});
 assert.equal(r.accountingStatus,'complete');assert.equal(r.tokensIn,400);assert.equal(r.tokensOut,40);assert.equal(typeof r.cost,'number');assert.equal(r.measuredUsage,undefined);
});
test('missing usage on normal responses cannot become complete zero accounting',async()=>{
 const e=episode();const r=await runLoop({episode:e,model:'openai:gpt-4o',provider:{turn:async()=>({...known,usage:{tokensIn:0,tokensOut:0},usageReported:{tokensIn:false,tokensOut:false}})}});
 assert.equal(r.accountingStatus,'incomplete');assert.equal(r.tokensIn,null);assert.equal(r.tokensOut,null);assert.equal(r.cost,null);assert.deepEqual(e.ends[0],r);
});
test('explicitly reported zero remains complete, but absent usage remains unknown',async()=>{
 for(const reported of [true,false]){
  const e=episode();const r=await runLoop({episode:e,model:'openai:gpt-4o',provider:{turn:async()=>({...known,...(reported?{usage:{tokensIn:0,tokensOut:0},usageReported:{tokensIn:true,tokensOut:true}}:{usage:undefined,usageReported:undefined})})}});
  assert.equal(r.accountingStatus,reported?'complete':'incomplete');assert.equal(r.tokensIn,reported?0:null);assert.equal(r.cost,reported?0:null);
 }
});
