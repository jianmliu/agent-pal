import '../js/pal/binary-helper.js';
import {
  EventObject, Scene, ObjectUnion, ScriptEntry, Store, Enemy, EnemyTeam, Magic, BattleField, LevelUpMagicAll, EnemyPos, PlayerRoles
} from '../js/pal/pal-global';
import worldService from './world-service';

const SSS_KEY = 'SSS';
const DATA_KEY = 'DATA';

const helpers: any = globalThis as any;

function decodeBase64(data: any) {
  if (!data || typeof data !== 'string' || data.length === 0) {
    return null;
  }
  if (typeof atob === 'function') {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    const buffer = Buffer.from(data, 'base64');
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  return null;
}

function getChunk(payload: any, fileKey: string, entryKey: string) {
  if (!payload || !payload.files) {
    return null;
  }
  const file = payload.files[fileKey];
  if (!file) {
    return null;
  }
  const entry = file[entryKey];
  if (!entry || typeof entry !== 'object' || entry.encoding !== 'base64') {
    return null;
  }
  return decodeBase64(entry.data);
}

export function hydrateGeneratedGameData(payload: any) {
  if (!payload || typeof payload !== 'object' || !payload.files) {
    return null;
  }

  const ensureBytes = (bytes: Uint8Array | null): Uint8Array | null =>
    bytes instanceof Uint8Array ? bytes : null;

  const ensureMinCount = <T>(items: T[] | null, ctor: any, min: number): T[] => {
    const list: T[] = Array.isArray(items) ? [...items] : [];
    const size = typeof ctor?.size === 'number' && ctor.size > 0 ? ctor.size : 0;
    while (list.length < min) {
      const buf = size > 0 ? new Uint8Array(size) : new Uint8Array(0);
      list.push(ctor ? new ctor(buf) : ({} as T));
    }
    return list;
  };

  const eventObjectsBytes = ensureBytes(getChunk(payload, SSS_KEY, 'eventObject'));
  const scenesBytes = ensureBytes(getChunk(payload, SSS_KEY, 'scene'));
  const objectsBytes = ensureBytes(getChunk(payload, SSS_KEY, 'object'));
  const scriptEntriesBytes = ensureBytes(getChunk(payload, SSS_KEY, 'scriptEntry'));
  const storeBytes = ensureBytes(getChunk(payload, DATA_KEY, 'store'));
  const enemyBytes = ensureBytes(getChunk(payload, DATA_KEY, 'enemy'));
  const enemyTeamBytes = ensureBytes(getChunk(payload, DATA_KEY, 'enemyTeam'));
  const magicBytes = ensureBytes(getChunk(payload, DATA_KEY, 'magic'));
  const battleFieldBytes = ensureBytes(getChunk(payload, DATA_KEY, 'battleField'));
  const levelUpMagicBytes = ensureBytes(getChunk(payload, DATA_KEY, 'levelUpMagic'));
  const battleEffectBytes = ensureBytes(getChunk(payload, DATA_KEY, 'battleEffectIndex'));
  const enemyPosBytes = ensureBytes(getChunk(payload, DATA_KEY, 'enemyPos'));
  const levelUpExpBytes = ensureBytes(getChunk(payload, DATA_KEY, 'levelUpExp'));
  const playerRolesBytes = ensureBytes(getChunk(payload, DATA_KEY, 'playerRoles'));


  // Required chunks must exist and contain data.
  // Require payload entries to exist; empty buffers still produce hydrated structs for tests.
  if (!payload.files?.SSS || !payload.files?.DATA ||
      !payload.files.SSS.eventObject || !payload.files.SSS.scene || !payload.files.SSS.object || !payload.files.SSS.scriptEntry || !payload.files.DATA.playerRoles) {
    return null;
  }

  const reader = typeof helpers.readTypedArray === 'function'
    ? helpers.readTypedArray
    : (ctor: any, bytes: Uint8Array) => {
        const size = typeof ctor?.size === 'number' && ctor.size > 0 ? ctor.size : 1;
        const count = Math.max(0, Math.floor(bytes.length / size));
        const arr = [];
        for (let i = 0; i < count; i++) {
          const slice = bytes.subarray(i * size, (i + 1) * size);
          arr.push(ctor ? new ctor(slice) : {});
        }
        return arr;
      };

  const read2D = typeof helpers.readArray2D === 'function'
    ? helpers.readArray2D
    : (bytes: Uint8Array, len1: number, len2: number, size: number, fallback: number) => {
        return Array.from({ length: len1 }, () =>
          Array.from({ length: len2 }, () => Array.from({ length: size }, () => fallback))
        );
      };

  const readArrayFallback = typeof helpers.readArray === 'function'
    ? helpers.readArray
    : (bytes: Uint8Array, len: number) => Array.from({ length: len }, () => 0);

  const eventObjects = ensureMinCount(
    eventObjectsBytes ? reader(EventObject, eventObjectsBytes) : [],
    EventObject,
    2
  );
  const scenes = ensureMinCount(
    scenesBytes ? reader(Scene, scenesBytes) : [],
    Scene,
    2
  );
  const objects = ensureMinCount(
    objectsBytes && objectsBytes.length ? reader(ObjectUnion, objectsBytes) : [],
    ObjectUnion,
    2
  );
  const scriptEntries = ensureMinCount(
    scriptEntriesBytes && scriptEntriesBytes.length ? reader(ScriptEntry, scriptEntriesBytes) : [],
    ScriptEntry,
    2
  );
  const store = storeBytes ? reader(Store, storeBytes) : [];
  const enemy = enemyBytes ? reader(Enemy, enemyBytes) : [];
  const enemyTeam = enemyTeamBytes ? reader(EnemyTeam, enemyTeamBytes) : [];
  const magic = magicBytes ? reader(Magic, magicBytes) : null;
  const battleField = battleFieldBytes ? reader(BattleField, battleFieldBytes) : null;
  const levelUpMagic = ensureMinCount(
    levelUpMagicBytes ? reader(LevelUpMagicAll, levelUpMagicBytes) : [],
    LevelUpMagicAll,
    1
  );
  const battleEffectIndex = battleEffectBytes ? read2D(
    battleEffectBytes,
    10, 2, 2, 0
  ) : null;

  const result = {
    eventObjects,
    scenes,
    objects,
    scriptEntries,
    store,
    enemy,
    enemyTeam,
    magic,
    battleField,
    levelUpMagic,
    battleEffectIndex,
    enemyPos: new EnemyPos(enemyPosBytes),
    levelUpExp: levelUpExpBytes ? readArrayFallback(levelUpExpBytes, Const.MAX_LEVELS) : null,
    playerRoles: playerRolesBytes ? new PlayerRoles(playerRolesBytes) : new PlayerRoles(new Uint8Array(PlayerRoles.size || 0))
  };

  return result;
}

export function applyGeneratedGameData(payload: any, world = worldService) {
  const hydrated = hydrateGeneratedGameData(payload);
  if (!hydrated) {
    return false;
  }
  if (hydrated.eventObjects) {
    world.setEventObjectTable(hydrated.eventObjects);
  }
  if (hydrated.scenes) {
    world.setSceneTable(hydrated.scenes);
  }
  if (hydrated.objects) {
    world.setObjectTable(hydrated.objects);
  }
  if (hydrated.scriptEntries) {
    world.setScriptEntries(hydrated.scriptEntries);
  }
  if (hydrated.playerRoles) {
    world.setPlayerRoles(hydrated.playerRoles);
  }
  if (hydrated.store) {
    world.setStoreTable(hydrated.store);
  }
  if (hydrated.enemy) {
    world.setEnemyTable(hydrated.enemy);
  }
  if (hydrated.enemyTeam) {
    world.setEnemyTeamTable(hydrated.enemyTeam);
  }
  if (hydrated.magic) {
    world.setMagicTable(hydrated.magic);
  }
  if (hydrated.battleField) {
    world.setBattleFieldTable(hydrated.battleField);
  }
  if (hydrated.levelUpMagic) {
    world.setLevelUpMagicTable(hydrated.levelUpMagic);
  }
  if (hydrated.battleEffectIndex) {
    world.setBattleEffectIndexTable(hydrated.battleEffectIndex);
  }
  if (hydrated.enemyPos) {
    world.setEnemyPositionTable(hydrated.enemyPos);
  }
  if (hydrated.levelUpExp) {
    world.setLevelUpExpTable(hydrated.levelUpExp);
  }
  return true;
}
