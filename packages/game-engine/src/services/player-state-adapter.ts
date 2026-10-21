
import stateService from './state-service.js';
import reactiveContext from '../state/reactive-context.js';
import { playerStateSignals, updatePlayerRolesValue } from '../state/slices/player-state.js';
import { statusSignals } from '../state/slices/status-matrices.js';
import { viewportSignals } from '../state/slices/viewport.js';
import { createAdapterObservable } from './adapter-helpers.js';
import { playerRoleColumn } from './player-role-fields.js';

const playerStateSlice = playerStateSignals();
const rolesSignal = playerStateSlice.roles;
const equipmentEffectSignal = playerStateSlice.equipmentEffect;

const statusSlice = statusSignals();
const playerStatusSignal = statusSlice.player;

const viewportSlice = viewportSignals();
const maxPartyIndexSignal = viewportSlice.maxPartyIndex;

const playerRolesStream = reactiveContext.signalToObservable(rolesSignal, () => getRolesSnapshot());
const equipmentEffectsStream = reactiveContext.signalToObservable(
  equipmentEffectSignal,
  () => getEquipmentMatrix()
);
const playerStatusStream = reactiveContext.signalToObservable(
  playerStatusSignal,
  () => getPlayerStatusMatrix()
);
const poisonStatusStream = reactiveContext.signalToObservable(
  statusSlice.poison,
  () => getPoisonStatusMatrix()
);
const maxPartyIndexStream = reactiveContext.signalToObservable(
  maxPartyIndexSignal,
  () => getMaxPartyMemberIndex()
);

function ensureArray(value: any) {
  if (Array.isArray(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      const view = toUint8Array(value);
      return Array.from(view);
    }
    const arrayLike = value as unknown as ArrayLike<number>;
    return Array.from(arrayLike);
  }
  return [];
}

function toUint8Array(view: any) {
  if (view instanceof Uint8Array) return view;
  return new Uint8Array(view.buffer, view.byteOffset || 0, view.byteLength || view.length || 0);
}

function toUnsignedWord(highByte: any, lowByte: any) {
  const hi = typeof highByte === 'number' ? highByte & 0xFF : 0;
  const lo = typeof lowByte === 'number' ? lowByte & 0xFF : 0;
  return (hi << 8) | lo;
}

function resolveMaxRoles(snapshot: any) {
  if (snapshot) {
    if (Array.isArray(snapshot.level)) {
      return snapshot.level.length;
    }
    if (Array.isArray(snapshot.HP)) {
      return snapshot.HP.length;
    }
    if (Array.isArray(snapshot.avatar)) {
      return snapshot.avatar.length;
    }
  }
  if (typeof Const !== 'undefined' && Const && typeof Const.MAX_PLAYER_ROLES === 'number') {
    return Const.MAX_PLAYER_ROLES;
  }
  const globalRoles = stateService.getGlobal('playerRoles') as any;
  if (globalRoles && Array.isArray(globalRoles.level)) {
    return globalRoles.level.length;
  }
  if (globalRoles && Array.isArray(globalRoles.HP)) {
    return globalRoles.HP.length;
  }
  return 0;
}

/**
 * 角色数值的组件视图(M2 D5d):world-service 初始化时注册,读者从此读 PlayerRoles 组件(与切片同形态的副本,
 * 组件不变就是同一个对象),不再依赖切片何时刷新。视图给不出(开局前还没有组件)时退回切片 / Global / GameData
 */
let rolesView: (() => unknown) | null = null;
export function setRolesView(view: (() => unknown) | null) {
  rolesView = view;
}

function getRolesSnapshot() {
  if (rolesView) {
    const view = rolesView();
    if (view) return view;
  }
  const roles = rolesSignal.value;
  if (roles) {
    return roles;
  }
  const globalRoles = stateService.getGlobal('playerRoles');
  if (globalRoles) {
    return globalRoles;
  }
  const gameDataRoles = stateService.getGameData('playerRoles');
  if (gameDataRoles) {
    updatePlayerRolesValue(gameDataRoles as any, { emitEvent: false, source: 'player-state-adapter:fallback-gameData' });
    return gameDataRoles;
  }
  const store = typeof GameData !== 'undefined' && GameData ? GameData : null;
  if (store && store.playerRoles) {
    updatePlayerRolesValue(store.playerRoles, { emitEvent: false, source: 'player-state-adapter:fallback-GameData' });
    return store.playerRoles;
  }
  return null;
}

function getPlayerRolesBuffer(snapshot: any) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  if (snapshot.uint8Array) {
    return snapshot.uint8Array;
  }
  if (Array.isArray(snapshot.buffer)) {
    return snapshot.buffer;
  }
  return null;
}

function getRoleArray(key: any) {
  const roles = getRolesSnapshot() as any;
  if (!roles || typeof roles !== 'object') {
    return [];
  }
  return ensureArray(roles[key]);
}

function getRoleArrayValue(key: any, roleId: any, fallback?: any) {
  const arr = getRoleArray(key);
  const hasExplicitFallback = arguments.length >= 3 && typeof fallback !== 'undefined';
  const resolvedFallback = hasExplicitFallback ? fallback : 0;
  if (roleId < 0 || roleId >= arr.length) {
    return resolvedFallback;
  }
  const value = arr[roleId];
  return typeof value === 'number' ? value : resolvedFallback;
}

function getEquipmentMatrix() {
  const effects = equipmentEffectSignal.value;
  if (effects) {
    return effects;
  }
  return [];
}

export function getEquipmentEffectsMatrix() {
  const matrix = getEquipmentMatrix();
  return Array.isArray(matrix) ? matrix : [];
}

export function getEquipmentEffectAt(index: any) {
  const matrix = getEquipmentMatrix();
  if (!Array.isArray(matrix)) {
    return null;
  }
  return matrix[index] || null;
}

function getMagicSlots() {
  const roles = getRolesSnapshot() as any;
  if (roles && Array.isArray(roles.magic)) {
    return roles.magic;
  }
  return [];
}

export function getPlayerMagicSlotCount() {
  const slots = getMagicSlots();
  return Array.isArray(slots) ? slots.length : 0;
}

/**
 * 状态 / 中毒矩阵的组件视图(M2 D5c):world-service 初始化时注册,读者从此读 StatusMatrices 组件,
 * 不再读切片副本(切片仍是投影,只给订阅者)。没注册时(单测、引擎未初始化)退回切片 / Global
 */
type MatrixView = () => any[];
let statusViews: { player: MatrixView; poison: MatrixView } | null = null;
export function setStatusMatrixViews(views: { player: MatrixView; poison: MatrixView } | null) {
  statusViews = views;
}

export function getPlayerStatusMatrix() {
  if (statusViews) return statusViews.player();
  const matrix = playerStatusSignal.value;
  if (matrix) {
    return matrix;
  }
  const globalMatrix = stateService.getGlobal('playerStatus');
  return Array.isArray(globalMatrix) ? globalMatrix : [];
}

export function getPoisonStatusMatrix() {
  if (statusViews) return statusViews.poison();
  const matrix = statusSlice.poison.value;
  if (Array.isArray(matrix) && matrix.length > 0) {
    return matrix;
  }
  const globalMatrix = stateService.getGlobal('poisonStatus');
  return Array.isArray(globalMatrix) ? globalMatrix : [];
}

export function getMaxPartyMemberIndex() {
  const legacyGlobal = (typeof globalThis !== 'undefined' && (globalThis as any).Global)
    ? (globalThis as any).Global
    : (typeof global !== 'undefined' ? (global as any).Global : null);
  if (legacyGlobal && typeof legacyGlobal.maxPartyMemberIndex === 'number') {
    return legacyGlobal.maxPartyMemberIndex;
  }
  const value = maxPartyIndexSignal.value;
  if (typeof value === 'number' && value >= -1) {
    return value;
  }
  const globalMax = stateService.getGlobal('maxPartyMemberIndex');
  if (typeof globalMax === 'number' && globalMax >= 0) {
    return globalMax;
  }
  return -1;
}

export function getPlayerHP(roleId: any) {
  return getRoleArrayValue('HP', roleId, 0);
}

export function getPlayerMaxHP(roleId: any) {
  return getRoleArrayValue('maxHP', roleId, 0);
}

export function getPlayerMP(roleId: any) {
  return getRoleArrayValue('MP', roleId, 0);
}

export function getPlayerMaxMP(roleId: any) {
  return getRoleArrayValue('maxMP', roleId, 0);
}

export const playerRoles$ = createAdapterObservable({
  name: 'playerState.roles',
  observe: () => playerRolesStream,
  getValue: getPlayerRolesSnapshot
});

export const equipmentEffects$ = createAdapterObservable({
  name: 'playerState.equipmentEffects',
  observe: () => equipmentEffectsStream,
  getValue: getEquipmentEffectsMatrix
});

export const playerStatus$ = createAdapterObservable({
  name: 'playerState.status',
  observe: () => playerStatusStream,
  getValue: getPlayerStatusMatrix
});

export const poisonStatus$ = createAdapterObservable({
  name: 'playerState.poisonStatus',
  observe: () => poisonStatusStream,
  getValue: getPoisonStatusMatrix
});

export const maxPartyIndex$ = createAdapterObservable({
  name: 'playerState.maxPartyIndex',
  observe: () => maxPartyIndexStream,
  getValue: getMaxPartyMemberIndex
});

export function getPlayerLevel(roleId: any) {
  return getRoleArrayValue('level', roleId, 0);
}

export function getPlayerNameId(roleId: any) {
  return getRoleArrayValue('name', roleId, 0);
}

export function getPlayerAttackStrength(roleId: any) {
  return getRoleArrayValue('attackStrength', roleId, 0);
}

export function getPlayerMagicStrength(roleId: any) {
  return getRoleArrayValue('magicStrength', roleId, 0);
}

export function getPlayerDefense(roleId: any) {
  return getRoleArrayValue('defense', roleId, 0);
}

export function getPlayerDexterity(roleId: any) {
  return getRoleArrayValue('dexterity', roleId, 0);
}

export function getPlayerFleeRate(roleId: any) {
  return getRoleArrayValue('fleeRate', roleId, 0);
}

export function getPlayerAvatarId(roleId: any) {
  return getRoleArrayValue('avatar', roleId, 0);
}

export function getPlayerEquipment(partIndex: any, roleId: any) {
  const roles = getRolesSnapshot() as any;
  if (roles && Array.isArray(roles.equipment)) {
    const part = roles.equipment[partIndex];
    if (part && typeof part[roleId] === 'number') {
      return part[roleId];
    }
  }
  return 0;
}

export function getPlayerMagicSlots(roleId: any) {
  const slots = getMagicSlots() as any;
  if (!Array.isArray(slots) || slots.length === 0) {
    return [];
  }
  const result = [];
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    result.push(slot && typeof slot[roleId] === 'number' ? slot[roleId] : 0);
  }
  return result;
}

export function getPlayerMagicAt(slotIndex: any, roleId: any) {
  const slots = getMagicSlots() as any;
  if (Array.isArray(slots)) {
    const slot = slots[slotIndex];
    if (slot && typeof slot[roleId] === 'number') {
      return slot[roleId];
    }
  }
  return 0;
}

export function getEquipmentEffectScalar(part: any, field: any, roleId: any) {
  const effects = getEquipmentMatrix() as any;
  const effect = effects && effects[part];
  if (!effect || !effect[field]) {
    return 0;
  }
  const collection = effect[field];
  if (!collection) {
    return 0;
  }
  const value = collection[roleId];
  return typeof value === 'number' ? value : 0;
}

export function getEquipmentEffectElemental(part: any, attr: any, roleId: any) {
  const effects = getEquipmentMatrix() as any;
  const effect = effects && effects[part];
  if (!effect || !effect.elementalResistance) {
    return 0;
  }
  const row = effect.elementalResistance[attr];
  if (!row) {
    return 0;
  }
  const value = row[roleId];
  return typeof value === 'number' ? value : 0;
}

export function getPlayerStatusValue(roleId: any, statusId: any) {
  const matrix = getPlayerStatusMatrix() as any;
  if (Array.isArray(matrix) && matrix[roleId]) {
    const row = matrix[roleId];
    if (row && typeof row === 'object') {
      if (row.uint8Array) {
        return row.uint8Array[statusId] || 0;
      }
      const value = row[statusId];
      return typeof value === 'number' ? value : 0;
    }
  }
  return 0;
}

export function getPlayerStatusRow(roleId: any) {
  const matrix = getPlayerStatusMatrix() as any;
  if (Array.isArray(matrix) && matrix[roleId]) {
    return matrix[roleId];
  }
  const globalMatrix = stateService.getGlobal('playerStatus') as any;
  if (Array.isArray(globalMatrix) && globalMatrix[roleId]) {
    return globalMatrix[roleId];
  }
  return [];
}

export function getPlayerRolesSnapshot() {
  return getRolesSnapshot();
}

export function getPlayerRoleField(field: any) {
  return getRoleArray(field);
}

export function getPlayerRoleFieldValue(field: any, roleId: any, fallback: any) {
  if (arguments.length >= 3 && typeof fallback !== 'undefined') {
    return getRoleArrayValue(field, roleId, fallback);
  }
  return getRoleArrayValue(field, roleId);
}

export function getPlayerMagicSound(roleId: any) {
  return getRoleArrayValue('magicSound', roleId, 0);
}

export function getPlayerAttackSound(roleId: any) {
  return getRoleArrayValue('attackSound', roleId, 0);
}

export function getPlayerCriticalSound(roleId: any) {
  return getRoleArrayValue('criticalSound', roleId, 0);
}

export function getPlayerWeaponSound(roleId: any) {
  return getRoleArrayValue('weaponSound', roleId, 0);
}

export function getPlayerCoverSound(roleId: any) {
  return getRoleArrayValue('coverSound', roleId, 0);
}

export function getPlayerDyingSound(roleId: any) {
  return getRoleArrayValue('dyingSound', roleId, 0);
}

export function getPlayerDeathSound(roleId: any) {
  return getRoleArrayValue('deathSound', roleId, 0);
}

export function getPlayerCoveredBy(roleId: any) {
  return getRoleArrayValue('coveredBy', roleId, 0);
}

export function getPlayerRoleWord(fieldIndex: any, roleId: any, fallback = 0) {
  if (typeof fieldIndex !== 'number' || typeof roleId !== 'number') {
    return fallback;
  }
  const snapshot = getRolesSnapshot();
  // 具名数组(常态):按 PLAYERROLES 字段号映射;下面按偏移读的只是旧的字节布局兜底
  const named = playerRoleColumn(snapshot, fieldIndex);
  if (named) {
    const v = roleId >= 0 && roleId < named.length ? named[roleId] : undefined;
    return typeof v === 'number' ? (v & 0xffff) : fallback;
  }
  const maxRoles = resolveMaxRoles(snapshot);
  const buffer = getPlayerRolesBuffer(snapshot);
  if (buffer && maxRoles > 0) {
    const offset = (fieldIndex * maxRoles + roleId) * 2;
    if (ArrayBuffer.isView(buffer)) {
      const viewArray = toUint8Array(buffer);
      const byteLength = viewArray.byteLength;
      if (offset >= 0 && offset + 2 <= byteLength) {
        try {
          const view = new DataView(viewArray.buffer, viewArray.byteOffset, byteLength);
          return view.getUint16(offset, true);
        } catch (err) {
          // fall through to array read
        }
      }
    }
    if (Array.isArray(buffer) && offset >= 0 && offset + 1 < buffer.length) {
      return toUnsignedWord(buffer[offset + 1], buffer[offset]);
    }
  }
  return fallback;
}

export function getEquipmentEffect(partIndex: any) {
  const matrix = getEquipmentMatrix();
  if (Array.isArray(matrix)) {
    return matrix[partIndex] || null;
  }
  return null;
}

export function findPlayerMagicSlot(roleId: any, magicId: any) {
  if (!Number.isFinite(roleId) || !Number.isFinite(magicId)) {
    return -1;
  }
  const slots = getPlayerMagicSlots(roleId);
  if (Array.isArray(slots)) {
    for (let index = 0; index < slots.length; index++) {
      if (slots[index] === magicId) {
        return index;
      }
    }
  }
  return -1;
}

export default {
  getPlayerRolesSnapshot,
  getPlayerHP,
  getPlayerMaxHP,
  getPlayerMP,
  getPlayerMaxMP,
  getPlayerLevel,
  getPlayerNameId,
  getPlayerAttackStrength,
  getPlayerMagicStrength,
  getPlayerDefense,
  getPlayerDexterity,
  getPlayerFleeRate,
  getPlayerAvatarId,
  getPlayerEquipment,
  getPlayerMagicSlotCount,
  getPlayerMagicSlots,
  getPlayerMagicAt,
  getEquipmentEffectScalar,
  getEquipmentEffectElemental,
  getPlayerStatusValue,
  getPlayerStatusMatrix,
  getPlayerRoleField,
  getPlayerRoleFieldValue,
  getPlayerMagicSound,
  getPlayerAttackSound,
  getPlayerCriticalSound,
  getPlayerWeaponSound,
  getPlayerCoverSound,
  getPlayerDyingSound,
  getPlayerDeathSound,
  getPlayerCoveredBy,
  getPlayerRoleWord,
  getMaxPartyMemberIndex,
  getEquipmentEffect,
  findPlayerMagicSlot,
  playerRoles$,
  equipmentEffects$,
  playerStatus$,
  poisonStatus$,
  maxPartyIndex$
};
