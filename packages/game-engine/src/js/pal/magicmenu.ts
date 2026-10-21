import utils from './utils';
import input from './input';
import scene from './scene';
import uibattle from './uibattle';
import gameDataAdapter from '../../services/game-data-adapter';
import scriptObjectAdapter from '../../services/script-object-adapter';
import { inventorySignals } from '../../state/slices/inventory';
import partyTrailAdapter from '../../services/party-trail-adapter';
import {
  getPlayerMP as getPlayerMPValue,
  getPlayerMagicSlots as getPlayerMagicSlotsValue,
  getMaxPartyMemberIndex as getMaxPartyMemberIndexValue
} from '../../services/player-state-adapter';
import { Const, MagicFlag } from './pal-global';
import { Key } from '../../services/input-service';
import { globalRef } from './global-ref';
import type { MagicMenuModule } from './global-ref';

const global = globalRef;

const log = global.log;
const PAL_XY = global.PAL_XY;
const PAL_X = global.PAL_X;
const PAL_Y = global.PAL_Y;
const RECT = global.RECT;
const NumColor = global.NumColor;
const NumAlign = global.NumAlign;
const sleepByFrame = global.sleepByFrame;

log.trace('magicmenu module load');

const suspiciousWordPattern = /进度|進度/;
const loggedSuspiciousMagicMenus = new Set<string>();
const magicMenuDecoder = (() => {
  if (typeof TextDecoder === 'undefined') {
    return null;
  }
  try {
    return new TextDecoder('big5');
  } catch (err) {
    try {
      return new TextDecoder('big5-hkscs');
    } catch (err2) {
      return new TextDecoder();
    }
  }
})();

const toWordBytes = (payload: any): Uint8Array => {
  if (!payload) return new Uint8Array();
  if (payload instanceof Uint8Array) return payload;
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset || 0, payload.byteLength || 0);
  }
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload);
  if (typeof payload === 'string') {
    const out = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = payload.charCodeAt(i) & 0xff;
    return out;
  }
  return new Uint8Array();
};

const decodeMagicWord = (payload: any): string => {
  const view = toWordBytes(payload);
  if (view.length === 0) return '';
  if (magicMenuDecoder) {
    try {
      return magicMenuDecoder.decode(view).replace(/\u0000+$/, '').trim();
    } catch (err) {
      // fall through
    }
  }
  let result = '';
  for (let i = 0; i < view.length; i++) {
    const code = view[i];
    if (!code) break;
    result += String.fromCharCode(code);
  }
  return result.trim();
};

var MagicItem = function(this: any) {
  this.reset();
};
(MagicItem as any).prototype.reset = function(magic: any, mp: any, enabled: any) {
  this.magic = magic || 0;
  this.MP = mp || 0;
  this.enabled = enabled || false;
  return this;
};

const magicmenu = {
  playerMP: 0,
  currentItem: 0,
  magicNum: 0,
  magicItems: utils.initArray(MagicItem, Const.MAX_PLAYER_MAGICS)
} as MagicMenuModule;

var surface: any = null;
var ui: any = null;

const inventorySlice = inventorySignals();
const cashSignal = inventorySlice.cash;

function getCashValue() {
  const value = cashSignal.value;
  return typeof value === 'number' ? value : 0;
}

magicmenu.init = function*(surf: any, _ui: any): Generator<any, any, any> {
  log.debug('[UI] init magicmenu');
  ui = _ui;
  global.magicmenu = ui.magicmenu = magicmenu;
  surface = surf;
};

/**
 * Update the magic selection menu.
 * @return {Number} The selected magic. 0 if cancelled, 0xFFFF if not confirmed.
 */
magicmenu.magicSelectMenuUpdate = function() {
  log.trace(['[UI] magicmenu magicSelectMenuUpdate'].join(' '));
  // Check for inputs
  if (input.isKeyPressed(Key.Up)) {
    magicmenu.currentItem -= 3;
  } else if (input.isKeyPressed(Key.Down)) {
    magicmenu.currentItem += 3;
  } else if (input.isKeyPressed(Key.Left)) {
    magicmenu.currentItem--;
  } else if (input.isKeyPressed(Key.Right)) {
    magicmenu.currentItem++;
  } else if (input.isKeyPressed(Key.PageUp)) {
    magicmenu.currentItem -= 3 * 5;
  } else if (input.isKeyPressed(Key.PageDown)) {
    magicmenu.currentItem += 3 * 5;
  } else if (input.isKeyPressed(Key.Home)) {
    magicmenu.currentItem = 0;
  } else if (input.isKeyPressed(Key.End)) {
    magicmenu.currentItem = magicmenu.magicNum - 1;
  } else if (input.isKeyPressed(Key.Menu)) {
    return 0;
  }

  // Make sure the current menu item index is in bound
  if (magicmenu.currentItem < 0) {
    magicmenu.currentItem = 0;
  } else if (magicmenu.currentItem >= magicmenu.magicNum) {
    magicmenu.currentItem = magicmenu.magicNum - 1;
  }

  // Create the box.
  ui.createBox(PAL_XY(10, 42), 4, 16, 1, false, 0);

  var objectDescTable = scriptObjectAdapter.getObjectDesc();
  var selectedSlot = magicmenu.magicItems[magicmenu.currentItem] || { MP: 0, magic: 0 };

  if (!objectDescTable) {
    // Draw the cash amount.
    ui.createSingleLineBox(PAL_XY(0, 0), 5, false);
    ui.drawText(ui.getWord(ui.CASH_LABEL), PAL_XY(10, 10), 0, false, false);
    ui.drawNumber(getCashValue(), 6, PAL_XY(49, 14), NumColor.Yellow, NumAlign.Right);

    // Draw the MP of the selected magic.
    ui.createSingleLineBox(PAL_XY(215, 0), 5, false);
    surface.blitRLE(
      ui.sprite.getFrame(ui.SPRITENUM_SLASH),
      PAL_XY(260, 14)
    );
    ui.drawNumber(
      selectedSlot.MP, 4,
      PAL_XY(230, 14),
      NumColor.Yellow, NumAlign.Right
    );
    ui.drawNumber(magicmenu.playerMP, 4, PAL_XY(265, 14), NumColor.Cyan, NumAlign.Right);
  } else {
    var descObj = ui.getObjectDesc(objectDescTable, selectedSlot.magic);
    // Draw the magic description.
    if (descObj) {
      var d = descObj.desc;
      var k = 3;
      var offset = 0;
      while (true) {
        var descBuf = [];
        var chStar = '*'.charCodeAt(0);
        for (; offset < d.byteLength; ++offset) {
          if (d[offset] == chStar) {
            ++offset;
            break;
          }
          descBuf.push(d[offset]);
        }
        ui.drawText(descBuf, PAL_XY(102, k), ui.DESCTEXT_COLOR, true, false);
        k += 16;
        if (offset >= d.byteLength) {
          break;
        }
      }
    }

    // Draw the MP of the selected magic.
    ui.createSingleLineBox(PAL_XY(0, 0), 5, false);
    surface.blitRLE(
      ui.sprite.getFrame(ui.SPRITENUM_SLASH),
      PAL_XY(45, 14)
    );
    ui.drawNumber(
      selectedSlot.MP, 4,
      PAL_XY(15, 14),
      NumColor.Yellow, NumAlign.Right
    );
    ui.drawNumber(magicmenu.playerMP, 4, PAL_XY(50, 14), NumColor.Cyan, NumAlign.Right);
  }

  // Draw the texts of the current page
  var i = ~~(magicmenu.currentItem / 3) * 3 - 3 * 2;
  if (i < 0) {
    i = 0;
  }

  for (var j = 0; j < 5; j++) {
    for (var k = 0; k < 3; k++) {
      var color = ui.MENUITEM_COLOR;

      if (i >= magicmenu.magicNum) {
        // End of the list reached
        j = 5;
        break;
      }

      if (i == magicmenu.currentItem) {
        if (magicmenu.magicItems[i].enabled) {
          color = ui.MENUITEM_COLOR_SELECTED;
        } else {
          color = ui.MENUITEM_COLOR_SELECTED_INACTIVE;
        }
      } else if (!magicmenu.magicItems[i].enabled) {
        color = ui.MENUITEM_COLOR_INACTIVE;
      }

      // Draw the text
      ui.drawText(
        ui.getWord(magicmenu.magicItems[i].magic),
        PAL_XY(35 + k * 87, 54 + j * 18), color, true, false
      );

      // Draw the cursor on the current selected item
      if (i == magicmenu.currentItem) {
        surface.blitRLE(
          ui.sprite.getFrame(ui.SPRITENUM_CURSOR),
          PAL_XY(60 + k * 87, 64 + j * 18)
        );
      }

      i++;
    }
  }

  if (input.isKeyPressed(Key.Search)) {
    if (magicmenu.magicItems[magicmenu.currentItem].enabled) {
      var j = magicmenu.currentItem % 3;
      var k = (magicmenu.currentItem < 3 * 2) ? ~~(magicmenu.currentItem / 3) : 2;

      j = 35 + j * 87;
      k = 54 + k * 18;

      ui.drawText(
        ui.getWord(magicmenu.magicItems[magicmenu.currentItem].magic),
        PAL_XY(j, k),
        ui.MENUITEM_COLOR_CONFIRMED,
        false, true
      );

      // Draw the cursor on the current selected item
      surface.blitRLE(ui.sprite.getFrame(ui.SPRITENUM_CURSOR), PAL_XY(j + 25, k + 10));

      return magicmenu.magicItems[magicmenu.currentItem].magic;
    }
  }

  return 0xFFFF;
};

/**
 * Initialize the magic selection menu.
 * @param  {Number}  playerRole   the player ID.
 * @param  {Boolean} inBattle     true if in battle, false if not.
 * @param  {Number}  defaultMagic the default magic item.
 */
magicmenu.magicSelectMenuInit = function(playerRole: any, inBattle: any, defaultMagic: any) {
  magicmenu.currentItem = 0;
  magicmenu.magicNum = 0;
  const debugMagicSlots: Array<{
    slotIndex: number;
    objectId: number;
    magicNumber: number;
    costMP: number;
    flags: number;
    text: string;
  }> = [];
  const slotEntries: Array<{
    objectId: number;
    magicNumber: number;
    costMP: number;
    flags: number;
    text: string;
  }> = [];
  let battleFlagCount = 0;
  let fieldFlagCount = 0;

  magicmenu.playerMP = getPlayerMPValue(playerRole);

  const magicSlots = getPlayerMagicSlotsValue(playerRole);
  for (var slotIndex = 0; slotIndex < magicSlots.length && slotIndex < Const.MAX_PLAYER_MAGICS; slotIndex++) {
    var objectId = magicSlots[slotIndex];
    if (!objectId) {
      continue;
    }
    var objectEntry = scriptObjectAdapter.getObjectEntry(objectId);
    var magicData = objectEntry && objectEntry.magic ? objectEntry.magic : null;
    if (!magicData) {
      continue;
    }
    var magicNumber = magicData.magicNumber || 0;
    var magicEntry = gameDataAdapter.getMagicEntry(magicNumber) || {};
    var costMP = typeof magicEntry.costMP === 'number' ? magicEntry.costMP : 0;
    var flags = typeof magicData.flags === 'number' ? magicData.flags : 0;
    if (flags & MagicFlag.UsableInBattle) {
      battleFlagCount++;
    }
    if (flags & MagicFlag.UsableOutsideBattle) {
      fieldFlagCount++;
    }
    const text = decodeMagicWord(ui.getWord(objectId));
    slotEntries.push({
      objectId,
      magicNumber,
      costMP,
      flags,
      text
    });
    debugMagicSlots.push({
      slotIndex,
      objectId,
      magicNumber,
      costMP,
      flags,
      text
    });
  }

  // As in SDLPAL, the mask follows only where the menu is opened. (A heuristic used to swap the
  // masks when a role had no magic usable here, which let field-only magic be cast in battle and
  // attack magic be cast outside it.)
  const usableFlagMask = inBattle ? MagicFlag.UsableInBattle : MagicFlag.UsableOutsideBattle;

  for (var slotIdx = 0; slotIdx < slotEntries.length; slotIdx++) {
    const entry = slotEntries[slotIdx];
    var slot = magicmenu.magicItems[magicmenu.magicNum];
    slot.reset(entry.objectId, entry.costMP, true);

    if (slot.MP > magicmenu.playerMP) {
      slot.enabled = false;
    }

    if (!(entry.flags & usableFlagMask)) {
      slot.enabled = false;
    }

    magicmenu.magicNum++;
  }

  if (debugMagicSlots.some((entry) => suspiciousWordPattern.test(entry.text))) {
    const signature = debugMagicSlots
      .map((entry) => `${entry.objectId}:${entry.text}`)
      .join('|');
    if (!loggedSuspiciousMagicMenus.has(signature)) {
      loggedSuspiciousMagicMenus.add(signature);
      log.warn('[UI] magic menu word mapping %s', JSON.stringify({
        playerRole,
        magicNum: magicmenu.magicNum,
        slots: debugMagicSlots
      }));
    }
  }

  for (var resetIndex = magicmenu.magicNum; resetIndex < magicmenu.magicItems.length; resetIndex++) {
    magicmenu.magicItems[resetIndex].reset();
  }

  // Sort the array
  /*
  magicmenu.magicItems.sort(function(a, b) {
    return (a.magic - b.magic);
  });
  */
  for (var i = 0; i < magicmenu.magicNum - 1; i++) {
    var completed = true;

    for (var j = 0; j < magicmenu.magicNum - 1 - i; j++) {
      if (magicmenu.magicItems[j].magic > magicmenu.magicItems[j + 1].magic) {
        var t = magicmenu.magicItems[j];
        magicmenu.magicItems[j] = magicmenu.magicItems[j + 1];
        magicmenu.magicItems[j + 1] = t;

        completed = false;
      }
    }

    if (completed) {
      break;
    }
  }

  // Place the cursor to the default item
  for (var i = 0; i < magicmenu.magicNum; i++) {
    if (magicmenu.magicItems[i].magic == defaultMagic){
      magicmenu.currentItem = i;
      break;
    }
  }
};

/**
 * Show the magic selection menu.
 * @param  {Number}  playerRole   the player ID.
 * @param  {Boolean} inBattle     true if in battle, false if not.
 * @param  {Number}  defaultMagic the default magic item.
 */
magicmenu.magicSelectMenu = function*(playerRole: any, inBattle: any, defaultMagic: any): Generator<any, any, any> {
  magicmenu.magicSelectMenuInit(playerRole, inBattle, defaultMagic);
  input.clear();

  while (true) {
    yield scene.makeScene();

    var w = 45;
    var party = partyTrailAdapter.getPartyState();
    var maxPartyMemberIndex = getMaxPartyMemberIndexValue();
    for (var i = 0; i <= maxPartyMemberIndex; i++) {
      var member = party[i];
      if (member) {
        uibattle.playerInfoBox(
          PAL_XY(w, 165),
          member.playerRole,
          100,
          uibattle.TIMEMETER_COLOR_DEFAULT,
          false
        );
      }
      w += 78;
    }

    w = magicmenu.magicSelectMenuUpdate();
    surface.updateScreen(null);

    input.clear();

    if (w != 0xFFFF) {
      return w;
    }

    yield sleepByFrame(1);
  }

  throw 'should not be here';
};

export default magicmenu;
