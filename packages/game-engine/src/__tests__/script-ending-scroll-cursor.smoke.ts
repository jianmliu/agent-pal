import assert from 'node:assert/strict';
import {createEndingScrollCursor,validateEndingScrollCursor} from '../services/script-ending-scroll-cursor';
const sc={operation:0xa4,operand:[0x44,0,0,0]},c=createEndingScrollCursor(7,sc,{bitmap:new Uint8Array(17),p:new Uint8Array(64000),debugFBP:false});
Object.assign(c,{requestedMs:800,remainingMs:800,bitmapDigest:'0x'+'1'.repeat(64),targetDigest:'0x'+'2'.repeat(64),lease:{id:'x',generation:1,owner:'y'}});
assert.ok(validateEndingScrollCursor(c,sc,7));
for(const change of [(q:any)=>q.speed=0,(q:any)=>q.down=false,(q:any)=>q.specialPrefixDone=false,(q:any)=>q.frameIndex=220,(q:any)=>q.remainingMs=801,(q:any)=>delete q.target[1],(q:any)=>delete q.bitmap[1],(q:any)=>q.operands[1]=1,(q:any)=>q.args={family:'in',time:1,paletteId:0,night:false},(q:any)=>q.lease.extra=true]){const q=structuredClone(c);change(q);assert.equal(validateEndingScrollCursor(q,sc,7),false);}
const fade=structuredClone(c);Object.assign(fade,{phase:'fade',requestedMs:0,remainingMs:0,args:{family:'in',time:1,paletteId:0,night:false}});assert.ok(validateEndingScrollCursor(fade,sc,7));fade.args.time=2;assert.equal(validateEndingScrollCursor(fade,sc,7),false);
console.log('script-ending-scroll-cursor smoke passed');
