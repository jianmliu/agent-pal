import assert from 'node:assert/strict';
const compose=await import('../services/script-compose-cursor');
const sc={operation:9,operand:[1,0,0]};
const c=compose.createComposeCursor('frame',4,sc,{family:'in',time:1,paletteId:2,night:false});
assert.deepEqual(c,{source:'frame',opcodePC:4,operation:9,operands:[1,0,0],phase:'fade',renderPrefixDone:true,args:{family:'in',time:1,paletteId:2,night:false}});
const {createTimedFadeCursor,paintTimedFade}=await import('../services/script-timed-fade-cursor');
const {validateDelayCheckpoint}=await import('../services/script-delay-checkpoint');
const tf=createTimedFadeCursor(c.args,Array.from({length:256},(_,i)=>({r:i,g:i,b:i})),40,1);paintTimedFade(tf,40,1);
const frameWait={opcodePC:4,nextPC:5,frameCount:1,trigger:false,gestures:false,frameIndex:0,phase:'compose',remainingMs:0};
const cp={version:2,id:'compose',revision:0,registers:{scriptSuccess:false,curEquipPart:3},frames:[{kind:'trigger',currentPC:4,continuationPC:4,eventId:1,loopSafetyCounter:1,frameWait,compose:c,parentReturn:{kind:'compose-fade',opcodePC:4,nextPC:5,args:c.args}},{kind:'fade',currentPC:0,continuationPC:0,eventId:0,loopSafetyCounter:0,parentReturn:null,fadeArgs:c.args,timedFade:tf}],wait:{kind:'timed-fade',...tf}};
const read=(pc:number)=>{assert.notEqual(pc,0);return sc;};
assert.equal(validateDelayCheckpoint(cp,read),null);
for(const mutate of [(x:any)=>delete x.frames[0].compose,(x:any)=>x.frames[0].compose.source='npc',(x:any)=>x.frames[0].frameWait.phase='screen',(x:any)=>x.frames[0].compose.args.night=true,(x:any)=>x.frames[1].kind='equipment',(x:any)=>x.frames[0].compose=null,(x:any)=>x.frames[0].compose.renderPrefixDone=false,(x:any)=>delete x.frames[0].frameWait]){const x=structuredClone(cp);mutate(x);assert.ok(validateDelayCheckpoint(x,read));}
console.log('script-compose-cursor: captured prefix, owner and real fade pairing passed');
// New prefix phases must never become standalone old-family wait leaves.
const npc={opcodePC:4,operation:0x6c,operands:[0,1,2],eventId:1,targetId:1,targetPresent:true,movementCompleted:true,returnPC:5,nextPC:5,phase:'compose',remainingMs:0};
const npcFrame={kind:'auto',currentPC:4,continuationPC:4,eventId:1,loopSafetyCounter:0,npcMotion:npc,parentReturn:null};
assert.ok(validateDelayCheckpoint({...cp,frames:[npcFrame],wait:{kind:'npc-motion',...npc}},()=>({operation:0x6c,operand:[0,1,2]})));
const shop={opcodePC:4,nextPC:5,operation:0x26,operands:[0,0,0],mode:'buy',phase:'initial',prepared:false,index:0,options:[],selected:null};
assert.ok(validateDelayCheckpoint({...cp,frames:[{...npcFrame,npcMotion:undefined,shopCursor:shop}],wait:{kind:'menu',action:'shop',opcodePC:4,nextPC:5,mode:'buy',index:0,options:[]}},()=>({operation:0x26,operand:[0,0,0]})));

const wrongChild=structuredClone(cp);wrongChild.frames[1].kind='trigger' as any;assert.ok(validateDelayCheckpoint(wrongChild,read));
