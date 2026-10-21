import assert from 'node:assert/strict';
import {sameJsonValue} from '../services/script-json-value';
assert.equal(sameJsonValue({z:[{b:2,a:1}],a:0},{a:-0,z:[{a:1,b:2}]}),true);
assert.equal(sameJsonValue({a:undefined,b:1},{b:1}),true);
assert.equal(sameJsonValue([undefined],[null]),true);
assert.equal(sameJsonValue(undefined,null),false);
for(const [a,b] of [[{a:1},{a:2}],[{a:1},{a:1,b:null}],[[1,2],[2,1]],[[{a:1},{b:2}],[{b:2},{a:1}]],['1',1],[false,0]])assert.equal(sameJsonValue(a,b),false);
console.log('script-json-value: 10 checks passed');
