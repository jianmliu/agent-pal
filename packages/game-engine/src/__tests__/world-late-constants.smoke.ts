import assert from 'node:assert/strict';
// Deliberately evaluate WorldService before the game global constants exist,
// matching the headless entry's module initialization order.
const { default: world } = await import('../services/world-service');
const { default: state } = await import('../services/state-service');
const adapter = await import('../services/player-state-adapter');
const { PlayerRoles } = await import('../js/pal/pal-global');
world.setPlayerRoles(new PlayerRoles(new Uint8Array(PlayerRoles.size)));
assert.equal(world.setPlayerRoleWord(17, 2, 100), 100, 'late global initialization must not disable role word writes');
assert.equal(world.getPlayerRoleWord(17, 2), 100);
assert.equal((world.getPlayerRoles() as any).attackStrength[2], 100, 'raw word writes must agree with the little-endian role struct');
assert.equal(world.getPlayerRoleWord(17, 1), 0, 'role stride must stay six words');
world.adjustPlayerRoleWord(17, 2, -3);
assert.equal(world.getPlayerRoleWord(17, 2), 97);
assert.equal(adapter.getPlayerRoleWord(17, 2), 97, 'snapshot byte-array path must read little endian');
assert.equal(adapter.getPlayerAttackStrength(2), 97);
const effects = Array.from({ length: 7 }, () => new PlayerRoles(new Uint8Array(PlayerRoles.size)));
state.setGlobal('equipmentEffect', effects);
world.syncEquipmentEffects();
world.setEquipmentEffectWord(6, 17, 2, 123);
assert.equal(adapter.getEquipmentEffectScalar(6, 'attackStrength', 2), 123);
assert.equal(effects[6].attackStrength[2], 123);
world.adjustEquipmentEffectWord(6, 17, 2, -3);
assert.equal(adapter.getEquipmentEffectScalar(6, 'attackStrength', 2), 120);
world.clearEquipmentEffect(6, 2);
assert.equal(adapter.getEquipmentEffectScalar(6, 'attackStrength', 2), 0);
// Explicit raw-only fallback must agree with the independent typed DOS decoder.
const rawBytes = new Uint8Array(PlayerRoles.size);
world.setPlayerRoles({ uint8Array: rawBytes } as any);
world.setPlayerRoleWord(17, 2, 321);
assert.equal(new PlayerRoles(rawBytes).attackStrength[2], 321);
assert.equal(adapter.getPlayerRoleWord(17, 2), 321);
world.adjustPlayerRoleWord(17, 2, -1);
assert.equal(new PlayerRoles(rawBytes).attackStrength[2], 320);
world.dispose();
console.log('world-late-constants smoke: ok');
