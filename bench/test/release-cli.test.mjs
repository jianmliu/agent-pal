import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeTrials} from '../release-ledger.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const call=(...args)=>spawnSync(process.execPath,[path.join(root,'bench/release.mjs'),...args],{encoding:'utf8'});
test('release entrypoint cannot start a model and reports an incomplete campaign without scores',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pal-release-cli-'));
  try {
    const c={schemaVersion:1,releaseId:'test',inferenceEnabled:false,conditions:['original'],models:['example'],repetitions:[1],tasks:[{id:'example',version:1,seeds:[42]}]};
    c.trials=makeTrials(c);const file=path.join(dir,'campaign.json');fs.writeFileSync(file,JSON.stringify(c));
    const validated=call('validate-campaign',file);assert.equal(validated.status,0,validated.stderr);assert.equal(JSON.parse(validated.stdout).inferenceEnabled,false);
    const report=call('report',file);assert.equal(report.status,1);assert.equal(JSON.parse(report.stdout).models[0].successRate,null);
    const run=call('run',file);assert.equal(run.status,2);assert.match(run.stderr,/no inference|unsupported command/i);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('preflight distinguishes local technical readiness from unresolved release rights/access',()=>{
  const r=call('preflight','--assets',path.join(os.tmpdir(),'pal-assets-do-not-exist'));
  assert.equal(r.status,1);const out=JSON.parse(r.stdout);
  assert.equal(out.technicalReady,false);assert.equal(out.releaseReady,false);assert.equal(out.inferenceEnabled,false);
});
