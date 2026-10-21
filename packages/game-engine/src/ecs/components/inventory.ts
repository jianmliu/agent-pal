/**
 * 背包 / 钱 / 背包光标组件(docs/specs/agent-pal-m2.md D1)。
 *
 * 真相源:世界单例实体上的 Inventory 组件,写入只经 WorldWriter。
 * `Global.inventory` / `Global.cash` / `Global.curInvMenuItem` 与 RxJS 切片降为投影(world-service 单向写入)。
 *
 * 数值语义跟 SDLPAL 的字节结构一致:槽位字段写入即按宽度截断(item / amount 为 WORD / USHORT,
 * amountInUse 为 SHORT)。修改回调拿到的草稿槽位用访问器模拟这一点 —— 同一个回调里先减后判断
 * (如 amount 减到 0 以下)看到的值与旧的结构体完全相同。
 * 钱沿用旧的真相源(切片)语义:整数、不截断;写进存档 DWORD 时才回绕。
 */
import { defineComponent } from '../component';

export interface InventorySlot {
  item: number;
  amount: number;
  amountInUse: number;
}

export interface InventoryState {
  slots: InventorySlot[];
  cash: number;
  menuIndex: number;
}

export const toWord = (v: unknown): number => (Number(v) & 0xffff);
export const toShort = (v: unknown): number => ((Number(v) << 16) >> 16);
/** 钱与背包光标沿用旧写口的规范化:有限数取整、不截断宽度(写进结构体时才回绕) */
export const toTrunc = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
export const toCash = toTrunc;

export const emptySlot = (): InventorySlot => ({ item: 0, amount: 0, amountInUse: 0 });

/** 任意来源(结构体 / 草稿 / 普通对象)→ 规范化的纯数据槽位 */
export function fitSlot(s: any): InventorySlot {
  if (!s) return emptySlot();
  return { item: toWord(s.item), amount: toWord(s.amount), amountInUse: toShort(s.amountInUse) };
}

export const InventoryComponent = defineComponent<InventoryState>('Inventory', {
  create: () => ({ slots: [], cash: 0, menuIndex: 0 }),
  validate(value: unknown) {
    const v = value as InventoryState;
    if (!v || !Array.isArray(v.slots) || !Number.isInteger(v.cash) || !Number.isInteger(v.menuIndex)) {
      throw new Error('Inventory: bad shape');
    }
    for (const s of v.slots) {
      if (!s || s.item !== toWord(s.item) || s.amount !== toWord(s.amount) || s.amountInUse !== toShort(s.amountInUse)) {
        throw new Error(`Inventory: slot out of range ${JSON.stringify(s)}`);
      }
    }
  }
});

/** 逐字段比较(组件值经 toPlain 后键序可能变,不能用 JSON 字符串比) */
export function sameSlots(a: InventorySlot[], b: InventorySlot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].item !== b[i].item || a[i].amount !== b[i].amount || a[i].amountInUse !== b[i].amountInUse) return false;
  }
  return true;
}

/** 修改回调用的草稿槽位:字段写入时按结构体宽度截断 */
export class SlotDraft implements InventorySlot {
  private _item: number;
  private _amount: number;
  private _inUse: number;
  constructor(s: InventorySlot) {
    this._item = s.item;
    this._amount = s.amount;
    this._inUse = s.amountInUse;
  }
  get item() { return this._item; }
  set item(v: number) { this._item = toWord(v); }
  get amount() { return this._amount; }
  set amount(v: number) { this._amount = toWord(v); }
  get amountInUse() { return this._inUse; }
  set amountInUse(v: number) { this._inUse = toShort(v); }
}

/** 草稿数组(回调可原地改、可整体替换、可在空位放普通对象)→ 定长的规范槽位 */
export function slotsFromDraft(draft: unknown, capacity: number): InventorySlot[] {
  const list = Array.isArray(draft) ? draft : [];
  const out: InventorySlot[] = [];
  for (let i = 0; i < capacity; i++) out.push(fitSlot(list[i]));
  return out;
}
