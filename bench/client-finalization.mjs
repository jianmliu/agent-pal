/** Append-only external-client accounting. Game end events remain immutable. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { costOf } from './providers.mjs';
export const ACCOUNTING_FIELDS = ['tokensIn','tokensOut','tokensCached','tokensCacheWrite','cost','accountingStatus'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const count = n => Number.isSafeInteger(n) && n >= 0;
const unknown = status => ({tokensIn:null,tokensOut:null,tokensCached:null,tokensCacheWrite:null,cost:null,accountingStatus:status});
export function parseClientUsage(text, name, model, { timedOut = false } = {}) {
 if (timedOut) return unknown('incomplete');
 const events=[];
 for(const line of text.split('\n')) {try {events.push(JSON.parse(line));}catch { /* CLI may emit non-JSON diagnostics. */ }}
 if(name==='codex-cli'){
  if(events.some(e=>e.type==='turn.failed' || e.type==='error')) return unknown('incomplete');
  const turns=events.filter(e=>e.type==='turn.completed');
  if(!turns.length) return unknown('unknown');
  const sum={tokensIn:0,tokensOut:0,tokensCached:0,tokensCacheWrite:0};
  for(const e of turns){const u=e.usage;
   if(!u || !count(u.input_tokens) || !count(u.output_tokens) || !count(u.cached_input_tokens??0) || (u.cached_input_tokens??0)>u.input_tokens) return unknown('incomplete');
   sum.tokensIn+=u.input_tokens;sum.tokensOut+=u.output_tokens;sum.tokensCached+=u.cached_input_tokens??0;
  }
  if(!Object.values(sum).every(count)) return unknown('incomplete');
  return {...sum,cost:costOf(`openai:${model}`,{...sum,cacheRead:sum.tokensCached}),accountingStatus:'complete'};
 }
 if(name==='claude-cli'){
  const results=events.filter(e=>e.type==='result');
  if(results.length!==1) return unknown(results.length?'incomplete':'unknown');
  const r=results[0],u=r.usage;
  if(!u || !count(u.input_tokens) || !count(u.output_tokens) || !count(u.cache_read_input_tokens??0) || !count(u.cache_creation_input_tokens??0)) return unknown('incomplete');
  return {tokensIn:u.input_tokens+(u.cache_read_input_tokens??0)+(u.cache_creation_input_tokens??0),tokensOut:u.output_tokens,tokensCached:u.cache_read_input_tokens??0,tokensCacheWrite:u.cache_creation_input_tokens??0,cost:typeof r.total_cost_usd==='number'&&Number.isFinite(r.total_cost_usd)&&r.total_cost_usd>=0?r.total_cost_usd:null,accountingStatus:'complete'};
 }
 if(name==='agy-cli'){
  const results=events.filter(e=>e.event==='result' && e.result);
  if(results.length>1) return unknown('incomplete');
  const stepUsages=events.filter(e=>e.event==='step_update' && e.step_update?.state==='DONE' && e.step_update?.step_type==='agent_response' && e.step_update?.usage).map(e=>e.step_update.usage);
  const u=results.length===1 ? results[0].result.usage : stepUsages.length ? stepUsages.reduce((acc,s)=>({
   input_tokens:(acc.input_tokens??0)+(s.input_tokens??0),
   output_tokens:(acc.output_tokens??0)+(s.output_tokens??0),
   thinking_tokens:(acc.thinking_tokens??0)+(s.thinking_tokens??0),
   cache_read_tokens:(acc.cache_read_tokens??0)+(s.cache_read_tokens??0)
  }),{input_tokens:0,output_tokens:0,thinking_tokens:0,cache_read_tokens:0}) : null;
  if(!u || !count(u.input_tokens) || !count(u.output_tokens) || !count(u.thinking_tokens??0) || !count(u.cache_read_tokens??0)) return unknown(events.length?'incomplete':'unknown');
  const tokensCached=u.cache_read_tokens??0;
  const tokensIn=u.input_tokens+tokensCached;
  const tokensOut=u.output_tokens+(u.thinking_tokens??0);
  const baseModel=String(model).replace(/-(low|medium|high|xhigh|max)$/,'');
  return {tokensIn,tokensOut,tokensCached,tokensCacheWrite:0,cost:costOf(`gemini:${baseModel}`,{tokensIn,tokensOut,cacheRead:tokensCached,cacheWrite:0}),accountingStatus:results.length===1?'complete':'partial'};
 }
 return unknown('unknown');
}
function splitLog(logFile){
 const bytes=fs.readFileSync(logFile),lines=bytes.toString('utf8').split('\n');
 const events=lines.filter(Boolean).map(l=>JSON.parse(l));
 const ends=events.filter(e=>e.type==='end');
 if(ends.length!==1) throw Error('client finalization requires exactly one server end');
 return {bytes,events,end:ends[0]};
}
function project(end,event){
 const {type,...base}=end;
 return {...base,external:true,client:event.client,...event.accounting};
}
export function readClientFinalization(logFile){
 const text=fs.readFileSync(logFile,'utf8');
 if(!text.split('\n').filter(Boolean).some(l=>JSON.parse(l).type==='client_finalized')) return null;
 const parsed=splitLog(logFile);const receipts=parsed.events.filter(e=>e.type==='client_finalized');
 if(!receipts.length)return null;
 if(receipts.length!==1 || parsed.events.at(-1)!==receipts[0])throw Error('duplicate or non-terminal client_finalized event');
 const ev=receipts[0];
 if(ev.version!==1 || typeof ev.timedOut!=='boolean' || !ev.client || !ev.accounting || !ev.source)throw Error('invalid client finalization schema');
 if(parsed.end.model!==`${ev.client.name}:${ev.client.model}`)throw Error('client model identity differs from game end');
 const offset=parsed.bytes.lastIndexOf(Buffer.from(JSON.stringify(ev)));
 if(offset<0 || sha(parsed.bytes.subarray(0,offset))!==ev.prefixSha256)throw Error('original log prefix hash mismatch');
 if(path.basename(ev.source.file)!==ev.source.file)throw Error('client source must be a sibling file');
 const source=fs.readFileSync(path.join(path.dirname(logFile),ev.source.file));
 if(sha(source)!==ev.source.sha256 || source.length!==ev.source.bytes)throw Error('client source hash mismatch');
 const usage=parseClientUsage(source.toString('utf8'),ev.client.name,ev.client.model,{timedOut:ev.timedOut});
 for(const key of ACCOUNTING_FIELDS)if(usage[key]!==ev.accounting[key])throw Error(`client accounting ${key} differs from source`);
 return {event:ev,result:project(parsed.end,ev)};
}
function atomicJSON(file,value){
 const tmp=`${file}.${crypto.randomUUID()}.tmp`;
 try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}
}
export function finalizeClient({logFile,resultFile,clientLogFile,client,timedOut=false,migration=null}){
 const existing=readClientFinalization(logFile);
 if(existing){
  if(existing.event.client.name!==client.name || existing.event.client.model!==client.model || existing.event.timedOut!==timedOut)throw Error('conflicting client finalization');
  atomicJSON(resultFile,existing.result);return existing.result;
 }
 const {bytes,end}=splitLog(logFile);
 if(!bytes.toString('utf8').endsWith('\n'))throw Error('server log must end with newline before finalization');
 if(end.model!==`${client.name}:${client.model}`)throw Error('client model identity differs from game end');
 if(path.dirname(path.resolve(logFile))!==path.dirname(path.resolve(clientLogFile)))throw Error('client source must be a sibling file');
 const source=fs.readFileSync(clientLogFile);
 const event={type:'client_finalized',version:1,at:new Date().toISOString(),client,timedOut,prefixSha256:sha(bytes),source:{file:path.basename(clientLogFile),sha256:sha(source),bytes:source.length},accounting:parseClientUsage(source.toString('utf8'),client.name,client.model,{timedOut}),...(migration?{migration}:{})};
 fs.appendFileSync(logFile,JSON.stringify(event)+'\n');
 const result=project(end,event);atomicJSON(resultFile,result);return result;
}
