#!/usr/bin/env node
/** Release inspection and complete accounting only. This entrypoint cannot run inference. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditResources} from './resource-contract.mjs';
import {validateCampaign,campaignReport,readEvidenceRecords} from './release-ledger.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), command=args.shift();
const flag=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`missing value for ${name}`);return args[i+1];};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const emit=value=>{
  const text=JSON.stringify(value,null,2)+'\n', out=flag('--out',null);
  if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,text,{flag:'wx'});}
  process.stdout.write(text);
};
try {
  if(command==='preflight'){
    const profile=json(flag('--resources',path.join(root,'bench/releases/ed-v1/resources.json')));
    const resources=auditResources({assetsDir:flag('--assets',undefined),expected:profile});
    const gates={...profile.gates};
    emit({technicalReady:resources.ok,releaseReady:resources.ok&&Object.keys(gates).length>0&&Object.values(gates).every(x=>x===true),
      inferenceEnabled:false,gates,resources,note:'Local resource hashes do not establish rights, independent access, build acceptance or inference authorization.'});
    process.exitCode=resources.ok?0:1;
  }else if(command==='validate-campaign'){
    const c=json(args[0]),errors=validateCampaign(c);
    emit({valid:errors.length===0,releaseId:c.releaseId,inferenceEnabled:c.inferenceEnabled,planned:c.trials?.length??0,errors});process.exitCode=errors.length?1:0;
  }else if(command==='report'){
    const file=path.resolve(args[0]),c=json(file),ledger=flag('--ledger',path.join(path.dirname(file),'trials.jsonl'));
    const report=campaignReport(c,readEvidenceRecords(ledger,path.dirname(file),{campaign:c}));
    emit(report);process.exitCode=report.publishable?0:1;
  }else{
    process.stderr.write('Unsupported command. No inference is available. Use release.mjs preflight [--assets dir] | validate-campaign campaign.json | report campaign.json [--ledger file] [--out file]\n');
    process.exitCode=2;
  }
}catch(error){process.stderr.write(`release: ${error.message}\n`);process.exitCode=1;}
