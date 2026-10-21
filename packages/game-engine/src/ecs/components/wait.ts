/**
 * 等待栈 —— 引擎显式声明「我在等玩家做什么」(docs/specs/agent-pal-waits.md)。
 *
 * 挂在世界单例实体上,只经 WorldWriter 读写。菜单可嵌套,所以是栈;栈顶是当前要回应的那个。
 * 每次进入等待发一个新 token:回应必须带 token,过期的回应被拒绝(发送 ≠ 接受)。
 * 载荷字段名对齐线协议 v0(packages/agent-pal-protocol 的 SMSG_DIALOG / SMSG_CHOICE / SMSG_BATTLE_PROMPT),
 * agent 侧(W3)可以直接映射。
 *
 * W1 只定义类型与栈操作;W2 由引擎各等待点写入,W4 接上 respond / takeResponse。
 */
import { defineComponent } from '../component.js';
import type { WorldWriter } from '../world-writer.js';

export type WaitKind =
  | 'control'          // 队伍可行走(主循环)
  | 'dialog'           // 对白等推进
  | 'menu.list'        // ui.readMenu:标题、系统菜单、存档栏、是/否、商店「买」
  | 'menu.items'       // itemmenu:物品格
  | 'menu.magic'       // magicmenu:仙术格
  | 'menu.party'       // uigame:选人(用物品 / 施法目标 / 装备对象)
  | 'menu.screen'      // 只读界面(状态页等)
  | 'battle.command'   // 战斗中某个队员等指令
  | 'anykey';          // 任意键(结局、脚本 0x004D)

/** 同协议 ChoiceItem,多一个 value(引擎内部的选项值,如物品号) */
export interface WaitChoiceItem {
  label: string;
  enabled: boolean;
  value?: number;
  amount?: number;
  price?: number;
}

/** 菜单类载荷的公共部分。indexTracked=false:光标是引擎局部变量、读不到(W4 改造该循环后补上) */
interface MenuBase { title: string | null; items: WaitChoiceItem[]; index: number; indexTracked?: boolean; cancelable: boolean; context?: string }

export interface WaitPayloads {
  control: { scene: number; x: number; y: number; direction: number };
  dialog: { speaker: string | null; text: string; last?: boolean };
  'menu.list': MenuBase;
  'menu.items': MenuBase & { columns: number; purpose: 'use' | 'throw' | 'sell' | 'equip' | 'other' };
  'menu.magic': MenuBase & { columns: number; caster: number };
  'menu.party': MenuBase;
  'menu.screen': { title: string | null; context?: string };
  /** stage:action = 主菜单选动作;target-enemy / target-player = 选目标;misc = 「其他」子菜单 */
  'battle.command': {
    member: number;
    role: number;
    stage: 'action' | 'target-enemy' | 'target-player' | 'misc';
    actions: string[];
    enemies: Array<{ index: number; name: string; hp: number }>;
    lastTarget: number | null;
    selectedIndex: number | null;
  };
  /** timeoutMs:到时自动继续(如战斗结算画面 3s);null = 一直等 */
  anykey: { timeoutMs: number | null };
}

/** 回应(W4):与按键共用同一段处理代码 */
export type WaitResponse =
  | { advance: true }
  | { choose: number }
  | { cancel: true }
  | { battle: { action: string; target?: number | null; magic?: number | null; item?: number | null } };

export interface WaitFrame<K extends WaitKind = WaitKind> {
  token: number;
  kind: K;
  payload: WaitPayloads[K];
  /** 进入等待时的帧号(由调用方传入;用于诊断「等了多久」) */
  since: number;
  /** 待处理的回应(W4 用);引擎等待循环每帧取走 */
  response: WaitResponse | null;
}

export interface WaitStack {
  frames: WaitFrame[];
  nextToken: number;
}

const KINDS: ReadonlySet<string> = new Set<WaitKind>([
  'control', 'dialog', 'menu.list', 'menu.items', 'menu.magic', 'menu.party', 'menu.screen', 'battle.command', 'anykey'
]);

export const WaitStackComponent = defineComponent<WaitStack>('WaitStack', {
  create: () => ({ frames: [], nextToken: 1 }),
  validate(value: unknown) {
    const v = value as WaitStack;
    if (!v || !Array.isArray(v.frames) || !Number.isInteger(v.nextToken) || v.nextToken < 1) {
      throw new Error('WaitStack: bad shape');
    }
    const seen = new Set<number>();
    for (const f of v.frames) {
      if (!KINDS.has(f.kind)) throw new Error(`WaitStack: unknown kind ${String(f.kind)}`);
      if (!Number.isInteger(f.token) || f.token < 1 || f.token >= v.nextToken) throw new Error(`WaitStack: bad token ${f.token}`);
      if (seen.has(f.token)) throw new Error(`WaitStack: duplicate token ${f.token}`);
      seen.add(f.token);
    }
  }
});

/** 等待栈的读写操作。全部经 WorldWriter,数据存在世界单例实体上 */
export function waitStack(writer: WorldWriter) {
  const read = (): WaitStack => writer.getOrCreate(writer.world(), WaitStackComponent);
  const write = (fn: (s: WaitStack) => WaitStack) => writer.update(writer.world(), WaitStackComponent, fn);
  const top = (): WaitFrame | null => {
    const frames = read().frames;
    return frames.length ? frames[frames.length - 1] : null;
  };

  return {
    /** 进入等待,返回新 token */
    push<K extends WaitKind>(kind: K, payload: WaitPayloads[K], since = 0): number {
      // token 取自 WorldWriter 的单调计数:registry.clear() 重建等待栈后也不会重发旧 token
      const token = writer.nextId('waitToken', read().nextToken);
      write((s) => ({ nextToken: token + 1, frames: [...s.frames, { token, kind, payload, since, response: null } as WaitFrame] }));
      return token;
    },

    /** 更新载荷(如菜单光标移动);token 不在栈里返回 false */
    update<K extends WaitKind>(token: number, patch: Partial<WaitPayloads[K]>): boolean {
      if (!read().frames.some((f) => f.token === token)) return false;
      write((s) => ({ ...s, frames: s.frames.map((f) => (f.token === token ? { ...f, payload: { ...f.payload, ...patch } } as WaitFrame : f)) }));
      return true;
    },

    /**
     * 离开等待。正常是弹栈顶;若 token 不在栈顶(内层没正常退出),连同其上的帧一起弹掉,
     * 保证栈与实际调用嵌套一致。token 不在栈里返回 false。
     */
    pop(token: number): boolean {
      const s = read();
      const i = s.frames.findIndex((f) => f.token === token);
      if (i < 0) return false;
      write((cur) => ({ ...cur, frames: cur.frames.slice(0, i) }));
      return true;
    },

    top,

    depth(): number {
      return read().frames.length;
    },

    /** 回应栈顶等待(W4)。token 必须是当前栈顶,否则拒绝(过期或越级的回应) */
    respond(token: number, response: WaitResponse): { ok: true } | { ok: false; reason: 'stale' | 'busy' } {
      const current = top();
      if (!current || current.token !== token) return { ok: false, reason: 'stale' };
      if (current.response) return { ok: false, reason: 'busy' };
      write((s) => ({ ...s, frames: s.frames.map((f) => (f.token === token ? { ...f, response } : f)) }));
      return { ok: true };
    },

    /** 引擎等待循环取走自己的回应(W4);没有返回 null */
    takeResponse(token: number): WaitResponse | null {
      const frame = read().frames.find((f) => f.token === token);
      if (!frame || !frame.response) return null;
      const response = frame.response;
      write((s) => ({ ...s, frames: s.frames.map((f) => (f.token === token ? { ...f, response: null } : f)) }));
      return response;
    },

    /** 清空(新游戏 / 读档时);token 计数不回退,避免旧回应撞上新等待 */
    clear(): void {
      write((s) => ({ ...s, frames: [] }));
    }
  };
}
