import {clonePalette,type PaletteRGB} from './script-palette-cursor';
import {sameJsonValue} from './script-json-value';
export type TimedFadeArgs={family:'out';time:number}|{family:'in';time:number;paletteId:number;night:boolean};
export interface TimedFadeCursor {
 args:TimedFadeArgs;durationMs:number;elapsedMs:number;lastPaintElapsed:number|null;
 phase:'paint'|'sleep'|'final';base:PaletteRGB[];working:PaletteRGB[];
 frameTime:number;gameSpeed:number;requestedMs:number;remainingMs:number;
 opcodePC:0;nextPC:0;
}
export interface FadeOpcodeCursor {opcodePC:number;nextPC:number;operation:number;operands:number[];phase:'clear'|'child';args:TimedFadeArgs|null;needFade:boolean}
const keys=(v:any,allowed:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===allowed.length&&Object.keys(v).every(k=>allowed.includes(k));
export function validateTimedFadeArgs(a:unknown):a is TimedFadeArgs {
 const v=a as TimedFadeArgs;
 return !!v && (v.family==='out'?keys(v,['family','time']):v.family==='in'&&keys(v,['family','time','paletteId','night'])&&Number.isSafeInteger(v.paletteId)&&v.paletteId>=0&&typeof v.night==='boolean') && Number.isFinite(v.time)&&Number.isFinite(v.time*300);
}
export function denseFadePalette(p:unknown):p is PaletteRGB[] {
 return Array.isArray(p)&&p.length===256&&Object.keys(p).length===256&&Array.from(p).every(c=>keys(c,['r','g','b'])&&['r','g','b'].every(k=>Number.isFinite(c[k])));
}
export function fadeInterval(frameTime:number,gameSpeed:number):number {
 const interval=frameTime/gameSpeed;
 if(!Number.isFinite(frameTime)||frameTime<=0||!Number.isFinite(gameSpeed)||gameSpeed<=0||!Number.isFinite(interval)||interval<=0)throw new Error('Timed fade requires finite positive native FrameTime/GameSpeed');
 return interval;
}
export function timedFadePalette(base:PaletteRGB[],family:TimedFadeArgs['family'],duration:number,elapsed:number):PaletteRGB[] {
 const rate=family==='in'?1-(duration-elapsed)/duration:(duration-elapsed)/duration;
 return base.map(p=>({r:p.r*rate,g:p.g*rate,b:p.b*rate}));
}
export function createTimedFadeCursor(args:TimedFadeArgs,base:PaletteRGB[],frameTime:number,gameSpeed:number):TimedFadeCursor {
 if(!validateTimedFadeArgs(args)||args.time<=0||!denseFadePalette(base))throw new Error('Invalid timed fade arguments or palette');
 const requestedMs=fadeInterval(frameTime,gameSpeed);
 return {args:{...args},durationMs:args.time*300,elapsedMs:0,lastPaintElapsed:null,phase:'paint',base:clonePalette(base),working:clonePalette(base),frameTime,gameSpeed,requestedMs,remainingMs:0,opcodePC:0,nextPC:0};
}
export function paintTimedFade(c:TimedFadeCursor,frameTime:number,gameSpeed:number):void {
 const rate=c.args.family==='in'?1-(c.durationMs-c.elapsedMs)/c.durationMs:(c.durationMs-c.elapsedMs)/c.durationMs;
 if(c.args.family==='in'?rate>1:rate<0){c.phase='final';return;}
 const interval=fadeInterval(frameTime,gameSpeed);
 c.working=timedFadePalette(c.base,c.args.family,c.durationMs,c.elapsedMs);c.lastPaintElapsed=c.elapsedMs;c.frameTime=frameTime;c.gameSpeed=gameSpeed;c.requestedMs=interval;c.remainingMs=interval;c.phase='sleep';
}
export function advanceTimedFade(c:TimedFadeCursor,elapsed:number):void {
 c.elapsedMs+=elapsed;c.remainingMs=Math.max(0,c.remainingMs-elapsed);if(c.remainingMs===0)c.phase='paint';
}
/** Only a pending sleep is externally published. Replay the last paint, not the partial clock. */
export function validateTimedFadeCursor(c:TimedFadeCursor,args:TimedFadeArgs):boolean {
 if(!keys(c,['args','durationMs','elapsedMs','lastPaintElapsed','phase','base','working','frameTime','gameSpeed','requestedMs','remainingMs','opcodePC','nextPC'])||!validateTimedFadeArgs(c.args)||!sameJsonValue(c.args,args)||c.args.time<=0||c.durationMs!==c.args.time*300||c.durationMs<=0||c.opcodePC!==0||c.nextPC!==0||c.phase!=='sleep'||!denseFadePalette(c.base)||!denseFadePalette(c.working))return false;
 if(!Number.isFinite(c.elapsedMs)||c.elapsedMs<0||c.lastPaintElapsed===null||!Number.isFinite(c.lastPaintElapsed)||c.lastPaintElapsed<0||c.lastPaintElapsed>c.durationMs||c.lastPaintElapsed>c.elapsedMs||!Number.isFinite(c.remainingMs)||c.remainingMs<=0||c.remainingMs>c.requestedMs)return false;
 try{if(c.requestedMs!==fadeInterval(c.frameTime,c.gameSpeed))return false;}catch{return false;}
 // Floating subtraction during partial resumes is supported; this relation tolerates its rounding only.
 const elapsedSince=c.elapsedMs-c.lastPaintElapsed,consumed=c.requestedMs-c.remainingMs;
 if(Math.abs(elapsedSince-consumed)>Number.EPSILON*Math.max(1,c.elapsedMs,c.requestedMs)*4)return false;
 return sameJsonValue(c.working,timedFadePalette(c.base,c.args.family,c.durationMs,c.lastPaintElapsed));
}
export function validateFadeOpcodeCursor(c:FadeOpcodeCursor,sc:any,pc:number):boolean {
 if(!keys(c,['opcodePC','nextPC','operation','operands','phase','args','needFade'])||![0x4e,0x50,0x51].includes(c.operation)||sc?.operation!==c.operation||c.opcodePC!==pc||c.nextPC!==(c.operation===0x4e?0:pc+1)||!sameJsonValue(c.operands,Array.from(sc.operand))||c.needFade!==(c.operation===0x50))return false;
 if(c.phase==='clear')return c.args===null;
 const time=c.operation===0x4e?1:c.operation===0x50?(sc.operand[0]||1):((sc.operand[0]<<16>>16)>0?sc.operand[0]:1);
 return c.phase==='child'&&validateTimedFadeArgs(c.args)&&c.args.family===(c.operation===0x51?'in':'out')&&c.args.time===time;
}
