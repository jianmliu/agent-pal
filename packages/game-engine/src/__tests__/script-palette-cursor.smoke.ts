import assert from 'node:assert/strict';
import {clonePalette,redPaletteStep,blendPaletteStep,colorPaletteStep} from '../services/script-palette-cursor';
const palette=Array.from({length:256},(_,i)=>({r:i,g:255-i,b:127}));
const red=clonePalette(palette);redPaletteStep(palette,red);
assert.deepEqual(red[0],{r:8,g:247,b:119});assert.deepEqual(red[79],palette[79]);assert.deepEqual(palette[0],{r:0,g:255,b:127});
assert.deepEqual(blendPaletteStep(palette,Array.from({length:256},()=>({r:255,g:0,b:254})),0),palette);
assert.deepEqual(blendPaletteStep(palette,Array.from({length:256},()=>({r:255,g:0,b:254})),31)[0],{r:255,g:0,b:254});
const color=Array.from({length:256},()=>({r:1,g:254,b:0})),working=Array.from({length:256},()=>({r:0,g:255,b:1}));
colorPaletteStep(color,working,0,false);assert.deepEqual(working[0],{r:4,g:251,b:-3});
colorPaletteStep(color,working,0,false);assert.deepEqual(working[0],{r:0,g:255,b:1});
console.log('script-palette-cursor: native formulas passed');
const {validatePaletteCursor}=await import('../services/script-palette-cursor');
const sc={operation:0x80,operand:[1,0,0,0]},cursor={opcodePC:10,nextPC:11,operation:0x80,operands:[1,0,0,0],family:'blend',initialized:true,step:0,phase:'sleep',remainingMs:5,requestedMs:5,frameTime:40,gameSpeed:2,paletteId:0,night:true,color:0,from:false,delay:5,updateScene:false,original:clonePalette(palette),target:clonePalette(palette),working:clonePalette(palette),final:null};
assert.equal(validatePaletteCursor(cursor as any,sc,10),true);
for(const change of [{step:32},{phase:'world'},{family:'red'},{initialized:false},{remainingMs:6},{requestedMs:6},{target:null},{original:[{r:0,g:0,b:0}]},{working:Array.from({length:256},()=>({r:NaN,g:0,b:0}))},{worldUpdate:null},{updateScene:true},{color:1},{from:true}])assert.equal(validatePaletteCursor({...cursor,...change} as any,sc,10),false,JSON.stringify(change));
console.log('script-palette-cursor: source and cursor validation passed');
const {validateDelayCheckpoint}=await import('../services/script-delay-checkpoint');
const cp={version:2,id:'palette',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'trigger',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:1,parentReturn:null,palette:cursor}],wait:{kind:'palette',...cursor}};
const read=(pc:number)=>pc===10?sc:{operation:0,operand:[0,0,0,0]};
assert.equal(validateDelayCheckpoint(cp,read),null);
const reverse=(x:any):any=>Array.isArray(x)?x.map(reverse):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reverse(x[k])])):x;
assert.equal(validateDelayCheckpoint(reverse(cp),read),null);
for(const key of ['palette','motion','npcMotion','redraw','frameWait','dialogAction'])for(const present of [null,false,[]]){const bad=structuredClone(cp) as any;bad.frames[0][key]=present;assert.ok(validateDelayCheckpoint(bad,read));}
const missing=structuredClone(cp) as any;delete missing.frames[0].palette;assert.ok(validateDelayCheckpoint(missing,read));
const mixed=structuredClone(cp) as any;mixed.wait.remainingMs=4;assert.ok(validateDelayCheckpoint(mixed,read));
console.log('script-palette-cursor: checkpoint ownership passed');
let rejected=0;
for(const change of [{operation:0x4f},{opcodePC:11},{nextPC:12},{operands:[0,0,0,0]},{step:-1},{step:0.5},{phase:'compose'},{phase:'final'},{frameTime:0},{gameSpeed:0},{frameTime:NaN},{remainingMs:-1},{paletteId:-1},{night:1},{delay:0},{original:null},{final:clonePalette(palette)}]){assert.equal(validatePaletteCursor({...cursor,...change} as any,sc,10),false);rejected++;}
for(const change of [{phase:'step'},{step:32},{original:null},{remainingMs:6},{worldUpdate:{}}]){const bad=structuredClone(cp) as any;Object.assign(bad.frames[0].palette,change);Object.assign(bad.wait,change);assert.ok(validateDelayCheckpoint(reverse(bad),read));rejected++;}
console.log(`script-palette-cursor: ${rejected} additional malformed records rejected`);
const extraRGB=structuredClone(cursor) as any;extraRGB.original[0].handle=Promise.resolve();assert.equal(validatePaletteCursor(extraRGB,sc,10),false,'RGB records cannot hide native handles');
assert.equal(validatePaletteCursor({...cursor,native:Promise.resolve()} as any,sc,10),false,'Palette cursor cannot serialize an opaque native handle');
// Sparse arrays are not detached RGB records: JSON would turn holes into null.
for(const family of ['red','blend','color']) {
 const operation=family==='red'?0x4f:family==='blend'?0x80:0x8c;
 const operands=[1,0,0,0],source={operation,operand:operands};
 const original=clonePalette(palette),target=family==='red'?null:clonePalette(palette);
 const working=family==='red'?clonePalette(original):family==='blend'?blendPaletteStep(original,target!,0):clonePalette(original);
 if(family==='red')redPaletteStep(original,working);
 if(family==='color')colorPaletteStep(target!,working,1,false);
 const final=family==='color'?target!.map(()=>({...target![1]})):null;
 const dense={...cursor,operation,operands,family,color:family==='color'?1:0,original,target,working,final,paletteId:family==='red'?null:0,night:family==='red'?null:true,requestedMs:family==='blend'?5:family==='red'?20:2.5,remainingMs:family==='blend'?5:family==='red'?20:2.5};
 assert.equal(validatePaletteCursor(dense as any,source,10),true);
 for(const keys of [['original','working'],['original'],['working'],...(target?[['target']]:[]),...(final?[['final']]:[])]) {
  const sparse=structuredClone(dense) as any;for(const key of keys)delete sparse[key][79];
  assert.equal(validatePaletteCursor(sparse,source,10),false,`${family} sparse ${keys}`);
 }
}
console.log('script-palette-cursor: sparse palette arrays rejected');
