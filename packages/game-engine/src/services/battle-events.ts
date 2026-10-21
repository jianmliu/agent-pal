/**
 * 战斗事件日志(docs/specs/agent-pal-m5.md B3):引擎在战斗的三个位置记事件 —— 开战、每帧之后、结束 ——
 * 协议层(agent-pal 的 L0)按 seq 取走,原样排成 SMSG_BATTLE_START / EVENT / PROMPT / END。
 *
 * 为什么不让协议层自己轮询求差:一条指令里可能打完一整回合甚至连打两场,指令前后各读一次快照,中间的
 * 血量变化(复活后又被打倒)、轮到谁、「打完立刻又开一场」都被压成一次差分。这里按帧记,不丢。
 *
 * 每个事件带 `battle`:战斗实例编号(本次运行内从 1 递增,每次开战加一)。连打两场时订阅方据此分清事件属于哪一场,
 * 不把上一场的提示当成这一场的。
 *
 * 纯记录:只读战斗状态,不抽随机数、不改时序、不改任何游戏状态。
 */
export type BattleEvent =
  | { seq: number; battle: number; type: 'start'; isBoss: boolean; enemies: Array<{ index: number; objectID: number; hp: number }>; party: Array<{ role: number; hp: number; mp: number; level: number }>; cash: number }
  | { seq: number; battle: number; type: 'hp'; side: 'enemy'; index: number; objectID: number; from: number; to: number }
  | { seq: number; battle: number; type: 'hp'; side: 'party'; role: number; from: number; to: number }
  | { seq: number; battle: number; type: 'gone'; index: number; objectID: number; killed: boolean }
  | { seq: number; battle: number; type: 'prompt'; member: number; role: number; revision?: number }
  /** error:这场战斗是被引擎异常打断的(结果记成 Terminated,剧情脚本会照常往下走)—— 不是正常的胜负或脚本收场 */
  | { seq: number; battle: number; type: 'end'; result: number; expGained: number; cashGained: number; party: Array<{ role: number; hp: number; mp: number; level: number }>; cash: number; error?: string };

/** 记事件那一刻读到的战斗视图(调用方从战斗状态与世界组件里读出来) */
export interface BattleView {
  isBoss: boolean;
  /** 全部敌人槽位;离场的槽位 objectID 为 0,hp 是它离场那一刻的血量(被打倒的 <= 0) */
  enemies: Array<{ index: number; objectID: number; hp: number }>;
  party: Array<{ role: number; hp: number; mp: number; level: number }>;
  cash: number;
  /** 正等指令的队员下标;不在选指令(行动中 / 自动战斗)为 null */
  promptMember: number | null;
  expGained: number;
  cashGained: number;
  /** 当前开放的提示的修订号(BattleCommands 组件,M5 C2);带进 prompt 事件 */
  promptRevision?: number | null;
}

const MAX_EVENTS = 4096;
type Unseq<T> = T extends unknown ? Omit<T, 'seq' | 'battle'> : never;

export class BattleEventLog {
  private events: BattleEvent[] = [];
  private seq = 0;
  private battleId = 0;
  private active = false;
  private enemyHp = new Map<number, { objectID: number; hp: number }>();
  private partyHp = new Map<number, number>();
  private prompted: number | null = null;
  private ownedPromptRevision: number | null = null;

  get lastSeq(): number { return this.seq; }
  /** 日志里最早还留着的 seq(更早的已被截断) */
  get oldestSeq(): number { return this.events.length ? this.events[0].seq : this.seq + 1; }
  get inBattle(): boolean { return this.active; }
  /** 当前(或最近一场)战斗的实例编号;还没打过为 0 */
  get battle(): number { return this.battleId; }

  /** seq 之后的事件(副本) */
  since(seq: number): BattleEvent[] {
    return this.events.filter((ev) => ev.seq > seq).map((ev) => JSON.parse(JSON.stringify(ev)));
  }

  start(view: BattleView) {
    this.battleId += 1;
    this.active = true;
    const present = view.enemies.filter((x) => x.objectID !== 0);
    this.enemyHp = new Map(present.map((x) => [x.index, { objectID: x.objectID, hp: x.hp }]));
    this.partyHp = new Map(view.party.map((m) => [m.role, m.hp]));
    this.prompted = null;
    this.ownedPromptRevision = null;
    this.push({ type: 'start', isBoss: view.isBoss, enemies: present.map((x) => ({ ...x })), party: view.party.map((m) => ({ ...m })), cash: view.cash });
  }

  /** 每帧之后:血量变化、敌人离场(逃跑 / 被消灭后清掉)、新出现的敌人(召唤 / 分身)、轮到谁下指令。发了 prompt 事件就返回它的 seq */
  frame(view: BattleView): number | null {
    if (!this.active) return null;
    this.diffHp(view);
    if (view.promptMember == null) {
      this.prompted = null;
    } else if (view.promptMember !== this.prompted) {
      this.prompted = view.promptMember;
      this.push({ type: 'prompt', member: view.promptMember, role: view.party[view.promptMember]?.role ?? -1, ...(view.promptRevision != null ? { revision: view.promptRevision } : {}) });
      return this.seq;
    }
    return null;
  }

  /** Flush completed native HP/gone changes before the owned prompt. Later
   * frame observations see the updated diff baseline and cannot duplicate them. */
  ownedPrompt(member: number, role: number, revision: number, view: BattleView): number | null {
    if (!this.active || revision === this.ownedPromptRevision) return null;
    this.diffHp(view);
    this.ownedPromptRevision = revision;
    this.prompted = member;
    this.push({ type: 'prompt', member, role, revision });
    return this.seq;
  }

  end(result: number, view: BattleView, error?: string | null) {
    if (!this.active) return;
    this.diffHp(view);
    this.active = false;
    this.push({ type: 'end', result, expGained: view.expGained, cashGained: view.cashGained, party: view.party.map((m) => ({ ...m })), cash: view.cash, ...(error ? { error } : {}) });
  }

  private diffHp(view: BattleView) {
    for (const x of view.enemies) {
      const prev = this.enemyHp.get(x.index);
      if (x.objectID === 0) {
        // 离场:同一帧里掉血并被清掉的,先补上最后这次血量变化,再记离场(killed = 血量打空;否则是逃跑)
        if (!prev) continue;
        if (prev.hp !== x.hp) this.push({ type: 'hp', side: 'enemy', index: x.index, objectID: prev.objectID, from: prev.hp, to: x.hp });
        this.enemyHp.delete(x.index);
        this.push({ type: 'gone', index: x.index, objectID: prev.objectID, killed: x.hp <= 0 });
        continue;
      }
      if (!prev || prev.objectID !== x.objectID) {
        // 新出现(召唤 / 分身)或这个位置换了敌人:从 0 记到当前血量
        this.push({ type: 'hp', side: 'enemy', index: x.index, objectID: x.objectID, from: 0, to: x.hp });
      } else if (prev.hp !== x.hp) {
        this.push({ type: 'hp', side: 'enemy', index: x.index, objectID: x.objectID, from: prev.hp, to: x.hp });
      }
      this.enemyHp.set(x.index, { objectID: x.objectID, hp: x.hp });
    }
    for (const m of view.party) {
      const prev = this.partyHp.get(m.role);
      if (prev !== undefined && prev !== m.hp) this.push({ type: 'hp', side: 'party', role: m.role, from: prev, to: m.hp });
      this.partyHp.set(m.role, m.hp);
    }
  }

  private push(ev: Unseq<BattleEvent>) {
    this.seq += 1;
    this.events.push({ seq: this.seq, battle: this.battleId, ...ev } as BattleEvent);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }
}
