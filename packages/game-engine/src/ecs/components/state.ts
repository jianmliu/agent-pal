/**
 * M2 的世界状态组件清单 + 组件 → SDLPAL 存档字节的编码(docs/specs/agent-pal-m2.md §7 D5a)。
 *
 * - `STATE_COMPONENTS`:世界单例上的状态组件;事件对象(每个一个实体)另按下标收集,不随实体 id 变。
 * - `encodeSaveParts`:把这些组件编码成与 `_saveGame()` 同格式的各分区字节。D5a 用它做影子校验
 *   (每步与旧存档逐分区比,证明组件与旧结构一致);D5b 起存档直接用它。也是执行层配对存档包里
 *   世界那一半的来源(agent-pal.md §6.5)。
 */
import type { ComponentDef } from '../component';
import { InventoryComponent, type InventoryState } from './inventory';
import { StatusMatricesComponent, type StatusMatricesState } from './status';
import { PartyComponent, type PartyState } from './party';
import { PlayerRolesComponent, ExperienceComponent, EquipmentEffectComponent } from './roles';
import { SceneTableComponent, ObjectTableComponent } from './world-tables';

export const STATE_COMPONENTS: ReadonlyArray<ComponentDef<any>> = [
  InventoryComponent,
  StatusMatricesComponent,
  PartyComponent,
  PlayerRolesComponent,
  ExperienceComponent,
  EquipmentEffectComponent,
  SceneTableComponent,
  ObjectTableComponent
];

/** WORD 数组 → 小端字节,写进 size 字节的缓冲(多出来的补 0、少的截掉) */
export function wordsToBytes(words: ReadonlyArray<number>, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const n = Math.min(words.length, size >> 1);
  for (let i = 0; i < n; i++) {
    out[i * 2] = words[i] & 0xff;
    out[i * 2 + 1] = (words[i] >> 8) & 0xff;
  }
  return out;
}

function putWords(out: Uint8Array, at: number, values: number[]) {
  values.forEach((v, i) => {
    const w = v & 0xffff;
    out[at + i * 2] = w & 0xff;
    out[at + i * 2 + 1] = (w >> 8) & 0xff;
  });
}

export interface StateForSave {
  inventory?: Readonly<InventoryState>;
  status?: Readonly<StatusMatricesState>;
  party?: Readonly<PartyState>;
  roles?: { words: ReadonlyArray<number> };
  exp?: { words: ReadonlyArray<number> };
  scene?: { words: ReadonlyArray<number> };
  object?: { words: ReadonlyArray<number> };
  /** 按事件对象下标的 16 个 WORD */
  eventObjects?: ReadonlyArray<ReadonlyArray<number> | null | undefined>;
}

/**
 * 组件 → 各存档分区的字节。sizes 给出每个分区的字节数(取自 SaveData 的分区长度),只编码给了大小的分区。
 * 布局同 SDLPAL:INVENTORY(item WORD / amount USHORT / amountInUse SHORT)、POISONSTATUS[毒][队员]
 * (poisonID / poisonScript)、PARTY(playerRole / x / y / frame / imageOffset)、TRAIL(x / y / direction)。
 */
export function encodeSaveParts(
  state: StateForSave,
  sizes: Record<string, number>,
  layout: { poisonCols: number } = { poisonCols: 6 }       // MAX_PLAYABLE_PLAYER_ROLES
): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  if (sizes.inventory != null && state.inventory) {
    const out = new Uint8Array(sizes.inventory);
    state.inventory.slots.forEach((s, i) => { if ((i + 1) * 6 <= out.length) putWords(out, i * 6, [s.item, s.amount, s.amountInUse]); });
    parts.inventory = out;
  }
  if (sizes.poisonStatus != null && state.status) {
    const out = new Uint8Array(sizes.poisonStatus);
    const rows = state.status.poison;
    const cols = layout.poisonCols;
    rows.forEach((row, i) => row && row.forEach((e, j) => {
      const at = (i * cols + j) * 4;
      if (e && j < cols && at + 4 <= out.length) putWords(out, at, [e.poisonID, e.poisonScript]);
    }));
    parts.poisonStatus = out;
  }
  if (sizes.party != null && state.party) {
    const out = new Uint8Array(sizes.party);
    state.party.members.forEach((m, i) => { if (m && (i + 1) * 10 <= out.length) putWords(out, i * 10, [m.playerRole, m.x, m.y, m.frame, m.imageOffset]); });
    parts.party = out;
  }
  if (sizes.trail != null && state.party) {
    const out = new Uint8Array(sizes.trail);
    state.party.trail.forEach((t, i) => { if (t && (i + 1) * 6 <= out.length) putWords(out, i * 6, [t.x, t.y, t.direction]); });
    parts.trail = out;
  }
  if (sizes.playerRoles != null && state.roles) parts.playerRoles = wordsToBytes(state.roles.words, sizes.playerRoles);
  if (sizes.exp != null && state.exp) parts.exp = wordsToBytes(state.exp.words, sizes.exp);
  if (sizes.scene != null && state.scene) parts.scene = wordsToBytes(state.scene.words, sizes.scene);
  if (sizes.object != null && state.object) parts.object = wordsToBytes(state.object.words, sizes.object);
  if (sizes.eventObject != null && state.eventObjects) {
    const out = new Uint8Array(sizes.eventObject);
    state.eventObjects.forEach((w, i) => { if (w && (i + 1) * 32 <= out.length) out.set(wordsToBytes(w, 32), i * 32); });
    parts.eventObject = out;
  }
  return parts;
}
