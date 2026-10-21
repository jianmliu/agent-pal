import assert from 'node:assert/strict';
import {createInputWait,inputNextPC,validateInputResponse} from '../services/script-input-wait';
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
const read=(pc:number)=>({operation:pc===10?10:0,operand:pc===10?[20,0,0,0]:[0,0,0,0]});
const cp:any={version:2,id:'input',revision:0,registers:{scriptSuccess:false,curEquipPart:2},frames:[{kind:'trigger',currentPC:10,continuationPC:5,eventId:1,loopSafetyCounter:3,parentReturn:null}],wait:{kind:'input',opcodePC:10,nextPC:11,operands:[20,0,0,0],prompt:{kind:'confirm',options:[{label:'No',value:false},{label:'Yes',value:true}],noPC:20}}};
assert.equal(validateDelayCheckpoint(cp,read),null,'valid confirm input checkpoint');
for(const mutate of [(x:any)=>x.wait.prompt.noPC++, (x:any)=>x.wait.prompt.options[0].value=true,(x:any)=>x.wait.nextPC++,(x:any)=>x.frames[0].frameWait={},(x:any)=>x.frames[0].poisonCursor={},(x:any)=>x.frames[0].kind='auto']) {const bad=JSON.parse(JSON.stringify(cp));mutate(bad);assert.ok(validateDelayCheckpoint(bad,read));}
const advance=JSON.parse(JSON.stringify(cp));advance.frames[0].kind='auto';advance.wait.operands=[0,0,0,0];advance.wait.prompt={kind:'advance',options:[{label:'Continue',value:true}]};
assert.equal(validateDelayCheckpoint(advance,pc=>({operation:pc===10?0x4d:0,operand:[0,0,0,0]})),null);
console.log('script-input-wait smoke ok');

const wait=createInputWait(10,read(10));
assert.equal(inputNextPC(wait,true),11);assert.equal(inputNextPC(wait,false),20);
const zero=createInputWait(10,{operation:10,operand:[0,0,0,0]});assert.equal(inputNextPC(zero,false),0);
assert.equal(validateInputResponse({id:'input',revision:0,value:false},'input',0,wait),true);
for(const response of [null,{}, {id:'bad',revision:0,value:true}, {id:'input',revision:1,value:true}, {id:'input',revision:0,value:1}])assert.equal(validateInputResponse(response,'input',0,wait),false);
const key=createInputWait(10,{operation:0x4d,operand:[0,0,0,0]});assert.equal(inputNextPC(key,true),11);
assert.equal(validateInputResponse({id:'input',revision:0,value:false},'input',0,key),false);
assert.equal(validateInputResponse({id:'input',revision:0,value:true},'input',0,key),true);
assert.ok(validateDelayCheckpoint(cp,pc=>pc===20?null:read(pc)),'missing no branch rejected');
assert.ok(validateDelayCheckpoint(cp,pc=>pc===10?{operation:10,operand:[20,1,0,0]}:read(pc)),'changed operands rejected');
