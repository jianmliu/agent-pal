import assert from 'node:assert/strict';
import {validatePoisonCursor} from '../services/script-poison-cursor';
const cursor={opcodePC:10,nextPC:11,poisonId:7,all:true,kind:'player',targets:[2,4],index:0,pending:{target:2,partyIndex:0,slot:1,childEntry:20,childEventId:2}};
assert.equal(validatePoisonCursor(cursor,{operation:0x29,operand:[1,7,0]},10,5),true);
for (const change of [{poisonId:8},{index:2},{pending:{...cursor.pending,slot:16}},{pending:{...cursor.pending,target:4}}]) assert.equal(validatePoisonCursor({...cursor,...change},{operation:0x29,operand:[1,7,0]},10,5),false);
assert.equal(validatePoisonCursor({...cursor,kind:'enemy',targets:[0,1,2],index:2,pending:{target:2,slot:1,childEntry:20,childEventId:5}},{operation:0x28,operand:[1,7,0]},10,5),true);
assert.equal(validatePoisonCursor({...cursor,targets:[2,2]},{operation:0x29,operand:[1,7,0]},10,5),true);
console.log('poison cursor smoke passed');
