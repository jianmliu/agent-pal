import assert from 'node:assert/strict';
import {EndingScrollReferenceLeases} from '../services/ending-scroll-reference-leases';
import {endingShowDigest} from '../services/ending-show-reference-leases';
import {createEndingScrollCursor} from '../services/script-ending-scroll-cursor';
import Surface from '../js/pal/surface';
(globalThis as any).Direction={South:0};
const front=new Uint8Array(64000),backup=new Uint8Array(64000),rgba=new Uint8ClampedArray(256000),bitmap=new Uint8Array(17),target=new Uint8Array(64000),noop=()=>{},palette=Array.from({length:256},()=>({r:0,g:0,b:0}));
const s:any={byteBuffer:front,backup,ctx:{getImageData:()=>({data:rgba}),putImageData:noop},getPalette:()=>palette,updateScreen:noop,getRect:noop,putRect:noop,blit:noop,blitSurface:noop,blitRLE:noop,backupScreen:noop,setPalette:noop};
const reader={decompressChunk:()=>bitmap},scene={service:{},surface:s,apply:noop,adapterApply:noop,getIndex:noop,index:31},b={surface:s,screen:front,reader,decompress:reader.decompressChunk,initGeneration:1,resourceGeneration:1,begin:noop,step:noop,finish:noop,scene};
const entry={bitmap,p:target,rect:{},dstrect:{},debugFBP:false},c=createEndingScrollCursor(1,{operation:0xa4,operand:[1,0,1]},entry);c.bitmapDigest=endingShowDigest(bitmap);c.targetDigest=endingShowDigest(target);
const scope=new EndingScrollReferenceLeases();c.lease=scope.acquire('owner',c,b,entry);const cp:any={id:'owner',revision:0,frames:[{endingScroll:c}],wait:{kind:'ending-scroll',remainingMs:800}};scope.publish(c.lease,cp,b);
assert.ok(scope.resolve(c.lease,'owner',c,b,s));assert.ok(scope.matches(c.lease,cp,b));
for(const change of [(q:any)=>q.revision++,(q:any)=>q.frames[0].endingScroll.frameIndex++,(q:any)=>q.wait.remainingMs--]){const q=structuredClone(cp);change(q);assert.equal(scope.matches(c.lease,q,b),false);}
front[0]=1;assert.equal(scope.matches(c.lease,cp,b),false);front[0]=0;backup[0]=1;assert.equal(scope.matches(c.lease,cp,b),false);backup[0]=0;rgba[0]=1;assert.equal(scope.matches(c.lease,cp,b),false);rgba[0]=0;palette[0].r=1;assert.equal(scope.matches(c.lease,cp,b),false);palette[0].r=0;Surface.shakeTime=1;assert.equal(scope.matches(c.lease,cp,b),false);Surface.shakeTime=0;
assert.equal(scope.resolve(c.lease,'owner',c,{...b,resourceGeneration:2},s),null);assert.equal(scope.resolve(c.lease,'owner',c,{...b,scene:{...scene,adapterApply:()=>{}}},s),null);
// Legitimate child evolution replaces current physical paint only after accepted execution.
front[0]=7;rgba[0]=8;cp.revision++;cp.frames.push({timedFade:{elapsedMs:100}});scope.publish(c.lease,cp,b);assert.ok(scope.matches(c.lease,cp,b));scope.consume(c.lease);assert.equal(scope.matches(c.lease,cp,b),false);scope.transfer('owner','next');c.lease.owner='next';assert.ok(scope.resolve(c.lease,'next',c,b,s));scope.clear();assert.equal(scope.resolve(c.lease,'next',c,b,s),null);
console.log('ending-scroll-reference-leases smoke passed');
