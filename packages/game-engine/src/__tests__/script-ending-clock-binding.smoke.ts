import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const mode=process.argv[2];
if(!mode){
 for(const branch of ['process','date']){const child=spawnSync(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),branch],{encoding:'utf8'});assert.equal(child.status,0,child.stdout+child.stderr);process.stdout.write(child.stdout);}
}else{
 if(mode==='date')(globalThis as any).window={};
 const common=await import('../js/pal/common');assert.equal(common.getHrtimeBinding().kind,mode);assert.ok(Object.isFrozen(common.getHrtimeBinding()));
 const {createEndingClock}=await import('../services/script-ending-clock');
 const runner=(await import('../services/script-runner')).default;
 runner.setEndingClock(createEndingClock({origin:0,workCounter:()=>{throw new Error('unsupported binding must not read work counter');}}));
 const outcome=await runner.runTriggerUntilWait(0,0);assert.equal(outcome.status,'unsupported');assert.match(outcome.reason,/browser-performance/);assert.equal(runner.getExecutionSnapshot().activeFrames.length,0);
 assert.equal(Number.isFinite(common.hrtime()),true);console.log(`${mode} module binding: owned admission rejected; original native hrtime remains finite`);
}
