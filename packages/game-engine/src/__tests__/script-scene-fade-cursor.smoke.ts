import assert from 'node:assert/strict';
import * as fade from '../services/script-scene-fade-cursor';
const base=Array.from({length:256},(_,i)=>({r:i,g:255-i,b:i%23}));
for(const raw of [0,1,2,63,64,32767,32768,65535]) {
 const sc={operation:0x93,operand:[raw,0,0,0]};
 const c=fade.createSceneFadeCursor(3,sc,0,false,base);
 assert.equal(c.step,(raw<<16>>16)||1);
 while(c.level>=0&&c.level<64){c.phase='sleep';c.remainingMs=100;assert.equal(fade.validateSceneFadeCursor(c,sc,3),true);c.iteration++;c.level+=c.step;c.phase='clear';c.remainingMs=0;}
}
const sc={operation:0x93,operand:[2,0,0,0]},c=fade.createSceneFadeCursor(3,sc,0,false,base);c.phase='sleep';c.remainingMs=100;
for(const patch of [{level:1},{step:0},{iteration:1},{remainingMs:101},{phase:'nope'}])assert.equal(fade.validateSceneFadeCursor({...c,...patch} as any,sc,3),false);
const sparse=structuredClone(c);delete sparse.asset[79];(sparse.asset as any).extra={r:1,g:2,b:3};assert.equal(fade.validateSceneFadeCursor(sparse,sc,3),false);
console.log('scene-fade cursor lattice and dense source validation passed');
const {validateDelayCheckpoint}=await import('../services/script-delay-checkpoint');
const {validateFadeOpcodeCursor}=await import('../services/script-timed-fade-cursor');
const cp={version:2,id:'scene-fade',revision:0,registers:{scriptSuccess:false,curEquipPart:4},frames:[{kind:'auto',currentPC:3,continuationPC:3,eventId:0,loopSafetyCounter:0,parentReturn:null,sceneFade:c}],wait:{kind:'scene-fade',...c}};
const read=(pc:number)=>pc===3?sc:{operation:0,operand:[0,0,0,0]};
assert.equal(validateDelayCheckpoint(cp,read),null);
const reverse=(v:any):any=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reverse(v[k])])):v;
assert.equal(validateDelayCheckpoint(reverse(cp),read),null);
for(const field of ['sceneFade','compose','fadeSource','palette','frameWait','timedFade','motion','redraw','npcMotion','dialogAction','poisonCursor','equipmentCursor','partyEquipmentCursor','shopCursor'])for(const malformed of [null,false,[]]){const bad=structuredClone(cp) as any;bad.frames[0][field]=malformed;assert.ok(validateDelayCheckpoint(bad,read),field);}
const reload={opcodePC:3,nextPC:0,operation:0x4e,operands:[0,0,0,0],phase:'child' as const,args:{family:'out' as const,time:1},needFade:false};
assert.equal(validateFadeOpcodeCursor(reload,{operation:0x4e,operand:[0,0,0,0]},3),true);
for(const patch of [{nextPC:4},{needFade:true},{args:{family:'in',time:1,paletteId:0,night:false}},{args:{family:'out',time:2}}])assert.equal(validateFadeOpcodeCursor({...reload,...patch} as any,{operation:0x4e,operand:[0,0,0,0]},3),false);
console.log('scene-fade checkpoint all-present validation and reload typed return passed');
