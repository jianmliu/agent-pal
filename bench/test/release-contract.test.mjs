import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as contract from '../protocol-contract.mjs';
const task = {id:'fixture',version:1,start:{},tiers:['B'],budget:{toolCalls:10,tokens:100,virtualSeconds:60}};
test('effective budgets record the actual multipliers and overrides',()=>{
 assert.deepEqual(contract.effectiveBudget(task,{env:{}}),{toolCalls:10,tokens:50000,virtualSeconds:1200});
 assert.equal(contract.effectiveBudget(task,{env:{BENCH_BUDGET_TOOL_CALLS:'6000'}}).tokens,60000);
});
test('formal protocol changes bind effort, prompt, adapter, and budgets without paths or credentials',()=>{
 const make=(x={})=>contract.protocolContract({task,model:'codex-cli:test',env:{},runtime:{engine:'abc'},adapterIdentity:{sha256:'one'},...x});
 const a=make();
 for(const x of [{env:{BENCH_EFFORT:'high'}},{env:{BENCH_BUDGET_TOOL_CALLS:'11'}},{promptIdentity:'changed'},{adapterIdentity:{sha256:'two'}}]) assert.notEqual(a.hash,make(x).hash);
 assert.equal(make({env:{SECRET_TOKEN:'secret',BENCH_CODEX_BIN:'/private/local/bin'}}).hash,a.hash);
 assert.throws(()=>make({formal:true,env:{BENCH_RESUME_FROM:'/prior'}}),/BENCH_RESUME_FROM/);
});
test('repetitions and attempts have distinct identities and refuse existing evidence',()=>{
 const formal={release:'r',condition:'standard',scaffold:'c',repetition:1,attempt:1};
 assert.notEqual(contract.trialIdentity(formal,'fixture',42).id,contract.trialIdentity({...formal,repetition:2},'fixture',42).id);
 assert.throws(()=>contract.trialIdentity({...formal,repetition:0},'fixture',42),/repetition/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'contract-'));const base=path.join(dir,'trial');
 fs.writeFileSync(base+'.jsonl','original');assert.throws(()=>contract.assertFormalFresh(base),/existing/);assert.equal(fs.readFileSync(base+'.jsonl','utf8'),'original');fs.rmSync(dir,{recursive:true});
});
function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.exitCode=null;c.signalCode=null;c.signals=[];c.kill=s=>{c.signals.push(s);if(s==='SIGKILL'){c.signalCode=s;c.emit('exit',null,s);c.stdout.end();}return true;};return c;}
test('startup watchdog is bounded and escalates stubborn children',async()=>{
 const c=child();await assert.rejects(contract.waitForReady(c,{startupMs:10,killMs:10}),/startup-timeout/);assert.deepEqual(c.signals,['SIGTERM','SIGKILL']);
});
test('terminal drain allows a clean exit without a signal',async()=>{
 const c=child();const p=contract.monitorClient(c,{wallMs:1000,drainMs:100,killMs:10,pollMs:2,terminal:()=>true});
 setTimeout(()=>{c.exitCode=0;c.emit('exit',0);c.stdout.end();},10);
 const result=await p;assert.equal(result.cause,'client-exit');assert.deepEqual(c.signals,[]);
});
test('wall timeout stops server before allowing client drain',async()=>{
 const c=child();let stopped=false;const out=await contract.monitorClient(c,{wallMs:5,drainMs:10,killMs:5,pollMs:2,terminal:()=>false,onWall:()=>{stopped=true;}});assert.equal(out.cause,'wall-timeout');assert.equal(stopped,true);assert.deepEqual(c.signals,['SIGTERM','SIGKILL']);
});
test('formal resume binds protocol instead of an unchanged dirty revision',async()=>{
 const {resumeMismatch}=await import('../runner.mjs');
 const meta={model:'replay:auto',tier:'B',promptVersion:1,code:'same-dirty',protocols:[{hash:'a'}],formal:{releaseId:'r'}};
 assert.match(resumeMismatch(meta,{...meta,protocols:[{hash:'b'}]}).join(' '),/protocol/);
});
test('formal inference guard stops before creating output or a model process',async()=>{
 const {runBench}=await import('../runner.mjs');const out=path.join(os.tmpdir(),`disabled-${Date.now()}`);
 await assert.rejects(runBench({model:'codex-cli:paid',tasks:['pal-ch1-island'],out,formal:{releaseId:'r',inferenceEnabled:false}}),/inference is disabled/);assert.equal(fs.existsSync(out),false);
});
test('unexpected client spawn failure is a distinct lifecycle cause',async()=>{
 const c=child();const p=contract.monitorClient(c,{wallMs:100,killMs:5});c.emit('error',Error('ENOENT'));assert.equal((await p).cause,'client-spawn-error');
});
test('builtin IPC readiness is bounded independently from model wall time',async()=>{
 const c=child();const p=contract.waitForReady(c,{ipc:true,startupMs:100,killMs:5});c.emit('message',{type:'episode-ready'});assert.ok((await p).startupMs>=0);
});
test('formal environmental overrides must be declared before execution',()=>{
 const args={task,model:'replay:auto',runtime:{},env:{BENCH_STRIP_CHEESE:'1'}};
 assert.throws(()=>contract.protocolContract({...args,formal:{}}),/undeclared.*BENCH_STRIP_CHEESE/);
 assert.equal(contract.protocolContract({...args,formal:{overrides:{BENCH_STRIP_CHEESE:'1'}}}).overrides.BENCH_STRIP_CHEESE,'1');
});
test('formal filenames preserve task/seed compatibility while claim binds repetition',()=>{
 assert.equal(contract.episodeBasename('fixture',42),'fixture__s42');
});
