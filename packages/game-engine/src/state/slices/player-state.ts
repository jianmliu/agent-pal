import reactiveContext from '../reactive-context.js';

type Roles = Record<string, unknown> | null;
type EquipmentEffect = Array<number | Record<string, unknown>>;
/** force:值相等也写入(装备加成表是活结构体,整表换成另一组对象时 JSON 相等,但必须换引用) */
type UpdateOptions = { emitEvent?: boolean; source?: string; fallback?: unknown; eventType?: string; force?: boolean };

const PLAYER_ROLES_SIGNAL_KEY = 'world.player.roles';
const EQUIPMENT_EFFECT_SIGNAL_KEY = 'world.player.equipmentEffect';

const HP_EVENT_TYPE = 'world/player/hpChanged';
const MP_EVENT_TYPE = 'world/player/mpChanged';
const ROLES_EVENT_TYPE = 'world/player/rolesChanged';
const EQUIPMENT_EVENT_TYPE = 'world/player/equipmentEffectChanged';

function ensureSignal(key: string, fallback: unknown) {
  return reactiveContext.ensureSignal(key, fallback);
}

function cloneArrayLike(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  if (ArrayBuffer.isView(value)) {
    return cloneViewToNumbers(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (Array.isArray(entry) || (ArrayBuffer.isView(entry) && typeof (entry as ArrayBufferView & { slice?: () => ArrayBufferView }).slice === 'function')) {
        return cloneArrayLike(entry);
      }
      if (entry && typeof entry === 'object') {
        return { ...(entry as Record<string, unknown>) };
      }
      return entry;
    });
  }
  return [];
}

function cloneViewToNumbers(view: ArrayBufferView): number[] {
  if (view instanceof DataView) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return Array.from(bytes);
  }
  return Array.from(view as unknown as ArrayLike<number>);
}

function cloneObject(value: unknown): Roles {
  if (!value || typeof value !== 'object') {
    return value as Roles;
  }
  const clone: Record<string, unknown> = {};
  Reflect.ownKeys(value).forEach((rawKey) => {
    if (typeof rawKey !== 'string') {
      return;
    }
    let entry;
    try {
      entry = (value as Record<string, unknown>)[rawKey];
    } catch (err) {
      return;
    }
    const key = rawKey;
    if (Array.isArray(entry) || (ArrayBuffer.isView(entry) && typeof (entry as ArrayBufferView & { slice?: () => ArrayBufferView }).slice === 'function')) {
      clone[key] = cloneArrayLike(entry);
    } else if (entry && typeof entry === 'object') {
      clone[key] = { ...(entry as Record<string, unknown>) };
    } else {
      clone[key] = entry as unknown;
    }
  });
  const proto = Object.getPrototypeOf(value);
  if (proto && proto !== Object.prototype) {
    Object.getOwnPropertyNames(proto).forEach((key) => {
      if (key === 'constructor' || Object.prototype.hasOwnProperty.call(clone, key)) {
        return;
      }
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (!descriptor || typeof descriptor.get !== 'function' || typeof descriptor.set === 'function') {
        return;
      }
      let derived;
      try {
        derived = (value as Record<string, unknown>)[key];
      } catch (err) {
        return;
      }
      if (Array.isArray(derived) || (ArrayBuffer.isView(derived) && typeof (derived as ArrayBufferView & { slice?: () => ArrayBufferView }).slice === 'function')) {
        clone[key] = cloneArrayLike(derived);
      } else if (derived && typeof derived === 'object') {
        clone[key] = { ...(derived as Record<string, unknown>) };
      } else {
        clone[key] = derived as unknown;
      }
    });
  }
  return clone;
}

/** 角色结构体 → 切片里的纯数据副本(字段数组拷成普通数组);组件视图也用它,形态与切片一致 */
export function cloneRolesValue(value: unknown): Roles {
  return normaliseRoles(value);
}

function normaliseRoles(value: unknown): Roles {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return cloneObject(value);
}

function normaliseEquipmentEffect(value: unknown): EquipmentEffect {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.slice() as EquipmentEffect;
  }
  if (ArrayBuffer.isView(value)) {
    return cloneViewToNumbers(value) as EquipmentEffect;
  }
  return value as EquipmentEffect;
}

function areValuesEqual(a: unknown, b: unknown) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (err) {
    return false;
  }
}

function getStatArray(roles: Roles, key: string): number[] {
  if (!roles || !(roles as Record<string, unknown>)[key]) {
    return [];
  }
  const value = (roles as Record<string, unknown>)[key];
  if (Array.isArray(value)) {
    return value as number[];
  }
  if (ArrayBuffer.isView(value)) {
    return cloneViewToNumbers(value) as number[];
  }
  return [];
}

function emitStatChanges(previousRoles: Roles, nextRoles: Roles, statKey: string, eventType: string, source: string) {
  const previousArray = getStatArray(previousRoles, statKey);
  const nextArray = getStatArray(nextRoles, statKey);
  const maxLength = Math.max(previousArray.length, nextArray.length);
  for (let index = 0; index < maxLength; index++) {
    const prevValue = typeof previousArray[index] === 'number' ? previousArray[index] : 0;
    const nextValue = typeof nextArray[index] === 'number' ? nextArray[index] : 0;
    if (prevValue !== nextValue) {
      reactiveContext.rootEvent$.next({
        type: eventType,
        roleId: index,
        previous: prevValue,
        value: nextValue,
        source
      });
    }
  }
}

function setSignalValue(key: string, value: unknown, options: UpdateOptions = {}) {
  const previous = reactiveContext.getSignal(key, options.fallback);
  const signal = ensureSignal(key, previous);
  const changed = !areValuesEqual(signal.value, value);
  if (changed || options.force || typeof previous === 'undefined') {
    reactiveContext.setSignal(key, value);
    if (options.emitEvent !== false) {
      reactiveContext.rootEvent$.next({
        type: options.eventType || `signal/${key}/changed`,
        value,
        previous,
        source: options.source || 'worldService'
      });
    }
  }
  return value;
}

export function playerStateSignals() {
  return {
    roles: ensureSignal(PLAYER_ROLES_SIGNAL_KEY, null),
    equipmentEffect: ensureSignal(EQUIPMENT_EFFECT_SIGNAL_KEY, [])
  };
}

export function updatePlayerRolesValue(value: Roles, options: UpdateOptions = {}) {
  const resolved = normaliseRoles(value);
  const previous = reactiveContext.getSignal(PLAYER_ROLES_SIGNAL_KEY, null) as Roles;
  const signal = ensureSignal(PLAYER_ROLES_SIGNAL_KEY, previous);
  const hasPrevious = !!previous;
  const changed = !areValuesEqual(signal.value, resolved);
  const source = options.source || 'worldService';

  if (!previous || changed) {
    reactiveContext.setSignal(PLAYER_ROLES_SIGNAL_KEY, resolved);
  }

  if (options.emitEvent !== false) {
    if (!previous || changed) {
      reactiveContext.rootEvent$.next({
        type: ROLES_EVENT_TYPE,
        value: resolved,
        previous,
        source
      });
    }
    if (hasPrevious && resolved) {
      emitStatChanges(previous, resolved, 'HP', HP_EVENT_TYPE, source);
      emitStatChanges(previous, resolved, 'MP', MP_EVENT_TYPE, source);
    }
  }

  return resolved;
}

export function updateEquipmentEffectValue(value: EquipmentEffect, options: UpdateOptions = {}) {
  return setSignalValue(
    EQUIPMENT_EFFECT_SIGNAL_KEY,
    normaliseEquipmentEffect(value),
    {
      ...options,
      eventType: EQUIPMENT_EVENT_TYPE
    }
  ) as EquipmentEffect;
}

export function resetPlayerStateSlice() {
  reactiveContext.setSignal(PLAYER_ROLES_SIGNAL_KEY, null);
  reactiveContext.setSignal(EQUIPMENT_EFFECT_SIGNAL_KEY, []);
}
