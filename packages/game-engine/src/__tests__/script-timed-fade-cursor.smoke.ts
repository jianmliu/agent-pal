import assert from 'node:assert/strict';
import * as fade from '../services/script-timed-fade-cursor';
assert.equal(typeof fade.createTimedFadeCursor,'function','owned timed fade cursor is missing');
const base=Array.from({length:256},(_,i)=>({r:i+.25,g:255-i,b:-i}));
const args={family:'in' as const,time:.1,paletteId:0,night:false};
const c=fade.createTimedFadeCursor(args,base,40,2);
assert.equal(c.durationMs,30);assert.equal(c.phase,'paint');
fade.paintTimedFade(c,40,2);assert.equal(c.phase,'sleep');assert.equal(c.requestedMs,20);assert.equal(c.lastPaintElapsed,0);assert.equal(fade.validateTimedFadeCursor(c,args),true);
fade.advanceTimedFade(c,7);assert.equal(c.elapsedMs,7);assert.equal(c.remainingMs,13);assert.equal(c.lastPaintElapsed,0);assert.equal(fade.validateTimedFadeCursor(c,args),true);
fade.advanceTimedFade(c,23);assert.equal(c.elapsedMs,30);assert.equal(c.phase,'paint');fade.paintTimedFade(c,80,4);assert.deepEqual(c.working,base);assert.equal(c.requestedMs,20);
fade.advanceTimedFade(c,27);assert.equal(c.elapsedMs,57);fade.paintTimedFade(c,80,4);assert.equal(c.phase,'final');
const precise=fade.createTimedFadeCursor({...args,time:1},base,40,2);fade.paintTimedFade(precise,40,2);fade.advanceTimedFade(precise,100);fade.paintTimedFade(precise,40,2);assert.equal(precise.working[1].r,base[1].r*(1-(300-100)/300));assert.notEqual(precise.working[1].r,base[1].r*(100/300),'IN must preserve IEEE operation order');
const out=fade.createTimedFadeCursor({family:'out',time:1},base,40,2);fade.paintTimedFade(out,40,2);fade.advanceTimedFade(out,100);fade.paintTimedFade(out,40,2);
assert.equal(out.working[1].r,base[1].r*((300-100)/300));assert.equal(fade.validateTimedFadeCursor(out,{family:'out',time:1}),true);
for(const patch of [{durationMs:301},{elapsedMs:-1},{lastPaintElapsed:101},{remainingMs:21},{phase:'paint'},{gameSpeed:0},{working:base}])assert.equal(fade.validateTimedFadeCursor({...out,...patch} as any,{family:'out',time:1}),false);
const sparse=structuredClone(out);delete sparse.working[79];assert.equal(fade.validateTimedFadeCursor(sparse,{family:'out',time:1}),false);
for(const time of [NaN,Infinity,Number.MAX_VALUE])assert.throws(()=>fade.createTimedFadeCursor({family:'out',time},base,40,2));
assert.throws(()=>fade.createTimedFadeCursor(args,base,0,2));
console.log('script-timed-fade-cursor: native formulas, physical offsets, deadlines and dense validation passed');

const {validateDelayCheckpoint}=await import('../services/script-delay-checkpoint');
const cp={version:2,id:'timed-fade',revision:0,registers:{scriptSuccess:false,curEquipPart:4},frames:[{kind:'fade',currentPC:0,continuationPC:0,eventId:0,loopSafetyCounter:0,parentReturn:null,fadeArgs:out.args,timedFade:out}],wait:{kind:'timed-fade',...out}};
const read=()=>{throw new Error('Helper must never read script row zero');};
assert.equal(validateDelayCheckpoint(cp,read),null);
const reverse=(x:any):any=>Array.isArray(x)?x.map(reverse):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reverse(x[k])])):x;
assert.equal(validateDelayCheckpoint(reverse(cp),read),null);
for(const field of ['timedFade','fadeSource','palette','redraw','motion','npcMotion','frameWait','poisonCursor','partyEquipmentCursor','equipmentCursor','shopCursor','dialogAction'])for(const malformed of [null,false,[]]) {const bad=structuredClone(cp) as any;bad.frames[0][field]=malformed;assert.ok(validateDelayCheckpoint(bad,read),field);}
for(const field of ['base','working']){const bad=structuredClone(cp) as any;delete bad.frames[0].timedFade[field][79];assert.ok(validateDelayCheckpoint(bad,read));}
console.log('script-timed-fade-cursor: true helper ownership, no script row zero and semantic JSON validation passed');
for(const wait of [null,undefined,false])assert.ok(validateDelayCheckpoint({...cp,wait},read),'Missing or malformed fade wait rejects cleanly');
