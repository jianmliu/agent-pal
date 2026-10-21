import assert from 'node:assert/strict';
const path='../services/script-ending-clock';
let module:any;try{module=await import(path);}catch{}
assert.ok(module?.createEndingClock,'trusted exact ending clock factory must exist');
const {createEndingClock}=module;
let work=0;const c=createEndingClock({origin:-1e16,workCounter:()=>work});
const lane=c.createLane();lane.addElapsed(1e16);lane.addElapsed(1);assert.equal(lane.sample(),1);
// Expectations below are independently representable IEEE arithmetic boundaries.
for(const [origin,parts,want] of [
 [-0,[], -0], [0,[Number.MIN_VALUE],Number.MIN_VALUE],
 [150-2**-45,[2**-46],150], [150,[2**-46],150],
 [150,[3*2**-46],150+2**-44],
 [-(2**53),[2**53,0.1],0.1],
 [2**53,[1],2**53], [2**53,[3],2**53+4],
 [150*(2**31),[],150*(2**31)], [150*(2**32),[],150*(2**32)],
] as [number,number[],number][]){const l=createEndingClock({origin,workCounter:()=>0}).createLane();for(const p of parts)l.addElapsed(p);assert.ok(Object.is(l.sample(),want),`${origin} + ${parts}`);}
const l=createEndingClock({origin:0,workCounter:()=>work}).createLane();work=1e16;l.begin();work=1e16+2;assert.equal(l.sample(),2);work=1e16+4;l.end();assert.equal(l.sample(),4);
assert.throws(()=>createEndingClock({origin:Infinity,workCounter:()=>0}));
assert.throws(()=>lane.addElapsed(-1));assert.throws(()=>lane.addElapsed(NaN));
const max=createEndingClock({origin:Number.MAX_VALUE,workCounter:()=>0}).createLane();assert.throws(()=>max.addElapsed(Number.MAX_VALUE));assert.equal(max.sample(),Number.MAX_VALUE);
console.log('script-ending-clock smoke passed');
import fs from 'node:fs';
const fromBits=(hex:string)=>new DataView(Uint8Array.from(Buffer.from(hex,'hex')).buffer).getFloat64(0,false);
const toBits=(n:number)=>{const a=new ArrayBuffer(8),d=new DataView(a);d.setFloat64(0,n,false);return Buffer.from(a).toString('hex');};
const vectors=JSON.parse(fs.readFileSync(new URL('./ending-clock-ieee-vectors.json',import.meta.url),'utf8')).vectors;
for(const v of vectors){const l=createEndingClock({origin:fromBits(v.origin),workCounter:()=>0}).createLane();const run=()=>{for(const h of v.parts)l.addElapsed(fromBits(h));return toBits(l.sample());};if(v.expected==='overflow')assert.throws(run,/overflow/);else assert.equal(run(),v.expected,JSON.stringify(v));}
let parked=0;const monotonic=createEndingClock({origin:0,workCounter:()=>parked}).createLane();monotonic.begin();monotonic.end();parked=100;monotonic.validateCounter();assert.equal(monotonic.elapsedUnits,'0');parked=50;assert.throws(()=>monotonic.begin(),/backwards/,'every successful validation read participates in the monotonic contract');
