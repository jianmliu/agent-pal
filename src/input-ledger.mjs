import {AsyncLocalStorage} from 'node:async_hooks';
/** Observe input requests without changing input-service debounce or latch rules. */
export function attachInputLedger(input,{frame=()=>null,now=()=>null,record=()=>{}}={}){
 const context=new AsyncLocalStorage();
 let sequence=0,lastFrame,ordinal=0;
 for(const kind of ['simulateKeyPress','pressKey','releaseKey']){
  const original=input[kind];if(typeof original!=='function')continue;
  input[kind]=function(...args){
   try{
    const f=frame();if(f!==lastFrame){lastFrame=f;ordinal=0;}
    record({type:'logical_input',kind,sequence:++sequence,frame:f,frameOrdinal:++ordinal,logicalTimeMs:now(),key:args[0],durationMs:args[1]??null,stage:'request',root:!context.getStore()});
   }catch{/* Observability must not change input behavior. */}
   return context.run(true,()=>original.apply(this,args));
  };
 }
}

/** Replay only external requests: input-service timers reproduce derived releases. */
export async function replayInputLedger(entries,{input,clock,frame=()=>null,endTimeMs,offsetMs=0,verifyFrames=true}={}){
 if(!clock?.drive)throw new TypeError('replay requires lockstep clock');
 const inputs=entries.filter(e=>e.type==='logical_input'||e.type==null);
 if(inputs.some(e=>typeof e.root!=='boolean'))throw new TypeError('input ledger requires root provenance');
 const roots=inputs.filter(e=>e.root===true);
 let previous=clock.now();
 for(const e of roots){
  const at=e.logicalTimeMs+offsetMs;
  if(!['simulateKeyPress','pressKey','releaseKey'].includes(e.kind))throw new TypeError('invalid input kind');
  if(!Number.isFinite(at)||at<previous)throw new TypeError('input times must be ordered and not in the past');
  previous=at;
 }
 const end=endTimeMs??previous;
 if(!Number.isFinite(end)||end<previous)throw new TypeError('invalid replay end time');
 const handles=[];
 try{
  await clock.drive(new Promise((resolve,reject)=>{
   for(const e of roots)handles.push(setTimeout(()=>{
    try{
     if(verifyFrames&&e.frame!=null&&frame()!==e.frame)throw new Error(`input frame mismatch: expected ${e.frame}, got ${frame()}`);
     input[e.kind](e.key,...(e.durationMs==null?[]:[e.durationMs]));
    }catch(error){reject(error);}
   },e.logicalTimeMs+offsetMs-clock.now()));
   handles.push(setTimeout(resolve,end-clock.now()));
  }));
 }finally{for(const h of handles)clearTimeout(h);}
}

/** Replay full tool calls, including wait-service/menu responses not expressed as keys.
 * execute must use the normal serialized tool entry point. External scripts are not
 * reconstructed from raw keys alone. Validate the resulting input ledger separately.
 */
export async function replayCallLedger(entries,{execute,checkpoint=()=>{},maxCalls=1000}={}){
 const requests=entries.filter(e=>e.type==='replay_request');
 const calls=requests.length?requests:entries.filter(e=>e.type==='call'&&!e.via);
 if(calls.length>maxCalls)throw new Error('replay call limit exceeded');
 const results=[];
 for(const entry of calls){
  const result=await execute(entry.name,entry.args??{});
  await checkpoint(entry,result);
  results.push(result);
 }
 return results;
}
