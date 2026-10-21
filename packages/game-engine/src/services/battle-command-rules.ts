/**
 * 外部提交的战斗指令的合法性(docs/specs/agent-pal-m5-command.md §4.1 第 5 步)。纯函数:游戏数据经 deps 注入,
 * 不读界面字段、不改任何状态。通过则返回归一后的选择(目标按 SHORT、全体作用的目标 = -1、合擊补上仙术号)。
 *
 * 不校验 MP:MP 不够时改防御 / 普攻是提交逻辑(commitCommand),不是这里的拒绝理由。
 */
import type { CommandChoice } from '../ecs/components/battle-commands.js';

export interface CommandRuleDeps {
  /** BattleActionType 的数值 */
  types: { Pass: number; Defend: number; Attack: number; Magic: number; CoopMagic: number; Flee: number; ThrowItem: number; UseItem: number };
  flags: { magicUsableInBattle: number; magicToEnemy: number; magicApplyToAll: number; itemUsable: number; itemThrowable: number; itemApplyToAll: number };
  /** 这个队员当前能否选这类动作(封咒不能施法、合擊要当前队员与另一人健康 …) */
  available(kind: 'attack' | 'magic' | 'coop'): boolean;
  enemyAlive(index: number): boolean;
  partySize: number;
  /** 这个角色的仙术:没学会返回 null */
  magic(id: number): { flags: number } | null;
  /** 这个角色的合擊仙术号与标志 */
  coop(): { id: number; flags: number } | null;
  /** 背包里的物品:没有返回 null;free = 数量 − 已预约 */
  item(id: number): { flags: number; free: number } | null;
}

export type RuleResult = { ok: true; choice: CommandChoice } | { ok: false; note: string };

const SHORT = (n: number) => (n << 16) >> 16;
const no = (note: string): RuleResult => ({ ok: false, note });

export function validateChoice(input: unknown, deps: CommandRuleDeps): RuleResult {
  const c = input as any;
  if (!c || typeof c !== 'object') return no('a choice object is required');
  if (c.repeat === true) return { ok: true, choice: { repeat: true } };
  for (const f of ['actionType', 'actionID', 'target']) {
    if (typeof c[f] !== 'number' || !Number.isFinite(c[f])) return no(`${f} must be a number`);
  }
  const T = deps.types, F = deps.flags;
  const actionType = c.actionType, actionID = Math.trunc(c.actionID);
  let target = SHORT(Math.trunc(c.target));
  const done = (id: number, t: number): RuleResult => ({ ok: true, choice: { actionType, actionID: id, target: t } });

  // 目标:对敌 → 活着的敌人;对己 → 队员下标;全体作用 → 一律 -1
  const enemyTarget = (all: boolean, allowDefault: boolean): string | null => {
    if (all) { target = -1; return null; }
    if (target === -1 && allowDefault) return null;
    return deps.enemyAlive(target) ? null : `no living enemy at index ${target}`;
  };
  const partyTarget = (all: boolean): string | null => {
    if (all) { target = -1; return null; }
    return target >= 0 && target < deps.partySize ? null : `target ${target} is not a party member index (0..${deps.partySize - 1})`;
  };

  switch (actionType) {
    case T.Attack: {
      if (!deps.available('attack')) return no('attack is not available right now');
      // actionID 1 是「来自自动攻击」的标记,只由自动战斗路径写
      if (actionID !== 0) return no('a submitted attack must have actionID 0 (1 marks an auto-attack)');
      const bad = enemyTarget(false, true);
      return bad ? no(bad) : done(0, target);
    }
    case T.Defend:
    case T.Flee:
      return done(0, target);
    case T.Magic: {
      if (!deps.available('magic')) return no('magic is not available right now (sealed?)');
      const m = deps.magic(actionID);
      if (!m) return no(`the current member does not know spell ${actionID}`);
      if (!(m.flags & F.magicUsableInBattle)) return no(`spell ${actionID} cannot be used in battle`);
      const all = !!(m.flags & F.magicApplyToAll);
      const bad = m.flags & F.magicToEnemy ? enemyTarget(all, false) : partyTarget(all);
      return bad ? no(bad) : done(actionID, target);
    }
    case T.CoopMagic: {
      if (!deps.available('coop')) return no('the joint attack is not available right now');
      const co = deps.coop();
      if (!co) return no('the current member has no joint attack');
      if (actionID !== 0 && actionID !== co.id) return no(`joint attack id ${actionID} is not this member's (${co.id})`);
      const all = !!(co.flags & F.magicApplyToAll);
      const bad = co.flags & F.magicToEnemy ? enemyTarget(all, false) : partyTarget(all);
      return bad ? no(bad) : done(co.id, target);
    }
    case T.UseItem:
    case T.ThrowItem: {
      const throwing = actionType === T.ThrowItem;
      const it = deps.item(actionID);
      if (!it) return no(`item ${actionID} is not in the bag`);
      if (it.free <= 0) return no(`no ${actionID} left (all reserved by earlier commands this round)`);
      if (!(it.flags & (throwing ? F.itemThrowable : F.itemUsable))) return no(`item ${actionID} cannot be ${throwing ? 'thrown' : 'used'}`);
      const all = !!(it.flags & F.itemApplyToAll);
      const bad = throwing ? enemyTarget(all, false) : partyTarget(all);
      return bad ? no(bad) : done(actionID, target);
    }
    default:
      return no(`action type ${actionType} cannot be submitted`);
  }
}
