import assert from 'node:assert/strict';
import {shopMenu,validateShopCursor,validateShopSelection,type ShopCursor} from '../services/script-shop-cursor';
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
const sc={operation:0x26,operand:[1,0,0,0]},read=(pc:number)=>pc===10?sc:{operation:0,operand:[0,0,0,0]};
const cursor:ShopCursor={opcodePC:10,nextPC:11,operation:0x26,operands:[1,0,0,0],mode:'buy',phase:'select',prepared:true,index:0,selected:null,options:[{index:0,itemId:61,enabled:true,flags:32,displayPrice:10,quantity:0,amountInUse:0}]};
const cp:any={version:2,id:'shop',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'trigger',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:1,parentReturn:null,shopCursor:cursor}],wait:shopMenu(cursor)};
assert.equal(validateShopCursor(cursor,sc,10),true);assert.equal(validateDelayCheckpoint(cp,read),null);
for(const mutate of [(x:any)=>x.mode='sell',(x:any)=>x.operation=0x27,(x:any)=>x.operands[0]++,(x:any)=>x.prepared=false,(x:any)=>x.index=1,(x:any)=>x.selected=0,(x:any)=>x.options[0].index=1,(x:any)=>x.options[0].displayPrice=-1]){const c=structuredClone(cursor);mutate(c);assert.equal(validateShopCursor(c,sc,10),false);}
for(const mutate of [(x:any)=>x.version=1,(x:any)=>x.wait=undefined,(x:any)=>x.wait.index=1,(x:any)=>x.frames[0].shopCursor=undefined,(x:any)=>x.wait.mode='sell',(x:any)=>x.wait.options=[]]){const c=structuredClone(cp);mutate(c);assert.ok(validateDelayCheckpoint(c,read));}
assert.equal(validateShopSelection({kind:'select',index:0},cursor),true);assert.equal(validateShopSelection({kind:'cancel'},cursor),true);
for(const v of [null,true,false,{}, {kind:'cancel',index:0},{kind:'select',index:1},{kind:'select',index:-1},{kind:'select',index:'0'}])assert.equal(validateShopSelection(v,cursor),false);
const sell:ShopCursor={...structuredClone(cursor),mode:'sell',operation:0x27,options:[{index:0,itemId:61,flags:32,quantity:2,amountInUse:2,enabled:false,displayPrice:5}]};
assert.equal(validateShopCursor(sell,{...sc,operation:0x27},10),true);sell.options[0].enabled=true;assert.equal(validateShopCursor(sell,{...sc,operation:0x27},10),false);
const confirmed=structuredClone(cp);confirmed.frames[0].shopCursor.phase='confirm';confirmed.frames[0].shopCursor.selected=0;confirmed.wait={kind:'input',action:'shop',opcodePC:10,nextPC:11,operands:[1,0,0,0],prompt:{kind:'confirm',noPC:10,options:[{label:'No',value:false},{label:'Yes',value:true}]}};
assert.equal(validateDelayCheckpoint(confirmed,read),null);confirmed.wait.prompt.noPC=0;assert.ok(validateDelayCheckpoint(confirmed,read));
console.log('script-shop-cursor smoke ok');
const noWait=structuredClone(cp);delete noWait.frames[0].shopCursor;delete noWait.wait;assert.ok(validateDelayCheckpoint(noWait,read));

assert.equal(validateShopSelection(Object.assign(Object.create({kind:'select',index:0}),{foo:1,bar:2}),cursor),false);

// Shop ownership is checked before every wait-specific early return.
import {createInputWait} from '../services/script-input-wait';
import {createDialogContext,beginDialogLine,advanceDialogLine} from '../services/script-dialog-progress';
const codec={bytes:(value:any)=>Uint8Array.from(value),decode:()=>'',publish:()=>''};
const base=structuredClone(cp);delete base.frames[0].shopCursor;
const make=(operation:number,operand:number[],wait:any,extras:any={})=>({checkpoint:{...structuredClone(base),...extras,wait},read:(pc:number)=>pc===10?{operation,operand}:read(pc)});
const timer={opcodePC:10,nextPC:11,requestedMs:80,remainingMs:80};
const frameWait={kind:'frame',opcodePC:10,nextPC:11,frameCount:1,trigger:false,gestures:false,frameIndex:0,phase:'sleep',remainingMs:16};
const timed=make(0x85,[1,0,0,0],{kind:'delay',...timer});
const legacy=structuredClone(timed.checkpoint);legacy.version=1;legacy.delay=timer;delete legacy.wait;
const frame=make(9,[1,0,0,0],frameWait);frame.checkpoint.frames[0].frameWait=frameWait;
const input=make(0x4d,[0,0,0,0],createInputWait(10,{operation:0x4d,operand:[0,0,0,0]}));
const dialog=createDialogContext('classic');beginDialogLine(dialog,10,[65],codec,[1,0,0,0]);const glyph=advanceDialogLine(dialog,codec);
const glyphCheckpoint=make(0xffff,[1,0,0,0],glyph,{dialog});
const clearDialog=createDialogContext('classic');clearDialog.line=1;
const clearing=make(0x26,[1,0,0,0],{kind:'input',action:'dialog',phase:'clear',opcodePC:10,nextPC:10,operands:[1,0,0,0],prompt:{kind:'advance',options:[{label:'Continue',value:true}]}},{dialog:clearDialog});
clearing.checkpoint.frames[0].dialogAction={phase:'clear',opcodePC:10,operation:0x26,operands:[1,0,0,0],ended:false,continuationPC:10};
for(const [name,fixture] of [['delay',timed],['v1',{checkpoint:legacy,read:timed.read}],['frame',frame],['input',input],['dialog-time',glyphCheckpoint],['dialog-input',clearing]] as const){
  assert.equal(validateDelayCheckpoint(fixture.checkpoint,fixture.read),null,`${name} baseline`);
  const injected=structuredClone(fixture.checkpoint);injected.frames[0].shopCursor=structuredClone(cursor);
  assert.ok(validateDelayCheckpoint(injected,fixture.read),`${name} rejects mixed shop ownership`);
}
const ancestor=structuredClone(glyphCheckpoint.checkpoint);ancestor.frames.unshift({kind:'trigger',currentPC:9,continuationPC:9,eventId:1,loopSafetyCounter:1,parentReturn:{opcodePC:9,nextPC:10,childEntry:10,childEventId:1}});
const nestedRead=(pc:number)=>pc===9?{operation:4,operand:[10,1,0,0]}:glyphCheckpoint.read(pc);
assert.equal(validateDelayCheckpoint(ancestor,nestedRead),null);ancestor.frames[0].shopCursor=structuredClone(cursor);assert.ok(validateDelayCheckpoint(ancestor,nestedRead));
const history=structuredClone(cp);history.dialog=createDialogContext('classic');assert.equal(validateDelayCheckpoint(history,read),null,'inactive shared dialog context remains valid for shops');
for(const extra of ['frameWait','poisonCursor','partyEquipmentCursor','equipmentCursor','dialogAction']){const mixed=structuredClone(cp);mixed.frames[0][extra]={};assert.ok(validateDelayCheckpoint(mixed,read),`shop rejects ${extra}`);}

const activeDialog=structuredClone(cp);activeDialog.dialog=dialog;assert.ok(validateDelayCheckpoint(activeDialog,read));
for(const invalid of [null,false,{},0]){const bad=structuredClone(cp);bad.frames[0].shopCursor=invalid;assert.ok(validateDelayCheckpoint(bad,read));}

const reorderKeys=(v:any,reverse=false):any=>Array.isArray(v)?v.map(x=>reorderKeys(x,reverse)):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>reverse?b.localeCompare(a):a.localeCompare(b)).map(k=>[k,reorderKeys(v[k],reverse)])):v;
for(const reverse of [false,true])assert.equal(validateDelayCheckpoint(reorderKeys(cp,reverse),read),null,'shop JSON object key order is insignificant');

const confirmation=structuredClone(cp);confirmation.frames[0].shopCursor.phase='confirm';confirmation.frames[0].shopCursor.selected=0;confirmation.wait={kind:'input',action:'shop',opcodePC:10,nextPC:11,operands:[1,0,0,0],prompt:{kind:'confirm',noPC:10,options:[{label:'No',value:false},{label:'Yes',value:true}]}};
for(const reverse of [false,true])assert.equal(validateDelayCheckpoint(reorderKeys(confirmation,reverse),read),null,'shop confirmation ignores JSON object key order');
