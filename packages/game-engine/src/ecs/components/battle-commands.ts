/**
 * 战斗指令组件(docs/specs/agent-pal-m5-command.md,C1b)。
 *
 * committed[i]:槽位 i 的队员当前的动作 —— 驱动战斗的那一份,`player[i].action` 是它的投影(对象身份不变、原地写回)。
 * previous[i]:repeat 的来源,`player[i].prevAction` 是它的投影。
 * 写入只经 battleService.writeCommitted / backupPrevious / importCommitted(内部走 WorldWriter)。
 * C2:open(当前开放的提示)/ pending(已接受未消费的指令回应)/ autoRequest(已接受未消费的自动战斗请求),
 * 以及身份 { context, battle, revision, member, role }。写 pending / autoRequest 不产生任何游戏效果;消费归执行层。
 *
 * 不进 STATE_COMPONENTS:那是 DOS 存档对应的世界状态,战斗中的指令不进 DOS 存档。
 */
import { defineComponent } from '../component';

/** 完整的动作状态(四个字段都要:repeat 会复制 remainingTime) */
export interface ActionState { actionType: number; actionID: number; target: number; remainingTime: number }

/** 外部回应选的东西(pending 用)。普攻的 actionID 必须为 0(1 = 自动攻击来源,只由自动战斗路径写) */
export type CommandChoice = { actionType: number; actionID: number; target: number } | { repeat: true };

/** 一次可提交的等待的身份(C2)。context / battle / revision / member / role 参与校验;promptEvent 只是关联信息 */
export interface PromptIdentity {
  context: string;       // 运行 / 恢复上下文的 epoch(运行层注入;数据层只保存并比较)
  battle: number;        // 战斗实例编号(BattleEventLog)
  revision: number;      // 提示修订号:每次开放 / 重开加一
  member: number;        // 队伍槽位
  role: number;          // 角色 id(开放那一刻槽位上的角色)
  promptEvent?: number;  // B3 日志里对应 prompt 事件的 seq(可能没有)
}

export interface BattleCommandsState {
  context: string;
  revision: number;                                                     // 已分配到的最大修订号
  open: PromptIdentity | null;                                          // 当前开放、可接受回应的提示
  pending: { for: PromptIdentity; choice: CommandChoice } | null;       // 已接受、未消费的指令回应
  autoRequest: { for: PromptIdentity; on: boolean } | null;             // 已接受、未消费的自动战斗模式请求
  // 不变量:pending 与 autoRequest 互斥(一次等待至多接受一个回应),非 null 的那个的 for 等于 open
  committed: Array<ActionState | null>;
  previous: Array<ActionState | null>;
}

export const ACTION_FIELDS = ['actionType', 'actionID', 'target', 'remainingTime'] as const;
const IDENTITY_FIELDS = ['context', 'battle', 'revision', 'member', 'role'] as const;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 旧结构里的动作对象(或任何带这四个字段的东西)→ 纯数据;没有对象返回 null */
export function actionState(action: any): ActionState | null {
  if (!action || typeof action !== 'object') return null;
  return { actionType: num(action.actionType), actionID: num(action.actionID), target: num(action.target), remainingTime: num(action.remainingTime) };
}

export const sameAction = (a: ActionState | null | undefined, b: ActionState | null | undefined): boolean =>
  (!a && !b) || (!!a && !!b && ACTION_FIELDS.every((f) => a[f] === b[f]));

/** 两个身份是否是同一次等待(promptEvent 不比) */
export const samePrompt = (a: PromptIdentity | null | undefined, b: PromptIdentity | null | undefined): boolean =>
  !!a && !!b && IDENTITY_FIELDS.every((f) => a[f] === b[f]);

export const emptyCommands = (context = ''): BattleCommandsState =>
  ({ context, revision: 0, open: null, pending: null, autoRequest: null, committed: [], previous: [] });

/**
 * 求哈希用的规范化视图(另建的副本,不动原值):去掉顶层与 open / pending.for / autoRequest.for 里的所有 context,
 * 以及 promptEvent 这类关联字段;保留动作、请求与修订。只有 epoch 不同的两个状态,视图相同。
 */
export function commandHashView(state: Readonly<BattleCommandsState>): unknown {
  const id = (p: PromptIdentity | null) => (p ? { battle: p.battle, revision: p.revision, member: p.member, role: p.role } : null);
  return {
    revision: state.revision,
    open: id(state.open),
    pending: state.pending ? { for: id(state.pending.for), choice: { ...state.pending.choice } } : null,
    autoRequest: state.autoRequest ? { for: id(state.autoRequest.for), on: state.autoRequest.on } : null,
    committed: state.committed.map((a) => (a ? { ...a } : null)),
    previous: state.previous.map((a) => (a ? { ...a } : null))
  };
}

const validSlot = (s: unknown) => s === null ||
  (!!s && typeof s === 'object' && ACTION_FIELDS.every((f) => typeof (s as any)[f] === 'number' && Number.isFinite((s as any)[f])));
const validIdentity = (p: any) => !!p && typeof p === 'object' && typeof p.context === 'string' &&
  ['battle', 'revision', 'member', 'role'].every((f) => Number.isInteger(p[f]));
const validChoice = (c: any) => !!c && typeof c === 'object' &&
  (c.repeat === true || ['actionType', 'actionID', 'target'].every((f) => typeof c[f] === 'number' && Number.isFinite(c[f])));

export const BattleCommandsComponent = defineComponent<BattleCommandsState>('BattleCommands', {
  create: () => emptyCommands(),
  validate: (value: unknown) => {
    const v = value as BattleCommandsState;
    const bad = (why: string) => { throw new Error(`BattleCommands: ${why}`); };
    if (!v || typeof v.context !== 'string' || !Number.isInteger(v.revision)) bad('context / revision');
    if (!Array.isArray(v.committed) || !Array.isArray(v.previous) || !v.committed.every(validSlot) || !v.previous.every(validSlot)) {
      bad('committed / previous must be arrays of action states or null');
    }
    if (v.open !== null && !validIdentity(v.open)) bad('open');
    if (v.pending !== null && !(validIdentity(v.pending.for) && validChoice(v.pending.choice))) bad('pending');
    if (v.autoRequest !== null && !(validIdentity(v.autoRequest.for) && typeof v.autoRequest.on === 'boolean')) bad('autoRequest');
    if (v.pending !== null && v.autoRequest !== null) bad('pending and autoRequest are mutually exclusive');
    const taken = v.pending ? v.pending.for : v.autoRequest ? v.autoRequest.for : null;
    if (taken && !samePrompt(taken, v.open)) bad('an accepted response must belong to the open prompt');
  }
});
