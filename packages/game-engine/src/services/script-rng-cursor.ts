import {sameJsonValue} from './script-json-value';
import {validateTimedFadeArgs,type TimedFadeArgs} from './script-timed-fade-cursor';
export interface RngVideoIdentity {format:'rng-video-sha256-v1';byteLength:number;digest:string}
export interface RngFrontBinding {pitch:number;width:number;height:number;byteLength:number;digest:string}
/** Continuous relative clock only. Runtime anchors and parked time are never serialized. */
export interface RngCursor {opcodePC:number;nextPC:number;operation:0x37;operands:number[];rngNum:number;start:number;end:number;speed:number;frame:number;delay:number;phase:'blit'|'fade'|'sleep';logicalNow:number;deadline:number;resetFrame:number|null;requestedMs:number;remainingMs:number;sleepStart:number;waitElapsed:number;asset:RngVideoIdentity;front:RngFrontBinding;args:TimedFadeArgs|null}
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const digest=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const keys=(v:any,w:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===w.length&&w.every(k=>Object.prototype.hasOwnProperty.call(v,k));
export function createRngCursor(pc:number,sc:any,rngNum:number,asset:RngVideoIdentity,front:RngFrontBinding):RngCursor {
 const start=sc.operand[0],end=sc.operand[1]>0?sc.operand[1]:999,speed=sc.operand[2]>0?sc.operand[2]:16;
 return {opcodePC:pc,nextPC:pc+1,operation:0x37,operands:Array.from(sc.operand),rngNum,start,end,speed,frame:start,delay:1000/speed,phase:'blit',logicalNow:0,deadline:0,resetFrame:null,requestedMs:0,remainingMs:0,sleepStart:0,waitElapsed:0,asset,front,args:null};
}
export function finishRngPrefix(c:RngCursor,work:number):void {c.logicalNow+=work;c.phase='sleep';c.sleepStart=c.logicalNow;c.waitElapsed=0;c.requestedMs=Math.max(0,c.deadline-c.logicalNow);c.remainingMs=c.requestedMs;}
/** One scalar offset makes partial-wait JSON arithmetic exact; physical split rounding is documented. */
export function advanceRngWait(c:RngCursor,elapsed:number):void {c.waitElapsed+=elapsed;c.logicalNow=c.sleepStart+c.waitElapsed;c.remainingMs=Math.max(0,c.requestedMs-c.waitElapsed);}
export function validateRngCursor(c:RngCursor,sc:any,pc:number):boolean {
 const fields=['opcodePC','nextPC','operation','operands','rngNum','start','end','speed','frame','delay','phase','logicalNow','deadline','resetFrame','requestedMs','remainingMs','sleepStart','waitElapsed','asset','front','args'];
 if(!keys(c,fields)||sc?.operation!==0x37||c.operation!==0x37||c.opcodePC!==pc||c.nextPC!==pc+1||!Array.isArray(c.operands)||!sameJsonValue(c.operands,Array.from(sc.operand))||!c.operands.every((v,i)=>Object.prototype.hasOwnProperty.call(c.operands,i)&&integer(v)&&v<=0xffff)||Object.keys(c.operands).length!==c.operands.length||!integer(c.rngNum))return false;
 if(c.start!==sc.operand[0]||c.end!==(sc.operand[1]>0?sc.operand[1]:999)||c.speed!==(sc.operand[2]>0?sc.operand[2]:16)||c.delay!==1000/c.speed||!integer(c.frame)||c.frame<c.start||c.frame>c.end||!['fade','sleep'].includes(c.phase)||![c.logicalNow,c.deadline,c.requestedMs,c.remainingMs,c.sleepStart,c.waitElapsed].every(v=>Number.isFinite(v)&&v>=0)||c.remainingMs>c.requestedMs)return false;
 if(!keys(c.asset,['format','byteLength','digest'])||c.asset.format!=='rng-video-sha256-v1'||!integer(c.asset.byteLength)||c.asset.byteLength===0||!digest(c.asset.digest)||!keys(c.front,['pitch','width','height','byteLength','digest'])||!integer(c.front.pitch)||c.front.pitch<320||!integer(c.front.width)||c.front.width<320||c.front.width>c.front.pitch||!integer(c.front.height)||c.front.height<200||!integer(c.front.byteLength)||c.front.byteLength<c.front.pitch*c.front.height||!digest(c.front.digest))return false;
 if(c.resetFrame!==null&&(!integer(c.resetFrame)||c.resetFrame<c.start||c.resetFrame>c.frame||c.phase==='fade'&&c.resetFrame===c.frame))return false;
 // Preserve JS repeated-addition order, including the half-delay reset.
 let expected=c.resetFrame===null?0:c.delay/2;for(let i=c.resetFrame===null?c.start:c.resetFrame+1;i<=c.frame;i++)expected+=c.delay;if(c.deadline!==expected)return false;
 if(c.phase==='fade')return c.logicalNow===0&&c.sleepStart===0&&c.waitElapsed===0&&c.requestedMs===0&&c.remainingMs===0&&validateTimedFadeArgs(c.args)&&c.args?.family==='in'&&c.args.time===1;
 return c.args===null&&c.logicalNow===c.sleepStart+c.waitElapsed&&c.requestedMs===Math.max(0,c.deadline-c.sleepStart)&&c.remainingMs===Math.max(0,c.requestedMs-c.waitElapsed);
}
