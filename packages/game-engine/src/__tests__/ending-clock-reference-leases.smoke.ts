import assert from 'node:assert/strict';
import {createEndingClock} from '../services/script-ending-clock';
let module:any;try{module=await import('../services/ending-clock-reference-leases');}catch{}
assert.ok(module?.EndingClockReferenceLeases,'root clock runtime lease registry must exist');
const scope=new module.EndingClockReferenceLeases(),cap=createEndingClock({origin:149,workCounter:()=>0}),binding={kind:'browser-performance',performance:{},now:()=>0};
const lease=scope.acquire('owner',cap,binding),cp={id:'owner',revision:0,clock:scope.descriptor(lease)};
scope.publish(lease,cp);assert.ok(scope.resolve(cp,cap,binding));
assert.equal(scope.resolve({...cp,revision:1},cap,binding),null);
assert.equal(scope.resolve(cp,createEndingClock({origin:149,workCounter:()=>0}),binding),null);
assert.equal(scope.resolve(cp,cap,{...binding,now:()=>0}),null);
scope.consume(lease);assert.equal(scope.resolve(cp,cap,binding),null);
scope.publish(lease,cp);scope.transfer('owner','next');assert.equal(scope.resolve(cp,cap,binding),null);
lease.owner='next';scope.releaseOwner('next');assert.equal(scope.hasReferences,false);
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
const delay:any={version:1,id:'x',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'auto',currentPC:1,continuationPC:1,eventId:0,loopSafetyCounter:0,parentReturn:null}],delay:{opcodePC:1,nextPC:2,requestedMs:80,remainingMs:80},clock:{format:'wrong',lease:{id:'c',generation:1,owner:'x'},elapsedUnits:'0'}};
assert.equal(validateDelayCheckpoint(delay,()=>({operation:0x85,operand:[1,0,0]})),'Invalid ending clock descriptor');
for(const kind of ['date','process'])assert.throws(()=>new module.EndingClockReferenceLeases().acquire('owner',cap,{kind}),/browser-performance/);
console.log('ending-clock-reference-leases smoke passed');
