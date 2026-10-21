import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {validateTask} from '../task.mjs';import {evaluate} from '../predicates.mjs';import {rank,renderBoard,verifyStatus} from '../board.mjs';import {compareLogs, runDigest, episodeDigest} from '../verify.mjs';import {score} from '../score.mjs';
const runner=await import('../runner.mjs');
assert.equal(runner.replayTaskId?.('replay:auto','example'),'example','replay:auto must select this episode reference');
assert.equal(runner.replayTaskId?.('replay:explicit','example'),'explicit');
const base={id:'test',version:1,title:'Test',difficulty:4,start:{newGame:true},seeds:[42],brief:'win',goal:{battleWon:{enemyObject:546}},budget:{toolCalls:180},tiers:['B']};
assert.ok(validateTask({...base,start:{newGame:true,setup:[['load',{slot:1}]]}}).some(x=>x.includes('setup')),'setup must reject load');
assert.ok(validateTask({...base,scoring:{secondary:'bogus'}}).some(x=>x.includes('scoring')));
assert.ok(validateTask({...base,battlePolicy:{forbiddenActions:['bogus']}}).some(x=>x.includes('battlePolicy')));
assert.equal(evaluate({battleWon:{enemyObject:546}},{battles:[{outcome:'won',enemyObjects:[547]}]}),false,'other battle is not Baiyue');
const a={model:'expensive-fast',score:1,costMeanOnSuccess:100,scoring:'battleRounds',battleRoundsMeanOnSuccess:8};const b={model:'cheap-slow',score:1,costMeanOnSuccess:1,scoring:'battleRounds',battleRoundsMeanOnSuccess:12};assert.equal(rank([b,a])[0],a);
assert.equal(rank([a,{...b,score:.5,battleRoundsMeanOnSuccess:1}])[0],a);
const binding={start:{task:'a',taskVersion:1,seed:42,tier:'B'},calls:[],end:{task:'a',taskVersion:1,seed:42,tier:'B',success:true}};
const forged={...binding,end:{...binding.end,task:'b',seed:43}};assert.ok(compareLogs(forged,binding,forged.end).some(x=>/task|seed/.test(x)),'start and replay must bind end identity');
const orig={start:{},calls:[],end:{success:true,battleRounds:12}};assert.ok(compareLogs(orig,{...orig,end:{...orig.end,battleRounds:13}}).some(x=>x.includes('battleRounds')));
assert.ok(compareLogs(orig,orig,{...orig.end,battleRounds:13}).some(x=>x.includes('battleRounds')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-round-score-'));fs.mkdirSync(path.join(dir,'episodes'));
fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify({runId:'x',model:'replay:x',tier:'B',scoring:'battleRounds',tasks:[{id:'x',version:1,seeds:[42,43],par:{42:10,43:10}}]}));
for(const [seed,success,battleRounds]of [[42,true,12],[43,false,2]])fs.writeFileSync(path.join(dir,'episodes',`x__s${seed}.json`),JSON.stringify({task:'x',seed,success,battleRounds,endReason:success?'success':'fail-condition',progress:success?1:0,successAt:10,invalidCalls:0,toolCalls:10,tokensIn:0,tokensOut:0,cost:0}));
const s=score(dir);assert.equal(s.battleRoundsMeanOnSuccess,12);assert.equal(s.tasks[0].battleRoundsMeanOnSuccess,12);assert.equal(s.scoring,'battleRounds');
const metaFile=path.join(dir,'run.json'),meta=JSON.parse(fs.readFileSync(metaFile));meta.runtime={version:'frozen'};fs.writeFileSync(metaFile,JSON.stringify(meta));
fs.writeFileSync(path.join(dir,'verify.json'),JSON.stringify({runDigest:runDigest(meta),episodes:[42,43].map(seed=>({file:`x__s${seed}.jsonl`,ok:true,digest:episodeDigest(path.join(dir,'episodes',`x__s${seed}.jsonl`))}))}));
assert.equal(verifyStatus(dir).state,'verified');fs.writeFileSync(metaFile,JSON.stringify({...meta,scoring:'cost'}));assert.equal(verifyStatus(dir).state,'stale');fs.writeFileSync(metaFile,JSON.stringify({...meta,runtime:undefined,scoring:'cost'}));assert.equal(verifyStatus(dir).state,'stale','removing runtime cannot restore verified label');
fs.rmSync(dir,{recursive:true,force:true});process.stdout.write('Baiyue schema, scoring, and round tamper checks passed\n');

// Accepted owned commands can pause on combat dialogue before the next actor.
const {executeTaskTool,engineOptions}=await import('../start.mjs');
assert.equal(engineOptions({engineProfile:'owned-battle'}).commandProfile,'owned-command');
let boundary={kind:'battle.command',state:'waiting',revision:1};let dialog=false;const calls=[];
const fakeEngine={commandWait:()=>boundary,worldService:{isInBattle:()=>true},drive:async p=>p};
const fakeAgent={mode:()=>dialog?'dialog':'battle'};
const fakeTool=async (_a,name)=>{calls.push(name);if(name==='battle'){boundary={kind:'dialog',revision:2};dialog=true;return {ok:false,reason:'busy'};}dialog=false;boundary={kind:'battle.command',state:'waiting',revision:3};return {ok:true};};
assert.equal((await executeTaskTool({e:fakeEngine,a:fakeAgent,task:{engineProfile:'owned-battle'},runTool:fakeTool},'battle',{})).ok,true);
assert.deepEqual(calls,['battle','advance']);
const rejected=await executeTaskTool({e:fakeEngine,a:fakeAgent,task:{engineProfile:'owned-battle'},runTool:async()=>({ok:false,reason:'busy'})},'battle',{});
assert.equal(rejected.ok,false,'unaccepted commands must remain errors');
for(const reason of ['invalid','not_found']) {
 const result=await executeTaskTool({e:fakeEngine,a:fakeAgent,task:{engineProfile:'owned-battle'},runTool:async()=>({ok:false,reason})},'battle',{});
 assert.equal(result.ok,false);assert.equal(result.reason,reason);
}
