import { battleLoopRuntime } from '../../services/battle-loop-runtime';
import { bindNativeBattleScriptContext } from '../../services/battle-script-execution';
import { battleCommandRuntime } from '../../services/battle-command-runtime';
import input from './input';
import script from '../../services/script-service';
import Sprite from './sprite';
import uibattle from './uibattle';
import sound from './sound';
import resourceService from '../../services/resource-service';
import utils from './utils';
import battleService from '../../services/battle-service';
import dialogService from '../../services/dialog-service';
import { SHORT, WORD } from './binary-helper';
import { recomputeTimeChargingUnit } from '../../services/battle-systems.js';
import { BattleComponents } from '../../ecs/index';
import scriptObjectAdapter from '../../services/script-object-adapter';
import gameDataAdapter from '../../services/game-data-adapter';
import partyTrailAdapter from '../../services/party-trail-adapter';
import { audioResourceSignals } from '../../state/slices/audio-resources';
import { autoBattleSignal } from '../../state/slices/auto-battle';
import {
  getBattleFieldEntry as getCachedBattleFieldEntry,
  getBattleFieldId as getCachedBattleFieldId,
  getBattleStateSnapshot
} from '../../services/battle-state-adapter.js';
import {
  getPlayerRolesSnapshot,
  getPlayerHP,
  getPlayerMP,
  getPlayerMaxHP,
  getPlayerMaxMP,
  getPlayerNameId,
  getPlayerMagicSlotCount,
  getPlayerMagicSlots,
  getPlayerMagicAt,
  getPlayerMagicSound,
  getPlayerAttackSound,
  getPlayerCriticalSound,
  getPlayerWeaponSound,
  getPlayerCoverSound,
  getPlayerDyingSound,
  getPlayerDeathSound,
  getPlayerCoveredBy,
  getPlayerStatusMatrix,
  getPlayerStatusRow,
  getPlayerStatusValue as getAdapterPlayerStatusValue,
  getMaxPartyMemberIndex as getCachedMaxPartyMemberIndex
} from '../../services/player-state-adapter';
import worldService from '../../services/world-service';
import panoramaRenderer from './panorama-renderer.js';
import panoramaDialog from './panorama-dialog.js';
import {
  PAL_X, PAL_Y, PAL_XY, Key, Direction, PlayerStatus, ObjectState, BodyPart,
  TriggerMode, ItemFlag, MagicFlag, MagicType, NumColor, NumAlign, DialogPosition, PAL_CLASSIC
} from './pal-global';

declare const log: any;
declare const sleep: any;
declare const SUPER_ATTACK: any;
declare const SUPER_DEFENSE: any;
declare const INVINCIBLE: any;
declare const randomLong: any;
declare const ui: any;
declare const config: any;

const autoBattleFlagSignal = autoBattleSignal();
const audioResourceSlice = audioResourceSignals();
const screenWaveSignal = audioResourceSlice.screenWave;

function isAutoBattleEnabled() {
  return !!autoBattleFlagSignal.value;
}

function getScreenWaveLevel() {
  const value = screenWaveSignal.value;
  return typeof value === 'number' ? value : 0;
}

function createMutableIndexedProxy(getter: any, setter: any, lengthGetter: any): any {
  return new Proxy({}, {
    get(target: any, prop: any) {
      if (prop === 'length') {
        return typeof lengthGetter === 'function' ? lengthGetter() : target[prop];
      }
      const index = Number(prop);
      if (!Number.isNaN(index)) {
        return getter(index);
      }
      return target[prop];
    },
    set(target: any, prop: any, value: any) {
      const index = Number(prop);
      if (!Number.isNaN(index)) {
        setter(index, value);
        return true;
      }
      target[prop] = value;
      return true;
    }
  });
}

function createReadonlyIndexedProxy(getter: any, lengthGetter: any): any {
  return new Proxy({}, {
    get(target: any, prop: any) {
      if (prop === 'length') {
        return typeof lengthGetter === 'function' ? lengthGetter() : target[prop];
      }
      const index = Number(prop);
      if (!Number.isNaN(index)) {
        return getter(index);
      }
      return target[prop];
    },
    set() {
      return true;
    }
  });
}

function createPlayerMagicFacade(): any {
  const cache = new Map();
  return new Proxy({}, {
    get(target: any, prop: any) {
      if (prop === 'length') {
        return getPlayerMagicSlotCount();
      }
      const slotIndex = Number(prop);
      if (!Number.isNaN(slotIndex)) {
        if (!cache.has(slotIndex)) {
          cache.set(slotIndex, createMutableIndexedProxy(
            (roleId: any) => getPlayerMagicAt(slotIndex, roleId),
            (roleId: any, value: any) => worldService.setPlayerMagicSlot(roleId, slotIndex, value),
            () => (typeof Const !== 'undefined' && Const && typeof Const.MAX_PLAYER_ROLES === 'number')
              ? Const.MAX_PLAYER_ROLES
              : 0
          ));
        }
        return cache.get(slotIndex);
      }
      return target[prop];
    },
    set(target: any, prop: any, value: any) {
      target[prop] = value;
      return true;
    }
  });
}

function createPlayerRolesFacade(): any {
  const lengthGetter = () => (typeof Const !== 'undefined' && Const && typeof Const.MAX_PLAYER_ROLES === 'number')
    ? Const.MAX_PLAYER_ROLES
    : 0;
  const hpProxy = createMutableIndexedProxy(
    (roleId: any) => getPlayerHP(roleId),
    (roleId: any, value: any) => worldService.setPlayerHP(roleId, value),
    lengthGetter
  );
  const mpProxy = createMutableIndexedProxy(
    (roleId: any) => getPlayerMP(roleId),
    (roleId: any, value: any) => worldService.setPlayerMP(roleId, value),
    lengthGetter
  );
  const maxHpProxy = createMutableIndexedProxy(
    (roleId: any) => getPlayerMaxHP(roleId),
    (roleId: any, value: any) => worldService.setPlayerMaxHP(roleId, value),
    lengthGetter
  );
  const maxMpProxy = createMutableIndexedProxy(
    (roleId: any) => getPlayerMaxMP(roleId),
    (roleId: any, value: any) => worldService.setPlayerMaxMP(roleId, value),
    lengthGetter
  );
  const magicProxy = createPlayerMagicFacade();
  const soundLengthGetter = lengthGetter;
  const magicSoundProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerMagicSound(roleId),
    soundLengthGetter
  );
  const attackSoundProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerAttackSound(roleId),
    soundLengthGetter
  );
  const criticalSoundProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerCriticalSound(roleId),
    soundLengthGetter
  );
  const weaponSoundProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerWeaponSound(roleId),
    soundLengthGetter
  );
  const coverSoundProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerCoverSound(roleId),
    soundLengthGetter
  );
  const dyingSoundProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerDyingSound(roleId),
    soundLengthGetter
  );
  const deathSoundProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerDeathSound(roleId),
    soundLengthGetter
  );
  const coveredByProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerCoveredBy(roleId),
    soundLengthGetter
  );
  const nameProxy = createReadonlyIndexedProxy(
    (roleId: any) => getPlayerNameId(roleId),
    soundLengthGetter
  );

  return new Proxy({}, {
    get(target: any, prop: any) {
      switch (prop) {
        case 'HP':
          return hpProxy;
        case 'MP':
          return mpProxy;
        case 'maxHP':
          return maxHpProxy;
        case 'maxMP':
          return maxMpProxy;
        case 'magic':
          return magicProxy;
        case 'magicSound':
          return magicSoundProxy;
        case 'attackSound':
          return attackSoundProxy;
        case 'criticalSound':
          return criticalSoundProxy;
        case 'weaponSound':
          return weaponSoundProxy;
        case 'coverSound':
          return coverSoundProxy;
        case 'dyingSound':
          return dyingSoundProxy;
        case 'deathSound':
          return deathSoundProxy;
        case 'coveredBy':
          return coveredByProxy;
        case 'name':
          return nameProxy;
        default:
          return target[prop];
      }
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function createFightGameDataFacade(): any {
  const playerRolesProxy = createPlayerRolesFacade();
  const magicProxy = createReadonlyIndexedProxy(
    (id: any) => gameDataAdapter.getMagicEntry(id),
    null
  );
  const objectProxy = createReadonlyIndexedProxy(
    (id: any) => scriptObjectAdapter.getObjectEntry(id),
    null
  );
  const enemyProxy = createReadonlyIndexedProxy(
    (id: any) => gameDataAdapter.getEnemyEntry(id),
    null
  );
  const battleFieldProxy = createReadonlyIndexedProxy(
    (id: any) => getCachedBattleFieldEntry(id),
    null
  );
  const battleEffectProxy = createReadonlyIndexedProxy(
    (id: any) => gameDataAdapter.getBattleEffectIndexRow(id),
    null
  );

  return new Proxy({}, {
    get(target: any, prop: any) {
      switch (prop) {
        case 'playerRoles':
          return playerRolesProxy;
        case 'magic':
          return magicProxy;
        case 'object':
          return objectProxy;
        case 'enemy':
          return enemyProxy;
        case 'battleField':
          return battleFieldProxy;
        case 'battleEffectIndex':
          return battleEffectProxy;
        default:
          return target[prop];
      }
    },
    set(target: any, prop: any, value: any) {
      target[prop] = value;
      return true;
    }
  });
}

const GameData = createFightGameDataFacade();

log.trace('fight module load');

var fight: any = {};

function BATTLE() {
  const state = battleService.getState && battleService.getState();
  if (state) {
    return state;
  }
  return getBattleStateSnapshot() || {};
}

function withBattle(fn: any, options?: any) {
  return battleService.withState(fn, options);
}

function setBattleField(field: any, value: any) {
  return battleService.set([field], value);
}

function mutatePlayer(index: any, mutator: any) {
  return battleService.setPlayer(index, function(player: any) {
    if (!player) {
      return player;
    }
    mutator(player);
    return player;
  });
}

function getPartyEntries() {
  const party = partyTrailAdapter.getPartyState();
  return Array.isArray(party) ? party : [];
}

function getMaxPartyIndex() {
  const maxIndex = getCachedMaxPartyMemberIndex();
  if (typeof maxIndex === 'number' && maxIndex >= 0) {
    return maxIndex;
  }
  const party = getPartyEntries();
  return party.length > 0 ? party.length - 1 : -1;
}

function getPlayerRolesData() {
  return getPlayerRolesSnapshot();
}

function getPlayerStatusValue(roleId: any, statusIndex: any) {
  return getAdapterPlayerStatusValue(roleId, statusIndex);
}

function hasPlayerStatus(roleId: any, statusIndex: any) {
  return getPlayerStatusValue(roleId, statusIndex) !== 0;
}

function getPartyMember(index: any) {
  const party = getPartyEntries();
  return party[index] || null;
}

function getPartyMemberRole(index: any) {
  var member = getPartyMember(index);
  return member ? member.playerRole : null;
}

function getCurrentBattleFieldEntry() {
  var fieldId = getCachedBattleFieldId();
  if (typeof fieldId !== 'number') {
    return null;
  }
  return getCachedBattleFieldEntry(fieldId) || null;
}

function getCurrentBattleFieldMagicEffect(index: any) {
  var entry = getCurrentBattleFieldEntry() as any;
  if (!entry || !entry.magicEffect) {
    return 0;
  }
  var effects = entry.magicEffect as any;
  if (Array.isArray(effects)) {
    return effects[index] || 0;
  }
  if (ArrayBuffer.isView(effects)) {
    return (effects as any)[index] || 0;
  }
  return 0;
}
function mutateEnemy(index: any, mutator: any) {
  return battleService.updateEnemy(index, function(enemy: any) {
    if (!enemy) {
      return enemy;
    }
    mutator(enemy);
    return enemy;
  });
}

function mutateUI(mutator: any) {
  var result = battleService.setUI(function(uiState: any) {
    if (!uiState) {
      return uiState;
    }
    mutator(uiState);
    return uiState;
  });
  updateUIComponent();
  return result;
}

function setPlayerPosition(index: any, position: any) {
  return mutatePlayer(index, function(player: any) {
    if (typeof position === 'function') {
      player.pos = position(player.pos);
    } else {
      player.pos = position;
    }
    return player;
  });
}

function setPlayerFrame(index: any, frame: any) {
  return mutatePlayer(index, function(player: any) {
    player.currentFrame = typeof frame === 'function' ? frame(player.currentFrame) : frame;
    return player;
  });
}

function mutatePlayerAction(index: any, mutator: any) {
  return mutatePlayer(index, function(player: any) {
    if (player && player.action) {
      mutator(player.action, player);
    }
    return player;
  });
}

function mutateInventory(mutator: any) {
  return worldService.mutateInventory(function(inventory: any) {
    if (inventory && typeof mutator === 'function') {
      mutator(inventory);
    }
    return inventory;
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

function getPartyEntry(index: any) {
  const party = getPartyEntries();
  return party[index] || null;
}

function getPartyRoleId(index: any) {
  const entry = getPartyEntry(index);
  return entry ? entry.playerRole : null;
}

function updateUIComponent(patch?: any) {
  if (!battleService.getUIEntity || !battleService.getRegistry) {
    return;
  }
  var entityId = battleService.getUIEntity();
  if (!entityId) {
    return;
  }
  var registry = battleService.getRegistry();
  var component = registry.getComponent(entityId, BattleComponents.UIState);
  if (!component) {
    return;
  }
  if (typeof patch === 'function') {
    patch(component);
    return;
  }
  var uiState = getUIState();
  component.stateRef = uiState;
  component.state = uiState ? uiState.state : null;
  component.menuState = uiState ? uiState.menuState : null;
  component.currentPlayer = uiState ? uiState.curPlayerIndex : null;
  component.selectedAction = uiState ? uiState.selectedAction : null;
  component.selectedIndex = uiState ? uiState.selectedIndex : null;
  component.autoBattle = uiState ? uiState.autoAttack : false;
}

function getUIState() {
  if (typeof battleService.getUI === 'function') {
    var ui = battleService.getUI();
    if (ui) {
      return ui;
    }
  }
  if (typeof battleService.getUIComponent === 'function') {
    var component = battleService.getUIComponent();
    if (component && component.stateRef) {
      return component.stateRef;
    }
  }
  var state = battleService.getState();
  if (state && state.UI) {
    return state.UI;
  }
  const fallback = getBattleStateSnapshot();
  if (fallback && fallback.UI) {
    return fallback.UI;
  }
  return null;
}

function getUIProp(prop: any, fallback: any) {
  var uiState = getUIState();
  if (uiState && Object.prototype.hasOwnProperty.call(uiState, prop)) {
    return uiState[prop];
  }
  return typeof fallback === 'undefined' ? null : fallback;
}

var surface: any = null
var battle: any = null;

function updateTimeChargingUnit() {
  recomputeTimeChargingUnit();
}

function chargeTimeMeters() {
  if (!battleService || typeof battleService.runSystems !== 'function') {
    return;
  }
  battleService.runSystems(['time', 'ai'], { surface: surface, battle: battle });
}

fight.init = function*(surf: any, _battle: any): Generator<any, any, any> {
  log.debug('[BATTLE] init fight');
  surface = surf;
  battle = _battle;
  updateTimeChargingUnit();

  yield resourceService.loadMKF('FIRE', 'F');
  Files.FIRE = resourceService.getMKF('FIRE');
  Files.F = resourceService.getMKF('F');

  /**
   * Pick an enemy target automatically.
   * @return {Number}
   */
  battle.selectAutoTarget = function() {
    return battle.selectAutoTargetFrom(0);
  };

  /**
   * Pick an enemy target automatically, scanning (with wrap-around) from
   * the given enemy index.
   * @param  {Number} begin the beginning target index.
   * @return {Number}       The index of enemy. -1 if failed.
   */
  battle.selectAutoTargetFrom = function(begin: any) {
    var i = getUIProp('prevEnemyTarget', -1);
    var maxEnemyIndex = BATTLE().maxEnemyIndex;

    if (i >= 0 && i <= maxEnemyIndex &&
        BATTLE().enemy[i].objectID != 0 &&
        BATTLE().enemy[i].e.health > 0) {
      return i;
    }

    i = (begin >= 0 ? begin : 0);
    for (var count = 0; count < Const.MAX_ENEMIES_IN_TEAM; count++) {
      var enemy = BATTLE().enemy[i];
      if (enemy && enemy.objectID != 0 &&
          enemy.e.health > 0) {
        return i;
      }
      i = (i + 1) % (maxEnemyIndex + 1);
    }

    return -1;
  };

  /**
   * Correct the target of a magic whose type does not fit the selected
   * target (single target vs. all), as in FIGHT_DetectMagicTargetChange.
   * @param  {Number} magicNum the magic number.
   * @param  {Number} target   the selected target.
   * @return {Number}          The corrected target.
   */
  battle.detectMagicTargetChange = function(magicNum: any, target: any) {
    var type = GameData.magic[magicNum].type;

    if (target == -1 && (
        type == MagicType.Normal ||
        type == MagicType.ApplyToPlayer ||
        type == MagicType.Trance)) {
      target = 0;
    }

    if (target != -1 && (
        type == MagicType.AttackAll ||
        type == MagicType.AttackWhole ||
        type == MagicType.AttackField ||
        type == MagicType.ApplyToParty ||
        type == MagicType.Summon)) {
      target = -1;
    }

    return target;
  };

  /**
   * Check if we should enter hiding state after using items or magics.
   */
  battle.checkHidingEffect = function*(): Generator<any, any, any> {
    if (BATTLE().hidingTime < 0) {
      battleService.setHidingTime(-BATTLE().hidingTime);
      battle.backupScene();
      battle.makeScene();
      yield battle.fadeScene();
    }
  };

  /**
   * Delay a while during battle.
   * @param {Number} duration      Number of frames of the delay.
   * @param {Number} objectID      The object ID to be displayed during the delay.
   * @param {Boolean} updateGesture true if update the gesture for enemies, false if not.
   */
  battle.delay = function*(duration: any, objectID: any, updateGesture: any): Generator<any, any, any> {
    var sceneBuf = BATTLE().sceneBuf;
    var screen = surface.byteBuffer;
    for (var i = 0; i < duration; i++) {
      if (updateGesture) {
        // Update the gesture of enemies.
        for (var j = 0; j <= BATTLE().maxEnemyIndex; j++) {
          var enemy = BATTLE().enemy[j];
          if (enemy.objectID == 0 ||
              enemy.status[PlayerStatus.Sleep] != 0 ||
              enemy.status[PlayerStatus.Paralyzed] != 0) {
            continue;
          }

          if (--enemy.e.idleAnimSpeed == 0) {
            enemy.currentFrame++;
            enemy.e.idleAnimSpeed = GameData.enemy[GameData.object[enemy.objectID].enemy.enemyID].idleAnimSpeed;
          }

          if (enemy.currentFrame >= enemy.e.idleFrames) {
            enemy.currentFrame = 0;
          }
        }
      }

      battle.makeScene();
      surface.blitSurface(sceneBuf, null, screen, null);
      yield uibattle.update();

      if (objectID != 0) {
        if (objectID == ui.BATTLE_LABEL_ESCAPEFAIL) {
          // HACKHACK
          ui.drawText(ui.getWord(objectID), PAL_XY(130, 75), 15, true, false);
        } else if (SHORT(objectID) < 0) {
          ui.drawText(ui.getWord(-SHORT(objectID)), PAL_XY(170, 45), ui.DESCTEXT_COLOR, true, false);
        } else {
          ui.drawText(ui.getWord(objectID), PAL_XY(210, 50), 15, true, false);
        }
      }

      surface.updateScreen(null);

      yield sleepByFrame(1);
    }
  };

  /**
   * Update players' and enemies' gestures and locations in battle.
   */
  battle.updateFighters = function() {
    log.trace('[BATTLE] updateFighters');
    if (typeof battleService.runSystems === 'function') {
      battleService.runSystems('animation', { surface: surface, battle: battle });
      return;
    }
    if (battle.systemManager) {
      battle.systemManager.run('animation', { surface: surface, battle: battle });
    }
  };

  /**
   * Check if there are player who is ready.
   */
  battle.playerCheckReady = function() {
    log.trace('[BATTLE] playerCheckReady');
    var flMax = 0;
    var iMax = 0;

    withBattle(function(state: any) {
      for (var i = 0; i <= getMaxPartyIndex(); i++) {
        var player = state.player[i];
        if (!player) continue;
        if (player.state == FighterState.Com ||
          (player.state == FighterState.Act && player.action.actionType == BattleActionType.CoopMagic)) {
          flMax = 0;
          break;
        } else if (player.state == FighterState.Wait) {
          if (player.timeMeter > flMax) {
            iMax = i;
            flMax = player.timeMeter;
          }
        }
      }

      if (flMax >= 100.0) {
        var fastest = state.player[iMax];
        if (fastest) {
          fastest.state = FighterState.Com;
          fastest.defending = false;
        }
      }
    });
  };

  /**
   * Called once per video frame in battle.
  */
  battle.startFrame = function*(battleScriptParent?: unknown): Generator<any, any, any> {
    //BATTLE().battleResult = BattleResult.Won;

    var battleState = BATTLE();
    var sceneBuf = battleState.sceneBuf;
    var screen = surface.byteBuffer;

    var partyEntries = getPartyEntries();
    var maxPartyIndex = getMaxPartyIndex();
    var onlyPuppet = true;
    var ended = true;

    for (var partyIndex = 0; partyIndex <= maxPartyIndex; partyIndex++) {
      var partyEntry = partyEntries[partyIndex];
      if (!partyEntry) {
        continue;
      }
      var roleId = partyEntry.playerRole;
      if (getPlayerHP(roleId) !== 0) {
        onlyPuppet = false;
        ended = false;
        break;
      }
      // As in SDLPAL: a puppet does not keep the battle going (with nobody alive it is lost),
      // it only clears onlyPuppet. This used to be the other way round, so a fallen party
      // with a puppet never lost and onlyPuppet stopped the enemies from acting.
      var statusRow = getPlayerStatusRow(roleId);
      if ((statusRow[PlayerStatus.Puppet] || 0) !== 0) {   // 行未建时是 []:undefined 不算傀儡
        onlyPuppet = false;
      }
    }

    if (ended) {
      battleService.setBattleResult(BattleResult.Lost);
      return;
    }

    yield* battleService.runTick(battleLoopRuntime.bindContext(bindNativeBattleScriptContext({
      battle: battle,
      surface: surface,
      sceneBuf: sceneBuf,
      screen: screen,
      onPlayerReady: typeof uibattle.playerReady === 'function' ? uibattle.playerReady : null,
      onlyPuppet: onlyPuppet
    }, battleScriptParent), battleScriptParent));

    battleState = BATTLE();
    sceneBuf = battleState.sceneBuf || sceneBuf;

    if (battleState.enemyCleared) {
      battleService.setBattleResult(BattleResult.Won);
      sound.play(-1);
      return;
    }

    // Re-check defeat conditions in case actions resolved this frame.
    partyEntries = getPartyEntries();
    maxPartyIndex = getMaxPartyIndex();

    var everyoneDown = true;
    for (var checkIndex = 0; checkIndex <= maxPartyIndex; checkIndex++) {
      var checkEntry = partyEntries[checkIndex];
      if (!checkEntry) {
        continue;
      }
      var checkRole = checkEntry.playerRole;
      if (getPlayerHP(checkRole) !== 0) {
        everyoneDown = false;
        break;
      }
    }
    if (everyoneDown) {
      battleService.setBattleResult(BattleResult.Lost);
      return;
    }

    // The R and F keys and Fleeing should affect all players
    var currentMenuState = getUIProp('menuState', BattleMenuState.Main);
    var currentUIState = getUIProp('state', BattleUIState.Wait);
    if (currentMenuState == BattleMenuState.Main &&
        currentUIState == BattleUIState.SelectMove) {
      if (!battleCommandRuntime.owned && input.isKeyPressed(Key.Repeat)) {
        setBattleField('repeat', true);
        // Repeat also restores the auto-attack mode of the previous round.
        var prevAutoAtk = !!BATTLE().prevAutoAtk;
        mutateUI(function(uiState: any) {
          uiState.autoAttack = prevAutoAtk;
          return uiState;
        });
      } else if (!battleCommandRuntime.owned && input.isKeyPressed(Key.Force)) {
         setBattleField('force', true);
      }
    }

    battleState = BATTLE();
    // Legacy round keys remain exact. Owned Repeat/Flee are consumed at the
    // completed parent; Force retains its separate native UI policy bridge.
    const policyKey = battleState.repeat ? Key.Repeat : battleState.force ? Key.Force : battleState.flee ? Key.Flee : 0;
    if (!battleCommandRuntime.owned && policyKey) input.keyPress = policyKey;

    surface.blitSurface(sceneBuf, null, screen, null);
    // Update the battle UI
    yield uibattle.update(battleCommandRuntime.owned ? (!battleState.repeat && battleState.force ? Key.Force : 0) : undefined);
    surface.updateScreen(null);
  };

  /** Accepted owned repeat uses the same native flags as legacy Repeat. */
  battle.beginRepeat = function(assertOwnedRoot: () => void) {
    assertOwnedRoot();
    var prevAutoAtk = !!BATTLE().prevAutoAtk;
    assertOwnedRoot();
    setBattleField('repeat', true);
    // Native setters notify synchronous observers. A first flag effect may
    // invalidate the captured root/role; no later restoration may then write.
    assertOwnedRoot();
    mutateUI(function(uiState: any) {
      assertOwnedRoot();
      uiState.autoAttack = prevAutoAtk;
      assertOwnedRoot();
      return uiState;
    });
    assertOwnedRoot();
  };

  /**
   * Commit the action which the player decided.
   *
   * 兼容适配器(docs/specs/agent-pal-m5-command.md C1a):从界面字段拼出这次的选择与旧入口的上下文,交给
   * commitCommand。uibattle 里的调用点与时点不变。
   * @param  {Boolean} repeat true if repeat the last action.
   */
  battle.commitAction = function(repeat: any) {
    log.debug(['[BATTLE] commitAction', repeat].join(' '));
    var currentIndex = getUIProp('curPlayerIndex', 0);
    var curPlayer = BATTLE().player[currentIndex];
    if (!curPlayer) {
      return;
    }
    // 界面上没有的字段沿用当前动作的值(旧行为:getUIProp 的缺省)
    var choice = repeat ? { repeat: true } : {
      actionType: getUIProp('actionType', curPlayer.action.actionType),
      actionID: getUIProp('objectID', curPlayer.action.actionID),
      target: getUIProp('selectedIndex', curPlayer.action.target)
    };
    var uiState = getUIState();
    var uiHasActionType = !!uiState && Object.prototype.hasOwnProperty.call(uiState, 'actionType');
    battle.commitCommand(currentIndex, choice, {
      // 旧行为:逃跑标志看界面上选的动作(repeat 时它不一定等于展开后的动作);界面上没有这个字段才看提交后的动作
      fleeIntent: uiHasActionType ? uiState.actionType == BattleActionType.Flee : undefined,
      autoAttack: !!getUIProp('autoAttack', false),
      uiToWait: true
    });
  };

  /**
   * 提交一个队员的指令(C1a 从 commitAction 等价提取;不读界面字段)。
   * choice:{ actionType, actionID, target } 或 { repeat: true }(取上一行动,保留当前目标槽)。
   * legacy:旧入口才有的上下文 ——
   *   fleeIntent  是否把这次提交算作逃跑;不给 = 看提交后的动作是不是逃跑
   *   autoAttack  普攻的 actionID 标记(1 = 来自自动攻击)
   *   uiToWait    提交后把界面状态置回 Wait(轮到下一个队员)
   * 效果同旧 commitAction:写 action 四个字段、仙术 MP 不够降级、消耗品 / 投掷预约(amountInUse)、逃跑标志、state = Act。
   * 返回实际提交的动作(副本);没有这个队员返回 null。
   */
  battle.commitCommand = function(member: any, choice: any, legacy: any) {
    var context = legacy || {};
    var curPlayer = BATTLE().player[member];
    if (!curPlayer) {
      return null;
    }
    var currentPartyEntry = getPartyEntry(member);
    var currentRoleId = currentPartyEntry ? currentPartyEntry.playerRole : null;
    // 这次提交对动作四个字段的全部改写(含 repeat 展开、仙术 MP 不够的降级),写成对一个动作对象的操作:
    // 先在组件值的副本上算出结果、写进组件(M5 C1b:committed 以组件为真),再对 player.action 原样执行一遍完成投影 ——
    // 状态代理对每次字段赋值都发 stateMutated,所以投影沿用旧代码的赋值顺序与次数
    var prevAction = curPlayer.prevAction;
    var applyChoice = function(action: any) {
      if (!(choice && choice.repeat)) {
        var actionType = choice.actionType;
        action.actionType = actionType;
        action.target = SHORT(choice.target);
        // For attacks, actionID marks whether it came from auto-attack.
        action.actionID = (actionType == BattleActionType.Attack)
          ? (context.autoAttack ? 1 : 0)
          : choice.actionID;
        action.remainingTime = 0;
      } else {
        // Repeat the action backed up at the start of the previous round
        // (before statuses rewrote it), keeping the current target slot.
        var keptTarget = action.target;
        action.actionType = prevAction ? prevAction.actionType : BattleActionType.Pass;
        action.actionID = prevAction ? prevAction.actionID : 0;
        action.remainingTime = prevAction ? prevAction.remainingTime : 0;
        action.target = keptTarget;

        if (action.actionType == BattleActionType.Pass) {
          action.actionType = BattleActionType.Attack;
          action.actionID = 0;
          action.target = -1;
        }
      }

      // Check if the action is valid
      if (action.actionType == BattleActionType.Magic) {
        var w = action.actionID;
        w = GameData.magic[GameData.object[w].magic.magicNumber].costMP;

        if (currentRoleId !== null &&
            getPlayerMP(currentRoleId) < w) {
          w = action.actionID;
          w = GameData.magic[GameData.object[w].magic.magicNumber].type;
          if (w == MagicType.ApplyToPlayer || w == MagicType.ApplyToParty ||
              w == MagicType.Trance) {
            action.actionType = BattleActionType.Defend;
          } else {
            action.actionType = BattleActionType.Attack;
            if (action.target == -1) {
              action.target = 0;
            }
          }
        }
      }
    };
    var committedNow = battleService.getCommands().committed[member];
    var draft = committedNow ? {
      actionType: committedNow.actionType, actionID: committedNow.actionID, target: committedNow.target, remainingTime: committedNow.remainingTime
    } : {
      actionType: curPlayer.action.actionType, actionID: curPlayer.action.actionID, target: curPlayer.action.target, remainingTime: curPlayer.action.remainingTime
    };
    applyChoice(draft);
    battleService.writeCommitted(member, draft);
    applyChoice(curPlayer.action);

    // 消耗品 / 投掷:预约一个(看最终提交的动作;仙术降级成普攻 / 防御后不会走到这里,同旧 switch)
    switch (curPlayer.action.actionType) {
      case BattleActionType.UseItem:
        if ((GameData.object[curPlayer.action.actionID].item.flags & ItemFlag.Consuming) == 0) {
          break;
        }

      case BattleActionType.ThrowItem:
        mutateInventory(function(inventory: any) {
          if (!Array.isArray(inventory)) {
            return inventory;
          }
          for (var idx = 0; idx < Const.MAX_INVENTORY && idx < inventory.length; idx++) {
            var slot = inventory[idx];
            if (slot && slot.item == curPlayer.action.actionID) {
              slot.amountInUse++;
              break;
            }
          }
          return inventory;
        });
        break;

      default:
        break;
    }

    var fleeing = typeof context.fleeIntent === 'boolean'
      ? context.fleeIntent
      : curPlayer.action.actionType == BattleActionType.Flee;
    if (fleeing) {
      setBattleField('flee', true);
    }

    curPlayer.state = FighterState.Act;
    if (context.uiToWait) {
      mutateUI(function(uiState: any) {
        uiState.state = BattleUIState.Wait;
        return uiState;
      });
    }
    return {
      actionType: curPlayer.action.actionType,
      actionID: curPlayer.action.actionID,
      target: curPlayer.action.target,
      remainingTime: curPlayer.action.remainingTime
    };
  };

  /**
   * Show the effect for player before using a magic.
   * @param {Number} playerIndex   the index of the player.
   * @param {Boolean} summon       true if player is using a summon magic.
   */
  battle.showPlayerPreMagicAnim = function*(playerIndex: any, summon: any): Generator<any, any, any> {
    log.debug(['[BATTLE] showPlayerPreMagicAnim', playerIndex, summon].join(' '));
    var playerRole = getPartyMemberRole(playerIndex);

    for (var i = 0; i < 4; i++) {
      setPlayerPosition(playerIndex, function(pos: any) {
        return PAL_XY(
          PAL_X(pos) - (4 - i),
          PAL_Y(pos) - ~~((4 - i) / 2)
        );
      });

      yield battle.delay(1, 0, true);
    }

    yield battle.delay(2, 0, true);

    setPlayerFrame(playerIndex, 5);
    sound.play(getPlayerMagicSound(playerRole));

    if (!summon) {
      var currentPos = BATTLE().player[playerIndex].pos;
      var x = PAL_X(currentPos);
      var y = PAL_Y(currentPos);

      var index = GameData.battleEffectIndex[battle.getPlayerBattleSprite(playerRole)][0];
      index = index * 10 + 15;

      for (var i = 0; i < 10; i++) {
        var frame: any = BATTLE().effectSprite.getFrame(index++);

        // Update the gesture of enemies.
        for (var j = 0; j <= BATTLE().maxEnemyIndex; j++) {
          mutateEnemy(j, function(enemy: any) {
            if (!enemy ||
                enemy.objectID == 0 ||
                enemy.status[PlayerStatus.Sleep] != 0 ||
                enemy.status[PlayerStatus.Paralyzed] != 0) {
              return enemy;
            }

            if (--enemy.e.idleAnimSpeed == 0) {
              enemy.currentFrame++;
              enemy.e.idleAnimSpeed =
                GameData.enemy[GameData.object[enemy.objectID].enemy.enemyID].idleAnimSpeed;
            }

            if (enemy.currentFrame >= enemy.e.idleFrames) {
              enemy.currentFrame = 0;
            }
            return enemy;
          });
        }

        battle.makeScene();
        surface.blitSurface(BATTLE().sceneBuf, null, surface.byteBuffer, null);

        surface.blitRLE(
          frame,
          PAL_XY(x - ~~(frame.width / 2), y - frame.height)
        );

        yield uibattle.update();

        surface.updateScreen(null);

        yield sleepByFrame(1);
      }
    }

    yield battle.delay(1, 0, true);
  };

  /**
   * Check if the player is dying.
   * @param  {Number}  the player role ID.
   * @return {Boolean} true if the player is dying, false if not.
   */
  // PAL_IsPlayerHealthy: not dying and not asleep, confused, silenced, paralysed or a puppet.
  battle.isPlayerHealthy = function(playerRole: any) {
    return !battle.isPlayerDying(playerRole) &&
      getPlayerStatusValue(playerRole, PlayerStatus.Sleep) == 0 &&
      getPlayerStatusValue(playerRole, PlayerStatus.Confused) == 0 &&
      getPlayerStatusValue(playerRole, PlayerStatus.Silence) == 0 &&
      getPlayerStatusValue(playerRole, PlayerStatus.Paralyzed) == 0 &&
      getPlayerStatusValue(playerRole, PlayerStatus.Puppet) == 0;
  };

  battle.isPlayerDying = function(playerRole: any) {
    return getPlayerHP(playerRole) < Math.min(100, ~~(getPlayerMaxHP(playerRole) / 5));
  };

  /**
   * Calculate the base damage value of attacking.
   * @param  {Number} attackStrength attack strength of attacker.
   * @param  {Number} defense        defense value of inflictor.
   * @return {Number}                The base damage value of the attacking.
   */
  battle.calcBaseDamage = function(attackStrength: any, defense: any) {
    // Both parameters are WORD in SDLPAL: a defense that wraps past 0xFFFF
    // becomes small again, while a "negative" one stays huge (damage 0).
    attackStrength = WORD(attackStrength);
    defense = WORD(defense);
    // Formula courtesy of palxex and shenyanduxing
    if (attackStrength > defense) {
      return SHORT(~~(attackStrength * 2 - defense * 1.6 + 0.5));
    } else if (attackStrength > defense * 0.6) {
      return SHORT(~~(attackStrength - defense * 0.6 + 0.5));
    } else {
      return 0;
    }
  };

  /**
   * Calculate the damage of magic.
   * @param  {Number} magicStrength       magic strength of attacker.
   * @param  {Number} defense             defense value of inflictor.
   * @param  {Array}  elementalResistance inflictor's resistance to the elemental magics.
   * @param  {Number} poisonResistance    inflictor's resistance to poison.
   * @param  {Number} resistanceMultiplier divisor of the resistance values.
   * @param  {Number} magicID             object ID of the magic.
   * @return {Number}                     The damage value of the magic attack.
   */
  battle.calcMagicDamage = function(magicStrength: any, defense: any, elementalResistance: any, poisonResistance: any, resistanceMultiplier: any, magicID: any) {
    // Mirrors PAL_CalcMagicDamage step by step: WORD strength, SHORT damage,
    // and float (not double) for the resistance factor.
    var f = Math.fround;
    var damage;
    magicID = GameData.object[magicID].magic.magicNumber;

    // Formula courtesy of palxex and shenyanduxing
    magicStrength = WORD(~~f(WORD(magicStrength) * f(randomFloat(10, 11))));
    magicStrength = ~~(magicStrength / 10);

    damage = battle.calcBaseDamage(magicStrength, defense);
    damage = ~~(damage / 4);
    damage = SHORT(damage + WORD(GameData.magic[magicID].baseDamage));

    if (GameData.magic[magicID].elemental != 0) {
      var elem = GameData.magic[magicID].elemental;

      if (elem > Const.NUM_MAGIC_ELEMENTAL) {
        damage = SHORT(~~f(damage * f(10 - f(f(WORD(poisonResistance)) / resistanceMultiplier))));
      } else if (elem == 0) {
        damage = SHORT(damage * 5);
      } else {
        damage = SHORT(~~f(damage * f(10 - f(f(WORD(elementalResistance[elem - 1])) / resistanceMultiplier))));
      }

      damage = ~~(damage / 5);

      if (elem <= Const.NUM_MAGIC_ELEMENTAL) {
        damage = SHORT(damage * (10 + SHORT(getCurrentBattleFieldMagicEffect(elem - 1))));
        damage = ~~(damage / 10);
      }
    }

    return damage;
  };

  /**
   * Calculate the damage value of physical attacking.
   * @param  {Number} attackStrength   attack strength of attacker.
   * @param  {Number} defense          defense value of inflictor.
   * @param  {Number} attackResistance inflictor's resistance to physical attack.
   * @return {Number}                  The damage value of the physical attacking.
   */
  battle.calcPhysicalAttackDamage = function(attackStrength: any, defense: any, attackResistance: any) {
    var damage = battle.calcBaseDamage(attackStrength, defense);
    if (attackResistance != 0) {
      damage = ~~(damage / attackResistance);
    }

    return damage;
  };

  /**
   * Get the dexterity value of the enemy.
   * @param  {Number} enemyIndex the index of the enemy.
   * @return {Number}            The dexterity value of the enemy.
   */
  battle.getEnemyDexterity = function(enemyIndex: any) {
    var enemy = BATTLE().enemy[enemyIndex];
    var s = 0;
    s = (enemy.e.level + 6) * 3;
    s += SHORT(enemy.e.dexterity);

    return s;
  };

  /**
   * Get player's actual dexterity value in battle.
   * @param  {Number} playerRole the player role ID.
   * @return {Number}            The player's actual dexterity value.
   */
  battle.getPlayerActualDexterity = function(playerRole: any) {
    var dexterity = script.getPlayerDexterity(playerRole);

    if (hasPlayerStatus(playerRole, PlayerStatus.Haste)) {
      dexterity *= 3;
    }

    // Classic: no dying penalty here; the action queue halves a dying player's dexterity once.
    if (dexterity > 999) {
      dexterity = 999;
    }

    return ~~dexterity;
  };

  /**
   * Backup HP and MP values of all players and enemies.
   */
  battle.backupStat = function() {
    var playerRole: any;
    for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
      mutateEnemy(i, function(enemy: any) {
        if (!enemy || enemy.objectID == 0) {
          return enemy;
        }
        enemy.prevHP = enemy.e.health;
        return enemy;
      });
    }

    for (var i = 0; i <= getMaxPartyIndex(); i++) {
      playerRole = getPartyMemberRole(i);

      mutatePlayer(i, function(player: any) {
        if (!player) {
          return player;
        }
        player.prevHP = getPlayerHP(playerRole);
        player.prevMP = getPlayerMP(playerRole);
        return player;
      });
    }
  };

  /**
   * Display the HP and MP changes of all players and enemies.
   * @return {Boolean} true if there are any number displayed, false if not.
   */
  battle.displayStatChange = function() {
    log.debug(['[BATTLE] displayStatChange'].join(' '));
    var changed = false;

    for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
      if (BATTLE().enemy[i].objectID == 0) {
        continue;
      }

      if (BATTLE().enemy[i].prevHP != BATTLE().enemy[i].e.health) {
        // Show the number of damage
        var damage = BATTLE().enemy[i].e.health - BATTLE().enemy[i].prevHP;

        var x = PAL_X(BATTLE().enemy[i].pos) - 9;
        var y = PAL_Y(BATTLE().enemy[i].pos) - 115;

        if (y < 10) {
          y = 10;
        }

        if (damage < 0) {
          uibattle.showNum(WORD(-damage), PAL_XY(x, y), NumColor.Blue);
        } else {
          uibattle.showNum(WORD(damage), PAL_XY(x, y), NumColor.Yellow);
        }

        changed = true;
      }
    }

    for (var i = 0; i <= getMaxPartyIndex(); i++) {
      var playerRole = getPartyMemberRole(i);

      if (BATTLE().player[i].prevHP != getPlayerHP(playerRole)) {
        var damage = getPlayerHP(playerRole) - BATTLE().player[i].prevHP;

        var x = PAL_X(BATTLE().player[i].pos) - 9;
        var y = PAL_Y(BATTLE().player[i].pos) - 75;

        if (y < 10) {
          y = 10;
        }

        if (damage < 0) {
          uibattle.showNum(WORD(-damage), PAL_XY(x, y), NumColor.Blue);
        } else {
          uibattle.showNum(WORD(damage), PAL_XY(x, y), NumColor.Yellow);
        }

        changed = true;
      }

      if (BATTLE().player[i].prevMP != getPlayerMP(playerRole)) {
        var damage = getPlayerMP(playerRole) - BATTLE().player[i].prevMP;

        var x = PAL_X(BATTLE().player[i].pos) - 9;
        var y = PAL_Y(BATTLE().player[i].pos) - 67;

        if (y < 10) {
          y = 10;
        }

        // Only show MP increasing
        if (damage > 0) {
          uibattle.showNum(WORD(damage), PAL_XY(x, y), NumColor.Cyan);
        }

        changed = true;
      }
    }

    return changed;
  };

  /**
   * Essential checks after an action is executed.
   * @param  {Boolean} checkPlayers true if check for players, false if not.
   */
  battle.postActionCheck = function*(checkPlayers: any, battleScriptParent?: unknown): Generator<any, any, any> {
    log.debug(['[BATTLE] postActionCheck', checkPlayers].join(' '));
    var sceneBuf = BATTLE().sceneBuf;
    var screen = surface.byteBuffer;
    var fade = false;
    var enemyRemaining = false;
    for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
      var enemyState = BATTLE().enemy[i];
      if (!enemyState || enemyState.objectID == 0) {
        continue;
      }

      if (SHORT(enemyState.e.health) <= 0) {
        // This enemy is KO'ed
        var enemyExpReward = enemyState.e && typeof enemyState.e.exp === 'number'
          ? enemyState.e.exp
          : 0;
        var enemyCashReward = enemyState.e && typeof enemyState.e.cash === 'number'
          ? enemyState.e.cash
          : 0;
        setBattleField('expGained', function(value: any) {
          var currentExp = typeof value === 'number' && !isNaN(value) ? value : 0;
          return currentExp + enemyExpReward;
        });
        setBattleField('cashGained', function(value: any) {
          var currentCash = typeof value === 'number' && !isNaN(value) ? value : 0;
          return currentCash + enemyCashReward;
        });

        sound.play(enemyState.e.deathSound);
        mutateEnemy(i, function(enemy: any) {
          if (enemy) {
            enemy.objectID = 0;
          }
          return enemy;
        });
        fade = true;

        continue;
      }

      enemyRemaining = true;
    }

    if (!enemyRemaining) {
      setBattleField('enemyCleared', true);
      mutateUI(function(uiState: any) {
        uiState.state = BattleUIState.Wait;
        return uiState;
      });
    }

    if (checkPlayers && !isAutoBattleEnabled()) {
      for (var i = 0; i <= getMaxPartyIndex(); i++) {
        var w = getPartyMemberRole(i);
        var name;

        if (getPlayerHP(w) < BATTLE().player[i].prevHP &&
            getPlayerHP(w) == 0) {
          w = getPlayerCoveredBy(w);

          for (var j = 0; j <= getMaxPartyIndex(); j++) {
            if (getPartyMemberRole(j) == w) {
               break;
            }
          }

          if (getPlayerHP(w) > 0 &&
              getPlayerStatusValue(w, PlayerStatus.Sleep) == 0 &&
              getPlayerStatusValue(w, PlayerStatus.Paralyzed) == 0 &&
              getPlayerStatusValue(w, PlayerStatus.Confused) == 0 &&
              j <= getMaxPartyIndex()) {
            name = getPlayerNameId(w);

            if (GameData.object[name].player.scriptOnFriendDeath != 0) {
              yield battle.delay(10, 0, true);

              battle.makeScene();
              surface.blitSurface(sceneBuf, null, screen, null);
              surface.updateScreen(null);

              battleService.setBattleResult(BattleResult.Pause);

              const updatedFriendDeathScript = yield script.runBattleTriggerScript(battleScriptParent,
                GameData.object[name].player.scriptOnFriendDeath,
                w
              );
              worldService.mutateObjectEntry(name, function(objectEntry) {
                if (objectEntry && objectEntry.player) {
                  objectEntry.player.scriptOnFriendDeath = updatedFriendDeathScript;
                }
                return objectEntry;
              });

              battleService.setBattleResult(BattleResult.OnGoing);

              input.clear();
              return yield end();
            }
          }
        }
      }

      for (var i = 0; i <= getMaxPartyIndex(); i++) {
        var w = getPartyMemberRole(i);
        var name;

        if (getPlayerStatusValue(w, PlayerStatus.Sleep) != 0 ||
           getPlayerStatusValue(w, PlayerStatus.Confused) != 0) {
          continue;
        }

        if (getPlayerHP(w) < BATTLE().player[i].prevHP) {
          if (getPlayerHP(w) > 0 && battle.isPlayerDying(w) &&
            BATTLE().player[i].prevHP >= ~~(getPlayerMaxHP(w) / 5)) {
            var cover = getPlayerCoveredBy(w);

            if (getPlayerStatusValue(cover, PlayerStatus.Sleep) != 0 ||
               getPlayerStatusValue(cover, PlayerStatus.Paralyzed) != 0 ||
               getPlayerStatusValue(cover, PlayerStatus.Confused) != 0) {
              continue;
            }

            name = getPlayerNameId(w);

            sound.play(getPlayerDyingSound(w));

            for (var j = 0; j <= getMaxPartyIndex(); j++) {
              if (getPartyMemberRole(j) == cover) {
                break;
              }
            }

            if (j > getMaxPartyIndex() || getPlayerHP(cover) == 0) {
              continue;
            }

            if (GameData.object[name].player.scriptOnDying != 0) {
              yield battle.delay(10, 0, true);

              battle.makeScene();
              surface.blitSurface(sceneBuf, null, screen, null);
              surface.updateScreen(null);

              battleService.setBattleResult(BattleResult.Pause);

              const updatedDyingScript = yield script.runBattleTriggerScript(battleScriptParent,
                GameData.object[name].player.scriptOnDying,
                w
              );
              worldService.mutateObjectEntry(name, function(objectEntry) {
                if (objectEntry && objectEntry.player) {
                  objectEntry.player.scriptOnDying = updatedDyingScript;
                }
                return objectEntry;
              });

              battleService.setBattleResult(BattleResult.OnGoing);
              input.clear();
            }

            return yield end();
          }
        }
      }
    }

    // As in SDLPAL, the "end" part (fading out KO'ed enemies and the
    // summoned god) always runs, not only after a friend-death/dying script.
    yield end();

    function* end(): Generator<any, any, any> {
      if (fade) {
        battle.backupScene();
        battle.makeScene();
        yield battle.fadeScene();
      }
      // Fade out the summoned god
      if (BATTLE().summonSprite != null) {
        battle.updateFighters();
        yield battle.delay(1, 0, false);

        setBattleField('summonSprite', null);
        setBattleField('backgroundColorShift', 0);

        battle.backupScene();
        battle.makeScene();
        yield battle.fadeScene();
      }
    }
  };

  /**
   * Show the physical attack effect for player.
   * @param {Number} playerIndex    the index of the player.
   * @param {Boolean} critical      true if this is a critical hit.
   */
  battle.showPlayerAttackAnim = function*(playerIndex: any, critical: any): Generator<any, any, any> {
    log.debug(['[BATTLE] showPlayerAttackAnim', playerIndex, critical].join(' '));
    var sceneBuf = BATTLE().sceneBuf;
    var screen = surface.byteBuffer;
    var playerRole = getPartyMemberRole(playerIndex);
    var target = BATTLE().player[playerIndex].action.target;

    var enemy_x = 0;
    var enemy_y = 0;
    var enemy_h = 0;
    var dist = 0;

    if (target != -1) {
      var enemy = BATTLE().enemy[target];
      enemy_x = PAL_X(enemy.pos);
      enemy_y = PAL_Y(enemy.pos);

      enemy_h = (enemy.sprite.getFrame(enemy.currentFrame) as any).height;

      if (target >= 3) {
        dist = (target - playerIndex) * 8;
      }
    } else {
      enemy_x = 150;
      enemy_y = 100;
    }

    var index = GameData.battleEffectIndex[battle.getPlayerBattleSprite(playerRole)][1];
    index *= 3;
    // Play the attack voice
    if (getPlayerHP(playerRole) > 0) {
      if (!critical) {
        sound.play(getPlayerAttackSound(playerRole));
      } else {
        sound.play(getPlayerCriticalSound(playerRole));
      }
    }

    // Show the animation
    var x = enemy_x - dist + 64;
    var y = enemy_y + dist + 20;

    // As in SDLPAL: a dual attack on all enemies stays near the player's own
    // spot, the second hit slightly up-left of the first.
    var dualAttackAll = getPlayerStatusValue(playerRole, PlayerStatus.DualAttack) > 0 &&
      script.playerCanAttackAll(playerRole);
    var placeAttacker = function() {
      if (dualAttackAll) {
        var ownPos = (battle.playerPos[getMaxPartyIndex()] || [])[playerIndex] || [0, 0];
        x = ownPos[0] - 8;
        y = ownPos[1] - 4;
        if (BATTLE().player[playerIndex].secondAttack) {
          setPlayerPosition(playerIndex, PAL_XY(x - 12, y - 8));
        } else {
          setPlayerPosition(playerIndex, PAL_XY(x, y));
        }
      } else {
        setPlayerPosition(playerIndex, PAL_XY(x, y));
      }
    };

    setPlayerFrame(playerIndex, 8);
    placeAttacker();

    yield battle.delay(2, 0, true);

    x -= 10;
    y -= 2;
    placeAttacker();

    yield battle.delay(1, 0, true);

    setPlayerFrame(playerIndex, 9);
    x -= 16;
    y -= 4;

    sound.play(getPlayerWeaponSound(playerRole));

    x = enemy_x;
    y = enemy_y - ~~(enemy_h / 3) + 10;

    for (var i = 0; i < 3; i++) {
      var frame: any = BATTLE().effectSprite.getFrame(index++);

      // Update the gesture of enemies.
      for (var j = 0; j <= BATTLE().maxEnemyIndex; j++) {
        var enemy = BATTLE().enemy[j];
        if (enemy.objectID == 0 ||
            enemy.status[PlayerStatus.Sleep] > 0 ||
            enemy.status[PlayerStatus.Paralyzed] > 0) {
          continue;
        }

        if (--enemy.e.idleAnimSpeed == 0) {
          enemy.currentFrame++;
          enemy.e.idleAnimSpeed = GameData.enemy[GameData.object[enemy.objectID].enemy.enemyID].idleAnimSpeed;
        }

        if (enemy.currentFrame >= enemy.e.idleFrames) {
          enemy.currentFrame = 0;
        }
      }

      battle.makeScene();
      surface.blitSurface(sceneBuf, null, screen, null);

      if (frame) {
        if (script.playerCanAttackAll(playerRole)) {
          // As in SDLPAL: the effect is drawn on every enemy, at its formation position.
          for (var j = 0; j < Const.MAX_ENEMIES_IN_TEAM; j++) {
            var hitEnemy = BATTLE().enemy[j];
            if (hitEnemy && hitEnemy.objectID != 0) {
              var formationPos: any = worldService.getEnemyFormationPosition(j, BATTLE().maxEnemyIndex) || { x: 0, y: 0 };
              var ex = formationPos.x;
              var ey = formationPos.y + hitEnemy.e.yPosOffset;
              surface.blitRLE(frame, PAL_XY(ex - ~~(frame.width / 2), ey - frame.height), screen);
            }
          }
        } else {
          surface.blitRLE(frame, PAL_XY(x - ~~(frame.width / 2), y - frame.height), screen);
        }
      }
      x -= 16;
      y += 16;

      yield uibattle.update();

      if (i == 0) {
        if (target == -1) {
          for (var j = 0; j <= BATTLE().maxEnemyIndex; j++) {
            battleService.setEnemyColorShift(j, 6);
          }
        } else {
          battleService.setEnemyColorShift(target, 6);
        }

        battle.displayStatChange();
        battle.backupStat();
      }

      surface.updateScreen(null);

      if (i == 1) {
        setPlayerPosition(playerIndex, function(pos: any) {
          return PAL_XY(PAL_X(pos) + 2, PAL_Y(pos) + 1);
        });
      }

      yield sleepByFrame(1);
    }

    dist = 8;

    for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
      battleService.setEnemyColorShift(i, 0);
    }

    if (target == -1) {
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j <= BATTLE().maxEnemyIndex; j++) {
          // SDLPAL only shakes the enemies horizontally here.
          battleService.setEnemyPosition(j, function(pos: any) {
            return PAL_XY(PAL_X(pos) - dist, PAL_Y(pos));
          });
        }

        yield battle.delay(1, 0, true);
        dist = ~~(dist / -2);
      }
    } else{
      var targetPos = BATTLE().enemy[target].pos;
      var x = PAL_X(targetPos);
      var y = PAL_Y(targetPos);

      for (var i = 0; i < 3; i++) {
        x -= dist;
        dist = ~~(dist / -2);
        y += dist;
        battleService.setEnemyPosition(target, PAL_XY(x, y));

        yield battle.delay(1, 0, true);
      }
    }
  };

  /**
   * Show the "use item" effect for player.
   * @param {Number} playerIndex   the index of the player.
   * @param {Number} objectID      the object ID of the item to be used.
   * @param {Number} target        the target player of the action.
   */
  battle.showPlayerUseItemAnim = function*(playerIndex: any, objectID: any, target: any): Generator<any, any, any> {
    log.debug(['[BATTLE] showPlayerUseItemAnim', playerIndex, objectID, target].join(' '));
    yield battle.delay(4, 0, true);

    setPlayerPosition(playerIndex, function(pos: any) {
      return PAL_XY(PAL_X(pos) - 15, PAL_Y(pos) - 7);
    });

    setPlayerFrame(playerIndex, 5);

    sound.play(28);

    for (var i = 0; i <= 6; i++) {
      if (target == -1) {
        for (var j = 0; j <= getMaxPartyIndex(); j++) {
          battleService.setPlayerColorShift(j, i);
        }
      } else {
         battleService.setPlayerColorShift(target, i);
      }

      yield battle.delay(1, objectID, true);
    }

    for (var i = 5; i >= 0; i--) {
      if (target == -1) {
        for (var j = 0; j <= getMaxPartyIndex(); j++) {
          battleService.setPlayerColorShift(j, i);
        }
      } else {
        battleService.setPlayerColorShift(target, i);
      }

      yield battle.delay(1, objectID, true);
    }
  };

  /**
   * Show the defensive magic effect for player.
   * @param {Number} playerIndex   the index of the player.
   * @param {Number} objectID      the object ID of the magic to be used.
   * @param {Number} target        the target player of the action.
   */
  battle.showPlayerDefMagicAnim = function*(playerIndex: any, objectID: any, target: any): Generator<any, any, any> {
    log.debug(['[BATTLE] showPlayerDefMagicAnim', playerIndex, objectID, target].join(' '));
    var magicNum = GameData.object[objectID].magic.magicNumber;
    var effectNum = GameData.magic[magicNum].effect;

    var effectSprite = new Sprite(Files.FIRE.decompressChunk(effectNum));
    var n = effectSprite.frameCount;

    var sceneBuf = BATTLE().sceneBuf;
    var screen = surface.byteBuffer;

    var i, l, x, y;

    setPlayerFrame(playerIndex, 6);
    yield battle.delay(1, 0, true);

    for (i = 0; i < n; i++) {
      var frame: any = effectSprite.getFrame(i);

      if (i == GameData.magic[magicNum].soundDelay) {
         sound.play(GameData.magic[magicNum].sound);
      }

      battle.makeScene();
      surface.blitSurface(sceneBuf, null, screen, null);

      if (GameData.magic[magicNum].type == MagicType.ApplyToParty) {
        if (target != -1) {
          throw 'should not be here';
        }
        for (l = 0; l <= getMaxPartyIndex(); l++) {
          var pos = BATTLE().player[l].pos;
          x = PAL_X(pos);
          y = PAL_Y(pos);

          x += SHORT(GameData.magic[magicNum].offsetX);
          y += SHORT(GameData.magic[magicNum].offsetY);

          surface.blitRLE(
            frame,
            PAL_XY(x - ~~(frame.width / 2), y - frame.height)
          );
        }
      } else if (GameData.magic[magicNum].type == MagicType.ApplyToPlayer ||
                 GameData.magic[magicNum].type == MagicType.Trance) {
        var effectTarget = (target === -1 ? playerIndex : target);

        var targetPos = BATTLE().player[effectTarget].pos;
        x = PAL_X(targetPos);
        y = PAL_Y(targetPos);

        x += SHORT(GameData.magic[magicNum].offsetX);
        y += SHORT(GameData.magic[magicNum].offsetY);

        surface.blitRLE(
          frame,
          PAL_XY(x - ~~(frame.width / 2), y - frame.height)
        );

        // Repaint the previous player
        if (effectTarget > 0 && BATTLE().hidingTime == 0) {
          if (getPlayerStatusValue(getPartyMemberRole(effectTarget - 1), PlayerStatus.Confused) == 0) {
            var targetPlayer = BATTLE().player[effectTarget - 1];
            var p: any = targetPlayer.sprite.getFrame(targetPlayer.currentFrame)
            x = PAL_X(targetPlayer.pos);
            y = PAL_Y(targetPlayer.pos);

            x -= ~~(p.width / 2);
            y -= p.height;

            surface.blitRLE(p, PAL_XY(x, y));
          }
        }
      } else {
        throw 'should not be here';
      }

      yield uibattle.update();
      surface.updateScreen(null);

      yield sleepByFrame(1);
    }

    for (i = 0; i < 6; i++) {
      if (GameData.magic[magicNum].type == MagicType.ApplyToParty) {
        for (var j = 0; j <= getMaxPartyIndex(); j++) {
          battleService.setPlayerColorShift(j, i);
        }
      } else {
        var effectTarget = (GameData.magic[magicNum].type == MagicType.Trance && target === -1)
          ? playerIndex
          : target;
        battleService.setPlayerColorShift(effectTarget, i);
      }

      yield battle.delay(1, 0, true);
    }

    for (i = 6; i >= 0; i--) {
      if (GameData.magic[magicNum].type == MagicType.ApplyToParty) {
        for (var j = 0; j <= getMaxPartyIndex(); j++) {
          battleService.setPlayerColorShift(j, i);
        }
      } else {
        var effectTarget = (GameData.magic[magicNum].type == MagicType.Trance && target === -1)
          ? playerIndex
          : target;
        battleService.setPlayerColorShift(effectTarget, i);
      }

      yield battle.delay(1, 0, true);
    }
  };

  /**
   * Show the offensive magic animation for player.
   * @param {Number} playerIndex   the index of the player.
   * @param {Number} objectID      the object ID of the magic to be used.
   * @param {Number} target        the target player of the action.
   */
  battle.showPlayerOffMagicAnim = function*(playerIndex: any, objectID: any, target: any): Generator<any, any, any> {
    log.debug(['[BATTLE] showPlayerOffMagicAnim', playerIndex, objectID, target].join(' '));
    playerIndex = SHORT(playerIndex);
    var magicNum = GameData.object[objectID].magic.magicNumber;
    var effectNum = GameData.magic[magicNum].effect;

    var effectSprite = new Sprite(Files.FIRE.decompressChunk(effectNum));
    var n = effectSprite.frameCount;

    var i, k, x, y, l;

    yield battle.delay(1, 0, true);

    l = n - GameData.magic[magicNum].soundDelay;
    l *= SHORT(GameData.magic[magicNum].effectTimes);
    l += n;
    l += GameData.magic[magicNum].shake;

    var wave = getScreenWaveLevel();
    worldService.adjustScreenWave(GameData.magic[magicNum].wave || 0);

    for (i = 0; i < l; i++) {
      var frame;

      if (i == GameData.magic[magicNum].soundDelay && playerIndex != -1) {
        setPlayerFrame(playerIndex, 6);
      }

      var blow = ((BATTLE().blow > 0) ? randomLong(0, BATTLE().blow) : randomLong(BATTLE().blow, 0));

      for (k = 0; k <= BATTLE().maxEnemyIndex; k++) {
        var enemy = BATTLE().enemy[k];
        if (enemy.objectID == 0) {
          continue;
        }

        x = PAL_X(enemy.pos) + blow;
        y = PAL_Y(enemy.pos) + ~~(blow / 2);

        battleService.setEnemyPosition(k, PAL_XY(x, y));
      }

      if (l - i > GameData.magic[magicNum].shake) {
        if (i < n) {
          k = i;
        } else {
          k = i - GameData.magic[magicNum].soundDelay;
          k %= n - GameData.magic[magicNum].soundDelay;
          k += GameData.magic[magicNum].soundDelay;
        }

        frame = effectSprite.getFrame(k) as any;

        if ((i - GameData.magic[magicNum].soundDelay) % n == 0) {
          sound.play(GameData.magic[magicNum].sound);
        }
      } else {
        yield surface.shakeScreen(i, 3);
        frame = effectSprite.getFrame((l - GameData.magic[magicNum].shake - 1) % n) as any;
      }

      battle.makeScene();
      surface.blitSurface(BATTLE().sceneBuf, null, surface.byteBuffer, null);

      yield sleepByFrame(1);

      if (GameData.magic[magicNum].type == MagicType.Normal) {
        if (target == -1) {
          throw 'should not be here';
        }
        var targetEnemy = BATTLE().enemy[target];
        x = PAL_X(targetEnemy.pos);
        y = PAL_Y(targetEnemy.pos);

        x += SHORT(GameData.magic[magicNum].offsetX);
        y += SHORT(GameData.magic[magicNum].offsetY);

        surface.blitRLE(
          frame,
          PAL_XY(x - ~~(frame.width / 2), y - frame.height)
        );

        if (i == l - 1 && getScreenWaveLevel() < 9 && GameData.magic[magicNum].keepEffect == 0xFFFF) {
          surface.blitRLE(
            frame,
            PAL_XY(x - ~~(frame.width / 2), y - frame.height),
            BATTLE().background
          );
        }
      } else if (GameData.magic[magicNum].type == MagicType.AttackAll) {
        var effectPos = [ [70, 140], [100, 110], [160, 100] ];
        if (target != -1) {
          throw 'should not be here'
        }

        for (k = 0; k < 3; k++) {
          x = effectPos[k][0];
          y = effectPos[k][1];

          x += SHORT(GameData.magic[magicNum].offsetX);
          y += SHORT(GameData.magic[magicNum].offsetY);

          surface.blitRLE(
            frame,
            PAL_XY(x - ~~(frame.width / 2), y - frame.height)
          );

          if (i == l - 1 && getScreenWaveLevel() < 9 && GameData.magic[magicNum].keepEffect == 0xFFFF) {
            surface.blitRLE(
              frame,
              PAL_XY(x - ~~(frame.width / 2), y - frame.height),
              BATTLE().background
            );
          }
        }
      } else if (GameData.magic[magicNum].type == MagicType.AttackWhole ||
                 GameData.magic[magicNum].type == MagicType.AttackField) {
        if (target != -1) {
          throw 'should not be here'
        }

        if (GameData.magic[magicNum].type == MagicType.AttackWhole) {
          x = 120;
          y = 100;
        } else {
          x = 160;
          y = 200;
        }

        x += SHORT(GameData.magic[magicNum].offsetX);
        y += SHORT(GameData.magic[magicNum].offsetY);

        surface.blitRLE(
          frame,
          PAL_XY(x - ~~(frame.width / 2), y - frame.height)
        );

        if (i == l - 1 && getScreenWaveLevel() < 9 && GameData.magic[magicNum].keepEffect == 0xFFFF) {
          surface.blitRLE(
            frame,
            PAL_XY(x - ~~(frame.width / 2), y - frame.height),
            BATTLE().background
          );
        }
      } else {
        throw 'should not be here';
      }

      yield uibattle.update();
      surface.updateScreen(null);
    }

    worldService.setScreenWave(wave);
    yield surface.shakeScreen(0, 0);

    for (i = 0; i <= BATTLE().maxEnemyIndex; i++) {
      var originalPos = BATTLE().enemy[i].originalPos;
      battleService.setEnemyPosition(i, originalPos);
    }
  };

  /**
   * Show the offensive magic animation for enemy.
   * @param {Number} objectID      the object ID of the magic to be used.
   * @param {Number} target        the target player index of the action.
   */
  battle.showEnemyMagicAnim = function*(objectID: any, target: any): Generator<any, any, any> {
    log.debug(['[BATTLE] showEnemyMagicAnim', objectID, target].join(' '));
    var magicNum = GameData.object[objectID].magic.magicNumber;
    var effectNum = GameData.magic[magicNum].effect;

    var effectSprite = new Sprite(Files.FIRE.decompressChunk(effectNum));

    var n = effectSprite.frameCount;

    var l = n - GameData.magic[magicNum].soundDelay;
    l *= SHORT(GameData.magic[magicNum].effectTimes);
    l += n;
    l += GameData.magic[magicNum].shake;

    var wave = getScreenWaveLevel();
    worldService.adjustScreenWave(GameData.magic[magicNum].wave || 0);
    var x, y;

    for (var i = 0; i < l; i++) {
      var rle;

      var blow = ((BATTLE().blow > 0) ? randomLong(0, BATTLE().blow) : randomLong(BATTLE().blow, 0));

      for (var k = 0; k <= getMaxPartyIndex(); k++) {
        var playerPos = BATTLE().player[k].pos;
        x = PAL_X(playerPos) + blow;
        y = PAL_Y(playerPos) + ~~(blow / 2);

        setPlayerPosition(k, PAL_XY(x, y));
      }

      if (l - i > GameData.magic[magicNum].shake) {
        if (i < n) {
          k = i;
        } else {
          k = i - GameData.magic[magicNum].soundDelay;
          k %= n - GameData.magic[magicNum].soundDelay;
          k += GameData.magic[magicNum].soundDelay;
        }

        rle = effectSprite.getFrame(k) as any;

        if (i == GameData.magic[magicNum].soundDelay) {
          sound.play(GameData.magic[magicNum].sound);
        }
      } else {
        yield surface.shakeScreen(i, 3)
        rle = effectSprite.getFrame((l - GameData.magic[magicNum].shake - 1) % n) as any;
      }

      battle.makeScene();
      surface.blitSurface(BATTLE().sceneBuf, null, surface.byteBuffer, null);

      if (GameData.magic[magicNum].type == MagicType.Normal) {
        if (target == -1) {
          throw 'should not be here';
        }

        x = PAL_X(BATTLE().player[target].pos);
        y = PAL_Y(BATTLE().player[target].pos);

        x += SHORT(GameData.magic[magicNum].offsetX);
        y += SHORT(GameData.magic[magicNum].offsetY);

        surface.blitRLE(
          rle,
          PAL_XY(x - ~~(rle.width / 2), y - rle.height)
        );

        if (i == l - 1 && getScreenWaveLevel() < 9 && GameData.magic[magicNum].keepEffect == 0xFFFF) {
          surface.blitRLE(
            rle,
            PAL_XY(x - ~~(rle.width / 2), y - rle.height),
            BATTLE().background
          );
        }
      }
      else if (GameData.magic[magicNum].type == MagicType.AttackAll) {
        var effectPos = [ [180, 180], [234, 170], [270, 146]];

        if (target != -1) {
          throw 'should not be here';
        }

        for (var k = 0; k < 3; k++) {
          x = effectPos[k][0];
          y = effectPos[k][1];

          x += SHORT(GameData.magic[magicNum].offsetX);
          y += SHORT(GameData.magic[magicNum].offsetY);

          surface.blitRLE(
            rle,
            PAL_XY(x - ~~(rle.width / 2), y - rle.height)
          );

          if (i == l - 1 && getScreenWaveLevel() < 9 && GameData.magic[magicNum].keepEffect == 0xFFFF) {
            surface.blitRLE(
              rle,
              PAL_XY(x - ~~(rle.width / 2), y - rle.height),
              BATTLE().background
            );
          }
        }
      } else if (GameData.magic[magicNum].type == MagicType.AttackWhole ||
                 GameData.magic[magicNum].type == MagicType.AttackField) {
        if (target != -1) {
          throw 'should not be here';
        }

        if (GameData.magic[magicNum].type == MagicType.AttackWhole) {
          x = 240;
          y = 150;
        } else {
          x = 160;
          y = 200;
        }

        x += SHORT(GameData.magic[magicNum].offsetX);
        y += SHORT(GameData.magic[magicNum].offsetY);


        surface.blitRLE(
          rle,
          PAL_XY(x - ~~(rle.width / 2), y - rle.height)
        );

        if (i == l - 1 && getScreenWaveLevel() < 9 && GameData.magic[magicNum].keepEffect == 0xFFFF) {
          surface.blitRLE(
            rle,
            PAL_XY(x - ~~(rle.width / 2), y - rle.height),
            BATTLE().background
          );
        }
      } else {
        throw 'should not be here';
      }

      yield uibattle.update();

      surface.updateScreen(null);

      yield sleepByFrame(1);
    }

    worldService.setScreenWave(wave);
    yield surface.shakeScreen(0, 0);

    for (var i = 0; i <= getMaxPartyIndex(); i++) {
      setPlayerPosition(i, BATTLE().player[i].originalPos);
    }
  };

  /**
   * Show the summon magic animation for player.
   * @param {Number} playerIndex   the index of the player.
   * @param {Number} objectID      the object ID of the magic to be used.
   */
  battle.showPlayerSummonMagicAnim = function*(playerIndex: any, objectID: any): Generator<any, any, any> {
    log.debug(['[BATTLE] showPlayerSummonMagicAnim', playerIndex, objectID].join(' '));
    var magicNum = GameData.object[objectID].magic.magicNumber;
    var effectMagicID = 0;

    for (effectMagicID = 0; effectMagicID < Const.MAX_OBJECTS; effectMagicID++) {
      if (GameData.object[effectMagicID].magic.magicNumber ==
          GameData.magic[magicNum].effect) {
        break;
      }
    }

    if (effectMagicID >= Const.MAX_OBJECTS) {
      throw 'should not be here';
    }
    // Brighten the players
    for (var i = 1; i <= 10; i++) {
      for (var j = 0; j <= getMaxPartyIndex(); j++) {
        mutatePlayer(j, function(player: any) {
          player.colofShift = i;
          return player;
        });
      }

      yield battle.delay(1, objectID, true);
    }

    battle.backupScene();

    // Load the sprite of the summoned god
    var effectSpriteNum = GameData.magic[magicNum].summonEffect + 10;

    setBattleField('summonSprite', new Sprite(Files.F.decompressChunk(effectSpriteNum)));

    setBattleField('summonFrame', 0);
    setBattleField('summonPos', PAL_XY(
      230 + SHORT(GameData.magic[magicNum].offsetX),
      155 + SHORT(GameData.magic[magicNum].offsetY)
    ));
    setBattleField('backgroundColorShift', SHORT(GameData.magic[magicNum].effectTimes));

    // Fade in the summoned god
    battle.makeScene();
    yield battle.fadeScene();

    // Show the animation of the summoned god
    // TODO: There is still something missing here compared to the original game.
    while (BATTLE().summonFrame < BATTLE().summonSprite.frameCount - 1) {
      battle.makeScene();
      surface.blitSurface(BATTLE().sceneBuf, null, surface.byteBuffer, null);

      yield uibattle.update();

      surface.updateScreen(null);

      yield sleepByFrame(1);

      setBattleField('summonFrame', function(frame: any) {
        return (frame || 0) + 1;
      });
    }

    // Show the actual magic effect
    yield battle.showPlayerOffMagicAnim(-1, effectMagicID, -1);
  };

  /**
   * Show the post-magic animation.
   */
  battle.showPostMagicAnim = function*(): Generator<any, any, any> {
    log.debug(['[BATTLE] showPostMagicAnim'].join(' '));
    var dist = 8;
    var enemyPosBak = new Array(Const.MAX_ENEMIES_IN_TEAM);

    for (var i = 0; i < Const.MAX_ENEMIES_IN_TEAM; i++) {
      var storedEnemy = BATTLE().enemy[i];
      enemyPosBak[i] = storedEnemy ? PAL_XY(PAL_X(storedEnemy.pos), PAL_Y(storedEnemy.pos)) : PAL_XY(0, 0);
    }

    for (var i = 0; i < 3; i++) {
      for (var j = 0; j <= BATTLE().maxEnemyIndex; j++) {
        var enemy = BATTLE().enemy[j];
        // 空位(队形里前面留空、或已离场):SDLPAL 里 e 是全零的结构体,health == prevHP 自然跳过;这里空位的 e 是 null
        if (!enemy || !enemy.e || enemy.objectID == 0) {
          continue;
        }
        if (enemy.e.health == enemy.prevHP) {
          continue;
        }

        var x = PAL_X(enemy.pos);
        var y = PAL_Y(enemy.pos);

        x -= dist;
        y -= ~~(dist / 2);

        battleService.setEnemyPosition(j, PAL_XY(x, y));
        battleService.setEnemyColorShift(j, (i == 1) ? 6 : 0);
      }

      yield battle.delay(1, 0, true);
      dist = ~~(dist / -2);
    }

    for (var i = 0; i < Const.MAX_ENEMIES_IN_TEAM; i++) {
      battleService.setEnemyPosition(i, enemyPosBak[i]);
    }

    yield battle.delay(1, 0, true);
  };

  /**
   * Validate player's action, fallback to other action when needed.
   * @param {Number} playerIndex   the index of the player.
   */
  battle.playerValidateAction = function(playerIndex: any) {
    log.debug(['[BATTLE] playerValidateAction', playerIndex].join(' '));
    var playerRole = getPartyMemberRole(playerIndex);
    var objectID = BATTLE().player[playerIndex].action.actionID;
    // As in SDLPAL, the "can attack all" check below uses the target the
    // action had on entry, not the one rewritten by the switch.
    var origTarget = BATTLE().player[playerIndex].action.target;
    var valid = true;
    var toEnemy = false;
    var setActionField = function(field: any, value: any) {
      battleService.writeCommitted(playerIndex, { [field]: value });      // W7:先写组件,再投影
      mutatePlayerAction(playerIndex, function(action: any) {
        action[field] = value;
        return action;
      });
    };
    var currentTarget = function() {
      return BATTLE().player[playerIndex].action.target;
    };

    switch (BATTLE().player[playerIndex].action.actionType) {
    case BattleActionType.Attack:
      toEnemy = true;
      break;

    case BattleActionType.Pass:
      break;

    case BattleActionType.Defend:
      break;

    case BattleActionType.Magic:
      // Make sure player actually has the magic to be used
      for (var i = 0; i < Const.MAX_PLAYER_MAGICS; i++) {
        if (getPlayerMagicAt(i, playerRole) == objectID) {
          break; // player has this magic
        }
      }

      if (i >= Const.MAX_PLAYER_MAGICS) {
        valid = false;
      }

      var w = GameData.object[objectID].magic.magicNumber;

      if (getPlayerStatusValue(playerRole, PlayerStatus.Silence) > 0) {
        // Player is silenced
        valid = false;
      }

      if (getPlayerMP(playerRole) <
          GameData.magic[w].costMP) {
        // No enough MP
        valid = false;
      }

      // Fallback to physical attack if player is using an offensive magic,
      // defend if player is using a defensive or healing magic
      if (GameData.object[objectID].magic.flags & MagicFlag.UsableToEnemy) {
        if (!valid) {
          setActionField('actionType', BattleActionType.Attack);
          setActionField('actionID', 0);
        } else if (GameData.object[objectID].magic.flags & MagicFlag.ApplyToAll) {
          setActionField('target', -1);
        } else if (origTarget == -1) {
          setActionField('target', battle.selectAutoTargetFrom(currentTarget()));
        }

        toEnemy = true;
      } else {
        if (!valid) {
          setActionField('actionType', BattleActionType.Defend);
        } else if (GameData.object[objectID].magic.flags & MagicFlag.ApplyToAll) {
          setActionField('target', -1);
        } else if (currentTarget() == -1) {
          setActionField('target', playerIndex);
        }
      }
      break;

    case BattleActionType.CoopMagic:
      toEnemy = true;

      // Classic: only the healthy members join; with one or none it becomes a plain attack.
      var contributors: boolean[] = [];
      var totalHealthy = 0;
      for (var i = 0; i <= getMaxPartyIndex(); i++) {
        contributors[i] = battle.isPlayerHealthy(getPartyMemberRole(i));
        if (contributors[i]) {
          totalHealthy++;
        }
      }
      battleService.set('coopContributors', contributors);
      if (totalHealthy <= 1) {
        setActionField('actionType', BattleActionType.Attack);
        setActionField('actionID', 0);
      }

      if (BATTLE().player[playerIndex].action.actionType == BattleActionType.CoopMagic) {
        if (GameData.object[objectID].magic.flags & MagicFlag.ApplyToAll) {
          setActionField('target', -1);
        } else if (origTarget == -1) {
          setActionField('target', battle.selectAutoTargetFrom(currentTarget()));
        }
      }
      break;

    case BattleActionType.Flee:
      break;

    case BattleActionType.ThrowItem:
      toEnemy = true;

      if (script.getItemAmount(objectID) == 0) {
        setActionField('actionType', BattleActionType.Attack);
        setActionField('actionID', 0);
      } else if (GameData.object[objectID].item.flags & ItemFlag.ApplyToAll) {
        setActionField('target', -1);
      } else if (currentTarget() == -1) {
        setActionField('target', battle.selectAutoTargetFrom(currentTarget()));
      }
      break;

    case BattleActionType.UseItem:
      if (script.getItemAmount(objectID) == 0) {
        setActionField('actionType', BattleActionType.Defend);
      } else if (GameData.object[objectID].item.flags & ItemFlag.ApplyToAll) {
        setActionField('target', -1);
      } else if (currentTarget() == -1) {
        setActionField('target', playerIndex);
      }
      break;

    case BattleActionType.AttackMate:
      if (getPlayerStatusValue(playerRole, PlayerStatus.Confused) == 0) {
        // Attack enemies instead if player is not confused
        toEnemy = true;
        setActionField('actionType', BattleActionType.Attack);
        setActionField('actionID', 0);
      } else {
        for (var i = 0; i <= getMaxPartyIndex(); i++) {
          if (i != playerIndex && getPlayerHP(getPartyMemberRole(i)) != 0) {
            break;
          }
        }

        if (i > getMaxPartyIndex()) {
          // Nobody else is alive: do nothing, as SDLPAL does (it does not
          // fall back to attacking enemies here).
          setActionField('actionType', BattleActionType.Pass);
          setActionField('actionID', 0);
        }
      }
      break;
    }

    // Check if player can attack all enemies at once, or attack one enemy
    if (BATTLE().player[playerIndex].action.actionType == BattleActionType.Attack) {
      if (origTarget == -1) {
        if (!script.playerCanAttackAll(playerRole)) {
          setActionField('target', battle.selectAutoTargetFrom(currentTarget()));
        }
      } else if (script.playerCanAttackAll(playerRole)) {
        setActionField('target', -1);
      }
    }

    if (toEnemy && currentTarget() >= 0) {
      if (BATTLE().enemy[currentTarget()].objectID == 0) {
        var autoTarget = battle.selectAutoTargetFrom(currentTarget());
        setActionField('target', autoTarget);
        if (autoTarget < 0) {
          throw 'should not be here';
        }
      }
    }
  };

  /**
   * Perform the selected action for a player.
   * @param {Number} playerIndex   the index of the player.
   */
  battle.playerPerformAction = function*(playerIndex: any, battleScriptParent?: unknown): Generator<any, any, any> {
    log.debug(['[BATTLE] playerPerformAction', playerIndex].join(' '));
    var playerRole = getPartyMemberRole(playerIndex);
    var coopPos = [ [208, 157], [234, 170], [260, 183] ];

    setBattleField('movingPlayerIndex', playerIndex);
    battleService.setBattleBlow(0);

    var origTarget = BATTLE().player[playerIndex].action.target;
    battle.playerValidateAction(playerIndex);
    battle.backupStat();

    var target = BATTLE().player[playerIndex].action.target;
    var str, def, res, damage: any;
    var x, y;

    var performedAction = BATTLE().player[playerIndex].action.actionType;
    if (BATTLE().thisTurnCoop && performedAction != BattleActionType.CoopMagic) {
      // Classic: once cooperative magic was used this round, the other members' actions
      // (attack, magic, items, defend, flee) do nothing.
      performedAction = BattleActionType.Pass;
    }

    switch (performedAction) {
      case BattleActionType.Attack:
        if (target != -1) {
          // Attack one enemy
          for (var t = 0; t < (getPlayerStatusValue(playerRole, PlayerStatus.DualAttack) ? 2 : 1); t++) {
            str = script.getPlayerAttackStrength(playerRole);
            def = BATTLE().enemy[target].e.defense;
            def += (BATTLE().enemy[target].e.level + 6) * 4;
            res = BATTLE().enemy[target].e.physicalResistance;
            var critical = false;

            //str = 999; // TODO
            damage = battle.calcPhysicalAttackDamage(str, def, res);
            damage += randomLong(1, 2);

            if (randomLong(0, 5) == 0 || getPlayerStatusValue(playerRole, PlayerStatus.Bravery) > 0) {
              // Critical Hit
              damage *= 3;
              critical = true;
            }

            if (playerRole == 0 && randomLong(0, 11) == 0) {
              // Bonus hit for Li Xiaoyao
              damage *= 2;
              critical = true;
            }

            damage = SHORT(~~(damage * randomFloat(1, 1.125)));

            if (damage <= 0) {
              damage = 1;
            }

            if (SUPER_ATTACK) {
              damage = 6666;
            }

            battleService.setEnemyHealth(target, function(health: any) {
              return (health || 0) - damage;
            });

            if (t == 0) {
               setPlayerFrame(playerIndex, 7);
               yield battle.delay(4, 0, true);
            }

            yield battle.showPlayerAttackAnim(playerIndex, critical);
          }
        } else {
          // Attack all enemies
          for (var t = 0; t < (getPlayerStatusValue(playerRole, PlayerStatus.DualAttack) ? 2 : 1); t++) {
            var division = 1;
            var indices = [ 2, 1, 0, 4, 3 ];

            var critical = (randomLong(0, 5) == 0 || getPlayerStatusValue(playerRole, PlayerStatus.Bravery) > 0);

            if (t == 0) {
              setPlayerFrame(playerIndex, 7);
              yield battle.delay(4, 0, true);
            }

            for (var i = 0; i < Const.MAX_ENEMIES_IN_TEAM; i++) {
              var enemy = BATTLE().enemy[indices[i]];
              if (enemy.objectID == 0 ||
                 indices[i] > BATTLE().maxEnemyIndex) {
                continue;
              }

              str = script.getPlayerAttackStrength(playerRole);
              def = enemy.e.defense;
              def += (enemy.e.level + 6) * 4;
              res = enemy.e.physicalResistance;

              // SDLPAL (attack all): no random bonus or spread, and each further enemy takes
              // half of the previous share (division 1, 2, 4, 8, 16). The damage is a float
              // that is truncated when it is subtracted from the WORD health.
              damage = battle.calcPhysicalAttackDamage(str, def, res);

              if (critical) {
                // Critical Hit
                damage *= 3;
              }

              damage /= division;

              if (damage <= 0) {
                damage = 1;
              }

              if (SUPER_ATTACK) {
                damage = 6666;
              }

              (function(enemyIndex, delta) {
                battleService.setEnemyHealth(enemyIndex, function(health: any) {
                  return Math.trunc((health || 0) - delta);
                });
              })(indices[i], damage);

              if (enemy.objectID != 0) {
                division *= 2;
              }
            }

            if (t > 0) {
              mutatePlayer(playerIndex, function(player: any) {
                player.secondAttack = true;
                return player;
              });
            }

            yield battle.showPlayerAttackAnim(playerIndex, critical);

            yield battle.delay(4, 0, true);
          }
        }

        mutatePlayer(playerIndex, function(player: any) {
          player.secondAttack = false;
          return player;
        });
        battle.updateFighters();
        battle.makeScene();
        yield battle.delay(3, 0, true);

        var healthExpGain = randomLong(2, 3);
        mutateExp(function(exp: any) {
          if (exp && exp.attackExp && playerRole !== null && exp.attackExp[playerRole]) {
            exp.attackExp[playerRole].count++;
          }
          if (exp && exp.healthExp && playerRole !== null && exp.healthExp[playerRole]) {
            exp.healthExp[playerRole].count += healthExpGain;
          }
          return exp;
        });
        break;

      case BattleActionType.AttackMate:
        // Check if there is someone else who is alive
        for (var i = 0; i <= getMaxPartyIndex(); i++) {
          if (i == playerIndex) {
            continue;
          }

          if (getPlayerHP(getPartyMemberRole(i)) > 0) {
            break;
          }
        }

        if (i <= getMaxPartyIndex()) {
          // Pick a target randomly
          do {
            target = randomLong(0, getMaxPartyIndex());
          } while (target == playerIndex || getPlayerHP(getPartyMemberRole(target)) == 0);

          for (var j = 0; j < 2; j++) {
            setPlayerFrame(playerIndex, 8);
            yield battle.delay(1, 0, true);

            setPlayerFrame(playerIndex, 0);
            yield battle.delay(1, 0, true);
          }

          yield battle.delay(2, 0, true);

          x = PAL_X(BATTLE().player[target].pos) + 30;
          y = PAL_Y(BATTLE().player[target].pos) + 12;

          setPlayerPosition(playerIndex, PAL_XY(x, y));
          setPlayerFrame(playerIndex, 8);
          yield battle.delay(5, 0, true);

          setPlayerFrame(playerIndex, 9);
          sound.play(getPlayerWeaponSound(playerRole));

          str = script.getPlayerAttackStrength(playerRole);
          def = script.getPlayerDefense(getPartyMemberRole(target));
          if (BATTLE().player[target].defending) {
            def *= 2;
          }

          damage = battle.calcPhysicalAttackDamage(str, def, 2);
          if (getPlayerStatusValue(getPartyMemberRole(target), PlayerStatus.Protect) > 0) {
            damage = ~~(damage / 2);
          }

          if (damage <= 0) {
            damage = 1;
          }

          if (damage > SHORT(getPlayerHP(getPartyMemberRole(target)))) {
            damage = getPlayerHP(getPartyMemberRole(target));
          }

          if (SUPER_DEFENSE) {
            damage = 1;
          }

          (function(roleIndex, delta) {
            if (roleIndex !== null && typeof roleIndex !== 'undefined') {
              worldService.adjustPlayerHP(roleIndex, -delta);
            }
          })(getPartyRoleId(target), damage);

          setPlayerPosition(target, function(pos: any) {
            return PAL_XY(PAL_X(pos) - 12, PAL_Y(pos) - 6);
          });
          yield battle.delay(1, 0, true);

          battleService.setPlayerColorShift(target, 6);
          yield battle.delay(1, 0, true);

          battle.displayStatChange();

          battleService.setPlayerColorShift(target, 0);
          yield battle.delay(4, 0, true);

          battle.updateFighters();
          yield battle.delay(4, 0, true);
        }

        break;

      case BattleActionType.CoopMagic:
        battleService.set('thisTurnCoop', true);
        var coopContributors = BATTLE().coopContributors || [];
        var isContributor = function(index: number) {
          return coopContributors[index] !== false;
        };
        var object = script.getPlayerCooperativeMagic(getPartyMemberRole(playerIndex));
        var magicNum = GameData.object[object].magic.magicNumber;

        target = battle.detectMagicTargetChange(magicNum, target);

        if (GameData.magic[magicNum].type == MagicType.Summon) {
          yield battle.showPlayerPreMagicAnim(playerIndex, true);
          yield battle.showPlayerSummonMagicAnim(-1, object);
        } else {
          sound.play(29);
          for (var i = 1; i <= 6; i++) {
            // Update the position for the player who invoked the action
            x = PAL_X(BATTLE().player[playerIndex].originalPos) * (6 - i);
            y = PAL_Y(BATTLE().player[playerIndex].originalPos) * (6 - i);

            x += coopPos[0][0] * i;
            y += coopPos[0][1] * i;

            x /= 6;
            y /= 6;

            setPlayerPosition(playerIndex, PAL_XY(x, y));

            // Update the position for other players
            var t = 0;

            for (var j = 0; j <= getMaxPartyIndex(); j++) {
              if (j == playerIndex) {
                continue;
              }

              t++;
              if (!isContributor(j)) {
                continue;
              }

              x = PAL_X(BATTLE().player[j].originalPos) * (6 - i);
              y = PAL_Y(BATTLE().player[j].originalPos) * (6 - i);

              x += coopPos[t][0] * i;
              y += coopPos[t][1] * i;

              x /= 6;
              y /= 6;

              setPlayerPosition(j, PAL_XY(x, y));
            }

            yield battle.delay(1, 0, true);
          }

          for (var i = getMaxPartyIndex(); i >= 0; i--) {
            if (i == playerIndex || !isContributor(i)) {
              continue;
            }

            setPlayerFrame(i, 5);

            yield battle.delay(3, 0, true);
          }

          battleService.setPlayerColorShift(playerIndex, 6);
          setPlayerFrame(playerIndex, 5);
          yield battle.delay(5, 0, true);

          setPlayerFrame(playerIndex, 6);
          battleService.setPlayerColorShift(playerIndex, 0);
          yield battle.delay(3, 0, true);

          yield battle.showPlayerOffMagicAnim(-1, object, target);
        }

        for (var i = 0; i <= getMaxPartyIndex(); i++) {
          var roleId = getPartyRoleId(i);
          if (roleId === null || typeof roleId === 'undefined' || !isContributor(i)) {
            continue;
          }
          worldService.adjustPlayerHP(roleId, -GameData.magic[magicNum].costMP);
          if (SHORT(getPlayerHP(roleId)) <= 0) {
            worldService.setPlayerHP(roleId, 1);
          }

          // Reset the time meter for everyone when using coopmagic
          mutatePlayer(i, function(player: any) {
            player.state = FighterState.Wait;
            return player;
          });
        }

        battle.backupStat(); // so that "damages" to players won't be shown

        str = 0;

        for (var i = 0; i <= getMaxPartyIndex(); i++) {
          if (!isContributor(i)) {
            continue;
          }
          str += script.getPlayerAttackStrength(getPartyMemberRole(i));
          str += script.getPlayerMagicStrength(getPartyMemberRole(i));
        }

        str = ~~(str / 4);

        damage = 0;

        // Inflict damage to enemies
        if (target == -1) {
          // Attack all enemies
          for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
            var enemy = BATTLE().enemy[i];
            if (enemy.objectID == 0) {
              continue;
            }

            def = enemy.e.defense;
            def += (enemy.e.level + 6) * 4;

            damage = battle.calcMagicDamage(str, def, enemy.e.elemResistance, enemy.e.poisonResistance, 1, object);

            if (damage <= 0) {
              damage = 1;
            }

            if (SUPER_ATTACK) {
              damage = 6666;
            }

            battleService.setEnemyHealth(i, function(health: any) {
              return (health || 0) - damage;
            });
          }
        } else {
          // Attack one enemy
          var targetEnemyState = BATTLE().enemy[target];
          def = targetEnemyState.e.defense;
          def += (targetEnemyState.e.level + 6) * 4;

          damage = battle.calcMagicDamage(str, def, targetEnemyState.e.elemResistance, targetEnemyState.e.poisonResistance, 1, object);

          if (damage <= 0) {
            damage = 1;
          }

          if (SUPER_ATTACK) {
            damage = 6666;
          }

          battleService.setEnemyHealth(target, function(health: any) {
            return (health || 0) - damage;
          });
        }

        battle.displayStatChange();
        yield battle.showPostMagicAnim();
        yield battle.delay(5, 0, true);

        if (GameData.magic[magicNum].type != MagicType.Summon) {
          yield (battleScriptParent ? battle.postActionCheck(false, battleScriptParent) : battle.postActionCheck(false));

          // Move all players back to the original position
          for (var i = 1; i <= 6; i++) {
            // Update the position for the player who invoked the action
            x = PAL_X(BATTLE().player[playerIndex].originalPos) * i;
            y = PAL_Y(BATTLE().player[playerIndex].originalPos) * i;

            x += coopPos[0][0] * (6 - i);
            y += coopPos[0][1] * (6 - i);

            x /= 6;
            y /= 6;

            setPlayerPosition(playerIndex, PAL_XY(x, y));

            // Update the position for other players
            var t = 0;

            for (var j = 0; j <= getMaxPartyIndex(); j++) {
              setPlayerFrame(j, 0);

              if (j == playerIndex) {
                continue;
              }

              t++;

              x = PAL_X(BATTLE().player[j].originalPos) * i;
              y = PAL_Y(BATTLE().player[j].originalPos) * i;

              x += coopPos[t][0] * (6 - i);
              y += coopPos[t][1] * (6 - i);

              x = ~~(x / 6);
              y = ~~(y / 6);

              setPlayerPosition(j, PAL_XY(x, y));
            }

            yield battle.delay(1, 0, true);
          }
        }
        break;

      case BattleActionType.Defend:
        mutatePlayer(playerIndex, function(player: any) {
          player.defending = true;
          return player;
        });
        mutateExp(function(exp: any) {
          if (exp && exp.defenseExp && playerRole !== null && exp.defenseExp[playerRole]) {
            exp.defenseExp[playerRole].count += 2;
          }
          return exp;
        });
        break;

      case BattleActionType.Flee:
        str = script.getPlayerFleeRate(playerRole);
        def = 0;

        for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
          if (BATTLE().enemy[i].objectID == 0) {
            continue;
          }

          // SDLPAL: the enemies' dexterity (not flee rate) and (level + 6) * 4.
          def += SHORT(BATTLE().enemy[i].e.dexterity);
          def += (BATTLE().enemy[i].e.level + 6) * 4;
        }

        if (SHORT(def) < 0) {
          def = 0;
        }

        if (str >= randomLong(0, def) && !BATTLE().isBoss) {
          // Successful escape
          yield battle.playerEscape();
        } else {
          // Failed escape
          setPlayerFrame(playerIndex, 0);

          for (var i = 0; i < 3; i++) {
            setPlayerPosition(playerIndex, function(pos: any) {
              return PAL_XY(PAL_X(pos) + 4, PAL_Y(pos) + 2);
            });

            yield battle.delay(1, 0, true);
          }

          setPlayerFrame(playerIndex, 1);
          yield battle.delay(8, ui.BATTLE_LABEL_ESCAPEFAIL, true);

          mutateExp(function(exp: any) {
            if (exp && exp.fleeExp && playerRole !== null && exp.fleeExp[playerRole]) {
              exp.fleeExp[playerRole].count += 2;
            }
            return exp;
          });
        }
        break;

      case BattleActionType.Magic:
        var object = BATTLE().player[playerIndex].action.actionID;
        var magicNum = GameData.object[object].magic.magicNumber;

        target = battle.detectMagicTargetChange(magicNum, target);

        yield battle.showPlayerPreMagicAnim(playerIndex, (GameData.magic[magicNum].type == MagicType.Summon));

        if (!isAutoBattleEnabled()) {
          worldService.adjustPlayerMP(playerRole as any, -GameData.magic[magicNum].costMP);
          if (SHORT(getPlayerMP(playerRole)) < 0) {
            worldService.setPlayerMP(playerRole as any, 0);
          }
        }

        if (GameData.magic[magicNum].type == MagicType.ApplyToPlayer ||
            GameData.magic[magicNum].type == MagicType.ApplyToParty ||
            GameData.magic[magicNum].type == MagicType.Trance) {
          // Using a defensive magic
          var w = 0;

      if (BATTLE().player[playerIndex].action.target != -1) {
        w = getPartyMemberRole(BATTLE().player[playerIndex].action.target) as any;
      }
      else if (GameData.magic[magicNum].type == MagicType.Trance) {
        w = playerRole as any;
      }

      var magicEntry = GameData.object[object] && GameData.object[object].magic;
      if (log && typeof log.debug === 'function') {
        try {
          log.debug('[BATTLE] magic action object ' + object + ' ' + JSON.stringify(magicEntry || {}));
        } catch (err) {
          log.debug('[BATTLE] magic action object ' + object);
        }
      } else if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug('[BATTLE] magic action object', object, magicEntry);
      }
      if (!magicEntry || typeof magicEntry.scriptOnUse !== 'number' || typeof magicEntry.scriptOnSuccess !== 'number') {
        const message = '[BATTLE] missing magic scripts for object ' + object + ' use=' + (magicEntry && magicEntry.scriptOnUse) + ' success=' + (magicEntry && magicEntry.scriptOnSuccess);
        if (log && typeof log.warning === 'function') {
          log.warning(message);
        } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn(message);
        }
      }

      const defensiveUseScript = yield script.runBattleTriggerScript(battleScriptParent,
        GameData.object[object].magic.scriptOnUse,
        playerRole
      );
          worldService.mutateObjectEntry(object, function(objectEntry) {
            if (objectEntry && objectEntry.magic) {
              objectEntry.magic.scriptOnUse = defensiveUseScript;
            }
            return objectEntry;
          });

          if (script.getBattleScriptSuccess(battleScriptParent)) {
            yield battle.showPlayerDefMagicAnim(playerIndex, object, target);

            const defensiveSuccessScript = yield script.runBattleTriggerScript(battleScriptParent,
              GameData.object[object].magic.scriptOnSuccess,
              w
            );
            worldService.mutateObjectEntry(object, function(objectEntry) {
              if (objectEntry && objectEntry.magic) {
                objectEntry.magic.scriptOnSuccess = defensiveSuccessScript;
              }
              return objectEntry;
            });

            if (script.getBattleScriptSuccess(battleScriptParent)) {
              if (GameData.magic[magicNum].type == MagicType.Trance) {
                for (var i = 0; i < 6; i++) {
                  battleService.setPlayerColorShift(playerIndex, i * 2);
                  yield battle.delay(1, 0, true);
                }

                battle.backupScene();
                battle.loadBattleSprites();

                battleService.setPlayerColorShift(playerIndex, 0);

                battle.makeScene();
                yield battle.fadeScene();
              }
            }
          }
        } else {
          // Using an offensive magic
          // As in SDLPAL, both scripts run unconditionally; entry 0 counts as success.
          const offensiveUseScript = yield script.runBattleTriggerScript(battleScriptParent, GameData.object[object].magic.scriptOnUse, playerRole);
          worldService.mutateObjectEntry(object, function(objectEntry) {
            if (objectEntry && objectEntry.magic) {
              objectEntry.magic.scriptOnUse = offensiveUseScript;
            }
            return objectEntry;
          });

          if (script.getBattleScriptSuccess(battleScriptParent)) {
            if (GameData.magic[magicNum].type == MagicType.Summon) {
              yield battle.showPlayerSummonMagicAnim(playerIndex, object);
            } else {
              yield battle.showPlayerOffMagicAnim(playerIndex, object, target);
            }

            const offensiveSuccessScript = yield script.runBattleTriggerScript(battleScriptParent, GameData.object[object].magic.scriptOnSuccess, WORD(target));
            worldService.mutateObjectEntry(object, function(objectEntry) {
              if (objectEntry && objectEntry.magic) {
                objectEntry.magic.scriptOnSuccess = offensiveSuccessScript;
              }
              return objectEntry;
            });

            // Inflict damage to enemies
            if (SHORT(GameData.magic[magicNum].baseDamage) > 0) {
              if (target == -1) {
                // Attack all enemies
                for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
                  var enemy = BATTLE().enemy[i];
                  if (enemy.objectID == 0) {
                    continue;
                  }

                  str = script.getPlayerMagicStrength(playerRole);
                  def = enemy.e.defense;
                  def += (enemy.e.level + 6) * 4;

                  damage = battle.calcMagicDamage(str, def, enemy.e.elemResistance, enemy.e.poisonResistance, 1, object);

                  if (damage <= 0) {
                    damage = 1;
                  }

                  if (SUPER_ATTACK) {
                    damage = 6666;
                  }

                  (function(enemyIndex, delta) {
                    battleService.setEnemyHealth(enemyIndex, function(health: any) {
                      return (health || 0) - delta;
                    });
                  })(i, damage);
                }
              } else {
                // Attack one enemy
                var targetEnemy = BATTLE().enemy[target];
                str = script.getPlayerMagicStrength(playerRole);
                def = targetEnemy.e.defense;
                def += (targetEnemy.e.level + 6) * 4;

                damage = battle.calcMagicDamage(str, def,
                  targetEnemy.e.elemResistance, targetEnemy.e.poisonResistance, 1, object);

                if (damage <= 0) {
                  damage = 1;
                }

                if (SUPER_ATTACK) {
                  damage = 6666;
                }

                battleService.setEnemyHealth(target, function(health: any) {
                  return (health || 0) - damage;
                });
              }
            }
          }
        }

        battle.displayStatChange();
        yield battle.showPostMagicAnim();
        yield battle.delay(5, 0, true);

        yield battle.checkHidingEffect();

        var magicExpGain = randomLong(2, 3);
        mutateExp(function(exp: any) {
          if (exp && exp.magicExp && playerRole !== null && exp.magicExp[playerRole]) {
            exp.magicExp[playerRole].count += magicExpGain;
          }
          if (exp && exp.magicPowerExp && playerRole !== null && exp.magicPowerExp[playerRole]) {
            exp.magicPowerExp[playerRole].count++;
          }
          return exp;
        });
        break;

      case BattleActionType.ThrowItem:
        var player = BATTLE().player[playerIndex];
        var object = player.action.actionID;

        for (var i = 0; i < 4; i++) {
          setPlayerPosition(playerIndex, function(pos: any) {
            return PAL_XY(PAL_X(pos) - (4 - i), PAL_Y(pos) - (4 - i) / 2);
          });

          yield battle.delay(1, 0, true);
        }

        yield battle.delay(2, object, true);

        setPlayerFrame(playerIndex, 5);
        sound.play(getPlayerMagicSound(playerRole));

        yield battle.delay(8, object, true);

        setPlayerFrame(playerIndex, 6);
        yield battle.delay(2, object, true);

        // Run the script
        const updatedThrowScript = yield script.runBattleTriggerScript(battleScriptParent,
          GameData.object[object].item.scriptOnThrow,
          WORD(target)
        );
        worldService.mutateObjectEntry(object, function(objectEntry) {
          if (objectEntry && objectEntry.item) {
            objectEntry.item.scriptOnThrow = updatedThrowScript;
          }
          return objectEntry;
        });

        // Remove the thrown item from inventory
        script.addItemToInventory(object, -1);

        battle.displayStatChange();
        yield battle.delay(4, 0, true);
        battle.updateFighters();
        yield battle.delay(4, 0, true);

        yield battle.checkHidingEffect();

        break;

      case BattleActionType.UseItem:
        var object = BATTLE().player[playerIndex].action.actionID;
        var item = GameData.object[object].item;

        yield battle.showPlayerUseItemAnim(playerIndex, object, target);

        // Run the script
        const updatedItemScript = yield script.runBattleTriggerScript(battleScriptParent,
          item.scriptOnUse,
          (target == -1) ? 0xFFFF : getPartyRoleId(target)
        );
        worldService.mutateObjectEntry(object, function(objectEntry) {
          if (objectEntry && objectEntry.item) {
            objectEntry.item.scriptOnUse = updatedItemScript;
          }
          return objectEntry;
        });

        if (item.flags & ItemFlag.Consuming) {
          script.addItemToInventory(object, -1);
        }

        yield battle.checkHidingEffect();

        battle.updateFighters();
        battle.displayStatChange();
        yield battle.delay(8, 0, true);
        break;

      case BattleActionType.Pass:
        break;
    }

    // Revert this player back to waiting state.
    mutatePlayer(playerIndex, function(player: any) {
      player.state = FighterState.Wait;
      player.timeMeter = 0;
      return player;
    });

    yield (battleScriptParent ? battle.postActionCheck(false, battleScriptParent) : battle.postActionCheck(false));

    // Revert the target slot of this player, so that a repeated action
    // starts from the target that was originally chosen.
    battleService.writeCommitted(playerIndex, { target: origTarget });      // W8:先写组件,再投影
    mutatePlayerAction(playerIndex, function(action: any) {
      action.target = origTarget;
      return action;
    });
  };

  /**
   * Select a attackable player randomly.
   * @return {Number}
   */
  // PAL_BattleEnemySelectEnemyTargetIndex: a random living enemy (used by confused enemies).
  battle.enemySelectEnemyTargetIndex = function() {
    var i = randomLong(0, BATTLE().maxEnemyIndex);
    while (BATTLE().enemy[i].objectID == 0 || BATTLE().enemy[i].e.health == 0) {
      i = randomLong(0, BATTLE().maxEnemyIndex);
    }
    return i;
  };

  battle.enemySelectTargetIndex = function() {
    log.debug(['[BATTLE] enemySelectTargetIndex'].join(' '));
    var i = randomLong(0, getMaxPartyIndex());
    while (getPlayerHP(getPartyMemberRole(i)) == 0) {
      i = randomLong(0, getMaxPartyIndex());
    }

    return i;
  };

  /**
   * Perform the selected action for a player.
   * @param  {Number} enemyIndex the index of the player.
   */
  battle.enemyPerformAction = function*(enemyIndex: any, battleScriptParent?: unknown): Generator<any, any, any> {
    var elementalResistance = utils.initArray(0, Const.NUM_MAGIC_ELEMENTAL);
    var autoDefend = false;
    var magAutoDefend = utils.initArray(false, Const.MAX_PLAYERS_IN_PARTY);
    battle.backupStat();
    battleService.setBattleBlow(0);

    var enemy = BATTLE().enemy[enemyIndex];
    var target = battle.enemySelectTargetIndex();
    var playerRole = getPartyMemberRole(target);
    var magic = enemy.e.magic;
    var magicNum;
    var soundNum;
    var str, def, x, y, ex, ey;
    var damage;

    if (enemy.status[PlayerStatus.Sleep] > 0 ||
        enemy.status[PlayerStatus.Paralyzed] > 0 ||
        BATTLE().hidingTime > 0) {
      // Do nothing
      return end();
    } else if (enemy.status[PlayerStatus.Confused] > 0) {
      // A confused enemy attacks a random living enemy (possibly picking itself, then nothing
      // happens), as in PAL_BattleEnemyPerformAction.
      var mateIndex = battle.enemySelectEnemyTargetIndex();
      if (mateIndex == enemyIndex) {
        return end();
      }
      var mate = BATTLE().enemy[mateIndex];
      var mateX = PAL_X(mate.pos);
      var mateY = PAL_Y(mate.pos);
      for (var step = 0; step < 3; step++) {
        var ownPos = BATTLE().enemy[enemyIndex].pos;
        battleService.setEnemyPosition(enemyIndex, PAL_XY(
          ~~((PAL_X(ownPos) + mateX) / 2),
          ~~((PAL_Y(ownPos) + mateY) / 2)
        ));
        yield battle.delay(1, 0, true);
      }

      var confusedSceneBuf = BATTLE().sceneBuf;
      var confusedScreen = surface.byteBuffer;
      mate = BATTLE().enemy[mateIndex];
      var mateFrame: any = mate.sprite ? mate.sprite.getFrame(0) : null;
      x = ~~((PAL_X(BATTLE().enemy[enemyIndex].pos) + PAL_X(mate.pos)) / 2);
      y = PAL_Y(mate.pos) - (mateFrame ? ~~(mateFrame.height / 3) : 0) + 10;
      for (var effectFrame = 9; effectFrame < 12; effectFrame++) {
        var hit: any = BATTLE().effectSprite ? BATTLE().effectSprite.getFrame(effectFrame) : null;
        yield sleepByFrame(1);
        battle.makeScene();
        surface.blitSurface(confusedSceneBuf, null, confusedScreen, null);
        if (hit) {
          surface.blitRLE(hit, PAL_XY(x - ~~(hit.width / 2), y - hit.height), confusedScreen);
        }
        yield uibattle.update();
        surface.updateScreen(null);
      }

      str = SHORT(enemy.e.attackStrength);
      str += (enemy.e.level + 6) * 6;
      def = SHORT(mate.e.defense);
      def += (mate.e.level + 6) * 4;
      damage = SHORT(~~(battle.calcBaseDamage(str, def) * 2 / (mate.e.physicalResistance || 1)));
      if (damage <= 0) {
        damage = 1;
      }
      (function(index, delta) {
        battleService.setEnemyHealth(index, function(health: any) {
          return (health || 0) - delta;
        });
      })(mateIndex, damage);

      battle.displayStatChange();
      yield battle.showPostMagicAnim();
      yield battle.delay(5, 0, true);

      battleService.setEnemyPosition(enemyIndex, BATTLE().enemy[enemyIndex].originalPos);
      yield battle.delay(2, 0, true);

      yield (battleScriptParent ? battle.postActionCheck(false, battleScriptParent) : battle.postActionCheck(false));
    } else if (magic != 0 && randomLong(0, 9) < enemy.e.magicRate &&
      enemy.status[PlayerStatus.Silence] == 0) {
      // Magical attack
      if (magic == 0xFFFF) {
        // Do nothing
        return end();
      }

      magicNum = GameData.object[magic].magic.magicNumber;

      str = SHORT(enemy.e.magicStrength);
      str += (enemy.e.level + 6) * 6;
      if (str < 0) {
        str = 0;
      }

      ex = PAL_X(enemy.pos);
      ey = PAL_Y(enemy.pos);

      ex += 12;
      ey += 6;

      battleService.setEnemyPosition(enemyIndex, PAL_XY(ex, ey));
      enemy = BATTLE().enemy[enemyIndex];
      yield battle.delay(1, 0, false);

      ex += 4;
      ey += 2;

      battleService.setEnemyPosition(enemyIndex, PAL_XY(ex, ey));
      enemy = BATTLE().enemy[enemyIndex];
      yield battle.delay(1, 0, false);

      sound.play(enemy.e.magicSound);

      for (var i = 0; i < enemy.e.magicFrames; i++) {
        battleService.setEnemyFrame(enemyIndex, enemy.e.idleFrames + i);
        enemy = BATTLE().enemy[enemyIndex];
        yield battle.delay(enemy.e.actWaitFrames, 0, false);
      }

      if (enemy.e.magicFrames == 0) {
         yield battle.delay(1, 0, false);
      }

      if (GameData.magic[magicNum].soundDelay == 0) {
        for (var i = 0; i <= enemy.e.attackFrames; i++) {
          battleService.setEnemyFrame(enemyIndex, i - 1 + enemy.e.idleFrames + enemy.e.magicFrames);
          enemy = BATTLE().enemy[enemyIndex];
          yield battle.delay(enemy.e.actWaitFrames, 0, false);
        }
      }

      if (GameData.magic[magicNum].type != MagicType.Normal) {
        target = -1;

        for (var i = 0; i <= getMaxPartyIndex(); i++) {
          w = getPartyMemberRole(i);

          if (getPlayerStatusValue(w, PlayerStatus.Sleep) == 0 &&
              getPlayerStatusValue(w, PlayerStatus.Paralyzed) == 0 &&
              getPlayerStatusValue(w, PlayerStatus.Confused) == 0 &&
              randomLong(0, 2) == 0 &&
              getPlayerHP(w) != 0) {
            magAutoDefend[i] = true;
            setPlayerFrame(i, 3);
          } else {
            magAutoDefend[i] = false;
          }
        }
      } else if (getPlayerStatusValue(playerRole, PlayerStatus.Sleep) == 0 &&
                 getPlayerStatusValue(playerRole, PlayerStatus.Paralyzed) == 0 &&
                 getPlayerStatusValue(playerRole, PlayerStatus.Confused) == 0 &&
                 randomLong(0, 2) == 0) {
        autoDefend = true;
        setPlayerFrame(target, 3);
      }

      // yield battle.delay(12, (WORD)(-((SHORT)magic)), false);

      const enemyMagicUseScript = yield script.runBattleTriggerScript(battleScriptParent,
        GameData.object[magic].magic.scriptOnUse,
        playerRole
      );
      worldService.mutateObjectEntry(magic, function(objectEntry) {
        if (objectEntry && objectEntry.magic) {
          objectEntry.magic.scriptOnUse = enemyMagicUseScript;
        }
        return objectEntry;
      });

      if (script.getBattleScriptSuccess(battleScriptParent)) {
        yield battle.showEnemyMagicAnim(magic, target);

        const enemyMagicSuccessScript = yield script.runBattleTriggerScript(battleScriptParent,
          GameData.object[magic].magic.scriptOnSuccess,
          playerRole
        );
        worldService.mutateObjectEntry(magic, function(objectEntry) {
          if (objectEntry && objectEntry.magic) {
            objectEntry.magic.scriptOnSuccess = enemyMagicSuccessScript;
          }
          return objectEntry;
        });
      }

      if (SHORT(GameData.magic[magicNum].baseDamage) > 0) {
        if (target == -1) {
          // damage all players
          for (var i = 0; i <= getMaxPartyIndex(); i++) {
            var w = getPartyMemberRole(i);
            if (getPlayerHP(w) == 0) {
              // skip dead players
              continue;
            }

            def = script.getPlayerDefense(w);

            for (x = 0; x < Const.NUM_MAGIC_ELEMENTAL; x++) {
              elementalResistance[x] = 100 + script.getPlayerElementalResistance(w, x);
            }

            damage = battle.calcMagicDamage(
              str, def, elementalResistance,
              100 + script.getPlayerPoisonResistance(w), 20,
              magic
            );

            damage /= ((BATTLE().player[i].defending ? 2 : 1) *
                      ((getPlayerStatusValue(w, PlayerStatus.Protect) > 0) ? 2 : 1)) +
                      (magAutoDefend[i] ? 1 : 0);
            damage = ~~damage;
            //damage = 999;

            if (damage > getPlayerHP(w)) {
              damage = getPlayerHP(w);
            }

            if (SUPER_DEFENSE) {
              damage = 1;
            }

            if (!INVINCIBLE) {
              if (w !== null && typeof w !== 'undefined') {
                worldService.adjustPlayerHP(w, -damage);
              }
            }

            if (getPlayerHP(w) == 0) {
              sound.play(getPlayerDeathSound(w));
            }
          }
        } else {
          // damage one player
          def = script.getPlayerDefense(playerRole);

          for (x = 0; x < Const.NUM_MAGIC_ELEMENTAL; x++) {
            elementalResistance[x] = 100 + script.getPlayerElementalResistance(playerRole, x);
          }

          damage = battle.calcMagicDamage(
            str, def, elementalResistance,
            100 + script.getPlayerPoisonResistance(playerRole), 20,
            magic
          );

          damage /= ((BATTLE().player[target].defending ? 2 : 1) *
                    ((getPlayerStatusValue(playerRole, PlayerStatus.Protect) > 0) ? 2 : 1)) +
                    (autoDefend ? 1 : 0);
          damage = ~~damage;
          // damage = 999;

          if (damage > getPlayerHP(playerRole)) {
            damage = getPlayerHP(playerRole);
          }

          if (SUPER_DEFENSE) {
            damage = 1;
          }

          if (!INVINCIBLE) {
            worldService.adjustPlayerHP(playerRole as any, -damage);
          }

          if (getPlayerHP(playerRole) == 0) {
            sound.play(getPlayerDeathSound(playerRole));
          }
        }
      }

      if (!isAutoBattleEnabled()) {
        battle.displayStatChange();
      }

      for (var i = 0; i < 5; i++) {
        if (target == -1) {
          for (x = 0; x <= getMaxPartyIndex(); x++) {
            var targetPlayer = BATTLE().player[x];
            if (targetPlayer.prevHP ==
                getPlayerHP(getPartyMemberRole(x))) {
              // Skip unaffected players
              continue;
            }

            setPlayerFrame(x, 4);
            if (i > 0) {
              setPlayerPosition(x, function(pos: any) {
                return PAL_XY(
                  PAL_X(pos) + (8 >> i),
                  PAL_Y(pos) + (4 >> i)
                );
              });
            }
            battleService.setPlayerColorShift(x, (i < 3) ? 6 : 0);
          }
        } else {
          var targetPlayer = BATTLE().player[target];
          setPlayerFrame(target, 4);
          if (i > 0) {
            setPlayerPosition(target, function(pos: any) {
              return PAL_XY(
                PAL_X(pos) + (8 >> i),
                PAL_Y(pos) + (4 >> i)
              );
            });
          }
          battleService.setPlayerColorShift(target, (i < 3) ? 6 : 0);
        }

        yield battle.delay(1, 0, false);
      }

      battleService.setEnemyFrame(enemyIndex, 0);
      battleService.setEnemyPosition(enemyIndex, enemy.originalPos);
      enemy = BATTLE().enemy[enemyIndex];

      yield battle.delay(1, 0, false);
      battle.updateFighters();

      yield (battleScriptParent ? battle.postActionCheck(true, battleScriptParent) : battle.postActionCheck(true));
      yield battle.delay(8, 0, true);
    } else {
      // Physical attack
      var targetPlayer = BATTLE().player[target];
      var frameBak = targetPlayer.currentFrame;

      str = SHORT(enemy.e.attackStrength);
      str += (enemy.e.level + 6) * 6;
      if (str < 0) {
        str = 0;
      }

      def = script.getPlayerDefense(playerRole);

      if (targetPlayer.defending) {
        def *= 2;
      }

      sound.play(enemy.e.attackSound);

      var coverIndex = -1;
      var coverPlayer = null;

      autoDefend = (randomLong(0, 16) >= 10);

      // Check if the inflictor should be protected
      if ((battle.isPlayerDying(playerRole) ||
          getPlayerStatusValue(playerRole, PlayerStatus.Confused) > 0 ||
          getPlayerStatusValue(playerRole, PlayerStatus.Sleep) > 0 ||
          getPlayerStatusValue(playerRole, PlayerStatus.Paralyzed) > 0) && autoDefend) {
        w = getPlayerCoveredBy(playerRole);

        for (var i = 0; i <= getMaxPartyIndex(); i++) {
          if (getPartyMemberRole(i) == w) {
            coverIndex = i;
            break;
          }
        }

        if (coverIndex != -1) {
          coverPlayer = getPartyMember(coverIndex);
          if (battle.isPlayerDying(getPartyMemberRole(coverIndex)) ||
              getPlayerStatusValue(getPartyMemberRole(coverIndex), PlayerStatus.Confused) > 0 ||
              getPlayerStatusValue(getPartyMemberRole(coverIndex), PlayerStatus.Sleep) > 0 ||
              getPlayerStatusValue(getPartyMemberRole(coverIndex), PlayerStatus.Paralyzed) > 0) {
            coverIndex = -1;
            coverPlayer = null;
          }
        }
      }

      // If no one can cover the inflictor and inflictor is in a
      // bad status, don't evade
      if (coverIndex == -1 &&
          (getPlayerStatusValue(playerRole, PlayerStatus.Confused) > 0 ||
           getPlayerStatusValue(playerRole, PlayerStatus.Sleep) > 0 ||
           getPlayerStatusValue(playerRole, PlayerStatus.Paralyzed) > 0)) {
        autoDefend = false;
      }

      for (var i = 0; i < enemy.e.magicFrames; i++) {
        battleService.setEnemyFrame(enemyIndex, enemy.e.idleFrames + i);
        enemy = BATTLE().enemy[enemyIndex];
        yield battle.delay(2, 0, false);
      }

      for (var i = 0; i < 3 - enemy.e.magicFrames; i++) {
        x = PAL_X(enemy.pos) - 2;
        y = PAL_Y(enemy.pos) - 1;
        battleService.setEnemyPosition(enemyIndex, PAL_XY(x, y));
        enemy = BATTLE().enemy[enemyIndex];
        yield battle.delay(1, 0, false);
      }

      sound.play(enemy.e.actionSound);
      yield battle.delay(1, 0, false);

      ex = PAL_X(targetPlayer.pos) - 44;
      ey = PAL_Y(targetPlayer.pos) - 16;

      soundNum = enemy.e.callSound;

      if (coverIndex != -1) {
        soundNum = getPlayerCoverSound(getPartyMemberRole(coverIndex));

        setPlayerFrame(coverIndex, 3);

        x = PAL_X(targetPlayer.pos) - 24;
        y = PAL_Y(targetPlayer.pos) - 12;

        setPlayerPosition(coverIndex, PAL_XY(x, y));
      } else if (autoDefend) {
        setPlayerFrame(target, 3);
        soundNum = getPlayerCoverSound(playerRole);
      }

      if (enemy.e.attackFrames == 0) {
        battleService.setEnemyFrame(enemyIndex, enemy.e.idleFrames - 1);
        battleService.setEnemyPosition(enemyIndex, PAL_XY(ex, ey));
        enemy = BATTLE().enemy[enemyIndex];
        yield battle.delay(2, 0, false);
      } else {
        for (var i = 0; i <= enemy.e.attackFrames; i++) {
          battleService.setEnemyFrame(enemyIndex, enemy.e.idleFrames + enemy.e.magicFrames + i - 1);
          battleService.setEnemyPosition(enemyIndex, PAL_XY(ex, ey));
          enemy = BATTLE().enemy[enemyIndex];
          yield battle.delay(enemy.e.actWaitFrames, 0, false);
        }
      }

      if (!autoDefend) {
        setPlayerFrame(target, 4);

        damage = battle.calcPhysicalAttackDamage(str + randomLong(0, 2), def, 2);
        damage += randomLong(0, 1);

        if (getPlayerStatusValue(playerRole, PlayerStatus.Protect)) {
          damage /= 2;
        }
        // damage = 999;

        if (SHORT(getPlayerHP(playerRole)) < damage) {
          damage = getPlayerHP(playerRole);
        }

        damage = ~~damage;

        if (damage <= 0) {
          damage = 1;
        }

        if (SUPER_DEFENSE) {
          damage = 1;
        }

        if (!INVINCIBLE) {
          worldService.adjustPlayerHP(playerRole as any, -damage);
        }

        battle.displayStatChange();

        battleService.setPlayerColorShift(target, 6);
      }

      sound.play(soundNum);
      yield battle.delay(1, 0, false);

      battleService.setPlayerColorShift(target, 0);

      if (coverIndex != -1) {
        battleService.setEnemyPosition(enemyIndex, function(pos: any) {
          return PAL_XY(PAL_X(pos) - 10, PAL_Y(pos) - 8);
        });
        setPlayerPosition(coverIndex, function(pos: any) {
          return PAL_XY(PAL_X(pos) + 4, PAL_Y(pos) + 2);
        });
        enemy = BATTLE().enemy[enemyIndex];
      } else {
        setPlayerPosition(target, function(pos: any) {
          return PAL_XY(PAL_X(pos) + 8, PAL_Y(pos) + 4);
        });
      }

      yield battle.delay(1, 0, false);

      if (getPlayerHP(playerRole) == 0) {
        sound.play(getPlayerDeathSound(playerRole));
        frameBak = 2;
      } else if (battle.isPlayerDying(playerRole)) {
         frameBak = 1;
      }

      if (coverIndex == -1) {
        setPlayerPosition(target, function(pos: any) {
          return PAL_XY(PAL_X(pos) + 2, PAL_Y(pos) + 1);
        });
      }

      yield battle.delay(3, 0, false);

      battleService.setEnemyPosition(enemyIndex, enemy.originalPos);
      battleService.setEnemyFrame(enemyIndex, 0);
      enemy = BATTLE().enemy[enemyIndex];

      yield battle.delay(1, 0, false);

      setPlayerFrame(target, frameBak);
      yield battle.delay(1, 0, true);

      setPlayerPosition(target, targetPlayer.originalPos);
      yield battle.delay(4, 0, true);

      battle.updateFighters();

      // The player's poison resistance can block the attack's item effect (SDLPAL checks both).
      if (coverIndex == -1 && !autoDefend && enemy.e.attackEquivItemRate >= randomLong(1, 10) &&
          script.getPlayerPoisonResistance(playerRole) < randomLong(1, 100)) {
        i = enemy.e.attackEquivItem;
        const attackEquivScript = yield script.runBattleTriggerScript(battleScriptParent,
          GameData.object[i].item.scriptOnUse,
          playerRole
        );
        worldService.mutateObjectEntry(i, function(objectEntry) {
          if (objectEntry && objectEntry.item) {
            objectEntry.item.scriptOnUse = attackEquivScript;
          }
          return objectEntry;
        });
      }

      yield (battleScriptParent ? battle.postActionCheck(true, battleScriptParent) : battle.postActionCheck(true));
    }

    return end();

    function end() {
      // nothing
    }
  };

  /**
   * Steal from the enemy.
   * @param {Number} target        the target enemy index.
   * @param {Number} stealRate     the rate of successful theft.
   */

  battle.stealFromEnemy = function*(target: any, stealRate: any): Generator<any, any, any> {
    log.debug(['[BATTLE] stealFromEnemy', target, stealRate].join(' '));
    var playerIndex = BATTLE().movingPlayerIndex;
    var currentPlayerPos = BATTLE().player[playerIndex].pos;
    var targetEnemy = BATTLE().enemy[target];

    setPlayerFrame(playerIndex, 10);
    var offset = (target - playerIndex) * 8;

    var x = PAL_X(targetEnemy.pos) + 64 - offset;
    var y = PAL_Y(targetEnemy.pos) + 20 - offset / 2;

    setPlayerPosition(playerIndex, PAL_XY(x, y));

    yield battle.delay(1, 0, true);

    for (var i = 0; i < 5; i++) {
      x -= i + 8;
      y -= 4;

      setPlayerPosition(playerIndex, PAL_XY(x, y));

      if (i == 4) {
        battleService.setEnemyColorShift(target, 6);
      }

      yield battle.delay(1, 0, true);
    }

    battleService.setEnemyColorShift(target, 0);
    x--;
    setPlayerPosition(playerIndex, PAL_XY(x, y));
    yield battle.delay(3, 0, true);

    mutatePlayer(playerIndex, function(player: any) {
      player.state = FighterState.Wait;
      player.timeMeter = 0;
      return player;
    });
    battle.updateFighters();
    yield battle.delay(1, 0, true);

    var s;
      // e.stealItemNum is how many are left (nStealItem); e.stealItem is the item id, 0 = money.
      // 空位的 e 是 null(SDLPAL 里是全零结构体,nStealItem = 0 → 偷不到)
      if (targetEnemy && targetEnemy.e && targetEnemy.e.stealItemNum > 0 &&
          (randomLong(0, 10) <= stealRate || stealRate == 0)) {
        if (targetEnemy.e.stealItem == 0) {
          // stolen coins
          var c = ~~(targetEnemy.e.stealItemNum / randomLong(2, 3));
          mutateEnemy(target, function(enemyState: any) {
            if (enemyState && enemyState.e) {
              enemyState.e.stealItemNum -= c;
            }
            return enemyState;
          });
          worldService.adjustCash(c);
          targetEnemy = battleService.getEnemy(target);

          if (c > 0) {
            s = ui.getWord(34);
            s.push(' '.charCodeAt(0));
            s = s.concat(c.toString().split('').map(function(ch: any) {
              return ch.charCodeAt(0);
            }));
            s.push(' '.charCodeAt(0));
            s = s.concat(ui.getWord(10));
          }
        } else {
          // stolen item
          mutateEnemy(target, function(enemyState: any) {
            if (enemyState && enemyState.e) {
              enemyState.e.stealItemNum--;
            }
            return enemyState;
          });
          targetEnemy = battleService.getEnemy(target);
          script.addItemToInventory(targetEnemy.e.stealItem, 1);

          s = ui.getWord(34);
          s = s.concat(ui.getWord(targetEnemy.e.stealItem))
        }
    }

    if (s && s[0] != 0) {
       ui.startDialog(DialogPosition.CenterWindow, 0, 0, false);
       dialogService.setPendingLineMetadata({
         source: 'battle-steal',
         metadata: {
           target,
           stealItem: targetEnemy && targetEnemy.e ? targetEnemy.e.stealItem : null
         }
       });
       // showDialogText is a generator: without yield the message was never shown.
       yield ui.showDialogText(s);
    }
  };

  /**
   * Simulate a magic for players. Mostly used in item throwing script.
   * @param {Number} target        the target enemy index. -1 = all enemies.
   * @param {Number} magicObjectID the object ID of the magic to be simulated.
   * @param {Number} baseDamage    the base damage of the simulation.
   */
  battle.simulateMagic = function*(target: any, magicObjectID: any, baseDamage: any): Generator<any, any, any> {
    log.debug(['[BATTLE] simulateMagic', target, magicObjectID, baseDamage].join(' '));
    var damage: any, def;
    if (GameData.object[magicObjectID].magic.flags & MagicFlag.ApplyToAll) {
      target = -1;
    } else if (target == -1) {
      target = battle.selectAutoTargetFrom(target);
    }

    // Show the magic animation
    yield battle.showPlayerOffMagicAnim(0xFFFF, magicObjectID, target);

    if (GameData.magic[GameData.object[magicObjectID].magic.magicNumber].baseDamage > 0 || baseDamage > 0) {
      if (target == -1) {
        // Apply to all enemies
        for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
          var enemy = BATTLE().enemy[i];
          if (enemy.objectID == 0) {
            continue;
          }

          def = SHORT(enemy.e.defense);
          def += (enemy.e.level + 6) * 4;

          if (def < 0) {
            def = 0;
          }

          damage = battle.calcMagicDamage(
            baseDamage,
            WORD(def),
            enemy.e.elemResistance,
            enemy.e.poisonResistance,
            1,
            magicObjectID
          );

          if (damage < 0) {
            damage = 0;
          }

          if (SUPER_ATTACK) {
            damage = 6666;
          }

          (function(enemyIndex, delta) {
            battleService.setEnemyHealth(enemyIndex, function(health: any) {
              return (health || 0) - delta;
            });
          })(i, damage);
        }
      } else {
        // Apply to one enemy
        var targetEnemy = BATTLE().enemy[target];
        // 目标是空位(脚本给的下标落在开战时就留空的位置):SDLPAL 里是往全零的结构体上扣血,没有效果;这里空位的 e 是 null
        if (!targetEnemy || !targetEnemy.e) {
          return;
        }
        def = SHORT(targetEnemy.e.defense);
        def += (targetEnemy.e.level + 6) * 4;

        if (def < 0) {
          def = 0;
        }

        damage = battle.calcMagicDamage(
          baseDamage,
          WORD(def),
          targetEnemy.e.elemResistance,
          targetEnemy.e.poisonResistance,
          1,
          magicObjectID
        );

        if (damage < 0) {
          damage = 0;
        }

        if (SUPER_ATTACK) {
          damage = 6666;
        }

        battleService.setEnemyHealth(target, function(health: any) {
          return (health || 0) - damage;
        });
      }
    }
  };
};

fight.updateTimeChargingUnit = updateTimeChargingUnit;

export default fight;
function disablePanoramaOverlay() {
  if (panoramaRenderer && typeof panoramaRenderer.setMode === 'function') {
    panoramaRenderer.setMode('off');
  }
  if (panoramaDialog && typeof panoramaDialog.setMode === 'function') {
    panoramaDialog.setMode('off');
  }
}

function restorePanoramaOverlay() {
  if (!config.enablePanorama) {
    return;
  }
  if (panoramaRenderer && typeof panoramaRenderer.setMode === 'function') {
    panoramaRenderer.setMode('panorama');
  }
  if (panoramaDialog && typeof panoramaDialog.setMode === 'function') {
    panoramaDialog.setMode('panorama');
  }
}
