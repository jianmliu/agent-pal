/**
 * 战斗快照(docs/specs/agent-pal-m5.md B1):把战斗状态里**可序列化的部分**抽成纯数据 —— 战斗者数值字段、
 * 行动队列、阶段、结果、经验 / 钱、各标志、界面标量。不含精灵 / 画面 / 场景缓冲,也不含动画里的生成器栈
 * (那些不可序列化,M5b 的恢复点因此只放在回合边界)。
 *
 * 纯读:不改战斗状态。用于 golden 每步的战斗哈希、配对存档包的战斗那一半(M5b),以及以后的原生战斗事件(B3)。
 * 结构体(敌人模板 `e`、中毒条目)按字节记成 WORD 数组;类型化数组记成普通数组。
 */
import { hashString, stableStringify } from '../ecs/world-writer.js';

/** 顶层只取这些字段;sceneBuf / background / effectSprite / summonSprite 等资源对象不进快照 */
const BATTLE_FIELDS = [
  'maxEnemyIndex', 'backgroundColorShift', 'summonPos', 'summonFrame', 'expGained', 'cashGained', 'isBoss',
  'enemyCleared', 'battleResult', 'coopContributors', 'thisTurnCoop', 'enemyMoving', 'hidingTime',
  'movingPlayerIndex', 'blow', 'phase', 'curAction', 'repeat', 'force', 'flee'
] as const;
const PLAYER_FIELDS = [
  'colorShift', 'timeMeter', 'timeSpeedModifier', 'hidingTime', 'pos', 'originalPos', 'currentFrame', 'state',
  'action', 'defending', 'secondAttack', 'prevHP', 'prevMP'
] as const;
const ENEMY_FIELDS = [
  'objectID', 'e', 'status', 'timeMeter', 'poisons', 'pos', 'originalPos', 'currentFrame', 'state', 'turnStart',
  'firstMoveDone', 'dualMove', 'scriptOnTurnStart', 'scriptOnBattleEnd', 'scriptOnReady', 'prevHP', 'colorShift'
] as const;
const ACTION_QUEUE_FIELDS = ['isEnemy', 'dexterity', 'index'] as const;
const UI_FIELDS = [
  'state', 'menuState', 'curPlayerIndex', 'selectedAction', 'prevEnemyTarget', 'actionType', 'objectID',
  'autoAttack', 'selectedIndex', 'msgShowTime', 'nextMsgDuration'
] as const;

export type BattleSnapshot = Record<string, unknown> & { version: 1 };

/** 任意值 → 纯数据:数字 / 布尔 / 字符串原样;字节结构体记 WORD 数组;类型化数组记普通数组;函数与资源对象丢掉 */
function plain(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value ?? null;
  }
  if (depth > 6 || typeof value === 'function') return null;
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  const bytes = (value as { uint8Array?: unknown }).uint8Array;
  if (bytes instanceof Uint8Array) {
    const words = new Array(bytes.length >> 1);
    for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    return { words };
  }
  if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null && !isDataObject(value)) return null;   // 精灵等资源对象
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = plain((value as Record<string, unknown>)[k], depth + 1);
      // 敌人模板等是结构体的拷贝,自有属性是访问器缓存 `_health_value`:记成公开字段名 `health`
      if (v !== null || (value as Record<string, unknown>)[k] === null) out[k.replace(/^_(.+)_value$/, '$1')] = v;
    }
    return out;
  }
  return null;
}

/** 战斗里自定义构造的数据对象(BattleAction 之类):自有属性全是数据 */
function isDataObject(value: object): boolean {
  return Object.keys(value).every((k) => {
    const v = (value as Record<string, unknown>)[k];
    return v == null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string';
  });
}

function pick(src: any, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!src) return out;
  for (const f of fields) if (f in src) out[f] = plain(src[f]);
  return out;
}

/** 战斗状态 → 快照;不在战斗里(没有状态)返回 null */
export function battleSnapshot(state: any): BattleSnapshot | null {
  if (!state || typeof state !== 'object') return null;
  const players = Array.isArray(state.player) ? state.player : [];
  const enemies = Array.isArray(state.enemy) ? state.enemy : [];
  const queue = Array.isArray(state.actionQueue) ? state.actionQueue : [];
  return {
    version: 1,
    ...pick(state, BATTLE_FIELDS),
    player: players.map((p: any) => pick(p, PLAYER_FIELDS)),
    enemy: enemies.map((e: any) => pick(e, ENEMY_FIELDS)),
    actionQueue: queue.map((q: any) => pick(q, ACTION_QUEUE_FIELDS)),
    UI: pick(state.UI, UI_FIELDS)
  };
}

export function battleStateHash(state: any): string | null {
  const snap = battleSnapshot(state);
  return snap ? hashString(stableStringify(snap)) : null;
}
