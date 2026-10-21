/**
 * WorldWriter —— 组件状态的唯一写入通道(docs/specs/agent-pal.md §6.1)。
 *
 * 规矩:
 *  - 写入只是写入。不在写入时同步回调任何订阅者(那会让一次写在别处触发连锁逻辑,顺序取决于订阅先后 ——
 *    #5 状态 Proxy 每回合多套一层就是这一类)。需要知道变化的一方自己读变更日志(changesSince)。
 *  - 存进去的是纯数据的深拷贝:不会存进代理、不会与调用方共用同一个对象,快照 / 哈希 / 回放因此可靠。
 *  - 每份状态只有一个来源:读取方不要另存副本(存档槽两份不同步、战败总读 1 号档就是反例)。
 *
 * 目前只服务等待栈(agent-pal-waits.md);后续 M2 的背包、旗标等迁进来时沿用同一套。
 */
import type { EntityRegistry } from './entity-registry.js';
import type { ComponentDef } from './component.js';

export type ChangeOp = 'set' | 'remove' | 'restore';

export interface Change {
  seq: number;
  op: ChangeOp;
  entity: number | null;
  component: string | null;
  /** set 时为写入后的值(深拷贝);remove / restore 为 null */
  value: unknown;
}

export interface Snapshot {
  version: 1;
  /** 组件名 → [实体, 值] 列表,按实体号排序 */
  components: Record<string, Array<[number, unknown]>>;
}

const WORLD_TAG = 'world';
const DEFAULT_JOURNAL_LIMIT = 2048;

/** 深拷贝成纯数据;遇到函数、Map/Set、代理等不可序列化的东西直接报错,而不是悄悄存进去 */
export function toPlain<T>(value: T, path = 'value'): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new Error(`WorldWriter: ${path} is not plain data (${typeof value})`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`WorldWriter: ${path} is not a finite number`);
    }
    return value;
  }
  if ((value as any).__raw__ !== undefined) {
    throw new Error(`WorldWriter: ${path} is a state proxy; write plain data`);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => toPlain(v, `${path}[${i}]`)) as unknown as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`WorldWriter: ${path} is not a plain object (${proto?.constructor?.name ?? 'unknown'})`);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = toPlain(v, `${path}.${key}`);
  }
  return out as T;
}

/** 键已排序的 JSON(toPlain 的输出对象键本就有序;数组保持原序) */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

/** FNV-1a 32 位 ×2(不同种子)拼成 16 位十六进制:不依赖 node:crypto,浏览器里也能用 */
/** 深冻结纯数据(存进 registry 的组件值;peek 直接交出去,调用方改不了) */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export function hashString(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export class WorldWriter {
  private readonly registry: EntityRegistry;
  private readonly journal: Change[] = [];
  private readonly journalLimit: number;
  private seq = 0;
  private readonly counters = new Map<string, number>();

  constructor(registry: EntityRegistry, options: { journalLimit?: number } = {}) {
    this.registry = registry;
    this.journalLimit = Math.max(16, options.journalLimit ?? DEFAULT_JOURNAL_LIMIT);
  }

  /** 世界单例实体(带 'world' 标签);registry.clear() 之后会重新建 */
  world(): number {
    const existing = this.registry.getEntitiesByTag(WORLD_TAG);
    if (existing.length > 0) {
      return existing[0];
    }
    return this.registry.createEntity({ tags: WORLD_TAG });
  }

  get<T>(entity: number, def: ComponentDef<T>): T | undefined {
    const value = this.registry.getComponent(entity, def.name);
    return value === undefined ? undefined : (toPlain(value) as T);
  }

  /** 取值,没有就返回默认值(不写入) */
  getOrCreate<T>(entity: number, def: ComponentDef<T>): T {
    return this.get(entity, def) ?? def.create();
  }

  set<T>(entity: number, def: ComponentDef<T>, value: T): T {
    if (def.validate) {
      def.validate(value);
    }
    const plain = deepFreeze(toPlain(value, def.name));
    this.registry.addComponent(entity, def.name, plain);
    this.record('set', entity, def.name, plain);
    return toPlain(plain);
  }

  /**
   * 只读视图:不拷贝,直接返回存着的值(写入时已深冻结,改它会抛错)。热路径读用它;要改请走 update / set。
   * 视图在下一次 set 之后就是旧值了 —— 需要最新值就再 peek 一次,别长期持有。
   */
  peek<T>(entity: number, def: ComponentDef<T>): Readonly<T> | undefined {
    return this.registry.getComponent(entity, def.name) as Readonly<T> | undefined;
  }

  /** 读-改-写:fn 拿到的是副本,返回新值 */
  update<T>(entity: number, def: ComponentDef<T>, fn: (current: T) => T): T {
    return this.set(entity, def, fn(this.getOrCreate(entity, def)));
  }

  remove<T>(entity: number, def: ComponentDef<T>): boolean {
    if (!this.registry.hasComponent(entity, def.name)) {
      return false;
    }
    this.registry.removeComponent(entity, def.name);
    this.record('remove', entity, def.name, null);
    return true;
  }

  /** 变更日志:seq 之后的所有变更(按发生顺序)。读取方自己记住看到哪了 */
  changesSince(seq: number): Change[] {
    return this.journal.filter((c) => c.seq > seq).map((c) => ({ ...c, value: toPlain(c.value) }));
  }

  /** 单调递增的编号(不随 registry.clear() 重置),如等待 token:清空后旧编号不会被重新发出 */
  nextId(key: string, atLeast = 1): number {
    const n = Math.max((this.counters.get(key) ?? 0) + 1, atLeast);
    this.counters.set(key, n);
    return n;
  }

  get lastSeq(): number {
    return this.seq;
  }

  /** 日志里最早还留着的 seq(更早的已被截断;读取方若落后于此,需要重新做一次全量快照) */
  get oldestSeq(): number {
    return this.journal.length ? this.journal[0].seq : this.seq + 1;
  }

  /** 指定组件的快照(纯数据,键有序,可直接 JSON 化 / 哈希) */
  snapshot(defs: ReadonlyArray<ComponentDef<unknown>>): Snapshot {
    const components: Snapshot['components'] = {};
    for (const def of [...defs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const rows: Array<[number, unknown]> = [];
      for (const entity of this.registry.iterateEntitiesWith(def.name).sort((a, b) => a - b)) {
        rows.push([entity, toPlain(this.registry.getComponent(entity, def.name))]);
      }
      components[def.name] = rows;
    }
    return { version: 1, components };
  }

  /** 用快照覆盖这些组件的全部值(快照里没有的实体上的该组件会被移除)。记一条 restore */
  restore(snapshot: Snapshot, defs: ReadonlyArray<ComponentDef<unknown>>): void {
    if (!snapshot || snapshot.version !== 1) {
      throw new Error('WorldWriter.restore: unsupported snapshot');
    }
    for (const def of defs) {
      for (const entity of this.registry.iterateEntitiesWith(def.name)) {
        this.registry.removeComponent(entity, def.name);
      }
      for (const [entity, value] of snapshot.components[def.name] ?? []) {
        if (!this.registry.hasEntity(entity)) {
          throw new Error(`WorldWriter.restore: entity ${entity} does not exist`);
        }
        if (def.validate) {
          def.validate(value);
        }
        this.registry.addComponent(entity, def.name, deepFreeze(toPlain(value, def.name)));
      }
    }
    this.record('restore', null, null, null);
  }

  hash(defs: ReadonlyArray<ComponentDef<unknown>>): string {
    return hashString(stableStringify(this.snapshot(defs)));
  }

  private record(op: ChangeOp, entity: number | null, component: string | null, value: unknown) {
    this.seq += 1;
    this.journal.push({ seq: this.seq, op, entity, component, value });
    if (this.journal.length > this.journalLimit) {
      this.journal.splice(0, this.journal.length - this.journalLimit);
    }
  }
}
