import type {WorldUpdateCursor} from './world-update-cursor';
export interface PaletteRGB {r:number;g:number;b:number}
export type PaletteFamily='red'|'blend'|'color';
/** Detached native locals. Renderer/world/assets are restored by the caller. */
export interface PaletteCursor {
 opcodePC:number;nextPC:number;operation:number;operands:number[];family:PaletteFamily;
 initialized:boolean;step:number;phase:'clear'|'step'|'world'|'compose'|'screen'|'sleep'|'final';
 remainingMs:number;requestedMs:number;frameTime:number;gameSpeed:number;
 paletteId:number|null;night:boolean|null;color:number;from:boolean;delay:number;updateScene:boolean;
 original:PaletteRGB[]|null;target:PaletteRGB[]|null;working:PaletteRGB[]|null;final:PaletteRGB[]|null;
 worldUpdate?:WorldUpdateCursor;
}
export const paletteFamily=(operation:number):PaletteFamily|null=>operation===0x4f?'red':operation===0x80?'blend':operation===0x8c?'color':null;
export const clonePalette=(p:PaletteRGB[]):PaletteRGB[]=>p.map(({r,g,b})=>({r,g,b}));
export function redPaletteStep(original:PaletteRGB[],working:PaletteRGB[]):void {
 for(let j=0;j<256;j++){if(j===0x4f)continue;const p=original[j],n=working[j],target=~~((p.r+p.g+p.b)/4)+64;n.r+=Math.sign(target-n.r)*Math.min(8,Math.abs(target-n.r));if(n.g>0)n.g-=Math.min(8,n.g);if(n.b>0)n.b-=Math.min(8,n.b);}
}
export function blendPaletteStep(base:PaletteRGB[],target:PaletteRGB[],step:number):PaletteRGB[] {
 return base.map((p,j)=>({r:~~((p.r*(31-step)+target[j].r*step)/31),g:~~((p.g*(31-step)+target[j].g*step)/31),b:~~((p.b*(31-step)+target[j].b*step)/31)}));
}
export function colorPaletteStep(target:PaletteRGB[],working:PaletteRGB[],color:number,from:boolean):void {
 for(let j=0;j<256;j++){const p=target[from?j:color],n=working[j];for(const channel of ['r','g','b'] as const)n[channel]+=Math.sign(p[channel]-n[channel])*4;}
}
const rgbPalette=(p:unknown):p is PaletteRGB[]=>Array.isArray(p)&&p.length===256&&Array.from(p).every(c=>!!c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).length===3&&Object.keys(c).every(k=>['r','g','b'].includes(k))&&['r','g','b'].every(k=>typeof c[k]==='number'&&Number.isFinite(c[k])));
const equalPalette=(a:PaletteRGB[],b:PaletteRGB[])=>a.every((p,i)=>p.r===b[i].r&&p.g===b[i].g&&p.b===b[i].b);
export function validatePaletteCursor(c:PaletteCursor,sc:any,pc:number):boolean {
 const keys=['opcodePC','nextPC','operation','operands','family','initialized','step','phase','remainingMs','requestedMs','frameTime','gameSpeed','paletteId','night','color','from','delay','updateScene','original','target','working','final','worldUpdate'];
 if(!c || Object.keys(c).some(k=>!keys.includes(k)))return false;
 if(!c||!paletteFamily(c.operation)||sc?.operation!==c.operation||c.family!==paletteFamily(c.operation)||c.opcodePC!==pc||c.nextPC!==pc+1||!Array.isArray(c.operands)||JSON.stringify(c.operands)!==JSON.stringify(Array.from(sc.operand)))return false;
 if(typeof c.initialized!=='boolean'||!Number.isInteger(c.step)||c.step<0||c.step>=(c.family==='color'?64:32)||!Number.isFinite(c.frameTime)||c.frameTime<=0||!Number.isFinite(c.gameSpeed)||c.gameSpeed<=0||!Number.isFinite(c.remainingMs)||c.remainingMs<0||!Number.isFinite(c.requestedMs)||c.requestedMs<=0||c.remainingMs>c.requestedMs)return false;
 if(c.color!==(c.family==='color'?sc.operand[0]:0)||c.from!==(c.family==='color'&&!!sc.operand[2])||c.delay!==(c.family==='color'?(sc.operand[1]*5||5):5)||c.updateScene!==(c.family==='blend'&&!sc.operand[0]))return false;
 const requested=c.family==='color'?c.delay/c.gameSpeed:c.frameTime/c.gameSpeed/(c.family==='blend'&&!c.updateScene?4:1);if(c.requestedMs!==requested)return false;
 if(c.worldUpdate!==undefined&&(!c.worldUpdate||typeof c.worldUpdate!=='object'||Array.isArray(c.worldUpdate)))return false;
 if(!c.initialized)return c.phase==='clear'&&c.step===0&&c.remainingMs===0&&c.paletteId===null&&c.night===null&&c.original===null&&c.target===null&&c.working===null&&c.final===null&&c.worldUpdate===undefined;
 if(!['sleep','world','compose'].includes(c.phase)||!rgbPalette(c.original)||!rgbPalette(c.working))return false;
 if(c.phase==='world'?c.family!=='blend'||!c.updateScene||!c.worldUpdate||c.remainingMs!==0:c.worldUpdate!==undefined)return false;
 if(c.phase==='compose' && (c.family!=='blend'||!c.updateScene||c.remainingMs!==0))return false;
 if(c.family==='red') {
  if(c.paletteId!==null||c.night!==null||c.target!==null||c.final!==null)return false;
  const expected=clonePalette(c.original);for(let i=0;i<=c.step;i++)redPaletteStep(c.original,expected);return equalPalette(expected,c.working);
 }
 if(!Number.isSafeInteger(c.paletteId)||c.paletteId!<0||typeof c.night!=='boolean'||!rgbPalette(c.target))return false;
 if(c.family==='blend')return c.final===null&&equalPalette(blendPaletteStep(c.original,c.target,c.step),c.working);
 if(c.color>255||!rgbPalette(c.final)||!equalPalette(c.original,c.target))return false;
 const filled=c.target.map(()=>({...c.target![c.color]})),expected=c.from?clonePalette(filled):clonePalette(c.original);
 for(let i=0;i<=c.step;i++)colorPaletteStep(c.target,expected,c.color,c.from);
 return equalPalette(expected,c.working)&&equalPalette(c.final,c.from?c.original:filled);
}
