/** Detached shop state: option indices preserve duplicate shelves and captured inventory order. */
export interface ShopOption {index:number;itemId:number;enabled:boolean;flags:number;displayPrice:number;quantity:number;amountInUse:number}
export interface ShopCursor {opcodePC:number;nextPC:number;operation:number;operands:number[];mode:'buy'|'sell';phase:'initial'|'select'|'confirm';prepared:boolean;index:number;options:ShopOption[];selected:number|null}
export interface ShopMenuWait {kind:'menu';action:'shop';opcodePC:number;nextPC:number;mode:'buy'|'sell';index:number;options:ShopOption[]}
export type ShopSelection = {kind:'select';index:number}|{kind:'cancel'};
export function shopMenu(c:ShopCursor):ShopMenuWait {return {kind:'menu',action:'shop',opcodePC:c.opcodePC,nextPC:c.nextPC,mode:c.mode,index:c.index,options:c.options};}
const word=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=65535;
export function validateShopCursor(c:ShopCursor,sc:any,pc:number):boolean {
  if(!c||!sc||c.opcodePC!==pc||c.nextPC!==pc+1||![0x26,0x27].includes(sc.operation)||c.operation!==sc.operation||c.mode!==(sc.operation===0x26?'buy':'sell')||typeof c.prepared!=='boolean'||!['initial','select','confirm'].includes(c.phase)||!Array.isArray(c.operands)||JSON.stringify(c.operands)!==JSON.stringify(Array.from(sc.operand))||!Array.isArray(c.options)||c.options.length>(c.mode==='buy'?9:256)||!Number.isSafeInteger(c.index)||c.index<0||c.index>=Math.max(1,c.options.length))return false;
  if(c.phase==='initial')return c.prepared===false&&c.index===0&&c.options.length===0&&c.selected===null;
  if(!c.prepared)return false;
  if(c.options.some((o,i)=>!o||o.index!==i||!word(o.itemId)||!o.itemId||typeof o.enabled!=='boolean'||!word(o.flags)||!word(o.displayPrice)||!Number.isSafeInteger(o.quantity)||o.quantity<0||!Number.isSafeInteger(o.amountInUse)||o.amountInUse<0||(c.mode==='sell' && (o.quantity<=0 || o.enabled!==(!!(o.flags&32)&&o.quantity>o.amountInUse)))||(c.mode==='buy'&&(!o.enabled||o.quantity!==0||o.amountInUse!==0))))return false;
  return c.phase==='select'?c.selected===null:Number.isSafeInteger(c.selected)&&c.selected===c.index&&!!c.options[c.selected!]?.enabled;
}
export function validateShopSelection(value:unknown,c:ShopCursor):value is ShopSelection {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const s=value as ShopSelection;
  const keys=Object.keys(s);
  return s.kind==='cancel'?keys.length===1&&keys[0]==='kind':s.kind==='select'&&keys.length===2&&keys.includes('kind')&&keys.includes('index')&&Number.isSafeInteger(s.index)&&!!c.options[s.index]?.enabled;
}
