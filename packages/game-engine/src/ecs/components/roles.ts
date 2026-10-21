/**
 * 角色数值 / 经验 / 装备加成组件(docs/specs/agent-pal-m2.md D3)。
 *
 * SDLPAL 里这三样本来就是纯 WORD 数组:PLAYERROLES(75 个字段 × MAX_PLAYER_ROLES)、ALLEXPERIENCE(8 类 ×
 * 角色 × 4 个 WORD)、rgEquipmentEffect(MAX_PLAYER_EQUIPMENTS + 1 张 PLAYERROLES)。组件就存这串字(小端,
 * 与存档字节一一对应),字段按 services/player-role-fields.ts 的 SDLPAL 下标取。
 *
 * D3 是「写穿」:GameData.playerRoles / Global.exp / Global.equipmentEffect 这几个活结构体仍是写口回调的
 * 工作区(回调里会经 getPlayerRoles() 重新读写活结构体,独立草稿会丢写入),每个写口结束时把字节抓进组件、
 * 记变更日志。组件与活结构体在写口边界逐字节一致;倒过来(组件为真、活结构体做投影)在读口迁走后(D5)。
 */
import { defineComponent } from '../component';

export interface WordsState { words: number[] }
export interface EquipmentEffectState { tables: number[][] }

const validateWords = (name: string) => (value: unknown) => {
  const v = value as WordsState;
  if (!v || !Array.isArray(v.words) || v.words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) {
    throw new Error(`${name}: words must be WORDs`);
  }
};

export const PlayerRolesComponent = defineComponent<WordsState>('PlayerRoles', {
  create: () => ({ words: [] }),
  validate: validateWords('PlayerRoles')
});

export const ExperienceComponent = defineComponent<WordsState>('Experience', {
  create: () => ({ words: [] }),
  validate: validateWords('Experience')
});

export const EquipmentEffectComponent = defineComponent<EquipmentEffectState>('EquipmentEffect', {
  create: () => ({ tables: [] }),
  validate(value: unknown) {
    const v = value as EquipmentEffectState;
    if (!v || !Array.isArray(v.tables)) throw new Error('EquipmentEffect: bad shape');
    for (const t of v.tables) validateWords('EquipmentEffect')({ words: t });
  }
});

/** 结构体字节 → WORD 数组(小端);没有字节的返回 null */
export function wordsOf(struct: any): number[] | null {
  const bytes: unknown = struct && struct.uint8Array;
  if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) return null;
  const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes as number[]);
  const out = new Array(u8.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = u8[i * 2] | (u8[i * 2 + 1] << 8);
  return out;
}

export const sameWords = (a: number[] | undefined, b: number[] | null): boolean =>
  !!a && !!b && a.length === b.length && a.every((w, i) => w === b[i]);

/** 组件里某个 PLAYERROLES 字段(SDLPAL 下标)某个角色的值 */
export const roleWord = (words: number[], fieldIndex: number, roleId: number, roles: number): number =>
  words[fieldIndex * roles + roleId] ?? 0;
