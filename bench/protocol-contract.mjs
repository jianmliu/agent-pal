/** Public, content-addressed protocol metadata and bounded process lifecycle. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {execFileSync} from 'node:child_process';
import {resolveExecutionConfig} from '../src/execution-config.mjs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { systemPrompt, firstMessage, PROMPT_VERSION } from './prompt.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export function effectiveBudget(task,{env=process.env,meta={}}={}) {
 const toolCalls=Number(env.BENCH_BUDGET_TOOL_CALLS)||meta.budgetToolCalls||task.budget.toolCalls;
 if(!Number.isFinite(toolCalls)||toolCalls<=0) throw Error('invalid tool call budget');
 const scale=toolCalls/task.budget.toolCalls;
 return {...task.budget,toolCalls,...(task.budget.tokens?{tokens:Math.round(task.budget.tokens*Math.max(scale,500))}:{}),...(task.budget.virtualSeconds?{virtualSeconds:Math.round(task.budget.virtualSeconds*Math.max(scale,20))}:{})};
}
export function lifecycleLimits({env=process.env,wallSeconds=1800}={}) {
 const positive=(key,fallback)=>{const n=env[key]===undefined?fallback:Number(env[key]);if(!Number.isFinite(n)||n<=0)throw Error(`invalid ${key}`);return n;};
 return {startupSeconds:positive('BENCH_STARTUP_SECONDS',120),wallSeconds:positive('BENCH_WALL_SECONDS',wallSeconds),drainSeconds:positive('BENCH_DRAIN_SECONDS',30),killSeconds:positive('BENCH_KILL_SECONDS',5)};
}
export const PROTOCOL_OVERRIDE_KEYS=['BENCH_BUDGET_TOOL_CALLS','BENCH_EFFORT','BENCH_STARTUP_SECONDS','BENCH_WALL_SECONDS','BENCH_DRAIN_SECONDS','BENCH_KILL_SECONDS','BENCH_STRIP_CHEESE','BENCH_MAX_OUTPUT_TOKENS','AGENT_PAL_CLOCK','AGENT_PAL_ADVANCE_POLICY','AGENT_PAL_PRESENTATION_PACE','AGENT_PAL_FLEE_GRACE','AGENT_PAL_SPEED'];
const forbidden=['BENCH_RESUME_FROM','BENCH_REPLAY_PREFIX','BENCH_REPLAY_NOTE'];
export function protocolContract({task,model,tier='B',hints='standard',env=process.env,meta={},runtime=null,adapterIdentity=null,promptIdentity=null,wallSeconds=1800,formal=false}) {
 if(formal && typeof formal==='object')for(const key of PROTOCOL_OVERRIDE_KEYS)if(env[key]!==undefined && String(formal.overrides?.[key])!==String(env[key]))throw Error(`formal undeclared override ${key}`);
 if(formal)for(const key of forbidden)if(env[key])throw Error(`formal fresh trial forbids ${key}`);
 const source=name=>hash(fs.readFileSync(path.join(here,name)));
 const cli=/^(claude|codex|agy)-cli:/.test(model);
 const contract={version:1,model,tier,hints,runtime,budget:effectiveBudget(task,{env,meta}),limits:lifecycleLimits({env,wallSeconds}),
  enforcement:{calls:'episode.call',tokens:cli?'client-at-exit-measurement-only':'episode.addUsage',virtualSeconds:'episode.call',wall:'runner-monotonic-post-ready'},
  prompt:{version:PROMPT_VERSION,sha256:promptIdentity||hash([systemPrompt(tier),firstMessage(task,'<initial-observation>'),source('prompt.mjs')])},
  toolSchema:{mcp:hash(fs.readFileSync(path.join(here,'../src/mcp.mjs'))),pure:hash(fs.readFileSync(path.join(here,'../src/pure.mjs'))),episode:source('episode.mjs'),restrictions:task.disallowTools||[],battlePolicy:task.battlePolicy||null},
  adapter:{version:1,name:cli?model.split(':')[0]:'builtin',identity:adapterIdentity,runner:source('runner.mjs'),providers:source('providers.mjs'),loop:source('loop.mjs')},
  execution:resolveExecutionConfig({seed:0},env),
  providerEndpoints:Object.fromEntries(['BENCH_OPENAI_BASE_URL','BENCH_ANTHROPIC_BASE_URL','BENCH_GEMINI_BASE_URL','BENCH_OLLAMA_BASE_URL','BENCH_CLAUDE_BASE_URL'].filter(k=>env[k]).map(k=>[k,{sha256:hash(env[k])}])),
  effort:env.BENCH_EFFORT||'medium',context:cli?'CLI-managed; fresh temporary cwd/session':'last-six-tool-observations; assistant history retained',
  overrides:Object.fromEntries(PROTOCOL_OVERRIDE_KEYS.filter(k=>env[k]!==undefined).map(k=>[k,env[k]])),freshSession:true,permissions:cli?'adapter flags and prompt restrictions; not certified isolation':'provider API loop'};
 return {...contract,hash:hash(contract)};
}
export function trialIdentity(formal,task,seed,model=formal.model) {
 const releaseId=formal.releaseId||formal.release;
 if(!releaseId||!formal.condition||!model&&!formal.scaffold)throw Error('formal trial requires releaseId, condition and model/scaffold');
 for(const k of ['repetition','attempt'])if(!Number.isInteger(formal[k])||formal[k]<1)throw Error(`invalid ${k}`);
 const identity={releaseId,condition:formal.condition,model:model||formal.scaffold,task,seed,repetition:formal.repetition,attempt:formal.attempt};
 return {...identity,id:hash(identity)};
}
export function assertFormalFresh(base) {
 for(const ext of ['.json','.jsonl','.client.jsonl','.stderr.log','.server.json','.harness.json','.claim'])if(fs.existsSync(base+ext))throw Error(`formal trial has existing evidence (${ext}); use a new attempt`);
}
export function cliIdentity(bin) {
 let file=bin;
 if(!path.isAbsolute(file)&&!file.includes(path.sep))file=(process.env.PATH||'').split(path.delimiter).map(d=>path.join(d,bin)).find(f=>fs.existsSync(f));
 if(!file||!fs.existsSync(file))return {sha256:null,unavailable:true};
 let version=null;try{const output=execFileSync(file,['--version'],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']});version=output.match(/\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.]+)?/)?.[0]??null;}catch{}
 return {sha256:hash(fs.readFileSync(fs.realpathSync(file))),version};
}
export function childExit(child) {return new Promise(resolve=>{if(child.exitCode!=null||child.signalCode!=null)return resolve(child.exitCode);child.once('exit',resolve);child.once('error',()=>resolve(null));});}
export async function terminateChild(child,{signal='SIGTERM',killMs=5000}={}) {
 if(child.exitCode!=null||child.signalCode!=null)return;
 const ended=childExit(child);child.kill(signal);
 let timer;await Promise.race([ended,new Promise(resolve=>{timer=setTimeout(resolve,killMs);})]);clearTimeout(timer);
 if(child.exitCode==null&&child.signalCode==null){child.kill('SIGKILL');await Promise.race([ended,new Promise(resolve=>{timer=setTimeout(resolve,killMs);})]);clearTimeout(timer);}
}
export async function waitForReady(child,{startupMs=120000,killMs=5000,ipc=false}={}) {
 const t=performance.now();let timer,rl;
 try{return await new Promise((resolve,reject)=>{
  const fail=reason=>reject(Error(reason));
  if(ipc)child.once('message',message=>{if(message?.type==='episode-ready')resolve({startupMs:performance.now()-t});else fail('startup-invalid-ready');});
  else { rl=readline.createInterface({input:child.stdout});
  rl.once('line',line=>{try{const ready=JSON.parse(line);if(!ready.url)throw Error();resolve({...ready,startupMs:performance.now()-t});}catch{fail('startup-invalid-ready');}}); }
  child.once('exit',()=>fail('startup-exit'));child.once('error',()=>fail('startup-error'));
  timer=setTimeout(()=>fail('startup-timeout'),startupMs);
 });}catch(error){await terminateChild(child,{killMs});throw error;}finally{clearTimeout(timer);rl?.close();}
}
export async function monitorClient(child,{wallMs=1800000,drainMs=30000,killMs=5000,pollMs=100,terminal=()=>false,onWall=()=>{}}={}) {
 const t=performance.now();let wall,poll,drain;let cause='client-exit',terminalAt=null;
 const spawnError=()=>{cause='client-spawn-error';};
 child.once('error',spawnError);
 const stop=async why=>{cause=why;if(why==='wall-timeout')await onWall();await terminateChild(child,{killMs});};
 const bounded=new Promise(resolve=>{
  wall=setTimeout(()=>{stop('wall-timeout').then(resolve);},wallMs);
  poll=setInterval(()=>{if(terminal()&&terminalAt===null){terminalAt=performance.now();clearInterval(poll);drain=setTimeout(()=>{stop('terminal-drain-timeout').then(resolve);},drainMs);}},pollMs);
 });
 await Promise.race([childExit(child),bounded]);clearTimeout(wall);clearInterval(poll);clearTimeout(drain);child.removeListener('error',spawnError);
 if(cause==='client-exit' && child.exitCode!=null && child.exitCode!==0)cause='client-error';
 return {cause,modelMs:performance.now()-t,terminalAtMs:terminalAt===null?null:terminalAt-t,drainMs:terminalAt===null?null:performance.now()-terminalAt};
}
export async function boundedStreamEnd(stream,ms=5000) {let timer;await Promise.race([new Promise(resolve=>{stream.once('finish',resolve);stream.once('close',resolve);stream.once('error',resolve);stream.end?.();}),new Promise(resolve=>{timer=setTimeout(()=>{stream.destroy?.();resolve();},ms);})]);clearTimeout(timer);}

export async function boundedReadable(stream,ms=5000) {
 if(stream.readableEnded||stream.destroyed)return;
 let timer;await Promise.race([new Promise(resolve=>{stream.once('end',resolve);stream.once('close',resolve);stream.once('error',resolve);}),new Promise(resolve=>{timer=setTimeout(()=>{stream.destroy();resolve();},ms);})]);clearTimeout(timer);
}

export const episodeBasename = (task,seed) => `${task}__s${seed}`;
