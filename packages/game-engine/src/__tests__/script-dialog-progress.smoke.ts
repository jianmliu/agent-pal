import assert from 'node:assert/strict';
import {createDialogContext,setupDialog,beginDialogLine,advanceDialogLine} from '../services/script-dialog-progress';
const codec={bytes:(x:any)=>Uint8Array.from(x),decode:(x:Uint8Array)=>new TextDecoder().decode(x).trim(),publish:(x:Uint8Array)=>new TextDecoder().decode(x).trim()};
const c=createDialogContext('classic');setupDialog(c,0x3c,[0x4f,7,0,0]);
beginDialogLine(c,10,[65,66,0,67],codec);
const w=advanceDialogLine(c,codec);assert.equal(w?.kind,'dialog-time');assert.equal(w?.requestedMs,24);assert.equal(c.cursor?.byteOffset,1);assert.deepEqual(c.cursor?.raw,[65,66,0,67]);
import {completeDialogCondition,validateDialogContext,validateDialogText,clearOwnedDialog} from '../services/script-dialog-progress';
const json=(x:any)=>JSON.parse(JSON.stringify(x));
for(const mode of ['classic','suppressed'] as const) {
  const context=createDialogContext(mode);beginDialogLine(context,10,[65,0,66],codec);advanceDialogLine(context,codec);
  assert.equal(validateDialogText(context,codec,[65,0,66]),true);
  for(const mutate of [(x:any)=>x.cursor.byteOffset++, (x:any)=>x.cursor.glyphs++, (x:any)=>x.cursor.raw[0]++, (x:any)=>x.cursor.publication.text='bad', (x:any)=>x.speed=-1]) {const bad=json(context);mutate(bad);assert.equal(validateDialogContext(bad)&&validateDialogText(bad,codec,[65,0,66]),false);}
  completeDialogCondition(context);assert.equal(advanceDialogLine(context,codec),null);assert.equal(context.line,1);
  clearOwnedDialog(context,true);assert.equal(context.line,0);assert.equal(context.color,0x4f);
}
for(const [op,pos,portrait,color] of [[0x3b,1,0,17],[0x3c,0,12,17],[0x3d,2,12,17],[0x3e,3,0,17]]) {
  const context=createDialogContext('classic');setupDialog(context,op,op===0x3c||op===0x3d?[12,17,1,0]:[17,0,1,0]);
  assert.equal(context.position,pos);assert.equal(context.portrait,portrait);assert.equal(context.color,color);assert.equal(validateDialogContext(context),true);
}
const inline=createDialogContext('classic');beginDialogLine(inline,1,[126,48,49,65],codec);const delay=advanceDialogLine(inline,codec);assert.equal(delay?.kind,'dialog-time');if(delay?.kind==='dialog-time')assert.equal(delay.requestedMs,80/7);completeDialogCondition(inline);assert.equal(inline.line,0);assert.equal(inline.cursor,undefined);
const windowContext=createDialogContext('classic');setupDialog(windowContext,0x3e,[0,0,0]);beginDialogLine(windowContext,1,[34,49,50],codec);assert.deepEqual(advanceDialogLine(windowContext,codec),{kind:'dialog-time',opcodePC:1,nextPC:1,phase:'window',requestedMs:1500,remainingMs:1500,prompt:{kind:'advance',options:[{label:'Continue',value:true}]}});assert.equal(windowContext.color,0x4f);assert.equal(windowContext.cursor?.glyphs,2);
const page=createDialogContext('classic');page.line=4;beginDialogLine(page,1,[65],codec);assert.deepEqual(advanceDialogLine(page,codec),{kind:'advance',phase:'page'});completeDialogCondition(page);assert.equal(page.page,1);assert.equal(page.line,0);advanceDialogLine(page,codec);assert.equal(page.publications.length,1);assert.equal(validateDialogText(page,codec,[65]),true);

const longBytes=Array.from({length:10},()=>65),longContext=createDialogContext('classic');beginDialogLine(longContext,1,longBytes,codec);
for(let glyph=1;glyph<=10;glyph++){const wait=advanceDialogLine(longContext,codec);assert.equal(wait?.kind,'dialog-time');assert.equal(longContext.cursor?.glyphs,glyph);assert.equal(validateDialogText(longContext,codec,longBytes),true,`valid long glyph ${glyph}`);const bad=json(longContext);bad.cursor.glyphs++;assert.equal(validateDialogText(bad,codec,longBytes),false);completeDialogCondition(longContext);}
console.log('script-dialog-progress smoke ok');

const reorderKeys=(v:any,reverse=false):any=>Array.isArray(v)?v.map(x=>reorderKeys(x,reverse)):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>reverse?b.localeCompare(a):a.localeCompare(b)).map(k=>[k,reorderKeys(v[k],reverse)])):v;
for(const reverse of [false,true]) {
  assert.equal(validateDialogText(reorderKeys(c,reverse),codec,[65,66,0,67]),true,'glyph replay ignores JSON object key order');
  assert.equal(validateDialogText(reorderKeys(windowContext,reverse),codec,[34,49,50]),true,'window replay ignores JSON object key order');
  assert.equal(validateDialogText(reorderKeys(page,reverse),codec,[65]),true,'page replay ignores JSON object key order');
}
