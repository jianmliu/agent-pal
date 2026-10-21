import assert from 'node:assert/strict';
import {createBattleMetrics,actionError,winningRounds} from '../battle-metrics.mjs';
function scenario(terminalAtStatus){
 const state={enemy:[],battleResult:1000,phase:0};const service={getModule:()=>null,getState:()=>state,set(keys,value){state[keys[0]]=value;},runSystems(){},*start(){state.enemy=[{objectID:546}];this.set(['phase'],1);yield null;if(terminalAtStatus)this.runSystems('status');else{this.runSystems('status');this.set(['phase'],0);this.set(['phase'],1);}yield null;state.battleResult=3;return 3;}};
 const original=service.start;const tracker=createBattleMetrics({services:{battle:service}});const battle=service.start(7,true);battle.next();assert.deepEqual(tracker.snapshot().current.enemyObjects,[546]);battle.next();battle.next();const won=tracker.snapshot().completed[0];assert.equal(won.rounds,terminalAtStatus?1:2);assert.equal(won.enemyTeam,7);assert.equal(won.outcome,'won');assert.equal(winningRounds([won]),won.rounds);tracker.dispose();assert.equal(service.start,original);
}
scenario(false);scenario(true);
assert.equal(winningRounds([{outcome:'won'}]),null);assert.equal(winningRounds([{outcome:'lost',rounds:2}]),null);
const task={battlePolicy:{forbiddenActions:['auto','flee'],forbiddenSpells:['金蟬脫殼']}};assert.ok(actionError(task,'battle',{action:'auto'}));assert.ok(actionError(task,'battle',{action:'magic',name:'金蟬'}));assert.ok(actionError(task,'battle',{action:'magic',referenceID:392}));assert.ok(actionError(task,'battle',{action:'magic',name:'酒神',referenceID:392}));assert.equal(actionError(task,'battle',{action:'magic',name:'酒神'}),null);
process.stdout.write('lazy battle lifecycle, partial/poison rounds, identity and action restrictions passed\n');
