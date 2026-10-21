/** Pure high-level name/default resolution. Numeric legality remains C2's job. */
export function resolveBattleChoice({ action, target, name, referenceID = null, prompt }, d) {
  const no = (note, reason = 'invalid') => ({ ok: false, reason, note });
  if (action === 'repeat') return { ok: true, choice: { repeat: true } };
  const T = d.types;
  const type = { attack: T.Attack, defend: T.Defend, flee: T.Flee, magic: T.Magic, item: T.UseItem, throw: T.ThrowItem, coop: T.CoopMagic }[action];
  if (type == null) return no(`bad battle action ${action}`);
  const match = list => list.find(x => x.name === name) || list.find(x => x.name.includes(name) || name.includes(x.name));
  let id = 0, all = false, enemy = action === 'attack' || action === 'throw';
  if (action === 'magic' || action === 'item' || action === 'throw') {
    if (referenceID != null && (!Number.isInteger(referenceID) || referenceID <= 0)) return no('reference ID must be a positive integer');
    if (referenceID == null && (typeof name !== 'string' || !name)) return no(`${action} needs name=`);
    const candidates = action === 'magic' ? d.spells : d.items;
    const entry = referenceID == null ? match(candidates) : candidates.find(x => x.id === referenceID);
    if (!entry) return no(`no ${action === 'magic' ? 'spell' : 'item'} matching ${referenceID == null ? `"${name}"` : `id ${referenceID}`} for the current member`, 'not_found');
    id = entry.id;
    if (action === 'magic') {
      if (entry.mp != null && entry.mp > d.mp) return no(`${entry.name} needs ${entry.mp} MP, current member has ${d.mp}`);
      const lack = d.spellLack(id);
      if (lack) return no(`${entry.name} ${lack}`);
      if (!entry.inBattle) return no(`${entry.name} cannot be used in battle`);
      all = entry.all; enemy = entry.toEnemy;
    } else {
      if (action === 'item' && !entry.use) return no(`${entry.name} cannot be used`);
      if (action === 'throw' && !entry.throw) return no(`${entry.name} cannot be thrown`);
      all = !!(d.object(id)?.item?.flags & d.flags.ApplyToAll);
    }
  } else if (action === 'coop') {
    id = Number(d.roles?.cooperativeMagic?.[prompt.role]) || 0;
    for (let part = 0; part <= d.maxEquipments; part++) {
      const override = Number(d.equipment?.[part]?.cooperativeMagic?.[prompt.role]) || 0;
      if (override) id = override;
    }
    const flags = d.object(id)?.magic?.flags || 0;
    all = !!(flags & 16); enemy = !!(flags & 8);
  } else if (action === 'attack') {
    // Native attack-all excludes the extra equipment slot.
    for (let part = 0; part < d.maxEquipments; part++) if (d.equipment?.[part]?.attackAll?.[prompt.role]) all = true;
  }
  const canonicalUnused = action === 'defend' || action === 'flee';
  if (!canonicalUnused && !all && enemy && target == null && !d.enemies.some(x => x.hp > 0)) return no('no living enemy is available', 'not_found');
  const resolvedTarget = canonicalUnused || all ? -1 : target ?? (enemy ? d.enemies.find(x => x.hp > 0)?.index ?? -1 : 0);
  if (!canonicalUnused && !all && target != null && !Number.isInteger(target)) return no('target must be an integer');
  if (!canonicalUnused && !all && target != null && enemy && !d.enemies.some(x => x.index === target && x.hp > 0)) return no(`no living enemy at index ${target}`, 'not_found');
  return { ok: true, choice: { actionType: type, actionID: id, target: resolvedTarget } };
}
