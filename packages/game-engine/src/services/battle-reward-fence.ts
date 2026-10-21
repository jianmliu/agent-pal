/** Exact native-parent lifetime; retained values are scalar VM identities only. */
const tasks=new WeakMap<object,ReadonlySet<string>>(),runtimes=new Map<string,number>();let count=0;
export function retainBattleRewardTask(parent:object,identities:readonly string[]):void {
 if(tasks.has(parent))throw new Error('reward native task already retained');
 if(!identities.length||identities.some(id=>typeof id!=='string'||!id))throw new TypeError('invalid reward native task identity');
 const ids=new Set(identities);tasks.set(parent,ids);count++;
 for(const id of ids)runtimes.set(id,(runtimes.get(id)||0)+1);
}
export function hasBattleRewardTask(identity:string):boolean {return runtimes.has(identity);}
export function battleRewardTaskCount():number {return count;}
/** Called only by actual parent finish, never by reward metadata retirement. */
export function releaseBattleRewardTask(parent:unknown):void {
 if(!parent||typeof parent!=='object')return;
 const ids=tasks.get(parent);if(!ids)return;tasks.delete(parent);count--;
 for(const id of ids){const remaining=(runtimes.get(id)||1)-1;if(remaining)runtimes.set(id,remaining);else runtimes.delete(id);}
}

/** Retired ambient bridge: an unrelated caller cannot create World provenance. */
export function invokeRewardWorldDispatch(_kind:'trigger'|'auto',_entry:number,_event:number):Promise<number> {throw new Error('Native battle task is opaque: World provenance required');}

const runnerIds=new WeakMap<object,string>();
export function registerRewardRunnerIdentity(runner:object,id:string):void {if(runnerIds.has(runner))throw new Error('reward Runner identity already bound');runnerIds.set(runner,id);}
export function rewardRunnerIdentity(runner:object):string|undefined {return runnerIds.get(runner);}

let beforeWorldTrigger:(()=>void)|null=null;
/** Preserve the original wait-point boundary only for trusted native World dispatch. */
export function installRewardWorldBeforeTrigger(callback:()=>void):void {beforeWorldTrigger=callback;}
export function beforeRewardWorldTrigger():void {beforeWorldTrigger?.();}
