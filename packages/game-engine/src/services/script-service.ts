import {hasBattleRewardService,rewardServiceSelection,registerRewardServiceFacade} from './battle-reward-runtime';
import {battleEndScriptRuntime,type EndScriptBinding} from './battle-end-script-runtime';
import {createBattleEndScriptCursor,type EndSource} from './battle-end-script-cursor';
import {battlePreBattleScriptRuntime,type PreBattleScriptBinding} from './battle-prebattle-script-runtime';
import {createBattlePreBattleScriptCursor,type PreBattleSource} from './battle-prebattle-script-cursor';
import {battleEnemyScriptRuntime,type EnemyScriptBinding} from './battle-enemy-script-runtime';
import {createBattleEnemyScriptCursor,type EnemyScriptSource} from './battle-enemy-script-cursor';
import type {ScriptExecutionFrame} from './script-execution-runtime';
import {battlePoisonRuntime} from './battle-poison-runtime';
import {createBattlePoisonCursor,type PoisonSource} from './battle-poison-cursor';
import { battleScriptExecution } from './battle-script-execution';
import EventBus from './event-bus.js';
import uigame from '../js/pal/uigame';
import {beforeRewardWorldTrigger} from './battle-reward-fence';
import scriptModule,{invokeBattleNativeTrigger,invokeRewardNativeWorld,rewardNativeRunnerProtected,installRewardWorldDispatch} from './script-runner.js';
import panoramaRenderer from '../js/pal/panorama-renderer.js';
import panoramaDialog from '../js/pal/panorama-dialog.js';
import config from '../js/pal/config';
import scene from '../js/pal/scene';
import worldService from './world-service';

const localOverlayState = { depth: 0, shouldRestore: false };

function getOverlayState() {
  if (typeof window !== 'undefined') {
    if (!(window as any).__PAL_CLASSIC_OVERLAY__) {
      (window as any).__PAL_CLASSIC_OVERLAY__ = { depth: 0, shouldRestore: false };
    }
    return (window as any).__PAL_CLASSIC_OVERLAY__;
  }
  return localOverlayState;
}

function setLegacyCanvasVisible(show = true) {
  if (typeof document === 'undefined') {
    return;
  }
  const canvas = document.getElementById('cvs');
  if (canvas) {
    canvas.style.display = show ? '' : 'none';
  }
}

function enterClassicOverlay() {
  const state = getOverlayState();
  if (state.depth === 0) {
    const overlayActive = typeof window !== 'undefined' && (window as any).PAL_OVERLAY_ACTIVE === 'panorama';
    const rendererActive = panoramaRenderer && typeof panoramaRenderer.getMode === 'function'
      ? panoramaRenderer.getMode() === 'panorama'
      : false;
    state.shouldRestore = config.enablePanorama && (overlayActive || rendererActive);
    if (state.shouldRestore) {
      if (typeof window !== 'undefined' && typeof (window as any).PAL_SET_OVERLAY_MODE === 'function') {
        (window as any).PAL_SET_OVERLAY_MODE('off');
      } else if (rendererActive && typeof panoramaRenderer.setMode === 'function') {
        panoramaRenderer.setMode('off');
      }
      if (panoramaDialog && typeof panoramaDialog.setMode === 'function') {
        panoramaDialog.setMode('off');
      }
    }
    setLegacyCanvasVisible(true);
    runGenerator(refreshClassicView()).catch((err) => {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[script-service] refreshClassicView failed', err);
      }
    });
  }
  state.depth += 1;
  return { shouldRestore: state.shouldRestore };
}

function exitClassicOverlay(state: { shouldRestore?: boolean }) {
  const guard = getOverlayState();
  guard.depth = Math.max(0, guard.depth - 1);
  if (!state || !state.shouldRestore || guard.depth > 0) {
    return;
  }
  if (typeof window !== 'undefined' && typeof (window as any).PAL_SET_OVERLAY_MODE === 'function') {
    (window as any).PAL_SET_OVERLAY_MODE('panorama');
  } else {
    if (panoramaRenderer && typeof panoramaRenderer.setMode === 'function') {
      panoramaRenderer.setMode('panorama');
    }
    if (panoramaDialog && typeof panoramaDialog.setMode === 'function') {
      panoramaDialog.setMode('panorama');
    }
  }
  guard.shouldRestore = false;
  setLegacyCanvasVisible(false);
}

function runGenerator(iterator: any) {
  if (typeof iterator === 'function') {
    try {
      iterator = iterator();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  if (!iterator || typeof iterator.next !== 'function') {
    return Promise.resolve(iterator);
  }
  return new Promise((resolve, reject) => {
    function step(nextFn: any, arg: any) {
      let result;
      try {
        result = nextFn.call(iterator, arg);
      } catch (err) {
        reject(err);
        return;
      }
      if (!result || result.done) {
        resolve(result && result.value);
        return;
      }
      Promise.resolve(result.value).then(
        (value) => step(iterator.next, value),
        (err) => step(iterator.throw, err)
      );
    }
    step(iterator.next, undefined);
  });
}

function* refreshClassicView() {
  if (scene && typeof scene.makeScene === 'function') {
    yield* scene.makeScene();
  }
  const targetSurface =
    (scene && scene.surface) ||
    (typeof globalThis !== 'undefined' && (globalThis as any).ui && (globalThis as any).ui.surface) ||
    null;
  if (targetSurface && typeof targetSurface.updateScreen === 'function') {
    targetSurface.updateScreen(null);
  }
}

class ScriptService extends EventBus {
  module: any;
  // Notifications belong to the service, including when an observer replaces its Runner.
  _events: Record<string, Function[]> = {};
  _activeMenuTask: Promise<any> | null;
  playerLevelUp?: (roleId: number, increment: number) => void;

  constructor(moduleRef: any = scriptModule) {
    super();
    this.module = moduleRef;
    this._activeMenuTask = null;
  }

  setModule(moduleRef: any) {
    this.module = moduleRef;
  }

  getModule() {
    return this.module;
  }

  *runTriggerScript(scriptEntry: any, eventObjectID: any): Generator<Promise<unknown>, any, unknown> {
    if(hasBattleRewardService(this)||rewardNativeRunnerProtected(this.module))throw new Error('Native battle task is opaque');
    this.fire('beforeRunTriggerScript', { scriptEntry, eventObjectID });
    const nextEntry = yield this.module.runTriggerScript(scriptEntry, eventObjectID);
    this.fire('afterRunTriggerScript', {
      scriptEntry,
      eventObjectID,
      nextEntry,
      success: this.module.scriptSuccess
    });
    return nextEntry;
  }

  /** Explicit native source adapter; generic calls remain unrelated. */
  *runBattleTriggerScript(authority: unknown, scriptEntry: any, eventObjectID: any): Generator<Promise<unknown>, any, unknown> {
    if (!battleScriptExecution.owned) return yield* this.runTriggerScript(scriptEntry,eventObjectID);
    const runner = battleScriptExecution.validate(authority);
    this.fire('beforeRunTriggerScript', {scriptEntry,eventObjectID});
    rewardServiceSelection(this);battleScriptExecution.validate(authority,runner);
    const nextEntry = yield invokeBattleNativeTrigger(runner,scriptEntry,eventObjectID,undefined,authority);
    this.fire('afterRunTriggerScript', {scriptEntry,eventObjectID,nextEntry,success:runner.scriptSuccess});
    battleScriptExecution.recordSuccess(authority, runner.scriptSuccess);
    return nextEntry;
  }

  /** Only round-end poison sources opt in; their original writer remains the return continuation. */
  *runBattlePoisonTriggerScript(authority:unknown,entry:number,event:number,source:PoisonSource,readSlot:()=>any,writer:(entry:number)=>void):Generator<Promise<unknown>,number,any> {
    if(!battlePoisonRuntime.owned){const next=yield* this.runBattleTriggerScript(authority,entry,event);writer(next);return next;}
    const runner=battleScriptExecution.validate(authority) as any;
    const cursor=createBattlePoisonCursor(source,Number.isFinite(entry)&&entry>=0?entry:0,event,{scriptSuccess:runner.scriptSuccess,curEquipPart:runner.curEquipPart});
    const live=battlePoisonRuntime.capture(authority,runner,cursor,readSlot)!;let failed=false,error:unknown;
    try {
      this.fire('beforeRunTriggerScript',{scriptEntry:entry,eventObjectID:event});battlePoisonRuntime.assert(live);
      const next=yield runner.runBattlePoisonScript(entry,event,authority,cursor,live,(childEntry:number,childEvent:number,parent:ScriptExecutionFrame)=>runGenerator(this.runBattleWorldChild(authority,runner,childEntry,childEvent,parent)) as Promise<number>);
      this.fire('afterRunTriggerScript',{scriptEntry:entry,eventObjectID:event,nextEntry:next,success:runner.scriptSuccess});
      battleScriptExecution.recordSuccess(authority,runner.scriptSuccess);battlePoisonRuntime.writeReturned(live,writer);return next;
    }catch(e){failed=true;error=e;throw e;}finally{battlePoisonRuntime.release(live,error,failed);}
  }

  /** The two enemy-loop sources keep their source-specific original return continuation. */
  *runBattleEnemyTriggerScript(authority:unknown,entry:number,event:number,source:EnemyScriptSource,readBinding:()=>EnemyScriptBinding,writer:(entry:number)=>void):Generator<Promise<unknown>,number,any> {
    if(!battleEnemyScriptRuntime.owned){const next=yield* this.runBattleTriggerScript(authority,entry,event);writer(next);return next;}
    const runner=battleScriptExecution.validate(authority) as any;
    const cursor=createBattleEnemyScriptCursor(source,entry,event,{scriptSuccess:runner.scriptSuccess,curEquipPart:runner.curEquipPart});
    const live=battleEnemyScriptRuntime.capture(authority,runner,cursor,readBinding)!;
    let failed=false,error:unknown;
    try {
      this.fire('beforeRunTriggerScript',{scriptEntry:entry,eventObjectID:event});
      battleEnemyScriptRuntime.assert(live);
      const next=yield runner.runBattleEnemyScript(entry,event,authority,cursor,live,(childEntry:number,childEvent:number,parent:ScriptExecutionFrame)=>runGenerator(this.runBattleWorldChild(authority,runner,childEntry,childEvent,parent)) as Promise<number>);
      this.fire('afterRunTriggerScript',{scriptEntry:entry,eventObjectID:event,nextEntry:next,success:runner.scriptSuccess});
      battleScriptExecution.recordSuccess(authority,runner.scriptSuccess);
      battleEnemyScriptRuntime.writeReturned(live,writer);
      return next;
    }catch(e){failed=true;error=e;throw e;}finally{battleEnemyScriptRuntime.release(live,error,failed);}
  }

  /** Original prebattle return policy; unsupported source shapes delegate before effects. */
  *runBattlePreBattleTriggerScript(authority:unknown,entry:number,event:number,source:PreBattleSource,readBinding:()=>PreBattleScriptBinding,writer:(entry:number)=>void):Generator<Promise<unknown>,number,any> {
    if(!battlePreBattleScriptRuntime.owned){const next=yield* this.runBattleTriggerScript(authority,entry,event);writer(next);return next;}
    const runner=battleScriptExecution.validate(authority) as any;
    let cursor: ReturnType<typeof createBattlePreBattleScriptCursor>;
    try {cursor=createBattlePreBattleScriptCursor(source,entry,event,{scriptSuccess:runner.scriptSuccess,curEquipPart:runner.curEquipPart});}
    catch(error) {if(!(error instanceof TypeError))throw error;const next=yield* this.runBattleTriggerScript(authority,entry,event);writer(next);return next;}
    const live=battlePreBattleScriptRuntime.capture(authority,runner,cursor,readBinding)!;
    let failed=false,error:unknown;
    try {
      this.fire('beforeRunTriggerScript',{scriptEntry:entry,eventObjectID:event});
      battlePreBattleScriptRuntime.assert(live);
      const next=yield runner.runBattlePreBattleScript(entry,event,authority,cursor,live,(childEntry:number,childEvent:number,parent:ScriptExecutionFrame)=>runGenerator(this.runBattleWorldChild(authority,runner,childEntry,childEvent,parent)) as Promise<number>);
      this.fire('afterRunTriggerScript',{scriptEntry:entry,eventObjectID:event,nextEntry:next,success:runner.scriptSuccess});
      battleScriptExecution.recordSuccess(authority,runner.scriptSuccess);
      battlePreBattleScriptRuntime.writeReturned(live,writer);
      return next;
    }catch(e){failed=true;error=e;throw e;}finally{battlePreBattleScriptRuntime.release(live,error,failed);}
  }

  /** Original prebattle return policy; unsupported source shapes delegate before effects. */
  *runBattleEndTriggerScript(authority:unknown,entry:number,event:number,source:EndSource,readBinding:()=>EndScriptBinding):Generator<Promise<unknown>,number,any> {
    if(!battleEndScriptRuntime.owned){const next=yield* this.runBattleTriggerScript(authority,entry,event);return next;}
    const runner=battleScriptExecution.validate(authority) as any;
    let cursor: ReturnType<typeof createBattleEndScriptCursor>;
    try {cursor=createBattleEndScriptCursor(source,entry,event,{scriptSuccess:runner.scriptSuccess,curEquipPart:runner.curEquipPart});}
    catch(error) {if(!(error instanceof TypeError))throw error;const next=yield* this.runBattleTriggerScript(authority,entry,event);return next;}
    const live=battleEndScriptRuntime.capture(authority,runner,cursor,readBinding)!;
    let failed=false,error:unknown;
    try {
      this.fire('beforeRunTriggerScript',{scriptEntry:entry,eventObjectID:event});
      battleEndScriptRuntime.assert(live);
      const next=yield runner.runBattleEndScript(entry,event,authority,cursor,live,(childEntry:number,childEvent:number,parent:ScriptExecutionFrame)=>runGenerator(this.runBattleWorldChild(authority,runner,childEntry,childEvent,parent)) as Promise<number>);
      this.fire('afterRunTriggerScript',{scriptEntry:entry,eventObjectID:event,nextEntry:next,success:runner.scriptSuccess});
      battleScriptExecution.recordSuccess(authority,runner.scriptSuccess);
      battleEndScriptRuntime.discardReturned(live);
      return next;
    }catch(e){failed=true;error=e;throw e;}finally{battleEndScriptRuntime.release(live,error,failed);}
  }

  /** Native play.update child notifications keep their original selected service/Runner. */
  private *runBattleWorldChild(authority:unknown,runner:any,entry:number,event:number,parent:ScriptExecutionFrame):Generator<Promise<unknown>,number,any> {
    battleScriptExecution.validate(authority,runner);
    this.fire('beforeRunTriggerScript',{scriptEntry:entry,eventObjectID:event});rewardServiceSelection(this);battleScriptExecution.validate(authority,runner);
    const next=yield invokeBattleNativeTrigger(runner,entry,event,parent,authority);
    this.fire('afterRunTriggerScript',{scriptEntry:entry,eventObjectID:event,nextEntry:next,success:runner.scriptSuccess});
    battleScriptExecution.recordSuccess(authority,runner.scriptSuccess);return next;
  }

  getBattleScriptSuccess(authority: unknown): boolean {
    return battleScriptExecution.owned ? battleScriptExecution.success(authority) : this.module.scriptSuccess;
  }

  openMenu(menu: any) {
    const key = (function resolveMenuKey(value) {
      if (!value) {
        return 'main';
      }
      if (typeof value === 'string') {
        return value.toLowerCase();
      }
      if (typeof value === 'object') {
        if (typeof value.name === 'string') {
          return value.name.toLowerCase();
        }
        if (typeof value.type === 'string') {
          return value.type.toLowerCase();
        }
      }
      return 'main';
    })(menu);

    const menuMap: Record<string, (() => any) | null> = {
      main: uigame.inGameMenu ? uigame.inGameMenu.bind(uigame) : null,
      inventory: uigame.inventoryMenu ? uigame.inventoryMenu.bind(uigame) : null,
      status: uigame.playerStatus ? uigame.playerStatus.bind(uigame) : null,
      magic: uigame.inGameMagicMenu ? uigame.inGameMagicMenu.bind(uigame) : null,
      system: uigame.systemMenu ? uigame.systemMenu.bind(uigame) : null
    };

    const handler = menuMap[key] || menuMap.main;
    if (typeof handler !== 'function') {
      return Promise.resolve(false);
    }

    if (this._activeMenuTask) {
      return this._activeMenuTask;
    }

    const task = runGenerator(function* wrappedMenu() {
      const overlayState = enterClassicOverlay();
      try {
        yield* refreshClassicView();
        return yield* handler();
      } finally {
        exitClassicOverlay(overlayState);
      }
    })
    .catch((err) => {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[script-service] openMenu failed', err);
      }
      return false;
    })
    .finally(() => {
      this._activeMenuTask = null;
    });

    this._activeMenuTask = task;
    return task;
  }

  clearAllPlayerStatus() {
    if (worldService && typeof worldService.resetPlayerStatusMatrix === 'function') {
      worldService.resetPlayerStatusMatrix();
      return true;
    }
    return false;
  }
}

const serviceInstance = new ScriptService();

const scriptService: any = new Proxy(serviceInstance as any, {
  get(target: any, prop, receiver) {
    if (prop === 'module' || prop in target) {
      return Reflect.get(target, prop, receiver);
    }
    if(prop==='runAutoScript'&&hasBattleRewardService(receiver))return ()=>Promise.reject(new Error('Native battle task is opaque'));
    if(typeof prop==='string'&&hasBattleRewardService(receiver)&&['runTriggerUntilWait','runAutoUntilWait','runEquipmentsUntilWait','runFadeUntilWait','resumeExecution','respondExecution'].includes(prop))return ()=>Promise.resolve({status:'unsupported',reason:'Native battle task is opaque'});
    const value = target.module[prop];
    if (typeof value === 'function') {
      return value.bind(target.module);
    }
    return value;
  },
  set(target: any, prop, value) {
    if (prop === 'module' || prop in target) {
      target[prop] = value;
    } else {
      target.module[prop] = value;
    }
    return true;
  },
  has(target: any, prop) {
    return prop in target || prop in target.module;
  },
  ownKeys(target: any) {
    const targetKeys = Reflect.ownKeys(target);
    const moduleKeys = Reflect.ownKeys(target.module);
    return Array.from(new Set([...targetKeys, ...moduleKeys]));
  },
  getOwnPropertyDescriptor(target: any, prop) {
    if (prop in target) {
      return Object.getOwnPropertyDescriptor(target, prop);
    }
    return Object.getOwnPropertyDescriptor(target.module, prop);
  }
});

registerRewardServiceFacade(scriptService,serviceInstance);

installRewardWorldDispatch(async(kind,entry,event,proof)=>{rewardServiceSelection(scriptService);if(kind==='auto')return invokeRewardNativeWorld(scriptService.getModule(),kind,entry,event,proof);beforeRewardWorldTrigger();scriptService.fire('beforeRunTriggerScript',{scriptEntry:entry,eventObjectID:event});const nextEntry=await invokeRewardNativeWorld(scriptService.getModule(),kind,entry,event,proof);scriptService.fire('afterRunTriggerScript',{scriptEntry:entry,eventObjectID:event,nextEntry,success:scriptService.getModule().scriptSuccess});return nextEntry;});

export { ScriptService };
export default scriptService;
