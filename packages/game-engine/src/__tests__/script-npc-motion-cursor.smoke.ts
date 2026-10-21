import assert from 'node:assert/strict';
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
const ops=[0x10,0x11,0x6c,0x7c,0x82];
let checks=0;
for(const operation of ops) {
 const operands=[1,2,3,0];const read=(pc:number)=>({operation:pc===10?operation:0,operand:pc===10?operands:[0,0,0,0]});
 const cursor={opcodePC:10,operation,operands,eventId:1,targetId:1,targetPresent:true,movementCompleted:operation===0x6c,returnPC:operation===0x6c?11:10,nextPC:11,phase:'sleep',remainingMs:16};
 const cp:any={version:2,id:'npc',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'auto',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:0,parentReturn:null,npcMotion:cursor}],wait:{kind:'npc-motion',...cursor}};
 assert.equal(validateDelayCheckpoint(cp,read),null);checks++;
 const reordered=structuredClone(cp);reordered.wait=Object.fromEntries(Object.entries(reordered.wait).reverse());assert.equal(validateDelayCheckpoint(reordered,read),null);checks++;
 for(const mutate of [(c:any)=>c.frames[0].npcMotion.returnPC=12,(c:any)=>c.frames[0].npcMotion.phase='compose',(c:any)=>c.frames[0].npcMotion.remainingMs=17,(c:any)=>c.wait.remainingMs=8,(c:any)=>c.frames[0].npcMotion.operands[1]++,(c:any)=>c.frames[0].npcMotion.eventId=2,(c:any)=>c.frames[0].shopCursor={},(c:any)=>c.frames[0].dialogAction={},(c:any)=>c.frames[0].npcMotion.targetId=65536]) {
  const bad=structuredClone(cp);mutate(bad);assert.ok(validateDelayCheckpoint(bad,read));checks++;
 }
 for(const kind of ['delay','input','dialog-time','frame','menu']) {const bad=structuredClone(cp);bad.wait.kind=kind;assert.ok(validateDelayCheckpoint(bad,read));checks++;}
 const bad=structuredClone(cp);bad.frames.unshift({...structuredClone(cp.frames[0]),parentReturn:{opcodePC:10,nextPC:11,childEntry:10,childEventId:1}});assert.ok(validateDelayCheckpoint(bad,read));checks++;
}
// Inject motion into otherwise valid waits: ownership rejection must precede early returns.
import {createInputWait} from '../services/script-input-wait';
import {createDialogContext,beginDialogLine,advanceDialogLine} from '../services/script-dialog-progress';
const frame={kind:'trigger',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:1,parentReturn:null};
const base={version:2,id:'other',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[frame]};
const codec={bytes:(v:any)=>Uint8Array.from(v),decode:()=>'',publish:()=>''};
const dialog=createDialogContext('classic');beginDialogLine(dialog,10,[65],codec,[1,0,0,0]);const glyph=advanceDialogLine(dialog,codec);
const fixtures:any[]=[
 {operation:0x85,operands:[1,0,0,0],cp:{...base,wait:{kind:'delay',opcodePC:10,nextPC:11,requestedMs:80,remainingMs:80}}},
 {operation:0x4d,operands:[0,0,0,0],cp:{...base,wait:createInputWait(10,{operation:0x4d,operand:[0,0,0,0]})}},
 {operation:0xffff,operands:[1,0,0,0],cp:{...base,wait:glyph,dialog}},
 {operation:9,operands:[1,0,0,0],cp:{...base,frames:[{...frame,frameWait:{opcodePC:10,nextPC:11,frameCount:1,trigger:false,gestures:false,frameIndex:0,phase:'sleep',remainingMs:16}}],wait:{kind:'frame',opcodePC:10,nextPC:11,frameCount:1,trigger:false,gestures:false,frameIndex:0,phase:'sleep',remainingMs:16}}}
];
for(const fixture of fixtures){
 const read=(pc:number)=>({operation:pc===10?fixture.operation:0,operand:pc===10?fixture.operands:[0,0,0,0]});
 assert.equal(validateDelayCheckpoint(fixture.cp,read),null);const bad=structuredClone(fixture.cp);bad.frames[0].npcMotion={};assert.match(validateDelayCheckpoint(bad,read)!,/NPC motion/);checks++;
}
const legacy:any={...structuredClone(fixtures[0].cp),version:1,delay:fixtures[0].cp.wait};delete legacy.wait;delete legacy.delay.kind;
assert.equal(validateDelayCheckpoint(legacy,(pc:number)=>({operation:pc===10?0x85:0,operand:[1,0,0,0]})),null);legacy.frames[0].npcMotion={};assert.match(validateDelayCheckpoint(legacy,()=>({operation:0x85,operand:[1,0,0,0]}))!,/NPC motion/);checks++;
console.log(`NPC motion checkpoint: ${checks} checks passed`);
