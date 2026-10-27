import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyEpisode, verify, readLog, runDigest, replayCertification, compareLogs, replayEnvironment, episodeDigest } from '../verify.mjs';
import { defaultVerifyDir, hasLocalGameAssets } from '../pr-check.mjs';
import { verifyStatus } from '../board.mjs';
import { costOf } from '../providers.mjs';
import { loadTask } from '../task.mjs';

function fixture(t, { fingerprint, runtime } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-verification-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'episodes'));
  const task = loadTask('classic08-leave-area');
  const start = {type:'start',task:task.id,taskVersion:task.version,seed:42,tier:'B',...(fingerprint?{fingerprint}:{})};
  const end = {type:'end',task:task.id,taskVersion:task.version,seed:42,tier:'B',success:false,endReason:'agent-stopped',toolCalls:0};
  const file = path.join(dir,'episodes',`${task.id}__s42.jsonl`);
  fs.writeFileSync(file,[start,end].map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(file.replace(/jsonl$/,'json'),JSON.stringify(end));
  fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify({tier:'B',...(runtime?{runtime}:{})}));
  return {dir,file,start,end};
}

test('no resources selects log consistency, preserves genuine replay cache, never certifies', t => {
  const {dir} = fixture(t);
  const cache = '{"episodes":[{"backend":"engine-replay","ok":true}]}';
  fs.writeFileSync(path.join(dir,'verify.json'),cache);
  let engine = 0;
  const rows = defaultVerifyDir(dir,{hasAssets:()=>false, env:{PAL_ASSET_DIR:path.join(dir,'missing')}, verifyFn:()=>{engine++;return [];}});
  assert.equal(engine,0);
  assert.equal(rows[0].backend,'log-consistency');
  assert.equal(rows[0].evidenceLevel,'log-consistency');
  assert.equal(rows[0].verdict,'consistent');
  assert.equal(rows[0].ok,true);
  assert.equal(replayCertification(rows[0]),false);
  assert.equal(fs.readFileSync(path.join(dir,'verify.json'),'utf8'),cache);
});

test('resolved resources select actual engine replay path', t => {
  const {dir} = fixture(t);
  const assets = path.join(dir,'assets');fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets,'PAT.MKF'),'test fixture');
  const env = {PAL_ASSET_DIR:assets};
  assert.equal(hasLocalGameAssets({env}),true);
  let called = 0;
  defaultVerifyDir(dir,{env,verifyFn: d=>{assert.equal(d,dir);called++;return [];}});
  assert.equal(called,1);
});

test('engine replay detects runtime and task tampering before replay', t => {
  const {file} = fixture(t,{fingerprint:{task:'old'},runtime:{engine:'old'}});
  let replayed = false;
  const opts = {replay:()=>{replayed=true;return readLog(file);}};
  const runtime = verifyEpisode(file,{...opts,runMeta:{runtime:{engine:'old'}},currentRuntime:{engine:'changed'}});
  assert.equal(runtime.ok,false);assert.match(runtime.diffs.join(' '),/runtime or assets/);
  const task = verifyEpisode(file,{...opts,currentTaskFingerprint:()=>({task:'changed'})});
  assert.equal(task.ok,false);assert.match(task.diffs.join(' '),/task or starting save/);
  assert.equal(replayed,false);
});

test('malformed existing raw logs fail and never become no-log infrastructure', t => {
  const {file,start,end} = fixture(t);
  for (const rows of [[start,start,end],[end,start],[start,end,{type:'call',i:1,name:'look',args:{}}],[start,{...end,toolCalls:9}]]) {
    fs.writeFileSync(file,rows.map(JSON.stringify).join('\n'));
    const result=verifyEpisode(file,{backend:'log-consistency'});
    assert.equal(result.ok,false);
    assert.equal(result.verdict,'invalid-log');
    assert.equal(result.evidenceLevel,'not-replayed');
  }
  fs.writeFileSync(file,'{');
  assert.equal(verifyEpisode(file).verdict,'invalid-log');
});

test('no-log launch failure is retained without engine replay certification', t => {
  const {file} = fixture(t);fs.unlinkSync(file);
  const result=verifyEpisode(file);
  assert.equal(result.verdict,'no-log');assert.equal(result.ok,true);
  assert.equal(result.evidenceLevel,'not-replayed');
  assert.equal(replayCertification(result),false);
});

test('only explicit successful engine replay can award formal certification', () => {
  assert.equal(replayCertification({ok:true,verdict:'verified',backend:'engine-replay',evidenceLevel:'engine-replay'}),true);
  for(const backend of [undefined,'unknown','log-consistency']) {
    assert.equal(replayCertification({ok:true,verdict:'verified',backend}),false);
  }
});

test('log consistency cannot overwrite cache even through directory verify API', t => {
  const {dir} = fixture(t);const cache='{"historical":true}';fs.writeFileSync(path.join(dir,'verify.json'),cache);
  const results=verify(dir,{backend:'log-consistency'});
  assert.equal(results[0].verdict,'consistent');
  assert.equal(fs.readFileSync(path.join(dir,'verify.json'),'utf8'),cache);
});

test('formal protocol metadata binds digest without changing legacy digest', () => {
  const meta={runId:'legacy',model:'test',tier:'B'};
  const keys=['runId','model','tier','hints','external','code','promptVersion','scoring','tasks','runtime','books','clientAccountingVersion'];
  const legacy=crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(keys.map(k=>[k,meta[k]??null])))).digest('hex');
  assert.equal(runDigest(meta),legacy);
  for (const key of ['protocol','protocols','formal']) assert.notEqual(runDigest({...meta,[key]:{version:1}}),legacy);
  assert.notEqual(runDigest({...meta,trial:{attempt:1}}),runDigest({...meta,trial:{attempt:2}}));
});

test('unknown verification backend cannot upgrade self-consistent raw evidence', t => {
  const {file} = fixture(t);
  const result=verifyEpisode(file,{backend:'unknown',replay:readLog});
  assert.equal(result.ok,false);assert.equal(result.evidenceLevel,'not-replayed');
  assert.match(result.diffs.join(' '),/unknown verification backend/);
});

test('new formal protocol changes invalidate episode versus run binding', t => {
  const {file,start,end}=fixture(t);
  const protocol={version:1,budget:{toolCalls:10}};
  fs.writeFileSync(file,[{...start,protocol},end].map(JSON.stringify).join('\n'));
  const result=verifyEpisode(file,{backend:'log-consistency',runMeta:{protocols:[{task:start.task,contract:{...protocol,budget:{toolCalls:20}}}]}});
  assert.equal(result.ok,false);assert.match(result.diffs.join(' '),/protocol/);
});

test('historical logs may replay with newly added optional provenance', () => {
  const start={type:'start',task:'legacy'};
  const end={type:'end',success:false,endReason:'agent-stopped'};
  const orig={start,calls:[],end};
  const replay={...orig,start:{...start,protocol:{version:1},fingerprint:{task:'new hash'},initial:{scene:1},setup:[]}};
  assert.deepEqual(compareLogs(orig,replay),[]);
});

test('replay restores allowlisted frozen overrides and clears ambient/recovery state', () => {
  const env=replayEnvironment({overrides:{BENCH_STRIP_CHEESE:'1',PAL_ASSET_DIR:'untrusted',UNKNOWN:'ignored'}},{PAL_ASSET_DIR:'/reviewer/assets',BENCH_BUDGET_TOOL_CALLS:'999',BENCH_STRIP_CHEESE:'0',BENCH_RESUME_FROM:'old',BENCH_REPLAY_PREFIX:'old',KEEP:'yes'});
  assert.equal(env.BENCH_STRIP_CHEESE,'1');assert.equal(env.BENCH_BUDGET_TOOL_CALLS,undefined);
  assert.equal(env.BENCH_RESUME_FROM,undefined);assert.equal(env.BENCH_REPLAY_PREFIX,undefined);
  assert.equal(env.PAL_ASSET_DIR,'/reviewer/assets');assert.equal(env.UNKNOWN,undefined);assert.equal(env.KEEP,'yes');
});

test('cached board evidence preserves legacy unknown and identifies explicit engine provenance', t => {
  const {dir,file}=fixture(t);
  const row={file:path.basename(file),digest:episodeDigest(file),ok:true,verdict:'verified'};
  const write=(extra,episode=row)=>fs.writeFileSync(path.join(dir,'verify.json'),JSON.stringify({...extra,episodes:[episode]}));
  write({});
  assert.equal(verifyStatus(dir).state,'verified');assert.equal(verifyStatus(dir).provenance,'legacy-unknown');
  write({backend:'engine-replay',evidenceLevel:'engine-replay'}, {...row,backend:'engine-replay',evidenceLevel:'engine-replay'});
  assert.equal(verifyStatus(dir).state,'verified');assert.equal(verifyStatus(dir).provenance,'engine-replay');
});

test('cached non-engine, contradictory, and no-log evidence never becomes board verified', t => {
  const {dir,file}=fixture(t);
  const row={file:path.basename(file),digest:episodeDigest(file),ok:true,verdict:'verified'};
  const fixtures=[
    {backend:'log-consistency',evidenceLevel:'log-consistency',episodes:[row]},
    {episodes:[{...row,backend:'unknown'}]},
    {backend:'engine-replay',episodes:[{...row,evidenceLevel:'not-replayed'}]},
    {evidenceLevel:'unknown',episodes:[{...row,backend:'engine-replay'}]},
    {episodes:[{...row,backend:'log-consistency',verdict:'consistent'}]},
    {backend:'engine-replay',evidenceLevel:'engine-replay',episodes:[{...row,verdict:'no-log'}]},
  ];
  for(const cache of fixtures) {
    fs.writeFileSync(path.join(dir,'verify.json'),JSON.stringify(cache));
    assert.notEqual(verifyStatus(dir).state,'verified');
    assert.equal(verifyStatus(dir).ok,0);
    if(cache.episodes[0].verdict === 'no-log') assert.equal(verifyStatus(dir).provenance,'not-replayed');
  }
});

test('incomplete built-in accounting verifies known prefix without converting unknown totals to zero', () => {
  const measuredUsage={tokensIn:1000,tokensOut:100,tokensCached:0,tokensCacheWrite:0,cost:costOf('openai:gpt-4o',{tokensIn:1000,tokensOut:100,cacheRead:0,cacheWrite:0}),turns:1};
  const end={type:'end',success:false,endReason:'provider-error',model:'openai:gpt-4o',external:false,accountingStatus:'incomplete',measuredUsage,turns:1,tokensIn:null,tokensOut:null,tokensCached:null,tokensCacheWrite:null,cost:null};
  const orig={start:{type:'start'},calls:[],turns:[{type:'turn',usage:{tokensIn:1000,tokensOut:100,cacheRead:0,cacheWrite:0}}],end};
  const replay={...orig,turns:[],end:{type:'end',success:false,endReason:'provider-error',model:'openai:gpt-4o'}};
  assert.deepEqual(compareLogs(orig,replay,{...end}),[]);
  for(const changed of [{accountingStatus:'complete'},{measuredUsage:{...measuredUsage,tokensIn:1}},{turns:2},{tokensIn:0}]) {
    assert.ok(compareLogs(orig,replay,{...end,...changed}).length>0,JSON.stringify(changed));
  }
  const short={...orig,end:{...end,measuredUsage:{...measuredUsage,tokensIn:1}}};
  assert.match(compareLogs(short,replay).join(' '),/measuredUsage.*tokensIn|tokensIn.*turn/);
});

test('incomplete built-in accounting keeps unknown price totals while checking measured cost', () => {
  const end={type:'end',model:'openai:gpt-5.4',success:false,endReason:'provider-error',accountingStatus:'incomplete',tokensIn:null,tokensOut:null,tokensCached:null,tokensCacheWrite:null,cost:null,measuredUsage:{tokensIn:10000,tokensOut:1000,tokensCached:0,tokensCacheWrite:0,cost:0.0001,turns:1}};
  const orig={start:{},calls:[],turns:[{usage:{tokensIn:10000,tokensOut:1000}}],end};
  assert.match(compareLogs(orig,orig).join(' '),/measuredUsage.*cost.*price table/);
});

test('a complete built-in accounting label cannot conceal unknown whole-trial tokens', () => {
  const end={type:'end',success:false,endReason:'provider-error',model:'openai:gpt-4o',accountingStatus:'complete',tokensIn:null,tokensOut:null,tokensCached:null,tokensCacheWrite:null,cost:null};
  const orig={start:{},calls:[],turns:[],end};
  assert.match(compareLogs(orig,orig).join(' '),/complete accounting.*tokensIn/);
});
