import assert from 'node:assert/strict';
import {validateWorldUpdateCursor} from '../services/world-update-cursor';
import {validateDelayCheckpoint,normalizeCheckpointWait,copyDelayCheckpoint} from '../services/script-delay-checkpoint';
const frameWait={opcodePC:10,nextPC:11,frameCount:1,trigger:true,gestures:false,frameIndex:0,phase:'sleep',remainingMs:16};
const checkpoint={version:2,id:'frame',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'trigger',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:1,parentReturn:null,frameWait}],wait:{kind:'frame',...frameWait}};
const read=(pc:number)=>({operation:pc===10?9:0,operand:[0,1,0]});
assert.equal(validateDelayCheckpoint(checkpoint,read),null);
assert.ok(validateDelayCheckpoint({...checkpoint,wait:{...checkpoint.wait,remainingMs:17}},read));
assert.ok(validateDelayCheckpoint({...checkpoint,wait:{...checkpoint.wait,frameCount:0}},read));
assert.ok(validateDelayCheckpoint({...checkpoint,wait:{...checkpoint.wait,phase:'unknown'}},read));
console.log('world-update-cursor smoke ok');
const delayLeaf={...checkpoint.frames[0],currentPC:20,continuationPC:20,frameWait:undefined};
const worldUpdate={sceneId:1,phase:'auto-return',eventIds:[2],index:0,viewport:-65536,partyOffset:0,pendingReturn:{field:'autoScript',eventId:2,entry:20,kind:'auto'}};
const owner={...checkpoint.frames[0],frameWait:{...frameWait,phase:'world',remainingMs:0,worldUpdate},parentReturn:{kind:'world-update',opcodePC:10,nextPC:11,childEntry:20,childEventId:2,childKind:'auto',field:'autoScript',sceneId:1,eventId:2,nextPhase:'auto-return'}};
const nested={...checkpoint,frames:[owner,{...delayLeaf,kind:'auto',eventId:2}],wait:{kind:'delay',opcodePC:20,nextPC:21,requestedMs:80,remainingMs:80}};
const nestedRead=(pc:number)=>pc===20?{operation:0x85,operand:[1,0,0]}:read(pc);
assert.equal(validateDelayCheckpoint(nested,nestedRead),null);
for (const change of [{childKind:'trigger'},{field:'triggerScript'},{eventId:3},{nextPhase:'auto'},{childEntry:21},{sceneId:2}]) assert.ok(validateDelayCheckpoint({...nested,frames:[{...owner,parentReturn:{...owner.parentReturn,...change}},nested.frames[1]]},nestedRead));
assert.ok(validateDelayCheckpoint({...nested,frames:[{...owner,frameWait:{...owner.frameWait,worldUpdate:{...worldUpdate,index:1}}},nested.frames[1]]},nestedRead));
assert.ok(validateDelayCheckpoint({...checkpoint,version:1,delay:{opcodePC:10,nextPC:11,requestedMs:0,remainingMs:0}},read));
assert.ok(validateDelayCheckpoint({...nested,wait:{...nested.wait,kind:'bogus'}},nestedRead));
assert.ok(validateDelayCheckpoint({...checkpoint,wait:{...checkpoint.wait,worldUpdate}},read));
console.log('world-update-cursor nested validation smoke ok');

for (const change of [{eventIds:[2,2]},{eventIds:[0]},{eventIds:[65536]},{viewport:1.5},{partyOffset:2147483648},{phase:'bogus'},{pendingReturn:null}]) {
  assert.ok(validateDelayCheckpoint({...nested,frames:[{...owner,frameWait:{...owner.frameWait,worldUpdate:{...worldUpdate,...change}}},nested.frames[1]]},nestedRead));
}

const legacy={version:1,id:'legacy',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{...delayLeaf,eventId:1}],delay:{opcodePC:20,nextPC:21,requestedMs:80,remainingMs:80}} as const;
const normalized=normalizeCheckpointWait(legacy as any);
assert.deepEqual(normalized,{kind:'delay',...legacy.delay});
assert.equal('kind' in legacy.delay,false);
const detached=copyDelayCheckpoint(nested as any);
detached.frames[0].frameWait!.worldUpdate!.eventIds[0]=3;
assert.equal(worldUpdate.eventIds[0],2);
console.log('world-update-cursor normalization/detachment smoke ok');
// Coordinated changes to both parent and child must not override the world's
// independently saved invocation kind and event identity.
assert.ok(validateDelayCheckpoint({...nested,frames:[{...owner,parentReturn:{...owner.parentReturn,childKind:'trigger'}},{...nested.frames[1],kind:'trigger'}]},nestedRead));
assert.ok(validateDelayCheckpoint({...nested,frames:[{...owner,parentReturn:{...owner.parentReturn,childEventId:3}},{...nested.frames[1],eventId:3}]},nestedRead));

const sparseIds:any=[2,3];delete sparseIds[1];sparseIds.extra=3;
assert.ok(validateDelayCheckpoint({...nested,frames:[{...owner,frameWait:{...owner.frameWait,worldUpdate:{...worldUpdate,eventIds:sparseIds}}},nested.frames[1]]},nestedRead),'compensated sparse script-return IDs must reject');

for(const field of ['scriptOnEnter','triggerScript','autoScript'] as const) {
 const u:any={...worldUpdate,eventIds:[2,3],phase:field==='scriptOnEnter'?'entry-return':field==='triggerScript'?'proximity-return':'auto-return',pendingReturn:{field,eventId:field==='scriptOnEnter'?0xffff:2,entry:20,kind:field==='autoScript'?'auto':'trigger'}};
 assert.equal(validateWorldUpdateCursor(u,nestedRead),true,field);
 delete u.eventIds[1];u.eventIds.extra=3;
 assert.equal(validateWorldUpdateCursor(u,nestedRead),false,`${field} compensated sparse IDs reject`);
}
