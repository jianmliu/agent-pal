/**
 * 状态矩阵 / 中毒矩阵组件(docs/specs/agent-pal-m2.md D2a)。
 *
 * 真相源:世界单例实体上的 StatusMatrices 组件,写入只经 WorldWriter。
 * 状态切片、`Global.playerStatus`、`Global.poisonStatus`、中毒切片降为投影(world-service 单向写入)。
 *
 * 行的形态照旧保留(#63 的兼容约束):普通数字数组;或类型化行 `{ uint8Array }`(组件里记成 `{ u8: number[] }`,
 * 投影时还原,数值按 Uint8 截断);其余对象行记成 `{ obj }`。中毒条目是 SDLPAL POISONSTATUS(两个 WORD),
 * 修改回调拿到的草稿按 WORD 截断,与旧的结构体一致。
 */
import { defineComponent } from '../component';
import { toWord } from './inventory';

/** 普通行里 null 表示空洞:旧矩阵的行是稀疏数组(没设过的状态是 undefined,不是 0),投影时还原成空洞 */
export type StatusRow = Array<number | null> | { u8: number[] } | { obj: Record<string, number> } | null;
export interface PoisonEntry { poisonID: number; poisonScript: number }
export type PoisonRow = Array<PoisonEntry | null> | null;

export interface StatusMatricesState {
  status: StatusRow[];
  poison: PoisonRow[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const StatusMatricesComponent = defineComponent<StatusMatricesState>('StatusMatrices', {
  create: () => ({ status: [], poison: [] }),
  validate(value: unknown) {
    const v = value as StatusMatricesState;
    if (!v || !Array.isArray(v.status) || !Array.isArray(v.poison)) throw new Error('StatusMatrices: bad shape');
  }
});

// ---- 状态行:旧形态 ↔ 纯数据 -------------------------------------------------------
export function statusRowToPlain(row: unknown): StatusRow {
  if (row == null) return null;
  if (Array.isArray(row)) return Array.from(row, (v) => (v === undefined ? null : num(v)));
  const typed = row as { uint8Array?: Uint8Array };
  if (typed.uint8Array) return { u8: Array.from(typed.uint8Array) };
  if (typeof row === 'object') {
    const obj: Record<string, number> = {};
    for (const k of Object.keys(row as object)) obj[k] = num((row as Record<string, unknown>)[k]);
    return { obj };
  }
  return null;
}

export function statusRowFromPlain(row: StatusRow): any {
  if (row == null) return row;
  if (Array.isArray(row)) {
    const out: number[] = new Array(row.length);
    row.forEach((v, i) => { if (v !== null) out[i] = v; });
    return out;
  }
  if ('u8' in row) return { uint8Array: Uint8Array.from(row.u8) };
  return { ...row.obj };
}

export const statusToPlain = (matrix: unknown): StatusRow[] => (Array.isArray(matrix) ? matrix.map(statusRowToPlain) : []);
export const statusFromPlain = (rows: StatusRow[]): any[] => rows.map(statusRowFromPlain);

// ---- 中毒:旧形态(结构体 / 普通对象)↔ 纯数据 ----------------------------------------
export function poisonEntryToPlain(e: any): PoisonEntry | null {
  if (e == null) return null;
  return { poisonID: toWord(e.poisonID), poisonScript: toWord(e.poisonScript) };
}

export function poisonToPlain(matrix: unknown): PoisonRow[] {
  if (!Array.isArray(matrix)) return [];
  return matrix.map((row) => (Array.isArray(row) ? row.map(poisonEntryToPlain) : null));
}

/** 修改回调用的草稿条目:字段写入按 WORD 截断 */
export class PoisonDraft implements PoisonEntry {
  private _id: number;
  private _script: number;
  constructor(e: PoisonEntry) {
    this._id = e.poisonID;
    this._script = e.poisonScript;
  }
  get poisonID() { return this._id; }
  set poisonID(v: number) { this._id = toWord(v); }
  get poisonScript() { return this._script; }
  set poisonScript(v: number) { this._script = toWord(v); }
}

export const poisonDraft = (rows: PoisonRow[]): any[] =>
  rows.map((row) => (row ? row.map((e) => (e ? new PoisonDraft(e) : e)) : row));
