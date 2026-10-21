import assert from 'node:assert/strict';
import {createDialogContext,dialogAdvance} from '../services/script-dialog-progress';
import {validateDelayCheckpoint} from '../services/script-delay-checkpoint';
const redraw={opcodePC:10,nextPC:11,operation:5,operands:[0,2,1,0],previousOverlay:'gps',branch:'normal',phase:'sleep',requestedMs:120,remainingMs:120};
const cp={version:2,id:'redraw',revision:0,registers:{scriptSuccess:true,curEquipPart:-1},frames:[{kind:'trigger',currentPC:10,continuationPC:10,eventId:1,loopSafetyCounter:1,parentReturn:null,redraw}],wait:{kind:'redraw',...redraw}};
const read=(pc:number)=>pc===10?{operation:5,operand:[0,2,1,0]}:{operation:0,operand:[0,0,0,0]};
assert.equal(validateDelayCheckpoint(cp,read),null);
let checks=1;
for(const change of [{operation:0x8e},{operands:[0,1,1,0]},{phase:'compose'},{branch:'battle'},{branch:null},{requestedMs:121},{remainingMs:121},{remainingMs:-1},{previousOverlay:{}},{previousOverlay:1},{opcodePC:11},{nextPC:12}]){assert.ok(validateDelayCheckpoint({...cp,frames:[{...cp.frames[0],redraw:{...redraw,...change}}],wait:{...cp.wait,...change}},read));checks++;}
for(const key of ['redraw','motion','npcMotion','frameWait','poisonCursor','partyEquipmentCursor','equipmentCursor','shopCursor','dialogAction']){assert.ok(validateDelayCheckpoint({...cp,frames:[{...cp.frames[0],[key]:null}]},read));checks++;}
const reverse=(x:any):any=>Array.isArray(x)?x.map(reverse):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reverse(x[k])])):x;
assert.equal(validateDelayCheckpoint(reverse(cp),read),null);checks++;
assert.ok(validateDelayCheckpoint({...cp,frames:[{...cp.frames[0],kind:'auto'}]},read));checks++;
const dialog=createDialogContext('classic');dialog.line=1;
const clear={...cp,dialog,frames:[{...cp.frames[0],redraw:{...redraw,branch:null,phase:'clear',remainingMs:0},dialogAction:{phase:'clear',opcodePC:10,operation:5,operands:redraw.operands,ended:false,continuationPC:10}}],wait:dialogAdvance(10,redraw.operands,'clear')};
assert.equal(validateDelayCheckpoint(clear,read),null);checks++;
assert.equal(validateDelayCheckpoint(reverse(clear),read),null);checks++;
for(const mutate of [(x:any)=>{delete x.frames[0].dialogAction;},(x:any)=>{x.frames[0].dialogAction.operation=0x8e;},(x:any)=>{x.frames[0].dialogAction.opcodePC=11;},(x:any)=>{x.frames[0].redraw.branch='normal';},(x:any)=>{x.frames[0].redraw.remainingMs=1;},(x:any)=>{x.wait.phase='terminal';},(x:any)=>{x.dialog.line=0;},(x:any)=>{x.dialog.cursor={};},(x:any)=>{x.frames[0].motion={};}]){const bad=structuredClone(clear);mutate(bad);assert.ok(validateDelayCheckpoint(bad,read));checks++;}
for(const present of [null,[],0,false,'bad',{}])for(const leaf of [cp,clear]){const bad=structuredClone(leaf) as any;bad.frames[0].redraw=present;assert.ok(validateDelayCheckpoint(bad,read));checks++;}
for(const mode of [null,'gps','panorama','off','other']){const next=structuredClone(cp);next.frames[0].redraw.previousOverlay=mode as any;next.wait.previousOverlay=mode as any;assert.equal(validateDelayCheckpoint(next,read),null);checks++;}
const noCursor=structuredClone(cp) as any;delete noCursor.frames[0].redraw;assert.ok(validateDelayCheckpoint(noCursor,read));checks++;
for(const order of [(x:any)=>x,reverse]){const missing=order(structuredClone(clear)) as any;delete missing.frames[0].redraw;assert.ok(validateDelayCheckpoint(missing,read),'Redraw clear action requires its captured overlay cursor');checks++;}
const mismatch=structuredClone(cp);mismatch.wait.remainingMs=30;assert.ok(validateDelayCheckpoint(mismatch,read));checks++;
for(const wait of [{kind:'delay',opcodePC:10,nextPC:11,requestedMs:80,remainingMs:80},{kind:'input',opcodePC:10,nextPC:11,operands:[0,2,1,0],prompt:{kind:'confirm',noPC:10,options:[{label:'No',value:false},{label:'Yes',value:true}]}},{kind:'party-motion'},{kind:'npc-motion'},{kind:'frame'},{kind:'menu'}]){assert.ok(validateDelayCheckpoint({...cp,wait},read));checks++;}
console.log(`script-redraw-cursor: ${checks} checks passed`);
