import { battleLoopRuntime } from '../../services/battle-loop-runtime';
import { battleCommandRuntime } from '../../services/battle-command-runtime';
/**
 * Battle UI
 * @module
 * @memberOf  ui
 */

import utils from './utils';
import input from './input';
import uigame from './uigame';
import battleService from '../../services/battle-service';
import worldService from '../../services/world-service';
import partyTrailAdapter from '../../services/party-trail-adapter';
import scriptObjectAdapter from '../../services/script-object-adapter';
import gameDataAdapter from '../../services/game-data-adapter';
import { getBattleStateSnapshot, subscribeBattleState } from '../../services/battle-state-adapter.js';
import {
  getPlayerHP as getPlayerHPValue,
  getPlayerMaxHP as getPlayerMaxHPValue,
  getPlayerMP as getPlayerMPValue,
  getPlayerMaxMP as getPlayerMaxMPValue,
  getPlayerMagicAt as getPlayerMagicAtValue,
  getPlayerStatusRow as getPlayerStatusRowValue,
  getMaxPartyMemberIndex as getCachedMaxPartyMemberIndex,
  getPoisonStatusMatrix as getAdapterPoisonStatusMatrix
} from '../../services/player-state-adapter';
import { autoBattleSignal } from '../../state/slices/auto-battle';
import { statusSignals } from '../../state/slices/status-matrices';
import { Key } from '../../services/input-service';
import { MagicFlag, ItemFlag } from './pal-global';
import { WORD, SHORT } from './binary-helper';
import { BattlePhase, BattleActionType, FighterState } from './battle';
import script from '../../services/script-runner';
import { globalRef } from './global-ref';
import type {
  BattleRuntime,
  BattleStateMutationEvent,
  BattleStateSnapshot,
  ItemMenuModule,
  MagicMenuModule,
  StatusMatrix,
  UiModule,
  UiSignal,
  UiSurface,
  UIBattleModule
} from './global-ref';

const global = globalRef;

const log = global.log;
const FrameTime = 1000 / 24;
const PAL_XY = global.PAL_XY;
const PAL_X = global.PAL_X;
const PAL_Y = global.PAL_Y;
const nativeHrtime = global.hrtime;
const hrtime = () => battleLoopRuntime.presentationTime(nativeHrtime());
const NumColor = global.NumColor;

global.BattleFrameTime = FrameTime;
const BattleFrameTime = FrameTime;

export enum BattleUIState {
  Wait = 0,
  SelectMove = 1,
  SelectTargetEnemy = 2,
  SelectTargetPlayer = 3,
  SelectTargetEnemyAll = 4,
  SelectTargetPlayerAll = 5
}
global.BattleUIState = BattleUIState;

export enum BattleMenuState {
  Main = 0,
  MagicSelect = 1,
  UseItemSelect = 2,
  ThrowItemSelect = 3,
  Misc = 4,
  MiscItemSubMenu = 5,
}
global.BattleMenuState = BattleMenuState;

export enum BattleUIAction {
  Attack = 0,
  Magic = 1,
  CoopMagic = 2,
  Misc = 3,
}
global.BattleUIAction = BattleUIAction;

const SPRITENUM_BATTLEICON_ATTACK               = 40;
const SPRITENUM_BATTLEICON_MAGIC                = 41;
const SPRITENUM_BATTLEICON_COOPMAGIC            = 42;
const SPRITENUM_BATTLEICON_MISCMENU             = 43;

const SPRITENUM_BATTLE_ARROW_CURRENTPLAYER      = 69;
const SPRITENUM_BATTLE_ARROW_CURRENTPLAYER_RED  = 68;

const SPRITENUM_BATTLE_ARROW_SELECTEDPLAYER     = 67;
const SPRITENUM_BATTLE_ARROW_SELECTEDPLAYER_RED = 66;

const BATTLEUI_LABEL_ITEM                       = 5;
const BATTLEUI_LABEL_DEFEND                     = 58;
const BATTLEUI_LABEL_AUTO                       = 56;
const BATTLEUI_LABEL_INVENTORY                  = 57;
const BATTLEUI_LABEL_FLEE                       = 59;
const BATTLEUI_LABEL_STATUS                     = 60;

const BATTLEUI_LABEL_USEITEM                    = 23;
const BATTLEUI_LABEL_THROWITEM                  = 24;

const BATTLEUI_MAX_SHOWNUM                      = 16;

class UIBattle {
  frame = 0;
  curMiscMenuItem = 0;
  curSubMenuItem = 0;
  
  TIMEMETER_COLOR_DEFAULT = 0x1B;
  TIMEMETER_COLOR_SLOW = 0x5B;
  TIMEMETER_COLOR_HASTE = 0x2A;

  _pendingStateMutation: BattleStateMutationEvent | null = null;

  // Static references for legacy compatibility
  static ShowNum: any;
  static BattleUI: any;
  
  // Methods to be implemented
  init: any;
  dispose: any;
  showNum: any;
  update: any;
  isActionValid: any;
  pickAutoMagic: any;
  useItem: any;
  throwItem: any;
  miscMenuUpdate: any;
  miscItemSubMenuUpdate: any;
  playerInfoBox: any;
  lastStateMutation: BattleStateMutationEvent | null = null;
  playerReady: any;
  drawMiscMenu: any;
  showText: any;

  surface: UiSurface = null as unknown as UiSurface;
  battle: BattleRuntime = null as unknown as BattleRuntime;
  ui: UiModule = null as unknown as UiModule;
  itemmenu: ItemMenuModule = null as unknown as ItemMenuModule;
  magicmenu: MagicMenuModule = null as unknown as MagicMenuModule;

  battleServiceSubscription: ((event: BattleStateMutationEvent) => void) | null = null;
  autoBattleFlagSignal: UiSignal<boolean> = autoBattleSignal();
  statusSlice: { player: UiSignal<StatusMatrix>; poison: UiSignal<StatusMatrix> } = statusSignals();
  poisonStatusSignal: UiSignal<StatusMatrix> = this.statusSlice.poison;
  battleStateUnsubscribe: (() => void) | null = null;
  battleStateCache: BattleStateSnapshot | null = null;
}

const uibattle: UIBattleModule = new UIBattle();

const UI_TRACKED_KEYS = [
  'state',
  'menuState',
  'curPlayerIndex',
  'selectedAction',
  'selectedIndex',
  'prevEnemyTarget',
  'actionType',
  'objectID',
  'autoAttack'
];

const DEFAULT_BATTLE_SNAPSHOT: BattleStateSnapshot = {
  player: [],
  enemy: [],
  phase: 0,
  enemyCleared: false,
  maxEnemyIndex: -1
};

function normalizeBattleSnapshot(snapshot: BattleStateSnapshot | Record<string, unknown> | null | undefined): BattleStateSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    return { ...DEFAULT_BATTLE_SNAPSHOT };
  }
  const raw = snapshot as BattleStateSnapshot;
  return {
    ...raw,
    player: Array.isArray(raw.player) ? raw.player : [],
    enemy: Array.isArray(raw.enemy) ? raw.enemy : [],
    phase: typeof raw.phase === 'number' ? raw.phase : DEFAULT_BATTLE_SNAPSHOT.phase,
    enemyCleared: typeof raw.enemyCleared === 'boolean' ? raw.enemyCleared : DEFAULT_BATTLE_SNAPSHOT.enemyCleared,
    maxEnemyIndex: typeof raw.maxEnemyIndex === 'number' ? raw.maxEnemyIndex : DEFAULT_BATTLE_SNAPSHOT.maxEnemyIndex
  };
}

// uibattle.TIMEMETER_COLOR_DEFAULT                   = 0x1B;
// uibattle.TIMEMETER_COLOR_SLOW                      = 0x5B;
// uibattle.TIMEMETER_COLOR_HASTE                     = 0x2A;

// var surface = null;
// var battle = null;
// var ui = null;
// var itemmenu = null;
// var magicmenu = null;

// var battleServiceSubscription = null;
// var autoBattleFlagSignal = autoBattleSignal();
// var statusSlice = statusSignals();
// var poisonStatusSignal = statusSlice.poison;
// var battleStateUnsubscribe = null;
// var battleStateCache = null;

function BATTLE() {
  const live = battleService.getState && battleService.getState();
  if (live) return live as unknown as BattleStateSnapshot;
  if (!uibattle.battleStateCache) {
    uibattle.battleStateCache = normalizeBattleSnapshot(getBattleStateSnapshot());
  }
  return uibattle.battleStateCache;
}

function snapshotUIState(component: any) {
  var uiComponent = component || (battleService.getUIComponent && battleService.getUIComponent());
  if (!uiComponent || !uiComponent.stateRef) {
    return null;
  }
  var source = uiComponent.stateRef;
  var snapshot: any = {};
  for (var i = 0; i < UI_TRACKED_KEYS.length; i++) {
    var key = UI_TRACKED_KEYS[i];
    if (key === 'autoAttack') {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        snapshot[key] = source[key];
      } else if (typeof uiComponent.autoBattle !== 'undefined') {
        snapshot[key] = uiComponent.autoBattle;
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      snapshot[key] = source[key];
    }
  }
  return snapshot;
}

function emitUIEvents(previousSnapshot: any, context: any) {
  var component = battleService.getUIComponent && battleService.getUIComponent();
  var currentSnapshot = snapshotUIState(component) || {};
  var changes: any[] = [];

  UI_TRACKED_KEYS.forEach(function(key) {
    var previous = previousSnapshot ? previousSnapshot[key] : undefined;
    var current;
    if (key === 'autoAttack') {
      if (Object.prototype.hasOwnProperty.call(currentSnapshot, key)) {
        current = currentSnapshot[key];
      } else if (component && typeof component.autoBattle !== 'undefined') {
        current = component.autoBattle;
      } else {
        current = undefined;
      }
    } else {
      current = currentSnapshot[key];
    }

    if (previous !== current) {
      changes.push({
        key: key,
        previous: previous,
        current: current
      });
      if (component && typeof battleService.fire === 'function') {
        battleService.fire('ui:changed:' + key, {
          key: key,
          previous: previous,
          current: current,
          component: component,
          context: context || null
        });
      }
    }
  });

  if (changes.length > 0 && typeof battleService.fire === 'function') {
    battleService.fire('ui:changed', {
      changes: changes,
      component: component,
      context: context || null
    });
  }

  if (typeof battleService.fire === 'function') {
    battleService.fire('ui:updated', {
      changes: changes,
      component: component,
      context: context || null
    });
  }
}

function runUIUpdate(mutator: any, context: any) {
  var previousSnapshot = snapshotUIState(undefined);

  battleService.updateUI(function(uiState: any) {
    if (!uiState) return uiState;
    return mutator ? (mutator(uiState) || uiState) : uiState;
  });

  if (typeof battleService.syncUIComponent === 'function') {
    battleService.syncUIComponent();
  }

  emitUIEvents(previousSnapshot, context);
}

function mutateUI(mutator: any, context?: any) {
  runUIUpdate(function(uiState: any) {
    if (typeof mutator === 'function') {
      var result = mutator(uiState);
      return result || uiState;
    }
    return uiState;
  }, context);
}

function setUI(updates: any, context?: any) {
  if (typeof updates === 'function') {
    runUIUpdate(function(uiState: any) {
      return updates(uiState) || uiState;
    }, context);
    return;
  }
  runUIUpdate(function(uiState: any) {
    Object.keys(updates).forEach(function(key) {
      var updater = updates[key];
      var nextValue = (typeof updater === 'function') ? updater(uiState[key], uiState) : updater;
      uiState[key] = nextValue;
    });
    return uiState;
  }, context);
}

function setUIProp(prop: string, value: any, context?: any) {
  var patch: any = {};
  patch[prop] = value;
  setUI(patch, context);
}

function setPlayer(index: any, mutator: any) {
  battleService.setPlayer(index, function(player: any) {
    if (!player) return player;
    return mutator(player) || player;
  });
}

function getMaxPartyMemberIndex() {
  var index = getCachedMaxPartyMemberIndex();
  return typeof index === 'number' ? index : -1;
}

function getPlayerStatusRow(roleId: any) {
  return getPlayerStatusRowValue(roleId) || [];
}

function getPlayerStatusValue(roleId: any, statusIndex: any) {
  var row = getPlayerStatusRow(roleId);
  if (!row) {
    return 0;
  }
  var value = row[statusIndex];
  return typeof value === 'number' ? value : 0;
}

function playerHasStatus(roleId: any, statusIndex: any) {
  return getPlayerStatusValue(roleId, statusIndex) !== 0;
}

function getPoisonStatusEntry(poisonIndex: any, partyIndex: any) {
  var matrix = getAdapterPoisonStatusMatrix();      // 组件视图(M2 D5c)
  if (!Array.isArray(matrix)) {
    return null;
  }
  var row = matrix[poisonIndex];
  if (!Array.isArray(row)) {
    return null;
  }
  return row[partyIndex] || null;
}

function getObjectEntry(objectId: any) {
  if (objectId <= 0) {
    return null;
  }
  return scriptObjectAdapter.getObjectEntry(objectId);
}

function getMagicEntry(magicId: any) {
  if (magicId <= 0) {
    return null;
  }
  return gameDataAdapter.getMagicEntry(magicId);
}

function isPlayerAvailable(index: any) {
  var partyEntry = getPartyMember(index);
  if (!partyEntry) {
    return false;
  }
  var roleId = partyEntry.playerRole;
  var hp = getPlayerHP(roleId);
  if (hp === 0 && !playerHasStatus(roleId, PlayerStatus.Puppet)) {
    return false;
  }
  if (playerHasStatus(roleId, PlayerStatus.Sleep) ||
      playerHasStatus(roleId, PlayerStatus.Confused) ||
      playerHasStatus(roleId, PlayerStatus.Paralyzed)) {
    return false;
  }
  return true;
}

function isPartyMemberActionLocked(index: any) {
  var partyEntry = getPartyMember(index);
  if (!partyEntry) {
    return true;
  }
  var roleId = partyEntry.playerRole;
  if (getPlayerHP(roleId) === 0) {
    return true;
  }
  return playerHasStatus(roleId, PlayerStatus.Confused) ||
         playerHasStatus(roleId, PlayerStatus.Sleep) ||
         playerHasStatus(roleId, PlayerStatus.Paralyzed);
}

function promoteFirstWaitingPlayer() {
  var maxIndex = getMaxPartyMemberIndex();
  if (maxIndex < 0) {
    return -1;
  }
  for (var idx = 0; idx <= maxIndex; idx++) {
    if (!isPlayerAvailable(idx)) {
      continue;
    }
    var playerState = battleService.getPlayer(idx);
    if (!playerState || playerState.state !== FighterState.Wait) {
      continue;
    }
    setPlayer(idx, function(player: any) {
      player.state = FighterState.Com;
      player.defending = false;
      return player;
    });
    return idx;
  }
  return -1;
}

function getUIComponent() {
  return typeof battleService.getUIComponent === 'function' ? battleService.getUIComponent() : null;
}

function getUIStateSnapshot() {
  var component = getUIComponent();
  if (component && component.stateRef) {
    return component.stateRef;
  }
  var state = BATTLE();
  return state && state.UI ? state.UI : null;
}

// SDLPAL keeps two flags apart:
// - gpGlobals->fAutoBattle (script 0x008A): the game plays the whole battle, picking magic;
// - g_Battle.UI.fAutoAttack (the player's Auto command): every member just attacks.
// They used to be merged here, so the player's Auto became a full auto battle (free magic,
// slower enemies, dying scripts skipped).
function getAutoBattle(_component?: any) {
  return !!uibattle.autoBattleFlagSignal.value;
}

function getAutoAttack() {
  var uiState = getUIStateObject();
  return !!(uiState && uiState.autoAttack);
}

function getUIStateObject() {
  var component = getUIComponent();
  if (component && component.stateRef) {
    return component.stateRef;
  }
  var state = battleService.getState && battleService.getState();
  if (state && state.UI) {
    return state.UI;
  }
  var fallback = getBattleStateSnapshot();
  if (fallback && fallback.UI) {
    return fallback.UI;
  }
  return null;
}

function getUIProp(prop: string, fallback?: any, component?: any) {
  var uiComponent = component || getUIComponent();
  if (!uiComponent) {
    return typeof fallback === 'undefined' ? null : fallback;
  }
  var uiState = uiComponent.stateRef || getUIStateObject();
  if (uiState && Object.prototype.hasOwnProperty.call(uiState, prop)) {
    return uiState[prop];
  }
  return typeof fallback === 'undefined' ? null : fallback;
}

function getPartyMember(index: any) {
  var party = partyTrailAdapter.getPartyState();
  if (!Array.isArray(party)) {
    return null;
  }
  return party[index] || null;
}

function getCurrentPlayerIndex(fallback?: any, component?: any) {
  var index = getUIProp('curPlayerIndex', null, component);
  if (typeof index === 'number' && index >= 0) {
    return index;
  }
  return typeof fallback === 'number' ? fallback : 0;
}

function getCurrentPartyEntry(fallbackIndex?: any, component?: any) {
  var index = getCurrentPlayerIndex(fallbackIndex, component);
  return getPartyMember(index);
}

function getCurrentPlayerRole(fallbackRole?: any, component?: any) {
  var entry = getCurrentPartyEntry(undefined, component);
  if (entry && typeof entry.playerRole === 'number') {
    return entry.playerRole;
  }
  return typeof fallbackRole === 'number' ? fallbackRole : 0;
}

function getPlayerHP(roleId: any) {
  return getPlayerHPValue(roleId);
}

function getPlayerMaxHP(roleId: any) {
  return getPlayerMaxHPValue(roleId);
}

function getPlayerMP(roleId: any) {
  return getPlayerMPValue(roleId);
}

function getPlayerMaxMP(roleId: any) {
  return getPlayerMaxMPValue(roleId);
}

function getPlayerMagicSlot(slotIndex: any, roleId: any) {
  return getPlayerMagicAtValue(slotIndex, roleId);
}

function adjustInventoryUsage(itemId: any, delta: any) {
  if (!itemId || delta === 0) {
    return;
  }
  worldService.mutateInventory(function(inventory) {
    if (!Array.isArray(inventory)) {
      return inventory;
    }
    for (var idx = 0; idx < inventory.length; idx++) {
      var slot = inventory[idx];
      if (slot && slot.item == itemId) {
        slot.amountInUse += delta;
        break;
      }
    }
    return inventory;
  });
}

uibattle.init = function*(surf: any, _battle: any, _ui: any) {
  log.debug('[BATTLE] init uibattle');
  if (typeof uibattle.dispose === 'function') {
    uibattle.dispose();
  }
  uibattle.battle = _battle;
  uibattle.ui = _ui;
  uibattle.itemmenu = _ui.itemmenu;
  uibattle.magicmenu = _ui.magicmenu;
  global.uibattle = _ui.uibattle = uibattle;
  uibattle.surface = surf;

  if (battleService && typeof battleService.bindModule === 'function') {
    battleService.bindModule(_battle);
  }
  if (battleService && typeof battleService.on === 'function') {
    const handler = function(event: BattleStateMutationEvent) {
      uibattle._pendingStateMutation = event;
    };
    battleService.on('stateMutated', handler);
    battleService.on('stateChanged', handler);
    uibattle.battleServiceSubscription = handler;
  }

  if (typeof uibattle.battleStateUnsubscribe === 'function') {
    uibattle.battleStateUnsubscribe();
    uibattle.battleStateUnsubscribe = null;
  }
  uibattle.battleStateCache = normalizeBattleSnapshot(getBattleStateSnapshot());
  uibattle.battleStateUnsubscribe = subscribeBattleState((event: BattleStateMutationEvent) => {
    if (!event) {
      return;
    }
    if (event.type === 'disposed') {
      uibattle.battleStateCache = null;
      return;
    }
    if (event.state) {
      uibattle.battleStateCache = normalizeBattleSnapshot(event.state);
    }
  });
};

class ShowNum {
  num = 0;
  pos = 0;
  time = 0;
  color = NumColor.Yellow;

  constructor() {
    this.reset();
  }

  reset(num?: number, pos?: number, time?: number, color?: number) {
    this.num = num || 0;
    this.pos = pos || 0;
    this.time = time || 0;
    this.color = color || NumColor.Yellow;
    return this;
  }
}
UIBattle.ShowNum = ShowNum;

class BattleUI {
  state = BattleUIState.Wait;
  menuState = BattleMenuState.Main;
  msg: any = null;
  nextMsg: any = null;
  msgShowTime = 0;
  nextMsgDuration = 0;
  curPlayerIndex = 0;
  selectedAction = 0;
  prevEnemyTarget = -1;
  actionType = 0;
  objectID = 0;
  autoAttack = false;
  showNum = utils.initArray(ShowNum, BATTLEUI_MAX_SHOWNUM);
}
UIBattle.BattleUI = BattleUI;
(uibattle as any).ShowNum = ShowNum;
(uibattle as any).BattleUI = BattleUI;

var statusPos = [
  [35, 19],  // confused
  [0, 0],    // slow
  [54, 1],   // sleep
  [55, 20],  // silence
  [0, 0],    // puppet
  [0, 0],    // bravery
  [0, 0],    // protect
  [0, 0],    // haste
  [0, 0]     // dualattack
];
var statusWord = [
  0x1D,  // confused
  0x00,  // slow
  0x1C,  // sleep
  0x1A,  // silence
  0x00,  // puppet
  0x00,  // bravery
  0x00,  // protect
  0x00,  // haste
  0x00   // dualattack
];
var statusColor = [
  0x5F,  // confused
  0x00,  // slow
  0x0E,  // sleep
  0x3C,  // silence
  0x00,  // puppet
  0x00,  // bravery
  0x00,  // protect
  0x00,  // haste
  0x00   // dualattack
];

/**
 * Show the player info box.
 * @param  {POS} pos            the top-left corner position of the box.
 * @param  {Number}  playerRole     the player role ID to be shown.
 * @param  {Number}  timeMeter      the value of time meter. 0 = empty, 100 = full.
 * @param  {Number}  timeMeterColor the color of time meter.
 * @param  {Boolean} update         whether to update the screen area or not.
 */
uibattle.playerInfoBox = function(pos: any, playerRole: any, timeMeter: any, timeMeterColor: any, update: any) {
  var screen = uibattle.surface.byteBuffer;
  // Draw the box
  uibattle.surface.blitRLE(
    uibattle.ui.sprite.getFrame(uibattle.ui.SPRITENUM_PLAYERINFOBOX),
    pos
  );

  // Draw the player face
  var maxLevel = 0;
  var poisonColor = 0xFF;
  var partyIndex = -1;
  var maxPartyMemberIndex = getMaxPartyMemberIndex();

  if (maxPartyMemberIndex >= 0) {
    for (partyIndex = 0; partyIndex <= maxPartyMemberIndex; partyIndex++) {
      var partyEntry = getPartyMember(partyIndex);
      if (partyEntry && partyEntry.playerRole == playerRole) {
        break;
      }
    }
  }

  if (partyIndex >= 0 && partyIndex <= maxPartyMemberIndex) {
    for (var i = 0; i < Const.MAX_POISONS; i++) {
      var statusEntry = getPoisonStatusEntry(i, partyIndex);
      var poisonObjectId = statusEntry && typeof statusEntry === 'object'
        ? (statusEntry as any).poisonID
        : 0;
      if (!poisonObjectId) {
        continue;
      }
      var poisonObject = getObjectEntry(poisonObjectId);
      var poisonData = poisonObject && poisonObject.poison;
      if (!poisonData || poisonData.poisonLevel > 3) {
        continue;
      }
      if (poisonData.poisonLevel >= maxLevel) {
        maxLevel = poisonData.poisonLevel;
        poisonColor = poisonData.color;
      }
    }
  }

  var currentHP = getPlayerHP(playerRole);
  if (currentHP == 0) {
    // Always use the black/white color for dead players
    // and do not use the time meter
    poisonColor = 0;
    timeMeter = 0;
  }

  if (poisonColor == 0xFF) {
    uibattle.surface.blitRLE(
      uibattle.ui.sprite.getFrame(uibattle.ui.SPRITENUM_PLAYERFACE_FIRST + playerRole),
      PAL_XY(PAL_X(pos) - 2, PAL_Y(pos) - 4)
    );
  } else {
    uibattle.surface.blitRLEMonoColor(
      uibattle.ui.sprite.getFrame(uibattle.ui.SPRITENUM_PLAYERFACE_FIRST + playerRole),
      PAL_XY(PAL_X(pos) - 2, PAL_Y(pos) - 4),
      poisonColor,
      0
    );
  }

  // Draw the HP and MP value
  uibattle.surface.blitRLE(
    uibattle.ui.sprite.getFrame(uibattle.ui.SPRITENUM_SLASH),
     PAL_XY(PAL_X(pos) + 49, PAL_Y(pos) + 6)
  );
  uibattle.ui.drawNumber(
    getPlayerMaxHP(playerRole), 4,
    PAL_XY(PAL_X(pos) + 47, PAL_Y(pos) + 8), NumColor.Yellow, NumAlign.Right
  );
  uibattle.ui.drawNumber(
    currentHP, 4,
    PAL_XY(PAL_X(pos) + 26, PAL_Y(pos) + 5), NumColor.Yellow, NumAlign.Right
  );

  uibattle.surface.blitRLE(
    uibattle.ui.sprite.getFrame(uibattle.ui.SPRITENUM_SLASH),
     PAL_XY(PAL_X(pos) + 49, PAL_Y(pos) + 22)
  );
  uibattle.ui.drawNumber(
    getPlayerMaxMP(playerRole), 4,
    PAL_XY(PAL_X(pos) + 47, PAL_Y(pos) + 24), NumColor.Cyan, NumAlign.Right
  );
  uibattle.ui.drawNumber(
    getPlayerMP(playerRole), 4,
    PAL_XY(PAL_X(pos) + 26, PAL_Y(pos) + 21), NumColor.Cyan, NumAlign.Right
  );
  // Draw Statuses
  if (currentHP > 0) {
    var statusRow = getPlayerStatusRow(playerRole);
    for (var i = 0; i < PlayerStatus.All; i++) {
      if (statusRow && statusRow[i] > 0 && statusWord[i] != 0) {
        uibattle.ui.drawText(
          uibattle.ui.getWord(statusWord[i]),
          PAL_XY(PAL_X(pos) + statusPos[i][0], PAL_Y(pos) + statusPos[i][1]),
          statusColor[i], true, false
        );
      }
    }
  }

  // Update the screen area if needed
  if (update) {
    uibattle.surface.updateScreen(new RECT(
      PAL_X(pos) - 2,
      PAL_Y(pos) - 4,
      77,
      39
    ));
  }
};

/**
 * Check if the specified action is valid.
 * @param  {BattleUIAction}  actionType the type of the action.
 * @return {Boolean}         true if the action is valid, false if not.
 */
uibattle.isActionValid = function(actionType: any) {
  var partyEntry = getCurrentPartyEntry();
  if (!partyEntry) {
    return false;
  }
  var playerRole = partyEntry.playerRole;

  switch (actionType) {
    case BattleUIAction.Attack:
    case BattleUIAction.Misc:
      break;

    case BattleUIAction.Magic:
      if (playerHasStatus(playerRole, PlayerStatus.Silence)) {
        return false;
      }
      break;

    case BattleUIAction.CoopMagic:
      // Classic: the current member must be healthy and at least one other as well.
      var healthyCount = 0;
      var maxIndex = getMaxPartyMemberIndex();
      for (var i = 0; i <= maxIndex; i++) {
        var partyMember = getPartyMember(i);
        if (partyMember && uibattle.battle.isPlayerHealthy(partyMember.playerRole)) {
          healthyCount++;
        }
      }
      return uibattle.battle.isPlayerHealthy(playerRole) && healthyCount > 1;
  }

  return true;
};

/**
 * Draw the misc menu.
 * @param  {Number}  currentItem the current selected menu item.
 * @param  {Boolean} confirmed   true if confirmed, false if not.
 */
uibattle.drawMiscMenu = function(currentItem: any, confirmed: any) {
  var menuItems = [
    //              value label                     enabled position
    new uibattle.ui.MenuItem(0,    BATTLEUI_LABEL_AUTO,      true,   PAL_XY(16, 32)),
    new uibattle.ui.MenuItem(1,    BATTLEUI_LABEL_INVENTORY, true,   PAL_XY(16, 50)),
    new uibattle.ui.MenuItem(2,    BATTLEUI_LABEL_DEFEND,    true,   PAL_XY(16, 68)),
    new uibattle.ui.MenuItem(3,    BATTLEUI_LABEL_FLEE,      true,   PAL_XY(16, 86)),
    new uibattle.ui.MenuItem(4,    BATTLEUI_LABEL_STATUS,    true,   PAL_XY(16, 104))
  ];

  // Draw the box
  uibattle.ui.createBox(PAL_XY(2, 20), 4, 1, 0, false);

  // Draw the menu items
  for (var i = 0; i < 5; i++) {
    var color = uibattle.ui.MENUITEM_COLOR;
    if (i == currentItem) {
      if (confirmed) {
        color = uibattle.ui.MENUITEM_COLOR_CONFIRMED;
      } else {
        color = uibattle.ui.MENUITEM_COLOR_SELECTED;
      }
    }

    uibattle.ui.drawText(
      uibattle.ui.getWord(menuItems[i].wordNum),
      menuItems[i].pos, color,
      true, false
    );
  }
};

/**
 * Update the misc menu.
 * @return {Number} The selected item number. 0 if cancelled, 0xFFFF if not confirmed.
 */
uibattle.miscMenuUpdate = function() {
  // Draw the menu
  uibattle.drawMiscMenu(uibattle.curMiscMenuItem, false);

  // Process inputs
  if (commandKeyPressed(Key.Up | Key.Left)) {
    uibattle.curMiscMenuItem--;
    if (uibattle.curMiscMenuItem < 0) {
       uibattle.curMiscMenuItem = 4;
    }
  } else if (commandKeyPressed(Key.Down | Key.Right)) {
    uibattle.curMiscMenuItem++;
    if (uibattle.curMiscMenuItem > 4) {
      uibattle.curMiscMenuItem = 0;
    }
  } else if (commandKeyPressed(Key.Search)) {
    return uibattle.curMiscMenuItem + 1;
  }
  else if (commandKeyPressed(Key.Menu)) {
    return 0;
  }

  return 0xFFFF;
};

/**
 * Update the item sub menu of the misc menu.
 * @return {Number} The selected item number. 0 if cancelled, 0xFFFF if not confirmed.
 */
uibattle.miscItemSubMenuUpdate = function() {
  var menuItems = [
    //              value label                     enabled position
    new uibattle.ui.MenuItem(0,    BATTLEUI_LABEL_USEITEM,   true,   PAL_XY(44, 62)),
    new uibattle.ui.MenuItem(1,    BATTLEUI_LABEL_THROWITEM, true,   PAL_XY(44, 80))
  ];

  // Draw the menu
  uibattle.drawMiscMenu(1, true);
  uibattle.ui.createBox(PAL_XY(30, 50), 1, 1, 0, false);

  // Draw the menu items
  for (var i = 0; i < 2; i++) {
    var color = uibattle.ui.MENUITEM_COLOR;

    if (i == uibattle.curSubMenuItem) {
      color = uibattle.ui.MENUITEM_COLOR_SELECTED;
    }

    uibattle.ui.drawText(
      uibattle.ui.getWord(menuItems[i].wordNum),
      menuItems[i].pos, color,
      true, false
    );
  }

  // Process inputs
  if (commandKeyPressed(Key.Up | Key.Left)) {
    uibattle.curSubMenuItem = 0;
  } else if (commandKeyPressed(Key.Down | Key.Right)) {
    uibattle.curSubMenuItem = 1;
  } else if (commandKeyPressed(Key.Search)) {
    return uibattle.curSubMenuItem + 1;
  } else if (commandKeyPressed(Key.Menu)) {
    return 0;
  }

  return 0xFFFF;
};

/**
 * Show a text message in the uibattle.battle.
 * @param  {Number} text     the text message to be shown.
 * @param  {Number} duration the duration of the message, in milliseconds.
 */
uibattle.showText = function(text: any, duration: any) {
  var now = hrtime();
  mutateUI(function(uiState: any) {
    if (now < uiState.msgShowTime) {
      uiState.nextMsg = text;
      uiState.nextMsgDuration = duration;
    } else {
      uiState.msg = text;
      uiState.msgShowTime = now + duration;
    }
  });
};

/**
 * Start the action selection menu of the specified player.
 * @param  {Number} playerIndex the player index.
 */
uibattle.playerReady = function(playerIndex: any) {
  setUI({
    curPlayerIndex: playerIndex,
    state: BattleUIState.SelectMove,
    selectedAction: 0,
    menuState: BattleMenuState.Main
  });
};

/**
 * Use an item in the battle UI.
 */
uibattle.useItem = function() {
  var selectedItem = battleCommandRuntime.owned ? 0xFFFF : uibattle.itemmenu.itemSelectMenuUpdate();

  if (selectedItem != 0xFFFF) {
    if (selectedItem != 0) {
      var itemEntry = getObjectEntry(selectedItem);
      var itemFlags = itemEntry && itemEntry.item ? itemEntry.item.flags : 0;
      var applyAll = itemFlags & ItemFlag.ApplyToAll;
      var updates: any = {
        actionType: BattleActionType.UseItem,
        objectID: selectedItem,
        state: applyAll ? BattleUIState.SelectTargetPlayerAll : BattleUIState.SelectTargetPlayer
      };
      if (!applyAll) {
        updates.selectedIndex = 0;
      }
      setUI(updates);
    } else {
      setUIProp('menuState', BattleMenuState.Main);
    }
  }
};

/**
 * Throw an item in the battle UI.
 */
uibattle.throwItem = function() {
  var selectedItem = battleCommandRuntime.owned ? 0xFFFF : uibattle.itemmenu.itemSelectMenuUpdate();

  if (selectedItem != 0xFFFF) {
    if (selectedItem != 0) {
      var itemEntry = getObjectEntry(selectedItem);
      var itemFlags = itemEntry && itemEntry.item ? itemEntry.item.flags : 0;
      var applyAll = itemFlags & ItemFlag.ApplyToAll;
      var updates: any = {
        actionType: BattleActionType.ThrowItem,
        objectID: selectedItem,
        state: applyAll ? BattleUIState.SelectTargetEnemyAll : BattleUIState.SelectTargetEnemy
      };
      if (!applyAll) {
        updates.selectedIndex = 0; // as in SDLPAL
      }
      setUI(updates);
    } else {
      setUIProp('menuState', BattleMenuState.Main);
    }
  }
};

/**
 * Pick a magic for the specified player for automatic usage.
 * @param  {Number} playerRole  the player role ID.
 * @param  {Number} randomRange the range of the magic power.
 * @return {Number}             The object ID of the selected magic. 0 for physical attack.
 */
uibattle.pickAutoMagic = function(playerRole: any, randomRange: any) {
  var maxPower = 0;
  if (playerHasStatus(playerRole, PlayerStatus.Silence)) {
    return 0;
  }

  var magic = 0;
  for (var i = 0; i < Const.MAX_PLAYER_MAGICS; i++) {
    var w = getPlayerMagicSlot(i, playerRole);
    if (!w) {
      continue;
    }

    var magicObject = getObjectEntry(w);
    var magicMeta = magicObject && magicObject.magic;
    if (!magicMeta) {
      continue;
    }

    var magicEntry: any = getMagicEntry(magicMeta.magicNumber);
    if (!magicEntry) {
      continue;
    }

    // skip if the magic is an ultimate move or not enough MP
    if (magicEntry.costMP == 1 ||
        magicEntry.costMP > getPlayerMP(playerRole) ||
        SHORT(magicEntry.baseDamage) <= 0) {
      continue;
    }

    const roll = typeof randomLong === 'function' ? randomLong(0, randomRange) : 0;
    var power = SHORT(magicEntry.baseDamage) + roll;

    if (power > maxPower) {
      maxPower = power
      magic = w;
    }
  }

  return magic;
};

/**
 * Update the status of battle UI.
 */
function commandKeyPressed(key: number, policyKey = 0) {
  return battleCommandRuntime.owned ? key === Key.Force && !!(policyKey & Key.Force) : input.isKeyPressed(key);
}

uibattle.update = function*(policyKey = 0) {
  const keyPressed = (key: number) => commandKeyPressed(key, policyKey);
  uibattle.frame++;
  if (uibattle._pendingStateMutation) {
    uibattle.lastStateMutation = uibattle._pendingStateMutation;
    uibattle._pendingStateMutation = null;
  }
  if (getAutoAttack() && !getAutoBattle()) {
    if (commandKeyPressed(Key.Menu)) {
      setUIProp('autoAttack', false);
    } else {
      uibattle.ui.drawText(
        uibattle.ui.getWord(BATTLEUI_LABEL_AUTO),
        PAL_XY(280, 10),
        uibattle.ui.MENUITEM_COLOR_CONFIRMED,
        true,
        false
      );
    }
  }

  if (getAutoBattle()) {
    if (BATTLE().phase == BattlePhase.SelectAction && !BATTLE().enemyCleared) {
      uibattle.battle.playerCheckReady();

      var maxPartyMemberIndex = getMaxPartyMemberIndex();
      if (maxPartyMemberIndex >= 0) {
        for (var i = 0; i <= maxPartyMemberIndex; i++) {
          var playerState = BATTLE().player[i];
          if (playerState && playerState.state == FighterState.Com) {
            uibattle.playerReady(i);
            break;
          }
        }
      }

      if (getUIProp('state', BattleUIState.Wait) != BattleUIState.Wait) {
        var currentPartyEntry = getCurrentPartyEntry();
        if (!currentPartyEntry) {
          return end();
        }
        var playerRole = currentPartyEntry.playerRole;
        var playerHP = getPlayerHP(playerRole);
        var updates: any = null;

        if (playerHP == 0 && playerHasStatus(playerRole, PlayerStatus.Puppet)) {
          var puppetTarget = uibattle.battle.selectAutoTarget();
          updates = {
            actionType: BattleActionType.Attack,
            objectID: 0,
            selectedIndex: script.playerCanAttackAll(playerRole) ? -1 : (puppetTarget < 0 ? -1 : puppetTarget)
          };
        } else if (playerHP == 0 ||
                   playerHasStatus(playerRole, PlayerStatus.Sleep) ||
                   playerHasStatus(playerRole, PlayerStatus.Paralyzed)) {
          updates = {
            actionType: BattleActionType.Pass,
            objectID: 0,
            selectedIndex: -1
          };
        } else if (playerHasStatus(playerRole, PlayerStatus.Confused)) {
          updates = {
            actionType: BattleActionType.AttackMate,
            objectID: 0,
            selectedIndex: -1
          };
        } else {
          var magicObject = uibattle.pickAutoMagic(playerRole, 9999);
          var targetIndex = -1;

          if (magicObject !== 0) {
            var magicObjectEntry = getObjectEntry(magicObject);
            var magicFlags = magicObjectEntry && magicObjectEntry.magic
              ? magicObjectEntry.magic.flags
              : 0;
            if (magicFlags & MagicFlag.ApplyToAll) {
              targetIndex = -1;
            } else {
              targetIndex = uibattle.battle.selectAutoTarget();
              if (targetIndex < 0) {
                magicObject = 0;
              }
            }
          }

          if (magicObject === 0) {
            targetIndex = uibattle.battle.selectAutoTarget();
            if (targetIndex < 0) {
              updates = {
                actionType: BattleActionType.Pass,
                selectedIndex: -1,
                objectID: 0
              };
            } else {
              updates = {
                actionType: BattleActionType.Attack,
                selectedIndex: targetIndex,
                objectID: 0
              };
            }
          } else {
            updates = {
              actionType: BattleActionType.Magic,
              objectID: magicObject,
              selectedIndex: (magicObjectEntry && magicObjectEntry.magic && (magicObjectEntry.magic.flags & MagicFlag.ApplyToAll))
                ? -1
                : targetIndex
            };
          }
        }

        if (updates) {
          setUI(updates);
          uibattle.battle.commitAction(false);
        }
      }
    }

    return end();
  }

  if (keyPressed(Key.Auto)) {
    setUI({
      autoAttack: !getAutoAttack(),
      menuState: BattleMenuState.Main
    });
  }

  if (BATTLE().phase == BattlePhase.PerformAction) {
    return end();
  }

  if (!getAutoAttack()) {
    // Draw the player info boxes.
    var maxPartyMemberIndex = getMaxPartyMemberIndex();
    if (maxPartyMemberIndex >= 0) {
      for (var i = 0; i <= maxPartyMemberIndex; i++) {
        var partyEntry = getPartyMember(i);
        if (!partyEntry) {
          continue;
        }
        var playerRole = partyEntry.playerRole;
        var playerState = BATTLE().player[i];
        var w = playerState ? WORD(playerState.timeMeter) : 0;
        var j = uibattle.TIMEMETER_COLOR_DEFAULT;

        if (playerHasStatus(playerRole, PlayerStatus.Sleep) ||
            playerHasStatus(playerRole, PlayerStatus.Confused) ||
            playerHasStatus(playerRole, PlayerStatus.Puppet)) {
          w = 0;
        }
        uibattle.playerInfoBox(PAL_XY(91 + 77 * i, 165), playerRole, w, j, false);
      }
    }
  }

  if (input.isKeyPressed(Key.Status)) {
    yield (uigame as any).playerStatus();
    return end();
  }

  var uiStateValue = getUIProp('state', BattleUIState.Wait);
  if (uiStateValue != BattleUIState.Wait) {
    var currentEntry = getCurrentPartyEntry();
    if (!currentEntry) {
      return end();
    }
    var playerRole = currentEntry.playerRole;

    var currentHP = getPlayerHP(playerRole);
    if (currentHP == 0 && playerHasStatus(playerRole, PlayerStatus.Puppet)) {
      setUI({
        actionType: BattleActionType.Attack,
        selectedIndex: script.playerCanAttackAll(playerRole)
          ? -1
          : uibattle.battle.selectAutoTarget()
      });
      uibattle.battle.commitAction(false);
      return end(); // don't go further
    }

    if (currentHP == 0 ||
        playerHasStatus(playerRole, PlayerStatus.Sleep) ||
        playerHasStatus(playerRole, PlayerStatus.Paralyzed)) {
      setUIProp('actionType', BattleActionType.Pass);
      uibattle.battle.commitAction(false);
      return end(); // don't go further
    }

    if (playerHasStatus(playerRole, PlayerStatus.Confused)) {
      setUIProp('actionType', BattleActionType.AttackMate);
      uibattle.battle.commitAction(false);
      return end(); // don't go further
    }

    if (getAutoAttack()) {
      setUI({
        actionType: BattleActionType.Attack,
        selectedIndex: script.playerCanAttackAll(playerRole)
          ? -1
          : uibattle.battle.selectAutoTarget()
      });
      uibattle.battle.commitAction(false);
      return end(); // don't go further
    }

    var arrowSprite = (uibattle.frame & 1) ? SPRITENUM_BATTLE_ARROW_CURRENTPLAYER : SPRITENUM_BATTLE_ARROW_CURRENTPLAYER_RED;
    var currentIndex = getCurrentPlayerIndex();
    var maxPartyMemberIndexForArrow = getMaxPartyMemberIndex();
    var positions = uibattle.battle.playerPos[maxPartyMemberIndexForArrow] || [];
    var position = positions[currentIndex];
    if (position) {
      var x = position[0] - 8;
      var y = position[1] - 74;
      uibattle.surface.blitRLE(uibattle.ui.sprite.getFrame(arrowSprite), PAL_XY(x, y));
    }
  }

  switch (uiStateValue) {
    case BattleUIState.Wait:
      if (!BATTLE().enemyCleared) {
        uibattle.battle.playerCheckReady();

        var readyIndex = -1;
        var waitingMaxIndex = getMaxPartyMemberIndex();
        if (waitingMaxIndex >= 0) {
          for (var waitIdx = 0; waitIdx <= waitingMaxIndex; waitIdx++) {
            var waitPlayerState = BATTLE().player[waitIdx];
            if (waitPlayerState && waitPlayerState.state == FighterState.Com) {
              readyIndex = waitIdx;
              break;
            }
          }
        }

        if (readyIndex < 0) {
          readyIndex = promoteFirstWaitingPlayer();
        }

        if (readyIndex >= 0 && isPlayerAvailable(readyIndex)) {
          uibattle.playerReady(readyIndex);
        }
      }
      break;

    case BattleUIState.SelectMove: {
      // Draw the icons
      var currentEntry = getCurrentPartyEntry();
      if (!currentEntry) {
        break;
      }
      var playerRole = currentEntry.playerRole;
      var items = [
        { spriteNum: SPRITENUM_BATTLEICON_ATTACK,    pos: PAL_XY(27, 140), action: BattleUIAction.Attack },
        { spriteNum: SPRITENUM_BATTLEICON_MAGIC,     pos: PAL_XY(0, 155),  action: BattleUIAction.Magic },
        { spriteNum: SPRITENUM_BATTLEICON_COOPMAGIC, pos: PAL_XY(54, 155), action: BattleUIAction.CoopMagic },
        { spriteNum: SPRITENUM_BATTLEICON_MISCMENU,  pos: PAL_XY(27, 170), action: BattleUIAction.Misc }
      ];

      var menuState = getUIProp('menuState', BattleMenuState.Main);
      if (menuState == BattleMenuState.Main) {
        var nextAction = null;
        if (input.dir == Direction.North) {
          nextAction = 0;
        } else if (input.dir == Direction.South) {
          nextAction = 3;
        } else if (input.dir == Direction.West) {
          nextAction = 1;
        } else if (input.dir == Direction.East) {
          nextAction = 2;
        }
        if (nextAction !== null && uibattle.isActionValid(items[nextAction].action)) {
          setUIProp('selectedAction', nextAction);
        }
      }

      var selectedAction = getUIProp('selectedAction', 0);
      if (!uibattle.isActionValid(items[selectedAction].action)) {
        setUIProp('selectedAction', 0);
        selectedAction = 0;
      }

      for (var i = 0; i < 4; i++) {
        if (selectedAction == i) {
           uibattle.surface.blitRLE(uibattle.ui.sprite.getFrame(items[i].spriteNum), items[i].pos);
        } else if (uibattle.isActionValid(items[i].action)) {
           uibattle.surface.blitRLEMonoColor(uibattle.ui.sprite.getFrame(items[i].spriteNum), items[i].pos, 0, -4);
        } else {
           uibattle.surface.blitRLEMonoColor(uibattle.ui.sprite.getFrame(items[i].spriteNum), items[i].pos, 0x10, -4);
        }
      }

      menuState = getUIProp('menuState', BattleMenuState.Main);
      switch (menuState) {
        case BattleMenuState.Main:
          if (keyPressed(Key.Search)) {
            selectedAction = getUIProp('selectedAction', 0);
            switch (selectedAction) {
              case 0:
                // Attack
                if (script.playerCanAttackAll(playerRole)) {
                  setUI({
                    actionType: BattleActionType.Attack,
                    state: BattleUIState.SelectTargetEnemyAll
                  });
                } else {
                  setUI({
                    actionType: BattleActionType.Attack,
                    selectedIndex: 0, // SDLPAL resets it to 0 after reading iPrevEnemyTarget
                    state: BattleUIState.SelectTargetEnemy
                  });
                }
                break;

              case 1:
                // Magic
                setUIProp('menuState', BattleMenuState.MagicSelect);
                uibattle.magicmenu.magicSelectMenuInit(playerRole, true, 0);
                break;

              case 2:
                // Cooperative magic
                var w = playerRole;
                w = script.getPlayerCooperativeMagic(w);

                var coopObject = getObjectEntry(w);
                var coopFlags = coopObject && coopObject.magic ? coopObject.magic.flags : 0;
                var coopUpdates: any = {
                  actionType: BattleActionType.CoopMagic,
                  objectID: w
                };
                if (coopFlags & MagicFlag.UsableToEnemy) {
                  if (coopFlags & MagicFlag.ApplyToAll) {
                    coopUpdates.state = BattleUIState.SelectTargetEnemyAll;
                  } else {
                    coopUpdates.state = BattleUIState.SelectTargetEnemy;
                    coopUpdates.selectedIndex = 0; // as in SDLPAL
                  }
                } else {
                  if (coopFlags & MagicFlag.ApplyToAll) {
                    coopUpdates.state = BattleUIState.SelectTargetPlayerAll;
                  } else {
                    coopUpdates.state = BattleUIState.SelectTargetPlayer;
                    coopUpdates.selectedIndex = 0;
                  }
                }
                setUI(coopUpdates);
                break;

              case 3:
                // Misc menu
                // SDLPAL keeps the previous misc menu cursor here.
                setUIProp('menuState', BattleMenuState.Misc);
                break;
            }
          } else if (keyPressed(Key.Defend)) {
            setUIProp('actionType', BattleActionType.Defend);
            uibattle.battle.commitAction(false);
          } else if (keyPressed(Key.Force)) {
            var forceMagic = uibattle.pickAutoMagic(playerRole, 60);

            if (forceMagic == 0) {
              setUI({
                actionType: BattleActionType.Attack,
                selectedIndex: script.playerCanAttackAll(playerRole)
                  ? -1
                  : uibattle.battle.selectAutoTarget()
              });
            } else {
              var forceObject = getObjectEntry(forceMagic);
              var forceFlags = forceObject && forceObject.magic ? forceObject.magic.flags : 0;
              setUI({
                actionType: BattleActionType.Magic,
                objectID: forceMagic,
                selectedIndex: (forceFlags & MagicFlag.ApplyToAll)
                  ? -1
                  : uibattle.battle.selectAutoTarget()
              });
            }

            uibattle.battle.commitAction(false);
          } else if (keyPressed(Key.Flee)) {
            setUIProp('actionType', BattleActionType.Flee);
            uibattle.battle.commitAction(false);
          } else if (keyPressed(Key.UseItem)) {
            setUIProp('menuState', BattleMenuState.UseItemSelect);
            uibattle.itemmenu.itemSelectMenuInit(ItemFlag.Usable);
          } else if (keyPressed(Key.ThrowItem)) {
            setUIProp('menuState', BattleMenuState.ThrowItemSelect);
            uibattle.itemmenu.itemSelectMenuInit(ItemFlag.Throwable);
          } else if (keyPressed(Key.Repeat)) {
            uibattle.battle.commitAction(true);
          } else if (keyPressed(Key.Menu)) {
            var currentIndex = getCurrentPlayerIndex();
            setPlayer(currentIndex, function(player: any) {
              player.state = FighterState.Wait;
            });
            var nextIndex = currentIndex;
            if (currentIndex > 0) {
              do {
                nextIndex -= 1;
                setPlayer(nextIndex, function(player: any) {
                  player.state = FighterState.Wait;
                });

                var playerState = BATTLE().player[nextIndex];
                var action = playerState ? playerState.action : null;
                if (action && action.ActionType == BattleActionType.ThrowItem) {
                  adjustInventoryUsage(action.actionID, -1);
                } else if (action && action.ActionType == BattleActionType.UseItem) {
                  var actionObject = getObjectEntry(action.actionID);
                  if (actionObject && actionObject.item && (actionObject.item.flags & ItemFlag.Consuming)) {
                    adjustInventoryUsage(action.actionID, -1);
                  }
                }
              } while (nextIndex > 0 &&
                 isPartyMemberActionLocked(nextIndex));
            }
            setUI({
              state: BattleUIState.Wait,
              curPlayerIndex: nextIndex
            });
          }
          break;

        case BattleMenuState.MagicSelect:
          var magicSelection = battleCommandRuntime.owned ? 0xFFFF : uibattle.magicmenu.magicSelectMenuUpdate();

          if (magicSelection != 0xFFFF) {
            setUIProp('menuState', BattleMenuState.Main);

            if (magicSelection != 0) {
              var magicObjectEntry = getObjectEntry(magicSelection);
              var flags = magicObjectEntry && magicObjectEntry.magic ? magicObjectEntry.magic.flags : 0;
              var magicUpdates: any = {
                actionType: BattleActionType.Magic,
                objectID: magicSelection
              };
              if (flags & MagicFlag.UsableToEnemy) {
                if (flags & MagicFlag.ApplyToAll) {
                  magicUpdates.state = BattleUIState.SelectTargetEnemyAll;
                } else {
                  magicUpdates.state = BattleUIState.SelectTargetEnemy;
                  magicUpdates.selectedIndex = 0; // as in SDLPAL
                }
              } else {
                if (flags & MagicFlag.ApplyToAll) {
                  magicUpdates.state = BattleUIState.SelectTargetPlayerAll;
                } else {
                  magicUpdates.state = BattleUIState.SelectTargetPlayer;
                  magicUpdates.selectedIndex = 0;
                }
              }
              setUI(magicUpdates);
            }
          }
          break;

        case BattleMenuState.UseItemSelect:
          uibattle.useItem();
          break;

        case BattleMenuState.ThrowItemSelect:
          uibattle.throwItem();
          break;

        case BattleMenuState.Misc:
          var miscSelection = uibattle.miscMenuUpdate();

          if (miscSelection != 0xFFFF) {
            setUIProp('menuState', BattleMenuState.Main);

            switch (miscSelection) {
              case 2: // item
                setUIProp('menuState', BattleMenuState.MiscItemSubMenu);
                uibattle.curSubMenuItem = 0;
                break;

              case 3: // defend
                setUIProp('actionType', BattleActionType.Defend);
                uibattle.battle.commitAction(false);
                break;
              case 1: // auto
                setUIProp('autoAttack', true);
                break;

              case 4: // flee
                setUIProp('actionType', BattleActionType.Flee);
                uibattle.battle.commitAction(false);
                break;

              case 5: // status
                yield (uigame as any).playerStatus();
                break;
            }
          }
          break;

        case BattleMenuState.MiscItemSubMenu:
          var subMenuSelection = uibattle.miscItemSubMenuUpdate();

          if (subMenuSelection != 0xFFFF) {
            setUIProp('menuState', BattleMenuState.Main);

            switch (subMenuSelection) {
              case 1: // use
                setUIProp('menuState', BattleMenuState.UseItemSelect);
                uibattle.itemmenu.itemSelectMenuInit(ItemFlag.Usable);
                break;

              case 2: // throw
                setUIProp('menuState', BattleMenuState.ThrowItemSelect);
                uibattle.itemmenu.itemSelectMenuInit(ItemFlag.Throwable);
                break;
            }
          }
          break;
      }
      break;
    }

    case BattleUIState.SelectTargetEnemy: {
      var maxEnemyIndex = -1;
      var enemyCount = 0;

      for (var i = 0; i <= BATTLE().maxEnemyIndex; i++) {
        if (BATTLE().enemy[i].objectID != 0) {
          maxEnemyIndex = i;
          enemyCount++;
        }
      }

      if (maxEnemyIndex == -1) {
        setUIProp('state', BattleUIState.SelectMove);
        break;
      }

      if (getUIProp('actionType', BattleActionType.Attack) == BattleActionType.CoopMagic) {
        if (!uibattle.isActionValid(BattleUIAction.CoopMagic)) {
          setUIProp('state', BattleUIState.SelectMove);
          break;
        }
      }

      // Don't bother selecting when only 1 enemy left
      if (enemyCount == 1 && !battleCommandRuntime.owned) {
        // As in SDLPAL (PAL_CLASSIC): prevEnemyTarget is not updated here.
        var onlyIndex = getUIProp('selectedIndex', 0);
        if (onlyIndex == -1) {
          onlyIndex = maxEnemyIndex;
        } else {
          for (onlyIndex = 0; onlyIndex < Const.MAX_ENEMIES_IN_TEAM; onlyIndex++) {
            if (BATTLE().enemy[onlyIndex].objectID != 0) {
              break;
            }
          }
        }
        setUIProp('selectedIndex', onlyIndex);
        uibattle.battle.commitAction(false);
        break;
      }
      var selectedIndex = getUIProp('selectedIndex', 0);
      if (selectedIndex > maxEnemyIndex) {
        selectedIndex = maxEnemyIndex;
      } else if (selectedIndex < 0) {
        selectedIndex = 0;
      }

      for (var i = 0; i <= maxEnemyIndex; i++) {
        if (BATTLE().enemy[selectedIndex].objectID != 0) {
          break;
        }
        selectedIndex = (selectedIndex + 1) % (maxEnemyIndex + 1);
      }
      setUIProp('selectedIndex', selectedIndex);

      // Highlight the selected enemy
      if (uibattle.frame & 1) {
        var enemy = BATTLE().enemy[selectedIndex];

        var x = PAL_X(enemy.pos);
        var y = PAL_Y(enemy.pos);

        var frame = enemy.sprite.getFrame(enemy.currentFrame);
        x -= ~~(frame.width / 2);
        y -= frame.height;

        uibattle.surface.blitRLEWithColorShift(frame, PAL_XY(x, y), 7);
      }
      if (keyPressed(Key.Menu)) {
        setUIProp('state', BattleUIState.SelectMove);
      } else if (keyPressed(Key.Search)) {
        // As in SDLPAL: prevEnemyTarget is not updated on selection.
        uibattle.battle.commitAction(false);
      } else if (keyPressed(Key.Left | Key.Down)) {
        // Wraps around over all MAX_ENEMIES_IN_TEAM slots, as in SDLPAL.
        selectedIndex--;
        if (selectedIndex < 0) selectedIndex = Const.MAX_ENEMIES_IN_TEAM - 1;
        while (selectedIndex != 0 &&
               BATTLE().enemy[selectedIndex].objectID == 0) {
          selectedIndex--;
          if (selectedIndex < 0) selectedIndex = Const.MAX_ENEMIES_IN_TEAM - 1;
        }
        setUIProp('selectedIndex', selectedIndex);
      } else if (keyPressed(Key.Right | Key.Up)) {
        selectedIndex++;
        if (selectedIndex >= Const.MAX_ENEMIES_IN_TEAM) selectedIndex = 0;
        while (selectedIndex < Const.MAX_ENEMIES_IN_TEAM &&
               BATTLE().enemy[selectedIndex].objectID == 0) {
          selectedIndex++;
          if (selectedIndex >= Const.MAX_ENEMIES_IN_TEAM) selectedIndex = 0;
        }
        setUIProp('selectedIndex', selectedIndex);
      }
      break;
    }

    case BattleUIState.SelectTargetPlayer:
      // Don't bother selecting when only 1 player is in the party
      var selectPlayerMaxIndex = getMaxPartyMemberIndex();
      if (selectPlayerMaxIndex <= 0 && !battleCommandRuntime.owned) {
        setUIProp('selectedIndex', 0);
        uibattle.battle.commitAction(false);
      }

      var j = SPRITENUM_BATTLE_ARROW_SELECTEDPLAYER;
      if (uibattle.frame & 1) {
        j = SPRITENUM_BATTLE_ARROW_SELECTEDPLAYER_RED;
      }

      // Draw arrows on the selected player
      var selectedPlayerIndex = getUIProp('selectedIndex', 0);
      var playerPositions = uibattle.battle.playerPos[selectPlayerMaxIndex] || [];
      var selectedPosition = playerPositions[selectedPlayerIndex] || [0, 0];
      var x = selectedPosition[0] - 8;
      var y = selectedPosition[1] - 67;

      uibattle.surface.blitRLE(uibattle.ui.sprite.getFrame(j), PAL_XY(x, y));

      if (keyPressed(Key.Menu)) {
         setUIProp('state', BattleUIState.SelectMove);
      } else if (keyPressed(Key.Search)) {
         uibattle.battle.commitAction(false);
      } else if (keyPressed(Key.Left | Key.Down)) {
        if (selectedPlayerIndex != 0) {
          selectedPlayerIndex--;
        } else {
          selectedPlayerIndex = selectPlayerMaxIndex;
        }
        setUIProp('selectedIndex', selectedPlayerIndex);
      } else if (keyPressed(Key.Right | Key.Up)) {
        if (selectedPlayerIndex < selectPlayerMaxIndex) {
          selectedPlayerIndex++;
        } else {
          selectedPlayerIndex = 0;
        }
        setUIProp('selectedIndex', selectedPlayerIndex);
      }

      break;

    case BattleUIState.SelectTargetEnemyAll:
      // Don't bother selecting
      if (!battleCommandRuntime.owned) {
        setUIProp('selectedIndex', -1);
        uibattle.battle.commitAction(false);
        break; // Already committed: do not consume Search again in this frame.
      }
      if (getUIProp('actionType', BattleActionType.Attack) == BattleActionType.CoopMagic) {
        if (!uibattle.isActionValid(BattleUIAction.CoopMagic)) {
          setUIProp('state', BattleUIState.SelectMove);
          break;
        }
      }

      if (uibattle.frame & 1) {
        // Highlight all enemies
        for (var enemyIdx = BATTLE().maxEnemyIndex; enemyIdx >= 0; enemyIdx--) {
          var enemy = BATTLE().enemy[enemyIdx];
          if (enemy.objectID == 0) {
            continue;
          }

          var x = PAL_X(enemy.pos);
          var y = PAL_Y(enemy.pos);

          var frame = enemy.sprite.getFrame(enemy.currentFrame);
          x -= ~~(frame.width / 2);
          y -= frame.height;

          uibattle.surface.blitRLEWithColorShift(frame, PAL_XY(x, y), 7);
        }
      } if (keyPressed(Key.Menu)) {
        setUIProp('state', BattleUIState.SelectMove);
      } else if (keyPressed(Key.Search)) {
        setUIProp('selectedIndex', -1);
        uibattle.battle.commitAction(false);
      }
      break;

    case BattleUIState.SelectTargetPlayerAll:
      // Don't bother selecting
      if (!battleCommandRuntime.owned) {
        setUIProp('selectedIndex', -1);
        uibattle.battle.commitAction(false);
      }
      break;
  }

  return end();

  function end() {
    // Show the text message if there is one.
    // Draw the numbers
    var showNumbers = getUIProp('showNum', []);
    for (var i = 0; i < BATTLEUI_MAX_SHOWNUM; i++) {
      var entry = showNumbers[i];
      if (entry && entry.num > 0) {
        if ((hrtime() - entry.time) / BattleFrameTime > 10) {
          mutateUI(function(uiState: any) {
            if (uiState.showNum && uiState.showNum[i]) {
              uiState.showNum[i].num = 0;
            }
          });
        } else {
          var x = PAL_X(entry.pos);
          var y = PAL_Y(entry.pos) - ~~((hrtime() - entry.time) / BattleFrameTime);
          uibattle.ui.drawNumber(
            entry.num, 5,
            PAL_XY(x, y),
            entry.color, NumAlign.Right
          );
        }
      }
    }

    input.clear();
  }
};

/**
 * Show a number on battle screen (indicates HP/MP change).
 * @param  {Number} num     number to be shown.
 * @param  {POS} pos        position of the number on the screen.
 * @param  {NumColor} color color of the number.
 */
uibattle.showNum = function(num: any, pos: any, color: any) {
  mutateUI(function(uiState: any) {
    var ss = uiState.showNum;
    if (!ss) return;
    for (var i = 0; i < ss.length; ++i) {
      var sn = ss[i];
      if (sn.num == 0) {
        sn.num = num;
        sn.pos = pos;
        sn.color = color;
        sn.time = hrtime();
        break;
      }
    }
  });
};

uibattle.dispose = function() {
  if (uibattle.battleServiceSubscription && battleService && typeof battleService.off === 'function') {
    battleService.off('stateMutated', uibattle.battleServiceSubscription);
    battleService.off('stateChanged', uibattle.battleServiceSubscription);
    uibattle.battleServiceSubscription = null;
  }
  if (typeof uibattle.battleStateUnsubscribe === 'function') {
    uibattle.battleStateUnsubscribe();
    uibattle.battleStateUnsubscribe = null;
  }
  uibattle.battleStateCache = null;
};

export default uibattle;
