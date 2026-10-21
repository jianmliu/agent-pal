import assert from 'node:assert/strict';
import {createRngCursor,validateRngCursor,advanceRngWait,finishRngPrefix} from '../services/script-rng-cursor';
const sc={operation:0x37,operand:[0,2,17,0]};
const asset={format:'rng-video-sha256-v1' as const,byteLength:10,digest:'0x'+'1'.repeat(64)};
const front={pitch:320,width:320,height:200,byteLength:64000,digest:'0x'+'2'.repeat(64)};
const c=createRngCursor(3,sc,6,asset,front);
c.deadline+=c.delay;finishRngPrefix(c,0);assert.equal(c.requestedMs,1000/17);assert.equal(validateRngCursor(c,sc,3),true);
advanceRngWait(c,100);assert.equal(c.logicalNow,100);assert.equal(c.remainingMs,0);
c.frame++;c.phase='blit';c.deadline+=c.delay;finishRngPrefix(c,100);assert.equal(c.requestedMs,Math.max(0,2*(1000/17)-200));assert.equal(c.requestedMs,0);assert.equal(validateRngCursor(c,sc,3),true);
for(const patch of [{frame:3},{delay:1},{logicalNow:Infinity},{remainingMs:1},{phase:'bad'},{args:{}},{front:null},{asset:{...asset,digest:'bad'}}])assert.equal(validateRngCursor({...c,...patch} as any,sc,3),false);
const sparse=structuredClone(c);delete sparse.operands[1];(sparse.operands as any).extra=2;assert.equal(validateRngCursor(sparse,sc,3),false);
console.log('RNG cursor deadline, overshoot, zero wait and strict lattice passed');
const {validateDelayCheckpoint}=await import('../services/script-delay-checkpoint');
const cp={version:2,id:'rng',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'auto',currentPC:3,continuationPC:3,eventId:0,loopSafetyCounter:0,parentReturn:null,rng:c}],wait:{kind:'rng',...c}};
assert.equal(validateDelayCheckpoint(cp,pc=>pc===3?sc:{operation:0,operand:[0,0,0,0]}),null);
console.log('RNG checkpoint ownership passed');
for(const frac of [.01,.37,.91]){const p=createRngCursor(3,sc,6,asset,front);p.deadline+=p.delay;finishRngPrefix(p,.123);advanceRngWait(p,p.remainingMs*frac);assert.equal(validateRngCursor(p,sc,3),true,'fractional partial timer must remain valid');}
const forged=structuredClone(c);forged.deadline+=1000;forged.requestedMs=Math.max(0,forged.deadline-forged.sleepStart);forged.remainingMs=Math.max(0,forged.requestedMs-forged.waitElapsed);assert.equal(validateRngCursor(forged,sc,3),false,'deadline must belong to frame recurrence');
const pending=createRngCursor(3,sc,6,asset,front);pending.deadline+=pending.delay;pending.phase='fade';pending.args={family:'in',time:1,paletteId:0,night:false};assert.equal(validateRngCursor(pending,sc,3),true);assert.equal(validateRngCursor({...pending,logicalNow:1},sc,3),false,'child owns elapsed, parent carries no stale fade debt');
