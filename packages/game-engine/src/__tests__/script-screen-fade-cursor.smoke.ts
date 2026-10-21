import assert from 'node:assert/strict';
import {createScreenFadeSource,validateScreenFadeSource,denseScreenBytes} from '../services/script-screen-fade-cursor';
const sc={operation:0x73,operand:[0,0,0,0]},c=createScreenFadeSource(5,sc,null),digest='0x'+'a'.repeat(64);
assert.ok(validateScreenFadeSource(c,sc,5));
c.phase='screen';c.screen={target:Array(64000).fill(15),substep:0,nominalMs:4,requestedMs:4,remainingMs:4,frontDigest:digest,backupDigest:digest,targetDigest:digest,width:320,height:200,pitch:320,lease:{id:'a',generation:1,owner:'b'}};
assert.ok(validateScreenFadeSource(c,sc,5));
for(const mutate of [(q:any)=>q.screen.substep=72,(q:any)=>q.screen.nominalMs=8,(q:any)=>q.screen.remainingMs=5,(q:any)=>q.screen.lease.extra=true,(q:any)=>q.phase='compose',(q:any)=>q.operands[0]=65536,(q:any)=>{delete q.screen.target[5];q.screen.target.extra=0;},(q:any)=>{delete q.operands[1];q.operands.extra=0;}]){const q=JSON.parse(JSON.stringify(c));mutate(q);assert.equal(validateScreenFadeSource(q,sc,5),false);}
assert.equal(denseScreenBytes(new Uint8Array(64000)),false);
console.log('script-screen-fade-cursor: passed');
