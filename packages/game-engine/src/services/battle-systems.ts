import { battleLoopRuntime, markCompletedBattleRound } from './battle-loop-runtime';
import { copyNativeBattleScriptContext, nativeBattleScriptContextParent } from './battle-script-execution';
import EventBus from './event-bus.js';
import { random } from './random.js';
import scriptService from './script-service.js';
import worldService from './world-service.js';
import partyTrailAdapter from './party-trail-adapter.js';
import scriptObjectAdapter from './script-object-adapter.js';
import {
  getPlayerStatusRow as getPlayerStatusRowSnapshot,
  getMaxPartyMemberIndex as getMaxPartyMemberIndexSnapshot,
  getPoisonStatusMatrix
} from './player-state-adapter.js';
import {
  getBattleStateSnapshot,
  isAutoBattleEnabled
} from './battle-state-adapter.js';
import { getBattleSpeed } from './game-flags-adapter.js';
import {
  BattleComponents,
  createQueueEntryComponent
} from '../ecs/index';
import input from '../js/pal/input';
import scene from '../js/pal/scene';

type AnyRecord = Record<string, any>;

type BattleSystemRuntime = {
  battleService?: any;
  battle?: any;
  surface?: any;
  onPlayerReady?: (index: number) => void;
  onlyPuppet?: boolean;
  [key: string]: any;
};

type PipelineEntry = string | { phase: string; generator?: boolean | null };

declare const PAL_X: ((pos: number) => number) | undefined;
declare const PAL_Y: ((pos: number) => number) | undefined;
declare const PAL_XY: ((x: number, y: number) => number) | undefined;
declare const randomLong: (min: number, max: number) => number;
declare const randomFloat: (min: number, max: number) => number;
declare const hrtime: (() => number) | undefined;
declare const FrameTime: number | undefined;
declare const BattleUIState: any;
declare const BattleMenuState: any;
declare const FighterState: any;
declare const PlayerStatus: any;
declare const GameData: AnyRecord;
declare const Const: {
  MAX_ACTIONQUEUE_ITEMS?: number;
  MAX_POISONS?: number;
  MAX_INVENTORY?: number;
};
declare const BattleActionType: any;
declare const MagicFlag: any;
declare const BattlePhase: any;
declare const Key: any;
declare const log: { warn?: (...args: unknown[]) => void } | undefined;
declare const global: AnyRecord | undefined;

// 'status' (statusDecaySystem) is not a per-tick phase: statuses count rounds, and
// performActionPhaseSystem runs it once at the end of each round (as SDLPAL does).
// Running it here too decayed every status once per frame.
const DEFAULT_PIPELINE: PipelineEntry[] = [
  'time',
  'ai',
  { phase: 'queue', generator: true },
  { phase: 'action', generator: true },
  'animation',
  'render'
];

function sortByActorIndexDescending(registry: any, entities: number[]) {
  return entities
    .map(function(entityId) {
      var actor = registry.getComponent(entityId, BattleComponents.BattleActor);
      return {
        id: entityId,
        actor: actor
      };
    })
    .filter(function(entry) {
      return entry.actor && typeof entry.actor.index === 'number';
    })
    .sort(function(a, b) {
      return b.actor.index - a.actor.index;
    });
}

// Enemy scripts get the enemy's slot index as their event object id, as in SDLPAL.
function resolveEnemyEventObjectId(index: number) {
  return index;
}

// An enemy's script entries are used as they are (0 = none).
function resolveEnemyScriptEntry(entry: number | null | undefined, _enemyIndex?: number, _source?: string) {
  return typeof entry === 'number' && Number.isFinite(entry) && entry > 0 ? entry : 0;
}

function resolvePoisonScript(poisonId: number, kind: 'player' | 'enemy'): number {
  if (!Number.isFinite(poisonId) || poisonId <= 0) {
    return 0;
  }
  const obj = scriptObjectAdapter.getObjectEntry(poisonId);
  const poison = obj && (obj as AnyRecord).poison;
  const script = poison && (kind === 'player' ? poison.playerScript : poison.enemyScript);
  return Number.isFinite(script) ? script : 0;
}


function getGameData(): AnyRecord | null {
  if (typeof globalThis !== 'undefined' && (globalThis as AnyRecord).GameData) {
    return (globalThis as AnyRecord).GameData;
  }
  if (typeof global !== 'undefined' && global.GameData) {
    return global.GameData;
  }
  return null;
}

function ensurePALX(pos: number) {
  if (typeof PAL_X === 'function') {
    return PAL_X(pos);
  }
  return pos & 0xFFFF;
}

function ensurePALY(pos: number) {
  if (typeof PAL_Y === 'function') {
    return PAL_Y(pos);
  }
  return (pos >> 16) & 0xFFFF;
}

function ensurePALXY(x: number, y: number) {
  if (typeof PAL_XY === 'function') {
    return PAL_XY(x, y);
  }
  return ((y & 0xFFFF) << 16) | (x & 0xFFFF);
}

function getRandomLong(min: number, max: number) {
  if (typeof randomLong === 'function') {
    return randomLong(min, max);
  }
  var range = (max || 0) - (min || 0);
  return (min || 0) + Math.floor(random() * (range + 1));
}

var timeChargingUnit = 1;
var lastChargeTick = typeof hrtime === 'function' ? hrtime() : Date.now();
var lastChargeBasis = lastChargeTick;
var lastChargeRawOrigin = lastChargeTick;
var lastChargeDomain: number | null = null;
var chargeWriterGeneration = 0;
function activeChargeAnchorBasis(): number {
  return lastChargeDomain === battleLoopRuntime.presentationDomain()
    ? lastChargeBasis : battleLoopRuntime.presentationTime(lastChargeRawOrigin);
}

function getFrameTime() {
  if (typeof FrameTime === 'number' && !isNaN(FrameTime)) {
    return FrameTime;
  }
  return 1000 / 24;
}

function getBattleUIStateEnum(): Record<string, number> {
  if (typeof BattleUIState !== 'undefined' && BattleUIState) {
    return BattleUIState;
  }
  return {};
}

function getBattleMenuStateEnum(): Record<string, number> {
  if (typeof BattleMenuState !== 'undefined' && BattleMenuState) {
    return BattleMenuState;
  }
  return {};
}

function getFighterStateEnum(): Record<string, number> {
  if (typeof FighterState !== 'undefined' && FighterState) {
    return FighterState;
  }
  return {
    Wait: 0,
    Com: 1,
    Act: 2
  };
}

function getStatusCount(): number {
  if (typeof PlayerStatus !== 'undefined' &&
      PlayerStatus &&
      typeof PlayerStatus.All === 'number') {
    return PlayerStatus.All;
  }
  return 9;
}

function getPartyList(): AnyRecord[] {
  var party = partyTrailAdapter.getPartyState();
  if (!Array.isArray(party)) {
    return [];
  }
  return party;
}

function getPartyEntry(index: number) {
  var party = getPartyList();
  if (index < 0 || index >= party.length) {
    return null;
  }
  return party[index] || null;
}

function getPlayerStatusRow(roleId: number) {
  if (typeof roleId !== 'number' || roleId < 0) {
    return null;
  }
  return getPlayerStatusRowSnapshot(roleId);
}

function safeGetPlayerDexterity(roleId: number) {
  if (typeof roleId !== 'number' || roleId < 0) {
    return 1;
  }
  try {
    var value = scriptService.getPlayerDexterity(roleId);
    if (typeof value === 'number' && !isNaN(value) && value > 0) {
      return value;
    }
  } catch (err) {
    if (typeof log !== 'undefined' && log && typeof log.warn === 'function') {
      log.warn('[BATTLE] getPlayerDexterity fallback', err);
    }
  }
  var gameData = getGameData();
  if (gameData && gameData.playerRoles && Array.isArray(gameData.playerRoles.dexterity)) {
    var fallback = gameData.playerRoles.dexterity[roleId];
    if (typeof fallback === 'number' && !isNaN(fallback) && fallback > 0) {
      return fallback;
    }
  }
  return 1;
}

export function recomputeTimeChargingUnit(context?: { primaryRole?: number } | null) {
  var primaryRole = 0;
  if (context && typeof context.primaryRole === 'number') {
    primaryRole = context.primaryRole;
  } else {
    var firstPartyEntry = getPartyEntry(0);
    if (firstPartyEntry && typeof firstPartyEntry.playerRole === 'number') {
      primaryRole = firstPartyEntry.playerRole;
    }
  }
  var baseDexterity = safeGetPlayerDexterity(primaryRole);
  if (!baseDexterity || baseDexterity <= 0) {
    baseDexterity = 1;
  }
  var unit = Math.pow(baseDexterity + 5, 0.3) / baseDexterity;
  var battleSpeed = getBattleSpeed() || 1;
  if (battleSpeed > 1) {
    unit /= (1 + (battleSpeed - 1) * 0.5);
  } else {
    unit /= 1.2;
  }
  timeChargingUnit = unit;
  lastChargeTick = typeof hrtime === 'function' ? hrtime() : Date.now();
  lastChargeRawOrigin = lastChargeTick;
  lastChargeBasis = battleLoopRuntime.presentationTime(lastChargeTick);
  lastChargeDomain = battleLoopRuntime.presentationDomain();
  chargeWriterGeneration++;
  return timeChargingUnit;
}

/** Original anchor writers retain their contemporaneous active-clock basis without a new read. */
export function captureBattleTimeChargingBasis(): {raw:number;basis:number;writer:number} {return {raw:lastChargeTick,basis:activeChargeAnchorBasis(),writer:chargeWriterGeneration};}
export function activateBattleTimeCharging(proved?:{raw:number;basis:number;writer:number}): void {
  lastChargeTick=proved ? (chargeWriterGeneration===proved.writer && Object.is(lastChargeTick,proved.raw)?proved.basis:activeChargeAnchorBasis()) : battleLoopRuntime.presentationTime(lastChargeTick);
  lastChargeBasis=lastChargeTick;
  lastChargeDomain=battleLoopRuntime.presentationDomain();
}
/** Capture only a proved parked interval. Offset accumulation belongs to the exact live loop.
 * Charging and presentation read the same private integer-microsecond clock; global time is unchanged. */
export function suspendBattleTimeCharging(startedTicks?:number): (endedTicks?:number) => number {
  const anchor=lastChargeTick,writer=chargeWriterGeneration;
  // The native loop supplies its exact frozen-clock sample; standalone callers sample once.
  const started=startedTicks??Math.round((typeof hrtime==='function'?hrtime():Date.now())*1000);
  let live=true;
  return (endedTicks?:number) => {
    if(!live)return 0;live=false;
    if(lastChargeTick!==anchor||chargeWriterGeneration!==writer)return 0;
    const ended=endedTicks??Math.round((typeof hrtime==='function'?hrtime():Date.now())*1000);
    const ticks=ended-started;
    return Number.isSafeInteger(ticks)&&ticks>=0?ticks/1000:0;
  };
}

function ensureTimeChargingUnit() {
  if (!timeChargingUnit || !isFinite(timeChargingUnit) || timeChargingUnit <= 0) {
    return recomputeTimeChargingUnit();
  }
  return timeChargingUnit;
}

function isSubmenuActive(uiState: AnyRecord | null | undefined) {
  if (!uiState) {
    return false;
  }
  var uiEnum = getBattleUIStateEnum();
  if (uiEnum && typeof uiEnum.SelectMove !== 'undefined' && uiState.state !== uiEnum.SelectMove) {
    return false;
  }
  if (!uiEnum || typeof uiEnum.SelectMove === 'undefined') {
    return false;
  }
  if (uiState.state !== uiEnum.SelectMove) {
    return false;
  }
  var menuEnum = getBattleMenuStateEnum();
  var mainValue = menuEnum && typeof menuEnum.Main !== 'undefined'
    ? menuEnum.Main
    : 0;
  if (typeof uiState.menuState === 'undefined') {
    return false;
  }
  return uiState.menuState !== mainValue;
}

function isMessageActive(uiState: AnyRecord | null | undefined, now: number) {
  if (!uiState || !uiState.msgShowTime) {
    return false;
  }
  return uiState.msgShowTime > now;
}

function getTimeChargingSpeed(dexterity: number, uiState: AnyRecord | null | undefined, now: number) {
  if (!dexterity || dexterity <= 0) {
    return 0;
  }
  if (isSubmenuActive(uiState)) {
    return 0;
  }
  if (isMessageActive(uiState, now)) {
    return 0;
  }
  var speed = ensureTimeChargingUnit() * dexterity;
  if (isAutoBattleEnabled()) {
    speed *= 3;
  }
  return speed;
}

export function timeChargeSystem(runtime: BattleSystemRuntime) {
  var battleService = runtime && runtime.battleService;
  if (!battleService || typeof battleService.getRegistry !== 'function') {
    return;
  }
  var registry = battleService.getRegistry();
  var state = battleService.getState();
  if (!registry || !state) {
    return;
  }
  const party = getPartyList();

  ensureTimeChargingUnit();

  var frameTime = getFrameTime();
  var rawChargeTime = typeof hrtime === 'function' ? hrtime() : Date.now();
  var now = battleLoopRuntime.presentationTime(rawChargeTime);
  var delta = now - lastChargeTick;
  if (delta < 0 || delta > 500) {
    delta = frameTime;
  }
  lastChargeTick = now;
  lastChargeBasis = now;
  lastChargeRawOrigin = rawChargeTime;
  lastChargeDomain = battleLoopRuntime.presentationDomain();
  chargeWriterGeneration++;

  var step = frameTime > 0 ? delta / frameTime : 0;
  if (step <= 0) {
    return;
  }

  var uiState = state.UI || {};
  if (isSubmenuActive(uiState) || isMessageActive(uiState, now)) {
    return;
  }

  var entities = registry.iterateEntitiesWith([BattleComponents.BattleActor, BattleComponents.Time]);
  if (!entities.length) {
    return;
  }

  var fighterStateEnum = getFighterStateEnum();
  var waitState = typeof fighterStateEnum.Wait === 'number' ? fighterStateEnum.Wait : 0;
  var comState = typeof fighterStateEnum.Com === 'number' ? fighterStateEnum.Com : 1;
  var hidingTime = state.hidingTime || 0;
  var battleModule = runtime && runtime.battle;
  var autoBattleEnabled = !!isAutoBattleEnabled();

  for (var i = 0; i < entities.length; i++) {
    var entityId = entities[i];
    var actor = registry.getComponent(entityId, BattleComponents.BattleActor);
    var timeComponent = registry.getComponent(entityId, BattleComponents.Time);
    if (!actor || !timeComponent || !timeComponent.stateRef) {
      continue;
    }

    var timeState = timeComponent.stateRef;
    if (timeState.state !== waitState) {
      continue;
    }

    if (actor.type === 'player') {
      var roleId = actor.roleId;
      if (typeof roleId !== 'number' && typeof actor.index === 'number') {
        var partyEntry = getPartyEntry(actor.index);
        if (partyEntry && typeof partyEntry.playerRole === 'number') {
          roleId = partyEntry.playerRole;
        }
      }
      var dexterity = null;
      if (battleModule && typeof battleModule.getPlayerActualDexterity === 'function' && typeof roleId === 'number') {
        dexterity = battleModule.getPlayerActualDexterity(roleId);
      }
      if (!dexterity || dexterity <= 0) {
        dexterity = safeGetPlayerDexterity(roleId);
      }
      var modifier = timeState.timeSpeedModifier != null ? timeState.timeSpeedModifier : 1;
      var increment = getTimeChargingSpeed(dexterity, uiState, now) * modifier * step;
      if (increment > 0) {
        var nextValue = timeState.timeMeter + increment;
        if (nextValue > 120) {
          nextValue = 120;
        }
        timeState.timeMeter = nextValue;
      }
    } else if (actor.type === 'enemy') {
      var enemyDexterity = null;
      if (battleModule && typeof battleModule.getEnemyDexterity === 'function') {
        enemyDexterity = battleModule.getEnemyDexterity(actor.index);
      }
      if (!enemyDexterity || enemyDexterity < 0) {
        enemyDexterity = 0;
      }
      var enemyIncrement = getTimeChargingSpeed(enemyDexterity, uiState, now) * step;
      if (enemyIncrement > 0 && autoBattleEnabled) {
        enemyIncrement /= 2;
      }
      if (enemyIncrement > 0) {
        var nextEnemyValue = timeState.timeMeter + enemyIncrement;
        if (nextEnemyValue > 120) {
          nextEnemyValue = 120;
        }
        timeState.timeMeter = nextEnemyValue;
        if (nextEnemyValue >= 100) {
          if (hidingTime === 0) {
            timeState.state = comState;
          } else {
            timeState.timeMeter = 0;
          }
        }
      }
    }
  }
}

export function statusDecaySystem(runtime: BattleSystemRuntime) {
  var battleService = runtime && runtime.battleService;
  if (!battleService || typeof battleService.getRegistry !== 'function') {
    return;
  }
  var registry = battleService.getRegistry();
  if (!registry) {
    return;
  }
  var entities = registry.iterateEntitiesWith([BattleComponents.BattleActor, BattleComponents.Status]);
  if (!entities.length) {
    return;
  }

  var statusCount = getStatusCount();
  var playerRoles = new Set<number>();
  var enemyEntries = [];

  for (var i = 0; i < entities.length; i++) {
    var entityId = entities[i];
    var actor = registry.getComponent(entityId, BattleComponents.BattleActor);
    var statusComp = registry.getComponent(entityId, BattleComponents.Status);
    if (!actor || !statusComp) {
      continue;
    }
    if (actor.type === 'player' && typeof statusComp.roleId === 'number') {
      playerRoles.add(statusComp.roleId);
    } else if (actor.type === 'enemy' && typeof actor.index === 'number') {
      enemyEntries.push({
        enemyIndex: actor.index,
        statusRef: statusComp.statusRef || null
      });
    }
  }

  if (playerRoles.size > 0) {
    var rolesArray = Array.from(playerRoles);
    worldService.mutatePlayerStatus(function(statusMatrix) {
      if (!statusMatrix) {
        return statusMatrix;
      }
      const statusMatrixAny = statusMatrix as any;
      for (var idx = 0; idx < rolesArray.length; idx++) {
        var roleId = rolesArray[idx];
        var row = statusMatrixAny[roleId];
        if (!row) {
          continue;
        }
        for (var j = 0; j < statusCount; j++) {
          if (row[j] > 0) {
            row[j] = (row[j] || 0) - 1;
          }
        }
      }
      return statusMatrix;
    });
  }

  for (var k = 0; k < enemyEntries.length; k++) {
    var entry = enemyEntries[k];
    if (!entry.statusRef) {
      continue;
    }
    for (var m = 0; m < statusCount; m++) {
      if (entry.statusRef[m] > 0) {
        battleService.setEnemyStatus(entry.enemyIndex, m, function(value: number) {
          return value > 0 ? value - 1 : value;
        });
      }
    }
  }
}

export function aiPreparationSystem(runtime: BattleSystemRuntime) {
  var battle = runtime && runtime.battle;
  if (!battle || typeof battle.playerCheckReady !== 'function') {
    return;
  }
  battle.playerCheckReady();
}

function getBattleState(battleService: any) {
  if (!battleService || typeof battleService.getState !== 'function') {
    return null;
  }
  var state = battleService.getState();
  if (state) {
    return state;
  }
  return getBattleStateSnapshot();
}

function setBattleFieldValue(battleService: any, field: string, value: any) {
  if (!battleService || typeof battleService.set !== 'function') {
    return null;
  }
  return battleService.set([field], value);
}

function mutateBattleFieldValue(battleService: any, field: string, mutator: any) {
  if (!battleService || typeof battleService.set !== 'function') {
    return null;
  }
  return battleService.set([field], function(current: any) {
    if (typeof mutator === 'function') {
      return mutator(current);
    }
    return mutator;
  });
}

function mutatePlayerState(battleService: any, index: number, mutator: any) {
  if (!battleService || typeof battleService.setPlayer !== 'function') {
    return null;
  }
  return battleService.setPlayer(index, function(player: any) {
    if (!player) {
      return player;
    }
    if (typeof mutator === 'function') {
      mutator(player);
    }
    return player;
  });
}

function mutateEnemyState(battleService: any, index: number, mutator: any) {
  if (!battleService || typeof battleService.updateEnemy !== 'function') {
    return null;
  }
  return battleService.updateEnemy(index, function(enemy: any) {
    if (!enemy) {
      return enemy;
    }
    if (typeof mutator === 'function') {
      mutator(enemy);
    }
    return enemy;
  });
}

function mutateUIState(battleService: any, mutator: any) {
  if (!battleService || typeof battleService.updateUI !== 'function') {
    return null;
  }
  return battleService.updateUI(function(uiState: any) {
    if (!uiState) {
      return uiState;
    }
    if (typeof mutator === 'function') {
      mutator(uiState);
    }
    return uiState;
  });
}

function getUIProperty(battleService: any, prop: string, fallback?: any) {
  if (!battleService) {
    return typeof fallback === 'undefined' ? null : fallback;
  }
  var component = typeof battleService.getUIComponent === 'function'
    ? battleService.getUIComponent()
    : null;
  if (!component) {
    var state = getBattleState(battleService);
    if (state && state.UI && Object.prototype.hasOwnProperty.call(state.UI, prop)) {
      return state.UI[prop];
    }
    return typeof fallback === 'undefined' ? null : fallback;
  }
  var uiState = component.stateRef || null;
  if (uiState && Object.prototype.hasOwnProperty.call(uiState, prop)) {
    return uiState[prop];
  }
  if (component && Object.prototype.hasOwnProperty.call(component, prop)) {
    return component[prop];
  }
  return typeof fallback === 'undefined' ? null : fallback;
}

function ensureActionQueueEntry(state: AnyRecord | null | undefined, index: number) {
  if (!state || !Array.isArray(state.actionQueue)) {
    return null;
  }
  if (!state.actionQueue[index]) {
    state.actionQueue[index] = {
      index: 0xFFFF,
      dexterity: 0xFFFF,
      isEnemy: false
    };
  }
  var entry = state.actionQueue[index];
  if (typeof entry.index !== 'number') {
    entry.index = 0xFFFF;
  }
  if (typeof entry.dexterity !== 'number') {
    entry.dexterity = 0xFFFF;
  }
  if (typeof entry.isEnemy === 'undefined') {
    entry.isEnemy = false;
  }
  return entry;
}

function syncQueueEntryComponent(battleService: any, index: number, entry: AnyRecord | null) {
  if (!battleService || typeof battleService.getRegistry !== 'function') {
    return;
  }
  var registry = battleService.getRegistry();
  if (!registry) {
    return;
  }
  var entityId = battleService.getQueueEntity ? battleService.getQueueEntity(index) : null;
  const entryIndex = entry && typeof entry.index === 'number' ? entry.index : null;
  if (!entityId) {
    entityId = registry.createEntity();
    registry.addComponent(entityId, BattleComponents.QueueEntry, createQueueEntryComponent({
      index: index,
      entryRef: entry,
      actorEntity: entryIndex == null
        ? null
        : (entry && entry.isEnemy
          ? (battleService.getEnemyEntity ? battleService.getEnemyEntity(entryIndex) : null)
          : (battleService.getPlayerEntity ? battleService.getPlayerEntity(entryIndex) : null)),
      actorType: entry ? (entry.isEnemy ? 'enemy' : 'player') : null,
      isEnemy: entry ? !!entry.isEnemy : false
    }));
    if (battleService.entityMaps && battleService.entityMaps.queue) {
      battleService.entityMaps.queue.set(index, entityId);
    }
    return;
  }
  var component = registry.getComponent(entityId, BattleComponents.QueueEntry);
  if (!component) {
    registry.addComponent(entityId, BattleComponents.QueueEntry, createQueueEntryComponent({
      index: index,
      entryRef: entry
    }));
    return;
  }
  component.index = index;
  component.entryRef = entry || null;
  component.isEnemy = entry ? !!entry.isEnemy : false;
  component.actorEntity = entry
    ? (entry.isEnemy
        ? (battleService.getEnemyEntity ? battleService.getEnemyEntity(entryIndex as number) : null)
        : (battleService.getPlayerEntity ? battleService.getPlayerEntity(entryIndex as number) : null))
    : null;
  component.actorType = entry ? (entry.isEnemy ? 'enemy' : 'player') : null;
}

function mutateInventory(mutator: (inventory: any) => void) {
  return worldService.mutateInventory(function(inventory) {
    if (!inventory || typeof mutator !== 'function') {
      return inventory;
    }
    mutator(inventory);
    return inventory;
  });
}

// ACTIONQUEUE.wDexterity is a WORD in SDLPAL: "wDexterity *= RandomFloat(...)"
// multiplies in float and truncates back to 16 bits.
function toQueueWord(value: number) {
  return (~~value) & 0xFFFF;
}

function scaleQueueDexterity(dexterity: number) {
  return toQueueWord(Math.fround(toQueueWord(dexterity) * Math.fround(randomFloat(0.9, 1.1))));
}

function queueDexterityAsShort(value: number) {
  var word = toQueueWord(value);
  return (word & 0x8000) ? word - 0x10000 : word;
}

export function selectActionQueueSystem(runtime: BattleSystemRuntime) {
  var battleService = runtime && runtime.battleService;
  var battle = runtime && runtime.battle;
  var onPlayerReady = runtime && runtime.onPlayerReady;
  if (!battleService) {
    return;
  }
  var state = getBattleState(battleService);
  if (!state || state.phase !== BattlePhase.SelectAction) {
    return;
  }

  if (getUIProperty(battleService, 'state', BattleUIState.Wait) != BattleUIState.Wait) {
    return;
  }

  var party = getPartyList();
  var partyLength = party.length;
  var rawMaxPartyIndex = getMaxPartyMemberIndexSnapshot();
  if (!Number.isFinite(rawMaxPartyIndex) || rawMaxPartyIndex < 0) {
    rawMaxPartyIndex = partyLength - 1;
  }
  var maxPartyIndex = Math.max(-1, Math.min(rawMaxPartyIndex, partyLength - 1));
  if (maxPartyIndex < 0) {
    return;
  }

  var playerRolesData = (typeof GameData !== 'undefined' && GameData) ? GameData.playerRoles : null;

  var i;
  for (i = 0; i <= maxPartyIndex; i++) {
    var partyEntry = party[i];
    if (!partyEntry) {
      continue;
    }
    var playerRole = partyEntry.playerRole;
    if (playerRole == null) {
      continue;
    }
    var statusRow = getPlayerStatusRow(playerRole);
    var hpZero = playerRolesData && playerRolesData.HP ? playerRolesData.HP[playerRole] == 0 : false;
    var asleep = statusRow && PlayerStatus && typeof PlayerStatus.Sleep === 'number'
      ? statusRow[PlayerStatus.Sleep] > 0
      : false;
    var confused = statusRow && PlayerStatus && typeof PlayerStatus.Confused === 'number'
      ? statusRow[PlayerStatus.Confused] > 0
      : false;
    var paralyzed = statusRow && PlayerStatus && typeof PlayerStatus.Paralyzed === 'number'
      ? statusRow[PlayerStatus.Paralyzed] > 0
      : false;
    if (hpZero || asleep || confused || paralyzed) {
      continue;
    }
    var playerState = state.player && state.player[i];
    if (playerState && (playerState.state == FighterState.Wait || playerState.state == FighterState.Com)) {
      setBattleFieldValue(battleService, 'movingPlayerIndex', i);
      mutatePlayerState(battleService, i, function(player: any) {
        player.state = FighterState.Com;
        player.defending = false;
        return player;
      });
      if (typeof onPlayerReady === 'function') {
        onPlayerReady(i);
      }
      break;
    } else if (playerState &&
               playerState.action &&
               playerState.action.actionType == BattleActionType.CoopMagic) {
      i = maxPartyIndex + 1;
      break;
    }
  }

  if (i <= maxPartyIndex) {
    return;
  }

  // Backup all actions once not repeating, before statuses below rewrite
  // them; Repeat restores from this backup (SDLPAL prevAction).
  if (!state.repeat) {
    for (var backupIndex = 0; backupIndex <= maxPartyIndex; backupIndex++) {
      // W4:先在组件里备份(previous[i] = committed[i]),再投影到 player.prevAction
      const backup = battleService.backupPrevious(backupIndex);
      mutatePlayerState(battleService, backupIndex, function(player: any) {
        if (player.action) {
          player.prevAction = backup || {
            actionType: player.action.actionType,
            actionID: player.action.actionID,
            target: player.action.target,
            remainingTime: player.action.remainingTime
          };
        }
        return player;
      });
    }
  }

  setBattleFieldValue(battleService, 'repeat', false);
  setBattleFieldValue(battleService, 'force', false);
  setBattleFieldValue(battleService, 'flee', false);
  setBattleFieldValue(battleService, 'prevAutoAtk', !!getUIProperty(battleService, 'autoAttack', false));
  setBattleFieldValue(battleService, 'prevPlayerAutoAtk', false);
  setBattleFieldValue(battleService, 'curAction', 0);

  var queueLength = Const.MAX_ACTIONQUEUE_ITEMS || 0;
  for (var resetIndex = 0; resetIndex < queueLength; resetIndex++) {
    var resetEntry = ensureActionQueueEntry(state, resetIndex);
    if (resetEntry) {
      resetEntry.index = 0xFFFF;
      resetEntry.dexterity = 0xFFFF;
      resetEntry.isEnemy = false;
      syncQueueEntryComponent(battleService, resetIndex, resetEntry);
    }
  }

  var queueCursor = 0;

  for (var enemyIndex = 0; enemyIndex <= state.maxEnemyIndex; enemyIndex++) {
    var enemyState = state.enemy && state.enemy[enemyIndex];
    if (!enemyState || enemyState.objectID == 0) {
      continue;
    }
    var enemyDexterity = scaleQueueDexterity(battle && typeof battle.getEnemyDexterity === 'function'
      ? battle.getEnemyDexterity(enemyIndex)
      : 0);
    var enemyEntry = ensureActionQueueEntry(state, queueCursor);
    if (enemyEntry) {
      enemyEntry.isEnemy = true;
      enemyEntry.index = enemyIndex;
      enemyEntry.dexterity = enemyDexterity;
      syncQueueEntryComponent(battleService, queueCursor, enemyEntry);
      queueCursor++;
    }

    // Classic SDLPAL: an enemy with dualMove always acts twice per round (no random roll).
    if (enemyState.e && enemyState.e.dualMove) {
      var extraDexterity = scaleQueueDexterity(battle && typeof battle.getEnemyDexterity === 'function'
        ? battle.getEnemyDexterity(enemyIndex)
        : 0);
      var extraEntry = ensureActionQueueEntry(state, queueCursor);
      if (extraEntry) {
        extraEntry.isEnemy = true;
        extraEntry.index = enemyIndex;
        extraEntry.dexterity = extraDexterity;
        syncQueueEntryComponent(battleService, queueCursor, extraEntry);
        queueCursor++;
      }
    }
  }

  for (var playerIndex = 0; playerIndex <= maxPartyIndex; playerIndex++) {
    var partyMember = party[playerIndex];
    if (!partyMember) {
      continue;
    }
    var roleId = partyMember.playerRole;
    var playerState = state.player && state.player[playerIndex];
    if (!playerState || !playerState.action) {
      continue;
    }
    var statusRowForRole = getPlayerStatusRow(roleId);
    var nextActionType = playerState.action.actionType;
    var nextActionID = playerState.action.actionID;
    var nextState = playerState.state;
    var queueDexterity = 0;

    if ((playerRolesData && playerRolesData.HP ? playerRolesData.HP[roleId] == 0 : false) ||
        (statusRowForRole && PlayerStatus && typeof PlayerStatus.Sleep === 'number' ? statusRowForRole[PlayerStatus.Sleep] > 0 : false) ||
        (statusRowForRole && PlayerStatus && typeof PlayerStatus.Paralyzed === 'number' ? statusRowForRole[PlayerStatus.Paralyzed] > 0 : false)) {
      nextActionType = BattleActionType.Attack;
      nextActionID = 0;
      nextState = FighterState.Act;
      queueDexterity = 0;
    } else {
      var dexterity = (battle && typeof battle.getPlayerActualDexterity === 'function')
        ? battle.getPlayerActualDexterity(roleId)
        : 0;
      if (!dexterity || dexterity <= 0) {
        dexterity = safeGetPlayerDexterity(roleId);
      }
      if (statusRowForRole && PlayerStatus && typeof PlayerStatus.Confused === 'number' && statusRowForRole[PlayerStatus.Confused] > 0) {
        nextActionType = BattleActionType.Attack;
        nextActionID = 0; // so that it is not taken for an auto-attack
        nextState = FighterState.Act;
      }
      // WORD arithmetic as in SDLPAL (integer halving, 16-bit wrap).
      dexterity = toQueueWord(dexterity);
      switch (nextActionType) {
        case BattleActionType.CoopMagic:
          dexterity = toQueueWord(dexterity * 10);
          break;
        case BattleActionType.Defend:
          dexterity = toQueueWord(dexterity * 5);
          break;
        case BattleActionType.Magic:
          if ((GameData.object[playerState.action.actionID].magic.flags & MagicFlag.UsableToEnemy) == 0) {
            dexterity = toQueueWord(dexterity * 3);
          }
          break;
        case BattleActionType.Flee:
          dexterity = ~~(dexterity / 2);
          break;
        case BattleActionType.UseItem:
          dexterity = toQueueWord(dexterity * 3);
          break;
        default:
          break;
      }
      if (battle && typeof battle.isPlayerDying === 'function' &&
          battle.isPlayerDying(roleId)) {
        dexterity = ~~(dexterity / 2);
      }
      queueDexterity = scaleQueueDexterity(dexterity);
    }

    var playerEntry = ensureActionQueueEntry(state, queueCursor);
    if (playerEntry) {
      playerEntry.isEnemy = false;
      playerEntry.index = playerIndex;
      playerEntry.dexterity = queueDexterity;
      syncQueueEntryComponent(battleService, queueCursor, playerEntry);
    }

    battleService.writeCommitted(playerIndex, { actionType: nextActionType, actionID: nextActionID });      // W5:先写组件
    mutatePlayerState(battleService, playerIndex, function(player: any) {
      player.action.actionType = nextActionType;
      player.action.actionID = nextActionID;
      player.state = nextState;
      return player;
    });

    queueCursor++;
  }

  if (Array.isArray(state.actionQueue)) {
    // Same exchange sort as SDLPAL, comparing the WORD dexterity as SHORT
    // (so empty 0xFFFF slots sort last); its handling of ties differs from
    // Array.prototype.sort.
    var queue = state.actionQueue;
    for (var si = 0; si < queue.length; si++) {
      for (var sj = si; sj < queue.length; sj++) {
        if (queueDexterityAsShort(queue[si].dexterity) < queueDexterityAsShort(queue[sj].dexterity)) {
          var swapEntry = queue[si];
          queue[si] = queue[sj];
          queue[sj] = swapEntry;
        }
      }
    }
    for (var syncIndex = 0; syncIndex < state.actionQueue.length; syncIndex++) {
      syncQueueEntryComponent(battleService, syncIndex, state.actionQueue[syncIndex]);
    }
  }

  setBattleFieldValue(battleService, 'phase', BattlePhase.PerformAction);
}

export function* performActionPhaseSystem(runtime: BattleSystemRuntime): Generator<unknown, void, unknown> {
  const battleScriptParent = nativeBattleScriptContextParent(runtime);
  var battleService = runtime && runtime.battleService;
  var battle = runtime && runtime.battle;
  var onlyPuppet = runtime && runtime.onlyPuppet;
  if (!battleService) {
    return;
  }
  var state = getBattleState(battleService);
  if (!state || state.phase !== BattlePhase.PerformAction) {
    return;
  }

  var partyEntries = getPartyList();
  var rawMaxPartyIndexPerform = getMaxPartyMemberIndexSnapshot();
  if (!Number.isFinite(rawMaxPartyIndexPerform) || rawMaxPartyIndexPerform < 0) {
    rawMaxPartyIndexPerform = partyEntries.length - 1;
  }
  var maxPartyMemberIndex = Math.max(-1, Math.min(rawMaxPartyIndexPerform, partyEntries.length - 1));
  var playerRolesData = (typeof GameData !== 'undefined' && GameData) ? GameData.playerRoles : null;

  var actionQueue = Array.isArray(state.actionQueue) ? state.actionQueue : [];
  var curActionIndex = state.curAction || 0;
  var queueEntry = actionQueue[curActionIndex];

  const maxQueue = Const.MAX_ACTIONQUEUE_ITEMS || 0;
  if (curActionIndex >= maxQueue ||
      !queueEntry ||
      queueEntry.dexterity == 0xFFFF) {
    for (var i = 0; i <= maxPartyMemberIndex; i++) {
      mutatePlayerState(battleService, i, function(player: any) {
        if (player) {
          player.defending = false;
          // As in SDLPAL: restore player pos from MANUAL defending.
          player.pos = player.originalPos;
        }
        return player;
      });
    }

    if (battle && typeof battle.backupStat === 'function') {
      battle.backupStat();
    }

    const maxPoisons = Const.MAX_POISONS || 0;
    for (var partyIndex = 0; partyIndex <= maxPartyMemberIndex; partyIndex++) {
      var partyInfo = partyEntries[partyIndex];
      if (!partyInfo) {
        continue;
      }
      var partyRole = partyInfo.playerRole;
      for (var poisonSlot = 0; poisonSlot < maxPoisons; poisonSlot++) {
        var poisonMatrix = getPoisonStatusMatrix();
        var poisonRow = Array.isArray(poisonMatrix) ? poisonMatrix[poisonSlot] : null;
        var poisonRowArray = Array.isArray(poisonRow) ? poisonRow : null;
        var poisonEntry = poisonRowArray ? poisonRowArray[partyIndex] : null;
        const poisonId = poisonEntry ? poisonEntry.poisonID : null;
        if (poisonEntry && Number.isFinite(poisonId) && poisonId !== 0) {
          let scriptEntry = poisonEntry.poisonScript;
          if (!Number.isFinite(scriptEntry)) {
            scriptEntry = resolvePoisonScript(poisonId, 'player');
            if (!Number.isFinite(scriptEntry) || scriptEntry === 0) {
              console.warn('[BATTLE] player poison missing script', {
                partyIndex,
                partyRole,
                poisonSlot,
                poisonId
              });
            }
          }
          yield* scriptService.runBattlePoisonTriggerScript(battleScriptParent,scriptEntry,partyRole,
            {side:'party',actor:partyIndex,slot:poisonSlot,poisonId},
            ()=>getPoisonStatusMatrix()?.[poisonSlot]?.[partyIndex],
            (nextScriptEntry:number)=>worldService.mutatePoisonStatus(function(currentMatrix) {
            const matrix = Array.isArray(currentMatrix) ? currentMatrix : null;
            var row = matrix ? matrix[poisonSlot] : null;
            if (Array.isArray(row) && row[partyIndex]) {
              row[partyIndex].poisonScript = nextScriptEntry;
            }
            return currentMatrix;
          }));
        }
      }
    }

    for (var enemyIndex = 0; enemyIndex <= state.maxEnemyIndex; enemyIndex++) {
      var enemyState = state.enemy && state.enemy[enemyIndex];
      if (!enemyState) {
        continue;
      }
      for (var enemyPoison = 0; enemyPoison < maxPoisons; enemyPoison++) {
        var enemySlot = enemyState.poisons ? enemyState.poisons[enemyPoison] : null;
        const poisonId = enemySlot ? enemySlot.poisonID : null;
        if (enemySlot && Number.isFinite(poisonId) && poisonId !== 0) {
          let scriptEntry = enemySlot.poisonScript;
          if (!Number.isFinite(scriptEntry)) {
            scriptEntry = resolvePoisonScript(poisonId, 'enemy');
            if (!Number.isFinite(scriptEntry) || scriptEntry === 0) {
              console.warn('[BATTLE] enemy poison missing script', {
                enemyIndex,
                poisonSlot: enemyPoison,
                poisonId
              });
            }
          }
          yield* scriptService.runBattlePoisonTriggerScript(battleScriptParent,scriptEntry,resolveEnemyEventObjectId(enemyIndex),
            {side:'enemy',actor:enemyIndex,slot:enemyPoison,poisonId},
            ()=>battleService.getState().enemy?.[enemyIndex]?.poisons?.[enemyPoison],
            (nextEnemyScript:number)=>battleService.setEnemyPoison(enemyIndex, enemyPoison, function(slot: any) {
            slot.poisonScript = nextEnemyScript;
            return slot;
          }));
        }
      }
    }

    battleService.runSystems('status', { battle: battle });
    if (battle && typeof battle.postActionCheck === 'function') {
      yield* (battleScriptParent ? battle.postActionCheck(false, battleScriptParent) : battle.postActionCheck(false));
    }
    if (battle && typeof battle.displayStatChange === 'function' && battle.displayStatChange()) {
      if (battle.delay) {
        yield* battle.delay(8, 0, true);
      }
    }

    var hidingTime = state.hidingTime || 0;
    if (hidingTime > 0) {
      hidingTime--;
      battleService.setHidingTime(hidingTime);
      if (hidingTime == 0) {
        if (battle && typeof battle.backupScene === 'function') {
          battle.backupScene();
        }
        if (battle && typeof battle.makeScene === 'function') {
          battle.makeScene();
        }
        if (battle && typeof battle.fadeScene === 'function') {
          yield* battle.fadeScene();
        }
      }
    }

    if ((state.hidingTime || 0) == 0) {
      for (var enemyIdx = 0; enemyIdx <= state.maxEnemyIndex; enemyIdx++) {
        var enemyTurnState = state.enemy && state.enemy[enemyIdx];
        if (!enemyTurnState || enemyTurnState.objectID == 0 || !enemyTurnState.scriptOnTurnStart) {
          continue;
        }
        if (typeof enemyTurnState.scriptOnTurnStart === 'undefined') {
          console.warn('[BATTLE] enemy turn start script undefined', {
            enemyIndex: enemyIdx,
            enemyTurnState
          });
        }
        var enemyTurnEventId = resolveEnemyEventObjectId(enemyIdx);
        var initialTurnScript = resolveEnemyScriptEntry(enemyTurnState.scriptOnTurnStart, enemyIdx, 'triggerScript');
        if (Number.isFinite(initialTurnScript) && initialTurnScript > 0) {
          yield* scriptService.runBattleEnemyTriggerScript(battleScriptParent,
            initialTurnScript, enemyTurnEventId,
            {kind:'enemy-turn-start',enemyIndex:enemyIdx,objectId:enemyTurnState.objectID,eventId:enemyTurnEventId,
              configuredEntry:enemyTurnState.scriptOnTurnStart,resolvedEntry:initialTurnScript,invocationIndex:enemyIdx},
            () => ({enemy:battleService.getState().enemy[enemyIdx]}),
            (turnStartResult:number) => mutateEnemyState(battleService, enemyIdx, function(enemy: any) {
              enemy.scriptOnTurnStart = Number.isFinite(turnStartResult) && turnStartResult > 0
                ? turnStartResult : initialTurnScript;
              return enemy;
            })
          );
        }
      }
    }

    mutateInventory(function(inventory) {
      if (!Array.isArray(inventory)) {
        return inventory;
      }
      const maxInventory = Const.MAX_INVENTORY || 0;
      for (var idx = 0; idx < maxInventory && idx < inventory.length; idx++) {
        var slot = inventory[idx];
        if (slot) {
          slot.amountInUse = 0;
        }
      }
      return inventory;
    });

    setBattleFieldValue(battleService, 'phase', BattlePhase.SelectAction);
    setBattleFieldValue(battleService, 'thisTurnCoop', false);
    markCompletedBattleRound(runtime);
    return;
  }

  var isEnemy = !!queueEntry.isEnemy;
  var actionIndex = queueEntry.index;

  if (isEnemy) {
    var actingEnemy = state.enemy && state.enemy[actionIndex];
      if ((state.hidingTime || 0) === 0 &&
          !onlyPuppet &&
          actingEnemy &&
          actingEnemy.objectID != 0) {
        if (actingEnemy.scriptOnReady) {
          if (typeof actingEnemy.scriptOnReady === 'undefined') {
            console.warn('[BATTLE] enemy ready script undefined', {
              enemyIndex: actionIndex,
              actingEnemy
            });
          }
          var readyEventId = resolveEnemyEventObjectId(actionIndex);
          var readyScript = resolveEnemyScriptEntry(actingEnemy.scriptOnReady, actionIndex, 'autoScript');
          if (Number.isFinite(readyScript) && readyScript > 0) {
            yield* scriptService.runBattleEnemyTriggerScript(battleScriptParent,
              readyScript, readyEventId,
              {kind:'enemy-ready',enemyIndex:actionIndex,objectId:actingEnemy.objectID,eventId:readyEventId,
                configuredEntry:actingEnemy.scriptOnReady,resolvedEntry:readyScript,invocationIndex:curActionIndex},
              () => {const current=battleService.getState();return {enemy:current.enemy[actionIndex],queue:current.actionQueue,
                queueEntry:current.actionQueue[curActionIndex],queueIndex:current.curAction};},
              (readyScriptResult:number) => mutateEnemyState(battleService, actionIndex, function(enemy: any) {
                enemy.scriptOnReady = readyScriptResult;
                return enemy;
              })
            );
          }
        }

      setBattleFieldValue(battleService, 'enemyMoving', true);
      if (battle && typeof battle.enemyPerformAction === 'function') {
        yield* (battleScriptParent ? battle.enemyPerformAction(actionIndex, battleScriptParent) : battle.enemyPerformAction(actionIndex));
      }
      setBattleFieldValue(battleService, 'enemyMoving', false);
    }
  } else {
    var playerState = state.player && state.player[actionIndex];
    if (playerState && playerState.state == FighterState.Act) {
      var partyEntryForAction = partyEntries[actionIndex];
      var playerRole = partyEntryForAction ? partyEntryForAction.playerRole : null;
      var updatedActionType: number | null = null;

      var statusRowAction = playerRole != null ? getPlayerStatusRow(playerRole) : null;
      if (playerRole != null && playerRolesData && playerRolesData.HP && playerRolesData.HP[playerRole] == 0) {
        if (!statusRowAction || !statusRowAction[PlayerStatus.Puppet]) {
          updatedActionType = BattleActionType.Pass;
        }
      } else if (
        (statusRowAction && PlayerStatus && typeof PlayerStatus.Sleep === 'number' && statusRowAction[PlayerStatus.Sleep] > 0) ||
        (statusRowAction && PlayerStatus && typeof PlayerStatus.Paralyzed === 'number' && statusRowAction[PlayerStatus.Paralyzed] > 0)
      ) {
        updatedActionType = BattleActionType.Pass;
      } else if (statusRowAction && PlayerStatus && typeof PlayerStatus.Confused === 'number' && statusRowAction[PlayerStatus.Confused] > 0) {
        // As in SDLPAL, a confused player who is dying does nothing.
        updatedActionType = (battle && typeof battle.isPlayerDying === 'function' && battle.isPlayerDying(playerRole))
          ? BattleActionType.Pass
          : BattleActionType.AttackMate;
      } else if (playerState.action &&
                 playerState.action.actionType == BattleActionType.Attack &&
                 playerState.action.actionID != 0) {
        // An auto-attack (actionID 1) turns the following players' moves
        // of this round into plain attacks as well (SDLPAL fPrevPlayerAutoAtk).
        setBattleFieldValue(battleService, 'prevPlayerAutoAtk', true);
      } else if (getBattleState(battleService).prevPlayerAutoAtk &&
                 battle && typeof battle.commitAction === 'function') {
        var autoAtkTarget = playerState.action ? playerState.action.target : -1;
        mutateUIState(battleService, function(ui: any) {
          ui.curPlayerIndex = actionIndex;
          ui.selectedIndex = autoAtkTarget;
          ui.actionType = BattleActionType.Attack;
        });
        battle.commitAction(false);
      }

      if (updatedActionType !== null) {
        battleService.writeCommitted(actionIndex, { actionType: updatedActionType });      // W6:先写组件
        mutatePlayerState(battleService, actionIndex, function(player: any) {
          player.action.actionType = updatedActionType;
          return player;
        });
      }

      setBattleFieldValue(battleService, 'movingPlayerIndex', actionIndex);
      if (battle && typeof battle.playerPerformAction === 'function') {
        yield* (battleScriptParent ? battle.playerPerformAction(actionIndex, battleScriptParent) : battle.playerPerformAction(actionIndex));
      }
    }
  }

  mutateBattleFieldValue(battleService, 'curAction', function(value: any) {
    return (value || 0) + 1;
  });

  var menuState = getUIProperty(battleService, 'menuState', BattleMenuState.Main);
  var uiState = getUIProperty(battleService, 'state', BattleUIState.Wait);
  if (menuState == BattleMenuState.Main &&
      uiState == BattleUIState.SelectMove) {
    if (input.isKeyPressed && input.isKeyPressed(Key.Repeat)) {
      setBattleFieldValue(battleService, 'repeat', true);
      // Repeat also restores the auto-attack mode of the previous round.
      var prevAutoAtk = !!getBattleState(battleService).prevAutoAtk;
      mutateUIState(battleService, function(ui: any) {
        ui.autoAttack = prevAutoAtk;
      });
    } else if (input.isKeyPressed && input.isKeyPressed(Key.Force)) {
      setBattleFieldValue(battleService, 'force', true);
    }
  }

  var latestState = getBattleState(battleService);
  if (latestState.repeat) {
    input.keyPress = Key.Repeat;
  } else if (latestState.force) {
    input.keyPress = Key.Force;
  } else if (latestState.flee) {
    input.keyPress = Key.Flee;
  }
}

export class BattleSystemManager extends EventBus {
  battleService: any;
  _systems: Map<string, Array<(runtime: BattleSystemRuntime) => unknown>>;
  _generatorSystems: Map<string, Array<(runtime: BattleSystemRuntime) => unknown>>;
  _context: BattleSystemRuntime;
  _pipeline: Array<{ phase: string; generator: boolean | null }>;

  constructor(battleService: any, baseContext?: BattleSystemRuntime) {
    super();
    this.battleService = battleService;
    this._systems = new Map();
    this._generatorSystems = new Map();
    this._context = baseContext || {};
    this._pipeline = [];
  }

  setContext(context?: BattleSystemRuntime) {
    this._context = context || {};
  }

  _normalizePipelineEntry(entry: PipelineEntry) {
    if (typeof entry === 'string') {
      return { phase: entry, generator: null };
    }
    if (entry && typeof entry.phase === 'string') {
      return {
        phase: entry.phase,
        generator: typeof entry.generator === 'undefined' || entry.generator === null
          ? null
          : Boolean(entry.generator)
      };
    }
    throw new Error('Invalid pipeline entry');
  }

  setPipeline(phases: PipelineEntry[]) {
    if (!Array.isArray(phases)) {
      throw new Error('pipeline must be an array');
    }
    var normalized = phases.map((entry) => this._normalizePipelineEntry(entry));
    var seen = Object.create(null);
    for (var i = 0; i < normalized.length; i++) {
      var phase = normalized[i].phase;
      if (seen[phase]) {
        throw new Error('Duplicate pipeline phase: ' + phase);
      }
      seen[phase] = true;
    }
    this._pipeline = normalized;
  }

  getPipeline() {
    return this._pipeline.slice();
  }

  register(phase: string, systemFn: (runtime: BattleSystemRuntime) => unknown) {
    if (!phase || typeof systemFn !== 'function') {
      throw new Error('phase and system function are required');
    }
    var list = this._systems.get(phase);
    if (!list) {
      list = [];
      this._systems.set(phase, list);
    }
    list.push(systemFn);
  }

  registerGenerator(phase: string, systemFn: (runtime: BattleSystemRuntime) => unknown) {
    if (!phase || typeof systemFn !== 'function') {
      throw new Error('phase and generator system function are required');
    }
    var list = this._generatorSystems.get(phase);
    if (!list) {
      list = [];
      this._generatorSystems.set(phase, list);
    }
    list.push(systemFn);
  }

  run(phase: string, context?: BattleSystemRuntime) {
    var systems = this._systems.get(phase);
    if (!systems || systems.length === 0) {
      return;
    }
    var runtime = copyNativeBattleScriptContext(context || this._context, Object.assign({}, this._context, context, {
      phase: phase,
      battleService: this.battleService
    }));
    for (var i = 0; i < systems.length; i++) {
      var system = systems[i];
      this.fire('beforeSystem', { phase: phase, system: system.name || 'anonymous', context: runtime });
      system(runtime);
      this.fire('afterSystem', { phase: phase, system: system.name || 'anonymous', context: runtime });
    }
    this.fire('afterPhase', { phase: phase, context: runtime });
  }

  runPipeline(phases: PipelineEntry[] | PipelineEntry, context?: BattleSystemRuntime) {
    if (!Array.isArray(phases)) {
      phases = [phases];
    }
    for (var i = 0; i < phases.length; i++) {
      const entry = phases[i];
      const phaseName = typeof entry === 'string' ? entry : entry.phase;
      if (phaseName) {
        this.run(phaseName, context);
      }
    }
  }

  *_runTickPhase(entry: { phase: string; generator: boolean | null }, context?: BattleSystemRuntime) {
    if (!entry || !entry.phase) {
      return;
    }
    var useGenerator = entry.generator;
    if (useGenerator === null) {
      useGenerator = this._generatorSystems.has(entry.phase);
    }
    if (useGenerator) {
      yield* this.runGenerator(entry.phase, context);
    } else {
      this.run(entry.phase, context);
    }
  }

  *_effectivePipeline(context?: BattleSystemRuntime) {
    var pipeline = this._pipeline && this._pipeline.length
      ? this._pipeline
      : DEFAULT_PIPELINE.map((entry) => this._normalizePipelineEntry(entry));
    for (var i = 0; i < pipeline.length; i++) {
      yield* this._runTickPhase(pipeline[i], context);
    }
  }

  *runTick(context?: BattleSystemRuntime) {
    yield* this._effectivePipeline(context);
  }

  onStateMutated(event: AnyRecord) {
    this.fire('stateMutated', event);
  }

  onStateChanged(event: AnyRecord) {
    this.fire('stateChanged', event);
  }

  *runGenerator(phase: string, context?: BattleSystemRuntime) {
    var systems = this._generatorSystems.get(phase);
    if (!systems || systems.length === 0) {
      return;
    }
    var runtime = copyNativeBattleScriptContext(context || this._context, Object.assign({}, this._context, context, {
      phase: phase,
      battleService: this.battleService
    }));
    for (var i = 0; i < systems.length; i++) {
      var system = systems[i];
      this.fire('beforeSystem', { phase: phase, system: system.name || 'anonymous', context: runtime });
      var result = system(runtime) as any;
      if (result && typeof result.next === 'function') {
        // Delegate with yield* so the value the driver resumes us with (e.g. the result of
        // `yield script.runTriggerScript(...)` inside fight.ts) reaches the system. A manual
        // next() loop dropped it, and fight.ts then wrote undefined back into script entries.
        yield* result;
      }
      this.fire('afterSystem', { phase: phase, system: system.name || 'anonymous', context: runtime });
    }
    this.fire('afterPhase', { phase: phase, context: runtime });
  }

  *runGeneratorPipeline(phases: PipelineEntry[] | PipelineEntry, context?: BattleSystemRuntime) {
    if (!Array.isArray(phases)) {
      phases = [phases];
    }
    for (var i = 0; i < phases.length; i++) {
      const entry = phases[i];
      const phaseName = typeof entry === 'string' ? entry : entry.phase;
      if (phaseName) {
        yield* this.runGenerator(phaseName, context);
      }
    }
  }
}

export function idleAnimationSystem(runtime: BattleSystemRuntime) {
  var battleService = runtime.battleService;
  var registry = battleService.getRegistry();
  var state = battleService.getState();
  if (!registry || !state) {
    return;
  }

  var gameData = getGameData();
  var battleRuntime = runtime && runtime.battle;
  var party = getPartyList();

  var playerEntities = registry.iterateEntitiesWith([
    BattleComponents.BattleActor,
    BattleComponents.Position,
    BattleComponents.Animation
  ]);

  for (var p = 0; p < playerEntities.length; p++) {
    var playerEntity = playerEntities[p];
    var actorComp = registry.getComponent(playerEntity, BattleComponents.BattleActor);
    if (!actorComp || actorComp.type !== 'player') {
      continue;
    }
    var playerState = state.player && state.player[actorComp.index];
    if (!playerState) {
      continue;
    }
    var positionComp = registry.getComponent(playerEntity, BattleComponents.Position);
    var animationComp = registry.getComponent(playerEntity, BattleComponents.Animation);
    var spriteComp = registry.getComponent(playerEntity, BattleComponents.Sprite);
    var statsComp = registry.getComponent(playerEntity, BattleComponents.Stats);

    var originalPos = positionComp && positionComp.original != null
      ? positionComp.original
      : playerState.originalPos;
    playerState.pos = originalPos;
    if (positionComp) {
      positionComp.current = originalPos;
      positionComp.stateRef = playerState;
    }

    playerState.colorShift = 0;
    if (spriteComp) {
      spriteComp.colorShiftRef = playerState;
    }

    var roleId = null;
    if (statsComp && typeof statsComp.roleId === 'number') {
      roleId = statsComp.roleId;
    } else if (party && party[actorComp.index]) {
      roleId = party[actorComp.index].playerRole;
    }

    var nextFrame = playerState.currentFrame || 0;
    var statusRow = statsComp && statsComp.extra ? statsComp.extra.statusRef : null;
    if (!statusRow && roleId != null) {
      statusRow = getPlayerStatusRow(roleId);
    }

    if (roleId != null && gameData && gameData.playerRoles && gameData.playerRoles.HP) {
      var currentHP = gameData.playerRoles.HP[roleId];
      if (currentHP === 0) {
        var puppet = statusRow && statusRow[PlayerStatus.Puppet] ? statusRow[PlayerStatus.Puppet] : 0;
        nextFrame = puppet === 0 ? 2 : 0;
      } else {
        var isDying = battleRuntime && typeof battleRuntime.isPlayerDying === 'function'
          ? battleRuntime.isPlayerDying(roleId)
          : false;
        if ((statusRow && (statusRow[PlayerStatus.Sleep] || 0) !== 0) || isDying) {
          nextFrame = 1;
        } else if (playerState.defending && !state.enemyCleared) {
          nextFrame = 3;
        } else {
          nextFrame = 0;
        }
      }
    }

    playerState.currentFrame = nextFrame;
    if (animationComp) {
      animationComp.currentFrame = nextFrame;
      animationComp.stateRef = playerState;
    }
  }

  var enemyEntities = registry.iterateEntitiesWith([
    BattleComponents.BattleActor,
    BattleComponents.Position,
    BattleComponents.Animation
  ]);

  for (var e = 0; e < enemyEntities.length; e++) {
    var enemyEntity = enemyEntities[e];
    var enemyActor = registry.getComponent(enemyEntity, BattleComponents.BattleActor);
    if (!enemyActor || enemyActor.type !== 'enemy') {
      continue;
    }
    var enemyState = state.enemy && state.enemy[enemyActor.index];
    if (!enemyState || enemyState.objectID === 0) {
      continue;
    }
    var enemyPosition = registry.getComponent(enemyEntity, BattleComponents.Position);
    var enemyAnimation = registry.getComponent(enemyEntity, BattleComponents.Animation);
    var enemySprite = registry.getComponent(enemyEntity, BattleComponents.Sprite);

    var originalEnemyPos = enemyPosition && enemyPosition.original != null
      ? enemyPosition.original
      : enemyState.originalPos;
    enemyState.pos = originalEnemyPos;
    if (enemyPosition) {
      enemyPosition.current = originalEnemyPos;
      enemyPosition.stateRef = enemyState;
    }

    enemyState.colorShift = 0;
    if (enemySprite) {
      enemySprite.colorShiftRef = enemyState;
    }

    if (enemyState.status[PlayerStatus.Sleep] > 0 || enemyState.status[PlayerStatus.Paralyzed] > 0) {
      enemyState.currentFrame = 0;
      if (enemyAnimation) {
        enemyAnimation.currentFrame = 0;
        enemyAnimation.stateRef = enemyState;
      }
      continue;
    }

    if (enemyState.e) {
      var idleSpeed = enemyState.e.idleAnimSpeed != null ? enemyState.e.idleAnimSpeed : 0;
      idleSpeed = Math.max(idleSpeed - 1, 0);
      if (idleSpeed <= 0) {
        enemyState.currentFrame += 1;
        var gameDataStore = getGameData();
        var enemyObject = gameDataStore && gameDataStore.object ? gameDataStore.object[enemyState.objectID] : null;
        var enemyMeta = enemyObject && gameDataStore && gameDataStore.enemy
          ? gameDataStore.enemy[enemyObject.enemy.enemyID]
          : null;
        idleSpeed = enemyMeta && enemyMeta.idleAnimSpeed ? enemyMeta.idleAnimSpeed : 1;
      }
      enemyState.e.idleAnimSpeed = idleSpeed;
    }

    if (enemyState.e && enemyState.e.idleFrames != null && enemyState.currentFrame >= enemyState.e.idleFrames) {
      enemyState.currentFrame = 0;
    }

    if (enemyAnimation) {
      enemyAnimation.currentFrame = enemyState.currentFrame;
      enemyAnimation.stateRef = enemyState;
    }
  }

  if (typeof battleService.syncActorComponents === 'function') {
    battleService.syncActorComponents();
  }
}

export function renderSceneSystem(runtime: BattleSystemRuntime) {
  var battleService = runtime.battleService;
  var surface = runtime.surface;
  if (!battleService || !surface) {
    return;
  }
  var registry = battleService.getRegistry();
  var state = battleService.getState();
  if (!registry || !state) {
    return;
  }
  const party = getPartyList();
  const gameDataStore = getGameData();
  const hpTable = gameDataStore && gameDataStore.playerRoles ? gameDataStore.playerRoles.HP : null;

  var battleState = state;
  var background = battleState.background;
  var sceneBuf = battleState.sceneBuf;

  if (!background || !sceneBuf) {
    return;
  }

  // battleState 是状态服务的 Proxy:每次取属性都要拼路径、再包一层。逐像素(320×200)循环里别碰它,
  // 色移和循环上界提到循环外只取一次 —— 之前一帧 64000 次 Proxy 读,占战斗 CPU 的一半
  var colorShift = battleState.backgroundColorShift;
  var total = surface.pitch * surface.height;
  var srcOffset = 0;
  var dstOffset = 0;
  for (var i = 0; i < total; i++) {
    var value = background[srcOffset] & 0x0F;
    value += colorShift;

    if (value & 0x80) {
      value = 0;
    } else if (value & 0x70) {
      value = 0x0F;
    }

    sceneBuf[dstOffset] = (value | (background[srcOffset] & 0xF0));
    srcOffset++;
    dstOffset++;
  }

  scene.applyWave(sceneBuf);

  var enemies = sortByActorIndexDescending(registry, registry.iterateEntitiesWith([
    BattleComponents.BattleActor,
    BattleComponents.Position,
    BattleComponents.Sprite,
    BattleComponents.Animation
  ])).filter(function(entry) {
    return entry.actor.type === 'enemy';
  });

  for (var eIndex = 0; eIndex < enemies.length; eIndex++) {
    var entry = enemies[eIndex];
    var enemyState = state.enemy && state.enemy[entry.actor.index];
    if (!enemyState || enemyState.objectID === 0 || !enemyState.sprite) {
      continue;
    }
    var pos = enemyState.pos;
    if (enemyState.status[PlayerStatus.Confused] > 0 &&
        enemyState.status[PlayerStatus.Sleep] == 0 &&
        enemyState.status[PlayerStatus.Paralyzed] == 0) {
      pos = ensurePALXY(ensurePALX(pos) + getRandomLong(-1, 1), ensurePALY(pos));
    }
    var frame = enemyState.sprite.getFrame(enemyState.currentFrame);
    var drawPos = ensurePALXY(
      ensurePALX(pos) - Math.floor(frame.width / 2),
      ensurePALY(pos) - frame.height
    );

    if (enemyState.colorShift && enemyState.colorShift !== 0) {
      surface.blitRLEWithColorShift(frame, drawPos, enemyState.colorShift, sceneBuf);
    } else {
      surface.blitRLE(frame, drawPos, sceneBuf);
    }
  }

  if (battleState.summonSprite) {
    var summonFrame = battleState.summonSprite.getFrame(battleState.summonFrame);
    var summonPos = ensurePALXY(
      ensurePALX(battleState.summonPos) - Math.floor(summonFrame.width / 2),
      ensurePALY(battleState.summonPos) - summonFrame.height
    );
    surface.blitRLE(summonFrame, summonPos, sceneBuf);
  } else {
    var players = sortByActorIndexDescending(registry, registry.iterateEntitiesWith([
      BattleComponents.BattleActor,
      BattleComponents.Position,
      BattleComponents.Sprite,
      BattleComponents.Animation,
      BattleComponents.Stats
    ])).filter(function(entry) {
      return entry.actor.type === 'player';
    });

    for (var pIndex = 0; pIndex < players.length; pIndex++) {
      var playerEntry = players[pIndex];
      var playerState = state.player && state.player[playerEntry.actor.index];
      if (!playerState || !playerState.sprite) {
        continue;
      }
      var statsComp = registry.getComponent(playerEntry.id, BattleComponents.Stats);
      var statusRow = statsComp && statsComp.extra ? statsComp.extra.statusRef : null;
      var roleId = statsComp && typeof statsComp.roleId === 'number'
        ? statsComp.roleId
        : (party && party[playerEntry.actor.index]
              ? party[playerEntry.actor.index].playerRole
              : null);
      if (!statusRow && roleId != null) {
        statusRow = getPlayerStatusRow(roleId);
      }

      if (statusRow &&
          statusRow[PlayerStatus.Confused] != 0 &&
          statusRow[PlayerStatus.Sleep] == 0 &&
          statusRow[PlayerStatus.Paralyzed] == 0 &&
          hpTable &&
          roleId != null &&
          hpTable[roleId] > 0) {
        continue;
      }

      var frame = playerState.sprite.getFrame(playerState.currentFrame);
      var drawPos = ensurePALXY(
        ensurePALX(playerState.pos) - Math.floor(frame.width / 2),
        ensurePALY(playerState.pos) - frame.height
      );

      if (playerState.colorShift && playerState.colorShift !== 0) {
        surface.blitRLEWithColorShift(frame, drawPos, playerState.colorShift, sceneBuf);
      } else if (battleState.hidingTime === 0) {
        surface.blitRLE(frame, drawPos, sceneBuf);
      }
    }

    for (var cpIndex = 0; cpIndex < players.length; cpIndex++) {
      var confusedEntry = players[cpIndex];
      var confusedState = state.player && state.player[confusedEntry.actor.index];
      if (!confusedState || !confusedState.sprite) {
        continue;
      }
      var stats = registry.getComponent(confusedEntry.id, BattleComponents.Stats);
      var statusRowConf = stats && stats.extra ? stats.extra.statusRef : null;
      var roleIdConf = stats && typeof stats.roleId === 'number'
        ? stats.roleId
        : (party && party[confusedEntry.actor.index]
            ? party[confusedEntry.actor.index].playerRole
            : null);
      if (!statusRowConf && roleIdConf != null) {
        statusRowConf = getPlayerStatusRow(roleIdConf);
      }
      var hpTableConf = hpTable;

      if (!(statusRowConf &&
          statusRowConf[PlayerStatus.Confused] != 0 &&
          statusRowConf[PlayerStatus.Sleep] == 0 &&
          statusRowConf[PlayerStatus.Paralyzed] == 0 &&
          hpTableConf &&
          roleIdConf != null &&
          hpTableConf[roleIdConf] > 0)) {
        continue;
      }

      var confusedFrame = confusedState.sprite.getFrame(confusedState.currentFrame);
      var jitterPos = ensurePALXY(
        ensurePALX(confusedState.pos),
        ensurePALY(confusedState.pos) + getRandomLong(-1, 1)
      );
      var confusedDrawPos = ensurePALXY(
        ensurePALX(jitterPos) - Math.floor(confusedFrame.width / 2),
        ensurePALY(jitterPos) - confusedFrame.height
      );

      if (confusedState.colorShift && confusedState.colorShift !== 0) {
        surface.blitRLEWithColorShift(confusedFrame, confusedDrawPos, confusedState.colorShift, sceneBuf);
      } else if (battleState.hidingTime === 0) {
        surface.blitRLE(confusedFrame, confusedDrawPos, sceneBuf);
      }
    }
  }
}

export default function createBattleSystemManager(
  options: { battleService?: any; surface?: any; battle?: any }
): BattleSystemManager {
  var battleService = options && options.battleService;
  var surface = options && options.surface;
  var battle = options && options.battle;
  if (!battleService) {
    throw new Error('battleService is required to create a system manager');
  }
  var manager = new BattleSystemManager(battleService, { surface: surface, battle: battle });
  manager.register('time', timeChargeSystem);
  manager.register('status', statusDecaySystem);
  manager.register('ai', aiPreparationSystem);
  manager.register('animation', idleAnimationSystem);
  manager.register('render', renderSceneSystem);
  manager.registerGenerator('queue', selectActionQueueSystem);
  manager.registerGenerator('action', performActionPhaseSystem);
  manager.setPipeline(DEFAULT_PIPELINE);
  return manager;
}
