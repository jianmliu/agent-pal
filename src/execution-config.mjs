import {performance} from 'node:perf_hooks';
const realNow=performance.now.bind(performance);
export function resolveExecutionConfig(opts={},env=process.env){
 const rawSeed=opts.seed??env.AGENT_PAL_SEED;
 const seed=rawSeed==null||rawSeed===''?null:Number(rawSeed)>>>0;
 const clock=opts.virtualClock??env.AGENT_PAL_CLOCK;
 let virtualClock;
 if(clock==null)virtualClock=seed!==null;
 else if([true,'virtual','true','1'].includes(clock))virtualClock=true;
 else if([false,'realtime','false','0'].includes(clock))virtualClock=false;
 else throw new TypeError('clock must be virtual or realtime');
 const advancePolicy=opts.advancePolicy??env.AGENT_PAL_ADVANCE_POLICY??(virtualClock?'lockstep':'autonomous');
 const presentationPace=opts.presentationPace??env.AGENT_PAL_PRESENTATION_PACE??'fast';
 if(!['lockstep','autonomous'].includes(advancePolicy))throw new TypeError('invalid advance policy');
 if(!['fast','realtime'].includes(presentationPace))throw new TypeError('invalid presentation pace');
 if(advancePolicy==='autonomous'&&presentationPace!=='fast')throw new TypeError('presentation pacing requires lockstep');
 virtualClock=advancePolicy==='lockstep';
 return {advancePolicy,presentationPace,virtualClock,seed,speed:opts.speed??env.AGENT_PAL_SPEED??(clock==null&&virtualClock?'fast':{scene:1,battle:1})};
}
export function decisionStop(agent,engine){
 const mode=agent?.mode?.()??'uninitialized';
 const none={mode,kind:'none',inputReady:false};
 if(['busy','crashed','uninitialized'].includes(mode)||!engine)return none;
 let top;try{top=engine.services?.waits?.top?.();if(top===undefined){const frames=engine.waitFrames?.();top=frames?.at(-1);}}catch{return none;}
 const ready=t=>t&&(!t.state||t.state==='waiting');
 const result=(kind,t)=>({mode,kind,inputReady:true,token:t?.token??null,member:t?.payload?.prompt?.member??null});
 if(ready(top)){
  if(mode==='dialog'&&top.kind==='dialog')return result('dialog.advance',top);
  if(mode==='anykey'&&top.kind==='anykey'&&top.payload?.timeoutMs==null)return result('anykey.advance',top);
  if(mode==='menu'&&top.kind.startsWith('menu.')&&engine.probes?.menu)return result(top.kind,top);
  if(mode==='control'&&top.kind==='control')return result('control',top);
 }
 if(mode==='battle'&&engine.services?.battleCommandRuntime?.owned){
  const owner=engine.commandWait?.();
  if(owner?.kind==='battle.command'&&owner.state==='waiting'&&(!top||top.kind==='battle.command'))return result('battle.command',owner);
 }
 if(mode==='battle'&&!engine.services?.battleCommandRuntime?.owned){
  // Legacy UI authority is valid only during ongoing action selection.
  const st=engine.services?.battle?.getState?.();const ui=st?.UI;
  if(!engine.worldService?.isInBattle?.()||st?.battleResult!==1000||st?.phase!==0||ui?.autoAttack)return none;
  if(top&&!(['battle.command','menu.magic','menu.items'].includes(top.kind)&&ready(top)))return none;
  if(!Number.isInteger(ui?.curPlayerIndex)||ui.curPlayerIndex<0)return none;
  const kinds={1:'battle.command',2:'battle.target.enemy',3:'battle.target.player',4:'battle.target.enemy-all',5:'battle.target.player-all'};
  let kind=kinds[ui.state];
  if(ui.state===1){kind=({0:'battle.command',1:'battle.menu.magic',2:'battle.menu.item',3:'battle.menu.throw',4:'battle.menu.misc',5:'battle.menu.misc-item'})[ui.menuState];}
  if(kind)return {...result(kind,top),member:ui.curPlayerIndex};
 }
 return none;
}
export async function measureCall(fn,{virtualNow=()=>null,decision=()=>null,record=()=>{}}={}){
 const start=realNow();let v0=null;try{v0=virtualNow();}catch{}let outcome='ok';
 try{const value=await fn();if(value?.isError||value?.ok===false||value?.reply?.op==='SMSG_REJECT')outcome='error';return value;}
 catch(e){outcome='error';throw e;}
 finally{try{const v1=virtualNow();record({realElapsedMs:realNow()-start,virtualElapsedMs:v0==null||v1==null?null:v1-v0,decisionStop:decision(),outcome});}catch{/* Telemetry must never change the call result. */}}
}
