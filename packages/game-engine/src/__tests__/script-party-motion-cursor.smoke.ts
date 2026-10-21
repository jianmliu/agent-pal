import {orderWorldCursorEntries} from '../services/world-update-cursor';
import assert from 'node:assert/strict';
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
import {motionFamily,motionSpeed,validatePartyMotionCursor} from '../services/script-party-motion-cursor';
let checks=0;
for(const operation of [0x70,0x7a,0x7b,0x3f,0x44,0x97,0x7f]) {
 const sc={operation,operand:[1,2,0]},family=motionFamily(operation)!;
 const motion={opcodePC:10,nextPC:11,operation,operands:[1,2,0],eventId:1,family,speed:motionSpeed(operation),targetX:family==='viewport'?-128:32,targetY:family==='viewport'?-80:32,viewport:0,partyOffset:0,offsetX:32,offsetY:32,lastPartyIndex:family==='viewport'?2:0,iteration:0,phase:'sleep',remainingMs:16} as const;
 const cp={version:2,id:'motion',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'auto',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:0,parentReturn:null,motion}],wait:{kind:'party-motion',...motion}};
 const read=(pc:number)=>pc===10?sc:{operation:0,operand:[0,0,0]};
 assert.equal(validatePartyMotionCursor(motion as any,sc,10,1),true);assert.equal(validateDelayCheckpoint(cp,read),null);checks+=2;
 for(const change of [{speed:99},{targetX:0},{targetY:0},{viewport:2147483648},{partyOffset:-2147483649},{offsetX:1.5},{iteration:-1},{phase:'move'},{remainingMs:17},{family:'npc'},{operands:[0,0,0]},{worldUpdate:{}},{worldUpdate:null}]){assert.ok(validateDelayCheckpoint({...cp,frames:[{...cp.frames[0],motion:{...motion,...change}}],wait:{...cp.wait,...change}},read));checks++;}
 if(family==='walk'){assert.ok(validateDelayCheckpoint({...cp,frames:[{...cp.frames[0],motion:{...motion,offsetX:31}}],wait:{...cp.wait,offsetX:31}},read));checks++;}
 const reverse=(x:any):any=>Array.isArray(x)?x.map(reverse):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reverse(x[k])])):x;
 assert.equal(validateDelayCheckpoint(reverse(cp),read),null);checks++;
}


const delay={version:2,id:'present',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'trigger',currentPC:20,continuationPC:20,eventId:1,loopSafetyCounter:0,parentReturn:null}],wait:{kind:'delay',opcodePC:20,nextPC:21,requestedMs:80,remainingMs:80}};
for(const key of ['motion','npcMotion','frameWait','poisonCursor','partyEquipmentCursor','equipmentCursor','shopCursor','dialogAction'])assert.ok(validateDelayCheckpoint({...delay,frames:[{...delay.frames[0],[key]:null}]},()=>({operation:0x85,operand:[1,0,0]})),key);



const pendingWorld={sceneId:1,phase:'auto-return',eventIds:[1],index:0,viewport:0,partyOffset:0,pendingReturn:{field:'autoScript',eventId:1,entry:20,kind:'auto'}} as const;
assert.ok(orderWorldCursorEntries([],pendingWorld as any,()=>null)[0]?.state,'Missing world object must not skip a pending child');
assert.ok(orderWorldCursorEntries([{id:1,index:0,state:null}],pendingWorld as any,()=>null)[0]?.state);

const forbiddenMotion={opcodePC:10,nextPC:11,operation:0x70,operands:[1,2,0],eventId:1,family:'walk',speed:2,targetX:32,targetY:32,viewport:0,partyOffset:0,offsetX:32,offsetY:32,lastPartyIndex:0,iteration:0,phase:'world',remainingMs:0,worldUpdate:{sceneId:1,phase:'proximity-return',eventIds:[1],index:0,viewport:0,partyOffset:0,pendingReturn:{field:'triggerScript',eventId:1,entry:20,kind:'trigger'}}};
const forbiddenLink={kind:'world-update',opcodePC:10,nextPC:11,childEntry:20,childEventId:1,childKind:'trigger',field:'triggerScript',sceneId:1,eventId:1,nextPhase:'proximity-return'};
const falseWorld={version:2,id:'false-world',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'auto',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:0,parentReturn:forbiddenLink,motion:forbiddenMotion},delay.frames[0]],wait:delay.wait};
assert.ok(validateDelayCheckpoint(falseWorld,pc=>pc===10?{operation:0x70,operand:[1,2,0]}:{operation:0x85,operand:[1,0,0]}),'Motion world update(false) cannot create a proximity child');

const forbiddenFrame={...falseWorld,frames:[{...falseWorld.frames[0],kind:'trigger',motion:undefined,frameWait:{opcodePC:10,nextPC:11,frameCount:1,trigger:false,gestures:false,frameIndex:0,phase:'world',remainingMs:0,worldUpdate:forbiddenMotion.worldUpdate}},delay.frames[0]]};
assert.ok(validateDelayCheckpoint(forbiddenFrame,pc=>pc===10?{operation:9,operand:[1,0,0]}:{operation:0x85,operand:[1,0,0]}),'Frame world update(false) cannot create a proximity child');


for(const [cp,operation] of [[falseWorld,0x70],[forbiddenFrame,9]] as const) {
 const entry=structuredClone(cp) as any,owner=entry.frames[0],u=owner.motion?.worldUpdate || owner.frameWait.worldUpdate;
 Object.assign(u,{phase:'entry-return',eventIds:[],index:0,pendingReturn:{field:'scriptOnEnter',eventId:0xffff,entry:20,kind:'trigger'}});
 Object.assign(owner.parentReturn,{field:'scriptOnEnter',eventId:0xffff,nextPhase:'entry-return'});
 assert.ok(validateDelayCheckpoint(entry,pc=>pc===10?{operation,operand:operation===9?[1,0,0]:[1,2,0]}:{operation:0x85,operand:[1,0,0]}),'False owner cannot create a scene-entry child');
 if(operation===9){owner.frameWait.trigger=true;assert.equal(validateDelayCheckpoint(entry,pc=>pc===10?{operation:9,operand:[1,1,0]}:{operation:0x85,operand:[1,0,0]}),null);}
}
console.log(`script-party-motion-cursor: ${checks+15} checks passed`);
