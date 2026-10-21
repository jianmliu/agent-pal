/**
 * 事件对象 / 场景条目 / 物件条目组件(docs/specs/agent-pal-m2.md D4)。
 *
 * 存 SDLPAL 原样的 WORD:EVENTOBJECT 16 个字(每个事件对象一个实体)、SCENE 4 个字 × 300、OBJECT 6 个字 × 600
 * (整表挂世界单例)。与存档字节一一对应。
 *
 * D4 是「写穿 + 帧边界捕获」:GameData.eventObject / scene / object 的活结构体仍是工作区 —— 渲染、碰撞、主循环、
 * script-runner、引用租约都持有活引用,script-runner 还有 29 处直接改字段(多在条件表达式里)。写口结束时抓
 * 本次写到的条目;每帧结束时把事件对象表与上一帧的字节快照逐字节比较,只把变了的写进组件。不发事件、不改流程,
 * 组件在帧 / 写口边界与活结构体逐字一致;等 M4 指令直接写组件后,这层捕获自然退场。
 */
import { defineComponent } from '../component';

export interface WordsState { words: number[] }

const wordsValidator = (name: string, size?: number) => (value: unknown) => {
  const v = value as WordsState;
  if (!v || !Array.isArray(v.words) || (size != null && v.words.length !== size) ||
      v.words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) {
    throw new Error(`${name}: bad words`);
  }
};

export const EVENT_OBJECT_WORDS = 16;
export const SCENE_WORDS = 4;
export const OBJECT_WORDS = 6;

/** 一个事件对象(挂在 world-service 的事件对象实体上) */
export const EventObjectComponent = defineComponent<WordsState>('EventObject.words', {
  create: () => ({ words: new Array(EVENT_OBJECT_WORDS).fill(0) }),
  validate: wordsValidator('EventObject.words', EVENT_OBJECT_WORDS)
});

export const SceneTableComponent = defineComponent<WordsState>('SceneTable', {
  create: () => ({ words: [] }),
  validate: wordsValidator('SceneTable')
});

export const ObjectTableComponent = defineComponent<WordsState>('ObjectTable', {
  create: () => ({ words: [] }),
  validate: wordsValidator('ObjectTable')
});

/** EVENTOBJECT 字段顺序(没有字节的条目按字段编码;SHORT 字段也按 16 位存) */
export const EVENT_OBJECT_FIELDS = [
  'vanishTime', 'x', 'y', 'layer', 'triggerScript', 'autoScript', 'state', 'triggerMode',
  'spriteNum', 'spriteFrames', 'direction', 'currentFrameNum', 'scriptIdleFrame', 'spritePtrOffset',
  'spriteFramesAuto', 'scriptIdleFrameCountAuto'
] as const;
export const SCENE_FIELDS = ['mapNum', 'scriptOnEnter', 'scriptOnTeleport', 'eventObjectIndex'] as const;

/** 一条记录的字节(有 uint8Array 用字节,否则按字段 / data 编码);返回长度 = words × 2 */
export function recordBytes(entry: any, words: number, fields?: readonly string[]): Uint8Array {
  const out = new Uint8Array(words * 2);
  if (!entry) return out;
  const own: unknown = entry.uint8Array;
  if (own instanceof Uint8Array && own.length >= out.length) {
    out.set(own.subarray(0, out.length));
    return out;
  }
  const dv = new DataView(out.buffer);
  if (fields) {
    fields.forEach((f, i) => dv.setUint16(i * 2, Number(entry[f]) & 0xffff, true));
  } else if (entry.data && typeof entry.data.length === 'number') {
    for (let i = 0; i < words; i++) dv.setUint16(i * 2, Number(entry.data[i]) & 0xffff, true);
  }
  return out;
}

export function bytesToWords(bytes: Uint8Array): number[] {
  const out = new Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  return out;
}

/** 整张表的字节(逐条拼接) */
export function tableBytes(table: any, words: number, fields?: readonly string[]): Uint8Array {
  const list = Array.isArray(table) ? table : [];
  const out = new Uint8Array(list.length * words * 2);
  list.forEach((entry: any, i: number) => out.set(recordBytes(entry, words, fields), i * words * 2));
  return out;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array, from = 0, to = a.length): boolean => {
  if (a.length !== b.length) return false;
  for (let i = from; i < to; i++) if (a[i] !== b[i]) return false;
  return true;
};
