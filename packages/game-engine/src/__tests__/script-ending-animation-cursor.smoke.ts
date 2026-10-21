import assert from 'node:assert/strict';
import {createEndingAnimationCursor,validateEndingAnimationCursor} from '../services/script-ending-animation-cursor';
const sc={operation:0x96,operand:[0,0,0,0]},c=createEndingAnimationCursor(7,sc,{upper:new Uint8Array(64000),lower:new Uint8Array(64000)});
Object.assign(c,{girlPos:180,requestedMs:50,remainingMs:50,upperDigest:'0x'+'1'.repeat(64),lowerDigest:'0x'+'2'.repeat(64),lease:{id:'x',generation:1,owner:'y'}});
assert.ok(validateEndingAnimationCursor(c,sc,7));
for(const change of [(q:any)=>q.girlPos=179,(q:any)=>q.frameIndex=400,(q:any)=>q.remainingMs=51,(q:any)=>delete q.upper[1],(q:any)=>q.operands[1]=1,(q:any)=>q.args={family:'in',time:1,paletteId:0,night:false},(q:any)=>q.lease.extra=true]){const q=structuredClone(c);change(q);assert.equal(validateEndingAnimationCursor(q,sc,7),false);}
const fade=structuredClone(c);Object.assign(fade,{phase:'fade',requestedMs:0,remainingMs:0,args:{family:'in',time:1,paletteId:0,night:false}});assert.ok(validateEndingAnimationCursor(fade,sc,7));fade.args.time=2;assert.equal(validateEndingAnimationCursor(fade,sc,7),false);
for(const frameIndex of [1,198,199,200,398,399]){const q=structuredClone(c);q.frameIndex=frameIndex;q.girlPos=Math.max(80,180-Math.floor((frameIndex+1)/2));assert.ok(validateEndingAnimationCursor(q,sc,7));q.girlPos++;assert.equal(validateEndingAnimationCursor(q,sc,7),false);}
console.log('script-ending-animation-cursor smoke passed');
