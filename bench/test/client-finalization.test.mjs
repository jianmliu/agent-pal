import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLog, compareLogs } from '../verify.mjs';
const api = await import('../client-finalization.mjs').catch(() => ({}));
function fixture(t, lines = [{type:'turn.completed',usage:{input_tokens:500,cached_input_tokens:400,output_tokens:20}}]) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cli-finalization-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const logFile=path.join(dir,'task__s42.jsonl'),resultFile=path.join(dir,'task__s42.json'),clientLogFile=path.join(dir,'task__s42.client.jsonl');
 const end={task:'task',taskVersion:1,seed:42,tier:'B',model:'codex-cli:gpt-6-astra',runId:'run',success:true,endReason:'success',tokensIn:0,tokensOut:0,tokensCached:0,tokensCacheWrite:0,cost:0};
 fs.writeFileSync(logFile,[{type:'start',...end},{type:'end',...end}].map(x=>JSON.stringify(x)+'\n').join(''));fs.writeFileSync(resultFile,JSON.stringify(end));fs.writeFileSync(clientLogFile,lines.map(x=>JSON.stringify(x)+'\n').join(''));
 return {logFile,resultFile,clientLogFile,client:{name:'codex-cli',model:'gpt-6-astra',effort:'medium'}};
}
test('shared finalizer exists',()=>assert.equal(typeof api.finalizeClient,'function'));
test('append receipt, retain original prefix and verify projected result',t=>{
 const f=fixture(t);const before=fs.readFileSync(f.logFile);const r=api.finalizeClient(f);assert.equal(r.tokensIn,500);assert.equal(r.tokensCached,400);assert.equal(r.tokensOut,20);
 assert.deepEqual(fs.readFileSync(f.logFile).subarray(0,before.length),before);
 const orig=readLog(f.logFile);assert.deepEqual(compareLogs(orig,{...orig,clientFinalized:null},r),[]);
 const mutated={...r,tokensIn:1};assert.match(compareLogs(orig,orig,mutated).join(' '),/tokensIn/);
});
test('duplicate finalization is idempotent and repairs missing projected result',t=>{
 const f=fixture(t);api.finalizeClient(f);const bytes=fs.readFileSync(f.logFile);fs.unlinkSync(f.resultFile);api.finalizeClient(f);assert.deepEqual(fs.readFileSync(f.logFile),bytes);assert.equal(JSON.parse(fs.readFileSync(f.resultFile)).tokensIn,500);
});
test('missing and timed-out usage stays unknown rather than zero',t=>{
 for(const opts of [{lines:[]},{lines:[{type:'turn.completed',usage:{input_tokens:500,output_tokens:20}}],timedOut:true}]){
 const f=fixture(t,opts.lines);const r=api.finalizeClient({...f,timedOut:opts.timedOut});assert.equal(r.tokensIn,null);assert.equal(r.cost,null);assert.notEqual(r.accountingStatus,'complete');}
});
test('receipt and original source tampering are rejected',t=>{
 const f=fixture(t);api.finalizeClient(f);fs.appendFileSync(f.clientLogFile,'{}\n');assert.throws(()=>api.finalizeClient(f),/source|hash/i);assert.ok(readLog(f.logFile).accountingErrors.length);
});
test('malformed usage is not silently coerced to zero',t=>{
 const f=fixture(t,[{type:'turn.completed',usage:{input_tokens:'500',output_tokens:20}}]);assert.equal(api.finalizeClient(f).tokensIn,null);
});
test('Claude extraction includes cached tokens and respects client cost',()=>{
 assert.equal(typeof api.parseClientUsage,'function');const r=api.parseClientUsage(JSON.stringify({type:'result',usage:{input_tokens:100,cache_read_input_tokens:300,cache_creation_input_tokens:20,output_tokens:10},total_cost_usd:0.5}),'claude-cli','claude-opus-5-5');assert.equal(r.tokensIn,420);assert.equal(r.cost,0.5);
});
test('Argon without machine-readable usage is explicitly unknown',()=>{
 assert.equal(api.parseClientUsage('finished game','agy-cli','gemini-4-argon').tokensIn,null);
});
test('missing required receipt is rejected for new external episodes',t=>{
 const f=fixture(t);const events=fs.readFileSync(f.logFile,'utf8').trim().split('\n').map(JSON.parse);events[0].clientAccountingVersion=1;fs.writeFileSync(f.logFile,events.map(e=>JSON.stringify(e)+'\n').join(''));
 assert.match(compareLogs(readLog(f.logFile),readLog(f.logFile)).join(' '),/missing.*client_finalized/);
});
test('receipt cannot hide altered gameplay or duplicate accounting',t=>{
 const f=fixture(t);const r=api.finalizeClient(f);const original=readLog(f.logFile);assert.match(compareLogs(original,{...original,end:{...original.end,success:false}},r).join(' '),/success/);
 const receipt=fs.readFileSync(f.logFile,'utf8').trim().split('\n').at(-1);fs.appendFileSync(f.logFile,receipt+'\n');assert.ok(readLog(f.logFile).accountingErrors.length);
});
test('changed server-end bytes invalidate prefix binding',t=>{
 const f=fixture(t);api.finalizeClient(f);fs.writeFileSync(f.logFile,fs.readFileSync(f.logFile,'utf8').replace('"tokensIn":0','"tokensIn":1'));assert.ok(readLog(f.logFile).accountingErrors.length);
});
test('unknown accounting is visible as warning instead of claimed zero',t=>{
 const f=fixture(t,[]);const r=api.finalizeClient(f);assert.equal(r.accountingStatus,'unknown');assert.equal(r.tokensOut,null);
});
test('backfill preserves source files and first failed verification',async t=>{
 const migration=await import('../backfill-client.mjs').catch(()=>({}));assert.equal(typeof migration.backfillClient,'function');
 const f=fixture(t);const backupDir=path.join(path.dirname(f.logFile),'archive');const before=fs.readFileSync(f.logFile);const resultBefore=fs.readFileSync(f.resultFile);
 migration.backfillClient({logFile:f.logFile,backupDir});assert.deepEqual(fs.readFileSync(path.join(backupDir,path.basename(f.logFile))),before);assert.deepEqual(fs.readFileSync(path.join(backupDir,path.basename(f.resultFile))),resultBefore);
 const after=fs.readFileSync(f.logFile);migration.backfillClient({logFile:f.logFile,backupDir});assert.deepEqual(fs.readFileSync(f.logFile),after);
});
test('verification cache fingerprint tracks bound CLI evidence',async t=>{
 const {episodeDigest}=await import('../verify.mjs');const f=fixture(t);api.finalizeClient(f);const before=episodeDigest(f.logFile);fs.appendFileSync(f.clientLogFile,'{}\n');assert.notEqual(episodeDigest(f.logFile),before);
});
test('receipt numeric tampering fails even when projected result is also changed',t=>{
 const f=fixture(t);api.finalizeClient(f);const lines=fs.readFileSync(f.logFile,'utf8').trim().split('\n');const receipt=JSON.parse(lines.pop());receipt.accounting.tokensIn=1;lines.push(JSON.stringify(receipt));fs.writeFileSync(f.logFile,lines.join('\n')+'\n');assert.ok(readLog(f.logFile).accountingErrors.some(s=>s.includes('tokensIn')));
});
test('an interrupted client turn cannot produce complete accounting',()=>{
 const text=[{type:'turn.completed',usage:{input_tokens:100,output_tokens:10}},{type:'turn.failed',error:{message:'interrupted'}}].map(JSON.stringify).join('\n');assert.equal(api.parseClientUsage(text,'codex-cli','gpt-6-astra').accountingStatus,'incomplete');
});
