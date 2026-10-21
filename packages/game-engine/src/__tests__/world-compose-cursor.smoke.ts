import assert from 'node:assert/strict';
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
import {createTimedFadeCursor,paintTimedFade} from '../services/script-timed-fade-cursor';
const args={family:'in' as const,time:1,paletteId:0,night:false};
const tf=createTimedFadeCursor(args,Array.from({length:256},()=>({r:0,g:0,b:0})),40,1);paintTimedFade(tf,40,1);
const read=()=>({operation:9,operand:[1,1,0]});
for(const site of ['entry-compose','proximity-compose']) {
 const selection=site==='entry-compose'?{site,sceneId:1,eventId:65535,eventIndex:null}:{site,sceneId:1,eventId:2,eventIndex:1,lease:{id:'lease',generation:1,owner:'root'}};
 const u={sceneId:1,phase:site,eventIds:site==='entry-compose'?[]:[2],index:0,viewport:0,partyOffset:0,pendingReturn:null,composition:selection};
 const compose={source:site==='entry-compose'?'world-entry':'world-proximity',opcodePC:4,operation:9,operands:[1,1,0],phase:'fade',renderPrefixDone:true,args};
 const cp:any={version:2,id:'root',revision:0,registers:{scriptSuccess:false,curEquipPart:3},frames:[{kind:'trigger',currentPC:4,continuationPC:4,eventId:1,loopSafetyCounter:1,frameWait:{opcodePC:4,nextPC:5,frameCount:1,trigger:true,gestures:false,frameIndex:0,phase:'world',remainingMs:0,worldUpdate:u},compose,parentReturn:{kind:'world-compose-fade',opcodePC:4,nextPC:5,args,selection}},{kind:'fade',currentPC:0,continuationPC:0,eventId:0,loopSafetyCounter:0,parentReturn:null,fadeArgs:args,timedFade:tf}],wait:{kind:'timed-fade',...tf}};
 assert.equal(validateDelayCheckpoint(cp,read),null,site);
 if(site==='proximity-compose') {
  const bad=structuredClone(cp),ids=bad.frames[0].frameWait.worldUpdate.eventIds;
  ids.push(3);delete ids[1];ids.extra=3;
  assert.ok(validateDelayCheckpoint(bad,read),'compensated sparse proximity IDs must reject before JSON copying');
 }
 for(const mutate of [(x:any)=>x.frames[0].frameWait.trigger=false,(x:any)=>x.frames[0].frameWait.phase='compose',(x:any)=>delete x.frames[0].frameWait.worldUpdate.composition,(x:any)=>x.frames[0].frameWait.worldUpdate.sceneId=2,(x:any)=>x.frames[0].parentReturn.selection.site='wrong',(x:any)=>delete x.frames[0].compose.operands[1],(x:any)=>x.frames[0].frameWait.worldUpdate.pendingReturn={},...(site==='proximity-compose'?[(x:any)=>delete x.frames[0].frameWait.worldUpdate.composition.lease,(x:any)=>x.frames[0].frameWait.worldUpdate.composition.eventIndex=-1]:[])]){const x=structuredClone(cp);mutate(x);assert.ok(validateDelayCheckpoint(x,read));}
}
console.log('world-compose-cursor: two sites and malformed parent/source policy passed');
