import {sameJsonValue} from './script-json-value';
import {dialogColorByte,toggleDialogColor,dialogControlNumber,dialogGlyphWidth} from './dialog-text-grammar';
/** Pure owned text progress. No surfaces, input flags, timers or native promises. */
export interface DialogCodec {
  bytes:(value:unknown)=>Uint8Array;
  decode:(bytes:Uint8Array)=>string;
  publish:(bytes:Uint8Array,speaker:string|null,title:boolean)=>string;
}
export interface DialogContext {
  mode:'classic'|'suppressed';position:number;portrait:number;color:number;speed:number;
  icon:number;line:number;page:number;skip:boolean;playingRNG:boolean;
  speaker:string|null;faces:Record<string,string>;sequence:number;
  publications:Array<{text:string;source:string|null;line:number;sequence:number;opcodePC:number;position:number;portrait:number;mode:'classic'|'suppressed';color:number;speed:number;title:boolean;renderLine:number;raw:number[];byteOffset:number;glyphs:number;pixels:number}>;
  cursor?:DialogTextCursor;
}
export interface DialogTextCursor {
  opcodePC:number;operands:number[];sourceString:string|null;raw:number[];byteOffset:number;glyphs:number;pixels:number;renderLine:number;skipAt:number|null;
  phase:'page'|'render'|'glyph'|'inline'|'window';title:boolean;
  publication:{text:string;source:string|null;line:number;sequence:number};
  base:Omit<DialogContext,'cursor'>;
}
export interface DialogAction {
  phase:'clear'|'terminal';opcodePC:number;operation:number;operands:number[];
  ended:boolean;continuationPC:number;
}
export interface DialogTimeWait {
  kind:'dialog-time';opcodePC:number;nextPC:number;phase:'glyph'|'inline'|'window';
  prompt?:{kind:'advance';options:[{label:'Continue';value:true}]};
  requestedMs:number;remainingMs:number;
}
export interface DialogAdvanceWait {
  kind:'input';opcodePC:number;nextPC:number;operands:number[];
  action:'dialog';phase:'page'|'window'|'clear'|'terminal';
  prompt:{kind:'advance';options:[{label:'Continue';value:true}]};
}
export function createDialogContext(mode:DialogContext['mode']):DialogContext {
  return {mode,position:0,portrait:0,color:0x4f,speed:3,icon:0,line:0,page:0,skip:false,playingRNG:false,speaker:null,faces:{},sequence:0,publications:[]};
}
export function clearOwnedDialog(c:DialogContext,end=false):void {
  c.line=0;
  if(c.position===1 || end){c.position=0;c.color=0x4f;}
  if(end){c.skip=false;c.speaker=null;c.playingRNG=false;}
}
export function setupDialog(c:DialogContext,op:number,a:ArrayLike<number>):void {
  c.position=op===0x3b?1:op===0x3c?0:op===0x3d?2:3;
  c.portrait=op===0x3c||op===0x3d?a[0]:0;
  const color=op===0x3c||op===0x3d?a[1]:a[0];
  if(color)c.color=color;
  c.line=0;c.icon=0;c.skip=false;
  c.speaker=c.portrait?c.faces[String(c.portrait)]||null:null;
  if(op!==0x3e && a[2] && c.portrait)c.playingRNG=true;
}
export function beginDialogLine(c:DialogContext,pc:number,payload:unknown,codec:DialogCodec,operands:number[]=[]):DialogTextCursor {
  const raw=Array.from(codec.bytes(payload));
  const nul=raw.indexOf(0),bytes=Uint8Array.from(nul<0?raw:raw.slice(0,nul));
  const base=JSON.parse(JSON.stringify(c));delete base.cursor;
  c.icon=0;
  const len=bytes.length,colon=bytes[len-1]===58 || (bytes[len-2]===0xa1 && bytes[len-1]===0x47);
  let speakerTitle=false;
  if(c.line===0 && c.position!==1 && c.position!==3 && len>=2 && colon){const name=codec.decode(bytes.subarray(0,len-(bytes[len-1]===58?1:2))).trim();if(name){speakerTitle=true;c.speaker=name;if(c.portrait)c.faces[String(c.portrait)]=name;}}
  const title=c.mode==='classic' ? c.line===0 && c.position!==1 && c.position!==3 && colon : speakerTitle;
  const sequence=++c.sequence;
  const publication={text:codec.publish(bytes,c.speaker,speakerTitle),source:c.speaker,line:c.line,sequence};
  c.publications.push({...publication,opcodePC:pc,position:c.position,portrait:c.portrait,mode:c.mode,color:c.color,speed:c.speed,title,renderLine:c.line,raw:raw.slice(),byteOffset:0,glyphs:0,pixels:0});
  return c.cursor={opcodePC:pc,operands,sourceString:typeof payload==='string'?payload:null,raw,byteOffset:0,glyphs:0,pixels:0,renderLine:c.line,skipAt:null,phase:c.line>3?'page':'render',title,
    publication,base};
}
export function dialogAdvance(pc:number,a:ArrayLike<number>,phase:DialogAdvanceWait['phase']):DialogAdvanceWait {
  return {kind:'input',action:'dialog',phase,opcodePC:pc,nextPC:pc,operands:Array.from(a),prompt:{kind:'advance',options:[{label:'Continue',value:true}]}};
}
/** Called only after a recorded condition completed (or was explicitly skipped). */
export function completeDialogCondition(c:DialogContext,skip=false):void {
  const t=c.cursor;if(!t)return;
  if(t.phase==='page'){c.line=0;c.page++;c.skip=false;t.renderLine=0;t.phase='render';if(c.mode==='classic' && c.position!==1 && c.position!==3){const nul=t.raw.indexOf(0),len=nul<0?t.raw.length:nul;t.title=t.raw[len-1]===58 || (t.raw[len-2]===0xa1 && t.raw[len-1]===0x47);}}
  else if(t.phase==='glyph'){if(skip){c.skip=true;t.skipAt=t.byteOffset;}t.phase='render';}
  else if(t.phase==='inline'){c.line=0;c.skip=false;delete c.cursor;}
  else if(t.phase==='window'){clearOwnedDialog(c,true);delete c.cursor;}
}
// Native classic window polls every100ms and uses elapsed>1400, first closing at1500.
function classicWindowWait(t:DialogTextCursor):DialogTimeWait {
  return {kind:'dialog-time',opcodePC:t.opcodePC,nextPC:t.opcodePC,phase:'window',requestedMs:1500,remainingMs:1500,prompt:{kind:'advance',options:[{label:'Continue',value:true}]}};
}
export function advanceDialogLine(c:DialogContext,codec:DialogCodec):DialogTimeWait|{kind:'advance';phase:'page'|'window'}|null {
  const t=c.cursor;if(!t)return null;
  try {
  if(t.phase==='window')return c.mode==='classic'?classicWindowWait(t):{kind:'advance',phase:'window'};
  if(t.phase==='page')return {kind:'advance',phase:'page'};
  if(t.phase!=='render')throw new Error('Dialog condition must complete before advancement');
  const raw=t.raw,nul=raw.indexOf(0),len=nul<0?raw.length:nul;
  if(c.position===3 && c.mode==='suppressed'){t.phase='window';return {kind:'advance',phase:'window'};}
  if(t.title){delete c.cursor;return null;}
  while(t.byteOffset<len) {
    let ch=raw[t.byteOffset];
    const color=dialogColorByte(ch);
    if(color!==null){if(ch!==34 || c.position!==3)c.color=toggleDialogColor(c.color,color);t.byteOffset++;continue;}
    if(ch===36){c.speed=~~(dialogControlNumber(raw,t.byteOffset)*10/7);t.byteOffset+=3;continue;}
    if(ch===126){
      if(c.position===3){c.line=-1;c.skip=false;t.byteOffset=len;break;}
      const requestedMs=dialogControlNumber(raw,t.byteOffset)*80/7;
      if(!Number.isFinite(requestedMs)||requestedMs<0)throw new Error('Invalid inline dialog delay');
      t.byteOffset+=3;t.phase='inline';return {kind:'dialog-time',opcodePC:t.opcodePC,nextPC:t.opcodePC,phase:'inline',requestedMs,remainingMs:requestedMs};
    }
    if(ch===40||ch===41){c.icon=ch===41?1:2;t.byteOffset++;continue;}
    if(ch===92){t.byteOffset++;if(t.byteOffset>=len && c.position===3)break;ch=raw[t.byteOffset];}
    const width=dialogGlyphWidth(ch);
    t.byteOffset+=(ch&128)?2:1;t.glyphs++;t.pixels+=width;
    if(c.position!==3 && !c.skip){t.phase='glyph';const requestedMs=c.speed*8;return {kind:'dialog-time',opcodePC:t.opcodePC,nextPC:t.opcodePC,phase:'glyph',requestedMs,remainingMs:requestedMs};}
  }
  if(c.position===3){t.phase='window';return classicWindowWait(t);}
  c.line++;delete c.cursor;return null;
  } finally {const p=c.publications[c.publications.length-1];if(p && p.sequence===t.publication.sequence){p.byteOffset=t.byteOffset;p.glyphs=t.glyphs;p.pixels=t.pixels;p.title=t.title;p.renderLine=t.renderLine;}}
}
const integer=(x:unknown)=>Number.isSafeInteger(x);
export function validateDialogContext(value:unknown):value is DialogContext {
  const c=value as DialogContext;
  return !!c && ['classic','suppressed'].includes(c.mode) && integer(c.position) && c.position>=0 && c.position<=3 && integer(c.portrait) && c.portrait>=0 && c.portrait<=65535 && integer(c.color) && c.color>=0 && c.color<=65535 && integer(c.speed) && c.speed>=0 && c.speed<=141 && integer(c.icon) && c.icon>=0 && c.icon<=2 && integer(c.line) && c.line>=-1 && c.line<=4 && integer(c.page) && c.page>=0 && typeof c.skip==='boolean' && typeof c.playingRNG==='boolean' && (c.speaker===null||typeof c.speaker==='string') && !!c.faces && !Array.isArray(c.faces) && Object.entries(c.faces).every(([k,v])=>/^\d+$/.test(k) && Number(k)<=65535 && typeof v==='string') && integer(c.sequence) && c.sequence>=0 && Array.isArray(c.publications) && c.publications.length<=c.sequence && c.publications.every((p,i)=>!!p && typeof p.text==='string' && (p.source===null||typeof p.source==='string') && integer(p.line) && p.line>=-1 && p.line<=4 && integer(p.opcodePC) && p.opcodePC>=0 && integer(p.position) && p.position>=0 && p.position<=3 && integer(p.portrait) && p.portrait>=0 && p.portrait<=65535 && ['classic','suppressed'].includes(p.mode) && integer(p.color) && p.color>=0 && p.color<=65535 && integer(p.speed) && p.speed>=0 && p.speed<=141 && typeof p.title==='boolean' && integer(p.renderLine) && p.renderLine>=-1 && p.renderLine<=4 && Array.isArray(p.raw) && p.raw.every(b=>integer(b)&&b>=0&&b<=255) && integer(p.byteOffset) && p.byteOffset>=0 && p.byteOffset<=p.raw.length+3 && integer(p.glyphs) && p.glyphs>=0 && p.glyphs<=p.raw.length && integer(p.pixels) && p.pixels>=0 && p.pixels<=p.glyphs*16 && integer(p.sequence) && p.sequence>0 && p.sequence<=c.sequence && (i===0||p.sequence>c.publications[i-1].sequence));
}
/** Replay only the pure grammar to bind offsets, publication and presentation to raw bytes. */
export function validateDialogText(c:DialogContext,codec:DialogCodec,source:unknown):boolean {
  const t=c.cursor;if(!t || t.sourceString!==(typeof source==='string'?source:null) || !integer(t.opcodePC) || !Array.isArray(t.raw) || t.raw.some(x=>!integer(x)||x<0||x>255) || JSON.stringify(t.raw)!==JSON.stringify(Array.from(codec.bytes(source))) || !validateDialogContext(t.base) || t.base.cursor)return false;
  try {
    const replay=JSON.parse(JSON.stringify(t.base)) as DialogContext;
    beginDialogLine(replay,t.opcodePC,t.sourceString??t.raw,codec,t.operands);
    // A glyph needs an advance and a completion. Each advance consumes at
    // least one source byte; page completion and the final condition add only
    // a constant number of transitions. Keep the replay bounded by raw input.
    const maxTransitions=2*t.raw.length+4;
    for(let i=0;i<=maxTransitions;i++){
      if(sameJsonValue(replay,c))return true;
      if(!replay.cursor)return false;
      if(replay.cursor.phase!=='render')completeDialogCondition(replay,t.skipAt===replay.cursor.byteOffset && !replay.skip);
      else advanceDialogLine(replay,codec);
    }
  }catch{return false;}
  return false;
}
