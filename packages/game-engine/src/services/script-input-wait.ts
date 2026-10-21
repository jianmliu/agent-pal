/** Pure presentation and branch state. The host owns rendering and input collection. */
export interface ScriptInputWait {
  kind:'input'; opcodePC:number; nextPC:number; operands:number[];
  action?:'dialog'|'shop';phase?:'page'|'window'|'clear'|'terminal';
  prompt: {kind:'confirm';noPC:number;options:[{label:'No';value:false},{label:'Yes';value:true}]} |
          {kind:'advance';options:[{label:'Continue';value:true}]};
}
export interface ScriptInputResponse {id:string;revision:number;value:boolean|import('./script-shop-cursor').ShopSelection}
export function createInputWait(opcodePC:number,sc:{operation:number;operand:ArrayLike<number>}):ScriptInputWait {
  const operands=Array.from(sc.operand);
  return {kind:'input',opcodePC,nextPC:opcodePC+1,operands,prompt:sc.operation===10
    ? {kind:'confirm',noPC:operands[0],options:[{label:'No',value:false},{label:'Yes',value:true}]}
    : {kind:'advance',options:[{label:'Continue',value:true}]}};
}
export function validateInputWait(wait:ScriptInputWait,sc:any,kind:string,pc:number,read:(pc:number)=>any):boolean {
  if (!wait || wait.opcodePC!==pc || wait.nextPC!==pc+1 || !sc || !Array.isArray(wait.operands) || wait.operands.length!==sc.operand.length || wait.operands.some((v,i)=>v!==sc.operand[i]))return false;
  if (sc.operation!==0x4d && (sc.operation!==10 || kind!=='trigger'))return false;
  const expected=createInputWait(pc,sc);
  const p=wait.prompt,e=expected.prompt;
  if(!p || p.kind!==e.kind || !Array.isArray(p.options) || p.options.length!==e.options.length || p.options.some((o,i)=>!o || o.label!==e.options[i].label || o.value!==e.options[i].value))return false;
  if(e.kind==='confirm') {
    if(p.kind!=='confirm' || p.noPC!==e.noPC)return false;
    if(e.noPC!==0) {const target=read(e.noPC);if(!target || !Number.isSafeInteger(target.operation) || target.operation<0 || target.operation>0xffff || !target.operand || target.operand.length<3 || !Array.from(target.operand).every(v=>typeof v==='number' && Number.isSafeInteger(v) && v>=0 && v<=0xffff))return false;}
  }
  return true;
}
export function validateInputResponse(value:unknown,id:string,revision:number,wait:ScriptInputWait):value is ScriptInputResponse {
  const r=value as ScriptInputResponse;
  return !!r && r.id===id && r.revision===revision && typeof r.value==='boolean' && (wait.prompt.kind==='confirm' || r.value===true);
}
/** Shared by the native confirm adapter and the owned manual response. */
export function inputNextPC(wait:Pick<ScriptInputWait,'nextPC'|'prompt'>,value:boolean):number {
  return wait.prompt.kind==='confirm' && !value ? wait.prompt.noPC : wait.nextPC;
}
