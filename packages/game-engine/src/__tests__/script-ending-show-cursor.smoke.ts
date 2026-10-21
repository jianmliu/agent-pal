import assert from 'node:assert/strict';
import {createEndingShowCursor,validateEndingShowCursor} from '../services/script-ending-show-cursor';
const sc={operation:0x76,operand:[1,1,0,0]},c=createEndingShowCursor(7,sc,new Uint8Array(5),new Uint8Array(64000),false);
Object.assign(c,{step:0,requestedMs:20,remainingMs:20,frontDigest:'0x'+'1'.repeat(64),backupDigest:'0x'+'2'.repeat(64),bitmapDigest:'0x'+'3'.repeat(64),targetDigest:'0x'+'4'.repeat(64),lease:{id:'x',generation:1,owner:'y'}});
assert.equal(validateEndingShowCursor(c,sc,7),true);
for(const mutate of [(q:any)=>delete q.bitmap[1],(q:any)=>{delete q.target[4];q.target.extra=0;},(q:any)=>q.step=96,(q:any)=>q.remainingMs=21,(q:any)=>q.operands[0]=2,(q:any)=>q.phase='final']){const q=structuredClone(c);mutate(q);assert.equal(validateEndingShowCursor(q,sc,7),false);}
console.log('script-ending-show-cursor smoke passed');
