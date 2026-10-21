import {battleRewardRuntime} from '../../services/battle-reward-runtime';
import {createBattleRewardCursor,reserveRewardEffect,ackRewardEffect,type BattleRewardStage} from '../../services/battle-reward-cursor';
import {createRewardWaitScope,type RewardWaitScope} from '../../services/battle-reward-wait';
import {rewardWaitMetadata} from '../../services/wait-points';
import {detachedData} from '../../services/execution-scheduler';
import {getHrtimeBinding} from './common';
import {battleEndScriptRuntime} from '../../services/battle-end-script-runtime';
import {battlePreBattleScriptRuntime} from '../../services/battle-prebattle-script-runtime';
import { battleLoopRuntime } from '../../services/battle-loop-runtime';
import { battleScriptExecution } from '../../services/battle-script-execution';
import { battleCommandRuntime, isOwnedBattleCancelled } from '../../services/battle-command-runtime';
import utils from './utils';
import {hrtime as battleHrtime} from './common';
import scene from './scene';
import Sprite from './sprite';
import input from './input';
import script from '../../services/script-service.js';
import music from './music';
import sound from './sound';
import resourceService from '../../services/resource-service.js';
import fight from './fight';
import ui from './ui';
import overviewController from './overview-controller.js';
import uibattle from './uibattle';
import battleService from '../../services/battle-service.js';
import createBattleSystemManager, { suspendBattleTimeCharging, activateBattleTimeCharging, captureBattleTimeChargingBasis } from '../../services/battle-systems.js';
import worldService from '../../services/world-service.js';
import panoramaRenderer from './panorama-renderer.js';
import panoramaDialog from './panorama-dialog.js';
import gameDataAdapter from '../../services/game-data-adapter.js';
import scriptObjectAdapter from '../../services/script-object-adapter.js';
import partyTrailAdapter from '../../services/party-trail-adapter.js';
import {
  shouldFadeIn,
  getPaletteIdValue as getPaletteIdSnapshot,
  isNightPaletteEnabled,
  getScreenWaveValue as getScreenWaveSnapshot,
  getWaveProgressionValue as getWaveProgressionSnapshot
} from '../../services/environment-adapter.js';
import {
  getEquipmentEffectsMatrix,
  getEquipmentEffectAt,
  getMaxPartyMemberIndex as getCachedMaxPartyMemberIndex,
  getPlayerRoleFieldValue,
  getPlayerHP as getPlayerHPValue
} from '../../services/player-state-adapter.js';
import {
  getEnemyTeamEntry as getCachedEnemyTeamEntry,
  getEnemyFormationPosition as getCachedEnemyFormationPosition,
  getBattleFieldEntry as getCachedBattleFieldEntry,
  getBattleFieldId as getCachedBattleFieldId,
  getBattleMusicTrack as getCachedBattleMusicTrack,
  getMusicTrack as getCachedMusicTrack,
  getBattleStateSnapshot
} from '../../services/battle-state-adapter.js';
import {
  Const,
  PAL_XY,
  PAL_X,
  PAL_Y,
  LoadFlag,
  GameData,
  Files
} from './pal-global';
import { sleepByFrame } from './common';

declare const log: any;
declare const global: any;
declare const window: any;
declare const BodyPart: any;

log.trace('battle module load');

const localOverlayState = { depth: 0, shouldRestore: false };

function getOverlayState() {
  if (typeof window !== 'undefined') {
    if (!window.__PAL_CLASSIC_OVERLAY__) {
      window.__PAL_CLASSIC_OVERLAY__ = { depth: 0, shouldRestore: false };
    }
    return window.__PAL_CLASSIC_OVERLAY__;
  }
  return localOverlayState;
}

var battle: any = {
  playerPos: [
    [[240, 170]],                         // one player
    [[200, 176], [256, 152]],             // two players
    [[180, 180], [234, 170], [270, 146]]  // three players
  ]
};

var surface: any = null
var systemManager: any = null;

function coerceExpBucket(bucket: any) {
  if (!bucket) {
    return bucket;
  }
  const maxRoles = Const && typeof Const.MAX_PLAYER_ROLES === 'number' ? Const.MAX_PLAYER_ROLES : 6;
  if (ArrayBuffer.isView(bucket)) {
    const view = new Uint16Array(bucket.buffer, bucket.byteOffset, Math.floor(bucket.byteLength / 2));
    if (view.length >= maxRoles * 4) {
      const list = new Array(maxRoles);
      for (let i = 0; i < maxRoles; i += 1) {
        const base = i * 4;
        list[i] = {
          exp: view[base] || 0,
          reserved: view[base + 1] || 0,
          level: view[base + 2] || 0,
          count: view[base + 3] || 0
        };
      }
      return list;
    }
    const count = Math.min(view.length, maxRoles);
    const list = new Array(count);
    for (let i = 0; i < count; i += 1) {
      list[i] = { exp: view[i] || 0, level: 0, count: 0 };
    }
    return list;
  }
  if (Array.isArray(bucket)) {
    let changed = false;
    const list = bucket.map((entry) => {
      if (typeof entry === 'number') {
        changed = true;
        return { exp: entry, level: 0, count: 0 };
      }
      return entry;
    });
    return changed ? list : bucket;
  }
  return bucket;
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

function disablePanoramaOverlay() {
  const guard = getOverlayState();
  if (guard.depth === 0) {
    const rendererActive = panoramaRenderer && typeof panoramaRenderer.getMode === 'function'
      ? panoramaRenderer.getMode() === 'panorama'
      : false;
    guard.shouldRestore = rendererActive;
    if (guard.shouldRestore) {
      if (typeof window !== 'undefined' && typeof window.PAL_SET_OVERLAY_MODE === 'function') {
        window.PAL_SET_OVERLAY_MODE('off');
      } else if (rendererActive && typeof panoramaRenderer.setMode === 'function') {
        panoramaRenderer.setMode('off');
      }
      if (panoramaDialog && typeof panoramaDialog.setMode === 'function') {
        panoramaDialog.setMode('off');
      }
    }
    setLegacyCanvasVisible(true);
    refreshClassicSurface();
  }
  guard.depth += 1;
  return { shouldRestore: guard.shouldRestore };
}

function restorePanoramaOverlay(state: any) {
  const guard = getOverlayState();
  guard.depth = Math.max(0, guard.depth - 1);
  if (!state || !state.shouldRestore || guard.depth > 0) {
    return;
  }
  if (typeof window !== 'undefined' && typeof window.PAL_SET_OVERLAY_MODE === 'function') {
    window.PAL_SET_OVERLAY_MODE('panorama');
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

function refreshClassicSurface() {
  if (!scene || typeof scene.makeScene !== 'function') {
    return;
  }
  try {
    const iterator = scene.makeScene();
    if (!iterator || typeof iterator.next !== 'function') {
      return;
    }
    runGenerator(iterator)
      .then(() => {
        const targetSurface = scene.surface || surface;
        if (targetSurface && typeof targetSurface.updateScreen === 'function') {
          targetSurface.updateScreen(null);
        }
      })
      .catch((err) => {
        console.warn('[battle] refreshClassicSurface failed', err);
      });
  } catch (err) {
    console.warn('[battle] refreshClassicSurface threw', err);
  }
}

function BATTLE() {
  const state = battleService.getState && battleService.getState();
  if (state) {
    return state;
  }
  return getBattleStateSnapshot() || {};
}

// Enemy scripts get the enemy's slot index as their event object id (SDLPAL passes i, and
// scripts address the enemy as g_Battle.rgEnemy[wEventObjectID]); it is not a scene object.
function resolveEnemyEventObjectId(index: any) {
  return index;
}

function getParty() {
  return partyTrailAdapter.getPartyState();
}


function getTriggerModeEnum() {
  if (typeof TriggerMode !== 'undefined' && TriggerMode) {
    return TriggerMode;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).TriggerMode) {
    return (globalThis as any).TriggerMode;
  }
  return {
    None: 0,
    SearchNear: 1,
    SearchNormal: 2,
    SearchFar: 3,
    TouchNear: 4,
    TouchNormal: 5,
    TouchFar: 6,
    TouchFarther: 7,
    TouchFarthest: 8
  };
}

function isSearchTriggerMode(triggerMode: any) {
  if (!Number.isFinite(triggerMode)) {
    return false;
  }
  const modes = getTriggerModeEnum();
  return triggerMode >= modes.SearchNear && triggerMode <= modes.SearchFar;
}

// An enemy's script entries are used as they are (0 = none); they are never borrowed from
// scene event objects.
function resolveEnemyScriptEntry(entry: any, _enemyIndex?: any, _fallbackKey?: string) {
  return Number.isFinite(entry) && entry > 0 ? entry : 0;
}

function getPartyMember(index: any) {
  const party = getParty();
  if (!Array.isArray(party)) {
    return null;
  }
  return party[index] || null;
}

function getMaxPartyMemberIndex() {
  const cached = getCachedMaxPartyMemberIndex();
  if (typeof cached === 'number' && cached >= -1) {
    return cached;
  }
  const partyState = getParty();
  return Array.isArray(partyState) ? partyState.length - 1 : -1;
}

function getEquipmentEffects() {
  return getEquipmentEffectsMatrix();
}

function getEquipmentEffect(index: any) {
  return getEquipmentEffectAt(index);
}

function getExpState() {
  return battleService.getExpState() || {};
}

function mutatePlayerRoles(mutator: any) {
  return battleService.mutatePlayerRoles(function(playerRoles: any) {
    if (playerRoles && typeof mutator === 'function') {
      mutator(playerRoles);
    }
    return playerRoles;
  });
}

function mutateExp(mutator: any) {
  return battleService.mutateExpState(function(exp: any) {
    if (exp && typeof mutator === 'function') {
      mutator(exp);
    }
    return exp;
  });
}

global.BattleResult = {
  Won:        3,      // player won the battle
  Lost:       1,      // player lost the battle
  Fleed:      0xFFFF, // player fleed from the battle
  Terminated: 0,      // battle terminated with scripts
  OnGoing:    1000,   // the battle is ongoing
  PreBattle:  1001,   // running pre-battle scripts
  Pause:      1002    // battle pause
};

export const FighterState = {
 Wait:        0,  // waiting time
 Com:         1,  // accepting command
 Act:         2   // doing the actual move
};
global.FighterState = FighterState;

export const BattleActionType = {
  Pass:       0,   // do nothing
  Defend:     1,   // defend
  Attack:     2,   // physical attack
  Magic:      3,   // use magic
  CoopMagic:  4,   // use cooperative magic
  Flee:       5,   // flee from the battle
  ThrowItem:  6,   // throw item onto enemy
  UseItem:    7,   // use item
  AttackMate: 8    // attack teammate (confused only)
};
global.BattleActionType = BattleActionType;

var BattleAction = battle.BattleAction = function(this: any) {
  this.reset();
};
BattleAction.prototype.reset = function(actionType: any, actionID: any, target: any, remainingTime: any) {
  this.actionType = actionType || BattleActionType.Pass;
  this.actionID = actionID || 0;
  this.target = target || 0;
  this.remainingTime = remainingTime || 0.0;

  return this;
};

var BattleEnemy = battle.BattleEnemy = function(this: any) {
  this.reset();
};
BattleEnemy.prototype.reset = function(
  objectID: any,
  e: any,
  status: any,
  timeMeter: any,
  poisons: any,
  sprite: any,
  pos: any,
  originalPos: any,
  currentFrame: any,
  state: any,
  turnStart: any,
  firstMoveDone: any,
  dualMove: any,
  scriptOnTurnStart: any,
  scriptOnBattleEnd: any,
  scriptOnReady: any,
  prevHP: any,
  colorShift: any
  ) {
  this.objectID = objectID || 0;
  this.e = e || null;
  if (this.status) {
    for (var i = 0; i < this.status.length; ++i) {
      this.status[i] = 0;
    }
  } else {
    this.status = status || new Array(PlayerStatus.All);
  }
  this.timeMeter = timeMeter || 0.0;
  if (this.poisons) {
    for (var i = 0; i < this.poisons.length; ++i) {
      const poison = this.poisons[i];
      const buffer = poison && poison.uint8Array;
      if (buffer && typeof buffer.fill === 'function') {
        buffer.fill(0, 0, PoisonStatus.size);
      } else if (poison && Array.isArray(poison)) {
        for (var j = 0; j < poison.length; ++j) {
          poison[j] = 0;
        }
      }
    }
  } else {
    this.poisons = poisons || Array.from({ length: Const.MAX_POISONS },
      () => new PoisonStatus(new Uint8Array(PoisonStatus.size)));
  }
  this.sprite = sprite || null;
  this.pos = pos || 0;
  this.originalPos = originalPos || 0;
  this.currentFrame = currentFrame || 0;
  this.state = state || FighterState.Wait;
  this.turnStart = turnStart || false;
  this.firstMoveDone = firstMoveDone || false;
  this.dualMove = dualMove || false;
  this.scriptOnTurnStart = scriptOnTurnStart || 0;
  this.scriptOnBattleEnd = scriptOnBattleEnd || 0;
  this.scriptOnReady = scriptOnReady || 0;
  this.prevHP = prevHP || 0;
  this.colorShift = colorShift || 0;

  return this;
};

var BattlePlayer = battle.BattlePlayer = function(this: any) {
  this.reset();
};
BattlePlayer.prototype.reset = function(
  colorShift: any,
  timeMeter: any,
  timeSpeedModifier: any,
  hidingTime: any,
  sprite: any,
  pos: any,
  originalPos: any,
  currentFrame: any,
  state: any,
  action: any,
  defending: any,
  prevHP: any,
  prevMP: any) {
  this.colorShift = colorShift || 0;
  this.timeMeter = timeMeter || 0.0;
  this.timeSpeedModifier = (typeof timeSpeedModifier === 'number') ? timeSpeedModifier : 1.0;
  this.hidingTime = hidingTime || 0;
  this.sprite = sprite || 0;
  this.pos = pos || 0;
  this.originalPos = originalPos || 0;
  this.state = state || FighterState.Wait;
  this.action = (this.action ?
                 this.action.reset() :
                 (action || (new (BattleAction as any)())));
  this.defending = defending || false;
  this.secondAttack = false; // fSecondAttack
  this.prevHP = prevHP || 0;
  this.prevMP = prevMP || 0;

  return this;
};

var Summon = battle.Summon = function(this: any) {
  this.reset();
};
Summon.prototype.reset = function(currentFrame: any) {
  this.currentFrame = currentFrame || 0;

  return this;
};

var MAX_BATTLE_ACTIONS = 256;
var MAX_BATTLE_ENEMIES = 256;

export const BattlePhase = {
  SelectAction:  0,
  PerformAction: 1
};
global.BattlePhase = BattlePhase;

var ActionQueue = battle.ActionQueue = function(this: any) {
  this.reset();
};
ActionQueue.prototype.reset = function(isEnemy: any, dexterity: any, index: any) {
  this.isEnemy = isEnemy || false;
  this.dexterity = dexterity || 0;
  this.index = index || 0;

  return this;
};

Const.MAX_ACTIONQUEUE_ITEMS = (Const.MAX_PLAYERS_IN_PARTY + Const.MAX_ENEMIES_IN_TEAM * 2);

var Battle = battle.Battle = function(this: any) {
  this.player = utils.initArray(BattlePlayer, Const.MAX_PLAYERS_IN_PARTY);
  this.enemy = utils.initArray(BattleEnemy, Const.MAX_ENEMIES_IN_TEAM);
  this.maxEnemyIndex = 0;
  this.sceneBuf = null;
  this.background = null;
  this.backgroundColorShift = 0;
  this.summonSprite = null;
  this.summonPos = 0;
  this.summonFrame = 0;
  this.expGained = 0;
  this.cashGained = 0;
  this.isBoss = false;
  this.enemyCleared = false;
  this.battleResult = BattleResult.Terminated;
  // Classic cooperative magic: who joins it, and whether it was used this round (then the
  // other members' actions this round do nothing).
  this.coopContributors = [];
  this.thisTurnCoop = false;
  this.UI = new (uibattle as any).BattleUI();
  this.effectSprite = new Sprite(Files.DATA.readChunk(10));
  this.enemyMoving = false;
  this.hidingTime = 0;
  this.movingPlayerIndex = 0;
  this.blow = 0;
  this.phase = BattlePhase.SelectAction;
  this.actionQueue = utils.initArray(ActionQueue, (Const as any).MAX_ACTIONQUEUE_ITEMS);
  this.curAction = 0;
  this.repeat = false;
  this.force = false;
  this.flee = false;
};



battle.init = function*(surf: any): Generator<any, any, any> {
  log.debug('[BATTLE] init');
  global.battle = battle;
  surface = surf;

  if (battleService && typeof battleService.bindModule === 'function') {
    battleService.bindModule(battle);
  }

  yield resourceService.loadMKF('DATA', 'FBP', 'ABC', 'F');
  Files.DATA = resourceService.getMKF('DATA');
  Files.FBP = resourceService.getMKF('FBP');
  Files.ABC = resourceService.getMKF('ABC');
  Files.F = resourceService.getMKF('F');

  yield (fight as any).init(surf, battle);
  yield uibattle.init(surf, battle, ui);

  battleService.replaceState(new (Battle as any)());
  systemManager = createBattleSystemManager({
    battleService: battleService,
    surface: surf,
    battle: battle
  });
  battle.systemManager = systemManager;
  if (typeof battleService.setSystemManager === 'function') {
    battleService.setSystemManager(systemManager);
  }
};

/**
 * Generate the battle scene into the scene buffer.
 */
battle.makeScene = function() {
  if (battleService && typeof battleService.runSystems === 'function') {
    battleService.runSystems('render', { surface: surface, battle: battle });
    return;
  }
  if (systemManager) {
    systemManager.run('render', { surface: surface, battle: battle });
  }
};

/**
 * Generate the battle scene and copy it to the screen buffer
 * (PAL_BattleMakeScene + VIDEO_CopyEntireSurface(g_Battle.lpSceneBuf, gpScreen)).
 */
battle.makeSceneToScreen = function() {
  battle.makeScene();
  surface.blitSurface(BATTLE().sceneBuf, null, surface.byteBuffer, null);
};

/**
 * Backup the scene buffer.
 */
battle.backupScene = function() {
  battleService.setSceneBuffer(surface.getRect(0, 0, 320, 200));
};

/**
 * Fade in the scene of battle.
 */
battle.fadeScene = function*(): Generator<any, any, any> {
  var indices = [0, 3, 1, 5, 2, 4];

  var backup = surface.backup;
  var screen = surface.byteBuffer;

  for (var i = 0; i < 12; i++) {
    for (var j = 0; j < 6; j++) {
      // Blend the pixels in the 2 buffers, and put the result into the
      // backup buffer
      for (var k = indices[j]; k < surface.pitch * surface.height; k += 6) {
        var battleState = BATTLE();
        var a = battleState.sceneBuf[k];
        var b = backup[k];

        if (i > 0) {
          if ((a & 0x0F) > (b & 0x0F))
          {
            b++;
          }
          else if ((a & 0x0F) < (b & 0x0F)) {
            b--;
          }
        }

        backup[k] = ((a & 0xF0) | (b & 0x0F));
      }

      // Draw the backup buffer to the screen
      surface.blitSurface(backup, null, screen, null);

      yield uibattle.update();
      surface.updateScreen(null);

      yield sleep(8); // 16
    }
  }

  // Draw the result buffer to the screen as the final step
  var battleState = BATTLE();
  surface.blitSurface(battleState.sceneBuf, null, screen, null);
  yield uibattle.update();
  surface.updateScreen(null);
};

/**
 * The main battle routine.
 * @yield {BattleResult} The result of the battle.
 */
battle.main = function*(battleScriptParent?: unknown): Generator<any, any, any> {
  const ownedRoot = battleCommandRuntime.capture(battle);
  let ownedResult:unknown;
  let loop: ReturnType<typeof battleLoopRuntime.capture> = null;
  let ownedError: unknown, ownedFailed = false;
  try {
  loop = battleLoopRuntime.capture(battleScriptParent,battle,ownedRoot,suspendBattleTimeCharging,activateBattleTimeCharging,battleHrtime,captureBattleTimeChargingBasis);
  surface.backupScreen();
  var screen = surface.byteBuffer;
  var sceneBuf = BATTLE().sceneBuf;

  // Generate the scene and draw the scene to the screen buffer
  battle.makeScene();
  surface.blitSurface(sceneBuf, null, screen, null);

  // Fade out the music and delay for a while
  music.play(0, false, 1);
  yield sleep(100); // 200

  // Switch the screen
  yield surface.switchScreen(5);

  // Play the battle music
  music.play(getCachedBattleMusicTrack(), true, 0);

  // Fade in the screen when needed
  if (shouldFadeIn()) {
    yield surface.fadeIn(
      getPaletteIdSnapshot(),
      !!isNightPaletteEnabled(),
      1
    );
    worldService.setNeedToFadeIn(false);
  }

  // Run the pre-battle scripts for each enemies
  var battleState = BATTLE();
  const preBattleRegion = battlePreBattleScriptRuntime.owned ? battleLoopRuntime.enterPreBattleRegion(loop) : null;
  try {
    for (var i = 0; i <= battleState.maxEnemyIndex; i++) {
      var enemyState = battleState.enemy[i];
      var eventId = resolveEnemyEventObjectId(i);
      var startScript = resolveEnemyScriptEntry(enemyState ? enemyState.scriptOnTurnStart : null, i, 'triggerScript');
      if (!Number.isFinite(startScript) || startScript <= 0) {
        continue;
      }
      yield script.runBattlePreBattleTriggerScript(battleScriptParent,startScript,eventId,
        {kind:'enemy-prebattle',enemyIndex:i,objectId:enemyState?.objectID,eventId,configuredEntry:enemyState?.scriptOnTurnStart,resolvedEntry:startScript,invocationIndex:i},
        ()=>({enemy:BATTLE().enemy[i],enemyList:BATTLE().enemy,maxEnemyIndex:BATTLE().maxEnemyIndex}),
        (nextEntry:number)=>battleService.setEnemy(i, function(current: any) {
        if (!current) return current;
        current.scriptOnTurnStart = Number.isFinite(nextEntry) && nextEntry > 0 ? nextEntry : startScript;
        return current;
      }));

      if (battleState.battleResult != BattleResult.PreBattle) {
        break;
      }
    }

  } finally {battleLoopRuntime.leavePreBattleRegion(loop,preBattleRegion);}

  if (battleState.battleResult == BattleResult.PreBattle) {
    battleService.setBattleResult(BattleResult.OnGoing);
  }

  input.clear();

  if(loop)battleScriptExecution.phase(battleScriptParent,'combat');
  battleLoopRuntime.activate(loop);
  const initialPause = battleLoopRuntime.pauseAt(loop,'initial-combat');
  if (initialPause) yield initialPause;

  // Run the main battle loop.
  while (true) {
    if (loop) {
      const stage=battleLoopRuntime.stage(loop);
      if (stage==='frame') {
        if (battleState.battleResult != BattleResult.OnGoing) break;
        battleCommandRuntime.assertRoot(ownedRoot);
        battleScriptExecution.phase(battleScriptParent,'combat');
        battleLoopRuntime.beginFrame(loop);
        yield battle.startFrame(battleScriptParent);
        battleLoopRuntime.advance(loop,'frame');
        const completed=battleLoopRuntime.consumeCompletedRound(loop);
        if (completed) {const pause=battleLoopRuntime.pauseAt(loop,'completed-round');if(pause)yield pause;}
      } else if (stage==='dispatch-command') {
        yield* battleCommandRuntime.afterFrame(ownedRoot);
        battleLoopRuntime.advance(loop,stage);
      } else if (stage==='note-frame') {
        battleService.noteBattleFrame();battleLoopRuntime.advance(loop,stage);
      } else if (stage==='present-frame') {
        surface.updateScreen(null);battleLoopRuntime.advance(loop,stage);
      } else if (stage==='frame-wait') {
        yield sleepByFrame(1);battleLoopRuntime.advance(loop,stage);
      } else break;
      continue;
    }
    // Break out if the battle ended.
    if (battleState.battleResult != BattleResult.OnGoing) {
      break;
    }

    // Run the main frame routine.
    battleCommandRuntime.assertRoot(ownedRoot);
    battleScriptExecution.phase(battleScriptParent,'combat');
    yield (battleScriptParent ? battle.startFrame(battleScriptParent) : battle.startFrame());
    yield* battleCommandRuntime.afterFrame(ownedRoot);
    battleService.noteBattleFrame();      // 战斗事件日志(M5 B3):纯记录

    // Update the screen.
    surface.updateScreen(null);

    yield sleepByFrame(1);
  }

  // Return the battle result
  var battleState = BATTLE();
  ownedResult=battleState ? battleState.battleResult : BattleResult.Terminated;
  return ownedResult;
  } catch (error) { ownedError = error; ownedFailed = true; throw error; }
  finally { battleLoopRuntime.release(loop, ownedError, ownedFailed,ownedResult); battleCommandRuntime.release(ownedRoot, ownedError, ownedFailed); }
};

/**
 * Free all the loaded sprites.
 */
battle.freeBattleSprites = function() {
  log.debug('[BATTLE] freeBattleSprites');
  // Free all the loaded sprites
  battleService.withState(function(state: any) {
    if (!state) {
      return state;
    }

    var maxPartyIndex = getMaxPartyMemberIndex();
    for (var i = 0; i <= maxPartyIndex; i++) {
      var playerState = state.player && state.player[i];
      if (playerState) {
        playerState.sprite = null;
      }
    }

    for (var j = 0; j <= state.maxEnemyIndex; j++) {
      var enemyState = state.enemy && state.enemy[j];
      if (enemyState) {
        enemyState.sprite = null;
      }
    }

    state.summonSprite = null;
    return state;
  });
};

/**
 * Get player's battle sprite.
 * @param  {Number} playerRole the player role ID.
 * @return {Number}            Number of the player's battle sprite.
 */
battle.getPlayerBattleSprite = function(playerRole: any) {
  log.trace(['[BATTLE] getPlayerBattleSprite', playerRole].join(' '));
  var w = getPlayerRoleFieldValue('spriteNumInBattle', playerRole, undefined);
  if (typeof w !== 'number') {
    w = getPlayerRoleFieldValue('spriteNum', playerRole, 0);
  }

  var equipmentEffects = getEquipmentEffects();
  var limit = Math.min(
    Array.isArray(equipmentEffects) ? equipmentEffects.length : 0,
    Const.MAX_PLAYER_EQUIPMENTS + 1
  );
  for (var i = 0; i < limit; i++) {
    var effect = equipmentEffects[i];
    if (!effect || !effect.spriteNumInBattle) {
      continue;
    }
    var overrideSource = effect.spriteNumInBattle;
    var overrideSprite = overrideSource && overrideSource[playerRole] !== undefined
      ? overrideSource[playerRole]
      : 0;
    if (overrideSprite) {
      w = overrideSprite;
    }
  }

  return w;
};

/**
 * Load all the loaded sprites.
 */
battle.loadBattleSprites = function() {
  log.debug('[BATTLE] loadBattleSprites');
  battle.freeBattleSprites();

  battleService.withState(function(state: any) {
    if (!state) {
      return state;
    }

    // Load battle sprites for players
    var party = getParty();
    var maxPartyIndex = getMaxPartyMemberIndex();
    var positionSet = battle.playerPos[Math.min(Math.max(maxPartyIndex, 0), battle.playerPos.length - 1)] || [];
    for (var i = 0; i <= maxPartyIndex; i++) {
      var playerState = state.player && state.player[i];
      var partyMember = party[i];
      if (!playerState || !partyMember) {
        continue;
      }

      var spriteNum = battle.getPlayerBattleSprite(partyMember.playerRole);
      playerState.sprite = new Sprite(Files.F.decompressChunk(spriteNum));

      // Set the default position for this player
      var positionEntry = positionSet[i] || positionSet[positionSet.length - 1] || [0, 0];
      var x = positionEntry[0];
      var y = positionEntry[1];
      var position = PAL_XY(x, y);
      playerState.originalPos = position;
      playerState.pos = position;
    }

    // Load battle sprites for enemies
    for (var enemyIndex = 0; enemyIndex < Const.MAX_ENEMIES_IN_TEAM; enemyIndex++) {
      var enemyState = state.enemy && state.enemy[enemyIndex];
      if (!enemyState || enemyState.objectID == 0) {
        continue;
      }

      var enemyDefinition = scriptObjectAdapter.getObjectEntry(enemyState.objectID);
      var enemyConfig = enemyDefinition && enemyDefinition.enemy ? enemyDefinition.enemy : null;
      var enemyID = enemyConfig ? enemyConfig.enemyID : 0;
      enemyState.sprite = new Sprite(Files.ABC.decompressChunk(enemyID));

      // Set the default position for this enemy
      var formationPos = getCachedEnemyFormationPosition(enemyIndex, state.maxEnemyIndex) as any;
      if (!formationPos || typeof formationPos.x !== 'number' || typeof formationPos.y !== 'number') {
        console.warn('[BATTLE] missing enemy formation position', {
          enemyIndex: enemyIndex,
          maxEnemyIndex: state.maxEnemyIndex
        });
      }
      var posX = formationPos && typeof formationPos.x === 'number' ? formationPos.x : 0;
      var posYBase = formationPos && typeof formationPos.y === 'number' ? formationPos.y : 0;
      var posY = posYBase + (enemyState.e ? enemyState.e.yPosOffset : 0);
      var enemyPosition = PAL_XY(posX, posY);

      // Clamp initial enemy positions to keep large sprites inside the 320x200 battle scene.
      if (enemyState.sprite && typeof enemyState.sprite.getFrame === 'function') {
        var baseFrame = enemyState.sprite.getFrame(0);
        if (baseFrame && baseFrame.width && baseFrame.height) {
          var halfWidth = Math.floor(baseFrame.width / 2);
          var safeX = Math.min(Math.max(posX, halfWidth), 320 - halfWidth);
          var safeY = Math.min(Math.max(posY, baseFrame.height), 200);
          if (safeX !== posX || safeY !== posY) {
            console.warn('[BATTLE] clamped enemy position', {
              enemyIndex: enemyIndex,
              posX: posX,
              posY: posY,
              safeX: safeX,
              safeY: safeY,
              frameWidth: baseFrame.width,
              frameHeight: baseFrame.height
            });
            enemyPosition = PAL_XY(safeX, safeY);
          }
        }
      }

      enemyState.originalPos = enemyPosition;
      enemyState.pos = enemyPosition;
    }

    return state;
  });
};

/**
 * Clone an existing enemy entry into another slot.
 * @param {Number} targetIndex index of the enemy slot to populate.
 * @param {Number} sourceIndex index of the source enemy slot.
 * @param {Object} [options]   additional options {timeMeter, colorShift}.
 * @return {BattleEnemy}
 */
battle.cloneEnemy = function(targetIndex: any, sourceIndex: any, options: any) {
  var source = battleService.getEnemy(sourceIndex);
  options = options || {};

  return battleService.setEnemy(targetIndex, function(target: any) {
    if (!target) {
      return target;
    }
    target.reset();
    if (source) {
      target.objectID = source.objectID;
      target.e = source.e
        ? (typeof source.e.copy === 'function' ? source.e.copy() : JSON.parse(JSON.stringify(source.e)))
        : null;
      target.scriptOnTurnStart = source.scriptOnTurnStart;
      target.scriptOnBattleEnd = source.scriptOnBattleEnd;
      target.scriptOnReady = source.scriptOnReady;
    } else {
      target.objectID = 0;
      target.e = null;
      target.scriptOnTurnStart = 0;
      target.scriptOnBattleEnd = 0;
      target.scriptOnReady = 0;
    }
    target.state = FighterState.Wait;
    target.timeMeter = options.timeMeter != null ? options.timeMeter : 0;
    target.colorShift = options.colorShift != null ? options.colorShift : 0;
    return target;
  });
};

/**
 * Spawn an enemy from object definition into a slot.
 * @param {Number} targetIndex index of the enemy slot.
 * @param {Number} objectID    object id describing the enemy.
 * @param {Object} [options]   additional options {timeMeter, colorShift}.
 * @return {BattleEnemy}
 */
battle.spawnEnemy = function(targetIndex: any, objectID: any, options: any) {
  options = options || {};

  var spawned = battleService.setEnemy(targetIndex, function(enemy: any) {
    if (!enemy) {
      return enemy;
    }

    enemy.reset();
    enemy.objectID = objectID;

    if (objectID && objectID !== 0xFFFF) {
      var objectEntry = scriptObjectAdapter.getObjectEntry(objectID);
      var objectEnemy = objectEntry && objectEntry.enemy ? objectEntry.enemy : null;
      if (objectEnemy) {
        enemy.e = worldService.copyEnemyTemplate(objectEnemy.enemyID);
        enemy.scriptOnTurnStart = resolveEnemyScriptEntry(objectEnemy.scriptOnTurnStart, targetIndex, 'triggerScript');
        enemy.scriptOnBattleEnd = Number.isFinite(objectEnemy.scriptOnBattleEnd) ? objectEnemy.scriptOnBattleEnd : 0;
        enemy.scriptOnReady = resolveEnemyScriptEntry(objectEnemy.scriptOnReady, targetIndex, 'autoScript');
      } else {
        enemy.e = null;
        enemy.scriptOnTurnStart = 0;
        enemy.scriptOnBattleEnd = 0;
        enemy.scriptOnReady = 0;
      }
    } else {
      enemy.e = null;
      enemy.scriptOnTurnStart = 0;
      enemy.scriptOnBattleEnd = 0;
      enemy.scriptOnReady = 0;
    }

    enemy.state = FighterState.Wait;
    enemy.timeMeter = options.timeMeter != null ? options.timeMeter : 0;
    enemy.colorShift = options.colorShift != null ? options.colorShift : 0;
    return enemy;
  });
  syncEnemyEntities();
  return spawned;
};

/**
 * Recalculate the highest occupied enemy index.
 * @return {Number} the new max enemy index.
 */
battle.recalculateMaxEnemyIndex = function() {
  var state = battleService.getState();
  if (!state || !Array.isArray(state.enemy)) {
    battleService.set('maxEnemyIndex', 0);
    return 0;
  }
  var maxIndex = 0;
  for (var i = 0; i < Const.MAX_ENEMIES_IN_TEAM && i < state.enemy.length; i++) {
    if (state.enemy[i] && state.enemy[i].objectID != 0) {
      maxIndex = i;
    }
  }
  battleService.set('maxEnemyIndex', maxIndex);
  syncEnemyEntities();
  return maxIndex;
};

// Gives enemies that joined mid-battle (division, summon) their ECS entity right away, so the
// script's own redraws already show them.
function syncEnemyEntities() {
  if (typeof battleService.syncActorComponents === 'function') {
    battleService.syncActorComponents();
  }
}

/**
 * Load the screen background picture of the battle.
 */
battle.loadBattleBackground = function() {
  log.debug('[BATTLE] loadBattleBackground');
  // Create the surface
  var background = surface.getRect(0, 0, 320, 200);
  battleService.setBackground(background);

  // Load the picture
  var buf = Files.FBP.decompressChunk(getCachedBattleFieldId() || 0);

  // Draw the picture to the surface.
  surface.blit(buf, background);
};

/**
 * Show the "you win" message and add the experience points for players.
 */
/** The owned path selects every next operation from detached cursor state. Native writers remain indivisible. */
function* wonWithRewardCursor(parent:unknown):Generator<any,any,any> {
  const grant=battleRewardRuntime.beginSettlement(parent,battle,script);
  let live:any=null,scope:RewardWaitScope|null=null,failed=false,failure:unknown;
  try{
  const initial=battleService.getState()||{};
  const amounts=detachedData({exp:initial.expGained??0,cash:initial.cashGained??0,boss:!!initial.isBoss});
  if(typeof amounts.exp==='object'||typeof amounts.cash==='object'||!Number.isFinite(Number(amounts.exp))||!Number.isFinite(Number(amounts.cash)))throw new TypeError('reward amounts must be finite plain values');
  const c=createBattleRewardCursor(Number(amounts.exp)||0,Number(amounts.cash)||0,amounts.boss);
  let party:any,max=-1,magicTable:any,selectedRow:any,selectedEntry:any,recoveryParty:any,recoveryMax=-1,endBattle:any;
  const rect=new RECT(65,60,200,100),rect1=new RECT(80,0,180,200);
  const readBinding=()=>{
    const metadata=scope?rewardWaitMetadata(scope):null,p=getParty();
    return {source:battle,helpers:[script.getModule()],aliases:[worldService.getWorldWriter(),Global,BATTLE(),battleService.getModule(),party,magicTable,selectedRow,selectedEntry,p,p[c.displayIndex],surface,input,input.waitForKey,ui,script.getModule(),globalThis.performance,globalThis.performance?.now,globalThis.Date,globalThis.Date.now,globalThis.Date.prototype.getTime,metadata?.writer],
      data:{helperIdentity:script.getModule().getExecutionRuntime().identity,result:BATTLE().battleResult,partyMax:getMaxPartyMemberIndex(),party:p.slice(0,getMaxPartyMemberIndex()+1).map((m:any)=>m?m.playerRole:null),row:selectedEntry?{level:selectedEntry.level??null,magic:selectedEntry.magic??null}:null,wait:metadata?.frame??null}};
  };
  live=battleRewardRuntime.capture(parent,battle,c,readBinding)!;
  const effect=(next:BattleRewardStage,fn:()=>void)=>{battleRewardRuntime.assert(live);const ticket=reserveRewardEffect(c);fn();battleRewardRuntime.assert(live);ackRewardEffect(c,ticket,next);};
  const page=(kind:'summary'|'level'|'hidden'|'magic',role:number|null,timeout:number,label:number|null=null,delta:number|null=null,magic:number|null=null)=>{c.page={kind,role,timeout,label,delta,magic};};
  const fields=['maxHP','maxMP','attackStrength','magicStrength','defense','dexterity','fleeRate'];
  const labels=[ui.STATUS_LABEL_HP,ui.STATUS_LABEL_MP,ui.STATUS_LABEL_ATTACKPOWER,ui.STATUS_LABEL_MAGICPOWER,ui.STATUS_LABEL_RESISTANCE,ui.STATUS_LABEL_DEXTERITY,ui.STATUS_LABEL_FLEERATE];
   while(c.stage!=='returned'){
    battleRewardRuntime.assert(live);
    switch(c.stage){
     case 'normalize':effect(c.exp>0||c.cash>0?'summary-present':'cash-apply',()=>{battleService.set(['expGained'],c.exp);battleService.set(['cashGained'],c.cash);});break;
     case 'summary-present':effect('summary-wait',()=>{page('summary',null,c.boss?5500:3000);presentRewardSummary(c.exp,c.cash,c.boss,rect);});break;
     case 'summary-wait':case 'level-wait':case 'hidden-wait':case 'magic-wait':{
       const stage=c.stage;
       scope=createRewardWaitScope(c,()=>battleRewardRuntime.pauseAt(live),()=>getHrtimeBinding());battleRewardRuntime.setWait(live,scope);
       yield input.waitForKey(c.page!.timeout,scope);
       battleRewardRuntime.setWait(live,null);scope=null;c.page=null;
       if(stage==='summary-wait')c.stage='cash-apply';else if(stage==='level-wait')c.stage='hidden-select';else if(stage==='hidden-wait'){c.hiddenIndex++;c.stage='hidden-select';}else{c.magicIndex++;selectedRow=null;selectedEntry=null;c.stage='magic-select';}
       break;
     }
     case 'cash-apply':effect('capture-party',()=>{worldService.adjustCash(c.cash);});break;
     case 'capture-party':effect('snapshot-member',()=>{party=getParty();max=getMaxPartyMemberIndex();});break;
     case 'snapshot-member':
       if(c.snapshotIndex>max){c.stage='award-member';break;}
       effect('snapshot-member',()=>{const member=party[c.snapshotIndex];if(member)c.snapshots[member.playerRole]=detachedData(battleService.getPlayerSnapshot(member.playerRole));c.snapshotIndex++;});break;
     case 'award-member':
       if(c.awardIndex>max){effect('role-select',()=>{magicTable=gameDataAdapter.getLevelUpMagicTable()||[];});break;}
       effect('award-member',()=>{const member=party[c.awardIndex];if(member)c.summaries[member.playerRole]=detachedData(battleService.awardExp(member.playerRole,c.exp));c.awardIndex++;});break;
     case 'role-select':
       if(c.displayIndex>max){c.selection=null;c.stage='before-end-scripts';break;}
       effect('role-select',()=>{
        const member=party[c.displayIndex];
        if(!member){c.displayIndex++;return;}
        const role=member.playerRole,summary=c.summaries[role]||{before:c.snapshots[role],after:c.snapshots[role],levelUp:false};
        const before=summary.before||c.snapshots[role]||battleService.getPlayerSnapshot(role),after=summary.after||battleService.getPlayerSnapshot(role);
        if(!before||!after){c.displayIndex++;return;}
        c.selection=detachedData({role,before,after,levelUp:!!summary.levelUp});c.hiddenIndex=0;c.magicIndex=0;
       });
       if(c.selection)c.stage=c.selection.levelUp?'level-present':'hidden-select';break;
     case 'level-present':effect('level-wait',()=>{page('level',c.selection!.role,3000);presentRewardLevel(c.selection!.before,c.selection!.after,rect1);});break;
     case 'hidden-select':{
       if(c.hiddenIndex>=fields.length){c.stage='magic-select';break;}
       const selected=c.selection!,field=fields[c.hiddenIndex],delta=selected.after[field]-selected.before[field];
       if(!delta||delta<=0){c.hiddenIndex++;break;}
       page('hidden',selected.role,3000,labels[c.hiddenIndex],delta);c.stage='hidden-present';break;
     }
     case 'hidden-present':effect('hidden-wait',()=>{presentRewardHidden(c.selection!.after,c.page!.label,c.page!.delta,rect);});break;
     case 'magic-select':{
       if(c.magicIndex>=magicTable.length){c.displayIndex++;c.selection=null;c.stage='role-select';break;}
       selectedRow=magicTable[c.magicIndex];selectedEntry=selectedRow&&Array.isArray(selectedRow.m)?selectedRow.m[c.selection!.role]:null;
       if(!selectedEntry||!selectedEntry.magic||selectedEntry.level>c.selection!.after.level){c.magicIndex++;selectedRow=null;selectedEntry=null;break;}
       page('magic',c.selection!.role,3000,null,null,selectedEntry.magic);c.stage='magic-apply';break;
     }
     case 'magic-apply':{
       let added=false;effect('magic-select',()=>{added=script.addMagic(c.selection!.role,c.page!.magic);});
       if(added)c.stage='magic-present';else{c.magicIndex++;c.page=null;selectedRow=null;selectedEntry=null;}break;
     }
     case 'magic-present':effect('magic-wait',()=>{presentRewardMagic(c.selection!.after,c.page!.magic,rect);});break;
     case 'before-end-scripts':{
       const gate=battleRewardRuntime.pauseAt(live);if(gate)yield gate;
       battleRewardRuntime.enterEndScripts(live);endBattle=BATTLE();break;
     }
     case 'end-scripts':{
       if(c.endIndex>endBattle.maxEnemyIndex){battleRewardRuntime.leaveEndScripts(live);break;}
       const index=c.endIndex,eventId=resolveEnemyEventObjectId(index),enemy=endBattle.enemy[index];
       const entry=resolveEnemyScriptEntry(enemy?enemy.scriptOnBattleEnd:null,index,'triggerScript');
       if(Number.isFinite(entry)&&entry>0)yield script.runBattleEndTriggerScript(parent,entry,eventId,
         {version:1,kind:'enemy-battle-end',enemyIndex:index,objectId:enemy?.objectID,eventId,configuredEntry:enemy?.scriptOnBattleEnd,resolvedEntry:entry,invocationIndex:index,returnPolicy:'discard'},
         ()=>({enemy:BATTLE().enemy[index],enemyList:BATTLE().enemy,maxEnemyIndex:BATTLE().maxEnemyIndex}));
       battleRewardRuntime.assert(live);c.endIndex++;break;
     }
     case 'before-recovery':{
       const gate=battleRewardRuntime.pauseAt(live);if(gate)yield gate;c.stage='capture-recovery-party';break;
     }
     case 'capture-recovery-party':effect('recover-member',()=>{recoveryParty=getParty();recoveryMax=getMaxPartyMemberIndex();});break;
     case 'recover-member':
       if(c.recoveryIndex>recoveryMax){c.recovery=null;c.stage='completed-rewards';break;}
       if(c.recoverySubstep===0){effect('recover-member',()=>{
         const entry=recoveryParty[c.recoveryIndex],stats=entry?battleService.getPlayerSnapshot(entry.playerRole):null;
         if(!stats){c.recoveryIndex++;return;}
         c.recovery={role:entry.playerRole,hp:Math.min(stats.hp+Math.floor((stats.maxHP-stats.hp)/2),stats.maxHP),mp:Math.min(stats.mp+Math.floor((stats.maxMP-stats.mp)/2),stats.maxMP)};
         battleService.setPlayerHP(c.recovery.role,c.recovery.hp);c.recoverySubstep=1;
       });}else effect('recover-member',()=>{battleService.setPlayerMP(c.recovery!.role,c.recovery!.mp);c.recoveryIndex++;c.recoverySubstep=0;c.recovery=null;});break;
     case 'completed-rewards':{
       const gate=battleRewardRuntime.pauseAt(live);if(gate)yield gate;c.stage='returned';break;
     }
    }
   }
  }catch(error){failed=true;failure=error;throw error;}finally{let teardownFailed=false,teardown:unknown;for(const close of [()=>scope?.close(failure),()=>battleRewardRuntime.release(live,failure,failed),()=>battleRewardRuntime.closePending(grant)]){try{close();}catch(error){if(!teardownFailed){teardownFailed=true;teardown=error;}}}if(teardownFailed&&!failed)throw teardown;}
}

function presentRewardSummary(expGained:number,cashGained:number,isBossBattle:boolean,rect:any) {
    music.play(isBossBattle ? 2 : 3, false, 0);

    ui.createSingleLineBox(PAL_XY(83, 60), 8, false);
    ui.createSingleLineBox(PAL_XY(65, 105), 10, false);

    ui.drawText(ui.getWord(ui.BATTLEWIN_GETEXP_LABEL), PAL_XY(95, 70), 0, false, false);
    ui.drawText(ui.getWord(ui.BATTLEWIN_BEATENEMY_LABEL), PAL_XY(77, 115), 0, false, false);
    ui.drawText(ui.getWord(ui.BATTLEWIN_DOLLAR_LABEL), PAL_XY(197, 115), 0, false, false);

    ui.drawNumber(expGained, 5, PAL_XY(182, 74), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(cashGained, 5, PAL_XY(162, 119), NumColor.Yellow, NumAlign.Mid);

    surface.updateScreen(rect);
}
function presentRewardLevel(beforeStats:any,afterStats:any,rect1:any) {
      ui.createSingleLineBox(PAL_XY(80, 0), 10, false);
      ui.createBox(PAL_XY(82, 32), 7, 8, 1, false);

      ui.drawText(ui.getWord(afterStats.nameId || 0), PAL_XY(110, 10), 0, false, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_LEVEL), PAL_XY(110 + 16 * 3, 10), 0, false, false);
      ui.drawText(ui.getWord(ui.BATTLEWIN_LEVELUP_LABEL), PAL_XY(110 + 16 * 5, 10), 0, false, false);

      for (var arrowIndex = 0; arrowIndex < 8; arrowIndex++) {
        var arrowFrame = ui.sprite.getFrame(ui.SPRITENUM_ARROW);
        surface.blitRLE(arrowFrame, PAL_XY(183, 48 + 18 * arrowIndex));
      }

      ui.drawText(ui.getWord(ui.STATUS_LABEL_LEVEL), PAL_XY(100, 44), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_HP), PAL_XY(100, 62), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_MP), PAL_XY(100, 80), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_ATTACKPOWER), PAL_XY(100, 98), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_MAGICPOWER), PAL_XY(100, 116), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_RESISTANCE), PAL_XY(100, 134), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_DEXTERITY), PAL_XY(100, 152), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);
      ui.drawText(ui.getWord(ui.STATUS_LABEL_FLEERATE), PAL_XY(100, 170), ui.BATTLEWIN_LEVELUP_LABEL_COLOR, true, false);

      ui.drawNumber(beforeStats.level, 4, PAL_XY(133, 47), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.level, 4, PAL_XY(195, 47), NumColor.Yellow, NumAlign.Right);

      ui.drawNumber(beforeStats.hp, 4, PAL_XY(133, 64), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(beforeStats.maxHP, 4, PAL_XY(154, 68), NumColor.Blue, NumAlign.Right);
      surface.blitRLE(ui.sprite.getFrame(ui.SPRITENUM_SLASH), PAL_XY(156, 66));
      ui.drawNumber(afterStats.hp, 4, PAL_XY(195, 64), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.maxHP, 4, PAL_XY(216, 68), NumColor.Blue, NumAlign.Right);
      surface.blitRLE(ui.sprite.getFrame(ui.SPRITENUM_SLASH), PAL_XY(218, 66));

      ui.drawNumber(beforeStats.mp, 4, PAL_XY(133, 82), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(beforeStats.maxMP, 4, PAL_XY(154, 86), NumColor.Blue, NumAlign.Right);
      surface.blitRLE(ui.sprite.getFrame(ui.SPRITENUM_SLASH), PAL_XY(156, 84));
      ui.drawNumber(afterStats.mp, 4, PAL_XY(195, 82), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.maxMP, 4, PAL_XY(216, 86), NumColor.Blue, NumAlign.Right);
      surface.blitRLE(ui.sprite.getFrame(ui.SPRITENUM_SLASH), PAL_XY(218, 84));

      ui.drawNumber(beforeStats.attackStrength, 4, PAL_XY(133, 101), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.attackStrength, 4, PAL_XY(195, 101), NumColor.Yellow, NumAlign.Right);

      ui.drawNumber(beforeStats.magicStrength, 4, PAL_XY(133, 119), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.magicStrength, 4, PAL_XY(195, 119), NumColor.Yellow, NumAlign.Right);

      ui.drawNumber(beforeStats.defense, 4, PAL_XY(133, 137), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.defense, 4, PAL_XY(195, 137), NumColor.Yellow, NumAlign.Right);

      ui.drawNumber(beforeStats.dexterity, 4, PAL_XY(133, 155), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.dexterity, 4, PAL_XY(195, 155), NumColor.Yellow, NumAlign.Right);

      ui.drawNumber(beforeStats.fleeRate, 4, PAL_XY(133, 173), NumColor.Yellow, NumAlign.Right);
      ui.drawNumber(afterStats.fleeRate, 4, PAL_XY(195, 173), NumColor.Yellow, NumAlign.Right);

      surface.updateScreen(rect1);
}
function presentRewardHidden(afterStats:any,labelId:any,delta:any,rect:any) {
    ui.createSingleLineBox(PAL_XY(83, 60), 8, false);
    ui.drawText(ui.getWord(afterStats.nameId || 0), PAL_XY(95, 70), 0, false, false);
    ui.drawText(ui.getWord(labelId), PAL_XY(143, 70), 0, false, false);
    ui.drawText(ui.getWord(ui.BATTLEWIN_LEVELUP_LABEL), PAL_XY(175, 70), 0, false, false);
    ui.drawNumber(delta, 5, PAL_XY(188, 74), NumColor.Yellow, NumAlign.Right);
    surface.updateScreen(rect);
}
function presentRewardMagic(afterStats:any,magicId:any,rect:any) {
        ui.createSingleLineBox(PAL_XY(65, 105), 10, false);
        ui.drawText(ui.getWord(afterStats.nameId || 0), PAL_XY(75, 115), 0, false, false);
        ui.drawText(ui.getWord(ui.BATTLEWIN_ADDMAGIC_LABEL), PAL_XY(75 + 16 * 3, 115), 0, false, false);
        ui.drawText(ui.getWord(magicId), PAL_XY(75 + 16 * 5, 115), 0x1B, false, false);
        surface.updateScreen(rect);
}
battle.won = function*(battleScriptParent?: unknown): Generator<any, any, any> {
  if(battleRewardRuntime.owned)return yield* wonWithRewardCursor(battleScriptParent);
  var rect = new RECT(65, 60, 200, 100);
  var rect1 = new RECT(80, 0, 180, 200);

  var battleState = battleService.getState() || {};
  var expGained = Number(battleState.expGained) || 0;
  var cashGained = Number(battleState.cashGained) || 0;
  battleService.set(['expGained'], expGained);
  battleService.set(['cashGained'], cashGained);
  var isBossBattle = !!battleState.isBoss;

  if (expGained > 0 || cashGained > 0) {
    presentRewardSummary(expGained,cashGained,isBossBattle,rect);
    yield input.waitForKey(isBossBattle ? 5500 : 3000);
  }

  worldService.adjustCash(cashGained);

  var party = getParty();
  var maxPartyIndex = getMaxPartyMemberIndex();
  var snapshots: any = {};

  for (var i = 0; i <= maxPartyIndex; i++) {
    var initialMember = party[i];
    if (!initialMember) continue;
    snapshots[initialMember.playerRole] = battleService.getPlayerSnapshot(initialMember.playerRole);
  }

  var awardSummaries: any = {};
  for (var awardIndex = 0; awardIndex <= maxPartyIndex; awardIndex++) {
    var awardMember = party[awardIndex];
    if (!awardMember) continue;
    awardSummaries[awardMember.playerRole] = battleService.awardExp(awardMember.playerRole, expGained);
  }

  var levelUpMagicTable = gameDataAdapter.getLevelUpMagicTable() || [];

  function* showHiddenIncrease(afterStats: any, labelId: any, delta: any): Generator<any, any, any> {
    if (!delta || delta <= 0) {
      return;
    }
    presentRewardHidden(afterStats,labelId,delta,rect);
    yield input.waitForKey(3000);
  }

  for (var partyIndex = 0; partyIndex <= maxPartyIndex; partyIndex++) {
    var partyMember = party[partyIndex];
    if (!partyMember) continue;

    var roleId = partyMember.playerRole;
    var summary = awardSummaries[roleId] || { before: snapshots[roleId], after: snapshots[roleId], levelUp: false };
    var beforeStats = summary.before || snapshots[roleId] || battleService.getPlayerSnapshot(roleId);
    var afterStats = summary.after || battleService.getPlayerSnapshot(roleId);
    if (!beforeStats || !afterStats) {
      continue;
    }

    if (summary.levelUp) {
      presentRewardLevel(beforeStats,afterStats,rect1);
      yield input.waitForKey(3000);
    }

    yield* showHiddenIncrease(afterStats, ui.STATUS_LABEL_HP, afterStats.maxHP - beforeStats.maxHP);
    yield* showHiddenIncrease(afterStats, ui.STATUS_LABEL_MP, afterStats.maxMP - beforeStats.maxMP);
    yield* showHiddenIncrease(afterStats, ui.STATUS_LABEL_ATTACKPOWER, afterStats.attackStrength - beforeStats.attackStrength);
    yield* showHiddenIncrease(afterStats, ui.STATUS_LABEL_MAGICPOWER, afterStats.magicStrength - beforeStats.magicStrength);
    yield* showHiddenIncrease(afterStats, ui.STATUS_LABEL_RESISTANCE, afterStats.defense - beforeStats.defense);
    yield* showHiddenIncrease(afterStats, ui.STATUS_LABEL_DEXTERITY, afterStats.dexterity - beforeStats.dexterity);
    yield* showHiddenIncrease(afterStats, ui.STATUS_LABEL_FLEERATE, afterStats.fleeRate - beforeStats.fleeRate);

    for (var magicIndex = 0; magicIndex < levelUpMagicTable.length; ++magicIndex) {
      var magicLevelEntry = levelUpMagicTable[magicIndex];
      if (!magicLevelEntry || !Array.isArray(magicLevelEntry.m)) {
        continue;
      }
      var levelEntry = magicLevelEntry.m[roleId];
      if (!levelEntry) {
        continue;
      }
      var requiredLevel = levelEntry.level;
      var magicId = levelEntry.magic;
      if (!magicId || requiredLevel > afterStats.level) {
        continue;
      }
      if (script.addMagic(roleId, magicId)) {
        presentRewardMagic(afterStats,magicId,rect);
        yield input.waitForKey(3000);
      }
    }
  }

  battleState = BATTLE();
  const endRegion = battleEndScriptRuntime.owned ? battleLoopRuntime.enterRewardsScriptRegion(battleScriptParent,battle,()=>hrtime()) : null;
  try {
  for (var enemyIndex = 0; enemyIndex <= battleState.maxEnemyIndex; enemyIndex++) {
    var eventId = resolveEnemyEventObjectId(enemyIndex);
    var battleEndScript = resolveEnemyScriptEntry(battleState.enemy[enemyIndex] ? battleState.enemy[enemyIndex].scriptOnBattleEnd : null, enemyIndex, 'triggerScript');
    if (Number.isFinite(battleEndScript) && battleEndScript > 0) {
      const enemyState=battleState.enemy[enemyIndex],sourceIndex=enemyIndex;
      yield script.runBattleEndTriggerScript(battleScriptParent,battleEndScript,eventId,
        {version:1,kind:'enemy-battle-end',enemyIndex:sourceIndex,objectId:enemyState?.objectID,eventId,configuredEntry:enemyState?.scriptOnBattleEnd,resolvedEntry:battleEndScript,invocationIndex:sourceIndex,returnPolicy:'discard'},
        ()=>({enemy:BATTLE().enemy[sourceIndex],enemyList:BATTLE().enemy,maxEnemyIndex:BATTLE().maxEnemyIndex}));

    }
  }

  } finally {battleLoopRuntime.leaveRewardsScriptRegion(battleScriptParent,endRegion);}

  var postBattleParty = getParty();
  var postBattleMaxIndex = getMaxPartyMemberIndex();
  for (var recoverIndex = 0; recoverIndex <= postBattleMaxIndex; recoverIndex++) {
    var recoverEntry = postBattleParty[recoverIndex];
    if (!recoverEntry) continue;
    var recoverRole = recoverEntry.playerRole;
    var stats = battleService.getPlayerSnapshot(recoverRole);
    if (!stats) continue;
    var newHP = stats.hp + Math.floor((stats.maxHP - stats.hp) / 2);
    var newMP = stats.mp + Math.floor((stats.maxMP - stats.mp) / 2);
    newHP = Math.min(newHP, stats.maxHP);
    newMP = Math.min(newMP, stats.maxMP);
    battleService.setPlayerHP(recoverRole, newHP);
    battleService.setPlayerMP(recoverRole, newMP);
  }
};

/**
 * Enemy flee the battle.
 */
battle.enemyEscape = function*(): Generator<any, any, any> {
  sound.play(45);

  var battleState = BATTLE();
  var f = true;
  // Show the animation
  while (f) {
    f = false;

    for (var j = 0; j <= battleState.maxEnemyIndex; j++) {
      var enemy = battleState.enemy[j];
      if (enemy.objectID == 0) {
        continue;
      }

      var x = PAL_X(enemy.pos) - 5;
      var y = PAL_Y(enemy.pos);

      enemy.pos = PAL_XY(x, y);

      var frame = enemy.sprite.getFrame(0);
      var w = frame.width;

      if (x + w > 0) {
        f = true;
      }
    }

    battle.makeScene();
    surface.blitSurface(battleState.sceneBuf, null, surface.byteBuffer, null);
    surface.updateScreen(null);

    yield sleep(10);
  }

  yield sleep(500)
  battleService.setBattleResult(BattleResult.Terminated);
};

/**
 * Player flee the battle.
 */
battle.playerEscape = function*(): Generator<any, any, any> {
  sound.play(45);

  var battleState = BATTLE();
  battle.updateFighters();
  var playerRole;

  var escapeParty = getParty();
  var escapeMaxIndex = getMaxPartyMemberIndex();
  for (var i = 0; i <= escapeMaxIndex; i++) {
    var escapeMember = escapeParty[i];
    if (!escapeMember) {
      continue;
    }
    playerRole = escapeMember.playerRole;

    if (getPlayerHPValue(playerRole) > 0) {
      battleService.setPlayer(i, function(playerState: any) {
        if (!playerState) return playerState;
        playerState.currentFrame = 0;
        return playerState;
      });
    }
  }

  for (var i = 0; i < 16; i++) {
    for (var j = 0; j <= escapeMaxIndex; j++) {
      var movingMember = escapeParty[j];
      if (!movingMember) {
        continue;
      }
      playerRole = movingMember.playerRole;
      var player = battleState.player[j];

      if (getPlayerHPValue(playerRole) > 0) {
        // TODO: This is still not the same as the original game
        switch (j) {
          case 0:
            if (escapeMaxIndex > 0) {
              player.pos = PAL_XY(PAL_X(player.pos) + 4, PAL_Y(player.pos) + 6);
              break;
            }

          case 1:
            player.pos = PAL_XY(PAL_X(player.pos) + 4, PAL_Y(player.pos) + 4);
            break;

          case 2:
            player.pos = PAL_XY(PAL_X(player.pos) + 6, PAL_Y(player.pos) + 3);
            break;

          default:
            throw 'should not be here';
        }
      }
    }

    yield battle.delay(1, 0, false);
  }

  // Remove all players from the screen
  for (var i = 0; i <= escapeMaxIndex; i++) {
    battleService.setPlayer(i, function(playerState: any) {
      if (!playerState) {
        return playerState;
      }
      playerState.pos = PAL_XY(9999, 9999);
      return playerState;
    });
  }

  yield battle.delay(1, 0, false);

  battleService.setBattleResult(BattleResult.Fleed);
};

/**
 * Start a battle.
 * @param {Number}  enemyTeam     the number of the enemy team.
 * @param {Boolean} isBoss        true for boss fight (not allowed to flee).
 * @yield {BattleResult}  The result of the battle.
 */
battle.start = function*(enemyTeam: any, isBoss: any, battleScriptParent?: unknown): Generator<any, any, any> {
  log.debug(['[BATTLE] start', enemyTeam, isBoss].join(' '));
  // Set the screen waving effects
  var prevWaveLevel = getScreenWaveSnapshot() || 0;
  var prevWaveProgression = getWaveProgressionSnapshot() || 0;

  worldService.setWaveProgression(0);
  var battleFieldIndex = getCachedBattleFieldId() || 0;
  var battleFieldConfig = getCachedBattleFieldEntry(battleFieldIndex) as any;
  worldService.setScreenWave(battleFieldConfig && typeof battleFieldConfig.screenWave === 'number' ? battleFieldConfig.screenWave : 0);

  var party = getParty();
  var maxPartyIndex = getMaxPartyMemberIndex();

  // Make sure everyone in the party is alive, also clear all hidden
  // EXP count records
  for (var i = 0; i <= maxPartyIndex; i++) {
    var partyMember = party[i];
    if (!partyMember) {
      continue;
    }
    var w = partyMember.playerRole;
    var roleIndex = w;

    if (getPlayerHPValue(w) === 0) {
      worldService.setPlayerHP(w, 1);
      worldService.mutatePlayerStatusEntry(w, function(row) {
        if (row) {
          row[PlayerStatus.Puppet] = 0;
        }
        return row;
      });
    }

    battleService.mutateExpState(function(exp: any) {
      if (!exp || typeof roleIndex !== 'number') {
        return exp;
      }
      var bucketNames = [
        'healthExp',
        'magicExp',
        'attackExp',
        'magicPowerExp',
        'defenseExp',
        'dexterityExp',
        'fleeExp'
      ];
      for (var bucketIdx = 0; bucketIdx < bucketNames.length; bucketIdx++) {
        var name = bucketNames[bucketIdx];
        var bucket = exp[name];
        if (!bucket) {
          continue;
        }
        var normalizedBucket = coerceExpBucket(bucket);
        if (normalizedBucket !== bucket) {
          exp[name] = normalizedBucket;
          bucket = normalizedBucket;
        }
        var entry = bucket && bucket[roleIndex];
        if (!entry) {
          continue;
        }
        if (typeof entry === 'number') {
          entry = { exp: entry, level: 0, count: 0 };
          bucket[roleIndex] = entry;
        }
        if (entry && typeof entry === 'object') {
          entry.count = 0;
        }
      }
      return exp;
    });
  }

  // Clear all item-using records
  worldService.mutateInventory(function(inventory) {
    if (!Array.isArray(inventory)) {
      return inventory;
    }
    for (var idx = 0; idx < Const.MAX_INVENTORY && idx < inventory.length; idx++) {
      var slot = inventory[idx];
      if (slot) {
        slot.amountInUse = 0;
      }
    }
    return inventory;
  });

  battleService.withState(function(state: any) {
    if (!state) {
      return state;
    }

    var computedMaxEnemyIndex = -1;
    var enemyTeamEntry = getCachedEnemyTeamEntry(enemyTeam) as any;
    var rawEnemyTeam = enemyTeamEntry ? enemyTeamEntry.enemy : null;
    var enemyTeamConfig;
    if (Array.isArray(rawEnemyTeam)) {
      enemyTeamConfig = rawEnemyTeam;
    } else if (rawEnemyTeam && ArrayBuffer.isView(rawEnemyTeam)) {
      enemyTeamConfig = Array.prototype.slice.call(rawEnemyTeam);
    } else {
      enemyTeamConfig = [];
    }

    for (var slotIndex = 0; slotIndex < Const.MAX_ENEMIES_IN_TEAM; slotIndex++) {
      if (state.enemy && state.enemy[slotIndex]) {
        state.enemy[slotIndex].reset();
      }
    }

    // As in SDLPAL: 0xFFFF entries are skipped (the team is compacted), 0 entries keep an
    // empty slot so the formation positions stay right; the max index counts both.
    var enemyIndex = 0;
    for (var teamIndex = 0; teamIndex < Const.MAX_ENEMIES_IN_TEAM; teamIndex++) {
      var enemyObjectId = enemyTeamConfig[teamIndex];
      if (typeof enemyObjectId === 'undefined' || enemyObjectId === 0xFFFF) {
        continue;
      }
      var enemyState = state.enemy && state.enemy[enemyIndex];
      if (!enemyState) {
        break;
      }

      if (enemyObjectId !== 0) {
        var objectEntry = scriptObjectAdapter.getObjectEntry(enemyObjectId);
        var enemyDefinition = objectEntry && objectEntry.enemy ? objectEntry.enemy : null;
        enemyState.e = enemyDefinition ? worldService.copyEnemyTemplate(enemyDefinition.enemyID) : null;
        enemyState.state = FighterState.Wait;
        enemyState.scriptOnTurnStart = enemyDefinition ? enemyDefinition.scriptOnTurnStart : 0;
        enemyState.scriptOnBattleEnd = enemyDefinition ? enemyDefinition.scriptOnBattleEnd : 0;
        enemyState.scriptOnReady = enemyDefinition ? enemyDefinition.scriptOnReady : 0;
        enemyState.colorShift = 0;
      }
      enemyState.objectID = enemyObjectId;
      computedMaxEnemyIndex = enemyIndex;
      enemyIndex++;
    }

    state.maxEnemyIndex = computedMaxEnemyIndex;

    for (var playerIndex = 0; playerIndex <= maxPartyIndex; playerIndex++) {
      var playerState = state.player && state.player[playerIndex];
      if (!playerState) {
        continue;
      }
      playerState.timeMeter = 15.0;
      playerState.hidingTime = 0;
      playerState.state = FighterState.Wait;
      if (playerState.action) {
        playerState.action.target = -1;
      }
      playerState.defending = false;
      playerState.currentFrame = 0;
      playerState.colorShift = false;
    }
    // 战斗指令组件的导入边界(M5 C1b):开战初始化写完旧结构后收进组件,之后的写入都先经组件
    battleService.importCommitted();

    return state;
  });

  // Load sprites and background
  battle.loadBattleSprites();
  battle.loadBattleBackground();

  // Create the surface for scene buffer
  var sceneSurface = surface.getRect(0, 0, 320, 200);
  battleService.setSceneBuffer(sceneSurface);

  yield script.updateEquipments();

  battleService.withState(function(state: any) {
    if (!state) {
      return state;
    }

    state.expGained = 0;
    state.cashGained = 0;
    state.isBoss = isBoss;
    state.enemyCleared = false;
    state.thisTurnCoop = false;
    state.coopContributors = [];
    state.enemyMoving = false;
    state.hidingTime = 0;
    state.movingPlayerIndex = 0;

    if (state.UI) {
      state.UI.msg = [];
      state.UI.nextMsg = [];
      state.UI.msgShowTime = 0;
      state.UI.state = BattleUIState.Wait;
      state.UI.autoAttack = false; // the player's Auto command starts off every battle (SDLPAL)
      state.UI.selectedIndex = 0;
      state.UI.prevEnemyTarget = -1; // never updated afterwards, as in SDLPAL
      if (Array.isArray(state.UI.showNum)) {
        state.UI.showNum.forEach(function(sn: any) {
          if (sn && typeof sn.reset === 'function') {
            sn.reset();
          }
        });
      }
    }

    state.summonSprite = null;
    state.backgroundColorShift = 0;
    state.battleResult = BattleResult.PreBattle;
    state.phase = BattlePhase.SelectAction;
    state.repeat = false;
    state.force = false;
    state.flee = false;
    state.prevAutoAtk = false;

    return state;
  });

  if (typeof battleService.initialiseBattleEntities === 'function') {
    battleService.initialiseBattleEntities();
  }

  if (typeof (fight as any).updateTimeChargingUnit === 'function') {
    (fight as any).updateTimeChargingUnit();
  }

  worldService.setInBattle(true);
  const overlayToken = disablePanoramaOverlay();
  if (overviewController && typeof overviewController.setSuspended === 'function') {
    overviewController.setSuspended(true);
  }

  battle.updateFighters();

  // Load the battle effect sprite.
  //Global.battle.effectSprite = Files.DATA.readChunk(10);

  //#ifdef PAL_ALLOW_KEYREPEAT
  //SDL_EnableKeyRepeat(120, 75);
  //#endif

  // Run the main battle routine.
  battleService.noteBattleStart();
  if (battleScriptParent) battleScriptExecution.bind(battleScriptParent,battle);      // 战斗事件日志(M5 B3):纯记录
  try {
  var result = yield (battleScriptParent ? battle.main(battleScriptParent) : battle.main());
} catch(ex) {
  if (isOwnedBattleCancelled(ex) || battleCommandRuntime.shouldBypassNativeCleanup(ex)) throw ex;
  log.fatal(['BATTLE exception during battle', ex, 'skip this battle'].join(' '));
  battleService.noteBattleError(ex);      // 记下来:结束事件与 agent 的战果里如实报「因引擎错误中止」,不再看起来像被剧情脚本结束
  // Skip the battle without rewards (it used to count as a win and pay out exp and cash).
  result = BattleResult.Terminated;
}

  //#ifdef PAL_ALLOW_KEYREPEAT
  //SDL_EnableKeyRepeat(0, 0);
  //PAL_ClearKeyState();
  //g_InputState.prevdir = kDirUnknown;
  //#endif

  if (result == BattleResult.Won) {
    // Player won the battle. Add the Experience points.
    battleScriptExecution.phase(battleScriptParent,'rewards');
    yield (battleScriptParent ? battle.won(battleScriptParent) : battle.won());
  }
  battleScriptExecution.phase(battleScriptParent,'cleanup');
  battleService.noteBattleEnd(result);      // 结算之后记:经验 / 钱 / 升级都已落定

  // Clear all item-using records
  worldService.mutateInventory(function(inventory) {
    if (!Array.isArray(inventory)) {
      return inventory;
    }
    for (var idx = 0; idx < Const.MAX_INVENTORY && idx < inventory.length; idx++) {
      var slot = inventory[idx];
      if (slot) {
        slot.amountInUse = 0;
      }
    }
    return inventory;
  });

  // Clear all player status, poisons and temporary effects
  script.clearAllPlayerStatus();
  //PAL_ClearAllPlayerStatus();
  for (var w = 0; w < Const.MAX_PLAYER_ROLES; w++) {
    script.curePoisonByLevel(w, 3);
    script.removeEquipmentEffect(w, BodyPart.Extra);
  }

  // Free all the battle sprites
  //PAL_FreeBattleSprites();
  //free(Global.battle.lpEffectSprite);

  // Free the surfaces for the background picture and scene buffer
  battleService.setBackground(null);
  battleService.setSceneBuffer(null);
  //SDL_FreeSurface(Global.battle.lpBackground);
  //SDL_FreeSurface(Global.battle.lpSceneBuf);

  if (uibattle && typeof uibattle.dispose === 'function') {
    uibattle.dispose();
  }

  worldService.setInBattle(false);
  restorePanoramaOverlay(overlayToken);
  if (overviewController && typeof overviewController.setSuspended === 'function') {
    overviewController.setSuspended(false);
  }

  music.play(getCachedMusicTrack(), true, 1);

  // Restore the screen waving effects
  worldService.setWaveProgression(prevWaveProgression);
  worldService.setScreenWave(prevWaveLevel);

  return result;
}

export default battle;
