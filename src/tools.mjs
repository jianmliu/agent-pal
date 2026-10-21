/**
 * tools — 工具名 → agent 动作的唯一调度表(MCP / HTTP / 黄金轨迹共用,保证同语义)。
 * 返回 agent 动作的结果;observe 返回 null;未知工具返回 { unknown: true }。
 * 确定性模式下调用方负责把它包在 e.drive() 里。
 */
/**
 * 「被事件打断」:walk_to / step / interact 走到半路开战或进了对白 —— 预期内,不算失败
 * (路线本就要经过怪,或剧情该发生了)。MCP 服务与 bench 共用,别标 FAILED、别记无效调用。
 */
export function isSoftStop(name, r) {
  return !!r && !r.ok && ['walk_to', 'step', 'interact'].includes(name)
    && /interrupted after \d+ steps \(something triggered; mode now (battle|dialog)/.test(r.note || '');
}
/** 工具结果的成败标签:ok / stopped early (not an error) / FAILED */
export const resultLabel = (name, r) => (r.ok ? 'ok' : isSoftStop(name, r) ? 'stopped early (not an error)' : 'FAILED');

export async function runTool(a, name, args = {}) {
  let r = null;
  switch (name) {
    case 'observe': break;
    case 'walk_to': r = await a.walkTo(args.x, args.y); break;
    case 'step': r = await a.step(args.direction, args.n ?? 1); break;
    case 'interact': r = await a.interact(args.id); break;
    case 'search': r = await a.search(); break;
    case 'advance': r = await a.advance(args.max ?? 40); break;
    case 'choose': r = await a.choose(args.index); break;
    case 'cast': r = await a.cast(args.spell, args.caster ?? null, args.target ?? null); break;
    case 'grind': r = await a.grind(args.target_level ?? 99, Math.min(args.max_battles ?? 50, 500), Math.min(args.budget_s ?? 120, 600), args.prefer === 'exp' ? 'exp' : 'safe'); break;
    case 'battle': {
      const call = [args.action ?? 'attack', args.target ?? null, args.name ?? null];
      if (args.referenceID != null || args.expectedMember != null) call.push(args.referenceID ?? null);
      if (args.expectedMember != null) call.push(args.expectedMember);
      r = await a.battle(...call); break;
    }
    case 'use_item': r = await a.useItem(args.item, args.target ?? 0, args.facing ?? null); break;
    case 'equip': r = await a.equip(args.item, args.member ?? 0); break;
    case 'save': r = a.save(args.slot, args.note || ''); break;
    case 'load': r = await a.load(args.slot); break;
    case 'list_saves': r = a.listSaves(); break;
    case 'map': r = a.mapMemory(); break;
    case 'press': r = await a.press(args.key, args.ms ?? 100); break;
    case 'wait': r = await a.wait(args.ms ?? 1000); break;
    default: return { unknown: true };
  }
  return r;
}
