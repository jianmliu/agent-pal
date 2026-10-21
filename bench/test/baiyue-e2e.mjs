/** Requires DOS assets. Exercises the public CLI, never calls a paid provider. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {loadTask,loadReference} from '../task.mjs';import {readLog,verifyEpisode} from '../verify.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));const bench=path.resolve(here,'..');const cli=path.join(bench,'bench.mjs');
const ids=['origin','mana-budget','sustain-no-wine','fragile-stocked'].map(x=>'baiyue-single-'+x);
if(process.argv[2]==='--negative'){
 process.env.AGENT_PAL_SAVES=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'baiyue-negative-')),'saves.json');
 const {createEpisode}=await import('../episode.mjs');const task=loadTask(ids[0]);const ep=await createEpisode({task,seed:42});const initial=ep.view();
 assert.equal(initial.scene,281);assert.equal(initial.inBattle,true);assert.equal(initial.party.length,3);assert.equal(ep.result.toolCalls,0);assert.equal(ep.result.virtualSeconds,0);
 assert.deepEqual(ep.tools.map(x=>x.name).sort(),['observe','battle','advance','wait'].sort());
 const schema=ep.tools.find(x=>x.name==='battle').inputSchema.properties.action.enum;assert.ok(!schema.includes('auto')&&!schema.includes('flee'));
 for(const [name,args]of [['battle',{action:'auto'}],['battle',{action:'flee'}],['battle',{action:'magic',name:'金蟬'}],['battle',{action:'magic',referenceID:392}],['battle',{action:'magic',name:'酒神',referenceID:392}],['load',{slot:1}]]){const result=await ep.call(name,args);assert.equal(result.isError,true);assert.equal(ep.result.success,false);assert.equal(ep.done,false);assert.deepEqual(ep.view(),initial);}
 const ref=loadReference(ids[0]);for(const [name,args]of ref.bySeed['42'])await ep.call(name,args);
 const result=ep.finish();assert.equal(result.success,true);assert.equal(result.invalidCalls,6);assert.equal(result.battleRounds,ref.rounds['42']);
 process.stdout.write('negative restrictions rejected without advancing; legal reference still won\n');process.exit(0);
}
const out=process.argv[2]?path.resolve(process.argv[2]):path.join(bench,'out','baiyue-e2e-'+Date.now());fs.mkdirSync(out,{recursive:true});const logs=path.join(out,'checks');fs.mkdirSync(logs,{recursive:true});
function invoke(label,args){process.stdout.write(label+'...\n');const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:600000});fs.writeFileSync(path.join(logs,label+'.log'),r.stdout+'\n'+r.stderr);assert.equal(r.status,0,`${label}: ${r.stderr}\n${r.stdout}`);process.stdout.write(r.stdout);}
invoke('validate',['validate']);invoke('check',['check',...ids,'--jobs','4']);
invoke('run',['run','--model','replay:auto','--tasks',ids.join(','),'--jobs','4','--out',out]);
invoke('score',['score',out]);const summary=JSON.parse(fs.readFileSync(path.join(out,'summary.json')));assert.equal(summary.complete,true);assert.equal(summary.scoring,'battleRounds');assert.equal(summary.score,1);assert.equal(summary.episodes,12);
for(const t of summary.tasks){const ref=loadReference(t.id);for(const ep of t.episodes){assert.equal(ep.success,true);assert.equal(ep.invalidCalls,0);assert.equal(ep.battleRounds,ref.rounds[String(ep.seed)]);assert.equal(ep.toolCalls,ref.par[String(ep.seed)]);}}
invoke('verify',['verify',out]);const verified=JSON.parse(fs.readFileSync(path.join(out,'verify.json')));assert.equal(verified.episodes.length,12);assert.ok(verified.episodes.every(x=>x.verdict==='verified'));
invoke('board',['board',out,'--out',path.join(out,'board.html')]);const html=fs.readFileSync(path.join(out,'board.html'),'utf8');assert.ok(html.includes('成功率→战斗回合')&&html.includes('成功局平均回合')&&html.includes('已核验'));
const file=path.join(out,'episodes',ids[0]+'__s42.jsonl');const json=file.replace(/jsonl$/,'json');const bytes=fs.readFileSync(json);const result=JSON.parse(bytes);const original=readLog(file);
try{fs.writeFileSync(json,JSON.stringify({...result,battleRounds:result.battleRounds+1}));const verdict=verifyEpisode(file,{replay:()=>original});assert.equal(verdict.verdict,'mismatch');assert.ok(verdict.diffs.some(x=>x.includes('battleRounds')));}finally{fs.writeFileSync(json,bytes);}
const {verifyStatus}=await import('../board.mjs');const runFile=path.join(out,'run.json'),metaBytes=fs.readFileSync(runFile),meta=JSON.parse(metaBytes);
try{fs.writeFileSync(runFile,JSON.stringify({...meta,scoring:'cost'}));assert.equal(verifyStatus(out).state,'stale');const policy=verifyEpisode(file,{runMeta:{...meta,scoring:'cost'},replay:()=>original});assert.equal(policy.verdict,'unverifiable');fs.writeFileSync(runFile,JSON.stringify({...meta,runtime:undefined,scoring:'cost'}));assert.equal(verifyStatus(out).state,'stale');const removed=verifyEpisode(file,{runMeta:{...meta,runtime:undefined},replay:()=>original});assert.equal(removed.verdict,'unverifiable');}finally{fs.writeFileSync(runFile,metaBytes);}
const missingSave=verifyEpisode(file,{currentTaskFingerprint:()=>{throw new Error('missing starting save');},replay:()=>original});assert.equal(missingSave.verdict,'unverifiable');
const runtime=verifyEpisode(file,{runMeta:{...meta,runtime:{altered:true}},currentRuntime:{actual:true},replay:()=>original});assert.equal(runtime.verdict,'unverifiable');
const negative=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--negative'],{encoding:'utf8',timeout:120000});fs.writeFileSync(path.join(logs,'negative.log'),negative.stdout+'\n'+negative.stderr);assert.equal(negative.status,0,negative.stderr);process.stdout.write(negative.stdout);
fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify({passed:true,episodes:12,verified:12,scoring:summary.scoring,roundsMeanOnSuccess:summary.battleRoundsMeanOnSuccess,checks:['validate','check','run','score','verify','board','round-tamper','runtime-tamper','auto/flee/spell/load restrictions','setup excluded from model calls and virtual budget']},null,2));
process.stdout.write('Baiyue full CLI acceptance passed: '+out+'\n');
