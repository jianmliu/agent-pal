/**
 * PLAYERROLES 的字段号 → 具名数组(SDLPAL 布局:每个字段是 WORD[MAX_PLAYER_ROLES],按下列顺序排)。
 *
 * 脚本指令按字段号读写角色属性(0x0019 增减、0x001A 设定、0x0030 临时百分比加成,以及 PAL_PlayerLevelUp)。
 * 引擎里的角色数据是按名字分开的数组(js/pal/pal-global.ts 的 PlayerRoles 结构),没有原始字节缓冲区 ——
 * 之前按偏移去读一块不存在的缓冲区,读到 null、写了也不生效:升级不涨级、加属性的物品 / 剧情无效。
 * 这里按同一个结构的字段顺序把字段号映射到 [名字, 子下标](子下标 -1 = 一维;装备 / 抗性 / 仙术是二维)。
 */
const MAX_PLAYER_EQUIPMENTS = 6;
const NUM_MAGIC_ELEMENTAL = 5;
const MAX_PLAYER_MAGICS = 32;

export const PLAYER_ROLE_FIELDS: ReadonlyArray<readonly [string, number]> = (() => {
  const list: Array<readonly [string, number]> = [];
  const one = (name: string) => list.push([name, -1] as const);
  const many = (name: string, n: number) => { for (let i = 0; i < n; i++) list.push([name, i] as const); };
  ['avatar', 'spriteNumInBattle', 'spriteNum', 'name', 'attackAll', 'unknown1', 'level', 'maxHP', 'maxMP', 'HP', 'MP'].forEach(one);
  many('equipment', MAX_PLAYER_EQUIPMENTS);
  ['attackStrength', 'magicStrength', 'defense', 'dexterity', 'fleeRate', 'poisonResistance'].forEach(one);
  many('elementalResistance', NUM_MAGIC_ELEMENTAL);
  ['unknownWORD', 'unknown3', 'unknown4', 'coveredBy'].forEach(one);
  many('magic', MAX_PLAYER_MAGICS);
  ['walkFrames', 'cooperativeMagic', 'unknown5', 'unknown6', 'deathSound', 'attackSound', 'weaponSound',
    'criticalSound', 'magicSound', 'coverSound', 'dyingSound'].forEach(one);
  return list;
})();

/** 角色数据里某字段号对应的那一列(按角色下标取值);找不到返回 null */
export function playerRoleColumn(roles: any, fieldIndex: number): any[] | null {
  const ref = PLAYER_ROLE_FIELDS[fieldIndex];
  if (!ref || !roles) return null;
  const [name, sub] = ref;
  const col = sub < 0 ? roles[name] : roles[name]?.[sub];
  return col && typeof col.length === 'number' ? col : null;
}
