import { isOwnedBattleCancelled } from '../../services/battle-command-runtime';
import utils from './utils';
import ui from './ui';
import uigame from './uigame';
import input from './input';
import play from './play';
import scene from './scene';
import dialogService from '../../services/dialog-service';
import script from '../../services/script-service';
import res from './res';
import resourceService from '../../services/resource-service';
import storageService from '../../services/storage-service';
import worldService from '../../services/world-service';
import partyTrailAdapter from '../../services/party-trail-adapter';
import overviewController from './overview-controller.js';
import panoramaRenderer from './panorama-renderer.js';
import panoramaControls from './panorama-controls.js';
import panoramaDialog from './panorama-dialog.js';
import config from './config';
import { storyGraphService } from '../../services/storygraph-service';
import {
  getPlayerRolesSnapshot,
  getMaxPartyMemberIndex as getMaxPartyMemberIndexValue
} from '../../services/player-state-adapter';
import scriptObjectAdapter from '../../services/script-object-adapter';
import battleService from '../../services/battle-service';
import { installUiWaitPoints, installBattleWaitPoints, installMainLoopWaitPoints } from '../../services/wait-points';
import { inventorySignals } from '../../state/slices/inventory';
import { hydrateGeneratedGameData } from '../../services/generated-game-data';
import debugUtils from './debug-utils';
import {
  getMusicTrack as getCachedMusicTrack,
  getBattleMusicTrack as getCachedBattleMusicTrack,
  getBattleFieldId as getCachedBattleFieldId
} from '../../services/battle-state-adapter.js';
import {
  getCollectValue as getCollectValueFlagValue,
  getChaseRange as getChaseRangeFlagValue,
  getChaseSpeedChangeCycles as getChaseSpeedCyclesFlagValue,
  getBattleSpeed as getBattleSpeedFlagValue
} from '../../services/game-flags-adapter';
import {
  getViewportValue as getViewportSnapshot,
  getPartyOffsetValue as getPartyOffsetSnapshot,
  getPaletteIdValue as getPaletteIdSnapshot,
  getPartyDirectionValue as getPartyDirectionSnapshot,
  getCurrentSaveSlotValue,
  isNightPaletteEnabled,
  getScreenWaveValue as getScreenWaveSnapshot,
  getLayerValue as getLayerSnapshot
} from '../../services/environment-adapter';
import { getSceneIdValue as getSceneIdSnapshot } from '../../services/scene-state-adapter';
import {
  getPartyStructSnapshot,
  getTrailStructSnapshot,
  getExpStructSnapshot
} from '../../services/save-data-adapter';
// import { log } from './util-trace';
import {
  Const,
  Files,
  PlayerStatus,
  PlayerRoles,
  Inventory,
  Party,
  Trail,
  AllExperience,
  PoisonStatus,
  SaveData,
  Scene,
  ObjectUnion,
  EventObject,
  ScriptEntry,
  Store,
  Enemy,
  EnemyTeam,
  Magic,
  BattleField,
  LevelUpMagicAll,
  EnemyPos,
  PAL_XY,
  PAL_X,
  PAL_Y
} from './pal-global';
import { memcpy } from './utils';
import { readTypedArray } from './binary-helper';
import { sleepByFrame, sleepSceneFrame } from './common';

// Define types for global objects if needed
declare const global: any;
declare const window: any;
declare const GameData: any;
declare const log: any;
declare const PAL_CLASSIC: boolean;

const game: any = {};

const inventorySlice = inventorySignals();
const cashSignal = inventorySlice.cash;
const overlayDefaultMode = config.enablePanorama ? 'panorama' : 'off';
let overlayCurrentMode = overlayDefaultMode;

function setOverlayMode(mode: string) {
  const normalized = mode === 'panorama' ? 'panorama' : 'off';
  if (overlayCurrentMode === normalized) {
    return normalized;
  }
  if (typeof window !== 'undefined' && typeof (window as any).PAL_SET_OVERLAY_MODE === 'function') {
    (window as any).PAL_SET_OVERLAY_MODE(normalized);
  } else {
    if (panoramaRenderer && typeof panoramaRenderer.setMode === 'function') {
      panoramaRenderer.setMode(normalized);
    }
    if (panoramaControls && typeof panoramaControls.setMode === 'function') {
      panoramaControls.setMode(normalized);
    }
    if (panoramaDialog && typeof panoramaDialog.setMode === 'function') {
      panoramaDialog.setMode(normalized);
    }
    if (typeof window !== 'undefined') {
      (window as any).PAL_OVERLAY_ACTIVE = normalized;
    }
  }
  overlayCurrentMode = normalized;
  return normalized;
}

function activateNewGameClassicDialog() {
  if (typeof window === 'undefined') {
    setOverlayMode('off');
    return;
  }
  const win = window as any;
  if (!win.PAL_NEWGAME_CLASSIC_DIALOG) {
    win.PAL_NEWGAME_CLASSIC_DIALOG = true;
    win.PAL_NEWGAME_DIALOG_SEEN = false;
    win.PAL_NEWGAME_DIALOG_STARTED_AT = Date.now();
    win.PAL_NEWGAME_OVERLAY_PREF = win.PAL_OVERLAY_PREFERENCE || win.PAL_OVERLAY_ACTIVE || overlayDefaultMode;
  }
  if (typeof win.PAL_SET_GPS_MODE === 'function') {
    win.PAL_SET_GPS_MODE(false);
  }
  if (typeof win.PAL_SET_OVERLAY_MODE === 'function') {
    win.PAL_SET_OVERLAY_MODE('off');
  } else {
    setOverlayMode('off');
  }
}

function enforceNewGameClassicDialog() {
  if (typeof window === 'undefined') {
    return;
  }
  const win = window as any;
  if (!win.PAL_NEWGAME_CLASSIC_DIALOG || win.PAL_FBP_ACTIVE) {
    return;
  }
  const status = dialogService && typeof dialogService.getStatus === 'function'
    ? dialogService.getStatus()
    : null;
  if (status && status.active) {
    win.PAL_NEWGAME_DIALOG_SEEN = true;
  }
  if (typeof win.PAL_SET_GPS_MODE === 'function') {
    win.PAL_SET_GPS_MODE(false);
  }
  if (win.PAL_OVERLAY_ACTIVE !== 'off' && typeof win.PAL_SET_OVERLAY_MODE === 'function') {
    win.PAL_SET_OVERLAY_MODE('off');
  }
}

function restoreNewGameOverlayIfReady() {
  if (typeof window === 'undefined') {
    return;
  }
  const win = window as any;
  if (!win.PAL_NEWGAME_CLASSIC_DIALOG || win.PAL_FBP_ACTIVE) {
    return;
  }
  const status = dialogService && typeof dialogService.getStatus === 'function'
    ? dialogService.getStatus()
    : null;
  if (status && status.active) {
    win.PAL_NEWGAME_DIALOG_SEEN = true;
    return;
  }
  if (worldService.isEnteringScene()) {
    return;
  }
  const startedAt = typeof win.PAL_NEWGAME_DIALOG_STARTED_AT === 'number'
    ? win.PAL_NEWGAME_DIALOG_STARTED_AT
    : 0;
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  const seen = !!win.PAL_NEWGAME_DIALOG_SEEN;
  if (!seen && elapsed < 800) {
    return;
  }
  const restoreMode = win.PAL_NEWGAME_OVERLAY_PREF || win.PAL_OVERLAY_PREFERENCE || overlayDefaultMode;
  if (restoreMode === 'gps' && typeof win.PAL_SET_GPS_MODE === 'function') {
    win.PAL_SET_GPS_MODE(true);
  } else if (typeof win.PAL_SET_OVERLAY_MODE === 'function') {
    win.PAL_SET_OVERLAY_MODE(restoreMode);
  } else {
    setOverlayMode(restoreMode);
  }
  win.PAL_NEWGAME_CLASSIC_DIALOG = false;
  win.PAL_NEWGAME_DIALOG_SEEN = false;
  win.PAL_NEWGAME_DIALOG_STARTED_AT = null;
  win.PAL_NEWGAME_OVERLAY_PREF = null;
}

function normaliseSaveBuffer(buffer: any) {
  var size = (typeof SaveData !== 'undefined' && SaveData && typeof SaveData.size === 'number')
    ? SaveData.size
    : 0;
  var result = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  if (!size || result.length === size) {
    return result;
  }
  if (result.length < size) {
    var padded = new Uint8Array(size);
    padded.set(result);
    return padded;
  }
  return result.subarray(0, size);
}

function toUint8Array(buffer: any): Uint8Array | null {
  if (!buffer) {
    return null;
  }
  if (Array.isArray(buffer)) {
    return Uint8Array.from(buffer);
  }
  if (buffer instanceof Uint8Array) {
    return buffer;
  }
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength || 0);
  }
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  return null;
}

function coerceStructArray(value: any, ctor: any, count: number, label: string) {
  if (Array.isArray(value)) {
    return value;
  }
  const raw = value && value.uint8Array ? value.uint8Array : (value instanceof Uint8Array ? value : null);
  const stride = ctor && typeof ctor.size === 'number' ? ctor.size : 0;
  if (!raw || !stride || !Number.isFinite(count) || count <= 0) {
    return value;
  }
  const total = Math.min(count, Math.floor(raw.length / stride));
  const list = new Array(total);
  for (let i = 0; i < total; i++) {
    const start = i * stride;
    list[i] = new ctor(raw.subarray(start, start + stride));
  }
  (list as any).uint8Array = raw.subarray(0, total * stride);
  console.warn('[GAME] coerced struct array', label, { count: total, stride });
  return list;
}

const SAVE_PARTY_OFFSET = 44;
const SAVE_PARTY_STRIDE = 10;
const SAVE_TRAIL_STRIDE = 6;
const SAVE_HEADER_WORDS = 17 + 3;
const SAVE_HEADER_BYTES = SAVE_HEADER_WORDS * 2 + 4;
const DATA_CHUNKS = {
  store: 0,
  enemy: 1,
  enemyTeam: 2,
  playerRoles: 3,
  magic: 4,
  battleField: 5,
  levelUpMagic: 6,
  battleEffectIndex: 11,
  enemyPos: 13,
  levelUpExp: 14
} as const;

function readWordArray(bytes: Uint8Array | null, count: number) {
  const result = new Array(count).fill(0);
  if (!bytes || bytes.length < 2) {
    return result;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const max = Math.min(count, Math.floor(bytes.length / 2));
  for (let i = 0; i < max; i++) {
    result[i] = view.getUint16(i * 2, true);
  }
  return result;
}

function readWordMatrix(bytes: Uint8Array | null, rows: number, cols: number) {
  const result = new Array(rows);
  if (!bytes || bytes.length < 2) {
    for (let r = 0; r < rows; r++) {
      result[r] = new Array(cols).fill(0);
    }
    return result;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const max = Math.floor(bytes.length / 2);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      row[c] = index < max ? view.getUint16(index * 2, true) : 0;
    }
    result[r] = row;
  }
  return result;
}

function readPartyFromSaveBuffer(buffer: Uint8Array | null, maxMembers: number) {
  if (!buffer || !Number.isFinite(maxMembers) || maxMembers <= 0) {
    return null;
  }
  const totalBytes = SAVE_PARTY_STRIDE * maxMembers;
  if (buffer.length < SAVE_PARTY_OFFSET + totalBytes) {
    return null;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const list: any[] = new Array(maxMembers);
  for (let i = 0; i < maxMembers; i++) {
    const base = SAVE_PARTY_OFFSET + i * SAVE_PARTY_STRIDE;
    list[i] = {
      playerRole: view.getUint16(base, true),
      x: view.getInt16(base + 2, true),
      y: view.getInt16(base + 4, true),
      frame: view.getUint16(base + 6, true),
      imageOffset: view.getUint16(base + 8, true)
    };
  }
  (list as any).uint8Array = buffer.subarray(SAVE_PARTY_OFFSET, SAVE_PARTY_OFFSET + totalBytes);
  return list;
}

function readTrailFromSaveBuffer(buffer: Uint8Array | null, maxMembers: number) {
  if (!buffer || !Number.isFinite(maxMembers) || maxMembers <= 0) {
    return null;
  }
  const totalBytes = SAVE_TRAIL_STRIDE * maxMembers;
  const trailOffset = SAVE_PARTY_OFFSET + SAVE_PARTY_STRIDE * maxMembers;
  if (buffer.length < trailOffset + totalBytes) {
    return null;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const list: any[] = new Array(maxMembers);
  for (let i = 0; i < maxMembers; i++) {
    const base = trailOffset + i * SAVE_TRAIL_STRIDE;
    list[i] = {
      x: view.getUint16(base, true),
      y: view.getUint16(base + 2, true),
      direction: view.getUint16(base + 4, true)
    };
  }
  (list as any).uint8Array = buffer.subarray(trailOffset, trailOffset + totalBytes);
  return list;
}

function resolveAllExperienceSize() {
  if (typeof AllExperience !== 'undefined' && AllExperience && typeof (AllExperience as any).size === 'number') {
    return (AllExperience as any).size;
  }
  const maxRoles = typeof Const !== 'undefined' && Const && typeof Const.MAX_PLAYER_ROLES === 'number'
    ? Const.MAX_PLAYER_ROLES
    : 6;
  return 8 * maxRoles * 8;
}

function createEmptyExpStruct() {
  if (typeof AllExperience === 'undefined' || !AllExperience || typeof (AllExperience as any).size !== 'number') {
    return null;
  }
  const size = (AllExperience as any).size;
  if (!size || size <= 0) {
    return null;
  }
  try {
    return new (AllExperience as any)(new Uint8Array(size));
  } catch (err) {
    console.warn('[GAME] failed to create empty exp struct', err);
    return null;
  }
}

function readExpFromSaveBuffer(buffer: Uint8Array | null, maxMembers: number) {
  if (!buffer) {
    return null;
  }
  const expSize = resolveAllExperienceSize();
  if (!expSize || typeof AllExperience === 'undefined' || !AllExperience) {
    return null;
  }
  const expOffset = SAVE_HEADER_BYTES + SAVE_PARTY_STRIDE * maxMembers + SAVE_TRAIL_STRIDE * maxMembers;
  if (buffer.length < expOffset + expSize) {
    return null;
  }
  const slice = buffer.subarray(expOffset, expOffset + expSize);
  try {
    return new (AllExperience as any)(slice);
  } catch (err) {
    console.warn('[GAME] failed to parse exp from raw save buffer', err);
    return null;
  }
}

function readPlayerRolesFromSaveBuffer(buffer: Uint8Array | null, maxMembers: number) {
  if (!buffer) {
    return null;
  }
  const expSize = resolveAllExperienceSize();
  const playerRolesSize = typeof PlayerRoles !== 'undefined' && PlayerRoles && typeof (PlayerRoles as any).size === 'number'
    ? (PlayerRoles as any).size
    : 0;
  if (!expSize || !playerRolesSize) {
    return null;
  }
  const offset = SAVE_HEADER_BYTES + SAVE_PARTY_STRIDE * maxMembers + SAVE_TRAIL_STRIDE * maxMembers + expSize;
  if (buffer.length < offset + playerRolesSize) {
    return null;
  }
  const slice = buffer.subarray(offset, offset + playerRolesSize);
  try {
    const roles = new (PlayerRoles as any)(slice);
    return roles;
  } catch (err) {
    console.warn('[GAME] failed to parse player roles from save buffer', err);
    return null;
  }
}

function hasValidPlayerRoles(value: any) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const spriteNums = (value as any).spriteNum;
  if (!spriteNums) {
    return false;
  }
  const list = Array.isArray(spriteNums)
    ? spriteNums
    : (ArrayBuffer.isView(spriteNums) ? Array.from(spriteNums as unknown as ArrayLike<number>) : []);
  if (!list.length) {
    return false;
  }
  return list.some((entry) => typeof entry === 'number' && entry > 0);
}

function patchPlayerBattleSprites(target: any, fallback: any) {
  if (!target || typeof target !== 'object') {
    return 0;
  }
  const battleSprites = (target as any).spriteNumInBattle;
  if (!battleSprites) {
    if (fallback && (fallback as any).spriteNumInBattle) {
      (target as any).spriteNumInBattle = (fallback as any).spriteNumInBattle;
      return ArrayBuffer.isView((fallback as any).spriteNumInBattle)
        ? ((fallback as any).spriteNumInBattle as ArrayLike<number>).length
        : Array.isArray((fallback as any).spriteNumInBattle)
          ? (fallback as any).spriteNumInBattle.length
          : 0;
    }
    return 0;
  }
  const fallbackSprites = fallback && (fallback as any).spriteNumInBattle
    ? (fallback as any).spriteNumInBattle
    : null;
  if (!fallbackSprites) {
    return 0;
  }
  const maxChunk = Files && Files.F && typeof (Files.F as any).getChunkCount === 'function'
    ? (Files.F as any).getChunkCount()
    : 0;
  const length = Math.min(
    (battleSprites as ArrayLike<number>).length || 0,
    (fallbackSprites as ArrayLike<number>).length || 0
  );
  let patched = 0;
  for (let i = 0; i < length; i++) {
    const value = (battleSprites as ArrayLike<number>)[i];
    const valid = typeof value === 'number'
      && value > 0
      && (maxChunk ? value < maxChunk : true);
    if (!valid) {
      const fallbackValue = (fallbackSprites as ArrayLike<number>)[i];
      if (typeof fallbackValue === 'number' && fallbackValue > 0) {
        (battleSprites as ArrayLike<number> as number[])[i] = fallbackValue;
        patched += 1;
      }
    }
  }
  return patched;
}

function hasValidExpStruct(value: any) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const types = (typeof AllExperience !== 'undefined' && AllExperience && (AllExperience as any).types)
    ? (AllExperience as any).types
    : null;
  if (Array.isArray(types) && types.length > 0) {
    return types.some((name: string) => Array.isArray((value as any)[name]));
  }
  return Array.isArray((value as any).primaryExp);
}

function coerceSaveStructs(s: any, rawBuffer?: Uint8Array | null) {
  if (!s || typeof s !== 'object') {
    return s;
  }
  const maxMembers = typeof Const !== 'undefined' && Const && typeof Const.MAX_PLAYABLE_PLAYER_ROLES === 'number'
    ? Const.MAX_PLAYABLE_PLAYER_ROLES
    : 5;
  const saveBuffer = rawBuffer || (s.uint8Array instanceof Uint8Array ? s.uint8Array : null);
  const partyTable = coerceStructArray(s.party, Party, Const.MAX_PLAYABLE_PLAYER_ROLES, 'party');
  if (partyTable !== s.party) {
    s.party = partyTable;
  }
  const trailTable = coerceStructArray(s.trail, Trail, Const.MAX_PLAYABLE_PLAYER_ROLES, 'trail');
  if (trailTable !== s.trail) {
    s.trail = trailTable;
  }
  if (!Array.isArray(s.party) || s.party.length === 0) {
    const fallbackParty = readPartyFromSaveBuffer(saveBuffer, maxMembers);
    if (fallbackParty) {
      s.party = fallbackParty;
      console.warn('[GAME] restored party from raw save buffer', { count: fallbackParty.length });
    }
  }
  if (!Array.isArray(s.trail) || s.trail.length === 0) {
    const fallbackTrail = readTrailFromSaveBuffer(saveBuffer, maxMembers);
    if (fallbackTrail) {
      s.trail = fallbackTrail;
      console.warn('[GAME] restored trail from raw save buffer', { count: fallbackTrail.length });
    }
  }
  if (!hasValidPlayerRoles(s.playerRoles)) {
    const fallbackRoles = readPlayerRolesFromSaveBuffer(saveBuffer, maxMembers);
    if (fallbackRoles) {
      s.playerRoles = fallbackRoles;
      const sample = (fallbackRoles as any).spriteNum;
      console.warn('[GAME] restored player roles from raw save buffer', {
        spriteNum: Array.isArray(sample) ? sample.slice(0, 6) : sample
      });
    }
  }
  const expDebug = {
    hasExp: !!s.exp,
    expType: typeof s.exp,
    expHasUint8Array: !!(s.exp as any)?.uint8Array,
    expUint8ArrayLength: (s.exp as any)?.uint8Array?.length,
    hasPrimaryExp: Array.isArray((s.exp as any)?.primaryExp),
    primaryExpLength: (s.exp as any)?.primaryExp?.length,
    hasHealthExp: Array.isArray((s.exp as any)?.healthExp),
    allExpTypes: (typeof AllExperience !== 'undefined' && (AllExperience as any).types) || null,
    isValid: hasValidExpStruct(s.exp)
  };
  console.log('[GAME] coerceSaveStructs: checking exp validity', expDebug);

  if (!hasValidExpStruct(s.exp)) {
    const fallbackExp = readExpFromSaveBuffer(saveBuffer, maxMembers);
    const emptyExp = fallbackExp || createEmptyExpStruct();
    if (emptyExp) {
      s.exp = emptyExp;
      console.warn('[GAME] restored exp from fallback', {
        source: fallbackExp ? 'save-buffer' : 'empty-default',
        size: (emptyExp as any).uint8Array ? (emptyExp as any).uint8Array.length : null
      });
    } else if (s.exp != null) {
      console.warn('[GAME] invalid exp struct in save data', { exp: s.exp });
    }
  }
  return s;
}

function hasValidParty(s: any) {
  if (!s || typeof s !== 'object') {
    console.warn('[GAME] hasValidParty: saveData is not an object');
    return false;
  }
  const party = Array.isArray(s.party) ? s.party : null;
  if (!party || party.length === 0) {
    console.warn('[GAME] hasValidParty: party is empty or not an array', {
      hasParty: !!s.party,
      isArray: Array.isArray(s.party),
      length: s.party?.length
    });
    return false;
  }
  const maxRoles = typeof Const !== 'undefined' && Const && typeof Const.MAX_PLAYER_ROLES === 'number'
    ? Const.MAX_PLAYER_ROLES
    : 6;
  const isValid = party.some((member: any) => member && typeof member.playerRole === 'number'
    && member.playerRole >= 0 && member.playerRole < maxRoles);

  if (!isValid) {
    console.warn('[GAME] hasValidParty: no valid party members found', {
      partyLength: party.length,
      sampleMember: party[0],
      maxRoles
    });
  } else {
    console.log('[GAME] hasValidParty: valid party found', {
      partyLength: party.length,
      validMembers: party.filter((m: any) => m && typeof m.playerRole === 'number').length
    });
  }

  return isValid;
}
let generatedGameDataFallback: any = null;

if (typeof globalThis !== 'undefined') {
  (globalThis as any).debugUtils = debugUtils;
} else if (typeof window !== 'undefined') {
  window.debugUtils = debugUtils;
} else if (typeof global !== 'undefined') {
  global.debugUtils = debugUtils;
}


function mutateExp(mutator: any) {
  return worldService.mutateExpState(function(exp: any) {
    if (exp && typeof mutator === 'function') {
      mutator(exp);
    }
    return exp;
  });
}

function encodeSavePayload(saveData: any, savedTimes: number, timestamp: number) {
  var buf = saveData.uint8Array;
  console.log('[GAME] encodeSavePayload: encoding', {
    bufferLength: buf.length,
    savedTimes,
    timestamp,
    firstBytes: Array.from(buf.slice(0, 20)),
    saveDataNumScene: saveData.numScene,
    saveDataCash: saveData.cash
  });

  var arr = new Array(buf.length);
  for (var i = 0; i < buf.length; ++i) {
    arr[i] = buf[i];
  }
  return {
    version: 1,
    savedTimes: savedTimes || 0,
    timestamp: timestamp || Date.now(),
    bytes: arr
  };
}

function getGameDataTable(key: string) {
  if (typeof GameData !== 'undefined' && GameData && GameData[key]) {
    return GameData[key];
  }
  return null;
}

function readStorageSlot(slot: number) {
  var parsed: any;
  var entry = storageService.readSlot(slot);
  if (!entry && slot == 1 && storageService.isAvailable() && (storageService as any).storage) {
    var legacyRaw = (storageService as any).storage.getItem('PAL-SAVE');
    if (legacyRaw) {
      try {
        parsed = JSON.parse(legacyRaw);
      } catch (ex) {
        entry = null;
      }
    }
  }
  if (!entry) return null;
  parsed = entry;
  var bytes = null;
  if (Array.isArray(parsed)) {
    bytes = parsed;
    parsed = { bytes: bytes };
  } else if (parsed && parsed.bytes) {
    bytes = parsed.bytes;
  }
  if (!bytes || !bytes.length) {
    return null;
  }
  var buf = new Uint8Array(bytes.length);
  for (var i = 0; i < bytes.length; ++i) {
    buf[i] = bytes[i] & 0xFF;
  }
  buf = normaliseSaveBuffer(buf);
  var saveData = new SaveData(buf);
  var savedTimes = 0;
  if (parsed.savedTimes != null) {
    savedTimes = parsed.savedTimes;
    saveData.savedTimes = savedTimes;
  } else if (typeof saveData.savedTimes === 'number') {
    savedTimes = saveData.savedTimes;
  }
  return {
    saveData: saveData,
    savedTimes: savedTimes,
    timestamp: parsed.timestamp || 0
  };
}

game.init = function*(surf: any): Generator<any, any, any> {
  log.debug('[Game] init');
  if (typeof global !== 'undefined') global.game = game;
  yield play.init(surf);
  // 等待点声明(docs/specs/agent-pal-waits.md W2):ui / 战斗 / 主循环模块此时都已初始化,且在标题菜单之前;
  // 纯埋点,不改游戏逻辑
  installUiWaitPoints({ ui, uigame, itemmenu: (ui as any).itemmenu, magicmenu: (ui as any).magicmenu, inputService: input, dialogService, scriptObjects: scriptObjectAdapter });
  if ((ui as any).uibattle) {
    installBattleWaitPoints({ uibattle: (ui as any).uibattle, battleService, ui, itemmenu: (ui as any).itemmenu, magicmenu: (ui as any).magicmenu, scriptObjects: scriptObjectAdapter });
  }
  installMainLoopWaitPoints({ play, scriptService: script, battleService });
};

game.clearPlayerStatus = function() {
  //Global.playerStatus = initTypedArray(PlayerStatus, Const.MAX_PLAYER_ROLES);
  var arr = [];
  for (var i=0; i<Const.MAX_PLAYER_ROLES; ++i) {
    var st = [];
    for (var j=0; j<PlayerStatus.All; ++j) {
      st[j] = 0;
    }
    arr.push(st);
  }
  worldService.setPlayerStatusStruct(arr);
};

game.loadDefaultGame = function*(): Generator<any, any, any> {
  // Load the default data from the game data files.
  if (Files.SSS && Files.DATA) {
    worldService.setEventObjectTable(readTypedArray(EventObject, Files.SSS.readChunk(0)));
    worldService.setSceneTable(readTypedArray(Scene, Files.SSS.readChunk(1)));
    worldService.setObjectTable(readTypedArray(ObjectUnion, Files.SSS.readChunk(2)));
    worldService.setScriptEntries(readTypedArray(ScriptEntry, Files.SSS.readChunk(4)));
    worldService.setPlayerRoles(new PlayerRoles(Files.DATA.readChunk(3)));
  } else if (generatedGameDataFallback) {
    if (generatedGameDataFallback.eventObjects) {
      worldService.setEventObjectTable(generatedGameDataFallback.eventObjects);
    }
    if (generatedGameDataFallback.scenes) {
      worldService.setSceneTable(generatedGameDataFallback.scenes);
    }
    if (generatedGameDataFallback.objects) {
      worldService.setObjectTable(generatedGameDataFallback.objects);
    }
    if (generatedGameDataFallback.playerRoles) {
      worldService.setPlayerRoles(generatedGameDataFallback.playerRoles);
    }
  } else {
    throw new Error('Default game data is unavailable: missing SSS.MKF/DATA.MKF and generated fallback data');
  }
  const defaultExp = createEmptyExpStruct();
  if (defaultExp) {
    worldService.setExpStruct(defaultExp);
  } else {
    console.warn('[GAME] default exp struct unavailable');
  }

  // Reset scene cache BEFORE setting sceneId to ensure background will reload
  // This fixes the issue where starting a new game shows stale background
  if (scene && typeof scene.resetSceneCache === 'function') {
    scene.resetSceneCache();
    console.log('[GAME] loadDefaultGame: reset scene cache to force background refresh');
  }

  // Reset opening menu background cache to ensure menu background updates on new game
  // This fixes the issue where the start menu shows stale background after starting a new game
  if (uigame && typeof uigame.resetOpeningMenuBackground === 'function') {
    uigame.resetOpeningMenuBackground();
    console.log('[GAME] loadDefaultGame: reset opening menu background cache');
  }

  // Set some other default data.
  worldService.setCash(0);
  worldService.setMusicTrack(0);
  worldService.setPaletteId(0);
  worldService.setSceneId(1);
  worldService.setCollectValue(0);
  worldService.setNightPaletteFlag(false);
  worldService.setMaxPartyMemberIndex(0);
  // Default camera to origin; offset keeps hero near center of 320x200 view.
  worldService.setViewport(PAL_XY(0, 0));
  worldService.setPartyOffset(PAL_XY(160, 112));
  worldService.setLayer(0);
  worldService.setChaseRange(1);
  if (!PAL_CLASSIC) {
    worldService.setBattleSpeed(2);
  }
  worldService.setEnteringScene(true);

  // Sync scene/map state after loading default game data
  worldService.syncScene();
  worldService.syncMapMeta();
  worldService.syncMapTiles();
  worldService.syncEventObjects();
  worldService.ensureCollisionState();

  // Scene cache has been reset earlier (line 769), which ensures that
  // when the entry script completes and makeScene() is called, the
  // background will be properly reloaded for the new game.
  // The entry script (scriptOnEnter: 7952) is responsible for setting
  // the correct initial viewport and event object positions.

  // 新游戏的背包必须预置空槽:addItemToInventory 只往已有槽位里写(找 item===0 的空槽),
  // 空数组 → 「得到某物」静默丢失(开场桂花酒拿不到,酒剑仙剧情卡死)。
  // 必须是 SaveData 同款的结构体数组(带 uint8Array 底):_saveGame 只从 uint8Array 拷背包,
  // 普通对象数组能用但存不进档。
  // As in SDLPAL PAL_LoadDefaultGame: rgInventory, rgPoisonStatus, rgParty and
  // rgTrail are zeroed and nFollower is reset, so starting over in the same
  // session does not keep the previous party/trail/poison/followers.
  const blankSave: any = new SaveData(new Uint8Array(SaveData.size));
  worldService.setInventoryStruct(blankSave.inventory);
  worldService.setPoisonStatusStruct(blankSave.poisonStatus);
  worldService.setPartyStruct(coerceStructArray(blankSave.party, Party, Const.MAX_PLAYABLE_PLAYER_ROLES, 'party'));
  worldService.setTrailStruct(coerceStructArray(blankSave.trail, Trail, Const.MAX_PLAYABLE_PLAYER_ROLES, 'trail'));
  worldService.setFollowerCount(0);

  //utils.extend(Global, {
  //  inventory: initTypedArray(Inventory, Const.MAX_INVENTORY),
  //  poisonStatus: [],
  //  party: initTypedArray(Party, Const.MAX_PLAYABLE_PLAYER_ROLES),
  //  trail: initTypedArray(Trail, Const.MAX_PLAYABLE_PLAYER_ROLES),
  //  exp: new AllExperience(null),
  //  enteringScene: true
  //});
  //for (var i=0; i<Const.MAX_POISONS; ++i){
  //  Global.poisonStatus[i] = initTypedArray(PoisonStatus, Const.MAX_PLAYABLE_PLAYER_ROLES);
  //}
  mutateExp(function(exp: any) {
    if (!exp) return exp;
    const roles = getPlayerRolesSnapshot() as any;
    const levels = roles && roles.level ? roles.level : null;
    for (var i = 0; i < Const.MAX_PLAYER_ROLES; ++i) {
      AllExperience.types.forEach(function(name: string) {
        if (exp[name] && exp[name][i] && levels) {
          exp[name][i].level = levels[i];
        }
      });
    }
    return exp;
  });
};

/**
 * Initialize global game data.
 */
game.initGlobalGameData = function*(): Generator<any, any, any> {
  if (!Files.SSS || !Files.DATA) {
    const generatedPayload: any = yield resourceService.loadGeneratedGameData();
    generatedGameDataFallback = generatedPayload ? hydrateGeneratedGameData(generatedPayload) : null;
    if (generatedGameDataFallback) {
      // Apply immediately so the world-service caches (script/object tables, etc.) stay in sync.
      worldService.setEventObjectTable(generatedGameDataFallback.eventObjects || []);
      worldService.setSceneTable(generatedGameDataFallback.scenes || []);
      worldService.setObjectTable(generatedGameDataFallback.objects || []);
      if (generatedGameDataFallback.playerRoles) {
        worldService.setPlayerRoles(generatedGameDataFallback.playerRoles);
      }
      if (generatedGameDataFallback.scriptEntries) {
        worldService.setScriptEntries(generatedGameDataFallback.scriptEntries);
      }
      if (generatedGameDataFallback.store) {
        worldService.setStoreTable(generatedGameDataFallback.store);
      }
      if (generatedGameDataFallback.enemy) {
        worldService.setEnemyTable(generatedGameDataFallback.enemy);
      }
      if (generatedGameDataFallback.enemyTeam) {
        worldService.setEnemyTeamTable(generatedGameDataFallback.enemyTeam);
      }
      if (generatedGameDataFallback.magic) {
        worldService.setMagicTable(generatedGameDataFallback.magic);
      }
      if (generatedGameDataFallback.battleField) {
        worldService.setBattleFieldTable(generatedGameDataFallback.battleField);
      }
      if (generatedGameDataFallback.levelUpMagic) {
        worldService.setLevelUpMagicTable(generatedGameDataFallback.levelUpMagic);
      }
      if (generatedGameDataFallback.battleEffectIndex) {
        worldService.setBattleEffectIndexTable(generatedGameDataFallback.battleEffectIndex);
      }
      if (generatedGameDataFallback.enemyPos) {
        worldService.setEnemyPositionTable(generatedGameDataFallback.enemyPos);
      }
      if (generatedGameDataFallback.levelUpExp) {
        worldService.setLevelUpExpTable(generatedGameDataFallback.levelUpExp);
      }
      if (console && console.debug) {
        console.debug('[Game] loaded generated fallback', {
          scenes: generatedGameDataFallback.scenes && generatedGameDataFallback.scenes.length,
          eventObjects: generatedGameDataFallback.eventObjects && generatedGameDataFallback.eventObjects.length,
          scriptEntries: generatedGameDataFallback.scriptEntries && generatedGameDataFallback.scriptEntries.length
        });
      }
    } else if (console && console.warn) {
      console.warn('[Game] generated fallback game-data missing or invalid');
    }
  } else {
    generatedGameDataFallback = null;
  }

  // MKF bundles are preloaded during startup via the resource service.
  if (generatedGameDataFallback && generatedGameDataFallback.scriptEntries) {
    worldService.setScriptEntries(generatedGameDataFallback.scriptEntries);
  } else if (Files.SSS) {
    worldService.setScriptEntries(readTypedArray(ScriptEntry, Files.SSS.readChunk(4)));
  } else {
    throw new Error('Generated game data fallback is unavailable and SSS.MKF is missing');
  }

  if (generatedGameDataFallback) {
    if (generatedGameDataFallback.store) {
      worldService.setStoreTable(generatedGameDataFallback.store);
    }
    if (generatedGameDataFallback.enemy) {
      worldService.setEnemyTable(generatedGameDataFallback.enemy);
    }
    if (generatedGameDataFallback.enemyTeam) {
      worldService.setEnemyTeamTable(generatedGameDataFallback.enemyTeam);
    }
    if (generatedGameDataFallback.magic) {
      worldService.setMagicTable(generatedGameDataFallback.magic);
    }
    if (generatedGameDataFallback.battleField) {
      worldService.setBattleFieldTable(generatedGameDataFallback.battleField);
    }
    if (generatedGameDataFallback.levelUpMagic) {
      worldService.setLevelUpMagicTable(generatedGameDataFallback.levelUpMagic);
    }
    if (generatedGameDataFallback.battleEffectIndex) {
      worldService.setBattleEffectIndexTable(generatedGameDataFallback.battleEffectIndex);
    }
    if (generatedGameDataFallback.enemyPos) {
      worldService.setEnemyPositionTable(generatedGameDataFallback.enemyPos);
    }
    if (generatedGameDataFallback.levelUpExp) {
      worldService.setLevelUpExpTable(generatedGameDataFallback.levelUpExp);
    }
  } else if (Files.DATA) {
    const data = Files.DATA;
    const storeTable = readTypedArray(Store, data.readChunk(DATA_CHUNKS.store));
    const enemyTable = readTypedArray(Enemy, data.readChunk(DATA_CHUNKS.enemy));
    const enemyTeamTable = readTypedArray(EnemyTeam, data.readChunk(DATA_CHUNKS.enemyTeam));
    const magicTable = readTypedArray(Magic, data.readChunk(DATA_CHUNKS.magic));
    const battleFieldTable = readTypedArray(BattleField, data.readChunk(DATA_CHUNKS.battleField));
    const levelUpMagicTable = readTypedArray(LevelUpMagicAll, data.readChunk(DATA_CHUNKS.levelUpMagic));
    const battleEffectIndex = readWordMatrix(data.readChunk(DATA_CHUNKS.battleEffectIndex), 10, 2);
    const enemyPosBytes = data.readChunk(DATA_CHUNKS.enemyPos);
    const enemyPos = enemyPosBytes && enemyPosBytes.length ? new EnemyPos(enemyPosBytes) : null;
    const levelUpExpTable = readWordArray(data.readChunk(DATA_CHUNKS.levelUpExp), Const.MAX_LEVELS);

    if (!storeTable.length) {
      console.warn('[GAME] DATA.MKF store table empty');
    }
    if (!enemyTable.length) {
      console.warn('[GAME] DATA.MKF enemy table empty');
    }
    if (!enemyTeamTable.length) {
      console.warn('[GAME] DATA.MKF enemy team table empty');
    }
    if (!magicTable.length) {
      console.warn('[GAME] DATA.MKF magic table empty');
    }
    if (!battleFieldTable.length) {
      console.warn('[GAME] DATA.MKF battle field table empty');
    }
    if (!levelUpMagicTable.length) {
      console.warn('[GAME] DATA.MKF level-up magic table empty');
    }
    if (!enemyPos) {
      console.warn('[GAME] DATA.MKF enemy position table empty');
    }

    worldService.setStoreTable(storeTable);
    worldService.setEnemyTable(enemyTable);
    worldService.setEnemyTeamTable(enemyTeamTable);
    worldService.setMagicTable(magicTable);
    worldService.setBattleFieldTable(battleFieldTable);
    worldService.setLevelUpMagicTable(levelUpMagicTable);
    worldService.setBattleEffectIndexTable(battleEffectIndex);
    worldService.setEnemyPositionTable(enemyPos);
    worldService.setLevelUpExpTable(levelUpExpTable);
  } else {
    throw new Error('Generated game data fallback is unavailable and DATA.MKF is missing');
  }

  // Load storygraph if scriptSource is set to 'storygraph'
  if (config.scriptSource === 'storygraph') {
    console.log('[Game] loading storygraph (scriptSource=storygraph)');
    yield storyGraphService.loadFullGameGraph();
  }
};

game.loadGame = function*(slot: number): Generator<any, any, any> {
  // Try to load from 0.RPG for new games (slot 0) to get correct initial positions
  // Fall back to default SSS tables if 0.RPG is not available
  const useStorage = slot !== 0;
  if (useStorage) {
    var entry = readStorageSlot(slot);
    console.log('[GAME] loadGame: readStorageSlot result', { slot, hasEntry: !!entry });
    if (entry) {
      const saveData = coerceSaveStructs(entry.saveData, entry.saveData?.uint8Array as Uint8Array | null);
      const validParty = hasValidParty(saveData);
      console.log('[GAME] loadGame: storage data validation', { slot, validParty, sceneId: saveData?.numScene });
      if (validParty) {
        console.log('[GAME] loadGame: loading from localStorage', { slot });
        return game._loadGame(saveData);
      }
      console.warn('[GAME] invalid save data in storage slot, will try .RPG file', slot, {
        partyLength: Array.isArray(saveData?.party) ? saveData.party.length : null,
        sceneId: saveData?.numScene
      });
    } else {
      console.log('[GAME] loadGame: no localStorage data, will try .RPG file', { slot });
    }
  }

  // Try to open the specified file.
  // Read all data from the file and close.
  const filename = slot + '.RPG';
  console.log('[GAME] loadGame: attempting to load', { slot, filename });
  try {
    var buffer: any = yield resourceService.loadFiles(filename);
    var rawBytes = toUint8Array(buffer);
    if (!rawBytes || rawBytes.length === 0) {
      throw new Error('empty save buffer');
    }
    // normaliseSaveBuffer will pad or truncate to the expected size
    var buf = normaliseSaveBuffer(rawBytes);
    const expectedSize = (typeof SaveData !== 'undefined' && SaveData && typeof SaveData.size === 'number')
      ? SaveData.size
      : 0;
    if (expectedSize && rawBytes.length !== expectedSize) {
      console.warn('[GAME] save file size mismatch', {
        slot,
        filename,
        actualSize: rawBytes.length,
        expectedSize,
        normalized: buf.length
      });
    }
    var sRaw: any = new SaveData(buf);
    var s = typeof sRaw.copy === 'function' ? sRaw.copy() : sRaw;
    s = coerceSaveStructs(s, buf);
    if (typeof s.numScene !== 'number' || s.numScene <= 0) {
      throw new Error('invalid save scene');
    }
  } catch (ex) {
    console.error('[GAME] failed to load save file', { slot, filename, error: ex });
    if (slot === 0) {
      console.warn('[GAME] failed to load new game file', filename, ex);
    }
    return false;
  }
  if (slot === 0) {
    console.debug('[GAME] loaded new game file', filename, {
      sceneId: s.numScene,
      viewportX: s.viewportX,
      viewportY: s.viewportY
    });
  }
  return game._loadGame(s, slot === 0);
};

game._loadGame = function(s: any, isNewGame: boolean = false) {
  console.log('[GAME] _loadGame: called with saveData', {
    hasData: !!s,
    isNewGame,
    numScene: s?.numScene,
    numPartyMember: s?.numPartyMember,
    partyLength: Array.isArray(s?.party) ? s.party.length : 0
  });

  const sBuffer = (s as any).uint8Array;

  // wMaxPartyMemberIndex = nPartyMember, as in PAL_LoadGame_Common. Only a corrupt header that
  // would index past rgParty (out of bounds in C) falls back to the last non-empty slot.
  let actualPartyCount = 0;
  if (s.party && Array.isArray(s.party)) {
    for (let i = 0; i < s.party.length && i < Const.MAX_PLAYABLE_PLAYER_ROLES; i++) {
      const member = s.party[i];
      if (member && typeof member.playerRole === 'number' && member.playerRole !== 0) {
        actualPartyCount = i + 1;
      }
    }
  }
  const headerPartyIndex = Number(s.numPartyMember);
  const correctedNumPartyMember = Number.isFinite(headerPartyIndex) && headerPartyIndex >= 0 && headerPartyIndex < Const.MAX_PLAYABLE_PLAYER_ROLES
    ? headerPartyIndex
    : (actualPartyCount > 0 ? actualPartyCount - 1 : 0);

  console.log('[GAME] _loadGame: starting to load game', {
    numScene: s.numScene,
    numPartyMember: s.numPartyMember,
    actualPartyCount,
    correctedNumPartyMember,
    viewportX: s.viewportX,
    viewportY: s.viewportY,
    cash: s.cash,
    hasParty: !!s.party,
    hasExp: !!s.exp,
    hasPlayerRoles: !!s.playerRoles,
    bufferNumPartyMember: sBuffer ? new DataView(sBuffer.buffer, sBuffer.byteOffset, sBuffer.byteLength).getUint16(6, true) : 'no buffer'
  });

  // Adjust endianness
  //DO_BYTESWAP(&s, sizeof(SAVEDGAME));

  // Cash amount is in DWORD, so do a wordswap in Big-Endian.
  //#if SDL_BYTEORDER == SDL_BIG_ENDIAN
  //s.dwCash = ((s.dwCash >> 16) | (s.dwCash << 16));
  //#endif

  // Get all the data from the saved game struct.
  worldService.setViewport(PAL_XY(s.viewportX, s.viewportY));
  worldService.setMaxPartyMemberIndex(correctedNumPartyMember);
  worldService.setSceneId(s.numScene);

  console.log('[GAME] _loadGame: set viewport and scene', {
    sceneId: s.numScene,
    viewport: PAL_XY(s.viewportX, s.viewportY),
    currentSceneAfterSet: worldService.getSceneId()
  });
  worldService.setNightPaletteFlag(s.paletteOffset !== 0);
  worldService.setPartyDirection(s.partyDirection);
  worldService.setMusicTrack(s.numMusic);
  worldService.setBattleMusicTrack(s.numBattleMusic);
  worldService.setBattleFieldId(s.numBattleField);
  worldService.setScreenWave(s.screenWave);
  worldService.setWaveProgression(0);
  worldService.setCollectValue(s.collectValue);
  worldService.setLayer(s.layer);
  worldService.setChaseRange(s.chaseRange);
  worldService.setChaseSpeedChangeCycles(s.chaseSpeedChangeCycles);
  worldService.setFollowerCount(s.numFollower);
  worldService.setCash(s.cash);
  if (!PAL_CLASSIC) {
    var nextBattleSpeed = s.battleSpeed;
    if (nextBattleSpeed > 5 || nextBattleSpeed == 0) {
      nextBattleSpeed = 2;
    }
    worldService.setBattleSpeed(nextBattleSpeed);
  }
  const partyTable = coerceStructArray(s.party, Party, Const.MAX_PLAYABLE_PLAYER_ROLES, 'party');

  // Copied as is, like PAL_LoadGame_Common (no de-duplication).
  if (Array.isArray(partyTable) && partyTable.length > 0) {
    worldService.setPartyStruct(partyTable);
  } else {
    console.warn('[GAME] save missing party data; keeping existing party');
  }
  const trailTable = coerceStructArray(s.trail, Trail, Const.MAX_PLAYABLE_PLAYER_ROLES, 'trail');
  console.log('[GAME] _loadGame: trail table', {
    length: trailTable?.length,
    trail: trailTable,
    first3: trailTable?.slice(0, 3)
  });
  if (Array.isArray(trailTable) && trailTable.length > 0) {
    worldService.setTrailStruct(trailTable);
  }
  worldService.setExpStruct(s.exp);
  if (hasValidPlayerRoles(s.playerRoles)) {
    const fallbackRoles = (Files && Files.DATA)
      ? new (PlayerRoles as any)(Files.DATA.readChunk(3))
      : (generatedGameDataFallback ? generatedGameDataFallback.playerRoles : null);
    const patched = patchPlayerBattleSprites(s.playerRoles, fallbackRoles);
    if (patched > 0) {
      console.warn('[GAME] patched battle sprites from fallback roles', { patched });
    }
    worldService.setPlayerRoles(s.playerRoles);
  } else if (Files.DATA) {
    try {
      const fallbackRoles = new (PlayerRoles as any)(Files.DATA.readChunk(3));
      worldService.setPlayerRoles(fallbackRoles);
      console.warn('[GAME] fallback player roles from DATA.MKF');
    } catch (err) {
      console.warn('[GAME] failed to fallback player roles from DATA.MKF', err);
    }
  }
  worldService.setPoisonStatusStruct(s.poisonStatus);
  // PAL_LoadGame clears all poisons after reading the save (they are not restored).
  worldService.resetPoisonStatusMatrix();
  worldService.syncStatusMatrices();
  worldService.setInventoryStruct(s.inventory);
  const sceneTable = coerceStructArray(s.scene, Scene, Const.MAX_SCENES, 'scene');
  const objectTable = coerceStructArray(s.object, ObjectUnion, Const.MAX_OBJECTS, 'object');
  const eventObjectTable = coerceStructArray(s.eventObject, EventObject, Const.MAX_EVENT_OBJECTS, 'eventObject');
  worldService.setSceneTable(sceneTable);
  worldService.setObjectTable(objectTable);
  worldService.setEventObjectTable(eventObjectTable);
  // Re-sync scene state after replacing tables to avoid stale map/meta data.
  worldService.syncScene();
  worldService.syncMapMeta();
  worldService.syncMapTiles();
  worldService.syncEventObjects();
  worldService.ensureCollisionState();

  // Match original sdlpal behavior: always set enteringScene=false after loading from .RPG
  // This applies to both new games (0.RPG) and saved games (N.RPG)
  // The scene entry script (with animations like Li Daniang walking) should only run
  // when 0.RPG does NOT exist and we load from default game data (SSS.MKF)
  worldService.setEnteringScene(false);
  console.log('[GAME] _loadGame: set enteringScene=false (loaded from .RPG file, isNewGame=' + isNewGame + ')');

  //PAL_CompressInventory();
  if (script.compressInventory) {
    script.compressInventory();
  }

  console.log('[GAME] _loadGame: completed successfully', {
    sceneId: s.numScene,
    partyMemberIndex: s.numPartyMember,
    finalSceneId: worldService.getSceneId(),
    finalViewport: worldService.getViewport()
  });

  // Success
  return true;
};

/**
 * 存档要的是整块字节(x.uint8Array)。没有 0.RPG 的新游戏里,背包/场景/物体/事件表是
 * readTypedArray 逐元素构造的数组 —— 每个元素各有 uint8Array,数组本身没有 → 旧逻辑整表跳过,
 * 存档里这些表全是 0,读档后场景换成 0 号地图、NPC 全没。这里把逐元素字节拼成整块。
 */
function withStructBytes(x: any): any {
  if (!x || x.uint8Array) return x;
  if (!Array.isArray(x) || !x.length || !x.every((el: any) => el && el.uint8Array instanceof Uint8Array)) return x;
  const total = x.reduce((n: number, el: any) => n + el.uint8Array.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const el of x) { bytes.set(el.uint8Array, off); off += el.uint8Array.length; }
  return { uint8Array: bytes };
}

/**
 * 存档(M2 D5b):各分区与 nPartyMember / nFollower / dwCash 全部从世界组件编码(组件见 ecs/components/state.ts),
 * 其余标量头照旧取自各自的状态。旧路径(从 Global / GameData 的活结构体拷字节)留作 _saveGameLegacy,
 * 只给 golden --shadow 做对照,D5e 删。
 */
game._saveGame = function() {
  const saveDataSize = (typeof SaveData !== 'undefined' && SaveData && typeof SaveData.size === 'number')
    ? SaveData.size
    : 0;
  if (!saveDataSize) {
    throw new Error('[GAME] _saveGame: SaveData.size not available');
  }
  var saveData: any = new SaveData(new Uint8Array(saveDataSize));
  writeSaveHeaderScalars(saveData);
  worldService.captureForSave();
  const header = worldService.getPartySaveHeader();
  saveData.numPartyMember = header.numPartyMember;
  saveData.numFollower = header.numFollower;
  saveData.cash = worldService.getCash();
  const sizes: Record<string, number> = {};
  for (const k of SAVE_PARTS) {
    const u = saveData[k]?.uint8Array;
    if (u) sizes[k] = u.length;
  }
  const parts = worldService.encodeStateSaveParts(sizes);
  // 开局前(标题画面)角色 / 经验还没载入,没有组件可编码:没有一局游戏可存,照旧路径出一份(与 D5b 之前逐字节相同)
  if (Object.keys(sizes).some((k) => !parts[k])) return game._saveGameLegacy();
  for (const k of Object.keys(sizes)) saveData[k].uint8Array.set(parts[k]);
  return saveData;
};

/** 存档里由组件编码的分区(顺序同 SDLPAL SAVEDGAME) */
const SAVE_PARTS = ['party', 'trail', 'exp', 'playerRoles', 'poisonStatus', 'inventory', 'scene', 'object', 'eventObject'];

/** 不归组件的标量头:视口、场景、调色板、朝向、音乐、战场、屏幕波动、标志位、战斗速度 */
function writeSaveHeaderScalars(saveData: any) {
  var viewport = getViewportSnapshot();
  saveData.viewportX = PAL_X(viewport);
  saveData.viewportY = PAL_Y(viewport);
  saveData.numScene = getSceneIdSnapshot();
  saveData.paletteOffset = isNightPaletteEnabled() ? 0x180 : 0;
  saveData.partyDirection = getPartyDirectionSnapshot();
  saveData.numMusic = getCachedMusicTrack();
  saveData.numBattleMusic = getCachedBattleMusicTrack();
  saveData.numBattleField = getCachedBattleFieldId();
  saveData.screenWave = getScreenWaveSnapshot();
  saveData.collectValue = getCollectValueFlagValue();
  saveData.layer = getLayerSnapshot();
  saveData.chaseRange = getChaseRangeFlagValue();
  saveData.chaseSpeedChangeCycles = getChaseSpeedCyclesFlagValue();
  if (!PAL_CLASSIC) {
    saveData.battleSpeed = getBattleSpeedFlagValue();
    if (saveData.battleSpeed > 5 || saveData.battleSpeed == 0) {
      saveData.battleSpeed = 2;
    }
  } else {
    // As in SDLPAL PAL_SaveGame_Common under PAL_CLASSIC.
    saveData.battleSpeed = 2;
  }
}

/** 旧存档路径(D5b 之前):从活结构体拷字节。只给 golden --shadow 对照 */
game._saveGameLegacy = function() {
  // Create SaveData with properly sized buffer
  // With the updated defineStruct, field assignments now automatically write to buffer
  const saveDataSize = (typeof SaveData !== 'undefined' && SaveData && typeof SaveData.size === 'number')
    ? SaveData.size
    : 0;
  if (!saveDataSize) {
    throw new Error('[GAME] _saveGame: SaveData.size not available');
  }
  const buffer = new Uint8Array(saveDataSize);
  var saveData = new SaveData(buffer);

  // All scalar field assignments now automatically sync to buffer via property setters
  var viewport = getViewportSnapshot();
  saveData.viewportX = PAL_X(viewport);
  saveData.viewportY = PAL_Y(viewport);
  var maxPartyIndexSnapshot = getMaxPartyMemberIndexValue();
  const computedNumPartyMember = Number.isFinite(maxPartyIndexSnapshot)
    ? maxPartyIndexSnapshot
    : worldService.getMaxPartyMemberIndex();
  saveData.numPartyMember = computedNumPartyMember;
  console.log('[GAME] _saveGame: set numPartyMember', {
    maxPartyIndexSnapshot,
    computedValue: computedNumPartyMember,
    savedValue: saveData.numPartyMember,
    bufferValue: new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint16(6, true) // offset 6 = numPartyMember
  });
  saveData.numScene = getSceneIdSnapshot();
  saveData.paletteOffset = isNightPaletteEnabled() ? 0x180 : 0;
  saveData.partyDirection = getPartyDirectionSnapshot();
  saveData.numMusic = getCachedMusicTrack();
  saveData.numBattleMusic = getCachedBattleMusicTrack();
  saveData.numBattleField = getCachedBattleFieldId();
  saveData.screenWave = getScreenWaveSnapshot();
  saveData.collectValue = getCollectValueFlagValue();
  saveData.layer = getLayerSnapshot();
  saveData.chaseRange = getChaseRangeFlagValue();
  saveData.chaseSpeedChangeCycles = getChaseSpeedCyclesFlagValue();
  saveData.numFollower = partyTrailAdapter.getFollowerCount();
  saveData.cash = worldService.getCash();
  if (!PAL_CLASSIC) {
    saveData.battleSpeed = getBattleSpeedFlagValue();
    if (saveData.battleSpeed > 5 || saveData.battleSpeed == 0) {
      saveData.battleSpeed = 2;
    }
  } else {
    // As in SDLPAL PAL_SaveGame_Common under PAL_CLASSIC.
    saveData.battleSpeed = 2;
  }
  var partyStruct = withStructBytes(getPartyStructSnapshot());
  if (partyStruct && partyStruct.uint8Array) {
    const partyTarget = (saveData.party as any)?.uint8Array;
    const partySource = toUint8Array(partyStruct.uint8Array);
    if (partyTarget && partySource) {
      partyTarget.set(partySource.subarray(0, partyTarget.length));
    }
  }
  var trailStruct = withStructBytes(getTrailStructSnapshot());
  if (trailStruct && trailStruct.uint8Array) {
    const trailTarget = (saveData.trail as any)?.uint8Array;
    const trailSource = toUint8Array(trailStruct.uint8Array);
    if (trailTarget && trailSource) {
      trailTarget.set(trailSource.subarray(0, trailTarget.length));
    }
  }
  var expStruct = getExpStructSnapshot();
  if (expStruct && expStruct.uint8Array) {
    if (!saveData.exp || !(saveData.exp as any).uint8Array) {
      const fallbackExp = createEmptyExpStruct();
      if (fallbackExp && (fallbackExp as any).uint8Array) {
        saveData.exp = fallbackExp;
      }
    }
    const expTarget = (saveData.exp as any)?.uint8Array;
    const expSource = toUint8Array(expStruct.uint8Array);
    if (expTarget && expSource) {
      expTarget.set(expSource.subarray(0, expTarget.length));
    }
  }
  const playerRoles = getPlayerRolesSnapshot() as any;
  if (playerRoles && playerRoles.uint8Array) {
    if (!saveData.playerRoles || !(saveData.playerRoles as any).uint8Array) {
      if (typeof PlayerRoles !== 'undefined' && PlayerRoles && typeof (PlayerRoles as any).size === 'number') {
        const fallbackRoles = new (PlayerRoles as any)(new Uint8Array((PlayerRoles as any).size));
        if (fallbackRoles && (fallbackRoles as any).uint8Array) {
          saveData.playerRoles = fallbackRoles;
        }
      }
    }
    const roleTarget = (saveData.playerRoles as any)?.uint8Array;
    const roleSource = toUint8Array(playerRoles.uint8Array);
    if (roleTarget && roleSource instanceof Uint8Array) {
      memcpy(roleTarget, roleSource, roleTarget.length);
    }
  }
  // 中毒矩阵从组件编码(M2 D2a:StatusMatrices 组件是真相源,Global.poisonStatus 只是投影)
  worldService.encodePoisonInto(saveData.poisonStatus as any);
  // 背包从组件编码(M2 D1:Inventory 组件是真相源,Global.inventory 只是投影)
  worldService.encodeInventoryInto(saveData.inventory as any);
  const sceneTable = withStructBytes(getGameDataTable('scene'));
  if (sceneTable && sceneTable.uint8Array) {
    const sceneTarget = (saveData.scene as any)?.uint8Array;
    const sceneSource = toUint8Array(sceneTable.uint8Array);
    if (sceneTarget && sceneSource instanceof Uint8Array) {
      memcpy(sceneTarget, sceneSource, sceneTarget.length);
    }
  }
  const objectTable: any = withStructBytes(scriptObjectAdapter.getObjectTable());
  if (objectTable && objectTable.uint8Array) {
    const objectTarget = (saveData.object as any)?.uint8Array;
    const objectSource = toUint8Array(objectTable.uint8Array);
    if (objectTarget && objectSource instanceof Uint8Array) {
      memcpy(objectTarget, objectSource, objectTarget.length);
    }
  }
  const eventObjectTable = withStructBytes(getGameDataTable('eventObject'));
  if (eventObjectTable && eventObjectTable.uint8Array) {
    const eventTarget = (saveData.eventObject as any)?.uint8Array;
    const eventSource = toUint8Array(eventObjectTable.uint8Array);
    if (eventTarget && eventSource instanceof Uint8Array) {
      memcpy(eventTarget, eventSource, eventTarget.length);
    }
  }

  console.log('[GAME] _saveGame: returning saveData', {
    numScene: saveData.numScene,
    numPartyMember: saveData.numPartyMember,
    viewportX: saveData.viewportX,
    viewportY: saveData.viewportY,
    cash: saveData.cash,
    bufferFirstBytes: Array.from((saveData.uint8Array as Uint8Array).slice(0, 20))
  });

  return saveData;
};

game.getSaveSlotMeta = function(slot: number) {
  var entry = readStorageSlot(slot);
  if (!entry) return null;
  return {
    savedTimes: entry.savedTimes || 0,
    timestamp: entry.timestamp || 0
  };
};

game.saveGame = function(slot: number) {
  slot = slot || getCurrentSaveSlotValue() || 1;
  var saveData = game._saveGame();
  // As in the SDLPAL save menu: one more than the highest count among slots 1-5, so the
  // slot with the largest number is always the latest save.
  var maxSavedTimes = 0;
  for (var other = 1; other <= 5; other++) {
    var otherEntry = readStorageSlot(other);
    if (otherEntry && (otherEntry.savedTimes || 0) > maxSavedTimes) {
      maxSavedTimes = otherEntry.savedTimes || 0;
    }
  }
  var nextSavedTimes = maxSavedTimes + 1;
  saveData.savedTimes = nextSavedTimes & 0xFFFF; // Auto-syncs to buffer via property setter
  var payload = encodeSavePayload(saveData, nextSavedTimes & 0xFFFF, Date.now());
  var ok = storageService.writeSlot(slot, payload);
  if (!ok) {
    console.warn('Failed to persist save data');
  }
  return ok;
};

/**
 * PAL_InitGameData: run by res.loadResources for kLoadGlobalData.
 */
game._initGameData = function*(slot: number): Generator<any, any, any> {
  yield game.initGlobalGameData();

  worldService.setCurrentSaveSlot(slot);

  // As in SDLPAL PAL_InitGameData: a new game (slot 0) goes straight to
  // PAL_LoadDefaultGame; 0.RPG is never read.
  const loaded = slot !== 0 ? yield game.loadGame(slot) : false;
  if (!loaded) {
    // Cannot load the saved game file. Load the defaults.
    yield game.loadDefaultGame();
  }

  worldService.setInventoryMenuIndex(0);
  worldService.setInBattle(false);

  worldService.resetPlayerStatusMatrix();
  if (script.updateEquipments) {
    yield script.updateEquipments();
  }
};
res.initGameData = game._initGameData;

/**
 * Load a game right away: PAL_ReloadInNextTick followed by PAL_LoadResources. For callers that
 * run between frames (system menu "load game", agent-pal) and need the game loaded on return.
 */
game.initGameData = function*(slot: number): Generator<any, any, any> {
  play.reloadInNextTick(slot);
  yield res.loadResources();
};

/**
 * The game entry routine.
 */
game.main = function*(selectionOverride?: number): Generator<any, any, any> {
  let loopCount = 0;
  console.log('[GAME] main loop start');
  const overlayPreference = (typeof window !== 'undefined' && typeof (window as any).PAL_OVERLAY_PREFERENCE === 'string')
    ? (window as any).PAL_OVERLAY_PREFERENCE
    : (config.enablePanorama ? 'panorama' : 'off');
  setOverlayMode(overlayPreference);
  let selection =
    typeof selectionOverride === 'number' ? selectionOverride : ui.MENUITEM_VALUE_CANCELLED;
  if (selection === ui.MENUITEM_VALUE_CANCELLED) {
    while (selection === ui.MENUITEM_VALUE_CANCELLED) {
      selection = yield uigame.openingMenu();
    }
  }
  const slot: number = selection === 0 ? 0 : selection;
  // The game is loaded by the first res.loadResources (kLoadGlobalData), as in PAL_GameMain.
  play.reloadInNextTick(slot);

  if (slot === 0) {
    dialogService.setAwaitingInput(true, { reason: 'intro' } as any);
  }

  input.init();

  while (true) {
    yield res.loadResources();
    input.clear();
    yield sleepSceneFrame();        // 场景帧(原版 PAL_GameMain 的 FRAME_TIME);默认同 sleepByFrame(1)
    try {
      // DISABLED: Allow panorama mode during opening dialog
      // enforceNewGameClassicDialog();
      yield play.startFrame();
      // DISABLED: No need to restore if we never suspended
      // restoreNewGameOverlayIfReady();
      if (loopCount < 5) {
        console.log('[GAME] frame', loopCount, {
          sceneId: getSceneIdSnapshot(),
          viewport: getViewportSnapshot(),
          partyOffset: getPartyOffsetSnapshot()
        });
      }
      loopCount += 1;
    } catch (ex) {
      // The stale battle/script has already unwound without cleanup. Resume
      // this outer native root so a queued new-game/reload can be installed.
      if (isOwnedBattleCancelled(ex)) {
        if (!ex.resumeNativeLoop) return;
        continue;
      }
      console.error('[GAME] play.startFrame() error', ex);
      throw ex;
    }
  }
};

game.shutdown = function() {
  console.log('over了...');
};

export default game;
