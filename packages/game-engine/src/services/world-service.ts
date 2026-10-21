import {generatedResourceObserver} from './generated-dialog-observation';
import {sameJsonValue} from './script-json-value';
import {copyDelayCheckpoint,type ScriptDelayCheckpoint} from './script-delay-checkpoint';
import type {EndingAnimationReferenceLeases} from './ending-animation-reference-leases';
import type {GeneratedDialogReferenceLeases} from './generated-dialog-reference-leases';
import type {GeneratedDialogLease} from './script-generated-dialog-cursor';
import type {EndingScrollReferenceLeases} from './ending-scroll-reference-leases';
import type {EndingClockReferenceLeases} from './ending-clock-reference-leases';
import type {EndingShowLease} from './script-ending-show-cursor';
import type {EndingShowReferenceLeases} from './ending-show-reference-leases';
import type {ScreenAliasLease} from './script-screen-fade-cursor';
import type {ScreenFadeReferenceLeases} from './screen-fade-reference-leases';
import {WorldReferenceLeases,type WorldReferenceLease,type WorldReferenceSource} from './world-reference-leases';
import { WorldWriter, hashString, stableStringify } from '../ecs/world-writer.js';
import { STATE_COMPONENTS, encodeSaveParts, wordsToBytes } from '../ecs/components/state.js';
import {
  InventoryComponent, SlotDraft, slotsFromDraft, sameSlots, fitSlot, toCash, toTrunc,
  type InventoryState, type InventorySlot
} from '../ecs/components/inventory.js';
import {
  StatusMatricesComponent, statusToPlain, statusFromPlain, poisonToPlain, poisonDraft,
  type StatusMatricesState
} from '../ecs/components/status.js';
import {
  PartyComponent, MemberDraft, TrailDraft, fitMember, fitTrail,
  type PartyState
} from '../ecs/components/party.js';
import {
  PlayerRolesComponent, ExperienceComponent, EquipmentEffectComponent, wordsOf, sameWords
} from '../ecs/components/roles.js';
import {
  EventObjectComponent, SceneTableComponent, ObjectTableComponent, EVENT_OBJECT_FIELDS, SCENE_FIELDS,
  recordBytes, bytesToWords, tableBytes, sameBytes
} from '../ecs/components/world-tables.js';
import EventBus from './event-bus.js';
import stateService from './state-service.js';
import reactiveContext from '../state/reactive-context.js';
import co from '../js/pal/co';
import {
  createEntityRegistry,
  EntityRegistry,
  WorldComponents,
  createViewportComponent,
  createEventObjectComponent,
  createSceneComponent,
  createMapMetaComponent,
  createMapTileComponent,
  createNpcStateComponent,
  createScriptRegisterComponent,
  createMoveIntentComponent,
  createMoveRequestQueueComponent,
  createCollisionStateComponent
} from '../ecs/index.js';
import createWorldSystemManager from './world-systems.js';
import { playerRoleColumn } from './player-role-fields.js';
import { setStatusMatrixViews, setRolesView } from './player-state-adapter.js';
import { updateAutoBattle, getAutoBattleValue } from '../state/slices/auto-battle.js';
import { updateFrameCount, getFrameCountValue } from '../state/slices/frame-count.js';
import {
  updateMainMenuIndex,
  getMainMenuIndexValue,
  updateSystemMenuIndex,
  getSystemMenuIndexValue,
  updateInventoryMenuIndex,
  getInventoryMenuIndexValue,
  updateNoMusicFlag,
  getNoMusicFlagValue,
  updateNoSoundFlag,
  getNoSoundFlagValue
} from '../state/slices/menu-selections.js';
import {
  updateViewportValue,
  getViewportValue,
  updatePartyOffsetValue,
  getPartyOffsetValue,
  updatePartyDirectionValue,
  getPartyDirectionValue,
  updateMaxPartyIndexValue,
  getMaxPartyIndexValue
} from '../state/slices/viewport.js';
import {
  updateInventoryValue,
  getCashValue,
  updateCashValue,
  updateLastUnequippedValue,
  updateInventoryCapacityValue,
  inventorySignals
} from '../state/slices/inventory.js';
import {
  updatePlayerStatusMatrix,
  mutatePlayerStatusMatrix,
  getPlayerStatusMatrixValue,
  updatePoisonStatusMatrix,
  mutatePoisonStatusMatrix,
  getPoisonStatusMatrixValue,
  statusSignals
} from '../state/slices/status-matrices.js';
import {
  updatePartyValue as updatePartySliceValue,
  updateTrailValue as updateTrailSliceValue,
  updateFollowerCountValue as updateFollowerCountSliceValue,
  getTrailValue,
  getFollowerCountValue
} from '../state/slices/party-trail.js';
import {
  updateSceneIdValue,
  updateEventObjectsValue,
  updateCollisionStateValue,
  getSceneIdValue,
  getEventObjectsValue,
  getCollisionStateValue
} from '../state/slices/scene-events.js';
import { updateSceneTableValue } from '../state/slices/scene-table.js';
import {
  updateMusicTrackValue,
  updateBattleMusicTrackValue,
  updateBattleFieldIdValue,
  updateScreenWaveValue,
  updatePaletteIdValue,
  updateNightPaletteValue,
  updateLayerValue,
  getScreenWaveValue,
  getPaletteIdValue,
  getNightPaletteValue,
  getLayerValue,
  resetAudioResourceSlice
} from '../state/slices/audio-resources.js';
import {
  updateWaveProgressionValue,
  updateNeedToFadeInValue,
  getWaveProgressionValue,
  getNeedToFadeInValue
} from '../state/slices/time-flags.js';
import {
  updateScriptEntriesValue,
  updateObjectTableValue,
  updateObjectDescValue,
  resetScriptObjectSlice,
  scriptObjectSignals
} from '../state/slices/script-objects.js';
import {
  updateEnemyTeamValue,
  updateEnemyPositionValue,
  updateBattleFieldValue,
  resetBattleFormationSlice
} from '../state/slices/battle-formation.js';
import {
  updatePlayerRolesValue,
  updateEquipmentEffectValue,
  resetPlayerStateSlice,
  playerStateSignals,
  cloneRolesValue
} from '../state/slices/player-state.js';
import {
  updateMagicTableValue,
  updateStoreTableValue,
  updateExpStateValue,
  updateEnemyTableValue,
  updateBattleEffectTableValue,
  updateLevelUpExpTableValue,
  updateLevelUpMagicTableValue,
  getLevelUpExpTableValue
} from '../state/slices/game-data.js';
import {
  updateCollectValue,
  updateChaseRangeValue,
  updateChaseSpeedCyclesValue,
  updateBattleSpeedValue,
  getCollectValue as getCollectFlagValue,
  getChaseRangeValue as getChaseRangeFlagValue,
  getChaseSpeedCyclesValue as getChaseSpeedFlagValue,
  getBattleSpeedValue as getBattleSpeedFlagValue
} from '../state/slices/game-flags.js';
import type { PlayerRoles } from '../types/pal.js';

function getGlobalStore(): Record<string, unknown> | null {
  if (typeof globalThis !== 'undefined' && (globalThis as any).Global) {
    return (globalThis as any).Global;
  }
  if (typeof global !== 'undefined' && (global as any).Global) {
    return (global as any).Global;
  }
  return null;
}

function getGameDataStore(): Record<string, unknown> | null {
  if (typeof globalThis !== 'undefined' && (globalThis as any).GameData) {
    return (globalThis as any).GameData;
  }
  if (typeof global !== 'undefined' && (global as any).GameData) {
    return (global as any).GameData;
  }
  return null;
}

const EXP_FIELDS = ['exp', 'reserved', 'level', 'count'] as const;   // EXPERIENCE:4 个 WORD

/** 经验结构体各条目:有字节的,getter 缓存按字节刷新;没字节的普通对象,按 WORD 截断 */
function syncExpCachesFromBytes(expStruct: any) {
  for (const key of Object.keys(expStruct)) {
    const bucket = expStruct[key];
    if (!bucket || typeof bucket !== 'object' || typeof bucket.length !== 'number') continue;
    for (let i = 0; i < bucket.length; i++) {
      const entry = bucket[i];
      if (!entry || typeof entry !== 'object') continue;
      const bytes: Uint8Array | undefined = entry.uint8Array;
      if (bytes instanceof Uint8Array && bytes.length >= 8) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
        EXP_FIELDS.forEach((f, k) => {
          const v = view.getUint16(k * 2, true);
          if (entry[f] !== v) entry[f] = v;
        });
      } else {
        for (const f of EXP_FIELDS) if (typeof entry[f] === 'number') entry[f] = entry[f] & 0xffff;
      }
    }
  }
}

/**
 * EVENTOBJECT 的 16 个字段(pal-global.ts / SDLPAL tagEVENTOBJECT 同序),SHORT 的三个有符号。pal-formats 的 setter 把
 * 写入的原始 JS 值缓存成 getter、字节才截 16 位 —— 越界写入后逻辑读到的与存档 / SDLPAL 不同(#160 的 x = 67080 / 1544)。
 * mutateEventObject 之后按字节回刷 getter,兜住经它写入的所有字段。
 */
// 字段顺序沿用 world-tables 的 EVENT_OBJECT_FIELDS(同 SDLPAL tagEVENTOBJECT);这三个是 SHORT
const EVENT_OBJECT_SIGNED = new Set<string>(['vanishTime', 'layer', 'state']);

function syncEventObjectCachesFromBytes(entry: any) {
  if (!entry || typeof entry !== 'object') return;
  const bytes: Uint8Array | undefined = entry.uint8Array;
  if (bytes instanceof Uint8Array && bytes.length >= EVENT_OBJECT_FIELDS.length * 2) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, EVENT_OBJECT_FIELDS.length * 2);
    EVENT_OBJECT_FIELDS.forEach((f, k) => {
      const v = EVENT_OBJECT_SIGNED.has(f) ? view.getInt16(k * 2, true) : view.getUint16(k * 2, true);
      if (entry[f] !== v) entry[f] = v;
    });
  } else {
    for (const f of EVENT_OBJECT_FIELDS) {
      if (typeof entry[f] === 'number') entry[f] = EVENT_OBJECT_SIGNED.has(f) ? (entry[f] << 16) >> 16 : entry[f] & 0xffff;
    }
  }
}

function getGlobalObject(name: string): any {
  if (typeof globalThis !== 'undefined' && (globalThis as any)[name]) {
    return (globalThis as any)[name];
  }
  if (typeof global !== 'undefined' && (global as any)[name]) {
    return (global as any)[name];
  }
  return null;
}

function getGlobalFunction<T>(name: string, fallback: T): T {
  const obj = getGlobalObject(name);
  if (obj && typeof obj === 'function') {
    return obj as T;
  }
  return fallback;
}

const DEFAULT_EXP_BUCKETS = [
  'primaryExp',
  'healthExp',
  'magicExp',
  'attackExp',
  'magicPowerExp',
  'defenseExp',
  'dexterityExp',
  'fleeExp'
];

function isInvalidExpBucket(bucket: unknown): boolean {
  if (!bucket) {
    return false;
  }
  if (ArrayBuffer.isView(bucket)) {
    return true;
  }
  if (!Array.isArray(bucket)) {
    return false;
  }
  for (let i = 0; i < bucket.length; i += 1) {
    const entry = bucket[i];
    if (entry == null) {
      continue;
    }
    if (typeof entry !== 'object') {
      return true;
    }
  }
  return false;
}

function coerceExpBucket(bucket: unknown): unknown[] | null {
  if (!bucket) {
    return null;
  }
  const maxRoles = getConstValue('MAX_PLAYER_ROLES', 6) || 6;
  const toEntry = (value: number) => ({ exp: value, level: 0, count: 0 });
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
      list[i] = toEntry(view[i] || 0);
    }
    return list;
  }
  if (Array.isArray(bucket)) {
    let changed = false;
    const list = bucket.map((entry) => {
      if (entry == null) {
        return entry;
      }
      if (typeof entry === 'number') {
        changed = true;
        return toEntry(entry);
      }
      return entry;
    });
    return changed ? list : bucket;
  }
  return null;
}

function normalizeExpStruct(exp: any) {
  if (!exp || typeof exp !== 'object') {
    return exp;
  }
  const ctor = getGlobalObject('AllExperience');
  if (!ctor || typeof ctor !== 'function') {
    return exp;
  }
  const types = Array.isArray((ctor as any).types) && (ctor as any).types.length > 0
    ? (ctor as any).types
    : DEFAULT_EXP_BUCKETS;
  let normalized = exp;
  const needsHydration = types.some((name: string) => isInvalidExpBucket(normalized[name]));
  if (needsHydration) {
    const bytes = normalized.uint8Array instanceof Uint8Array ? normalized.uint8Array : null;
    if (bytes) {
      try {
        normalized = new (ctor as any)(bytes);
      } catch (err) {
        console.warn('[world-service] failed to normalize exp struct', err);
      }
    }
  }
  let coerced = false;
  types.forEach((name: string) => {
    const fixed = coerceExpBucket((normalized as any)[name]);
    if (fixed && fixed !== (normalized as any)[name]) {
      (normalized as any)[name] = fixed;
      coerced = true;
    }
  });
  return coerced ? normalized : normalized;
}

function getConstValue(key: string, fallback: number) {
  const constRef = getGlobalObject('Const');
  if (constRef && typeof constRef[key] === 'number') {
    return constRef[key];
  }
  return fallback;
}

// 用到时再读:模块加载时 Const 还没定义,读出来是 0 —— 之前所有「MAX_PLAYER_ROLES <= 0 就返回」的
// 角色字 / 装备效果读写因此一直是空操作(升级不涨级、加属性 / 装备加成脚本无效)
const maxPlayerRoles = () => getConstValue('MAX_PLAYER_ROLES', 6) || 6;

/**
 * 角色数值 / 装备加成条目的结构体类(PLAYERROLES)。按名字取:结构体实例的 constructor 解析出来是 Array,不能用;
 * 活对象不是这个类的字节结构体(开局前 / 单测的普通对象)时返回 null,调用方走旧路径
 */
function playerRolesStruct(live: any): any {
  const Struct = getGlobalObject('PlayerRoles');
  if (typeof Struct !== 'function' || typeof Struct.size !== 'number') return null;
  if (!live || !(live.uint8Array instanceof Uint8Array) || live.uint8Array.length !== Struct.size || !(live instanceof Struct)) return null;
  return Struct;
}
const MAX_PLAYER_EQUIPMENTS = getConstValue('MAX_PLAYER_EQUIPMENTS', 0);
const MAX_PLAYER_MAGICS = getConstValue('MAX_PLAYER_MAGICS', 0);
const MAX_INVENTORY = getConstValue('MAX_INVENTORY', 0);
const MAX_POISONS = getConstValue('MAX_POISONS', 0);
const MAX_SPRITE_STATE_KEY = 'MAX_SPRITE_TO_DRAW';
const LEGACY_SPRITE_LIMIT_KEY = '__PAL_LEGACY_MAX_SPRITE__';
const DEFAULT_MAX_SPRITE_TO_DRAW = 2048;

const serviceModuleCache: Record<string, unknown> = Object.create(null);

function getGlobalServices(): Record<string, unknown> | null {
  if (typeof globalThis !== 'undefined' && (globalThis as any).services) {
    return (globalThis as any).services as Record<string, unknown>;
  }
  if (typeof global !== 'undefined' && (global as any).services) {
    return (global as any).services as Record<string, unknown>;
  }
  return null;
}

function loadServiceModule<T = unknown>(name: string, path: string): Promise<T> {
  if (serviceModuleCache[name]) {
    return Promise.resolve(serviceModuleCache[name] as T);
  }
  const services = getGlobalServices();
  if (services) {
    const direct = services[name as keyof typeof services];
    if (direct) {
      serviceModuleCache[name] = direct;
      return Promise.resolve(direct as T);
    }
    const adapters = (services as any).adapters as Record<string, unknown> | undefined;
    const adapter = adapters && adapters[name];
    if (adapter) {
      serviceModuleCache[name] = adapter;
      return Promise.resolve(adapter as T);
    }
  }
  return import(/* @vite-ignore */ path).then((mod) => {
    const resolved: any = mod && (mod as any).default ? (mod as any).default : mod;
    serviceModuleCache[name] = resolved;
    return resolved as T;
  }).catch((err) => {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[world-service] failed to load module '${name}'`, err);
    }
    throw err;
  });
}

function getItemFlags() {
  const flags = getGlobalObject('ItemFlag');
  if (flags) {
    return flags;
  }
  return {
    Usable: 1,
    Equipable: 2,
    Throwable: 4,
    Consuming: 8,
    ApplyToAll: 16
  };
}

function setDefaultPartyStruct() {
  const constRef = getGlobalObject('Const');
  const maxMembers = constRef && typeof constRef.MAX_PARTY_MEMBERS === 'number'
    ? constRef.MAX_PARTY_MEMBERS
    : 5;

  const existingParty = stateService.getGlobal('party') as PartyMember[] | null;
  const nextParty: PartyMember[] = new Array(maxMembers);
  for (let idx = 0; idx < maxMembers; idx++) {
    const source = Array.isArray(existingParty) ? existingParty[idx] : null;
    if (source && typeof source.playerRole === 'number') {
      nextParty[idx] = {
        playerRole: source.playerRole,
        x: Number.isFinite(source.x) ? source.x : 0,
        y: Number.isFinite(source.y) ? source.y : 0,
        frame: Number.isFinite(source.frame) ? source.frame : 0,
        imageOffset: Number.isFinite(source.imageOffset) ? source.imageOffset : 0
      };
    } else {
      nextParty[idx] = { playerRole: idx, x: 0, y: 0, frame: 0, imageOffset: 0 };
    }
  }
  stateService.setGlobal('party', nextParty);

  const existingTrail = stateService.getGlobal('trail') as TrailEntry[] | null;
  const nextTrail: TrailEntry[] = new Array(maxMembers);
  for (let idx = 0; idx < maxMembers; idx++) {
    const source = Array.isArray(existingTrail) ? existingTrail[idx] : null;
    if (source && Number.isFinite(source.x) && Number.isFinite(source.y)) {
      nextTrail[idx] = {
        x: source.x,
        y: source.y,
        direction: Number.isFinite(source.direction) ? source.direction : Direction.South
      };
    } else {
      nextTrail[idx] = { x: 0, y: 0, direction: Direction.South };
    }
  }
  stateService.setGlobal('trail', nextTrail);

  if (typeof stateService.getGlobal('numFollower') !== 'number') {
    stateService.setGlobal('numFollower', 0);
  }
}

const toSignedWord = getGlobalFunction('SHORT', function(value: number) {
  const result = value & 0xFFFF;
  return (result & 0x8000) ? result - 0x10000 : result;
});

function toUnsignedWord(value: number) {
  const normalized = ((value % 0x10000) + 0x10000) & 0xFFFF;
  return normalized;
}

function resolveDirectionDefault() {
  let directionTable = null;
  if (typeof globalThis !== 'undefined' && (globalThis as any).Direction) {
    directionTable = (globalThis as any).Direction;
  } else if (typeof global !== 'undefined' && (global as any).Direction) {
    directionTable = (global as any).Direction;
  }
  return directionTable && typeof directionTable.South === 'number'
    ? directionTable.South
    : 0;
}

const DEFAULT_PARTY_DIRECTION = resolveDirectionDefault();
type PlayerRolesBuffer = { uint8Array?: Uint8Array };
type PartyMember = { playerRole: number | null; x?: number; y?: number; frame?: number; imageOffset?: number };
type TrailEntry = { x: number; y: number; direction: number };

type ValueOrUpdater<T> = T | ((prev: T) => T);
type UpdateOptions = Record<string, unknown>;
type EntityMaps = {
  viewport: number | null;
  eventObject: Map<number, number>;
  scene: number | null;
  mapMeta: number | null;
  mapTile: number | null;
  scriptRegister: number | null;
  moveQueue: number | null;
  collision: number | null;
};
type PoisonEntry = { uint8Array?: Uint8Array; poisonID?: number; poisonScript?: number };
type PoisonRow = PoisonEntry[] | { uint8Array?: Uint8Array };
type StateChangeEvent = { key?: string; value?: unknown; data?: { key?: string; value?: unknown } } | null;
type EquipmentEffectEntry = { uint8Array?: Uint8Array } | Record<string, unknown>;
type EquipmentEffectTable = EquipmentEffectEntry[];
const isUint8Entry = (entry: EquipmentEffectEntry | null | undefined): entry is { uint8Array: Uint8Array } =>
  !!entry && entry.uint8Array instanceof Uint8Array;
type InventoryItem = Record<string, unknown>;
type EcsRegistry = {
  createEntity: (...args: unknown[]) => number;
  addComponent: (entityId: number, component: unknown, data: unknown) => void;
  getComponent: (entityId: number, component: unknown) => any;
  hasEntity?: (entityId: number) => boolean;
  destroyEntity?: (entityId: number) => void;
  removeComponent?: (entityId: number, component: unknown) => void;
  clear?: () => void;
};
type WorldEventPayload =
  | { value: number; partyOffset: number }
  | { size: number }
  | { trail: TrailEntry[] | null }
  | { sceneId: unknown; mapId: unknown }
  | { count: number; sceneId?: unknown }
  | { id: number; sceneId: unknown; state: unknown }
  | Record<string, unknown>;
type GlobalStoreLoose = {
  numFollower?: number;
  musicNum?: number;
  numBattleMusic?: number;
  numBattleField?: number;
  numPalette?: number;
  nightPalette?: boolean;
  layer?: number;
  viewport?: number;
  partyOffset?: number;
  partyDirection?: number;
  maxPartyMemberIndex?: number;
  party?: PartyMember[];
  trail?: TrailEntry[];
  curMainMenuItem?: number;
  curSystemMenuItem?: number;
  curInvMenuItem?: number;
  noMusic?: boolean | number;
  noSound?: boolean | number;
  screenWave?: number;
  waveProgression?: number;
  needToFadeIn?: boolean | number;
  [key: string]: unknown;
};

const playerStateSignalsRef = playerStateSignals();
const playerRolesSignal = playerStateSignalsRef.roles;
const equipmentEffectSignal = playerStateSignalsRef.equipmentEffect;


class WorldService extends EventBus {
  registry: EntityRegistry;
  /** 组件状态的唯一写入通道(ecs/world-writer.ts);目前只承载等待栈 */
  writer: WorldWriter;
  entityMaps: EntityMaps;
  _statusViewCache: { src: unknown; views: { player: any[]; poison: any[] } } | null = null;
  _rolesViewCache: { src: unknown; view: unknown } | null = null;
  _initialised: boolean;
  systemManager: any;
  _collisionState: any;
  _eventObjectsVersion: number;
  _eventObjectsCache: any;
  _eventObjectsCacheVersion: number;
  _maxSpriteDrawLimit: number;
  _playerStatusSignalUnsubscribe: (() => void) | null;
  _projectingInventory: boolean;
  _projectingStatus: boolean;
  _projectingParty: boolean;
  _eventBytesSnapshot: Uint8Array | null = null;
  _sceneBytesSnapshot: Uint8Array | null = null;
  _objectBytesSnapshot: Uint8Array | null = null;

  constructor() {
    super();
    this.registry = createEntityRegistry();
    this.writer = new WorldWriter(this.registry);
    this.entityMaps = {
      viewport: null,
      eventObject: new Map(),
      scene: null,
      mapMeta: null,
      mapTile: null,
      scriptRegister: null,
      moveQueue: null,
      collision: null
    };
    this._initialised = false;
    this._handleGlobalChanged = this._handleGlobalChanged.bind(this);
    this._handleGameDataChanged = this._handleGameDataChanged.bind(this);
    this.systemManager = createWorldSystemManager({ worldService: this });
    this._collisionState = null;
    this._eventObjectsVersion = 0;
    this._eventObjectsCache = null;
    this._eventObjectsCacheVersion = -1;
    this._maxSpriteDrawLimit = DEFAULT_MAX_SPRITE_TO_DRAW;
    this._playerStatusSignalUnsubscribe = null;
    this._projectingInventory = false;
    this._projectingStatus = false;
    this._projectingParty = false;
    this._handlePlayerStatusSignal = this._handlePlayerStatusSignal.bind(this);
  }

  fire(event: string, payload?: WorldEventPayload): unknown {
    return super.fire(event, payload);
  }

  init() {
    if (this._initialised) {
      this.syncAll();
      return;
    }
    stateService.on('globalChanged', this._handleGlobalChanged);
    stateService.on('gameDataChanged', this._handleGameDataChanged);
    this._initialised = true;
    const globalStore = stateService.getGlobal() as GlobalStoreLoose | null;
    const hasPartyStruct = globalStore && Array.isArray(globalStore.party) && globalStore.party.length > 0;
    const hasTrailStruct = globalStore && Array.isArray(globalStore.trail) && globalStore.trail.length > 0;
    const hasFollowerCount = globalStore && typeof globalStore.numFollower === 'number';
    if (!hasPartyStruct || !hasTrailStruct || !hasFollowerCount) {
      setDefaultPartyStruct();
    }
    this._migrateLegacySpriteLimit();
    this.syncAll();
    // Import legacy initialization before the signal's immediate subscription callback.
    this._playerStatusSignalUnsubscribe = statusSignals().player.subscribe(this._handlePlayerStatusSignal);
    setStatusMatrixViews({
      player: () => this._statusMatrixViews().player,
      poison: () => this._statusMatrixViews().poison
    });
    setRolesView(() => this._rolesView());
  }

  /** Private runtime aliases; deliberately excluded from writer/snapshot/journal. */
  // Publication authority outlives the selected child and binds the entire root suffix.
  // Tombstones contain no world/resource references, like ending clock root identities.
  private readonly teleportRootIdentities=new Set<string>();
  private readonly teleportPublications=new Map<string,{checkpoint:ScriptDelayCheckpoint|null;sources:Map<number,any>}>();
  acquireTeleportRoot(owner:string,pc:number,row:any):void {
    this.teleportRootIdentities.add(owner);
    const publication=this.teleportPublications.get(owner) || {checkpoint:null,sources:new Map<number,any>()};
    if(!publication.sources.has(pc)){const snapshot={operation:row.operation,operand:Array.from(row.operand)},observe=generatedResourceObserver(row);publication.sources.set(pc,{snapshot,row,observe,observation:observe()});}
    this.teleportPublications.set(owner,publication);
  }
  publishTeleportCheckpoint(cp:ScriptDelayCheckpoint):void {const p=this.teleportPublications.get(cp.id);if(p)p.checkpoint=copyDelayCheckpoint(cp);}
  validateTeleportCheckpoint(value:unknown,read:(pc:number)=>any):string|null {
    // Validate own data descriptors before any DTO reads/serialization. A forged
    // accessor must not run before publication authority has been established.
    const pure=(v:any,seen=new Set<object>()):void=>{
      if(v===null || v===undefined || ['string','number','boolean'].includes(typeof v))return;
      if(typeof v!=='object' || seen.has(v))throw new Error('Invalid teleport checkpoint data');
      const proto=Object.getPrototypeOf(v);if(proto!==null && proto!==Object.prototype && proto!==Array.prototype)throw new Error('Teleport checkpoint must be plain JSON');
      seen.add(v);
      for(const key of Object.getOwnPropertyNames(v)){const d=Object.getOwnPropertyDescriptor(v,key)!;if(!('value' in d))throw new Error('Teleport checkpoint accessor');pure(d.value,seen);}
      seen.delete(v);
    };
    try {
      pure(value);
      const cp=value as ScriptDelayCheckpoint;
      if(!cp || !this.teleportRootIdentities.has(cp.id) && !(Array.isArray(cp.frames) && cp.frames.some(f=>f?.parentReturn?.kind==='teleport-child')))return null;
      const p=this.teleportPublications.get(cp.id);
      if(!p || !p.checkpoint || !sameJsonValue(p.checkpoint,cp))return 'Teleport checkpoint publication or lifecycle changed';
      for(const [pc,source] of p.sources){
        const live=read(pc);
        // Reject a new object or accessor/byte binding before invoking even the
        // original native parsed-row getter. Native rows are not JSON DTOs;
        // their captured backing bytes, cache fields and accessors bind the tuple.
        if(!live || source.row!==live)return 'Teleport original source changed';
        const now=source.observe(),saved=source.observation;
        if(now.refs.length!==saved.refs.length || now.refs.some((v:any,i:number)=>v!==saved.refs[i]) || !sameJsonValue(now.values,saved.values))return 'Teleport original source changed';
      }
      return null;
    }catch{return 'Invalid teleport checkpoint or source data';}
  }
  /** Commit one acceptance across Runners before any asynchronous continuation.
   * Keep source history alive while only the successor publication may reopen. */
  consumeTeleportCheckpoint(cp:ScriptDelayCheckpoint):boolean {
    if(!this.teleportRootIdentities.has(cp.id))return true;
    const p=this.teleportPublications.get(cp.id);
    if(!p?.checkpoint || !sameJsonValue(p.checkpoint,cp))return false;
    p.checkpoint=null;
    return true;
  }
  private pruneTeleportSources(entries:any[]):void {
    for(const [owner,p] of this.teleportPublications)if([...p.sources].some(([pc,s])=>Object.getOwnPropertyDescriptor(entries,String(pc))?.value!==s.row))this.releaseTeleportOwner(owner);
  }
  releaseTeleportOwner(owner:string):void {this.teleportPublications.delete(owner);}
  transferTeleportOwner(owner:string,next:string):void {const p=this.teleportPublications.get(owner);if(p){this.teleportRootIdentities.add(next);this.teleportPublications.delete(owner);this.teleportPublications.set(next,p);}}
  private readonly compositionReferences = new WorldReferenceLeases();
  acquireCompositionReference(owner:string,source:WorldReferenceSource,raw:object):WorldReferenceLease {return this.compositionReferences.acquire(owner,source,raw);}
  resolveCompositionReference(lease:WorldReferenceLease,owner:string,source:WorldReferenceSource):any|null {return this.compositionReferences.resolve(lease,owner,source);}
  releaseCompositionReference(lease:WorldReferenceLease):void {this.compositionReferences.release(lease);}
  releaseCompositionOwner(owner:string):void {this.compositionReferences.releaseOwner(owner);}
  transferCompositionOwner(owner:string,next:string):void {this.compositionReferences.transfer(owner,next);}

  /** Acquired renderer scopes belong to this World incarnation, never to ECS snapshots. */
  private readonly screenFadeReferenceScopes=new Set<ScreenFadeReferenceLeases>();
  registerScreenFadeReferenceScope(scope:ScreenFadeReferenceLeases):void {this.screenFadeReferenceScopes.add(scope);}
  releaseScreenFadeReference(scope:ScreenFadeReferenceLeases,lease:ScreenAliasLease):void {scope.release(lease);if(!scope.hasReferences)this.screenFadeReferenceScopes.delete(scope);}
  releaseScreenFadeOwner(owner:string):void {
    for(const scope of this.screenFadeReferenceScopes){scope.releaseOwner(owner);if(!scope.hasReferences)this.screenFadeReferenceScopes.delete(scope);}
  }
  transferScreenFadeOwner(owner:string,next:string):void {for(const scope of this.screenFadeReferenceScopes)scope.transfer(owner,next);}

  // Runtime-only identity tombstones fence stripped clock DTOs after rows expire.
  // They retain no native resources and survive this World's dispose/init cycle.
  private readonly endingClockRootIdentities=new Set<string>();
  isEndingClockRoot(owner:string):boolean{return this.endingClockRootIdentities.has(owner);}
  private readonly endingClockReferenceScopes=new Set<EndingClockReferenceLeases>();
  hasEndingClockOwner(owner:string):boolean{return [...this.endingClockReferenceScopes].some(s=>s.hasOwner(owner));}
  registerEndingClockReferenceScope(scope:EndingClockReferenceLeases,owner:string):void{this.endingClockReferenceScopes.add(scope);this.endingClockRootIdentities.add(owner);}
  releaseEndingClockOwner(owner:string):void{for(const scope of this.endingClockReferenceScopes){scope.releaseOwner(owner);if(!scope.hasReferences)this.endingClockReferenceScopes.delete(scope);}}
  transferEndingClockOwner(owner:string,next:string):void{if(this.endingClockRootIdentities.has(owner))this.endingClockRootIdentities.add(next);for(const scope of this.endingClockReferenceScopes)scope.transfer(owner,next);}
  private readonly endingAnimationReferenceScopes=new Set<EndingAnimationReferenceLeases>();
  private readonly generatedDialogReferenceScopes=new Set<GeneratedDialogReferenceLeases>();
  registerGeneratedDialogReferenceScope(scope:GeneratedDialogReferenceLeases):void {this.generatedDialogReferenceScopes.add(scope);}
  hasGeneratedDialogOwner(owner:string):boolean{return [...this.generatedDialogReferenceScopes].some(scope=>scope.hasOwner(owner));}
  releaseGeneratedDialogOwner(owner:string):void {for(const scope of this.generatedDialogReferenceScopes){scope.releaseOwner(owner);if(!scope.hasReferences)this.generatedDialogReferenceScopes.delete(scope);}}
  releaseGeneratedDialogReference(scope:GeneratedDialogReferenceLeases,lease:GeneratedDialogLease):void {scope.release(lease);if(!scope.hasReferences)this.generatedDialogReferenceScopes.delete(scope);}
  transferGeneratedDialogOwner(owner:string,next:string):void {for(const scope of this.generatedDialogReferenceScopes)scope.transfer(owner,next);}
  registerEndingAnimationReferenceScope(scope:EndingAnimationReferenceLeases):void {this.endingAnimationReferenceScopes.add(scope);}
  releaseEndingAnimationOwner(owner:string):void {for(const scope of this.endingAnimationReferenceScopes){scope.releaseOwner(owner);if(!scope.hasReferences)this.endingAnimationReferenceScopes.delete(scope);}}
  releaseEndingAnimationReference(scope:EndingAnimationReferenceLeases,lease:any):void {scope.release(lease);if(!scope.hasReferences)this.endingAnimationReferenceScopes.delete(scope);}
  transferEndingAnimationOwner(owner:string,next:string):void {for(const scope of this.endingAnimationReferenceScopes)scope.transfer(owner,next);}
  private readonly endingScrollReferenceScopes=new Set<EndingScrollReferenceLeases>();
  registerEndingScrollReferenceScope(scope:EndingScrollReferenceLeases):void {this.endingScrollReferenceScopes.add(scope);}
  releaseEndingScrollOwner(owner:string):void {for(const scope of this.endingScrollReferenceScopes){scope.releaseOwner(owner);if(!scope.hasReferences)this.endingScrollReferenceScopes.delete(scope);}}
  releaseEndingScrollReference(scope:EndingScrollReferenceLeases,lease:any):void {scope.release(lease);if(!scope.hasReferences)this.endingScrollReferenceScopes.delete(scope);}
  transferEndingScrollOwner(owner:string,next:string):void {for(const scope of this.endingScrollReferenceScopes)scope.transfer(owner,next);}
  private readonly endingShowReferenceScopes=new Set<EndingShowReferenceLeases>();
  registerEndingShowReferenceScope(scope:EndingShowReferenceLeases):void {this.endingShowReferenceScopes.add(scope);}
  releaseEndingShowReference(scope:EndingShowReferenceLeases,lease:EndingShowLease):void {scope.release(lease);if(!scope.hasReferences)this.endingShowReferenceScopes.delete(scope);}
  releaseEndingShowOwner(owner:string):void {for(const scope of this.endingShowReferenceScopes){scope.releaseOwner(owner);if(!scope.hasReferences)this.endingShowReferenceScopes.delete(scope);}}
  transferEndingShowOwner(owner:string,next:string):void {for(const scope of this.endingShowReferenceScopes)scope.transfer(owner,next);}

  private cancellableExecutionScopes = new Set<{ clear(): void; check(): void }>();
  registerCancellableExecutionScope(scope: { clear(): void; check(): void }) { this.cancellableExecutionScopes.add(scope); }
  releaseCancellableExecutionScope(scope: { clear(): void; check(): void }) { this.cancellableExecutionScopes.delete(scope); }
  private checkCancellableExecutionScopes() { for (const scope of this.cancellableExecutionScopes) scope.check(); }

  dispose() {
    for (const scope of this.cancellableExecutionScopes) scope.clear();
    this.cancellableExecutionScopes.clear();
    this.teleportPublications.clear();
    for(const scope of this.generatedDialogReferenceScopes)scope.clear();
    this.generatedDialogReferenceScopes.clear();
    for(const scope of this.endingAnimationReferenceScopes)scope.clear();
    this.endingAnimationReferenceScopes.clear();
    for(const scope of this.endingScrollReferenceScopes)scope.clear();
    this.endingScrollReferenceScopes.clear();
    for(const scope of this.endingClockReferenceScopes)scope.clear();
    this.endingClockReferenceScopes.clear();
    for(const scope of this.endingShowReferenceScopes)scope.clear();
    this.endingShowReferenceScopes.clear();
    for(const scope of this.screenFadeReferenceScopes)scope.clear();
    this.screenFadeReferenceScopes.clear();
    this.compositionReferences.clear();
    if (this._initialised) {
      stateService.off('globalChanged', this._handleGlobalChanged);
      stateService.off('gameDataChanged', this._handleGameDataChanged);
      if (this._playerStatusSignalUnsubscribe) {
        this._playerStatusSignalUnsubscribe();
        this._playerStatusSignalUnsubscribe = null;
      }
      this._initialised = false;
    }
    if (typeof this.registry.clear === 'function') {
      this.registry.clear();
    }
    this.entityMaps.viewport = null;
    this.entityMaps.scene = null;
    this.entityMaps.eventObject.clear();
    this._eventBytesSnapshot = null;
    this._sceneBytesSnapshot = null;
    this._objectBytesSnapshot = null;
    this.entityMaps.mapMeta = null;
    this.entityMaps.mapTile = null;
    this.entityMaps.scriptRegister = null;
   this.entityMaps.moveQueue = null;
    this.entityMaps.collision = null;
    this._collisionState = null;
    this._eventObjectsVersion = (typeof this._eventObjectsVersion === 'number' ? this._eventObjectsVersion : 0) + 1;
    this._eventObjectsCache = null;
    this._eventObjectsCacheVersion = -1;
    updateSceneIdValue(0, { source: 'worldService:dispose' });
    updateEventObjectsValue([], { source: 'worldService:dispose' });
    updateCollisionStateValue(null, { source: 'worldService:dispose' });
    resetAudioResourceSlice();
    resetScriptObjectSlice();
    resetBattleFormationSlice();
    resetPlayerStateSlice();
  }

  /**
   * 状态切片变了:投影期间是我们自己写的,忽略;否则是旧路径(直接写切片、或 Global 导入到切片)——
   * 导入组件,再照旧把 Global 镜像成同样的值(#63 的语义)。
   */
  _handlePlayerStatusSignal(matrix: any) {
    if (!Array.isArray(matrix) || this._projectingStatus) return;
    const w = this.writer;
    const prev = w.get(w.world(), StatusMatricesComponent);
    const poison = prev ? prev.poison : poisonToPlain(stateService.getGlobal('poisonStatus'));
    w.set(w.world(), StatusMatricesComponent, { status: statusToPlain(getPlayerStatusMatrixValue()), poison });
    this._mirrorPlayerStatusGlobal();
  }

  /** Global.playerStatus 跟切片一致(不一致才写,同 #63) */
  _mirrorPlayerStatusGlobal() {
    const legacy = stateService.getGlobal('playerStatus');
    const current = getPlayerStatusMatrixValue();
    if (JSON.stringify(legacy) === JSON.stringify(current)) return;
    const was = this._projectingStatus;
    this._projectingStatus = true;
    try {
      // The globalChanged import sees identical data, so it does not emit another signal change.
      stateService.setGlobal('playerStatus', current);
    } finally {
      this._projectingStatus = was;
    }
  }

  // ---- 状态 / 中毒矩阵:真相源是 StatusMatrices 组件(M2 D2a)--------------------------
  // 状态切片、Global.playerStatus、Global.poisonStatus、中毒切片都是投影。

  _statusState(): StatusMatricesState {
    const w = this.writer;
    return w.get(w.world(), StatusMatricesComponent) ?? this._importStatusMatrices();
  }

  /** 旧真相源 → 组件:状态以切片为准(#63),中毒以 Global 为准 */
  _importStatusMatrices(): StatusMatricesState {
    const state: StatusMatricesState = {
      status: statusToPlain(getPlayerStatusMatrixValue()),
      poison: poisonToPlain(stateService.getGlobal('poisonStatus'))
    };
    this.writer.set(this.writer.world(), StatusMatricesComponent, state);
    return state;
  }

  _importPoisonFromGlobal() {
    const prev = this._statusState();
    this.writer.set(this.writer.world(), StatusMatricesComponent, { ...prev, poison: poisonToPlain(stateService.getGlobal('poisonStatus')) });
  }

  /** 写组件,再投影这次写到的那一半(事件流同旧写口) */
  _writeStatusMatrices(next: StatusMatricesState, touched: 'status' | 'poison') {
    const w = this.writer;
    const state = w.set(w.world(), StatusMatricesComponent, next);
    this._projectingStatus = true;
    try {
      if (touched === 'status') {
        const result = updatePlayerStatusMatrix(statusFromPlain(state.status), { source: 'worldService' });
        this._mirrorPlayerStatusGlobal();
        return result;
      }
      return stateService.mutateGlobal('poisonStatus', (status) => {
        const current: any[] = Array.isArray(status) ? (status as any[]) : [];
        for (let i = 0; i < state.poison.length; i++) {
          const row = state.poison[i];
          if (!row) continue;
          if (!Array.isArray(current[i])) current[i] = [];
          for (let j = 0; j < row.length; j++) {
            const e = row[j];
            if (!e) continue;
            const target = current[i][j] || (current[i][j] = { poisonID: 0, poisonScript: 0 });
            if (target.poisonID !== e.poisonID) target.poisonID = e.poisonID;
            if (target.poisonScript !== e.poisonScript) target.poisonScript = e.poisonScript;
          }
        }
        return current;
      });
    } finally {
      this._projectingStatus = false;
    }
  }

  /** 存档编码:中毒矩阵从组件逐字段写进 SaveData.poisonStatus */
  encodePoisonInto(target: any[]) {
    if (!Array.isArray(target)) return;
    const rows = this._statusState().poison;
    for (let i = 0; i < target.length; i++) {
      const out = target[i];
      if (!Array.isArray(out)) continue;
      for (let j = 0; j < out.length; j++) {
        const t = out[j];
        if (!t) continue;
        const e = rows[i]?.[j];
        t.poisonID = e ? e.poisonID : 0;
        t.poisonScript = e ? e.poisonScript : 0;
      }
    }
  }

  _ensureInitialised() {
    if (!this._initialised) {
      this.init();
    }
  }

  _syncAutoBattleFlag(value: any) {
    const resolved = typeof value === 'boolean' ? value : this._getBooleanGlobal('autoBattle', false);
    updateAutoBattle(resolved, { emitEvent: false, source: 'worldService:sync' });
  }

  _syncFrameCountValue(value: any) {
    const resolved = Number.isFinite(value) ? Math.trunc(value) : this._getNumberGlobal('frameNum', 0);
    updateFrameCount(resolved, { emitEvent: false, source: 'worldService:sync' });
  }

  _cloneTrailSnapshot(trail: any[]) {
    if (!Array.isArray(trail)) {
      return [];
    }
    return trail.map((entry) => {
      if (entry && typeof entry === 'object') {
        return { ...entry };
      }
      return typeof entry === 'undefined' ? null : entry;
    });
  }

  _replaceGameDataTable<T>(key: string, value: T) {
    this._ensureInitialised();
    stateService.setGameData(key, value);
    return value;
  }

  _copyStructIntoGlobal<T>(key: string, source: T, syncFn?: () => void) {
    this._ensureInitialised();
    if (typeof source === 'undefined') {
      stateService.setGlobal(key, source);
      if (typeof syncFn === 'function') syncFn();
      return source;
    }
    const current = stateService.getGlobal(key) as T;
    const isStructArray = Array.isArray(current) || Array.isArray(source);
    if (
      !isStructArray &&
      current &&
      source &&
      (current as any).uint8Array instanceof Uint8Array &&
      (source as any).uint8Array instanceof Uint8Array &&
      (current as any).uint8Array.length === (source as any).uint8Array.length
    ) {
      (current as any).uint8Array.set((source as any).uint8Array);
      if (typeof syncFn === 'function') syncFn();
      return current;
    }
    const clone = (source && typeof (source as any).copy === 'function') ? (source as any).copy() : source;
    stateService.setGlobal(key, clone);
    if (typeof syncFn === 'function') syncFn();
    return clone;
  }

  _migrateLegacySpriteLimit() {
    let legacyValue = DEFAULT_MAX_SPRITE_TO_DRAW;
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any)[LEGACY_SPRITE_LIMIT_KEY] === 'number') {
      const stored = (globalThis as any)[LEGACY_SPRITE_LIMIT_KEY];
      if (Number.isFinite(stored)) {
        legacyValue = Math.trunc(stored);
      }
    } else {
      const store = getGlobalStore();
      if (store && typeof store[MAX_SPRITE_STATE_KEY] === 'number' && Number.isFinite(store[MAX_SPRITE_STATE_KEY])) {
        legacyValue = Math.trunc(store[MAX_SPRITE_STATE_KEY]);
      }
    }
    this._maxSpriteDrawLimit = legacyValue;
    if (typeof globalThis !== 'undefined') {
      (globalThis as any)[LEGACY_SPRITE_LIMIT_KEY] = legacyValue;
    }
  }

  _ensureMoveQueue() {
    this._ensureInitialised();
    let entityId = this.entityMaps.moveQueue;
    if (!entityId) {
      entityId = this.registry.createEntity();
      this.registry.addComponent(entityId, WorldComponents.MoveRequestQueue, createMoveRequestQueueComponent());
      this.entityMaps.moveQueue = entityId;
    }
    const component = this.registry.getComponent(entityId, WorldComponents.MoveRequestQueue);
    if (component) {
      const hasRequests = Array.isArray((component as any).requests);
      const hasQueue = Array.isArray((component as any).queue);
      if (!hasRequests && hasQueue) {
        (component as any).requests = (component as any).queue;
      } else if (!hasQueue && hasRequests) {
        (component as any).queue = (component as any).requests;
      } else if (!hasRequests && !hasQueue) {
        (component as any).requests = [];
        (component as any).queue = (component as any).requests;
      }
    }
    return component;
  }

  _ensureCollisionStateEntity() {
    this._ensureInitialised();
    let entityId = this.entityMaps.collision;
    if (!entityId) {
      entityId = this.registry.createEntity();
      this.registry.addComponent(entityId, WorldComponents.CollisionState, createCollisionStateComponent());
      this.entityMaps.collision = entityId;
    }
    return this.registry.getComponent(entityId, WorldComponents.CollisionState);
  }

  getRegistry() {
    return this.registry;
  }

  getWorldWriter() {
    return this.writer;
  }

  syncAll() {
    this.syncViewport();
    this.syncPartyMembers();
    this.syncTrail();
    this.syncScene();
    this.syncMapMeta();
    this.syncMapTiles();
    this.syncEventObjects();
    this.syncScriptRegisters();
    this.syncObjectStores();
    this.syncBattleFormation();
    this.syncPlayerRoles();
    this.syncStatusMatrices();
    this.syncEquipmentEffects();
    this._ensureMoveQueue();
    this.syncReactiveGlobals();
  }

  syncViewport() {
    this._ensureInitialised();
    const registry = this.registry;
    const viewportValue = (stateService.getGlobal('viewport') as number) || 0;
    const offsetValue = (stateService.getGlobal('partyOffset') as number) || 0;
    let entityId = this.entityMaps.viewport;
    if (!entityId) {
      entityId = registry.createEntity();
      registry.addComponent(entityId, WorldComponents.Viewport, createViewportComponent({
        value: viewportValue,
        partyOffset: offsetValue
      }));
      this.entityMaps.viewport = entityId;
    } else {
      const component = registry.getComponent(entityId, WorldComponents.Viewport);
      if (component) {
        component.value = viewportValue;
        component.partyOffset = offsetValue;
      }
    }
    this.fire('viewportSynced', { value: viewportValue, partyOffset: offsetValue });
  }

  persistViewport() {
    const component = this._ensureViewportComponent();
    const viewportValue = component && typeof component.value === 'number' ? component.value : 0;
    const offsetValue = component && typeof component.partyOffset === 'number' ? component.partyOffset : 0;
    stateService.setGlobal('viewport', viewportValue);
    stateService.setGlobal('partyOffset', offsetValue);
  }

  syncPartyMembers() {
    this._ensureInitialised();
    const party = (stateService.getGlobal('party') as PartyMember[] | null) || [];
    const normalizedParty = Array.isArray(party) ? (party as Record<string, unknown>[]) : [];
    updatePartySliceValue(normalizedParty, { source: 'worldService:syncParty' });
    this.fire('partySynced', { size: party.length });
  }

  syncTrail() {
    this._ensureInitialised();
    const trail = stateService.getGlobal('trail') || null;
    const normalizedTrail = Array.isArray(trail) ? (trail as Record<string, unknown>[]) : [];
    updateTrailSliceValue(normalizedTrail, { source: 'worldService:syncTrail' });
    this.fire('trailSynced', { trail });
  }

  syncReactiveGlobals() {
    const globalStore = stateService.getGlobal() as GlobalStoreLoose | null;
    const autoBattleValue = globalStore && typeof globalStore.autoBattle !== 'undefined'
      ? !!globalStore.autoBattle
      : this._getBooleanGlobal('autoBattle', false);
    this._syncAutoBattleFlag(autoBattleValue);

    const frameValue = globalStore && typeof globalStore.frameNum !== 'undefined'
      ? globalStore.frameNum
      : this._getNumberGlobal('frameNum', 0);
    this._syncFrameCountValue(frameValue);

    const mainMenuValue = globalStore && typeof globalStore.curMainMenuItem !== 'undefined'
      ? globalStore.curMainMenuItem
      : this._getNumberGlobal('curMainMenuItem', 0);
    updateMainMenuIndex(mainMenuValue, { emitEvent: false, source: 'worldService:sync' });

    const systemMenuValue = globalStore && typeof globalStore.curSystemMenuItem !== 'undefined'
      ? globalStore.curSystemMenuItem
      : this._getNumberGlobal('curSystemMenuItem', 0);
    updateSystemMenuIndex(systemMenuValue, { emitEvent: false, source: 'worldService:sync' });

    const inventoryMenuValue = globalStore && typeof globalStore.curInvMenuItem !== 'undefined'
      ? globalStore.curInvMenuItem
      : this._getNumberGlobal('curInvMenuItem', 0);
    updateInventoryMenuIndex(inventoryMenuValue, { emitEvent: false, source: 'worldService:sync' });

    const noMusicValue = globalStore && typeof globalStore.noMusic !== 'undefined'
      ? !!globalStore.noMusic
      : this._getBooleanGlobal('noMusic', false);
    updateNoMusicFlag(noMusicValue, { emitEvent: false, source: 'worldService:sync' });

    const noSoundValue = globalStore && typeof globalStore.noSound !== 'undefined'
      ? !!globalStore.noSound
      : this._getBooleanGlobal('noSound', false);
    updateNoSoundFlag(noSoundValue, { emitEvent: false, source: 'worldService:sync' });

    const inventoryValue = stateService.getGlobal('inventory');
    updateInventoryValue(Array.isArray(inventoryValue) ? inventoryValue : [], { emitEvent: false, source: 'worldService:sync', capacity: this.getInventoryCapacity() });

    const cashValue = stateService.getGlobal('cash');
    const resolvedCash = typeof cashValue === 'number' ? Math.trunc(cashValue) : 0;
    updateCashValue(resolvedCash, { emitEvent: false, source: 'worldService:sync', capacity: this.getInventoryCapacity ? this.getInventoryCapacity() : undefined });
    // 整体同步 = 旧真相源 → 组件的导入边界
    if (!this._projectingInventory) this._importInventoryFromGlobal();

    const lastUnequippedValue = stateService.getGlobal('lastUnequippedItem');
    updateLastUnequippedValue(typeof lastUnequippedValue === 'number' ? Math.trunc(lastUnequippedValue) : 0, { emitEvent: false, source: 'worldService:sync' });

    const collectValue = stateService.getGlobal('collectValue');
    updateCollectValue(typeof collectValue === 'number' ? Math.trunc(collectValue) : 0, { emitEvent: false, source: 'worldService:sync' });

    const chaseRangeValue = stateService.getGlobal('chaseRange');
    updateChaseRangeValue(typeof chaseRangeValue === 'number' ? Math.trunc(chaseRangeValue) : 0, { emitEvent: false, source: 'worldService:sync' });

    const chaseCyclesValue = stateService.getGlobal('chaseSpeedChangeCycles');
    updateChaseSpeedCyclesValue(typeof chaseCyclesValue === 'number' ? Math.trunc(chaseCyclesValue) : 0, { emitEvent: false, source: 'worldService:sync' });

    const battleSpeedValue = stateService.getGlobal('battleSpeed');
    updateBattleSpeedValue(typeof battleSpeedValue === 'number' ? Math.trunc(battleSpeedValue) : 2, { emitEvent: false, source: 'worldService:sync' });

    const viewportValue = globalStore && typeof globalStore.viewport !== 'undefined'
      ? globalStore.viewport
      : stateService.getGlobal('viewport') || 0;
    updateViewportValue(Number(viewportValue) || 0, { emitEvent: false, source: 'worldService:sync' });

    const partyOffsetValue = globalStore && typeof (globalStore as GlobalStoreLoose).partyOffset !== 'undefined'
      ? (globalStore as GlobalStoreLoose).partyOffset
      : stateService.getGlobal('partyOffset') || 0;
    updatePartyOffsetValue(Number(partyOffsetValue) || 0, { emitEvent: false, source: 'worldService:sync' });

    const partyDirectionValue = globalStore && typeof (globalStore as GlobalStoreLoose).partyDirection !== 'undefined'
      ? (globalStore as GlobalStoreLoose).partyDirection
      : this.getPartyDirection();
    updatePartyDirectionValue(partyDirectionValue, { emitEvent: false, source: 'worldService:sync' });

    const maxPartyIndexValue = globalStore && typeof (globalStore as GlobalStoreLoose).maxPartyMemberIndex !== 'undefined'
      ? (globalStore as GlobalStoreLoose).maxPartyMemberIndex as number
      : this.getMaxPartyMemberIndex();
    updateMaxPartyIndexValue(maxPartyIndexValue, { emitEvent: false, source: 'worldService:sync' });

    const partyValue = globalStore && Array.isArray((globalStore as GlobalStoreLoose).party)
      ? (globalStore as GlobalStoreLoose).party
      : (stateService.getGlobal('party') || []);
    updatePartySliceValue(Array.isArray(partyValue) ? partyValue : [], { emitEvent: false, source: 'worldService:sync' });

    const trailValue = globalStore && Array.isArray((globalStore as GlobalStoreLoose).trail)
      ? (globalStore as GlobalStoreLoose).trail
      : (stateService.getGlobal('trail') || []);
    updateTrailSliceValue(Array.isArray(trailValue) ? trailValue : [], { emitEvent: false, source: 'worldService:sync' });

    const looseStore = globalStore as GlobalStoreLoose | null;
    const followerCountValue = looseStore && typeof looseStore.numFollower !== 'undefined'
      ? looseStore.numFollower
      : this._getNumberGlobal('numFollower', 0);
    updateFollowerCountSliceValue(followerCountValue, { emitEvent: false, source: 'worldService:sync' });
    // 整体同步 = 旧真相源 → 组件的导入边界
    if (!this._projectingParty) this._importPartyFromGlobal();

    const musicTrackValue = looseStore && typeof looseStore.musicNum !== 'undefined'
      ? looseStore.musicNum
      : this._getNumberGlobal('musicNum', 0);
    updateMusicTrackValue(musicTrackValue, { emitEvent: false, source: 'worldService:sync' });

    const battleMusicValue = looseStore && typeof looseStore.numBattleMusic !== 'undefined'
      ? looseStore.numBattleMusic
      : this._getNumberGlobal('numBattleMusic', 0);
    updateBattleMusicTrackValue(battleMusicValue, { emitEvent: false, source: 'worldService:sync' });

    const battleFieldValue = looseStore && typeof looseStore.numBattleField !== 'undefined'
      ? looseStore.numBattleField
      : this._getNumberGlobal('numBattleField', 0);
    updateBattleFieldIdValue(battleFieldValue, { emitEvent: false, source: 'worldService:sync' });

    const screenWaveValue = looseStore && typeof looseStore.screenWave !== 'undefined'
      ? looseStore.screenWave
      : this._getNumberGlobal('screenWave', 0);
    updateScreenWaveValue(screenWaveValue, { emitEvent: false, source: 'worldService:sync' });

    const waveProgressValue = looseStore && typeof looseStore.waveProgression !== 'undefined'
      ? looseStore.waveProgression
      : this._getNumberGlobal('waveProgression', 0);
    updateWaveProgressionValue(waveProgressValue, { emitEvent: false, source: 'worldService:sync' });

    const needFadeInValue = looseStore && typeof looseStore.needToFadeIn !== 'undefined'
      ? !!looseStore.needToFadeIn
      : this._getBooleanGlobal('needToFadeIn', false);
    updateNeedToFadeInValue(needFadeInValue, { emitEvent: false, source: 'worldService:sync' });

    const paletteIdValue = looseStore && typeof looseStore.numPalette !== 'undefined'
      ? looseStore.numPalette
      : this._getNumberGlobal('numPalette', 0);
    updatePaletteIdValue(paletteIdValue, { emitEvent: false, source: 'worldService:sync' });

    const nightPaletteValue = looseStore && typeof looseStore.nightPalette !== 'undefined'
      ? !!looseStore.nightPalette
      : this._getBooleanGlobal('nightPalette', false);
    updateNightPaletteValue(nightPaletteValue, { emitEvent: false, source: 'worldService:sync' });

    const layerValue = looseStore && typeof looseStore.layer !== 'undefined'
      ? looseStore.layer
      : this._getNumberGlobal('layer', 0);
    updateLayerValue(layerValue, { emitEvent: false, source: 'worldService:sync' });
  }

  syncScene() {
    this._ensureInitialised();
    const registry = this.registry;
    const numScene = stateService.getGlobal('numScene') as number;
    const gameData = getGameDataStore();
    const scenes = gameData && Array.isArray((gameData as any).scene) ? (gameData as any).scene : [];
    const sceneIndex = typeof numScene === 'number' ? numScene - 1 : -1;
    const sceneRef = sceneIndex >= 0 && sceneIndex < scenes.length ? scenes[sceneIndex] : null;
    const nextSceneRef = sceneIndex + 1 >= 0 && sceneIndex + 1 < scenes.length ? scenes[sceneIndex + 1] : null;
    const mapId = sceneRef && typeof sceneRef.mapNum === 'number' ? sceneRef.mapNum : null;
    const maps = gameData && Array.isArray((gameData as any).map) ? (gameData as any).map : [];
    const mapRef = mapId != null && mapId >= 0 && mapId < maps.length ? maps[mapId] : null;

    let entityId = this.entityMaps.scene;
    if (!entityId) {
      entityId = registry.createEntity();
      registry.addComponent(entityId, WorldComponents.Scene, createSceneComponent({
        sceneId: typeof numScene === 'number' ? numScene : null,
        sceneRef,
        nextSceneRef,
        mapId,
        mapRef
      }));
      this.entityMaps.scene = entityId;
    } else {
      const component = registry.getComponent(entityId, WorldComponents.Scene);
      if (component) {
        component.sceneId = numScene;
        component.sceneRef = sceneRef;
        component.nextSceneRef = nextSceneRef;
        component.mapId = mapId;
        component.mapRef = mapRef;
      }
    }

    this.fire('sceneSynced', {
      sceneId: numScene,
      scene: sceneRef,
      nextScene: nextSceneRef,
      mapId,
      map: mapRef
    });
    updateSceneIdValue(typeof numScene === 'number' ? numScene : 0, { source: 'worldService:syncScene' });

    this.syncMapMeta();
    this.syncMapTiles();
  }

  syncMapMeta() {
    this._ensureInitialised();
    const registry = this.registry;
    const sceneEntity = this.entityMaps.scene;
    if (!sceneEntity) {
      return;
    }
    const numScene = stateService.getGlobal('numScene') as number;
    const gameData = getGameDataStore();
    const scenes = gameData && Array.isArray(gameData.scene) ? gameData.scene : [];
    const sceneIndex = typeof numScene === 'number' ? numScene - 1 : -1;
    const sceneRef = sceneIndex >= 0 && sceneIndex < scenes.length ? scenes[sceneIndex] : null;
    const mapId = sceneRef && typeof sceneRef.mapNum === 'number' ? sceneRef.mapNum : null;
    const maps = gameData && Array.isArray(gameData.map) ? gameData.map : null;
    const mapRef = mapId != null && maps ? maps[mapId] || null : null;

    const payload = {
      sceneId: typeof numScene === 'number' ? numScene : null,
      mapId,
      sceneRef,
      mapRef,
      scriptOnEnter: sceneRef ? sceneRef.scriptOnEnter : null,
      scriptOnTeleport: sceneRef ? sceneRef.scriptOnTeleport : null
    };

    const component = registry.getComponent(sceneEntity, WorldComponents.MapMeta);
    if (component) {
      component.sceneId = payload.sceneId;
      component.mapId = payload.mapId;
      component.sceneRef = payload.sceneRef;
      component.mapRef = payload.mapRef;
      component.scriptOnEnter = payload.scriptOnEnter;
      component.scriptOnTeleport = payload.scriptOnTeleport;
    } else {
      registry.addComponent(sceneEntity, WorldComponents.MapMeta, createMapMetaComponent(payload));
    }
    this.entityMaps.mapMeta = sceneEntity;
    this.fire('mapMetaSynced', { sceneId: payload.sceneId, mapId: payload.mapId });
    this._collisionState = null;
    updateCollisionStateValue(null, { source: 'worldService:syncMapMeta' });
  }

  syncMapTiles() {
    this._ensureInitialised();
    const registry = this.registry;
    const sceneEntity = this.entityMaps.scene;
    if (!sceneEntity) {
      return;
    }
    const numScene = stateService.getGlobal('numScene') as number;
    const gameData = getGameDataStore();
    const scenes = gameData && Array.isArray(gameData.scene) ? gameData.scene : [];
    const sceneIndex = typeof numScene === 'number' ? numScene - 1 : -1;
    const sceneRef = sceneIndex >= 0 && sceneIndex < scenes.length ? scenes[sceneIndex] : null;
    const mapId = sceneRef && typeof sceneRef.mapNum === 'number' ? sceneRef.mapNum : null;
    const maps = gameData && Array.isArray(gameData.map) ? gameData.map : null;
    const mapRef = mapId != null && maps ? maps[mapId] || null : null;

    const payload = {
      mapId,
      sceneId: typeof numScene === 'number' ? numScene : null,
      mapRef,
      width: mapRef && typeof mapRef.width === 'number' ? mapRef.width : 64,
      height: mapRef && typeof mapRef.height === 'number' ? mapRef.height : 128,
      layers: mapRef && mapRef.layers ? mapRef.layers : null,
      tileData: mapRef && mapRef.tiles ? mapRef.tiles : null
    };

    const component = registry.getComponent(sceneEntity, WorldComponents.MapTile);
    if (component) {
      component.mapId = payload.mapId;
      component.sceneId = payload.sceneId;
      component.mapRef = payload.mapRef;
      component.width = payload.width;
      component.height = payload.height;
      component.layers = payload.layers;
      component.tileData = payload.tileData;
    } else {
      registry.addComponent(sceneEntity, WorldComponents.MapTile, createMapTileComponent(payload));
    }
    this.entityMaps.mapTile = sceneEntity;
    this.fire('mapTilesSynced', { sceneId: payload.sceneId, mapId: payload.mapId });
    this._collisionState = null;
    updateCollisionStateValue(null, { source: 'worldService:syncMapTiles' });
  }

  syncEventObjects() {
    this._ensureInitialised();
    const registry = this.registry;
    const gameData = getGameDataStore();
    const eventObjects = gameData && gameData.eventObject ? gameData.eventObject : [];
    const sceneId = stateService.getGlobal('numScene') as number;
    const visited = new Set();
    const list = Array.isArray(eventObjects) ? eventObjects : [];
    for (let i = 0; i < list.length; i++) {
      const eventObject = list[i];
      if (!eventObject) {
        continue;
      }
      this._syncEventObjectEntity(i, eventObject, sceneId);
      visited.add(i);
    }

    (this.entityMaps.eventObject as Map<number, any>).forEach((entityId: any, id: number) => {
      if (!visited.has(id)) {
        this.entityMaps.eventObject.delete(id);
        if (registry.hasEntity && registry.hasEntity(entityId)) {
          registry.destroyEntity && registry.destroyEntity(entityId);
        }
      }
    });

    const count = Array.isArray(eventObjects) ? eventObjects.length : 0;
    this.fire('eventObjectsSynced', { count });
    this.fire('npcStatesSynced', { count, sceneId });
    this._collisionState = null;
    this._eventObjectsVersion = (typeof this._eventObjectsVersion === 'number' ? this._eventObjectsVersion : 0) + 1;
    const sceneEventObjects = this.getEventObjectsInCurrentScene();
    updateEventObjectsValue(sceneEventObjects, { source: 'worldService:syncEventObjects' });
    updateCollisionStateValue(null, { source: 'worldService:syncEventObjects' });
    this.captureEventObjects();
  }

  // ---- 事件对象 / 场景条目 / 物件条目:写穿 + 帧边界捕获(M2 D4)------------------------------
  // 活结构体仍是工作区(渲染 / 碰撞 / 主循环 / script-runner / 引用租约持活引用,script-runner 有直接改字段)。
  // 写口结束抓本次的条目;每帧结束(play.startFrame)把事件对象表与字节快照逐字节比,变了的写进组件。不发事件。

  /** 事件对象表 → 每个事件对象实体上的 EventObject.words;only 给定时只看这一条 */
  captureEventObjects(only?: number) {
    const table = stateService.getGameData('eventObject') as any[] | null;
    if (!Array.isArray(table)) return;
    const REC = 32;
    let snap = this._eventBytesSnapshot;
    const fresh = !snap || snap.length !== table.length * REC;
    if (fresh) snap = this._eventBytesSnapshot = new Uint8Array(table.length * REC);
    const from = only != null && !fresh ? only : 0;
    const to = only != null && !fresh ? only + 1 : table.length;
    const w = this.writer;
    for (let i = from; i < to; i++) {
      const entityId = this.entityMaps.eventObject.get(i);
      if (!entityId) continue;
      const entry = table[i];
      const own: unknown = entry && entry.uint8Array;
      const base = i * REC;
      let same = !fresh;
      if (same) {
        if (own instanceof Uint8Array && own.length >= REC) {
          for (let b = 0; b < REC; b++) if (own[b] !== snap![base + b]) { same = false; break; }
        } else {
          same = sameBytes(recordBytes(entry, 16, EVENT_OBJECT_FIELDS), snap!.subarray(base, base + REC));
        }
      }
      if (same) continue;
      const rec = recordBytes(entry, 16, EVENT_OBJECT_FIELDS);
      snap!.set(rec, base);
      w.set(entityId as number, EventObjectComponent, { words: bytesToWords(rec) });
    }
  }

  captureSceneTable() {
    const bytes = tableBytes(stateService.getGameData('scene'), 4, SCENE_FIELDS);
    if (this._sceneBytesSnapshot && sameBytes(bytes, this._sceneBytesSnapshot)) return;
    this._sceneBytesSnapshot = bytes;
    this.writer.set(this.writer.world(), SceneTableComponent, { words: bytesToWords(bytes) });
  }

  captureObjectTable() {
    const bytes = tableBytes(stateService.getGameData('object'), 6);
    if (this._objectBytesSnapshot && sameBytes(bytes, this._objectBytesSnapshot)) return;
    this._objectBytesSnapshot = bytes;
    this.writer.set(this.writer.world(), ObjectTableComponent, { words: bytesToWords(bytes) });
  }

  /** 帧边界:三张表都对一遍(play.startFrame 在一帧的逻辑之后调) */
  captureWorldTables() {
    this.captureEventObjects();
    this.captureSceneTable();
    this.captureObjectTable();
  }

  /**
   * 世界状态快照(M2 D5a):STATE_COMPONENTS 里的单例组件 + 事件对象按下标(不含实体 id,
   * 实体分配顺序变了也不影响)。值是 writer 里冻结的原件,不拷贝,只读。
   */
  getStateSnapshot() {
    const w = this.writer;
    const world = w.world();
    const components: Record<string, unknown> = {};
    for (const def of STATE_COMPONENTS) {
      const v = w.peek(world, def);
      if (v !== undefined) components[def.name] = v;
    }
    const eventObjects: Array<ReadonlyArray<number> | null> = [];
    (this.entityMaps.eventObject as Map<number, any>).forEach((entityId: any, index: number) => {
      eventObjects[index] = w.peek(entityId as number, EventObjectComponent)?.words ?? null;
    });
    for (let i = 0; i < eventObjects.length; i++) if (eventObjects[i] === undefined) eventObjects[i] = null;
    return { version: 1, components, eventObjects };
  }

  stateHash(): string {
    return hashString(stableStringify(this.getStateSnapshot()));
  }

  /**
   * 存档前把写穿的组件对齐到当下(M2 D5b):事件对象 / 场景 / 物件表的帧边界捕获,角色 / 经验的写口捕获。
   * 存档可能发生在一帧中间(脚本里存档、agent 的 save 工具),不能等下一个帧边界。都是幂等的,没变不记日志
   */
  captureForSave() {
    this._ensureInitialised();
    this.captureWorldTables();
    this._captureRoles();
    this._captureExp();
    // 还没建组件的领域(从没走过写口)按旧真相源导入一次
    this._inventoryState();
    this._statusState();
    this._partyState();
  }

  /** 存档头里取自队伍组件的字段 */
  getPartySaveHeader(): { numPartyMember: number; numFollower: number } {
    const party = this._partyState();
    return { numPartyMember: party.maxIndex, numFollower: party.followers };
  }

  /** 组件 → 存档各分区字节(sizes:分区名 → 字节数,取自 SaveData)。存档(D5b 起)与影子校验用 */
  encodeStateSaveParts(sizes: Record<string, number>): Record<string, Uint8Array> {
    const snap = this.getStateSnapshot();
    const c = snap.components as Record<string, any>;
    return encodeSaveParts({
      inventory: c[InventoryComponent.name],
      status: c[StatusMatricesComponent.name],
      party: c[PartyComponent.name],
      roles: c[PlayerRolesComponent.name],
      exp: c[ExperienceComponent.name],
      scene: c[SceneTableComponent.name],
      object: c[ObjectTableComponent.name],
      eventObjects: snap.eventObjects
    }, sizes, { poisonCols: getConstValue('MAX_PLAYABLE_PLAYER_ROLES', 6) });
  }

  _syncEventObjectEntity(index: number, eventObject: any, sceneId: number | null = stateService.getGlobal('numScene') as number) {
    this._ensureInitialised();
    if (!eventObject) {
      this._teardownEventObjectEntity(index);
      return null;
    }
    const registry = this.registry;
    let entityId = this.entityMaps.eventObject.get(index);
    if (!entityId) {
      entityId = registry.createEntity();
      registry.addComponent(entityId, WorldComponents.EventObject, createEventObjectComponent({
        id: index,
        stateRef: eventObject,
        sceneId,
        aiState: eventObject ? {
          triggerMode: eventObject.triggerMode,
          state: eventObject.state,
          autoScript: eventObject.autoScript
        } : null
      }));
      registry.addComponent(entityId, WorldComponents.NpcState, createNpcStateComponent({
        id: index,
        sceneId,
        stateRef: eventObject,
        position: eventObject ? { x: eventObject.x, y: eventObject.y, layer: eventObject.layer } : null,
        direction: eventObject ? eventObject.direction : null,
        currentFrame: eventObject ? eventObject.currentFrameNum : null,
        state: eventObject ? eventObject.state : null,
        vanishTime: eventObject ? eventObject.vanishTime : null
      }));
      this.entityMaps.eventObject.set(index, entityId as number);
      return entityId;
    }

    const eventComponent = registry.getComponent(entityId, WorldComponents.EventObject);
    if (eventComponent) {
      eventComponent.id = index;
      eventComponent.stateRef = eventObject;
      eventComponent.sceneId = sceneId;
      eventComponent.aiState = eventObject ? {
        triggerMode: eventObject.triggerMode,
        state: eventObject.state,
        autoScript: eventObject.autoScript
      } : null;
    }

    const npcComponent = registry.getComponent(entityId, WorldComponents.NpcState);
    if (npcComponent) {
      npcComponent.id = index;
      npcComponent.sceneId = sceneId;
      npcComponent.stateRef = eventObject;
      npcComponent.position = eventObject ? { x: eventObject.x, y: eventObject.y, layer: eventObject.layer } : null;
      npcComponent.direction = eventObject ? eventObject.direction : null;
      npcComponent.currentFrame = eventObject ? eventObject.currentFrameNum : null;
      npcComponent.state = eventObject ? eventObject.state : null;
      npcComponent.vanishTime = eventObject ? eventObject.vanishTime : null;
    }

    return entityId;
  }

  _teardownEventObjectEntity(index: number) {
    const registry = this.registry;
    const entityId = this.entityMaps.eventObject.get(index);
    if (!entityId) {
      return;
    }
    this.entityMaps.eventObject.delete(index);
    if (registry.hasEntity && registry.hasEntity(entityId)) {
      registry.destroyEntity && registry.destroyEntity(entityId);
    }
  }

  syncScriptRegisters() {
    this._ensureInitialised();
    const registry = this.registry;
    const gameData = getGameDataStore();
    const rawEntries = gameData && gameData.scriptEntry ? gameData.scriptEntry : [];
    const scriptEntries = Array.isArray(rawEntries) ? rawEntries : [];
    this.pruneTeleportSources(scriptEntries);
    let entityId = this.entityMaps.scriptRegister;
    const payload = {
      count: Array.isArray(scriptEntries) || (scriptEntries && typeof (scriptEntries as any).length === 'number')
        ? (scriptEntries as any).length
        : 0,
      entries: scriptEntries,
      lastSynced: Date.now()
    };
    if (!entityId) {
      entityId = registry.createEntity();
      registry.addComponent(entityId, WorldComponents.ScriptRegister, createScriptRegisterComponent(payload));
      this.entityMaps.scriptRegister = entityId;
    } else {
      const component = registry.getComponent(entityId, WorldComponents.ScriptRegister);
      if (component) {
        component.count = payload.count;
        component.entries = payload.entries;
        component.lastSynced = payload.lastSynced;
      } else {
        registry.addComponent(entityId, WorldComponents.ScriptRegister, createScriptRegisterComponent(payload));
      }
    }
    this.fire('scriptRegistersSynced', { count: payload.count });
    updateScriptEntriesValue(scriptEntries);
  }

  syncObjectStores() {
    this._ensureInitialised();
    const gameData = getGameDataStore();
    const objectTable = gameData && Array.isArray((gameData as any).object) ? (gameData as any).object : [];
    updateObjectTableValue(objectTable);
    const magicTable = gameData && Array.isArray((gameData as any).magic) ? (gameData as any).magic : [];
    updateMagicTableValue(magicTable);
    const storeTable = gameData && Array.isArray((gameData as any).store) ? (gameData as any).store : [];
    updateStoreTableValue(storeTable);
    const levelUpMagicTable = gameData && Array.isArray((gameData as any).levelUpMagic) ? (gameData as any).levelUpMagic : [];
    updateLevelUpMagicTableValue(levelUpMagicTable);
    const levelUpExpTable = gameData && Array.isArray((gameData as any).levelUpExp) ? (gameData as any).levelUpExp : [];
    updateLevelUpExpTableValue(levelUpExpTable);
    const objectDesc = stateService.getGlobal('objectDesc');
    updateObjectDescValue((typeof objectDesc === 'undefined' ? null : objectDesc) as any);
    const expState = stateService.getGlobal('exp');
    const normalizedExp = expState && typeof expState === 'object' ? (expState as any) : null;
    updateExpStateValue(normalizedExp);
  }


  // ---- 角色数值 / 经验 / 装备加成:写穿进组件(M2 D3)----------------------------------------
  // 活结构体仍是写口回调的工作区;每个写口结束时把字节抓进组件(内容没变不记)。见 ecs/components/roles.ts。

  _captureRoles() {
    const store = getGameDataStore();
    const words = wordsOf(store && store.playerRoles);
    if (!words) return;
    const w = this.writer;
    if (!sameWords(w.peek(w.world(), PlayerRolesComponent)?.words, words)) w.set(w.world(), PlayerRolesComponent, { words });
  }

  _captureExp() {
    const words = wordsOf(stateService.getGlobal('exp'));
    if (!words) return;
    const w = this.writer;
    if (!sameWords(w.peek(w.world(), ExperienceComponent)?.words, words)) w.set(w.world(), ExperienceComponent, { words });
  }

  _captureEquipmentEffects() {
    const table = (getGlobalStore() as any)?.equipmentEffect;
    if (!Array.isArray(table)) return;
    const tables = table.map((t: any) => wordsOf(t) || []);
    const w = this.writer;
    const prev = w.peek(w.world(), EquipmentEffectComponent)?.tables;
    if (prev && prev.length === tables.length && prev.every((t, i) => sameWords(t, tables[i]))) return;
    w.set(w.world(), EquipmentEffectComponent, { tables });
  }

  syncPlayerRoles() {
    this._ensureInitialised();
    const store = getGameDataStore();
    const roles = store && store.playerRoles && typeof store.playerRoles === 'object' ? store.playerRoles : null;
    updatePlayerRolesValue(roles as any);
    this._captureRoles();
  }

  syncStatusMatrices() {
    this._ensureInitialised();
    const playerStatusGlobal = stateService.getGlobal('playerStatus');
    const poisonStatusGlobal = stateService.getGlobal('poisonStatus');
    const playerResolved = Array.isArray(playerStatusGlobal)
      ? playerStatusGlobal
      : this.getPlayerStatusMatrix();
    const poisonResolved = Array.isArray(poisonStatusGlobal)
      ? poisonStatusGlobal
      : this.getPoisonStatusMatrix();
    updatePlayerStatusMatrix(Array.isArray(playerResolved) ? playerResolved : [], { source: 'worldService:syncStatusMatrices' });
    updatePoisonStatusMatrix(Array.isArray(poisonResolved) ? poisonResolved : [], { source: 'worldService:syncStatusMatrices' });
    // 整体同步 = 旧真相源 → 组件的导入边界
    if (!this._projectingStatus) this._importStatusMatrices();
  }

  syncEquipmentEffects() {
    this._ensureInitialised();
    updateEquipmentEffectValue(this._getEquipmentEffects() || []);
    this._captureEquipmentEffects();
  }

  syncBattleFormation() {
    this._ensureInitialised();
    const gameData = getGameDataStore();
    const enemyTeam = gameData && Array.isArray(gameData.enemyTeam) ? gameData.enemyTeam : [];
    updateEnemyTeamValue(enemyTeam, { source: 'worldService:syncBattleFormation' });
    const enemyPositions = gameData && gameData.enemyPos ? gameData.enemyPos : null;
    updateEnemyPositionValue(enemyPositions || null, { source: 'worldService:syncBattleFormation' });
    const battleFields = gameData && Array.isArray(gameData.battleField) ? gameData.battleField : [];
    updateBattleFieldValue(battleFields, { source: 'worldService:syncBattleFormation' });
  }

  setScriptEntries(entries: any[]) {
    const resolved = this._replaceGameDataTable('scriptEntry', entries || []);
    this.pruneTeleportSources(resolved || []);
    updateScriptEntriesValue(resolved || []);
    return resolved;
  }

  getViewportComponent() {
    this._ensureInitialised();
    if (!this.entityMaps.viewport) {
      return null;
    }
    return this.registry.getComponent(this.entityMaps.viewport, WorldComponents.Viewport);
  }

  _ensureViewportComponent() {
    this._ensureInitialised();
    let entityId = this.entityMaps.viewport;
    const currentViewport = (stateService.getGlobal('viewport') as number) || 0;
    const currentOffset = (stateService.getGlobal('partyOffset') as number) || 0;
    if (!entityId) {
      entityId = this.registry.createEntity();
      this.registry.addComponent(entityId, WorldComponents.Viewport, createViewportComponent({
        value: currentViewport,
        partyOffset: currentOffset
      }));
      this.entityMaps.viewport = entityId;
      return this.registry.getComponent(entityId, WorldComponents.Viewport);
    }
    let component = this.registry.getComponent(entityId, WorldComponents.Viewport);
    if (!component) {
      this.registry.addComponent(entityId, WorldComponents.Viewport, createViewportComponent({
        value: currentViewport,
        partyOffset: currentOffset
      }));
      component = this.registry.getComponent(entityId, WorldComponents.Viewport);
    }
    return component;
  }

  getSceneComponent() {
    this._ensureInitialised();
    if (!this.entityMaps.scene) {
      return null;
    }
    return this.registry.getComponent(this.entityMaps.scene, WorldComponents.Scene);
  }

  getMapMetaComponent() {
    this._ensureInitialised();
    if (!this.entityMaps.mapMeta) {
      return null;
    }
    return this.registry.getComponent(this.entityMaps.mapMeta, WorldComponents.MapMeta);
  }

  getMapTileComponent() {
    this._ensureInitialised();
    if (!this.entityMaps.mapTile) {
      return null;
    }
    return this.registry.getComponent(this.entityMaps.mapTile, WorldComponents.MapTile);
  }

  getScriptEntry(entry: number) {
    this._ensureInitialised();
    const registry = this.registry;
    if (this.entityMaps.scriptRegister) {
      const component = registry.getComponent(this.entityMaps.scriptRegister, WorldComponents.ScriptRegister);
      if (component && component.entries && typeof component.entries.length === 'number') {
        const candidate = (component.entries as any)[entry];
        if (typeof candidate !== 'undefined') {
          return candidate || null;
        }
      }
    }
    const gameData = getGameDataStore();
    const scriptEntries = gameData && (gameData as any).scriptEntry;
    if (scriptEntries && typeof (scriptEntries as any).length === 'number') {
      return (scriptEntries as any)[entry] || null;
    }
    return null;
  }

  getViewport() {
    this._ensureInitialised();
    const component = this.getViewportComponent() || this._ensureViewportComponent();
    const value = component && typeof component.value === 'number' ? component.value : (stateService.getGlobal('viewport') || 0);
    updateViewportValue(value, { emitEvent: false, source: 'worldService:get' });
    return value;
  }

  getPartyOffset() {
    this._ensureInitialised();
    const component = this.getViewportComponent() || this._ensureViewportComponent();
    const value = component && typeof component.partyOffset === 'number' ? component.partyOffset : (stateService.getGlobal('partyOffset') || 0);
    updatePartyOffsetValue(value, { emitEvent: false, source: 'worldService:get' });
    return value;
  }

  setViewport(value: number) {
    this._ensureInitialised();
    const component = this._ensureViewportComponent();
    const resolved = Number.isFinite(value) ? value : 0;
    component.value = resolved;
    this.persistViewport();
    updateViewportValue(resolved, { source: 'worldService' });
    return resolved;
  }

  mutateViewport(mutator: (value: number) => number | undefined) {
    this._ensureInitialised();
    const component = this._ensureViewportComponent();
    if (typeof mutator !== 'function') {
      return component.value;
    }
    const next = mutator(component.value);
    if (typeof next === 'undefined') {
      return component.value;
    }
    const resolved = Number.isFinite(next) ? next : component.value;
    component.value = resolved;
    this.persistViewport();
    updateViewportValue(resolved, { source: 'worldService' });
    return resolved;
  }

  setPartyOffset(value: number) {
    this._ensureInitialised();
    const component = this._ensureViewportComponent();
    const resolved = Number.isFinite(value) ? value : 0;
    component.partyOffset = resolved;
    this.persistViewport();
    updatePartyOffsetValue(resolved, { source: 'worldService' });
    return resolved;
  }

  // ---- 队伍 / 尾迹 / 队伍上限 / 跟随者:真相源是 Party 组件(M2 D2c)-------------------------
  // Global.party / trail / maxPartyMemberIndex / numFollower、切片都是投影。
  // 投影复刻旧写口的调用与事件顺序(party-trail-adapter 的缓存在每次队伍事件时重建,时机不能变)。

  _partyState(): PartyState {
    const w = this.writer;
    return w.get(w.world(), PartyComponent) ?? this._importPartyFromGlobal();
  }

  /** 旧真相源 → 组件:队伍 / 尾迹 / 上限以 Global 为准,跟随者以切片为准(旧 getFollowerCount 读切片) */
  _importPartyFromGlobal(): PartyState {
    const party = stateService.getGlobal('party');
    const trail = stateService.getGlobal('trail');
    const maxIndex = stateService.getGlobal('maxPartyMemberIndex');
    const globalFollowers = stateService.getGlobal('numFollower');
    const followers = getFollowerCountValue(typeof globalFollowers === 'number' ? globalFollowers : 0);
    const state: PartyState = {
      members: Array.isArray(party) ? party.map(fitMember) : [],
      trail: Array.isArray(trail) ? trail.map(fitTrail) : [],
      maxIndex: toTrunc(typeof maxIndex === 'number' ? maxIndex : 0),
      followers: Number.isFinite(followers) ? Math.max(0, followers | 0) : 0
    };
    this.writer.set(this.writer.world(), PartyComponent, state);
    this.checkCancellableExecutionScopes();
    return state;
  }

  _setPartyComponent(next: PartyState): PartyState {
    const state = this.writer.set(this.writer.world(), PartyComponent, next);
    this.checkCancellableExecutionScopes();
    return state;
  }

  /** 把组件的队员 / 尾迹字段写进 Global 的结构体(逐字段、原地;缺的条目补普通对象) */
  _copyIntoLegacy(target: any[], rows: Array<Record<string, number> | null>, keys: string[]) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const t = target[i] || (target[i] = {});
      for (const k of keys) if (t[k] !== row[k]) t[k] = row[k];
    }
  }

  mutateTrail(mutator: (trail: any[]) => any[] | undefined) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return stateService.getGlobal('trail');
    }
    if (!Array.isArray(stateService.getGlobal('trail'))) {
      // 旧实现在尾迹不是数组时不调回调:照旧走一遍空写入与同步
      const result = stateService.mutateGlobal('trail', (current) => current);
      updateTrailSliceValue([], { source: 'worldService:mutateTrail' });
      this.syncTrail();
      return result;
    }
    const prev = this._partyState();
    const draft: any[] = prev.trail.map((t) => (t ? new TrailDraft(t) : t));
    const output = mutator(draft);
    const source = Array.isArray(output) ? output : draft;
    // 回调里可能嵌套写同一组件的别的字段(如 0x0046 在 mutateParty 里调 mutateTrail):回调后重读,只换这次写的字段
    const state = this._setPartyComponent({ ...this._partyState(), trail: source.map(fitTrail) });
    this._projectingParty = true;
    let result;
    try {
      result = stateService.mutateGlobal('trail', (current) => {
        const list = current as any[];
        this._copyIntoLegacy(list, state.trail as any, ['x', 'y', 'direction']);
        return list;
      });
      const trailRef = stateService.getGlobal('trail');
      const snapshot = this._cloneTrailSnapshot(Array.isArray(trailRef) ? trailRef : []);
      updateTrailSliceValue(snapshot, { source: 'worldService:mutateTrail' });
      this.syncTrail();
    } finally {
      this._projectingParty = false;
    }
    return result;
  }

  setTrailStruct(struct: any) {
    const result = this._copyStructIntoGlobal('trail', struct, () => this.syncTrail());
    const trail = this.getTrail();
    const snapshot = Array.isArray(trail)
      ? trail.map((entry) => (entry && typeof entry === 'object' ? { ...(entry as any) } : entry))
      : [];
    updateTrailSliceValue(snapshot, { source: 'worldService:setTrailStruct' });
    this._importPartyFromGlobal();
    return result;
  }

  getPartyMember(index: number) {
    this._ensureInitialised();
    const party = stateService.getGlobal('party') as PartyMember[] | null || [];
    return party[index] || null;
  }

  getParty(): PartyMember[] {
    this._ensureInitialised();
    const party = stateService.getGlobal('party');
    if (Array.isArray(party)) {
      return party as PartyMember[];
    }
    if (party && typeof (party as any).length === 'number') {
      return party as PartyMember[];
    }
    return [];
  }

  /**
   * 队伍上限(M2 D5c):读 Party 组件,不再读 Global 再回写切片(组件是真相源,D2c)。
   * 开局前(标题画面)Global 上还没有这个值:照旧按默认队伍推算并写进切片 —— 标题画面的存档头取自切片,
   * 去掉会让开局前的步骤分叉;开局后不走这里
   */
  getMaxPartyMemberIndex() {
    this._ensureInitialised();
    if (typeof stateService.getGlobal('maxPartyMemberIndex') === 'number') return this._partyView().maxIndex;
    return this._maxPartyIndexBeforeGame();
  }

  _maxPartyIndexBeforeGame() {
    const legacyGlobal = getGlobalObject('Global');
    if (legacyGlobal && typeof legacyGlobal.maxPartyMemberIndex === 'number') {
      const legacyValue = legacyGlobal.maxPartyMemberIndex;
      updateMaxPartyIndexValue(legacyValue, { emitEvent: false, source: 'worldService:get' });
      return legacyValue;
    }
    const party = this.getParty();
    let fallback = -1;
    if (Array.isArray(party)) {
      for (let index = 0; index < party.length; index++) {
        const member = party[index];
        if (member && typeof member.playerRole === 'number' && member.playerRole >= 0) {
          fallback = index;
        }
      }
    }
    updateMaxPartyIndexValue(fallback, { emitEvent: false, source: 'worldService:get' });
    return fallback;
  }

  /** Party 组件只读原件(不拷贝);还没有就从 Global 导入一次 */
  _partyView(): Readonly<PartyState> {
    const w = this.writer;
    return w.peek(w.world(), PartyComponent) ?? this._importPartyFromGlobal();
  }

  /** 回调拿到草稿队员(按 PARTY 结构宽度截断);提交到组件后投影(globalChanged → 同步队员 / 切片,同旧写口) */
  mutateParty(mutator: (party: PartyMember[]) => PartyMember[] | undefined) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const prev = this._partyState();
    const draft: any[] = prev.members.map((m) => (m ? new MemberDraft(m) : m));
    const output = mutator(draft as PartyMember[]);
    const source = Array.isArray(output) ? output : draft;
    // 回调里可能嵌套写同一组件的别的字段(如 0x0046 在 mutateParty 里调 mutateTrail):回调后重读,只换这次写的字段
    const state = this._setPartyComponent({ ...this._partyState(), members: source.map(fitMember) });
    this._projectingParty = true;
    try {
      return stateService.mutateGlobal('party', (party) => {
        const current = Array.isArray(party) ? (party as any[]) : [];
        this._copyIntoLegacy(current, state.members as any, ['playerRole', 'x', 'y', 'frame', 'imageOffset']);
        return current as PartyMember[];
      });
    } finally {
      this._projectingParty = false;
    }
  }

  setPartyStruct(struct: PartyMember[]) {
    const result = this._copyStructIntoGlobal<PartyMember[]>('party', struct, () => this.syncPartyMembers());
    this._importPartyFromGlobal();
    return result;
  }

  // ---- 背包 / 钱 / 背包光标:真相源是 Inventory 组件(M2 D1)------------------------
  // Global.inventory / Global.cash / Global.curInvMenuItem 与切片是投影:_projectInventory 单向写入。
  // 旧路径(读档灌结构体、syncAll、他处直接改 Global)经 _importInventoryFromGlobal 回到组件。

  /** 组件当前值;还没有就从 Global 导入一次 */
  _inventoryState(): InventoryState {
    const w = this.writer;
    return w.get(w.world(), InventoryComponent) ?? this._importInventoryFromGlobal();
  }

  /** 旧真相源 → 组件(不投影回去:Global 与切片此刻就是源头) */
  _importInventoryFromGlobal(): InventoryState {
    const inventory = stateService.getGlobal('inventory');
    const list = Array.isArray(inventory) ? inventory : [];
    const capacity = (typeof Const !== 'undefined' && Const && typeof Const.MAX_INVENTORY === 'number') ? Const.MAX_INVENTORY : list.length;
    const slots: InventorySlot[] = [];
    for (let i = 0; i < capacity; i++) slots.push(fitSlot(list[i]));
    // 钱:旧代码以切片为准(getCash 读切片),切片还没值时退回 Global
    const globalCash = stateService.getGlobal('cash');
    const cash = toCash(getCashValue(typeof globalCash === 'number' ? globalCash : 0));
    const menuIndex = toTrunc(getInventoryMenuIndexValue(this._getNumberGlobal('curInvMenuItem', 0)));
    const state: InventoryState = { slots, cash, menuIndex };
    this.writer.set(this.writer.world(), InventoryComponent, state);
    return state;
  }

  /**
   * 写组件,再把这次写到的部分投影到 Global 与切片。touched 指明调用方写的是哪部分:
   * 旧写口每次调用都会写 Global、发 globalChanged、更新切片(值没变也一样),投影照旧,事件流不变。
   */
  _writeInventory(next: InventoryState, prev: InventoryState, touched: 'slots' | 'cash' | 'menuIndex') {
    const w = this.writer;
    const state = w.set(w.world(), InventoryComponent, next);
    this._projectingInventory = true;
    try {
      if (touched === 'slots') {
        const result = stateService.mutateGlobal('inventory', (inventory) => {
          const current = Array.isArray(inventory) ? (inventory as InventoryItem[]) : [];
          for (let i = 0; i < state.slots.length && i < current.length; i++) {
            const slot: any = current[i];
            if (!slot) continue;
            const s = state.slots[i];
            if (slot.item !== s.item) slot.item = s.item;
            if (slot.amount !== s.amount) slot.amount = s.amount;
            if (slot.amountInUse !== s.amountInUse) slot.amountInUse = s.amountInUse;
          }
          return current;
        });
        updateInventoryValue(Array.isArray(result) ? result : [], { source: 'worldService', capacity: this.getInventoryCapacity() });
      }
      if (touched === 'cash') {
        stateService.setGlobal('cash', state.cash);
        updateCashValue(state.cash, { source: 'worldService' });
      }
      if (touched === 'menuIndex') {
        this._setNumberGlobal('curInvMenuItem', state.menuIndex, 0);
        updateInventoryMenuIndex(state.menuIndex, { source: 'worldService' });
      }
    } finally {
      this._projectingInventory = false;
    }
    return state;
  }

  /** 存档编码:组件槽位逐字段写进 SaveData.inventory(SDLPAL INVENTORY 结构) */
  encodeInventoryInto(target: any[]) {
    if (!Array.isArray(target)) return;
    const slots = this._inventoryState().slots;
    for (let i = 0; i < target.length; i++) {
      const t = target[i];
      if (!t) continue;
      const s = slots[i] || { item: 0, amount: 0, amountInUse: 0 };
      t.item = s.item;
      t.amount = s.amount;
      t.amountInUse = s.amountInUse;
    }
  }

  /**
   * 背包槽位的只读视图(M2 D5c):直接是组件里冻结的槽位,不拷贝;读完即用,要改走 mutateInventory。
   * 旧实现返回 Global.inventory 的活结构体并顺手回写切片 —— 组件是真相源(D1)之后这两样都是多余的
   */
  getInventory(): InventoryItem[] {
    this._ensureInitialised();
    return this._inventoryView().slots as unknown as InventoryItem[];
  }

  /** 组件只读原件(不拷贝);还没有就从 Global 导入一次 */
  _inventoryView(): Readonly<InventoryState> {
    const w = this.writer;
    return w.peek(w.world(), InventoryComponent) ?? this._importInventoryFromGlobal();
  }

  /** 回调拿到草稿槽位(写入按结构体宽度截断),可原地改或返回新数组;提交到组件后投影 */
  mutateInventory(mutator: (inventory: InventoryItem[]) => InventoryItem[] | undefined) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const prev = this._inventoryState();
    const draft: any[] = prev.slots.map((s) => new SlotDraft(s));
    const next = mutator(draft as unknown as InventoryItem[]);
    const slots = slotsFromDraft(typeof next === 'undefined' ? draft : next, prev.slots.length);
    // 回调里可能嵌套写同一组件的别的字段(如 0x0046 在 mutateParty 里调 mutateTrail):回调后重读,只换这次写的字段
    const latest = this._inventoryState();
    this._writeInventory({ ...latest, slots }, latest, 'slots');
    return stateService.getGlobal('inventory') as InventoryItem[];
  }

  /** 读档 / 新游戏整表灌入:先照旧拷进结构体,再导入组件 */
  setInventoryStruct(struct: InventoryItem[]) {
    const resolved = this._copyStructIntoGlobal<InventoryItem[]>('inventory', struct);
    updateInventoryValue(Array.isArray(resolved) ? resolved : [], { source: 'worldService', capacity: this.getInventoryCapacity() });
    this._importInventoryFromGlobal();
    return resolved;
  }

  /** PAL_CompressInventory:去掉物品为 0 或数量为 0 的槽,后面的往前挪 */
  compressInventory() {
    this._ensureInitialised();
    const prev = this._inventoryState();
    const kept = prev.slots.filter((slot) => slot.item !== 0 && slot.amount > 0);
    const slots = slotsFromDraft(kept, prev.slots.length);
    if (sameSlots(slots, prev.slots)) {
      return stateService.getGlobal('inventory') as InventoryItem[];   // 已经紧凑:不写(同旧实现)
    }
    this._writeInventory({ ...prev, slots }, prev, 'slots');
    return stateService.getGlobal('inventory') as InventoryItem[];
  }

  getInventoryCapacity() {
    const globalInventory = stateService.getGlobal('inventory');
    const fallback = Array.isArray(globalInventory) ? globalInventory.length : 0;
    const capacity = (typeof Const !== 'undefined' && Const && typeof Const.MAX_INVENTORY === 'number')
      ? Const.MAX_INVENTORY
      : fallback;
    return capacity;          // 容量切片由背包的投影维护(写口带 capacity),读口不写
  }

  useInventoryItem(itemId: number, targetIndex: number | null) {
    const world = this;
    return co(function* (): Generator<any, boolean, any> {
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return false;
      }

      let scriptSvc = null;
      try {
        scriptSvc = yield loadServiceModule('script', './script-service.ts');
      } catch (err) {
        return false;
      }
      if (!scriptSvc || typeof scriptSvc.runTriggerScript !== 'function') {
        return false;
      }

      let objectEntry = null;
      try {
        const scriptObjects = yield loadServiceModule('scriptObjects', './script-object-adapter.ts');
        if (scriptObjects && typeof scriptObjects.getObjectEntry === 'function') {
          objectEntry = scriptObjects.getObjectEntry(itemId);
        }
      } catch (err) {
        objectEntry = null;
      }
      if (!objectEntry) {
        const gameData = stateService.getGameData<Record<number, Record<string, unknown>>>('object');
        if (gameData && typeof gameData === 'object') {
          const maybeEntry = (gameData as Record<number, Record<string, unknown>>)[itemId];
          objectEntry = maybeEntry && typeof maybeEntry === 'object' ? maybeEntry : null;
        }
      }
      if (!objectEntry || !objectEntry.item) {
        return false;
      }

      const scriptEntry = objectEntry.item.scriptOnUse;
      if (!Number.isFinite(scriptEntry) || scriptEntry <= 0) {
        return false;
      }

      const itemFlags = getItemFlags();
      const flags = Number(objectEntry.item.flags) || 0;
      const applyAll = !!(flags & itemFlags.ApplyToAll);
      const consuming = !!(flags & itemFlags.Consuming);

      let targetRole = 0xFFFF;
      if (!applyAll) {
        const party = world.getParty();
        let targetMember: PartyMember | null = null;
        const targetIdx = typeof targetIndex === 'number' && Number.isFinite(targetIndex) ? targetIndex : null;
        if (targetIdx != null && targetIdx >= 0 && targetIdx < party.length) {
          targetMember = party[targetIdx] || null;
        }
        if (!targetMember) {
          targetMember = party.find((member) => member && typeof member.playerRole === 'number') || null;
        }
        if (!targetMember || typeof targetMember.playerRole !== 'number') {
          return false;
        }
        targetRole = targetMember.playerRole;
      }

      try {
        const nextScript = yield scriptSvc.runTriggerScript(scriptEntry, targetRole);
        world.mutateObjectEntry(itemId, (entry) => {
          if (entry && entry.item) {
            entry.item.scriptOnUse = nextScript;
          }
          return entry;
        });
        if (consuming && typeof scriptSvc.addItemToInventory === 'function') {
          scriptSvc.addItemToInventory(itemId, -1);
        }
        return !!scriptSvc.scriptSuccess;
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[world-service] useInventoryItem failed', err);
        }
        return false;
      }
    });
  }

  /** 状态矩阵(M2 D5c):组件视图的副本(旧实现也是每次给切片的副本,调用方可以改) */
  getPlayerStatusMatrix() {
    this._ensureInitialised();
    return statusFromPlain(this._statusComponentView().status);
  }

  _statusComponentView(): Readonly<StatusMatricesState> {
    const w = this.writer;
    return w.peek(w.world(), StatusMatricesComponent) ?? this._importStatusMatrices();
  }

  /**
   * 读者用的状态 / 中毒矩阵视图(旧形态:状态行是数组或 { uint8Array },中毒是 [毒][队员] 的 { poisonID, poisonScript }),
   * 按组件原件缓存 —— 组件没变就是同一个对象。中毒条目是组件里冻结的原件,只读
   */
  _statusMatrixViews(): { player: any[]; poison: any[] } {
    const src = this._statusComponentView();
    const cached = this._statusViewCache;
    if (cached && cached.src === src) return cached.views;
    const views = { player: statusFromPlain(src.status), poison: src.poison.map((row) => (row ? row : [])) };
    this._statusViewCache = { src, views };
    return views;
  }

  mutatePlayerStatus(mutator: (matrix: number[][]) => number[][] | undefined) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const prev = this._statusState();
    const draft = statusFromPlain(prev.status);
    const next = mutator(draft as number[][]);
    // 回调里可能嵌套写同一组件的别的字段(如 0x0046 在 mutateParty 里调 mutateTrail):回调后重读,只换这次写的字段
    return this._writeStatusMatrices({ ...this._statusState(), status: statusToPlain(typeof next === 'undefined' ? draft : next) }, 'status');
  }

  mutatePlayerStatusEntry(roleId: number, mutator: (row: number[]) => number[] | void) {
    if (typeof mutator !== 'function') {
      return null;
    }
    let result = null;
    this.mutatePlayerStatus((matrix) => {
      const row = matrix[roleId];
      if (!row) {
        return matrix;
      }
      const next = mutator(row);
      if (typeof next !== 'undefined' && next !== row) {
        matrix[roleId] = next;
        result = next;
      } else {
        result = row;
      }
      return matrix;
    });
    return result;
  }

  getPlayerStatus(roleId: number) {
    const matrix = this.getPlayerStatusMatrix();
    return matrix[roleId] || null;
  }

  setPlayerStatusStruct(struct: any) {
    return this._copyStructIntoGlobal('playerStatus', struct);
  }

  resetPlayerStatusMatrix() {
    return this.mutatePlayerStatus((status) => {
      for (let i = 0; i < status.length; i++) {
        const row = status[i] as any;
        if (!row) {
          continue;
        }
        if (row.uint8Array instanceof Uint8Array) {
          row.uint8Array.fill(0);
          continue;
        }
        if (Array.isArray(row)) {
          for (let j = 0; j < row.length; j++) {
            row[j] = 0;
          }
        } else if (typeof row === 'object') {
          Object.keys(row).forEach((key) => {
            row[key] = 0;
          });
        }
      }
      return status;
    });
  }

  getPoisonStatusMatrix() {
    this._ensureInitialised();
    return this._statusMatrixViews().poison;
  }

  mutatePoisonStatus(mutator: (status: PoisonRow[]) => PoisonRow[] | undefined) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const prev = this._statusState();
    const draft = poisonDraft(prev.poison);
    const next = mutator(draft as PoisonRow[]);
    // 回调里可能嵌套写同一组件的别的字段(如 0x0046 在 mutateParty 里调 mutateTrail):回调后重读,只换这次写的字段
    return this._writeStatusMatrices({ ...this._statusState(), poison: poisonToPlain(typeof next === 'undefined' ? draft : next) }, 'poison');
  }

  resetPoisonStatusMatrix() {
    this._ensureInitialised();
    this.mutatePoisonStatus((poisonStatus) => {
      if (!poisonStatus) {
        return poisonStatus;
      }
      if ((poisonStatus as any).uint8Array instanceof Uint8Array) {
        (poisonStatus as any).uint8Array.fill(0);
        return poisonStatus;
      }
      for (let i = 0; i < poisonStatus.length; i++) {
        const row = poisonStatus[i];
        if (!row) {
          continue;
        }
        if ((row as any).uint8Array instanceof Uint8Array) {
          (row as any).uint8Array.fill(0);
          continue;
        }
        if (Array.isArray(row)) {
          for (let j = 0; j < row.length; j++) {
            const entry = row[j] as { uint8Array?: Uint8Array; poisonID?: number; poisonScript?: number } | null | undefined;
            if (!entry) {
              continue;
            }
            if (entry.uint8Array instanceof Uint8Array) {
              entry.uint8Array.fill(0);
              continue;
            }
            entry.poisonID = 0;
            entry.poisonScript = 0;
          }
        }
      }
      return poisonStatus;
    });
  }

  setPoisonStatusStruct(struct: any) {
    return this._copyStructIntoGlobal('poisonStatus', struct);
  }

  _getPlayerMagicSlots(roleId: number) {
    const roles = this.getPlayerRoles() as any;
    if (!roles || !Array.isArray(roles.magic)) {
      return [];
    }
    const result: number[] = [];
    for (let slot = 0; slot < roles.magic.length; slot++) {
      const row = roles.magic[slot];
      result.push(row ? row[roleId] || 0 : 0);
    }
    return result;
  }

  setPlayerMagicSlot(roleId: number, slotIndex: number, value: number) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && Array.isArray(roles.magic) && roles.magic[slotIndex]) {
        roles.magic[slotIndex][roleId] = value;
      }
      return roles;
    });
  }

  findPlayerMagicSlot(roleId: number, magicId: number) {
    const slots = this._getPlayerMagicSlots(roleId);
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === magicId) {
        return i;
      }
    }
    return -1;
  }

  clearPlayerMagicSlot(roleId: number, slotIndex: number) {
    return this.setPlayerMagicSlot(roleId, slotIndex, 0);
  }

  getTrail() {
    this._ensureInitialised();
    const trail = getTrailValue([]);
    return Array.isArray(trail) ? trail : [];
  }

  getSceneId() {
    this._ensureInitialised();
    return stateService.getGlobal('numScene');
  }

  setSceneId(sceneId: number) {
    this._ensureInitialised();
    stateService.setGlobal('numScene', sceneId);
    this.syncScene();
    this.syncMapMeta();
    this.syncMapTiles();
    this.syncEventObjects();
    this.ensureCollisionState();
    return sceneId;
  }

  getSceneData() {
    const component = this.getSceneComponent();
    return component ? component.sceneRef : null;
  }

  getSceneEntry(sceneId: number) {
    this._ensureInitialised();
    if (typeof sceneId !== 'number' || sceneId <= 0) {
      sceneId = getSceneIdValue(0);
    }
    const currentId = getSceneIdValue(0);
    if (sceneId === currentId) {
      const component = this.getSceneComponent();
      return component ? component.sceneRef : null;
    }
    const store = getGameDataStore();
    const scenes = store && Array.isArray(store.scene) ? store.scene : [];
    const index = sceneId - 1;
    if (index < 0 || index >= scenes.length) {
      return null;
    }
    return scenes[index];
  }

  mutateSceneEntry(sceneId: number, mutator: (entry: any) => any) {
    this._ensureInitialised();
    if (typeof sceneId !== 'number' || typeof mutator !== 'function') {
      return null;
    }
    let result = null;
    let snapshot: any[] | null = null;
    stateService.mutateGameData('scene', (scenes) => {
      if (!Array.isArray(scenes)) {
        return scenes;
      }
      const index = sceneId - 1;
      const entry = scenes[index];
      if (!entry) {
        return scenes;
      }
      const next = mutator(entry);
      if (typeof next !== 'undefined' && next !== entry) {
        scenes[index] = next;
        result = next;
      } else {
        result = entry;
      }
      snapshot = scenes;
      return scenes;
    });
    if (snapshot) {
      updateSceneTableValue(snapshot);
    }
    this.syncScene();
    return result;
  }

  setSceneTable(scenes: any[]) {
    const resolved = this._replaceGameDataTable('scene', scenes || []);
    updateSceneTableValue(resolved || []);
    return resolved;
  }

  getNextSceneData() {
    const component = this.getSceneComponent();
    return component ? component.nextSceneRef : null;
  }

  getMapData() {
    const component = this.getSceneComponent();
    return component ? component.mapRef : null;
  }

  runSystems(phases: string | string[], context: Record<string, unknown> = {}) {
    if (!this.systemManager || typeof this.systemManager.runPipeline !== 'function') {
      return;
    }
    const runtime = Object.assign(
      {},
      context,
      {
        worldService: this,
        world: this,
        registry: this.registry
      }
    );
    this.systemManager.runPipeline(phases, runtime);
  }

  enqueueMoveRequest(request: Record<string, unknown>) {
    this._ensureInitialised();
    const eventIndex = typeof request === 'object' && request != null
      ? (typeof request.eventIndex === 'number'
        ? request.eventIndex
        : (typeof request.eventObjectId === 'number' ? request.eventObjectId - 1 : null))
      : null;
    if (eventIndex != null) {
      this.syncEventObjects();
    }
    const queue = this._ensureMoveQueue();
    queue.requests.push(Object.assign({}, request));
    return queue.requests.length;
  }

  drainMoveRequests() {
    const queue = this._ensureMoveQueue();
    const requests = queue.requests.slice();
    queue.requests.length = 0;
    return requests;
  }

  setMoveIntent(eventIndex: number, intent: Record<string, unknown>) {
    const entityId = this.entityMaps.eventObject.get(eventIndex);
    if (!entityId) {
      return null;
    }
    const component = this.registry.getComponent(entityId, WorldComponents.MoveIntent);
    if (component) {
      Object.assign(component, intent);
      return component;
    }
    return this.registry.addComponent(entityId, WorldComponents.MoveIntent, createMoveIntentComponent(Object.assign({ id: eventIndex }, intent)));
  }

  clearMoveIntent(eventIndex: number) {
    const entityId = this.entityMaps.eventObject.get(eventIndex);
    if (!entityId) {
      return;
    }
    if (typeof this.registry.removeComponent === 'function') {
      this.registry.removeComponent(entityId, WorldComponents.MoveIntent);
    }
  }

  getMoveIntent(eventIndex: number) {
    const entityId = this.entityMaps.eventObject.get(eventIndex);
    if (!entityId) {
      return null;
    }
    return this.registry.getComponent(entityId, WorldComponents.MoveIntent);
  }

  setCollisionState(payload: any) {
    const component = this._ensureCollisionStateEntity();
    const directState = payload && typeof payload.isBlocked === 'function' ? payload : null;
    const resolvedState = directState || (payload && payload.state) || null;
    const resolvedMapId = typeof payload.mapId === 'number'
      ? payload.mapId
      : (resolvedState && typeof resolvedState.mapId === 'number' ? resolvedState.mapId : component.mapId);
    component.mapId = resolvedMapId;
    component.state = resolvedState;
    component.version = (typeof component.version === 'number' ? component.version : 0) + 1;
    this._collisionState = component.state;
    updateCollisionStateValue(this._collisionState, { source: 'worldService:setCollisionState' });
  }

  getCollisionState() {
    return this._collisionState;
  }

  ensureCollisionState(context = {}) {
    this._ensureInitialised();
    const mapMeta = this.getMapMetaComponent();
    const mapTile = this.getMapTileComponent();
    const expectedMapId = mapMeta && typeof mapMeta.mapId === 'number'
      ? mapMeta.mapId
      : (mapTile && typeof mapTile.mapId === 'number' ? mapTile.mapId : null);
    const state = this._collisionState;
    const currentMapId = state && typeof state.mapId === 'number' ? state.mapId : null;
    if (!state || (expectedMapId != null && currentMapId !== expectedMapId)) {
      const runtimeContext = Object.assign(
        {},
        context,
        {
          sceneEventObjects: getEventObjectsValue([])
        }
      );
      this.runSystems('collision', runtimeContext);
    }
    updateCollisionStateValue(this._collisionState, { emitEvent: false, source: 'worldService:ensureCollisionState' });
    return this._collisionState;
  }

  isPositionBlocked(position: { x: number; y: number; layer?: number }, options: Record<string, unknown> = {}, context?: Record<string, unknown>) {
    const state = this.ensureCollisionState(context || {});
    if (!state || typeof state.isBlocked !== 'function') {
      return null;
    }
    return state.isBlocked(position, options);
  }

  mutatePartyMember(index: number, mutator: (member: PartyMember) => PartyMember | null | void) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const party = stateService.getGlobal('party') as PartyMember[] | null || [];
    const member = party[index];
    if (!member) {
      return null;
    }
    // 旧写口:回调原地改活结构体、返回值只回传不写入、不发 globalChanged、之后同步队员
    const prev = this._partyState();
    const draft: any = new MemberDraft(prev.members[index] || fitMember(member)!);
    const returned = mutator(draft);
    // 回调里可能嵌套写同一组件的别的字段(如 0x0046 在 mutateParty 里调 mutateTrail):回调后重读,只换这次写的字段
    const current = this._partyState();
    const members = current.members.slice();
    members[index] = fitMember(draft);
    const state = this._setPartyComponent({ ...current, members });
    const row: any = state.members[index];
    if (row) for (const k of ['playerRole', 'x', 'y', 'frame', 'imageOffset']) if ((member as any)[k] !== row[k]) (member as any)[k] = row[k];
    this.syncPartyMembers();
    return returned && returned !== draft ? returned : member;
  }

  mutateEventObject(id: number, mutator: (entry: Record<string, unknown>) => Record<string, unknown> | void) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const gameData = getGameDataStore();
    if (!gameData || !Array.isArray(gameData.eventObject)) {
      return null;
    }
    const target = gameData.eventObject[id];
    if (!target) {
      return null;
    }
    const result = mutator(target) ?? target;
    if (result !== target) {
      gameData.eventObject[id] = result;
    }
    const updatedEntry = result;
    // 兜底:getter 与字节一致(WORD / SHORT 回绕),之后的实体同步、通知、组件捕获看到的都是回绕后的值
    syncEventObjectCachesFromBytes(updatedEntry);
    this._syncEventObjectEntity(id, updatedEntry, stateService.getGlobal('numScene') as number);
    this._collisionState = null;
    this._eventObjectsVersion = (typeof this._eventObjectsVersion === 'number' ? this._eventObjectsVersion : 0) + 1;
    this.fire('eventObjectMutated', { id, sceneId: stateService.getGlobal('numScene'), state: updatedEntry });
    updateEventObjectsValue(this.getEventObjectsInCurrentScene(), { source: 'worldService:mutateEventObject' });
    updateCollisionStateValue(null, { source: 'worldService:mutateEventObject' });
    this.captureEventObjects(id);
    return updatedEntry;
  }

  mutateEventObjectById(eventId: number, mutator: (entry: Record<string, unknown>) => Record<string, unknown> | void) {
    if (!Number.isFinite(eventId)) {
      return null;
    }
    const index = Math.trunc(eventId) - 1;
    if (index < 0) {
      return null;
    }
    return this.mutateEventObject(index, mutator);
  }

  mutateEventObjects(mutator: (objects: Record<string, unknown>[]) => Record<string, unknown>[] | null | undefined) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    let snapshot = null;
    stateService.mutateGameData('eventObject', (eventObjects) => {
      if (!eventObjects) {
        return eventObjects;
      }
      const result = mutator(eventObjects as Record<string, unknown>[]);
      snapshot = typeof result !== 'undefined' ? result : eventObjects;
      return snapshot;
    });
    if (snapshot) {
      this.syncEventObjects();
    }
    return snapshot;
  }

  setEventObjectTable(eventObjects: any[]) {
    const resolved = this._replaceGameDataTable('eventObject', eventObjects || []);
    this.syncEventObjects();
    return resolved;
  }

  getSceneEventObjectRange(sceneId?: number) {
    this._ensureInitialised();
    const store = getGameDataStore();
    const eventObjects = store && Array.isArray(store.eventObject) ? store.eventObject : [];
    const scenes = store && Array.isArray(store.scene) ? store.scene : [];

    let start = 0;
    let end = eventObjects.length;
    if (typeof sceneId === 'number' && sceneId > 0) {
      const sceneIndex = Math.trunc(sceneId) - 1;
      const current = scenes[sceneIndex];
      const next = scenes[sceneIndex + 1];
      if (current && typeof current.eventObjectIndex === 'number') {
        start = current.eventObjectIndex;
      }
      if (next && typeof next.eventObjectIndex === 'number') {
        end = next.eventObjectIndex;
      }
    } else {
      const sceneRef = this.getSceneData();
      const nextSceneRef = this.getNextSceneData();
      start = sceneRef && typeof sceneRef.eventObjectIndex === 'number'
        ? sceneRef.eventObjectIndex
        : 0;
      end = nextSceneRef && typeof nextSceneRef.eventObjectIndex === 'number'
        ? nextSceneRef.eventObjectIndex
        : eventObjects.length;
    }
    return {
      start,
      end,
      count: Math.max(0, end - start)
    };
  }

  getEventObjectsInCurrentScene() {
    this._ensureInitialised();
    if (
      Array.isArray(this._eventObjectsCache) &&
      this._eventObjectsCacheVersion === this._eventObjectsVersion
    ) {
      return this._eventObjectsCache;
    }
    const range = this.getSceneEventObjectRange();
    const store = getGameDataStore();
    const eventObjects = store && Array.isArray(store.eventObject) ? store.eventObject : [];
    const results = [];
    for (let idx = range.start; idx < range.end && idx < eventObjects.length; idx++) {
      const state = eventObjects[idx];
      if (!state) {
        continue;
      }
      results.push({
        index: idx,
        id: idx + 1,
        state
      });
    }
    this._eventObjectsCache = results;
    this._eventObjectsCacheVersion = this._eventObjectsVersion;
    return this._eventObjectsCache;
  }

  getAllEventObjects() {
    this._ensureInitialised();
    const current = getEventObjectsValue([]);
    if (Array.isArray(current) && current.length) {
      return current;
    }
    const store = getGameDataStore();
    const eventObjects = store && Array.isArray(store.eventObject) ? store.eventObject : [];
    return eventObjects.map((state, idx) => ({
      index: idx,
      id: idx + 1,
      state
    })).filter((entry) => entry.state);
  }

  mutateObjectEntry(id: number, mutator: (entry: any) => any) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    let updatedEntry = null;
    stateService.mutateGameData('object', (objects: any[] | null | undefined) => {
      if (!Array.isArray(objects)) {
        return objects || null;
      }
      const entry = objects[id];
      if (!entry) {
        return objects;
      }
      const result = mutator(entry);
      if (typeof result !== 'undefined' && result !== entry) {
        objects[id] = result;
        updatedEntry = result;
      } else {
        updatedEntry = entry;
      }
      return objects;
    });
    if (updatedEntry) {
      const store = getGameDataStore();
      updateObjectTableValue(store && Array.isArray(store.object) ? store.object : []);
    }
    return updatedEntry;
  }

  setObjectScriptValue(objectId: number, dataIndex: number, value: unknown) {
    if (typeof objectId !== 'number' || objectId < 0) {
      return null;
    }
    const index = Number.isFinite(dataIndex) ? Math.trunc(dataIndex) : null;
    if (index === null || index < 0) {
      return null;
    }
    return this.mutateObjectEntry(objectId, (entry) => {
      if (!entry || !entry.data) {
        return entry;
      }
      // 就地写(SDLPAL 0x90:gpGlobals->g.rgObject[o].rgwData[i] = w)。不能换条目:读档后物件表的整表字节
      // 与各条目共用存档缓冲区,换成带独立缓冲区的新条目后,存档仍按整表旧字节拷贝,这一写就丢了。
      const data = entry.data as any;
      if (typeof data.length === 'number') {
        if (index >= data.length) return entry;
        data[index] = ArrayBuffer.isView(data) ? Number(value) & 0xffff : value;
      } else if (typeof data === 'object') {
        data[index] = value;
      } else {
        return entry;
      }
      // ObjectUnion 的 player / item / magic / enemy / poison 视图按首次访问缓存、字段读缓存值:作废,下次从字节重建
      for (const key of ['__player__', '__item__', '__magic__', '__enemy__', '__poison__']) {
        if (Object.prototype.hasOwnProperty.call(entry, key)) delete (entry as any)[key];
      }
      return entry;
    });
  }

  mutateObjects(mutator: (objects: any[]) => any[] | null) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    let snapshot = null;
    stateService.mutateGameData('object', (objects: any[] | null | undefined) => {
      if (!objects) {
        return objects || null;
      }
      const result = mutator(objects);
      snapshot = typeof result !== 'undefined' ? result : objects;
      return snapshot;
    });
    if (snapshot) {
      updateObjectTableValue(snapshot);
    }
    return snapshot;
  }

  setObjectTable(objects: any[]) {
    const resolved = this._replaceGameDataTable('object', objects || []);
    updateObjectTableValue(resolved || []);
    return resolved;
  }

  mutateMagicTable(mutator: (magicData: any) => any) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    let snapshot = null;
    stateService.mutateGameData('magic', (magicData) => {
      if (!magicData) {
        return magicData;
      }
      const result = mutator(magicData);
      snapshot = typeof result !== 'undefined' ? result : magicData;
      return snapshot;
    });
    if (snapshot) {
      updateMagicTableValue(snapshot);
    }
    return snapshot;
  }

  setMagicTable(magicTable: any[]) {
    const resolved = this._replaceGameDataTable('magic', magicTable || []);
    updateMagicTableValue(resolved || []);
    return resolved;
  }

  getPlayerRoles(): PlayerRoles | null {
    this._ensureInitialised();
    const store = getGameDataStore();
    const roles = store && (store.playerRoles as PlayerRoles | null);
    updatePlayerRolesValue(roles);
    return roles;
  }

  getPlayerBattleSpriteNum(roleId: number) {
    const roles = this.getPlayerRoles();
    if (roles && roles.spriteNumInBattle) {
      return roles.spriteNumInBattle[roleId] || 0;
    }
    return 0;
  }

  _getPlayerRoleArray(field: string) {
    const roles = this.getPlayerRoles();
    if (!roles) {
      return null;
    }
    const value = (roles as Record<string, unknown>)[field];
    if (Array.isArray(value)) {
      return value as number[];
    }
    if (ArrayBuffer.isView(value)) {
      return value as unknown as ArrayLike<number>;
    }
    return null;
  }

  _getPlayerRoleArrayValue(field: string, roleId: number, fallback = 0) {
    const arr = this._getPlayerRoleArray(field);
    if (!arr || roleId < 0 || roleId >= (arr as ArrayLike<number>).length) {
      return fallback;
    }
    const value = (arr as ArrayLike<number>)[roleId];
    return typeof value === 'undefined' ? fallback : value;
  }

  _setPlayerRoleArrayValue(field: string, roleId: number, value: number) {
    return this.mutatePlayerRoles((roles) => {
      if (roles) {
        const arr = (roles as Record<string, any>)[field];      // 回调参数(草稿),不再经 getPlayerRoles 读活结构体
        if (arr && typeof arr.length === 'number' && roleId >= 0 && roleId < (arr as ArrayLike<number>).length) {
          (arr as ArrayLike<number> as number[])[roleId] = value;
        }
      }
      return roles;
    });
  }

  setLevelUpMagicTable(levelUpMagic: any[]) {
    const resolved = this._replaceGameDataTable('levelUpMagic', levelUpMagic || []);
    updateLevelUpMagicTableValue(resolved || []);
    return resolved;
  }

  setStoreTable(stores: any[]) {
    const resolved = this._replaceGameDataTable('store', stores || []);
    updateStoreTableValue(resolved || []);
    return resolved;
  }

  setEnemyTable(enemies: any[]) {
    const resolved = this._replaceGameDataTable('enemy', enemies || []);
    updateEnemyTableValue(resolved || []);
    return resolved;
  }

  copyEnemyTemplate(enemyId: number) {
    this._ensureInitialised();
    const store = getGameDataStore();
    const enemyTable = store && Array.isArray(store.enemy) ? store.enemy : [];
    const entry = typeof enemyId === 'number' ? enemyTable[enemyId] : null;
    if (!entry) {
      return null;
    }
    if (typeof entry.copy === 'function') {
      return entry.copy();
    }
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch (err) {
      return { ...entry };
    }
  }

  setEnemyTeamTable(enemyTeams: any[]) {
    const resolved = this._replaceGameDataTable('enemyTeam', enemyTeams || []);
    updateEnemyTeamValue(resolved || [], { source: 'worldService:setEnemyTeamTable' });
    return resolved;
  }

  getEnemyFormationPosition(index: number, maxEnemyIndex: number) {
    this._ensureInitialised();
    const store = getGameDataStore();
    const enemyPos = store && (store as any).enemyPos && (store as any).enemyPos.pos ? (store as any).enemyPos.pos : null;
    if (!enemyPos || !enemyPos[index]) {
      return null;
    }
    return enemyPos[index][maxEnemyIndex] || null;
  }

  setEnemyPositionTable(enemyPositions: any) {
    const resolved = this._replaceGameDataTable('enemyPos', enemyPositions || null);
    updateEnemyPositionValue(resolved || null, { source: 'worldService:setEnemyPositionTable' });
    return resolved;
  }

  setBattleFieldTable(battleFields: any) {
    const resolved = this._replaceGameDataTable('battleField', battleFields || []);
    updateBattleFieldValue(resolved || [], { source: 'worldService:setBattleFieldTable' });
    return resolved;
  }

  setBattleEffectIndexTable(battleEffectIndex: any) {
    const resolved = this._replaceGameDataTable('battleEffectIndex', battleEffectIndex || []);
    updateBattleEffectTableValue(resolved || []);
    return resolved;
  }

  setPlayerRoles(playerRoles: PlayerRoles | null) {
    const resolved = this._replaceGameDataTable('playerRoles', playerRoles || null);
    updatePlayerRolesValue(resolved || null);
    this._captureRoles();
    return resolved;
  }

  /**
   * 角色数值写口(M2 D5d:组件为真)。回调拿到的是从 PlayerRoles 组件现做的草稿结构体(同一个结构体类,字段是
   * 字节上的 Uint16Array,宽度截断与活结构体相同),回调结束后把这次改到的字合进组件(回调里嵌套的写入先落了组件,
   * 只覆盖本次改的字),再把字节原地写回 GameData.playerRoles —— 活结构体降为投影,对象与各字段数组的身份不变
   * (战斗 Stats 组件持有 HP / MP 数组的别名)。开局前没有活结构体时照旧
   */
  mutatePlayerRoles(mutator: (roles: PlayerRoles | null) => PlayerRoles | null, options: UpdateOptions = {}) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const store = getGameDataStore();
    const live = store && (store.playerRoles as any);
    const Struct = playerRolesStruct(live);
    if (!Struct) {
      return this._mutatePlayerRolesLegacy(mutator);
    }
    const w = this.writer;
    this._captureRoles();                                   // 兜底:别处若绕开写口改了活结构体,先收进来
    const base = w.peek(w.world(), PlayerRolesComponent)!.words;
    const draft = new Struct(wordsToBytes(base, live.uint8Array.length));
    const result = mutator(draft as PlayerRoles);
    const out: any = result && (result as any).uint8Array instanceof Uint8Array ? result : draft;
    const changed = wordsOf(out) || base;
    const latest = w.peek(w.world(), PlayerRolesComponent)!.words;
    const merged = latest.map((word, k) => (changed[k] !== base[k] ? changed[k] : word));
    if (!sameWords(latest as number[], merged)) w.set(w.world(), PlayerRolesComponent, { words: merged });
    this._projectRoles(merged);
    return live as PlayerRoles;
  }

  /** 读者用的角色数值视图:PlayerRoles 组件按结构体解码再拷成切片同款的纯数据,按组件原件缓存 */
  _rolesView(): unknown {
    const w = this.writer;
    const src = w.peek(w.world(), PlayerRolesComponent);
    if (!src) return null;
    const cached = this._rolesViewCache;
    if (cached && cached.src === src) return cached.view;
    const store = getGameDataStore();
    const live: any = store && store.playerRoles;
    const Struct = playerRolesStruct(live);
    if (!Struct) return null;
    const view = cloneRolesValue(new Struct(wordsToBytes(src.words, live.uint8Array.length)));
    this._rolesViewCache = { src, view };
    return view;
  }

  /** PlayerRoles 组件 → 活结构体(字节原地写回;gameDataChanged → syncPlayerRoles 刷切片,同旧写口的事件) */
  _projectRoles(words: ReadonlyArray<number>) {
    stateService.mutateGameData('playerRoles', (roles: any) => {
      if (roles && roles.uint8Array instanceof Uint8Array) roles.uint8Array.set(wordsToBytes(words, roles.uint8Array.length));
      return roles;
    });
    const store = getGameDataStore();
    updatePlayerRolesValue((store && (store.playerRoles as PlayerRoles)) || null);
  }

  _mutatePlayerRolesLegacy(mutator: (roles: PlayerRoles | null) => PlayerRoles | null) {
    let snapshot: PlayerRoles | null | undefined = null;
    stateService.mutateGameData('playerRoles', (playerRoles) => {
      const result = mutator((playerRoles as PlayerRoles | null) || null);
      snapshot = typeof result !== 'undefined' ? result : (playerRoles as PlayerRoles | null | undefined);
      return snapshot as PlayerRoles | null | undefined;
    });
    if (snapshot) updatePlayerRolesValue(snapshot as PlayerRoles);
    this._captureRoles();
    return snapshot || null;
  }

  setPlayerHP(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.HP) {
        const current = roles.HP[roleId] || 0;
        roles.HP[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    }, { source: 'worldService:setPlayerHP' });
  }

  adjustPlayerHP(roleId: number, delta: number) {
    const adjustment = Number.isFinite(delta) ? delta : 0;
    const current = this._getPlayerRoleArrayValue('HP', roleId, 0);
    const maxHP = this._getPlayerRoleArrayValue('maxHP', roleId, 0);
    let next = current + adjustment;
    if (next < 0) {
      next = 0;
    }
    if (maxHP > 0 && next > maxHP) {
      next = maxHP;
    }
    return this.setPlayerHP(roleId, next);
  }

  setPlayerMP(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.MP) {
        const current = roles.MP[roleId] || 0;
        roles.MP[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    }, { source: 'worldService:setPlayerMP' });
  }

  adjustPlayerMP(roleId: number, delta: number) {
    const adjustment = Number.isFinite(delta) ? delta : 0;
    const current = this._getPlayerRoleArrayValue('MP', roleId, 0);
    const maxMP = this._getPlayerRoleArrayValue('maxMP', roleId, 0);
    let next = current + adjustment;
    if (next < 0) {
      next = 0;
    }
    if (maxMP > 0 && next > maxMP) {
      next = maxMP;
    }
    return this.setPlayerMP(roleId, next);
  }

  setPlayerMaxHP(roleId: number, value: number) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.maxHP) {
        roles.maxHP[roleId] = value;
      }
      return roles;
    });
  }
  setPlayerMaxMP(roleId: number, value: number) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.maxMP) {
        roles.maxMP[roleId] = value;
      }
      return roles;
    });
  }
  setPlayerLevel(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.level) {
        const current = roles.level[roleId] || 0;
        roles.level[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    });
  }
  setPlayerAttackStrength(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.attackStrength) {
        const current = roles.attackStrength[roleId] || 0;
        roles.attackStrength[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    });
  }
  setPlayerMagicStrength(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.magicStrength) {
        const current = roles.magicStrength[roleId] || 0;
        roles.magicStrength[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    });
  }

  setPlayerDefense(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.defense) {
        const current = roles.defense[roleId] || 0;
        roles.defense[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    });
  }

  setPlayerDexterity(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.dexterity) {
        const current = roles.dexterity[roleId] || 0;
        roles.dexterity[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    });
  }

  setPlayerFleeRate(roleId: number, value: ValueOrUpdater<number>) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && roles.fleeRate) {
        const current = roles.fleeRate[roleId] || 0;
        roles.fleeRate[roleId] = typeof value === 'function' ? (value as (prev: number) => number)(current) : value;
      }
      return roles;
    });
  }

  setPlayerEquipment(slot: number, roleId: number, value: number) {
    return this.mutatePlayerRoles((roles: any) => {
      if (roles && Array.isArray(roles.equipment) && roles.equipment[slot]) {
        roles.equipment[slot][roleId] = value;
      }
      return roles;
    });
  }

  /**
   * gpGlobals->rgEquipmentEffect[MAX_PLAYER_EQUIPMENTS + 1]:每个身体部位(含 0x0030/0x0031 用的 Extra)一张
   * PLAYERROLES 大小的加成表,实际属性 = 基础值 + 各部位加成(PAL_GetPlayerAttackStrength 等)。
   * GlobalVars 是无缓冲构造的,这个字段从来没有真的建出来 —— 装备脚本(0x0017)的写入、读档后
   * PAL_UpdateEquipments 的重建全落空,穿装备不加任何属性。缺了就按 SDLPAL 建一张清零的表(不进存档,同原版)。
   */
  _ensureEquipmentEffectTable(): EquipmentEffectTable | null {
    const store = getGlobalStore() as any;
    if (!store) return null;
    const existing = store.equipmentEffect;
    if (Array.isArray(existing) && existing.length > 0 && existing.every((e: any) => isUint8Entry(e))) {
      return existing as EquipmentEffectTable;
    }
    const PlayerRolesStruct = getGlobalObject('PlayerRoles') as any;
    const constRef = getGlobalObject('Const') as any;
    if (typeof PlayerRolesStruct !== 'function' || typeof PlayerRolesStruct.size !== 'number') return null;
    const parts = (constRef && typeof constRef.MAX_PLAYER_EQUIPMENTS === 'number' ? constRef.MAX_PLAYER_EQUIPMENTS : 6) + 1;
    const table = Array.from({ length: parts }, () => new PlayerRolesStruct(new Uint8Array(PlayerRolesStruct.size)));
    stateService.setGlobal('equipmentEffect', table);
    return table as EquipmentEffectTable;
  }

  _getEquipmentEffects(): EquipmentEffectTable | null {
    // 以 Global 上的表为准;切片里的条目不是同一批对象(整表被换过)就强制换引用 —— 内容相同时 JSON 比较会跳过
    const table = this._ensureEquipmentEffectTable();
    if (table) {
      const cached = equipmentEffectSignal.value as any;
      const same = Array.isArray(cached) && cached.length === table.length && cached.every((e: any, i: number) => e === table[i]);
      if (!same) updateEquipmentEffectValue(table.slice(), { force: true });
      return table;
    }
    const cached = equipmentEffectSignal.value;
    if (Array.isArray(cached) && cached.length > 0) {
      return cached as EquipmentEffectTable;
    }
    const store = getGlobalStore();
    const effects = store && Array.isArray((store as any).equipmentEffect) ? (store as any).equipmentEffect : null;
    updateEquipmentEffectValue(Array.isArray(effects) ? effects : []);
    this._captureEquipmentEffects();
    return effects as EquipmentEffectTable | null;
  }

  getEquipmentEffects() {
    this._ensureInitialised();
    return this._getEquipmentEffects();
  }

  getEquipmentEffect(part: number) {
    this._ensureInitialised();
    if (typeof part !== 'number') {
      return null;
    }
    const effects = this._getEquipmentEffects();
    if (!effects) {
      return null;
    }
    if (part < 0 || part >= effects.length) {
      return null;
    }
    return effects[part] || null;
  }

  resetEquipmentEffects() {
    this._ensureInitialised();
    const effects = this._getEquipmentEffects();
    if (!effects) {
      return;
    }
    this._commitEquipmentEffects(this._equipmentTables().map((t) => t.map(() => 0)));
    updateEquipmentEffectValue(Array.isArray(effects) ? effects.slice() : (effects || []));
    this._captureEquipmentEffects();
  }

  // ---- 装备加成表:EquipmentEffect 组件为真(M2 D5d)------------------------------------------
  // 写口先改组件,再把各条目字节原地写回 Global.equipmentEffect(条目对象与字段数组身份不变)。

  /** 组件里各部位的字(可改的副本);先做一次兜底捕获,别处若绕开写口改了活表也收进来 */
  _equipmentTables(): number[][] {
    this._captureEquipmentEffects();
    const w = this.writer;
    return (w.peek(w.world(), EquipmentEffectComponent)?.tables ?? []).map((t) => t.slice());
  }

  _commitEquipmentEffects(tables: number[][]) {
    const w = this.writer;
    const prev = w.peek(w.world(), EquipmentEffectComponent)?.tables;
    if (!(prev && prev.length === tables.length && prev.every((t, i) => sameWords(t as number[], tables[i])))) {
      w.set(w.world(), EquipmentEffectComponent, { tables });
    }
    const live = this._ensureEquipmentEffectTable();
    if (Array.isArray(live)) {
      live.forEach((entry, i) => {
        if (isUint8Entry(entry) && tables[i]) entry.uint8Array.set(wordsToBytes(tables[i], entry.uint8Array.length));
      });
    }
  }

  mutateEquipmentEffect(part: number, mutator: (entry: EquipmentEffectEntry) => EquipmentEffectEntry | void) {
    this._ensureInitialised();
    if (typeof mutator !== 'function') {
      return null;
    }
    const effects = this._getEquipmentEffects();
    if (!effects || typeof part !== 'number' || part < 0 || part >= effects.length) {
      return null;
    }
    const entry = effects[part];
    if (!entry) {
      return null;
    }
    if (!isUint8Entry(entry)) {
      // 不是字节结构体(单测的普通对象):照旧原地改
      const replaced: any = mutator(entry);
      if (typeof replaced !== 'undefined' && replaced !== entry) effects[part] = replaced;
      updateEquipmentEffectValue(Array.isArray(effects) ? effects.slice() : (effects || []));
      this._captureEquipmentEffects();
      return typeof replaced !== 'undefined' ? replaced : entry;
    }
    // 回调拿从组件现做的草稿(同一结构体类);只把本次改的字合进组件(回调里嵌套的写入不被覆盖)
    const base = this._equipmentTables()[part] ?? [];
    const Struct = playerRolesStruct(entry);
    if (!Struct) return null;
    const draft = new Struct(wordsToBytes(base, entry.uint8Array.length));
    const mutated: any = mutator(draft);
    const out = mutated && isUint8Entry(mutated) ? mutated : draft;
    const changed = wordsOf(out) || base;
    const tables = this._equipmentTables();
    tables[part] = (tables[part] ?? base).map((word, k) => (changed[k] !== base[k] ? changed[k] : word));
    this._commitEquipmentEffects(tables);
    updateEquipmentEffectValue(Array.isArray(effects) ? effects.slice() : (effects || []));
    this._captureEquipmentEffects();
    return entry;
  }

  _mutateEquipmentEffectWord(
    part: number,
    fieldIndex: number,
    roleId: number,
    updater: number | ((current: number) => number)
  ) {
    if (typeof part !== 'number' || typeof fieldIndex !== 'number' || typeof roleId !== 'number' || maxPlayerRoles() <= 0) {
      return null;
    }
    const effect = this.getEquipmentEffect(part);
    if (!effect || !isUint8Entry(effect)) {
      return null;
    }
    const index = fieldIndex * maxPlayerRoles() + roleId;
    if (index < 0 || (index + 1) * 2 > effect.uint8Array.length) {
      return null;
    }
    // 改组件里的字,再投影回活表(D5d)
    const tables = this._equipmentTables();
    const table = tables[part];
    if (!table) return null;
    const current = table[index] ?? 0;
    const nextValue = typeof updater === 'function' ? updater(current) : updater;
    if (typeof nextValue === 'number' && !Number.isNaN(nextValue)) {
      const normalized = toUnsignedWord(nextValue);
      if (normalized !== current) {
        table[index] = normalized;
        this._commitEquipmentEffects(tables);
      }
      return normalized;
    }
    return current;
  }

  setEquipmentEffectWord(part: number, fieldIndex: number, roleId: number, value: number) {
    const result = this._mutateEquipmentEffectWord(part, fieldIndex, roleId, value);
    const effects = this._getEquipmentEffects();
    updateEquipmentEffectValue(Array.isArray(effects) ? effects.slice() : (effects || []));
    this._captureEquipmentEffects();
    return result;
  }

  adjustEquipmentEffectWord(part: number, fieldIndex: number, roleId: number, delta: number) {
    const result = this._mutateEquipmentEffectWord(part, fieldIndex, roleId, (current) => {
      const signedCurrent = toSignedWord(current);
      const signedDelta = toSignedWord(delta);
      const next = signedCurrent + signedDelta;
      return toUnsignedWord(next);
    });
    const effects = this._getEquipmentEffects();
    updateEquipmentEffectValue(Array.isArray(effects) ? effects.slice() : (effects || []));
    this._captureEquipmentEffects();
    return result;
  }

  clearEquipmentEffect(part: number, roleId: number) {
    if (maxPlayerRoles() <= 0) {
      return;
    }
    const effect = this.getEquipmentEffect(part);
    if (!effect || !isUint8Entry(effect)) {
      return;
    }
    const buffer = effect.uint8Array;
    const totalWords = buffer.length / 2;
    if (totalWords <= 0) {
      return;
    }
    const fields = Math.floor(totalWords / maxPlayerRoles());
    // 一次取表、改完这名角色的所有字、一次提交。原先逐字段调 _mutateEquipmentEffectWord,每个字段都整表捕获 +
    // 比对 + 拷贝一遍(字段数 × 全部部位的字),清一次要 0.5–0.7 秒;战斗前后脚本连着清几个部位,实时模式下画面冻 3 秒。
    // 结果与逐字段清零相同:只动 (字段, roleId) 这些字,原本就是 0 的不算改动。
    const tables = this._equipmentTables();
    const table = tables[part];
    if (table) {
      let changed = false;
      for (let field = 0; field < fields; field++) {
        const index = field * maxPlayerRoles() + roleId;
        if (index < 0 || (index + 1) * 2 > buffer.length) continue;
        if ((table[index] ?? 0) !== 0) { table[index] = 0; changed = true; }
      }
      if (changed) this._commitEquipmentEffects(tables);
    }
    const effects = this._getEquipmentEffects();
    updateEquipmentEffectValue(Array.isArray(effects) ? effects.slice() : (effects || []));
    this._captureEquipmentEffects();
  }

  adjustPlayerMaxHP(roleId: number, delta: number) {
    const current = this._getPlayerRoleArrayValue('maxHP', roleId, 0);
    return this.setPlayerMaxHP(roleId, current + delta);
  }

  adjustPlayerMaxMP(roleId: number, delta: number) {
    const current = this._getPlayerRoleArrayValue('maxMP', roleId, 0);
    return this.setPlayerMaxMP(roleId, current + delta);
  }

  adjustPlayerAttackStrength(roleId: number, delta: number) {
    const current = this._getPlayerRoleArrayValue('attackStrength', roleId, 0);
    return this.setPlayerAttackStrength(roleId, current + delta);
  }

  adjustPlayerMagicStrength(roleId: number, delta: number) {
    const current = this._getPlayerRoleArrayValue('magicStrength', roleId, 0);
    return this.setPlayerMagicStrength(roleId, current + delta);
  }

  adjustPlayerDefense(roleId: number, delta: number) {
    const current = this._getPlayerRoleArrayValue('defense', roleId, 0);
    return this.setPlayerDefense(roleId, current + delta);
  }

  adjustPlayerDexterity(roleId: number, delta: number) {
    const current = this._getPlayerRoleArrayValue('dexterity', roleId, 0);
    return this.setPlayerDexterity(roleId, current + delta);
  }

  adjustPlayerFleeRate(roleId: number, delta: number) {
    const current = this._getPlayerRoleArrayValue('fleeRate', roleId, 0);
    return this.setPlayerFleeRate(roleId, current + delta);
  }

  getPlayerRoleWord(fieldIndex: number, roleId: number) {
    if (typeof fieldIndex !== 'number' || typeof roleId !== 'number' || maxPlayerRoles() <= 0) {
      return null;
    }
    // 角色数据是按名字分开的数组(PlayerRoles 结构):按 PLAYERROLES 字段号映射过去。
    // playerRoles 上即使挂着 uint8Array,也不是完整的 SDLPAL 字节布局(按偏移读会越界得 null)
    const col = playerRoleColumn(this.getPlayerRoles(), fieldIndex);
    if (col) {
      const value = roleId >= 0 && roleId < col.length ? col[roleId] : undefined;
      return typeof value === 'number' ? toUnsignedWord(value) : null;
    }
    const store = getGameDataStore();
    const playerRoles = store && (store.playerRoles as PlayerRolesBuffer | null);
    if (!playerRoles || !playerRoles.uint8Array) {
      return null;
    }
    const buffer = playerRoles.uint8Array;
    const offset = (fieldIndex * maxPlayerRoles() + roleId) * 2;
    if (offset < 0 || offset + 2 > buffer.byteLength) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return view.getUint16(offset, true);
  }

  _mutatePlayerRoleWord(fieldIndex: number, roleId: number, updater: number | ((current: number) => number)) {
    if (typeof fieldIndex !== 'number' || typeof roleId !== 'number' || maxPlayerRoles() <= 0) {
      return null;
    }
    let result = null;
    if (playerRoleColumn(this.getPlayerRoles(), fieldIndex)) {
      // 具名数组:同 _setPlayerRoleArrayValue 的写法,经 mutatePlayerRoles 落到状态里
      this.mutatePlayerRoles((roles: any) => {
        const col = playerRoleColumn(roles, fieldIndex);
        if (!col || roleId < 0 || roleId >= col.length) return roles;
        const current = toUnsignedWord(Number(col[roleId]) || 0);
        const nextValue = typeof updater === 'function' ? updater(current) : updater;
        if (typeof nextValue === 'number' && !Number.isNaN(nextValue)) {
          col[roleId] = toUnsignedWord(nextValue);
          result = col[roleId];
        }
        return roles;
      });
      return result;
    }
    this.mutatePlayerRoles((playerRoles: any) => {
      if (!playerRoles || !playerRoles.uint8Array) {
        return playerRoles as any;
      }
      const buffer = playerRoles.uint8Array;
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const offset = (fieldIndex * maxPlayerRoles() + roleId) * 2;
      if (offset < 0 || offset + 2 > buffer.byteLength) {
        return playerRoles as any;
      }
      const current = view.getUint16(offset, true);
      const nextValue = typeof updater === 'function' ? updater(current) : updater;
      if (typeof nextValue === 'number' && !Number.isNaN(nextValue)) {
        const normalized = toUnsignedWord(nextValue);
        view.setUint16(offset, normalized, true);
        result = normalized;
      }
      return playerRoles as any;
    });
    return result;
  }

  adjustPlayerRoleWord(fieldIndex: number, roleId: number, delta: number) {
    return this._mutatePlayerRoleWord(fieldIndex, roleId, (current) => {
      const signedCurrent = toSignedWord(current);
      const signedDelta = toSignedWord(delta);
      const next = signedCurrent + signedDelta;
      return toUnsignedWord(next);
    });
  }

  setPlayerRoleWord(fieldIndex: number, roleId: number, value: number) {
    return this._mutatePlayerRoleWord(fieldIndex, roleId, value);
  }

  getExpState() {
    this._ensureInitialised();
    const expState = stateService.getGlobal('exp');
    const normalized = expState && typeof expState === 'object'
      ? normalizeExpStruct(expState as any)
      : null;
    if (normalized && normalized !== expState) {
      stateService.setGlobal('exp', normalized);
      this._captureExp();
    }
    updateExpStateValue(normalized);
    return normalized || expState;
  }

  /**
   * 经验写口(M2 D5d:Experience 组件为真)。同 mutatePlayerRoles:回调拿从组件现做的 AllExperience 草稿(条目的
   * setter 写进草稿字节),只把本次改的字合进组件,再把字节原地写回 Global.exp 并按字节刷各条目的 getter 缓存。
   * 活结构体不是字节结构体(开局前 / 单测的普通对象)时照旧
   */
  mutateExpState(mutator: (exp: any) => any) {
    this._ensureInitialised();
    const live: any = stateService.getGlobal('exp');
    const Ctor = getGlobalObject('AllExperience');
    if (!live || !(live.uint8Array instanceof Uint8Array) || typeof Ctor !== 'function' || !(live instanceof Ctor)) {
      return this._mutateExpStateLegacy(mutator);
    }
    const w = this.writer;
    this._captureExp();
    const base = w.peek(w.world(), ExperienceComponent)!.words;
    const draft = normalizeExpStruct(new (Ctor as any)(wordsToBytes(base, live.uint8Array.length)));
    if (typeof mutator === 'function') mutator(draft);
    const changed = wordsOf(draft) || base;
    const latest = w.peek(w.world(), ExperienceComponent)!.words;
    const merged = latest.map((word, k) => (changed[k] !== base[k] ? changed[k] : word));
    if (!sameWords(latest as number[], merged)) w.set(w.world(), ExperienceComponent, { words: merged });
    const result = stateService.mutateGlobal('exp', (exp: any) => {
      if (exp && exp.uint8Array instanceof Uint8Array) {
        exp.uint8Array.set(wordsToBytes(merged, exp.uint8Array.length));
        syncExpCachesFromBytes(exp);
      }
      return exp;
    });
    updateExpStateValue(result && typeof result === 'object' ? (result as any) : null);
    return result;
  }

  _mutateExpStateLegacy(mutator: (exp: any) => any) {
    const result = stateService.mutateGlobal('exp', (exp) => {
      const normalized = exp && typeof exp === 'object' ? normalizeExpStruct(exp as any) : exp;
      if (normalized && typeof mutator === 'function') {
        mutator(normalized);
      }
      // EXPERIENCE 的字段都是 WORD:字节里是截断后的值,getter 缓存却留着赋进去的原值(浮点、负数、超 65535)。
      // 以字节为准对齐,读到的与存档一致(SDLPAL 写回时就是 (WORD)dwExp)
      if (normalized) syncExpCachesFromBytes(normalized);
      return normalized || exp;
    });
    const normalized = result && typeof result === 'object' ? (result as any) : null;
    updateExpStateValue(normalized);
    this._captureExp();
    return result;
  }

  setExpStruct(struct: any) {
    const normalizedStruct = normalizeExpStruct(struct);
    const resolved = this._copyStructIntoGlobal('exp', normalizedStruct);
    // _copyStructIntoGlobal 只把字节拷进现有结构体,各条目 getter 的缓存还是上一局的值(同一会话第二次读档)
    if (resolved && typeof resolved === 'object') syncExpCachesFromBytes(resolved);
    const normalizedValue = resolved && typeof resolved === 'object' ? (resolved as any) : null;
    updateExpStateValue(normalizedValue);
    this._captureExp();
    return resolved;
  }

  getLevelUpExp(level: number) {
    this._ensureInitialised();
    const table = getLevelUpExpTableValue([]);
    if (typeof level !== 'number') {
      return 0;
    }
    if (level < 0 || level >= table.length) {
      return table[level] || 0;
    }
    return table[level] || 0;
  }

  setLevelUpExpTable(levelUpExp: number[]) {
    const resolved = this._replaceGameDataTable('levelUpExp', levelUpExp || []);
    updateLevelUpExpTableValue(resolved || []);
    return resolved;
  }

  getPartyDirection() {
    this._ensureInitialised();
    const resolved = getPartyDirectionValue(DEFAULT_PARTY_DIRECTION);
    const direction = typeof resolved === 'number' ? resolved : DEFAULT_PARTY_DIRECTION;
    stateService.setGlobal('partyDirection', direction);
    return direction;
  }

  setPartyDirection(value: number) {
    this._ensureInitialised();
    const resolved = typeof value === 'number' ? value : DEFAULT_PARTY_DIRECTION;
    stateService.setGlobal('partyDirection', resolved);
    updatePartyDirectionValue(resolved, { source: 'worldService:setPartyDirection' });
    return resolved;
  }

  getFollowerCount() {
    this._ensureInitialised();
    return this._partyView().followers;      // 读口不写(D5c);Global / 切片由 setFollowerCount 投影
  }

  setFollowerCount(value: number) {
    this._ensureInitialised();
    const resolved = Number.isFinite(value) ? Math.max(0, value | 0) : 0;
    this._setPartyComponent({ ...this._partyState(), followers: resolved });
    this._projectingParty = true;
    try {
      stateService.setGlobal('numFollower', resolved);
      updateFollowerCountSliceValue(resolved, { source: 'worldService:setFollowerCount' });
    } finally {
      this._projectingParty = false;
    }
    return resolved;
  }

  getScreenWave() {
    this._ensureInitialised();
    const value = getScreenWaveValue(0);
    const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
    stateService.setGlobal('screenWave', resolved);
    updateScreenWaveValue(resolved, { emitEvent: false, source: 'worldService:getScreenWave' });
    return resolved;
  }

  setScreenWave(value: number) {
    this._ensureInitialised();
    const resolved = Number.isFinite(value) ? Math.trunc(value) : getScreenWaveValue(0);
    stateService.setGlobal('screenWave', resolved);
    updateScreenWaveValue(resolved, { source: 'worldService:setScreenWave' });
    return resolved;
  }

  adjustScreenWave(delta: number) {
    this._ensureInitialised();
    const current = getScreenWaveValue(0);
    const adjustment = Number.isFinite(delta) ? delta : 0;
    const resolved = Math.trunc((Number.isFinite(current) ? current : 0) + adjustment);
    stateService.setGlobal('screenWave', resolved);
    updateScreenWaveValue(resolved, { source: 'worldService:adjustScreenWave' });
    return resolved;
  }

  getWaveProgression() {
    this._ensureInitialised();
    const value = getWaveProgressionValue(0);
    const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
    stateService.setGlobal('waveProgression', resolved);
    updateWaveProgressionValue(resolved, { emitEvent: false, source: 'worldService:getWaveProgression' });
    return resolved;
  }

  setWaveProgression(value: number) {
    this._ensureInitialised();
    const resolved = Number.isFinite(value) ? Math.trunc(value) : getWaveProgressionValue(0);
    stateService.setGlobal('waveProgression', resolved);
    updateWaveProgressionValue(resolved, { source: 'worldService:setWaveProgression' });
    return resolved;
  }

  getNeedToFadeIn() {
    this._ensureInitialised();
    const resolved = !!getNeedToFadeInValue(false);
    stateService.setGlobal('needToFadeIn', resolved);
    updateNeedToFadeInValue(resolved, { emitEvent: false, source: 'worldService:getNeedToFadeIn' });
    return resolved;
  }

  setNeedToFadeIn(value: boolean) {
    this._ensureInitialised();
    const resolved = !!value;
    stateService.setGlobal('needToFadeIn', resolved);
    updateNeedToFadeInValue(resolved, { source: 'worldService:setNeedToFadeIn' });
    return resolved;
  }

  getPaletteId() {
    this._ensureInitialised();
    const value = getPaletteIdValue(0);
    const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
    stateService.setGlobal('numPalette', resolved);
    updatePaletteIdValue(resolved, { emitEvent: false, source: 'worldService:getPaletteId' });
    return resolved;
  }

  setPaletteId(value: number) {
    this._ensureInitialised();
    const resolved = Number.isFinite(value) ? Math.trunc(value) : getPaletteIdValue(0);
    stateService.setGlobal('numPalette', resolved);
    updatePaletteIdValue(resolved, { source: 'worldService:setPaletteId' });
    return resolved;
  }

  getNightPaletteFlag() {
    this._ensureInitialised();
    const resolved = !!getNightPaletteValue(false);
    stateService.setGlobal('nightPalette', resolved);
    updateNightPaletteValue(resolved, { emitEvent: false, source: 'worldService:getNightPalette' });
    return resolved;
  }

  setNightPaletteFlag(value: boolean) {
    this._ensureInitialised();
    const resolved = !!value;
    stateService.setGlobal('nightPalette', resolved);
    updateNightPaletteValue(resolved, { source: 'worldService:setNightPalette' });
    return resolved;
  }

  getLayer() {
    this._ensureInitialised();
    const value = getLayerValue(0);
    const resolved = Number.isFinite(value) ? Math.trunc(value) : 0;
    stateService.setGlobal('layer', resolved);
    updateLayerValue(resolved, { emitEvent: false, source: 'worldService:getLayer' });
    return resolved;
  }

  setLayer(value: number) {
    this._ensureInitialised();
    const resolved = Number.isFinite(value) ? Math.trunc(value) : getLayerValue(0);
    stateService.setGlobal('layer', resolved);
    updateLayerValue(resolved, { source: 'worldService:setLayer' });
    return resolved;
  }

  getCash() {
    this._ensureInitialised();
    return this._inventoryView().cash;
  }

  setCash(value: number) {
    this._ensureInitialised();
    const prev = this._inventoryState();
    return this._writeInventory({ ...prev, cash: toCash(value) }, prev, 'cash').cash;
  }

  adjustCash(delta: number) {
    this._ensureInitialised();
    const adjustment = Number.isFinite(delta) ? delta : 0;
    const prev = this._inventoryState();
    return this._writeInventory({ ...prev, cash: toCash(prev.cash + adjustment) }, prev, 'cash').cash;
  }

  _getNumberGlobal(key: string, fallback = 0) {
    this._ensureInitialised();
    const value = stateService.getGlobal(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  _setNumberGlobal(key: string, value: number, fallback = 0) {
    this._ensureInitialised();
    const resolved = Number.isFinite(value) ? Math.trunc(value) : fallback;
    stateService.setGlobal(key, resolved);
    return resolved;
  }

  _adjustNumberGlobal(key: string, delta: number, fallback = 0) {
    this._ensureInitialised();
    const adjustment = Number.isFinite(delta) ? delta : 0;
    let nextValue = fallback;
    stateService.mutateGlobal(key, (current) => {
      const currentValue = typeof current === 'number' && Number.isFinite(current) ? current : fallback;
      nextValue = Math.trunc(currentValue + adjustment);
      return nextValue;
    });
    return nextValue;
  }

  _getBooleanGlobal(key: string, fallback = false) {
    this._ensureInitialised();
    const value = stateService.getGlobal(key);
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    return fallback;
  }

  _setBooleanGlobal(key: string, value: boolean) {
    this._ensureInitialised();
    const resolved = !!value;
    stateService.setGlobal(key, resolved);
    return resolved;
  }

  _getValueGlobal(key: string, fallback: unknown = null) {
    this._ensureInitialised();
    const value = stateService.getGlobal(key);
    return typeof value === 'undefined' ? fallback : value;
  }

  _setValueGlobal(key: string, value: unknown) {
    this._ensureInitialised();
    stateService.setGlobal(key, value);
    return value;
  }

  setObjectDescTable(value: unknown) {
    const resolved = this._setValueGlobal('objectDesc', value);
    const nextDesc = typeof resolved === 'undefined' ? null : (resolved as any);
    updateObjectDescValue(nextDesc as any);
    return resolved;
  }

  getInventoryMenuIndex() {
    return this._inventoryView().menuIndex;
  }

  setInventoryMenuIndex(value: number) {
    const prev = this._inventoryState();
    return this._writeInventory({ ...prev, menuIndex: toTrunc(value) }, prev, 'menuIndex').menuIndex;
  }

  getSystemMenuIndex() {
    return getSystemMenuIndexValue(this._getNumberGlobal('curSystemMenuItem', 0));
  }

  setSystemMenuIndex(value: number) {
    const resolved = this._setNumberGlobal('curSystemMenuItem', value, 0);
    updateSystemMenuIndex(resolved, { source: 'worldService' });
    return resolved;
  }

  getMainMenuIndex() {
    return getMainMenuIndexValue(this._getNumberGlobal('curMainMenuItem', 0));
  }

  setMainMenuIndex(value: number) {
    const resolved = this._setNumberGlobal('curMainMenuItem', value, 0);
    updateMainMenuIndex(resolved, { source: 'worldService' });
    return resolved;
  }

  getLastEventObjectId() {
    return this._getNumberGlobal('lastEventObjectId', 0);
  }

  setLastEventObjectId(value: number) {
    return this._setNumberGlobal('lastEventObjectId', value, 0);
  }

  getNoMusicFlag() {
    return getNoMusicFlagValue(this._getBooleanGlobal('noMusic', false));
  }

  setNoMusicFlag(value: boolean) {
    const resolved = this._setBooleanGlobal('noMusic', value);
    updateNoMusicFlag(resolved, { source: 'worldService' });
    return resolved;
  }

  getNoSoundFlag() {
    return getNoSoundFlagValue(this._getBooleanGlobal('noSound', false));
  }

  setNoSoundFlag(value: boolean) {
    const resolved = this._setBooleanGlobal('noSound', value);
    updateNoSoundFlag(resolved, { source: 'worldService' });
    return resolved;
  }

  getCurrentMusicTrackId() {
    return this._getNumberGlobal('wNumMusic', 0);
  }

  setCurrentMusicTrackId(value: number) {
    return this._setNumberGlobal('wNumMusic', value, 0);
  }

  getAutoBattle() {
    return getAutoBattleValue(this._getBooleanGlobal('autoBattle', false));
  }

  setAutoBattle(value: boolean) {
    const resolved = this._setBooleanGlobal('autoBattle', value);
    updateAutoBattle(resolved, { source: 'worldService' });
    return resolved;
  }

  getChaseRange() {
    const value = this._getNumberGlobal('chaseRange', getChaseRangeFlagValue(0));
    updateChaseRangeValue(value, { emitEvent: false, source: 'worldService:getChaseRange' });
    return value;
  }

  setChaseRange(value: number) {
    const resolved = this._setNumberGlobal('chaseRange', value, getChaseRangeFlagValue(0));
    updateChaseRangeValue(resolved, { source: 'worldService:setChaseRange' });
    return resolved;
  }

  adjustChaseRange(delta: number) {
    const resolved = this._adjustNumberGlobal('chaseRange', delta, getChaseRangeFlagValue(0));
    updateChaseRangeValue(resolved, { source: 'worldService:adjustChaseRange' });
    return resolved;
  }

  getChaseSpeedChangeCycles() {
    const value = this._getNumberGlobal('chaseSpeedChangeCycles', getChaseSpeedFlagValue(0));
    updateChaseSpeedCyclesValue(value, { emitEvent: false, source: 'worldService:getChaseSpeedChangeCycles' });
    return value;
  }

  setChaseSpeedChangeCycles(value: number) {
    const resolved = this._setNumberGlobal('chaseSpeedChangeCycles', value, getChaseSpeedFlagValue(0));
    updateChaseSpeedCyclesValue(resolved, { source: 'worldService:setChaseSpeedChangeCycles' });
    return resolved;
  }

  adjustChaseSpeedChangeCycles(delta: number) {
    const resolved = this._adjustNumberGlobal('chaseSpeedChangeCycles', delta, getChaseSpeedFlagValue(0));
    updateChaseSpeedCyclesValue(resolved, { source: 'worldService:adjustChaseSpeedChangeCycles' });
    return resolved;
  }

  getCollectValue() {
    const value = this._getNumberGlobal('collectValue', getCollectFlagValue(0));
    updateCollectValue(value, { emitEvent: false, source: 'worldService:getCollectValue' });
    return value;
  }

  setCollectValue(value: number) {
    const resolved = this._setNumberGlobal('collectValue', value, getCollectFlagValue(0));
    updateCollectValue(resolved, { source: 'worldService:setCollectValue' });
    return resolved;
  }

  adjustCollectValue(delta: number) {
    const resolved = this._adjustNumberGlobal('collectValue', delta, getCollectFlagValue(0));
    updateCollectValue(resolved, { source: 'worldService:adjustCollectValue' });
    return resolved;
  }

  getCurPlayingRng() {
    return this._getValueGlobal('curPlayingRNG', 0);
  }

  setCurPlayingRng(value: number) {
    return this._setValueGlobal('curPlayingRNG', value);
  }

  getFrameCount() {
    return getFrameCountValue(this._getNumberGlobal('frameNum', 0));
  }

  setFrameCount(value: number) {
    const resolved = this._setNumberGlobal('frameNum', value, 0);
    updateFrameCount(resolved, { source: 'worldService' });
    return resolved;
  }

  incrementFrameCount(delta = 1) {
    const resolved = this._adjustNumberGlobal('frameNum', delta, 0);
    updateFrameCount(resolved, { source: 'worldService' });
    return resolved;
  }

  isInBattle() {
    return this._getBooleanGlobal('inBattle', false);
  }

  setInBattle(value: boolean) {
    const result = this._setBooleanGlobal('inBattle', value);
    this.checkCancellableExecutionScopes();
    return result;
  }

  getBattleState() {
    this._ensureInitialised();
    const battle = stateService.getGlobal('battle');
    return battle || null;
  }

  getCurrentSaveSlot() {
    const slot = this._getNumberGlobal('currentSaveSlot', 1);
    return Number.isFinite(slot) && slot >= 0 ? slot : 1;
  }

  setCurrentSaveSlot(value: number) {
    return this._setNumberGlobal('currentSaveSlot', value, 1);
  }

  setLastUnequippedItem(value: number) {
    const resolved = this._setNumberGlobal('lastUnequippedItem', value, 0);
    updateLastUnequippedValue(resolved, { source: 'worldService' });
    return resolved;
  }

  setMaxPartyMemberIndex(value: number) {
    this._projectingParty = true;
    let resolved;
    try {
      resolved = this._setNumberGlobal('maxPartyMemberIndex', value, 0);
      updateMaxPartyIndexValue(resolved, { source: 'worldService' });
    } finally {
      this._projectingParty = false;
    }
    // 组件存 Global 读回的值(GlobalVars 里是 WORD,写入时回绕;旧的读口 getMaxPartyMemberIndex 读的是它)
    const stored = stateService.getGlobal('maxPartyMemberIndex');
    this._setPartyComponent({ ...this._partyState(), maxIndex: toTrunc(typeof stored === 'number' ? stored : resolved) });
    return resolved;
  }

  isEnteringScene() {
    return this._getBooleanGlobal('enteringScene', false);
  }

  setEnteringScene(value: boolean) {
    return this._setBooleanGlobal('enteringScene', value);
  }

  getMusicTrack() {
    return this._getNumberGlobal('musicNum', 0);
  }

  setMusicTrack(value: number) {
    const resolved = this._setNumberGlobal('musicNum', value, 0);
    updateMusicTrackValue(resolved, { source: 'worldService:setMusicTrack' });
    return resolved;
  }

  setBattleMusicTrack(value: number) {
    const resolved = this._setNumberGlobal('numBattleMusic', value, 0);
    updateBattleMusicTrackValue(resolved, { source: 'worldService:setBattleMusicTrack' });
    return resolved;
  }

  setBattleFieldId(value: number) {
    const resolved = this._setNumberGlobal('numBattleField', value, 0);
    updateBattleFieldIdValue(resolved, { source: 'worldService:setBattleFieldId' });
    return resolved;
  }

  getBattleSpeed() {
    const value = this._getNumberGlobal('battleSpeed', getBattleSpeedFlagValue(2));
    updateBattleSpeedValue(value, { emitEvent: false, source: 'worldService:getBattleSpeed' });
    return value;
  }

  setBattleSpeed(value: number) {
    const resolved = this._setNumberGlobal('battleSpeed', value, getBattleSpeedFlagValue(2));
    updateBattleSpeedValue(resolved, { source: 'worldService:setBattleSpeed' });
    return resolved;
  }

  getMaxSpriteDrawLimit() {
    return this._maxSpriteDrawLimit;
  }

  setMaxSpriteDrawLimit(value: number) {
    const normalized = Number.isFinite(value) ? Math.trunc(value) : DEFAULT_MAX_SPRITE_TO_DRAW;
    this._maxSpriteDrawLimit = normalized;
    if (typeof globalThis !== 'undefined') {
      (globalThis as Record<string, unknown>)[LEGACY_SPRITE_LIMIT_KEY] = normalized;
    }
    return normalized;
  }

  getFrameNum() {
    return this.getFrameCount();
  }

  setFrameNum(value: number) {
    return this.setFrameCount(value);
  }

  adjustFrameNum(delta: number) {
    return this.incrementFrameCount(delta);
  }

  isGameStart() {
    return this._getBooleanGlobal('gameStart', false);
  }

  setGameStart(value: boolean) {
    return this._setBooleanGlobal('gameStart', value);
  }

  _handleGlobalChanged(event: StateChangeEvent) {
    const payload = event && typeof event === 'object'
      ? (event.data && typeof event.data === 'object' ? event.data : event)
      : null;
    if (!payload || !payload.key) {
      return;
    }
    switch (payload.key) {
      case 'viewport':
        this.syncViewport();
        updateViewportValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'partyOffset':
        this.syncViewport();
        updatePartyOffsetValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'party':
        this.syncPartyMembers();
        updatePartySliceValue(Array.isArray(stateService.getGlobal('party')) ? stateService.getGlobal('party') as any[] : [], { source: 'worldService:legacyGlobal' });
        if (!this._projectingParty) this._importPartyFromGlobal();
        break;
      case 'trail':
        this.syncTrail();
        updateTrailSliceValue(Array.isArray(stateService.getGlobal('trail')) ? stateService.getGlobal('trail') as any[] : [], { source: 'worldService:legacyGlobal' });
        if (!this._projectingParty) this._importPartyFromGlobal();
        break;
      case 'partyDirection':
        updatePartyDirectionValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'maxPartyMemberIndex':
        updateMaxPartyIndexValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        if (!this._projectingParty) this._importPartyFromGlobal();
        break;
      case 'curMainMenuItem':
        updateMainMenuIndex(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'curSystemMenuItem':
        updateSystemMenuIndex(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'curInvMenuItem':
        updateInventoryMenuIndex(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        if (!this._projectingInventory) this._importInventoryFromGlobal();
        break;
      case 'noMusic':
        updateNoMusicFlag(!!payload.value, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'noSound':
        updateNoSoundFlag(!!payload.value, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'inventory':
        updateInventoryValue(Array.isArray(payload.value) ? payload.value : [], { emitEvent: false, source: 'worldService:legacyGlobal' });
        if (!this._projectingInventory) this._importInventoryFromGlobal();
        break;
      case 'cash':
        updateCashValue(typeof payload.value === 'number' ? payload.value : 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        if (!this._projectingInventory) this._importInventoryFromGlobal();
        break;
      case 'lastUnequippedItem':
        updateLastUnequippedValue(typeof payload.value === 'number' ? payload.value : 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'collectValue':
        updateCollectValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'chaseRange':
        updateChaseRangeValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'chaseSpeedChangeCycles':
        updateChaseSpeedCyclesValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'playerStatus':
        updatePlayerStatusMatrix(Array.isArray(payload.value) ? payload.value : [], { source: 'worldService:legacyGlobal' });
        break;
      case 'poisonStatus':
        updatePoisonStatusMatrix(Array.isArray(payload.value) ? payload.value : [], { source: 'worldService:legacyGlobal' });
        if (!this._projectingStatus) this._importPoisonFromGlobal();
        break;
      case 'objectDesc':
        updateObjectDescValue(typeof payload.value === 'undefined' ? null : (payload.value as any));
        break;
      case 'equipmentEffect':
        updateEquipmentEffectValue(Array.isArray(payload.value) ? payload.value : [], { force: true });
        this._captureEquipmentEffects();
        break;
      case 'musicNum':
        updateMusicTrackValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'numBattleMusic':
        updateBattleMusicTrackValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'numBattleField':
        updateBattleFieldIdValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'battleSpeed':
        updateBattleSpeedValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'screenWave':
        updateScreenWaveValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'waveProgression':
        updateWaveProgressionValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'needToFadeIn':
        updateNeedToFadeInValue(!!payload.value, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'numPalette':
        updatePaletteIdValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'nightPalette':
        updateNightPaletteValue(!!payload.value, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'layer':
        updateLayerValue(Number(payload.value) || 0, { emitEvent: false, source: 'worldService:legacyGlobal' });
        break;
      case 'numFollower':
        updateFollowerCountSliceValue(typeof payload.value === 'number' ? payload.value : 0, { source: 'worldService:legacyGlobal' });
        if (!this._projectingParty) this._importPartyFromGlobal();
        break;
      case 'autoBattle':
        this._syncAutoBattleFlag(payload.value);
        break;
      case 'numScene':
        this.syncScene();
        this.syncMapMeta();
        this.syncMapTiles();
        this.syncEventObjects();
        this.ensureCollisionState();
        {
          const rawSceneId = Number(payload.value);
          const sceneId: number = Number.isFinite(rawSceneId)
            ? rawSceneId
            : Number(this.getSceneId() || 0);
          updateSceneIdValue(sceneId, { source: 'worldService:legacyGlobal' });
        }
        break;
      case 'frameNum':
        this._syncFrameCountValue(payload.value);
        break;
      default:
        break;
    }
  }

  _handleGameDataChanged(event: StateChangeEvent) {
    const payload = event && typeof event === 'object'
      ? (event.data && typeof event.data === 'object' ? event.data : event)
      : null;
    if (!payload || !payload.key) {
      return;
    }
    switch (payload.key) {
      case 'eventObject':
        this.syncEventObjects();
        this.ensureCollisionState();
        break;
      case 'scene':
        this.syncScene();
        this.syncMapMeta();
        this.syncMapTiles();
        this.syncEventObjects();
        this.ensureCollisionState();
        this.syncBattleFormation();
        this.captureSceneTable();
        break;
      case 'map':
        this.syncScene();
        this.syncMapMeta();
        this.syncMapTiles();
        this.syncEventObjects();
        this.ensureCollisionState();
        this.syncBattleFormation();
        break;
      case 'scriptEntry':
        this.syncScriptRegisters();
        break;
      case 'playerRoles':
        this.syncPlayerRoles();
        break;
      case 'enemyTeam':
      case 'enemyPos':
      case 'battleField':
        this.syncBattleFormation();
        break;
      case 'object':
        const store = getGameDataStore();
        const objectTable = store && (store as any).object ? (store as any).object : [];
        updateObjectTableValue(objectTable);
        this.captureObjectTable();
        break;
      default:
        break;
    }
  }
}

const worldService = new WorldService();

export { WorldService };
export default worldService;
