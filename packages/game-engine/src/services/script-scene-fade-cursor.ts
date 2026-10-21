import {denseFadePalette} from './script-timed-fade-cursor';
import {clonePalette,type PaletteRGB} from './script-palette-cursor';
import {sameJsonValue} from './script-json-value';
import {validateWorldUpdateCursor,type WorldUpdateCursor} from './world-update-cursor';
/** Matching immutable source/assets are required; native mutable aliases are not serialized. */
export interface SceneFadeCursor {opcodePC:number;nextPC:number;operation:0x93;operands:number[];paletteId:number;night:boolean;asset:PaletteRGB[];step:number;iteration:number;level:number;phase:'clear'|'world'|'compose'|'screen'|'scale'|'sleep';remainingMs:number;worldUpdate?:WorldUpdateCursor}
export function createSceneFadeCursor(pc:number,sc:any,paletteId:number,night:boolean,asset:PaletteRGB[]):SceneFadeCursor {
 const step=(sc.operand[0]<<16>>16)||1;
 return {opcodePC:pc,nextPC:pc+1,operation:0x93,operands:Array.from(sc.operand),paletteId,night,asset:clonePalette(asset),step,iteration:0,level:step>0?0:63,phase:'clear',remainingMs:0};
}
export function validateSceneFadeCursor(c:SceneFadeCursor,sc:any,pc:number,read?:(pc:number)=>any):boolean {
 const fields=['opcodePC','nextPC','operation','operands','paletteId','night','asset','step','iteration','level','phase','remainingMs'];
 if(!c || typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!fields.includes(k)&&k!=='worldUpdate')||fields.some(k=>!Object.prototype.hasOwnProperty.call(c,k))||c.operation!==0x93||sc?.operation!==0x93||c.opcodePC!==pc||c.nextPC!==pc+1||!Array.isArray(c.operands)||Object.keys(c.operands).length!==c.operands.length||!sameJsonValue(c.operands,Array.from(sc.operand))||!Number.isSafeInteger(c.paletteId)||c.paletteId<0||typeof c.night!=='boolean'||!denseFadePalette(c.asset))return false;
 if(c.step!==((sc.operand[0]<<16>>16)||1)||!Number.isSafeInteger(c.iteration)||c.iteration<0||c.level!==(c.step>0?0:63)+c.step*c.iteration||c.level<0||c.level>=64||!['clear','world','compose','screen','scale','sleep'].includes(c.phase)||!Number.isFinite(c.remainingMs)||c.remainingMs<0||c.remainingMs>100||(c.phase!=='sleep'&&c.remainingMs!==0))return false;
 if(c.worldUpdate!==undefined && (!c.worldUpdate||c.phase!=='world'||!read||!validateWorldUpdateCursor(c.worldUpdate,read)||c.worldUpdate.pendingReturn?.field!=='autoScript'))return false;
 return true;
}
