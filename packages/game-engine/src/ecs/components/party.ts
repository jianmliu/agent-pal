/**
 * 队伍 / 尾迹组件(docs/specs/agent-pal-m2.md D2c)。
 *
 * 真相源:世界单例实体上的 Party 组件,写入只经 WorldWriter。
 * `Global.party` / `Global.trail` / `Global.maxPartyMemberIndex` / `Global.numFollower`、对应切片、
 *
 * 数值语义跟 SDLPAL 结构一致:PARTY = WORD playerRole、SHORT x / y、WORD frame / imageOffset;
 * TRAIL = WORD x / y / direction。修改回调拿到的草稿按字段宽度截断,与旧的结构体相同。
 */
import { defineComponent } from '../component';
import { toWord, toShort } from './inventory';

export interface PartyMemberState { playerRole: number; x: number; y: number; frame: number; imageOffset: number }
export interface TrailEntryState { x: number; y: number; direction: number }

export interface PartyState {
  members: Array<PartyMemberState | null>;
  trail: Array<TrailEntryState | null>;
  /** Global.maxPartyMemberIndex(WORD) */
  maxIndex: number;
  /** Global.numFollower */
  followers: number;
}

export const PartyComponent = defineComponent<PartyState>('Party', {
  create: () => ({ members: [], trail: [], maxIndex: 0, followers: 0 }),
  validate(value: unknown) {
    const v = value as PartyState;
    if (!v || !Array.isArray(v.members) || !Array.isArray(v.trail) || !Number.isInteger(v.maxIndex) || !Number.isInteger(v.followers)) {
      throw new Error('Party: bad shape');
    }
  }
});

export function fitMember(m: any): PartyMemberState | null {
  if (m == null) return null;
  return { playerRole: toWord(m.playerRole), x: toShort(m.x), y: toShort(m.y), frame: toWord(m.frame), imageOffset: toWord(m.imageOffset) };
}

export function fitTrail(t: any): TrailEntryState | null {
  if (t == null) return null;
  return { x: toWord(t.x), y: toWord(t.y), direction: toWord(t.direction) };
}

export class MemberDraft implements PartyMemberState {
  private v: PartyMemberState;
  constructor(m: PartyMemberState) { this.v = { ...m }; }
  get playerRole() { return this.v.playerRole; }
  set playerRole(x: number) { this.v.playerRole = toWord(x); }
  get x() { return this.v.x; }
  set x(n: number) { this.v.x = toShort(n); }
  get y() { return this.v.y; }
  set y(n: number) { this.v.y = toShort(n); }
  get frame() { return this.v.frame; }
  set frame(n: number) { this.v.frame = toWord(n); }
  get imageOffset() { return this.v.imageOffset; }
  set imageOffset(n: number) { this.v.imageOffset = toWord(n); }
}

export class TrailDraft implements TrailEntryState {
  private v: TrailEntryState;
  constructor(t: TrailEntryState) { this.v = { ...t }; }
  get x() { return this.v.x; }
  set x(n: number) { this.v.x = toWord(n); }
  get y() { return this.v.y; }
  set y(n: number) { this.v.y = toWord(n); }
  get direction() { return this.v.direction; }
  set direction(n: number) { this.v.direction = toWord(n); }
}

export const sameRecords = (a: unknown[], b: unknown[], keys: string[]): boolean =>
  a.length === b.length && a.every((x: any, i) => {
    const y: any = b[i];
    if (x == null || y == null) return x == y;
    return keys.every((k) => x[k] === y[k]);
  });

export const MEMBER_KEYS = ['playerRole', 'x', 'y', 'frame', 'imageOffset'];
export const TRAIL_KEYS = ['x', 'y', 'direction'];
