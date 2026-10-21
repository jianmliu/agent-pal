import {detachedData} from './execution-scheduler';
export type BattleRewardStage = 'normalize'|'summary-present'|'summary-wait'|'cash-apply'|'capture-party'|'snapshot-member'|'award-member'|'role-select'|'level-present'|'level-wait'|'hidden-select'|'hidden-present'|'hidden-wait'|'magic-select'|'magic-apply'|'magic-present'|'magic-wait'|'before-end-scripts'|'end-scripts'|'before-recovery'|'capture-recovery-party'|'recover-member'|'completed-rewards'|'returned';
export interface BattleRewardCursor {
 version:1;kind:'victory-rewards';stage:BattleRewardStage;exp:number;cash:number;boss:boolean;
 snapshotIndex:number;awardIndex:number;displayIndex:number;hiddenIndex:number;magicIndex:number;endIndex:number;recoveryIndex:number;recoverySubstep:0|1;
 selection:null|{role:number;before:any;after:any;levelUp:boolean};recovery:null|{role:number;hp:number;mp:number};
 snapshots:Record<string,any>;summaries:Record<string,any>;page:null|{kind:'summary'|'level'|'hidden'|'magic';role:number|null;label:number|null;delta:number|null;magic:number|null;timeout:number};
 wait:null|{token:number;timeout:number;remaining:number;lastPoll:number;continue:boolean};
}
const reservations=new WeakMap<BattleRewardCursor,object>();
export function createBattleRewardCursor(exp:number,cash:number,boss:boolean):BattleRewardCursor {
 if(!Number.isFinite(exp)||!Number.isFinite(cash))throw new TypeError('reward amounts must be finite');
 return {version:1,kind:'victory-rewards',stage:'normalize',exp,cash,boss,snapshotIndex:0,awardIndex:0,displayIndex:0,hiddenIndex:0,magicIndex:0,endIndex:0,recoveryIndex:0,recoverySubstep:0,selection:null,recovery:null,snapshots:{},summaries:{},page:null,wait:null};
}
const stages=new Set<BattleRewardStage>(['normalize','summary-present','summary-wait','cash-apply','capture-party','snapshot-member','award-member','role-select','level-present','level-wait','hidden-select','hidden-present','hidden-wait','magic-select','magic-apply','magic-present','magic-wait','before-end-scripts','end-scripts','before-recovery','capture-recovery-party','recover-member','completed-rewards','returned']);
export function copyBattleRewardCursor(c:BattleRewardCursor):BattleRewardCursor {
 const copy=detachedData(c),integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
 if(copy.version!==1||copy.kind!=='victory-rewards'||!stages.has(copy.stage)||typeof copy.boss!=='boolean'||typeof copy.exp!=='number'||typeof copy.cash!=='number'||![copy.snapshotIndex,copy.awardIndex,copy.displayIndex,copy.hiddenIndex,copy.magicIndex,copy.endIndex,copy.recoveryIndex].every(integer)||![0,1].includes(copy.recoverySubstep))throw new TypeError('invalid reward cursor');
 if(copy.selection&&!integer(copy.selection.role))throw new TypeError('invalid reward role selection');
 if(copy.recovery&&(!integer(copy.recovery.role)||typeof copy.recovery.hp!=='number'||typeof copy.recovery.mp!=='number'))throw new TypeError('invalid reward recovery');
 if(copy.page){const p=copy.page;if(!['summary','level','hidden','magic'].includes(p.kind)||typeof p.timeout!=='number'||p.timeout<=0||!([p.role,p.label,p.magic].every(v=>v===null||integer(v)))||!(p.delta===null||typeof p.delta==='number'))throw new TypeError('invalid reward page');}
 if(copy.wait){const w=copy.wait;if(!integer(w.token)||w.token===0||typeof w.timeout!=='number'||w.timeout<=0||typeof w.remaining!=='number'||w.remaining<0||typeof w.lastPoll!=='number'||typeof w.continue!=='boolean')throw new TypeError('invalid reward wait');}
 return copy;
}
/** Reserve before calling any synchronous native writer or renderer. Ack only after successful return. */
export function reserveRewardEffect(c:BattleRewardCursor):object {if(reservations.has(c))throw new Error('reward effect already reserved');const ticket=Object.freeze({});reservations.set(c,ticket);return ticket;}
export function ackRewardEffect(c:BattleRewardCursor,ticket:object,next:BattleRewardStage):void {if(reservations.get(c)!==ticket)throw new Error('reward effect reservation changed');reservations.delete(c);c.stage=next;}
export function rewardEffectReserved(c:BattleRewardCursor):boolean {return reservations.has(c);}
export function releaseRewardCursor(c:BattleRewardCursor):void {reservations.delete(c);}
