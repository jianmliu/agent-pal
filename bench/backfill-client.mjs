#!/usr/bin/env node
/** Backfill accounting from existing CLI output. Never invokes a model. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {finalizeClient,readClientFinalization} from './client-finalization.mjs';
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
export function backfillClient({logFile,backupDir}){
 logFile=path.resolve(logFile);backupDir=path.resolve(backupDir);
 if(!logFile.endsWith('.jsonl') || logFile.endsWith('.client.jsonl')) throw Error('expected an episode .jsonl file');
 if(backupDir===path.dirname(logFile)) throw Error('backup directory must differ from episode directory');
 const resultFile=logFile.replace(/\.jsonl$/,'.json');
 const existing=readClientFinalization(logFile);
 if(existing)return finalizeClient({logFile,resultFile,clientLogFile:path.join(path.dirname(logFile),existing.event.source.file),client:existing.event.client,timedOut:existing.event.timedOut});
 const old=JSON.parse(fs.readFileSync(resultFile));
 const colon=old.model.indexOf(':');const name=old.model.slice(0,colon),model=old.model.slice(colon+1);
 if(!['codex-cli','claude-cli','agy-cli'].includes(name))throw Error('backfill requires an external CLI model');
 const client={...(old.client||{}),name,model};
 const clientLogFile=logFile.replace(/\.jsonl$/,'.client.jsonl');
 const runDir=path.dirname(path.dirname(logFile));
 const files=[logFile,resultFile,clientLogFile,path.join(runDir,'run.json'),path.join(runDir,'verify.json')].filter(f=>fs.existsSync(f));
 fs.mkdirSync(backupDir,{recursive:true});const manifest={};
 for(const file of files){
  const bytes=fs.readFileSync(file),dest=path.join(backupDir,path.basename(file));
  if(fs.existsSync(dest)){if(!fs.readFileSync(dest).equals(bytes))throw Error(`refusing to replace original backup ${dest}`);}
  else fs.writeFileSync(dest,bytes,{flag:'wx'});
  manifest[path.basename(file)]={sha256:sha(bytes),bytes:bytes.length};
 }
 const manifestFile=path.join(backupDir,'manifest.json');
 if(!fs.existsSync(manifestFile))fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return finalizeClient({logFile,resultFile,clientLogFile,client,timedOut:old.endReason==='wall-timeout',migration:{kind:'existing-cli-log',backupDir,originals:manifest}});
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const logFile=process.argv[2],at=process.argv.indexOf('--backup-dir');
 if(!logFile || at<0 || !process.argv[at+1])throw Error('usage: node bench/backfill-client.mjs <episode.jsonl> --backup-dir <new-or-identical-archive>');
 const result=backfillClient({logFile,backupDir:process.argv[at+1]});console.log(JSON.stringify({task:result.task,accountingStatus:result.accountingStatus,tokensIn:result.tokensIn,tokensOut:result.tokensOut}));
}
