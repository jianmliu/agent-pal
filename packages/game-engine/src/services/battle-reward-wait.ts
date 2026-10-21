import type {BattleRewardCursor} from './battle-reward-cursor';
const scopes=new WeakSet<object>();
export interface RewardWaitScope {
 deadline:number;token:number;gate:Promise<void>|null;active:boolean;parked:boolean;
 begin(token:number,timeout:number,deadline:number,binding:any):void;poll(now:number,continuing:boolean):void;
 supports(inputBinding:any):boolean;pause():Promise<void>|null;shift(elapsed:number):void;
 latch(key:number):void;takeLatched():number;setTimer(cancel:((e:unknown,primary?:()=>unknown)=>void)|null):void;close(error?:unknown,primary?:()=>unknown):void;
}
export function ownedRewardWaitScope(value:unknown):RewardWaitScope|null {return value&&typeof value==='object'&&scopes.has(value as object)?value as RewardWaitScope:null;}
export function createRewardWaitScope(cursor:BattleRewardCursor,pause:()=>Promise<void>|null,parentBinding:()=>any):RewardWaitScope {
 let binding:any=null,latched=0,cancel:((e:unknown,primary?:()=>unknown)=>void)|null=null;
 const scope:RewardWaitScope={deadline:0,token:0,gate:null,active:true,parked:false,
  supports(input:any){const p=parentBinding();return p.kind==='browser-performance'?p.performance===input.performance&&p.now===input.now:p.kind==='date'&&p.Date===input.Date&&p.getTime===input.getTime&&p.now===input.now;},
  begin(token,timeout,deadline,input){this.token=token;this.deadline=deadline;binding=input;cursor.wait={token,timeout,remaining:timeout,lastPoll:0,continue:false};},
  poll(now,continuing){if(!this.active)throw new Error('reward wait retired');cursor.wait!.lastPoll=now;cursor.wait!.remaining=Math.max(0,this.deadline-now);cursor.wait!.continue=continuing;},
  pause(){if(!this.supports(binding)||!cursor.wait?.continue)return null;this.parked=true;try{const gate=pause();if(gate)this.gate=gate;else this.parked=false;return gate;}catch(error){this.parked=false;throw error;}},
  shift(elapsed){if(!Number.isFinite(elapsed)||elapsed<0)throw new TypeError('invalid reward wait interval');this.deadline+=elapsed;this.parked=false;this.gate=null;},
  latch(key){if(this.parked)latched|=key&3;},takeLatched(){const key=latched;latched=0;return key;},
  setTimer(fn){cancel=fn;},close(error,primary){if(!this.active)return;this.active=false;this.parked=false;this.gate=null;const pending=cancel;cancel=null;pending?.(error,primary);latched=0;if(cursor.wait?.token===this.token)cursor.wait=null;}
 };
 scopes.add(scope);return scope;
}
