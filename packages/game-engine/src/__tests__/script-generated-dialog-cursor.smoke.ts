import assert from 'node:assert/strict';
const module = await import('../services/script-generated-dialog-cursor').catch(()=>null);
assert.equal(typeof module?.createGeneratedDialogCursor,'function','generated dialog has an explicit serializable source cursor');
const {createGeneratedDialogCursor,validateGeneratedDialogCursor,advanceGeneratedDialogPoll}=module!;
const sc={operation:0x34,operand:[81,0,0,0]};
const c=createGeneratedDialogCursor(80,sc,'auto',1,'classic',{id:'generated-1',generation:1,owner:'root-1'});
assert.ok(validateGeneratedDialogCursor(c,sc,80,'auto',1));
Object.assign(c,{phase:'poll-sleep',site:'generated',collectBound:100,sample:50,cap:9,index:8,itemId:61,word42:[65,0,66],wordItem:[67],raw:[65,0,66,64,67,64],poll:1,gameSpeed:1,requestedMs:100,remainingMs:100,hasBox:true,rect:{x:130,y:30,w:92,h:64}});
assert.ok(validateGeneratedDialogCursor(c,sc,80,'auto',1));
advanceGeneratedDialogPoll(c,99);assert.equal(c.remainingMs,1);assert.equal(c.elapsedMs,99);assert.equal(c.phase,'poll-sleep');
advanceGeneratedDialogPoll(c,1);assert.equal(c.remainingMs,0);assert.equal(c.elapsedMs,100);assert.equal(c.phase,'poll-check');
assert.ok(validateGeneratedDialogCursor(c,sc,80,'auto',1));
for(const change of [(x:any)=>x.cap=8,(x:any)=>x.index=7,(x:any)=>x.sample=101,(x:any)=>x.raw.pop(),(x:any)=>x.operands.length=5,(x:any)=>x.extra=true,(x:any)=>x.elapsedMs=-1]){
 const bad=JSON.parse(JSON.stringify(c));change(bad);assert.equal(validateGeneratedDialogCursor(bad,sc,80,'auto',1),false);
}
const over=JSON.parse(JSON.stringify(c));Object.assign(over,{phase:'poll-sleep',remainingMs:100});advanceGeneratedDialogPoll(over,2000);assert.equal(over.elapsedMs,2100);assert.equal(over.remainingMs,0);assert.equal(over.phase,'poll-check');
assert.ok(validateGeneratedDialogCursor(over,sc,80,'auto',1));
console.log('script-generated-dialog-cursor: passed');
const {validateDelayCheckpoint}=await import('../services/script-delay-checkpoint');
const {generatedDialogWait}=module!;
const source=JSON.parse(JSON.stringify(c));Object.assign(source,{phase:'poll-sleep',requestedMs:100,remainingMs:100});
const frame={kind:'auto',currentPC:80,continuationPC:80,eventId:1,loopSafetyCounter:0,parentReturn:null,generatedDialog:source};
const cp={version:2,id:'root-1',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[frame],wait:generatedDialogWait(source)};
assert.equal(validateDelayCheckpoint(cp,()=>sc),null,'generated auto leaf has narrow source-paired dual poll wait');
const bad=JSON.parse(JSON.stringify(cp));bad.frames[0].rng={};assert.ok(validateDelayCheckpoint(bad,()=>sc));
const mismatch=JSON.parse(JSON.stringify(cp));mismatch.wait.poll++;assert.ok(validateDelayCheckpoint(mismatch,()=>sc));
const wrongInterval=JSON.parse(JSON.stringify(source));wrongInterval.requestedMs=101;
assert.equal(validateGeneratedDialogCursor(wrongInterval,sc,80,'auto',1),false,'poll request is bound to its actual live speed sample');
