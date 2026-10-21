import assert from 'node:assert/strict';
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
const read=(pc:number)=>({operation:pc===10?3:pc===20?6:pc===30?0x85:0,operand:pc===10?[20,2,0]:pc===20?[50,30,0]:pc===30?[1,0,0]:[0,0,0]});
const frame=(pc:number)=>({kind:'auto',currentPC:pc,continuationPC:pc,eventId:1,loopSafetyCounter:0,parentReturn:null as any});
const tail=(pc:number,child:number)=>({...frame(pc),parentReturn:{kind:'auto-tail',opcodePC:pc,nextPC:pc+1,childEntry:child,childEventId:1}});
const c={version:2,id:'tail',revision:0,registers:{scriptSuccess:false,curEquipPart:-1},frames:[tail(10,20),tail(20,30),frame(30)],wait:{kind:'delay',opcodePC:30,nextPC:31,requestedMs:80,remainingMs:80}};
assert.equal(validateDelayCheckpoint(c,read),null);
for(const mutate of [ (x:any)=>x.frames[0].kind='trigger', (x:any)=>x.frames[1].kind='trigger', (x:any)=>x.frames[0].parentReturn.childEntry=30, (x:any)=>x.frames[0].parentReturn.nextPC=20, (x:any)=>x.frames[0].parentReturn.childEventId=2, (x:any)=>x.frames[0].frameWait={}, (x:any)=>x.frames[0].continuationPC=20, (x:any)=>x.frames[1].eventId=2, (x:any)=>x.version=1 ]) {
 const bad=structuredClone(c);mutate(bad);assert.ok(validateDelayCheckpoint(bad,read));
}
assert.ok(validateDelayCheckpoint(c,pc=>pc===20?{operation:6,operand:[50,0,0]}:read(pc)));
const missingTail=structuredClone(c);missingTail.frames.splice(1,1);
assert.ok(validateDelayCheckpoint(missingTail,read));
// A world-update owner can suspend beneath multiple automatic tail calls.
const world={sceneId:1,phase:'auto-return',eventIds:[1],index:0,viewport:0,partyOffset:0,pendingReturn:{field:'autoScript',eventId:1,entry:10,kind:'auto'}};
const owner={kind:'trigger',currentPC:5,continuationPC:5,eventId:1,loopSafetyCounter:0,frameWait:{opcodePC:5,nextPC:6,frameCount:1,trigger:true,gestures:false,frameIndex:0,phase:'world',remainingMs:0,worldUpdate:world},parentReturn:{kind:'world-update',opcodePC:5,nextPC:6,childEntry:10,childEventId:1,childKind:'auto',field:'autoScript',sceneId:1,eventId:1,nextPhase:'auto-return'}};
assert.equal(validateDelayCheckpoint({...c,frames:[owner,...c.frames]},pc=>pc===5?{operation:9,operand:[1,1,0]}:read(pc)),null);
const missingWorldTail={...c,frames:[owner,...c.frames.slice(1)]};
assert.ok(validateDelayCheckpoint(missingWorldTail,pc=>pc===5?{operation:9,operand:[1,1,0]}:read(pc)));
console.log('script-auto-tail-checkpoint smoke ok');
