/**
 * Game UI
 * @module
 * @memberOf  ui
 */

import { declareWait, updateWait, endWait, wordText, partyChoiceItems } from '../../services/wait-points';
import utils from './utils';
import RLE from './rle';
import input from './input';
import music from './music';
import resourceService from '../../services/resource-service.js';
import worldService from '../../services/world-service.js';
import scene from './scene';
import scriptObjectAdapter from '../../services/script-object-adapter.js';
import gameDataAdapter from '../../services/game-data-adapter.js';
import {
  getPlayerNameId,
  getPlayerHP,
  getPlayerMaxHP,
  getPlayerMP,
  getPlayerMaxMP,
  getPlayerLevel,
  getPlayerAttackStrength,
  getPlayerMagicStrength,
  getPlayerDefense,
  getPlayerDexterity,
  getPlayerFleeRate,
  getPlayerEquipment,
  getPlayerAvatarId,
  getMaxPartyMemberIndex as getCachedMaxPartyMemberIndex,
  getPoisonStatusMatrix as getAdapterPoisonStatusMatrix
} from '../../services/player-state-adapter.js';
import { menuSelectionSignals, audioToggleSignals } from '../../state/slices/menu-selections.js';
import { inventorySignals } from '../../state/slices/inventory.js';
import partyTrailAdapter from '../../services/party-trail-adapter.js';
import { statusSignals } from '../../state/slices/status-matrices.js';
import { audioResourceSignals } from '../../state/slices/audio-resources.js';
import { timeFlagSignals } from '../../state/slices/time-flags.js';
import { viewportSignals } from '../../state/slices/viewport.js';
import overviewController from './overview-controller.js';
import panoramaRenderer from './panorama-renderer.js';
import panoramaControls from './panorama-controls.js';
import panoramaDialog from './panorama-dialog.js';
import { Key } from '../../services/input-service';
import { ItemFlag, MagicFlag, PAL_CLASSIC } from './pal-global';
import script from '../../services/script-runner';
import itemmenu from './itemmenu';
import play from './play';
import uibattle from './uibattle';
import { globalRef } from './global-ref';
import type { UIGameModule } from './global-ref';

const global = globalRef;

const PAL_XY = global.PAL_XY;
const PAL_X = global.PAL_X;
const PAL_Y = global.PAL_Y;
const NumColor = global.NumColor;
const NumAlign = global.NumAlign;
const log = global.log;
const Files = global.Files;
const RECT = global.RECT;
const timestamp = global.timestamp || Date.now;

var ui: any = null;
var surface: any = null;
let openingMenuBackground: any = null;

type InventorySlot = {
  item?: number;
  amount?: number;
  amountInUse?: number;
};

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
    const rendererActive = panoramaRenderer && typeof panoramaRenderer.getMode === 'function'
      ? panoramaRenderer.getMode() === 'panorama'
      : false;
    state.shouldRestore = rendererActive;
    if (state.shouldRestore) {
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
    runGenerator(refreshClassicView()).catch((err) => {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[uigame] refreshClassicView failed', err);
      }
    });
  }
  state.depth += 1;
  return { shouldRestore: state.shouldRestore };
}

function exitClassicOverlay(state: any) {
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

function* refreshClassicView(): Generator<any, any, any> {
  if (scene && typeof scene.makeScene === 'function') {
    yield* scene.makeScene();
  }
  if (surface && typeof surface.updateScreen === 'function') {
    surface.updateScreen(null);
  } else if (scene && scene.surface && typeof scene.surface.updateScreen === 'function') {
    scene.surface.updateScreen();
  }
}

function getGlobalObject() {
  if (typeof global !== 'undefined') {
    return global;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  return null;
}

function getGame() {
  var root = getGlobalObject() as any;
  return root && root.game ? root.game : null;
}

function requireGame() {
  var gameInstance = getGame();
  if (!gameInstance) {
    throw new Error('PAL game module has not been initialized');
  }
  return gameInstance;
}

function getParty() {
  return partyTrailAdapter.getPartyState();
}

function getPartyMember(index: any) {
  var party = getParty();
  return party[index] || null;
}

function getPartyRole(index: any) {
  var member = getPartyMember(index);
  return member ? member.playerRole : null;
}

function getMaxPartyMemberIndex() {
  return getCachedMaxPartyMemberIndex();
}

function getCash() {
  return getCashValue();
}

// OBJECT_MAGIC 的字序(pal-global.ts:magicNumber|reserved1|scriptOnSuccess|scriptOnUse|reserved2|flags)
const MAGIC_SCRIPT_ON_SUCCESS = 2;
const MAGIC_SCRIPT_ON_USE = 3;

function getObjectEntry(objectId: any) {
  return scriptObjectAdapter.getObjectEntry(objectId) || null;
}

function getMagicEntry(magicId: any) {
  return gameDataAdapter.getMagicEntry(magicId) || null;
}

function getStoreEntry(storeId: any) {
  return gameDataAdapter.getStoreEntry(storeId) || null;
}

function getExpState() {
  return gameDataAdapter.getExpStateSnapshot();
}

function getExpEntry(roleId: any) {
  var expState: any = getExpState();
  if (expState && Array.isArray(expState.primaryExp) && expState.primaryExp[roleId]) {
    return expState.primaryExp[roleId];
  }
  return { exp: 0, level: getPlayerLevel(roleId) };
}

function getPoisonStatusMatrix() {
  return getAdapterPoisonStatusMatrix();      // 组件视图(M2 D5c)
}

function getCurrentSaveSlotValue() {
  const value = currentSaveSlotSignal.value;
  return typeof value === 'number' && value > 0 ? value : 1;
}

function getCurrentMusicTrack() {
  const value = musicTrackSignal.value;
  return typeof value === 'number' ? value : 0;
}

function shouldFadeIn() {
  return !!needToFadeInSignal.value;
}

function getPaletteIdValue() {
  const value = paletteIdSignal.value;
  return typeof value === 'number' ? value : 0;
}

function getNightPaletteFlagValue() {
  return !!nightPaletteSignal.value;
}

function getInventorySnapshot() {
  return getInventoryList();
}

function getInventorySlot(index: any) {
  return getInventorySlotFromSignal(index);
}

function getObjectItemData(objectId: any) {
  var entry = getObjectEntry(objectId);
  return entry && entry.item ? entry.item : null;
}

function getObjectFlags(objectId: any) {
  var itemData = getObjectItemData(objectId);
  return itemData && typeof itemData.flags === 'number' ? itemData.flags : 0;
}

function getObjectBitmap(objectId: any) {
  var itemData = getObjectItemData(objectId);
  return itemData && typeof itemData.bitmap === 'number' ? itemData.bitmap : 0;
}

function getObjectPrice(objectId: any) {
  var itemData = getObjectItemData(objectId);
  return itemData && typeof itemData.price === 'number' ? itemData.price : 0;
}

function setObjectScriptOnEquip(objectId: any, scriptId: any) {
  worldService.mutateObjectEntry(objectId, function(entry) {
    if (entry && entry.item) {
      entry.item.scriptOnEquip = scriptId;
    }
    return entry;
  });
}

function getLastUnequippedItem() {
  return lastUnequippedSignal.value;
}

function setLastUnequippedItem(value: any) {
  worldService.setLastUnequippedItem(value);
}

log.trace('uigame module load');

const uigame = {} as UIGameModule;

const menuSignals = menuSelectionSignals();
const mainMenuIndexSignal = menuSignals.main;
const systemMenuIndexSignal = menuSignals.system;
const inventoryMenuIndexSignal = menuSignals.inventory;

const inventorySlice = inventorySignals();
const inventoryItemsSignal = inventorySlice.items;
const cashSignal = inventorySlice.cash;
const lastUnequippedSignal = inventorySlice.lastUnequipped;

const audioSignals = audioToggleSignals();
const noMusicSignal = audioSignals.noMusic;
const noSoundSignal = audioSignals.noSound;

const statusSlice = statusSignals();
const poisonStatusSignal = statusSlice.poison;

const audioResourceSlice = audioResourceSignals();
const musicTrackSignal = audioResourceSlice.musicTrack;
const paletteIdSignal = audioResourceSlice.paletteId;
const nightPaletteSignal = audioResourceSlice.nightPalette;

const timeFlagsSlice = timeFlagSignals();
const needToFadeInSignal = timeFlagsSlice.needToFadeIn;

const viewportSlice = viewportSignals();
const currentSaveSlotSignal = viewportSlice.currentSaveSlot;

function getMainMenuIndexValue() {
  return mainMenuIndexSignal.value;
}

function getSystemMenuIndexValue() {
  return systemMenuIndexSignal.value;
}

function getInventoryMenuIndexValue() {
  return inventoryMenuIndexSignal.value;
}

function getInventoryList() {
  const items = inventoryItemsSignal.value as any;
  if (Array.isArray(items)) {
    return items;
  }
  if (items && typeof items.length === 'number') {
    return Array.from(items) as InventorySlot[];
  }
  return [] as InventorySlot[];
}

function getInventorySlotFromSignal(index: any) {
  const items = getInventoryList();
  return (index >= 0 && index < items.length) ? items[index] : null;
}

function getCashValue() {
  const value = cashSignal.value;
  return typeof value === 'number' ? value : 0;
}

function isMusicDisabled() {
  return !!noMusicSignal.value;
}

function isSoundDisabled() {
  return !!noSoundSignal.value;
}

var resolveResource = function() {
  if (ui && ui.services && ui.services.resource) {
    return ui.services.resource;
  }
  return resourceService;
};

function* waitForMenuInputReady(frames = 2): Generator<any, any, any> {
  let stable = 0;
  input.clear();
  while (stable < frames) {
    if (!input.keyPress) {
      stable += 1;
    } else {
      stable = 0;
      input.clear();
    }
    yield sleepByFrame(1);
  }
  input.clear();
}

uigame.init = function*(surf: any, _ui: any): Generator<any, any, any> {
  log.debug('[UI] init uigame');
  ui = _ui;
  // itemmenu is imported
  global.uigame = ui.uigame = uigame;
  surface = surf;
};

/**
 * Reset opening menu background cache
 * Called when starting a new game to force background reload
 */
uigame.resetOpeningMenuBackground = function() {
  console.log('[UIGAME] Resetting opening menu background cache');
  openingMenuBackground = null;

  // Also clear the MKF chunk cache for the menu background bitmap
  // This ensures that when drawOpeningMenuBackground is called next time,
  // it will reload from the current save's FBP data, not use cached chunk
  if (Files && Files.FBP && Files.FBP._decompressedChunks) {
    const chunkNum = ui.MAINMENU_BACKGROUND_FBPNUM;
    if (Files.FBP._decompressedChunks[chunkNum]) {
      console.log('[UIGAME] Clearing FBP chunk cache for menu background', chunkNum);
      Files.FBP._decompressedChunks[chunkNum] = null;
    }
  }
};

/**
 * 绘制开场菜单背景
 */
uigame.drawOpeningMenuBackground = function*(): Generator<any, any, any> {
  var resource = resolveResource();
  yield resource.loadMKF('FBP', 'PAT');
  var bitmap = resource.getMKF('FBP').decompressChunk(ui.MAINMENU_BACKGROUND_FBPNUM);
  openingMenuBackground = bitmap;
  console.log('[UIGAME] Opening menu background loaded and cached');
  surface.blit(bitmap);
  yield surface.fadeIn(0, false, 1);
};

function redrawOpeningMenuBackground() {
  if (!openingMenuBackground || !surface) {
    return;
  }
  surface.blit(openingMenuBackground);
  surface.updateScreen(null);
}

/**
 * 开场菜单
 * @return {Promise}
 */
function suspendPanorama(flag: any) {
  if (typeof window !== 'undefined' && window.PAL_OVERLAY_PREFERENCE) {
    window.PAL_OVERLAY_SUSPENDED = flag;
  }
  const services = global && (global as any).services ? (global as any).services : null;
  const overview = services && services.overview ? services.overview : overviewController;
  const panorama = services && services.panorama ? services.panorama : panoramaRenderer;
  const controls = services && services.panoramaControls ? services.panoramaControls : panoramaControls;
  if (flag) {
    if (overview && typeof overview.setMode === 'function') overview.setMode('off');
    if (panorama && typeof panorama.setMode === 'function') panorama.setMode('off');
    if (controls && typeof controls.setMode === 'function') controls.setMode('off');
  } else {
    const pref = (typeof window !== 'undefined' && window.PAL_OVERLAY_PREFERENCE) || 'off';
    if (overview && typeof overview.setMode === 'function') overview.setMode(pref);
    if (panorama && typeof panorama.setMode === 'function') panorama.setMode(pref);
    if (controls && typeof controls.setMode === 'function') controls.setMode(pref);
  }
}

uigame.openingMenu = function*(): Generator<any, any, any> {
  suspendPanorama(true);
  music.play(ui.RIX_NUM_OPENINGMENU, true, 1);
  yield uigame.drawOpeningMenuBackground();
  surface.backupScreen();
  yield* waitForMenuInputReady();

  var menu = [
    //              value label                       enabled position
    new ui.MenuItem(0,    ui.MAINMENU_LABEL_NEWGAME,  true,   PAL_XY(125, 95)),
    new ui.MenuItem(1,    ui.MAINMENU_LABEL_LOADGAME, true,   PAL_XY(125, 112))
  ];
  // As in SDLPAL PAL_OpeningMenu: loop until a choice is made. Esc on the main menu starts a
  // new game; cancelling the slot list (which always opens on slot 1) returns to the main menu.
  while (true) {
    var uimenu = yield ui.readMenu(null, menu, 0, ui.MENUITEM_COLOR);
    if (uimenu === 0 || uimenu === ui.MENUITEM_VALUE_CANCELLED) {
      redrawOpeningMenuBackground();
      suspendPanorama(false);
      return 0;
    }
    surface.backupScreen();
    var slmenu = yield uigame.saveSlotMenu(1);
    surface.restoreScreen();
    surface.updateScreen(null);
    if (slmenu !== ui.MENUITEM_VALUE_CANCELLED) {
      redrawOpeningMenuBackground();
      suspendPanorama(false);
      return slmenu;
    }
  }
};

/**
 * 存档菜单
 * @return {Promise}
 */
uigame.saveSlotMenu = function*(defaultSlot: any): Generator<any, any, any> {
  suspendPanorama(true);
  try {
  // Keep original 5 save slots
  const numSlots = 5;
  var boxes = [],
      menu = [],
      rect = new RECT(195, 7, 120, 190);
  var uimenu, numbers = [];

  // Create the boxes and create the menu items
  for (var i = 0; i < numSlots; i++) {
    // SDLPAL does not save these ("fix render problem with shadow"): the
    // boxes overlap each other's shadow, so restoring them in order would
    // bring old shadow pixels back.
    boxes[i] = ui.createSingleLineBox(PAL_XY(195, 7 + 38 * i), 6, false);
    menu[i] = new ui.MenuItem(
      i + 1,                            // value
      ui.LOADMENU_LABEL_SLOT_FIRST + i, // word 43-47 (进度一 to 进度五)
      true,                             // enabled
      PAL_XY(210, 17 + 38 * i)          // pos
    );
  }

  // Draw the numbers of saved times
  for (var i = 1; i <= numSlots; i++) {
    var gameInstance = getGame();
    var meta = (gameInstance && typeof gameInstance.getSaveSlotMeta === 'function') ? gameInstance.getSaveSlotMeta(i) : null;
    var savedTimes = meta && meta.savedTimes ? meta.savedTimes : 0;
    ui.drawNumber(savedTimes, 4, PAL_XY(270, 38 * i - 17), NumColor.Yellow, NumAlign.Right);
  }

  surface.updateScreen(null);

  // Activate the menu
  var defaultIndex = typeof defaultSlot === 'number' ? (defaultSlot - 1) : 0;
  if (defaultIndex < 0) defaultIndex = 0;
  if (defaultIndex >= menu.length) defaultIndex = menu.length - 1;
  yield* waitForMenuInputReady();
  var slot = yield ui.readMenu(null, menu, defaultIndex, ui.MENUITEM_COLOR);

  // Delete the boxes
  for (var i=0; i<numSlots; ++i) {
    boxes[i].free();
  }

    surface.updateScreen(null);
    return slot;
  } finally {
    suspendPanorama(false);
  }
};

/**
 * 确认菜单
 * @return {Promise}
 */
uigame.confirmMenu = function*(): Generator<any, any, any> {
  suspendPanorama(true);
  try {
  var boxes = [];

  // Create menu items
  var items = [
    new ui.MenuItem(0, ui.CONFIRMMENU_LABEL_NO,  true, PAL_XY(145, 110)),
    new ui.MenuItem(1, ui.CONFIRMMENU_LABEL_YES, true, PAL_XY(220, 110))
  ];
  // Create the boxes
  for (var i =0; i<2; ++i) {
    boxes[i] = ui.createSingleLineBox(PAL_XY(130 + 75 * i, 100), 2, true);
  }

  var menu = yield ui.readMenu(null, items, 0, ui.MENUITEM_COLOR);

  // Delete the boxes
  for (var i=0; i<boxes.length; ++i) {
    boxes[i].free();
  }

  surface.updateScreen();

    if (menu === ui.MENUITEM_VALUE_CANCELLED || menu === 0) {
      return false;
    } else {
      return true;
    }
  } finally {
    suspendPanorama(false);
  }
};

/**
 * 开关菜单
 * @param  {Boolean} enabled
 * @return {Promise}
 */
uigame.switchMenu = function*(enabled: any): Generator<any, any, any> {
  suspendPanorama(true);
  try {
  var boxes = [];

  // Create menu items
  var items = [
    new ui.MenuItem(0, ui.SWITCHMENU_LABEL_DISABLE, true, PAL_XY(145, 110)),
    new ui.MenuItem(1, ui.SWITCHMENU_LABEL_ENABLE,  true, PAL_XY(220, 110))
  ];

  // Create the boxes
  for (var i =0; i<2; ++i) {
    boxes[i] = ui.createSingleLineBox(PAL_XY(130 + 75 * i, 100), 2, true);
  }

  // The cursor starts on the current setting (SDLPAL: fEnabled ? 1 : 0), so confirming
  // straight away keeps it unchanged.
  var menu = yield ui.readMenu(null, items, enabled ? 1 : 0, ui.MENUITEM_COLOR);

  // Delete the boxes
  for (var i=0; i<boxes.length; ++i) {
    boxes[i].free();
  }

  //surface.updateScreen(); // box.free调用surface.putRect已经更新了屏幕

    if (menu === ui.MENUITEM_VALUE_CANCELLED) {
      return enabled;
    } else {
      return (menu === 0 ? false : true);
    }
  } finally {
    suspendPanorama(false);
  }
};

/**
 * 战斗速度菜单
 * @return {Promise}
 */
uigame.battleSpeedMenu = function*(): Generator<any, any, any> {
  // Create menu items
  var items = [
    new ui.MenuItem(1, ui.BATTLESPEEDMENU_LABEL_1, true, PAL_XY(145, 110)),
    new ui.MenuItem(2, ui.BATTLESPEEDMENU_LABEL_2, true, PAL_XY(170, 110)),
    new ui.MenuItem(3, ui.BATTLESPEEDMENU_LABEL_3, true, PAL_XY(195, 110)),
    new ui.MenuItem(4, ui.BATTLESPEEDMENU_LABEL_4, true, PAL_XY(220, 110)),
    new ui.MenuItem(5, ui.BATTLESPEEDMENU_LABEL_5, true, PAL_XY(245, 110))
  ];

  var box = ui.createSingleLineBox(PAL_XY(131, 100), 8, true)

  var menu = yield ui.readMenu(null, items, 0, ui.MENUITEM_COLOR);

  // Delete the boxes
  box.free();

  surface.updateScreen(null);

  if (menu === ui.MENUITEM_VALUE_CANCELLED) {
    return false;
  } else {
    return menu;
  }
};

/**
 * 显示金钱
 * @param  {Number} cash
 * @return {Box}
 */
uigame.showCash = function(cash: any) {
  // Create the box.
  var box = ui.createSingleLineBox(PAL_XY(0, 0), 5, true)

  // Draw the text label.
  ui.drawText(
    ui.getWord(ui.CASH_LABEL),
    PAL_XY(10, 10), 0, false, false
  );

  // Draw the cash amount.
  ui.drawNumber(cash, 6, PAL_XY(49, 14), NumColor.Yellow, NumAlign.Right);

  return box;
};

uigame.systemMenu_onItemChange = function(currentItem: any) {
  worldService.setSystemMenuIndex(currentItem - 1);
};

/**
 * 系统菜单
 * @return {Promise}
 */
uigame.systemMenu = function*(): Generator<any, any, any> {
  const overlayToken = enterClassicOverlay();
  try {
    yield* refreshClassicView();
  // Create menu items
  var menuitems = [];
  if (PAL_CLASSIC) {
    menuitems = [
      new ui.MenuItem(1, ui.SYSMENU_LABEL_SAVE,  true, PAL_XY(53, 72)),
      new ui.MenuItem(2, ui.SYSMENU_LABEL_LOAD,  true, PAL_XY(53, 72 + 18)),
      new ui.MenuItem(3, ui.SYSMENU_LABEL_MUSIC, true, PAL_XY(53, 72 + 36)),
      new ui.MenuItem(4, ui.SYSMENU_LABEL_SOUND, true, PAL_XY(53, 72 + 54)),
      new ui.MenuItem(5, ui.SYSMENU_LABEL_QUIT,  true, PAL_XY(53, 72 + 72))
    ];
  } else {
    menuitems = [
      new ui.MenuItem(1, ui.SYSMENU_LABEL_SAVE,  true, PAL_XY(53, 72)),
      new ui.MenuItem(2, ui.SYSMENU_LABEL_LOAD,  true, PAL_XY(53, 72 + 18)),
      new ui.MenuItem(3, ui.SYSMENU_LABEL_MUSIC, true, PAL_XY(53, 72 + 36)),
      new ui.MenuItem(4, ui.SYSMENU_LABEL_SOUND, true, PAL_XY(53, 72 + 54)),
      new ui.MenuItem(5, ui.SYSMENU_LABEL_BATTLEMODE, true, PAL_XY(53, 72 + 72)),
      new ui.MenuItem(6, ui.SYSMENU_LABEL_QUIT,  true, PAL_XY(53, 72 + 90))
    ];
  }

  // Create the menu box.
  var box;
  if (PAL_CLASSIC) {
    box = ui.createBox(PAL_XY(40, 60), 4, 3, 0, true);
  } else {
    box = ui.createBox(PAL_XY(40, 60), 5, 3, 0, true);
  }
  var rect = new RECT(40, 60, 100, 135);
  surface.updateScreen(null);

  // Perform the menu.
  var curSystemMenuItem = getSystemMenuIndexValue();
  if (typeof curSystemMenuItem !== 'number') {
    curSystemMenuItem = 0;
  }
  var returnValue = yield ui.readMenu(
    uigame.systemMenu_onItemChange,
    menuitems,
    curSystemMenuItem,
    ui.MENUITEM_COLOR
  );

  if (returnValue == ui.MENUITEM_VALUE_CANCELLED) {
    // User cancelled the menu
    box.free();
    surface.updateScreen(null);
    return false;
  }

  var quit = function*(): Generator<any, any, any> {
    if ((yield uigame.confirmMenu()) as any) {
      music.play(0, false, 2);
      yield surface.fadeOut(2);
      var gameInstance = getGame();
      if (gameInstance && typeof gameInstance.shutdown === 'function') {
        gameInstance.shutdown();
      }
    }
  };
  switch(returnValue) {
    case 1:
      // Save Game
      var slot = yield uigame.saveSlotMenu(getCurrentSaveSlotValue());
      if (slot != ui.MENUITEM_VALUE_CANCELLED) {
        var gameInstance = requireGame();
        worldService.setCurrentSaveSlot(slot);
        if (!gameInstance.saveGame(slot)) {
          if (typeof window !== 'undefined' && window.alert) {
            window.alert('保存失败');
          }
        }
      }
      break;
    case 2:
      // Load Game
      var slot = yield uigame.saveSlotMenu(getCurrentSaveSlotValue());
      if (slot != ui.MENUITEM_VALUE_CANCELLED) {
        music.play(0, false, 1);
        yield surface.fadeOut(1);
        yield requireGame().initGameData(slot);
      }
      break;
    case 3:
      // Music
      var currentNoMusic = isMusicDisabled();
      const noMusic = !(yield uigame.switchMenu(!currentNoMusic));
      worldService.setNoMusicFlag(noMusic);
      // Apply it now: the flag used to be stored and never read, so music kept playing.
      if (noMusic) {
        music.stop();
      } else {
        music.play(worldService.getMusicTrack(), true, 0);
      }
      /*
      g_fNoMusic = !PAL_SwitchMenu(!g_fNoMusic);
      #ifdef PAL_HAS_NATIVEMIDI
      if (g_fUseMidi)
      {
         if (g_fNoMusic)
         {
            PAL_PlayMUS(0, false, 0);
         }
         else
         {
            PAL_PlayMUS(getCurrentMusicTrack(), true, 0);
         }
      }
      #endif
      */
      break;
    case 4:
      // Sound
      var currentNoSound = isSoundDisabled();
      const noSound = !(yield uigame.switchMenu(!currentNoSound));
      worldService.setNoSoundFlag(noSound);
      break;
    case 5:
      if (!PAL_CLASSIC) {
        // Battle Mode
        yield uigame.battleSpeedMenu();
      } else {
        // Quit
        yield quit();
      }
      break;
    case 6:
      // Quit
      yield quit();
      break;
  }
  box.free();
  return true;
  } finally {
    exitClassicOverlay(overlayToken);
  }
};

let inGameMagicMenuLastCaster = 0;

uigame.inGameMagicMenu = function*(): Generator<any, any, any> {
  const overlayToken = enterClassicOverlay();
  try {
    yield* refreshClassicView();
  var rect = new RECT(35, 62, 95, 90);
  var y = 45;
  var party = getParty();
  var maxPartyMemberIndex = getMaxPartyMemberIndex();
  var w;

  // SDLPAL PAL_InGameMagicMenu: a single-member party skips the caster
  // selection; otherwise the last chosen caster is remembered (static w).
  if (maxPartyMemberIndex == 0) {
    w = inGameMagicMenuLastCaster = 0;
  } else {
  // Draw the player info boxes
  for (var i = 0; i <= maxPartyMemberIndex; i++) {
   const role = getPartyRole(i);
   if (role == null) {
     continue;
   }
   uibattle.playerInfoBox(
     PAL_XY(y, 165),
     role,
     100,
     ui.TIMEMETER_COLOR_DEFAULT,
     true
   );
   y += 78;
  }

  y = 75;

  var menuitems = [];
  // Generate one menu items for each player in the party
  for (var i = 0; i <= maxPartyMemberIndex; i++) {
    if (i > Const.MAX_PLAYERS_IN_PARTY) {
      throw 'max players in party exceeded';
    }
    var roleId = getPartyRole(i);
    var roleNameId = getPlayerNameId(roleId);
    var roleHP = getPlayerHP(roleId);
    menuitems.push(new ui.MenuItem(
      i,
      roleNameId,
      roleHP > 0,
      PAL_XY(48, y)
    ));
    y += 18;
  }

  // Draw the box
  var box = ui.createBox(
    PAL_XY(35, 62),
    maxPartyMemberIndex,
    2,
    0,
  false);
  surface.updateScreen(null);

  if (inGameMagicMenuLastCaster > maxPartyMemberIndex) {
    inGameMagicMenuLastCaster = 0;
  }
  w = yield ui.readMenu(null, menuitems, inGameMagicMenuLastCaster, ui.MENUITEM_COLOR);
  inGameMagicMenuLastCaster = (w == ui.MENUITEM_VALUE_CANCELLED) ? 0 : w;

  if (w == ui.MENUITEM_VALUE_CANCELLED) {
    return;
  }
  }

  var magic = 0;
  while (true) {
    magic = yield ui.magicmenu.magicSelectMenu(
      getPartyRole(w),
      false,
      magic
    );
    if (magic == 0) {
      break;
    }

    surface.backupScreen();

    var objectEntry = getObjectEntry(magic);
    var magicObj = objectEntry ? objectEntry.magic : null;
    if (!magicObj) {
      continue;
    }
    var scriptOnUse = (typeof magicObj.scriptOnUse === 'number') ? magicObj.scriptOnUse : 0;
    var scriptOnSuccess = (typeof magicObj.scriptOnSuccess === 'number') ? magicObj.scriptOnSuccess : 0;
    var magicData = getMagicEntry(magicObj.magicNumber) || {};
    var magicCost = (magicData.costMP || 0) as number;
    if (magicObj.flags & MagicFlag.ApplyToAll) {
      // SDLPAL:wScriptOnUse 为 0 时 PAL_RunTriggerScript 什么也不做、视为成功,接着跑 wScriptOnSuccess。
      // 许多回复术(如氣療術)只有成功脚本 —— 之前把 0 当「取消」,地图上施法一律无效。
      var useOk = true;
      if (scriptOnUse) {
        // SDLPAL: rgObject[wMagic].magic.wScriptOnUse = PAL_RunTriggerScript(...). setObjectScriptValue writes the
        // word in place and drops every cached ObjectUnion view (#152); data[3] = scriptOnUse, data[2] = scriptOnSuccess.
        worldService.setObjectScriptValue(magic, MAGIC_SCRIPT_ON_USE, yield script.runTriggerScript(scriptOnUse, 0));
        useOk = !!script.scriptSuccess;
      } else {
        script.scriptSuccess = true;
      }
      if (useOk) {
        if (scriptOnSuccess) {
          worldService.setObjectScriptValue(magic, MAGIC_SCRIPT_ON_SUCCESS, yield script.runTriggerScript(scriptOnSuccess, 0));
        }
        if (script.scriptSuccess) {
          var roleId = getPartyRole(w);
          var currentMP = getPlayerMP(roleId);
          worldService.setPlayerMP(roleId || 0, (currentMP || 0) - magicCost);
        }
      }

      if (shouldFadeIn()) {
        yield surface.fadeIn(getPaletteIdValue(), getNightPaletteFlagValue(), 1);
        worldService.setNeedToFadeIn(false);
      }
    } else {
      // Need to select which player to use the magic on.
      var player = 0;
      // 等待点(agent-pal-waits.md W2):内联的选目标循环没有函数可包,就地声明;光标 player 可跟踪
      var targetWait = declareWait('menu.party', {
        title: 'cast ' + wordText(ui.getWord(magic)), items: partyChoiceItems(ui), index: 0, cancelable: true, context: 'magic-target'
      });
      try {
      while (player != ui.MENUITEM_VALUE_CANCELLED) {
        // Redraw the player info boxes first
        y = 45;
        for (var i = 0; i <= maxPartyMemberIndex; i++) {
          const role = getPartyRole(i);
          if (role == null) {
            continue;
          }
          uibattle.playerInfoBox(
            PAL_XY(y, 165),
            role,
            100,
            ui.TIMEMETER_COLOR_DEFAULT,
            true
          );
          y += 78;
        }

        // Draw the cursor on the selected item
        rect.x = 0;
        rect.y = 158;
        rect.w = 320;
        rect.h = 6;

        surface.restoreScreen();

        var frame = ui.sprite.frames[ui.SPRITENUM_CURSOR_UP];
        surface.blitRLE(frame, PAL_XY(75 + 78 * player, rect.y));
        surface.updateScreen(null);
        updateWait(targetWait, { index: player });

        while (true) {
          if (input.isKeyPressed(Key.Menu)){
            player = ui.MENUITEM_VALUE_CANCELLED;
            break;
          } else if (input.isKeyPressed(Key.Search)) {
            var targetRole = getPartyRole(player);
            // 同上:没有使用脚本(0)= 成功,直接跑成功脚本(之前在这里取消)
            var targetOk = true;
            if (scriptOnUse) {
              worldService.setObjectScriptValue(magic, MAGIC_SCRIPT_ON_USE, yield script.runTriggerScript(scriptOnUse, targetRole || 0));
              targetOk = !!script.scriptSuccess;
            } else {
              script.scriptSuccess = true;
            }
            if (targetOk) {
              if (scriptOnSuccess) {
                worldService.setObjectScriptValue(magic, MAGIC_SCRIPT_ON_SUCCESS, yield script.runTriggerScript(scriptOnSuccess, targetRole || 0));
              }
              if (script.scriptSuccess){
                var casterRole = getPartyRole(w);
                var casterMP = getPlayerMP(casterRole);
                worldService.setPlayerMP(casterRole || 0, (casterMP || 0) - magicCost);
                // Check if we have run out of MP
                if (getPlayerMP(casterRole) < magicCost) {
                  // Don't go further if run out of MP
                  player = ui.MENUITEM_VALUE_CANCELLED;
                }
              }
            }
            break;
          } else if (input.isKeyPressed(Key.Left | Key.Up)) {
            if (player > 0) {
              player--;
              break;
            }
          } else if (input.isKeyPressed((Key.Right | Key.Down))) {
            if (player < maxPartyMemberIndex) {
              player++;
              break;
            }
          }

          input.clear();
          yield sleepByFrame(1);
        }
        input.clear();
      }
      } finally {
        endWait(targetWait);
      }
    }

    // Redraw the player info boxes
    y = 45;
    for (var i = 0; i <= maxPartyMemberIndex; i++) {
      const role = getPartyRole(i);
      if (role == null) {
        continue;
      }
      uibattle.playerInfoBox(
        PAL_XY(y, 165),
        role,
        100,
        ui.TIMEMETER_COLOR_DEFAULT,
        true
      );
      y += 78;
    }
  }
  } finally {
    exitClassicOverlay(overlayToken);
  }
};

let inventoryMenuLastChoice = 0;

uigame.inventoryMenu = function*(): Generator<any, any, any> {
  const overlayToken = enterClassicOverlay();
  try {
    yield* refreshClassicView();
  var rect = new RECT(30, 60, 75, 60);
  var menuitems = [
    new ui.MenuItem(1, ui.INVMENU_LABEL_EQUIP, true, PAL_XY(43, 73)),
    new ui.MenuItem(2, ui.INVMENU_LABEL_USE,   true, PAL_XY(43, 73 + 18))
  ];

  var box = ui.createBox(PAL_XY(30, 60), 1, 1, 0, false);
  surface.updateScreen(null);

  // SDLPAL PAL_InventoryMenu remembers the last choice (static w; values are
  // 1-based, and a cancel resets the default to the first item).
  var w = yield ui.readMenu(null, menuitems, inventoryMenuLastChoice > 0 ? inventoryMenuLastChoice - 1 : 0, ui.MENUITEM_COLOR);
  inventoryMenuLastChoice = (w == ui.MENUITEM_VALUE_CANCELLED) ? 0 : w;

  switch (w) {
    case 1:
      yield play.equipItem();
      break;
    case 2:
      yield play.useItem();
      break;
  }
  } finally {
    exitClassicOverlay(overlayToken);
  }
};

uigame.inGameMenu_onItemChange = function(currentItem: any) {
  worldService.setMainMenuIndex(currentItem - 1);
};

uigame.inGameMenu = function*(): Generator<any, any, any> {
  const overlayToken = enterClassicOverlay();
  try {
    yield* refreshClassicView();
  var result;
  var rect = new RECT(0, 0, 150, 185);

  // SDLPAL backs up the whole screen and restores it on exit ("fix render
  // problem with shadow"), so no box shadow is left behind.
  surface.backupScreen();

  // Display the cash amount.
  var cashBox = uigame.showCash(getCash());
  // Create the menu box.
  var menuBox = ui.createBox(PAL_XY(3, 37), 3, 1, 0, true);
  surface.updateScreen(null);

  // Create menu items
  var menuitems = [
    new ui.MenuItem(1, ui.GAMEMENU_LABEL_STATUS,    true, PAL_XY(16, 50)),
    new ui.MenuItem(2, ui.GAMEMENU_LABEL_MAGIC,     true, PAL_XY(16, 50 + 18)),
    new ui.MenuItem(3, ui.GAMEMENU_LABEL_INVENTORY, true, PAL_XY(16, 50 + 36)),
    new ui.MenuItem(4, ui.GAMEMENU_LABEL_SYSTEM,    true, PAL_XY(16, 50 + 54))
  ];

  // Process the menu
  var curMainMenuItem = getMainMenuIndexValue();
  if (typeof curMainMenuItem !== 'number') {
    curMainMenuItem = 0;
  }

  while (true) {
    var currentSelection = getMainMenuIndexValue();
    if (typeof currentSelection !== 'number') {
      currentSelection = curMainMenuItem;
    } else {
      curMainMenuItem = currentSelection;
    }
    result = yield ui.readMenu(uigame.inGameMenu_onItemChange, menuitems, currentSelection, ui.MENUITEM_COLOR);

    if (result == ui.MENUITEM_VALUE_CANCELLED) {
      break;
    }

    switch (result) {
      case 1:
        // Status
        yield uigame.playerStatus();
        return out();
      case 2:
        // Magic
        yield uigame.inGameMagicMenu();
        return out();
      case 3:
        // Inventory
        yield uigame.inventoryMenu();
        return out();
      case 4:
        // System
        if (yield uigame.systemMenu()) {
          return out();
        }
        break;
    }
  }

  function out() {
    // Remove the boxes.
    cashBox.free();
    menuBox.free();
    surface.restoreScreen();
    // The whole screen was backed up, so refresh all of it (this used to pass the RECT
    // constructor, which updateScreen also treated as "full screen").
    surface.updateScreen(null);
  }
  out();
  } finally {
    exitClassicOverlay(overlayToken);
  }
};

uigame.playerStatus = function*(): Generator<any, any, any> {
  const overlayToken = enterClassicOverlay();
  try {
    yield* refreshClassicView();
  var equipPos = [
    [190, 0],[248, 40], [252, 102], [202, 134], [142, 142], [82, 126]
  ];
  var bufBackground = Files.FBP.decompressChunk(ui.STATUS_BACKGROUND_FBPNUM);
  var bufImage;
  var current = 0;

  while (current >= 0 && current <= getMaxPartyMemberIndex()) {
    var role = getPartyRole(current);
    if (role == null) {
      current++;
      continue;
    }
    var nameWordId = getPlayerNameId(role);
    // Draw the background image
    surface.blit(bufBackground);
    // Draw the text labels
    ui.drawText(ui.getWord(ui.STATUS_LABEL_EXP),             PAL_XY(6, 6),   ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_LEVEL),           PAL_XY(6, 32),  ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_HP),              PAL_XY(6, 54),  ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_MP),              PAL_XY(6, 76),  ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_ATTACKPOWER),     PAL_XY(6, 98),  ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_MAGICPOWER),      PAL_XY(6, 118), ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_RESISTANCE),      PAL_XY(6, 138), ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_DEXTERITY),       PAL_XY(6, 158), ui.MENUITEM_COLOR, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_FLEERATE),        PAL_XY(6, 178), ui.MENUITEM_COLOR, true, false);

    ui.drawText(ui.getWord(nameWordId), PAL_XY(110, 8), ui.MENUITEM_COLOR_CONFIRMED, true, false);

    // Draw the stats
    var expEntry = getExpEntry(role);
    var currentLevel = getPlayerLevel(role);
    var levelUpTarget = gameDataAdapter.getLevelUpExpValue(currentLevel) || 0;
    ui.drawNumber(expEntry.exp || 0, 5, PAL_XY(58, 6), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(levelUpTarget, 5, PAL_XY(58, 15), NumColor.Cyan, NumAlign.Right);
    ui.drawNumber(currentLevel, 2, PAL_XY(54, 35), NumColor.Yellow, NumAlign.Right);
    surface.blitRLE(ui.sprite.frames[ui.SPRITENUM_SLASH], PAL_XY(65, 58));
    surface.blitRLE(ui.sprite.frames[ui.SPRITENUM_SLASH], PAL_XY(65, 80));
    ui.drawNumber(getPlayerHP(role), 4, PAL_XY(42, 56), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(getPlayerMaxHP(role), 4, PAL_XY(63, 61), NumColor.Blue, NumAlign.Right);
    ui.drawNumber(getPlayerMP(role), 4, PAL_XY(42, 78), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(getPlayerMaxMP(role), 4, PAL_XY(63, 83), NumColor.Blue, NumAlign.Right);

    ui.drawNumber(script.getPlayerAttackStrength(role), 4, PAL_XY(42, 102), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerMagicStrength(role), 4, PAL_XY(42, 122), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerDefense(role), 4, PAL_XY(42, 142), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerDexterity(role), 4, PAL_XY(42, 162), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerFleeRate(role), 4, PAL_XY(42, 182), NumColor.Yellow, NumAlign.Right);

    // Draw the equipments
    for (var i = 0; i < Const.MAX_PLAYER_EQUIPMENTS; i++) {
      var equipmentId = getPlayerEquipment(i, role);
      if (!equipmentId) {
        continue;
      }
      // Draw the image
      bufImage = RLE(Files.BALL.readChunk(getObjectBitmap(equipmentId)));
      if (bufImage) {
         surface.blitRLE(bufImage, PAL_XY(equipPos[i][0], equipPos[i][1]));
      }
      // Draw the text label
      ui.drawText(ui.getWord(equipmentId), PAL_XY(equipPos[i][0] + 5, equipPos[i][1] + 38), ui.STATUS_COLOR_EQUIPMENT, true, false);
    }

    // Draw the image of player role
    bufImage = RLE(Files.RGM.readChunk(getPlayerAvatarId(role)));
    if (bufImage) {
       surface.blitRLE(bufImage, PAL_XY(110, 30));
    }

    // Draw all poisons
    var y = 58;
    var poisonMatrix = getPoisonStatusMatrix();
    for (var i = 0; i < Const.MAX_POISONS; i++) {
      var row = Array.isArray(poisonMatrix) ? poisonMatrix[i] : null;
      var rowArray = Array.isArray(row) ? row : null;
      var entry = rowArray && rowArray[current] ? rowArray[current] : null;
      var poisonId = entry && typeof entry === 'object'
        ? (entry as any).poisonID
        : 0;

      if (poisonId) {
        var poisonObject = getObjectEntry(poisonId);
        var poisonData = poisonObject && poisonObject.poison ? poisonObject.poison : null;
        if (poisonData && poisonData.poisonLevel <= 3) {
          ui.drawText(ui.getWord(poisonId), PAL_XY(185, y), (poisonData.color || 0) + 10, true, false);
          y += 18;
        }
      }
    }

    // Update the screen
    surface.updateScreen(null);

    // Wait for input
    input.clear();
    while (true) {
      if (input.isKeyPressed(Key.Menu)) {
        current = -1;
        break;
      } else if (input.isKeyPressed((Key.Left | Key.Up))) {
        current--;
        break;
      } else if (input.isKeyPressed((Key.Right | Key.Down | Key.Search))) {
        current++;
        break;
      }
      yield sleepByFrame(1);
    }
  }
  } finally {
    exitClassicOverlay(overlayToken);
  }
};

// SDLPAL PAL_ItemUseMenu keeps the selected player across calls (static sSelectedPlayer).
let itemUseMenuSelectedPlayer = 0;

uigame.getItemUseMenuSelectedPlayer = function() {
  return itemUseMenuSelectedPlayer;
};

uigame.itemUseMenu = function*(itemToUse: any): Generator<any, any, any> {
  var rect = new RECT(110, 2, 200, 180);
  var selectedColor = ui.MENUITEM_COLOR_SELECTED_FIRST;
  var maxPartyMemberIndex = getMaxPartyMemberIndex();
  var colorChangeTime = 0;

  while (true) {
    if (maxPartyMemberIndex < 0) {
      return ui.MENUITEM_VALUE_CANCELLED;
    }
    if (itemUseMenuSelectedPlayer > maxPartyMemberIndex) {
      itemUseMenuSelectedPlayer = 0;
    }
    var selectedPlayer = itemUseMenuSelectedPlayer;

    // Draw the box
    var box = ui.createBox(PAL_XY(110, 2), 7, 9, 0, false);

    // Draw the stats of the selected player
    ui.drawText(ui.getWord(ui.STATUS_LABEL_LEVEL),       PAL_XY(200, 16),  ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_HP),          PAL_XY(200, 34),  ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_MP),          PAL_XY(200, 52),  ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_ATTACKPOWER), PAL_XY(200, 70),  ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_MAGICPOWER),  PAL_XY(200, 88),  ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_RESISTANCE),  PAL_XY(200, 106), ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_DEXTERITY),   PAL_XY(200, 124), ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);
    ui.drawText(ui.getWord(ui.STATUS_LABEL_FLEERATE),    PAL_XY(200, 142), ui.ITEMUSEMENU_COLOR_STATLABEL, true, false);

    var role = getPartyRole(selectedPlayer);
    if (role == null) {
      role = getPartyRole(0) || 0;
    }

    ui.drawNumber(getPlayerLevel(role), 4, PAL_XY(240, 20), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(getPlayerMaxHP(role), 4, PAL_XY(261, 40), NumColor.Blue,   NumAlign.Right);
    ui.drawNumber(getPlayerHP(role),    4, PAL_XY(240, 37), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(getPlayerMaxMP(role), 4, PAL_XY(261, 58), NumColor.Blue,   NumAlign.Right);
    ui.drawNumber(getPlayerMP(role),    4, PAL_XY(240, 55), NumColor.Yellow, NumAlign.Right);
    surface.blitRLE(ui.sprite.frames[ui.SPRITENUM_SLASH], PAL_XY(263, 38));
    surface.blitRLE(ui.sprite.frames[ui.SPRITENUM_SLASH], PAL_XY(263, 56));

    ui.drawNumber(script.getPlayerAttackStrength(role), 4, PAL_XY(240, 74),  NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerMagicStrength(role),  4, PAL_XY(240, 92),  NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerDefense(role),        4, PAL_XY(240, 110), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerDexterity(role),      4, PAL_XY(240, 128), NumColor.Yellow, NumAlign.Right);
    ui.drawNumber(script.getPlayerFleeRate(role),       4, PAL_XY(240, 146), NumColor.Yellow, NumAlign.Right);

    // Draw the names of the players in the party
    for (var i = 0; i <= maxPartyMemberIndex; i++) {
      var color = (i == selectedPlayer ? selectedColor : ui.MENUITEM_COLOR);
      var partyRole = getPartyRole(i);
      var nameWord = getPlayerNameId(partyRole);
      ui.drawText(ui.getWord(nameWord), PAL_XY(125, 16 + 20 * i), color, true, false);
    }

    surface.blitRLE(ui.sprite.frames[ui.SPRITENUM_ITEMBOX], PAL_XY(120, 80));

    var amount = script.getItemAmount(itemToUse);

    if (amount > 0) {
      // Draw the picture of the item
      var bufImage = Files.BALL.readChunk(getObjectBitmap(itemToUse));
      if (bufImage) {
        surface.blitRLE(bufImage, PAL_XY(127, 88));
      }

      // Draw the amount and label of the item
      ui.drawText(ui.getWord(itemToUse), PAL_XY(116, 143), ui.STATUS_COLOR_EQUIPMENT, true, false);
      ui.drawNumber(amount, 2, PAL_XY(170, 133), NumColor.Cyan, NumAlign.Right);
    }

    // Update the screen area
    surface.updateScreen(null);

    // Wait for key
    input.clear();
    while (true) {
      // See if we should change the highlight color
      var now = timestamp();
      if (now > colorChangeTime) {
        if (selectedColor + 1 >= ui.MENUITEM_COLOR_SELECTED_FIRST + ui.MENUITEM_COLOR_SELECTED_TOTALNUM) {
          selectedColor = ui.MENUITEM_COLOR_SELECTED_FIRST;
        } else {
          selectedColor++;
        }

        colorChangeTime = now + (600 / ui.MENUITEM_COLOR_SELECTED_TOTALNUM);

        // Redraw the selected item.
        var selectedName = getPlayerNameId(getPartyRole(selectedPlayer));
        ui.drawText(ui.getWord(selectedName), PAL_XY(125, 16 + 20 * selectedPlayer), selectedColor, false, true);
      }

      if (input.keyPress != 0) {
        break;
      }

      yield sleepByFrame(1);
    }

    if (amount <= 0) {
      return ui.MENUITEM_VALUE_CANCELLED;
    }

    if (input.isKeyPressed(Key.Up | Key.Left)) {
      itemUseMenuSelectedPlayer--;
      if (itemUseMenuSelectedPlayer < 0) {
        itemUseMenuSelectedPlayer = maxPartyMemberIndex;
      }
    } else if (input.isKeyPressed(Key.Down | Key.Right)) {
      itemUseMenuSelectedPlayer++;
      if (itemUseMenuSelectedPlayer > maxPartyMemberIndex) {
        itemUseMenuSelectedPlayer = 0;
      }
    } else if (input.isKeyPressed(Key.Menu)) {
      box.free();
      break;
    } else if (input.isKeyPressed(Key.Search)) {
      box.free();
      return getPartyRole(selectedPlayer);
    }

    box.free();
  }

  return ui.MENUITEM_VALUE_CANCELLED;
};

// SDLPAL __buymenu_firsttime_render: shadows are drawn only on the first
// render, otherwise redrawing would darken them again on every item change.
let buyMenuFirstTimeRender = false;

uigame.buyMenu_onItemChange = function(currentItem: any) {
  var rect = new RECT(20, 8, 300, 175);
  // Draw the picture of current selected item
  if (buyMenuFirstTimeRender) {
    ui.blitRLEShadow(ui.sprite.frames[ui.SPRITENUM_ITEMBOX], PAL_XY(46, 14));
  }
  surface.blitRLE(ui.sprite.frames[ui.SPRITENUM_ITEMBOX], PAL_XY(40, 8));
  var bufImage = Files.BALL.readChunk(getObjectBitmap(currentItem));
  if (bufImage) {
    surface.blitRLE(bufImage, PAL_XY(48, 15));
  }
  // See how many of this item we have in the inventory
  var amount = 0;
  var inventory = getInventorySnapshot() as InventorySlot[];
  for (var i = 0; i < Const.MAX_INVENTORY; i++) {
    var slot = inventory[i] as InventorySlot | undefined;
    if (!slot || slot.item === 0) {
      break;
    } else if (slot.item === currentItem) {
       amount = slot.amount || 0;
       break;
    }
  }
  // SDLPAL also counts copies currently equipped by party members.
  var maxPartyMemberIndex = getMaxPartyMemberIndex();
  for (var i = 0; i < Const.MAX_PLAYER_EQUIPMENTS; i++) {
    for (var j = 0; j <= maxPartyMemberIndex; j++) {
      var role = getPartyRole(j);
      if (role != null && getPlayerEquipment(i, role) === currentItem) {
        amount++;
      }
    }
  }
  var shadow = buyMenuFirstTimeRender ? 6 : 0;
  // Draw the amount of this item in the inventory
  ui.createSingleLineBox(PAL_XY(20, 100), 5, false, shadow);
  ui.drawText(ui.getWord(ui.BUYMENU_LABEL_CURRENT), PAL_XY(30, 110), 0, false, false);
  ui.drawNumber(amount, 6, PAL_XY(69, 115), NumColor.Yellow, NumAlign.Right);
  // Draw the cash amount
  ui.createSingleLineBox(PAL_XY(20, 141), 5, false, shadow);
  ui.drawText(ui.getWord(ui.CASH_LABEL), PAL_XY(30, 151), 0, false, false);
  ui.drawNumber(getCash(), 6, PAL_XY(69, 156), NumColor.Yellow, NumAlign.Right);

  surface.updateScreen(rect);
  buyMenuFirstTimeRender = false;
};

uigame.buyMenu = function*(storeNum: any): Generator<any, any, any> {
  var rect = new RECT(125, 8, 190, 190);
  // create the menu items
  var menuitems = [];
  var storeEntry = getStoreEntry(storeNum);
  // Store 结构体的 items 是 'WORD*N' 字段(类数组,不是 Array):旧判断 Array.isArray 恒假 →
  // 商店永远空列表,readMenu(list[0]) 直接崩主循环。
  var rawItems: any = storeEntry ? storeEntry.items : null;
  var storeItems = rawItems && typeof rawItems.length === 'number' ? Array.from(rawItems as ArrayLike<number>) : [];
  for (var i = 0; i < Const.MAX_STORE_ITEM; i++) {
    var itemId = storeItems[i];
    if (!itemId) {
      break;
    }
    menuitems.push(new ui.MenuItem(
      itemId,
      itemId,
      true,
      PAL_XY(150, 21 + i * 18)
    ));
  }

  // Draw the box
  ui.createBox(PAL_XY(122, 8), 8, 8, 1, false);
  // Draw the number of prices
  for (var i = 0; i < menuitems.length; i++) {
    var w = getObjectPrice(menuitems[i].value);
    ui.drawNumber(w, 6, PAL_XY(238, 26 + i * 18), NumColor.Yellow, NumAlign.Right);
  }
  surface.updateScreen(null);

  var result = 0;
  buyMenuFirstTimeRender = true;
  while (true) {
    result = yield ui.readMenu(uigame.buyMenu_onItemChange, menuitems, result, ui.MENUITEM_COLOR);

    if (result == ui.MENUITEM_VALUE_CANCELLED) {
      break;
    }

    if (getObjectPrice(result) <= getCash()) {
      if ((yield uigame.confirmMenu()) as any) {
        // Player bought an item
        worldService.adjustCash(-getObjectPrice(result));
        (script as any).addItemToInventory(result, 1);
      }
    }

    // Place the cursor to the current item on next loop
    for (var i=0; i<menuitems.length; ++i) {
      if (result == menuitems[i].value) {
        result = i;
        break;
      }
    }
  }
};

uigame.sellMenu_onItemChange = function(currentItem: any) {
  // Draw the cash amount
  ui.createSingleLineBox(PAL_XY(100, 150), 5, false, 0);
  ui.drawText(ui.getWord(ui.CASH_LABEL), PAL_XY(110, 160), 0, false, false);
  ui.drawNumber(getCash(), 6, PAL_XY(148, 165), NumColor.Yellow, NumAlign.Right);

  // Draw the price
  ui.createSingleLineBox(PAL_XY(224, 150), 5, false, 0);

  if (getObjectFlags(currentItem) & ItemFlag.Sellable) {
    ui.drawText(ui.getWord(ui.SELLMENU_LABEL_PRICE), PAL_XY(234, 160), 0, false, false);
    ui.drawNumber(~~(getObjectPrice(currentItem) / 2), 6, PAL_XY(272, 165), NumColor.Yellow, NumAlign.Right);
  }
};

uigame.sellMenu = function*(): Generator<any, any, any> {
  while (true) {
    var w = yield itemmenu.itemSelectMenu(uigame.sellMenu_onItemChange, ItemFlag.Sellable);
    if (w == 0) {
      break;
    }

    if ((yield uigame.confirmMenu()) as any) {
      if ((script as any).addItemToInventory(w, -1)) {
        worldService.adjustCash(~~(getObjectPrice(w) / 2));
      }
    }
  }
};

uigame.equipItemMenu = function*(item: any): Generator<any, any, any> {
  setLastUnequippedItem(item);
  var bufBackground = Files.FBP.decompressChunk(ui.EQUIPMENU_BACKGROUND_FBPNUM);
  var currentPlayer = 0;
  var selectedColor = ui.MENUITEM_COLOR_SELECTED_FIRST;
  var colorChangeTime = timestamp() + (600 / ui.MENUITEM_COLOR_SELECTED_TOTALNUM);
  while (true) {
    var maxPartyMemberIndex = getMaxPartyMemberIndex();
    if (maxPartyMemberIndex < 0) {
      return;
    }
    item = getLastUnequippedItem();
    // Draw the background
    surface.blit(bufBackground);
    // Draw the item picture
    var bufImage = Files.BALL.readChunk(getObjectBitmap(item));
    if (bufImage) {
       surface.blitRLE(bufImage, PAL_XY(16, 16));
    }
    // Draw the current equipment of the selected player
    var role = getPartyRole(currentPlayer);
    if (role == null) {
      role = getPartyRole(0) || 0;
    }
    for (var i = 0; i < ui.MAX_PLAYER_EQUIPMENTS; i++) {
      var equipId = getPlayerEquipment(i, role);
      if (equipId) {
        ui.drawText(ui.getWord(equipId), PAL_XY(130, 11 + i * 22), ui.MENUITEM_COLOR, true, false);
      }
    }
    // Draw the stats of the currently selected player
    ui.drawNumber(script.getPlayerAttackStrength(role), 4, PAL_XY(260, 14),  NumColor.Cyan, NumAlign.Right);
    ui.drawNumber(script.getPlayerMagicStrength(role),  4, PAL_XY(260, 36),  NumColor.Cyan, NumAlign.Right);
    ui.drawNumber(script.getPlayerDefense(role),        4, PAL_XY(260, 58),  NumColor.Cyan, NumAlign.Right);
    ui.drawNumber(script.getPlayerDexterity(role),      4, PAL_XY(260, 80),  NumColor.Cyan, NumAlign.Right);
    ui.drawNumber(script.getPlayerFleeRate(role),       4, PAL_XY(260, 102), NumColor.Cyan, NumAlign.Right);
    // Draw a box for player selection
    ui.createBox(PAL_XY(2, 95), maxPartyMemberIndex, 2, 0, false);
    // Draw the label of players
    var itemFlags = getObjectFlags(item);
    for (i = 0; i <= maxPartyMemberIndex; i++) {
      var partyRole = getPartyRole(i);
      var nameWord = getPlayerNameId(partyRole);
      var color;
      var canEquip = !!(itemFlags & (ItemFlag.EquipableByPlayerRole_First << (partyRole || 0)));
      if (currentPlayer == i) {
        color = canEquip ? selectedColor : ui.MENUITEM_COLOR_SELECTED_INACTIVE;
      } else {
        color = canEquip ? ui.MENUITEM_COLOR : ui.MENUITEM_COLOR_INACTIVE;
      }

      ui.drawText(ui.getWord(nameWord), PAL_XY(15, 108 + 18 * i), color, true, false);
    }
    // Draw the text label and amount of the item
    if (item != 0) {
       ui.drawText(ui.getWord(item), PAL_XY(5, 70), ui.MENUITEM_COLOR_CONFIRMED, true, false);
       ui.drawNumber(script.getItemAmount(item), 2, PAL_XY(65, 73), NumColor.Cyan, NumAlign.Right);
    }
    // Update the screen
    surface.updateScreen(null);

    // Accept input
    input.clear();
    while (true) {
      // See if we should change the highlight color
      var now = timestamp();
      if (now > colorChangeTime) {
        if (selectedColor + 1 >= ui.MENUITEM_COLOR_SELECTED_FIRST + ui.MENUITEM_COLOR_SELECTED_TOTALNUM) {
          selectedColor = ui.MENUITEM_COLOR_SELECTED_FIRST;
        } else {
          selectedColor++;
        }

        colorChangeTime = now + (600 / ui.MENUITEM_COLOR_SELECTED_TOTALNUM);

        // Redraw the selected item if needed.
        role = getPartyRole(currentPlayer);
        if (role != null && (itemFlags & (ItemFlag.EquipableByPlayerRole_First << role))) {
          var selectedNameWord = getPlayerNameId(role);
          ui.drawText(ui.getWord(selectedNameWord), PAL_XY(15, 108 + 18 * currentPlayer), selectedColor, true, true);
        }
      }

      if (input.keyPress != 0) {
        break;
      }

      yield sleepByFrame(1);
    }
    if (item == 0) {
       return;
    }
    if (input.isKeyPressed(Key.Up | Key.Left)) {
      currentPlayer--;
      if (currentPlayer < 0) {
        currentPlayer = maxPartyMemberIndex;
      }
    } else if (input.isKeyPressed(Key.Down | Key.Right)) {
      currentPlayer++;
      if (currentPlayer > maxPartyMemberIndex) {
        currentPlayer = 0;
      }
    } else if (input.isKeyPressed(Key.Menu)) {
       return;
    } else if (input.isKeyPressed(Key.Search)) {
       role = getPartyRole(currentPlayer);
       if (role != null && (itemFlags & (ItemFlag.EquipableByPlayerRole_First << role))) {
          // Run the equip script
          var equipScript = getObjectItemData(item) ? getObjectItemData(item).scriptOnEquip : 0;
          const nextEquipScript = yield script.runTriggerScript(equipScript, role);
          setObjectScriptOnEquip(item, nextEquipScript);
       }
    }
  }
};

export default uigame;
