/**
 * 提示身份 / 待提交回应的契约(docs/specs/agent-pal-m5-command.md C2,§8 的契约测试)。不起引擎、不要资产。
 *
 * 这里验身份与队列;提交、状态改写、投影、repeat 的真实路径在 agent-pal 的 test:commit-command 与 golden --shadow。
 *
 * Run: pnpm --filter @onchainpal/game-engine test:battle-pending
 */
import assert from 'node:assert/strict';
import '../js/pal/pal-global';
import battleService from '../services/battle-service';
import worldService from '../services/world-service';
import stateService from '../services/state-service';
import { getRandomState } from '../services/random';
import { battleSnapshot } from '../services/battle-snapshot';
import { validateChoice, type CommandRuleDeps } from '../services/battle-command-rules';

const g = globalThis as any;
g.Direction ??= { South: 0, West: 1, North: 2, East: 3 };
const T = (g.BattleActionType = { Pass: 0, Defend: 1, Attack: 2, Magic: 3, CoopMagic: 4, Flee: 5, ThrowItem: 6, UseItem: 7, AttackMate: 8 });
g.BattleUIAction = { Attack: 0, Magic: 1, CoopMagic: 2, Misc: 3 };
const act = (actionType: number, actionID: number, target: number, remainingTime = 0) => ({ actionType, actionID, target, remainingTime });

// 队伍:槽位 0 = 角色 0,槽位 1 = 角色 2
stateService.setGlobal('party', [{ playerRole: 0, x: 0, y: 0, frame: 0, imageOffset: 0 }, { playerRole: 2, x: 0, y: 0, frame: 0, imageOffset: 0 }]);
stateService.setGlobal('maxPartyMemberIndex', 1);
worldService.syncAll();
const state: any = {
  player: [{ action: act(T.Pass, 0, -1) }, { action: act(T.Pass, 0, -1) }],
  enemy: [{ objectID: 419, e: { health: 350 } }, { objectID: 419, e: { health: 0 } }],
  UI: { autoAttack: false }
};
battleService.replaceState(state);
battleService.setCommandContext('epoch-A');
battleService.importCommitted();
const svc: any = battleService;
const cmds = () => battleService.getCommands();
const attack = (target: number) => ({ actionType: T.Attack, actionID: 0, target });

// ---- 开放提示:修订号 ---------------------------------------------------------------------------
assert.equal(battleService.getOpenPrompt(), null);
assert.equal(battleService.submitCommand({ context: 'epoch-A', battle: 0, revision: 1, member: 0, role: 0 }, attack(0)).ok, false, 'nothing is open');
const id1 = battleService.openPrompt(0);
assert.deepEqual(id1, { context: 'epoch-A', battle: 0, revision: 1, member: 0, role: 0 });

// ---- 写入不产生游戏效果 --------------------------------------------------------------------------
const before = { snap: JSON.stringify(battleSnapshot(battleService.getState())), draws: getRandomState().draws, auto: state.UI.autoAttack };
assert.deepEqual(battleService.submitCommand(id1, attack(0)), { ok: true });
assert.deepEqual(cmds().pending, { for: id1, choice: attack(0) });
assert.equal(JSON.stringify(battleSnapshot(battleService.getState())), before.snap, 'the battle snapshot is untouched by a submit');
assert.equal(getRandomState().draws, before.draws, 'no random draw');
assert.deepEqual({ ...cmds().committed[0] }, act(T.Pass, 0, -1), 'nothing was committed');

// ---- 身份:stale / wrong-actor,都不改数据 -----------------------------------------------------------
const frozen = JSON.stringify(cmds());
const refuse = (id: any, reason: string, what: string) => {
  const r: any = battleService.submitCommand(id, attack(0));
  assert.equal(r.ok, false, what); assert.equal(r.reason, reason, what);
  assert.equal(JSON.stringify(cmds()), frozen, `${what}: nothing changed`);
};
refuse({ ...id1, context: 'epoch-B' }, 'stale', 'another context');
refuse({ ...id1, battle: 9 }, 'stale', 'another battle');
refuse({ ...id1, revision: 0 }, 'stale', 'an earlier revision');
refuse({ ...id1, member: 1, role: 2 }, 'wrong-actor', 'another slot');
refuse({ ...id1, role: 5 }, 'wrong-actor', 'another role in the slot');

// ---- 不可覆盖;指令与自动请求互斥 -------------------------------------------------------------------
refuse(id1, 'busy', 'a second command for the same prompt');
assert.equal((battleService.requestAutoBattle(id1, true) as any).reason, 'busy', 'command → auto: busy');
assert.equal(JSON.stringify(cmds()), frozen);

// 错误的 accept 保留有效请求
assert.equal(battleService.acceptAutoRequest(id1), null, 'there is a command, not an auto request');
assert.equal(JSON.stringify(cmds()), frozen, 'the wrong accept closes nothing');
assert.equal(battleService.acceptPendingCommand({ ...id1, revision: 7 }), null, 'a mismatching identity takes nothing');
assert.equal(JSON.stringify(cmds()), frozen);

// ---- 只消费一次:接受并关闭 -------------------------------------------------------------------------
const taken = battleService.acceptPendingCommand(id1);
assert.deepEqual(taken, attack(0));
assert.deepEqual([cmds().open, cmds().pending, cmds().autoRequest], [null, null, null], 'accepting closes the prompt and clears both kinds');
(taken as any).target = 9;
assert.equal(battleService.acceptPendingCommand(id1), null, 'a second accept gets nothing');
assert.equal((battleService.submitCommand(id1, attack(0)) as any).reason, 'stale', 'set(id, B) after accept(id) is stale');
assert.equal((battleService.requestAutoBattle(id1, true) as any).reason, 'stale');
assert.equal(battleService.acceptAutoRequest(id1), null);

// ---- 重开:新修订号,旧身份失效(同一个 promptEvent 也一样)--------------------------------------------
const id2 = battleService.openPrompt(0, 41);
assert.equal(id2.revision, 2);
assert.equal((battleService.submitCommand(id1, attack(0)) as any).reason, 'stale', 'the old revision is dead');
const id3 = battleService.openPrompt(0, 41);                       // 同一个关联事件下再开一次
assert.deepEqual([id3.revision, id3.promptEvent], [3, 41]);
assert.equal((battleService.submitCommand(id2, attack(0)) as any).reason, 'stale', 'reopening under the same prompt event invalidates the previous revision');

// ---- 自动请求:auto → command busy;on 非 boolean 不占用身份 ------------------------------------------
assert.equal((battleService.requestAutoBattle(id3, 'yes' as any) as any).reason, 'invalid');
assert.deepEqual([cmds().pending, cmds().autoRequest], [null, null], 'an invalid request does not occupy the identity');
assert.deepEqual(battleService.requestAutoBattle(id3, true), { ok: true });
assert.equal(state.UI.autoAttack, false, 'the request does not flip UI.autoAttack');
assert.equal((battleService.submitCommand(id3, attack(0)) as any).reason, 'busy', 'auto → command: busy');
assert.equal((battleService.requestAutoBattle(id3, false) as any).reason, 'busy');
assert.equal(battleService.acceptPendingCommand(id3), null, 'there is an auto request, not a command');
assert.deepEqual(cmds().autoRequest, { for: { ...id3 }, on: true }, 'the wrong accept keeps the request');
assert.deepEqual(battleService.acceptAutoRequest(id3), { on: true });
assert.deepEqual([cmds().open, cmds().pending, cmds().autoRequest], [null, null, null]);
battleService.setAutoBattle(true);
assert.equal((battleService.getState() as any).UI.autoAttack, true, 'setAutoBattle is the internal immediate switch');

// ---- invalid 不占用;取消后旧身份 stale -------------------------------------------------------------
const id4 = battleService.openPrompt(1);
assert.deepEqual([id4.member, id4.role, id4.revision], [1, 2, 4]);
assert.equal((battleService.submitCommand(id4, { actionType: T.Attack, actionID: 1, target: 0 }) as any).reason, 'invalid', 'an attack carrying the auto marker');
assert.equal((battleService.submitCommand(id4, attack(1)) as any).reason, 'invalid', 'a dead enemy');
assert.equal(cmds().pending, null);
assert.deepEqual(battleService.submitCommand(id4, { repeat: true }), { ok: true }, 'a valid submit still works after invalid ones');
assert.deepEqual(battleService.cancelPending(id4), { ok: true });
assert.deepEqual([cmds().open, cmds().pending], [null, null]);
assert.equal((battleService.submitCommand(id4, attack(0)) as any).reason, 'stale', 'a cancelled prompt is closed for good');
assert.deepEqual(battleService.cancelPending(id4), { ok: false });

// ---- 换 context:旧身份一律 stale -----------------------------------------------------------------
const id5 = battleService.openPrompt(0);
battleService.setCommandContext('epoch-B');
assert.equal(battleService.getOpenPrompt(), null, 'a new context closes the open prompt');
assert.equal((battleService.submitCommand(id5, attack(0)) as any).reason, 'stale');

// ---- 快照与哈希 ------------------------------------------------------------------------------------
const id6 = battleService.openPrompt(0);
battleService.submitCommand(id6, attack(0));
const full = battleService.getCommandSnapshot();
assert.deepEqual([full.context, full.open!.context, full.pending!.for.context], ['epoch-B', 'epoch-B', 'epoch-B'], 'the full snapshot keeps every context');
assert.deepEqual(JSON.parse(JSON.stringify(full)), full, 'JSON round trip');
const hashB = battleService.commandHash();
assert.deepEqual(battleService.getCommandSnapshot(), full, 'hashing does not change the snapshot');
assert.equal(battleService.commandHash(), hashB, 'stable');
// 只有 epoch 不同、动作 / 请求 / 修订相同 → 哈希相同:在 epoch-C 下重建同样的状态
const w = worldService.getWorldWriter();
const { BattleCommandsComponent } = await import('../ecs/components/battle-commands');
const swap = (s: string) => JSON.parse(JSON.stringify(full).split('epoch-B').join(s));
w.set(w.world(), BattleCommandsComponent, swap('epoch-C'));
assert.equal(battleService.commandHash(), hashB, 'only the epoch differs: same hash');
w.set(w.world(), BattleCommandsComponent, { ...swap('epoch-C'), pending: { for: swap('epoch-C').open, choice: { repeat: true } } });
assert.notEqual(battleService.commandHash(), hashB, 'a different pending choice changes the hash');
w.set(w.world(), BattleCommandsComponent, { ...swap('epoch-C'), committed: [act(T.Defend, 0, -1), act(T.Pass, 0, -1)] });
assert.notEqual(battleService.commandHash(), hashB, 'a different committed action changes the hash');
assert.throws(() => w.set(w.world(), BattleCommandsComponent, { ...full, autoRequest: { for: full.open!, on: true } }), /mutually exclusive/, 'the component refuses both kinds at once');

// ---- installCommands:不接受外来的 context / revision ----------------------------------------------
battleService.setCommandContext('epoch-D');
const revBefore = cmds().revision;
const rebound = battleService.installCommands({
  committed: [act(T.Defend, 0, -1), act(T.Attack, 0, 0)], previous: [null, act(T.Magic, 300, 0, 2)],
  pending: { member: 1, choice: { repeat: true }, context: 'epoch-OLD', revision: 1 } as any
})!;
assert.deepEqual([rebound.context, rebound.revision, rebound.member, rebound.role], ['epoch-D', revBefore + 1, 1, 2], 'the pending intent is re-bound to a new identity in the current context');
assert.deepEqual(cmds().pending, { for: { ...cmds().open! }, choice: { repeat: true } });
assert.deepEqual({ ...(battleService.getState() as any).player[1].action }, act(T.Attack, 0, 0), 'installed actions are projected');
assert.equal(battleService.commandsProjectionMismatch(), null);

// ---- 完整的合法性规则(纯函数)--------------------------------------------------------------------------
const deps = (over: Partial<CommandRuleDeps> = {}): CommandRuleDeps => ({
  types: T, flags: { magicUsableInBattle: 2, magicToEnemy: 8, magicApplyToAll: 16, itemUsable: 1, itemThrowable: 4, itemApplyToAll: 16 },
  available: () => true, enemyAlive: (i) => i === 0 || i === 2, partySize: 2,
  magic: (id) => ({ 300: { flags: 2 | 8 }, 301: { flags: 2 }, 302: { flags: 2 | 8 | 16 }, 303: { flags: 1 } } as any)[id] ?? null,
  coop: () => ({ id: 350, flags: 2 | 8 }),
  item: (id) => ({ 80: { flags: 1, free: 2 }, 81: { flags: 4, free: 1 }, 82: { flags: 1, free: 0 }, 83: { flags: 1 | 16, free: 1 } } as any)[id] ?? null,
  ...over
});
const ok = (c: any, d = deps()) => { const r: any = validateChoice(c, d); assert.ok(r.ok, `${JSON.stringify(c)}: ${r.note}`); return r.choice; };
const bad = (c: any, d = deps()) => assert.equal(validateChoice(c, d).ok, false, JSON.stringify(c));
assert.deepEqual(ok({ repeat: true }), { repeat: true });
assert.deepEqual(ok(attack(-1)), attack(-1), 'attack with the default target');
assert.deepEqual(ok(attack(65535)), attack(-1), 'targets are SHORT');
bad(attack(1)); bad({ actionType: T.Attack, actionID: 1, target: 0 }); bad(attack(0), deps({ available: () => false }));
assert.deepEqual(ok({ actionType: T.Magic, actionID: 300, target: 2 }), { actionType: T.Magic, actionID: 300, target: 2 });
bad({ actionType: T.Magic, actionID: 300, target: 1 });            // 死掉的敌人
bad({ actionType: T.Magic, actionID: 300, target: -1 });           // 单体仙术要目标
assert.deepEqual(ok({ actionType: T.Magic, actionID: 301, target: 1 }).target, 1, 'a support spell targets a party member');
bad({ actionType: T.Magic, actionID: 301, target: 2 });
assert.equal(ok({ actionType: T.Magic, actionID: 302, target: 0 }).target, -1, 'apply-to-all normalises the target to -1');
bad({ actionType: T.Magic, actionID: 303, target: 0 });            // 战时不可用
bad({ actionType: T.Magic, actionID: 999, target: 0 });            // 没学会
assert.deepEqual(ok({ actionType: T.CoopMagic, actionID: 0, target: 0 }), { actionType: T.CoopMagic, actionID: 350, target: 0 }, 'the joint attack fills in its spell id');
bad({ actionType: T.CoopMagic, actionID: 300, target: 0 });
assert.deepEqual(ok({ actionType: T.UseItem, actionID: 80, target: 1 }), { actionType: T.UseItem, actionID: 80, target: 1 });
bad({ actionType: T.UseItem, actionID: 81, target: 0 });           // 只能投
bad({ actionType: T.UseItem, actionID: 82, target: 0 });           // 都预约掉了
bad({ actionType: T.UseItem, actionID: 99, target: 0 });           // 没有
assert.equal(ok({ actionType: T.UseItem, actionID: 83, target: 0 }).target, -1);
assert.deepEqual(ok({ actionType: T.ThrowItem, actionID: 81, target: 2 }), { actionType: T.ThrowItem, actionID: 81, target: 2 });
bad({ actionType: T.ThrowItem, actionID: 80, target: 0 });
bad({ actionType: T.Pass, actionID: 0, target: 0 }); bad({ actionType: T.AttackMate, actionID: 0, target: 0 }); bad(null); bad({ actionType: 'x' });
assert.deepEqual(ok({ actionType: T.Defend, actionID: 5, target: -1 }), { actionType: T.Defend, actionID: 0, target: -1 });

// ---- Live party identity, active slots and actor-aware suppression -------------------------------
// Actor-independent attack validation needs no UI fixture; the service reads the actual party.
battleService.setUI({ state: 1, curPlayerIndex: 0, autoAttack: false });
const role0 = () => worldService.mutateParty((rows) => { rows[0].playerRole = 0; return rows; });
const role2 = () => worldService.mutateParty((rows) => { rows[0].playerRole = 2; return rows; });
for (const kind of ['command', 'auto'] as const) {
  role0();
  const old = battleService.openPrompt(0);
  assert.deepEqual(kind === 'command' ? battleService.submitCommand(old, attack(0)) : battleService.requestAutoBattle(old, true), { ok: true });
  role2();
  const stored = battleService.getCommandSnapshot();
  assert.equal((battleService.submitCommand(old, attack(0)) as any).reason, 'stale', 'live remap precedes busy');
  assert.equal((battleService.requestAutoBattle(old, true) as any).reason, 'stale');
  assert.equal(battleService.acceptPendingCommand(old), null);
  assert.equal(battleService.acceptAutoRequest(old), null);
  assert.deepEqual(battleService.cancelPending(old), { ok: false });
  assert.deepEqual(battleService.getCommandSnapshot(), stored, 'stale acceptance/cancel has no writes');
  battleService.noteBattleFrame();
  const fresh = battleService.getOpenPrompt()!;
  assert.equal(fresh.role, 2);
  assert.ok(fresh.revision > old.revision);
  assert.deepEqual(battleService.requestAutoBattle(fresh, true), { ok: true });
  const foreign = battleService.getCommandSnapshot();
  assert.equal(battleService.acceptAutoRequest(old), null);
  assert.equal(battleService.acceptPendingCommand(old), null);
  assert.deepEqual(battleService.cancelPending(old), { ok: false });
  assert.deepEqual(battleService.getCommandSnapshot(), foreign, 'old identity preserves the fresh request');
}
for (const consume of ['accept', 'cancel'] as const) {
  role0();
  const id = battleService.openPrompt(0);
  battleService.submitCommand(id, attack(0));
  if (consume === 'accept') battleService.acceptPendingCommand(id); else battleService.cancelPending(id);
  battleService.noteBattleFrame();
  assert.equal(battleService.getOpenPrompt(), null, 'accepted/canceled same actor stays closed');
  role2();
  battleService.noteBattleFrame();
  assert.equal(battleService.getOpenPrompt()!.role, 2, 'same slot with a new role opens');
  const changed = battleService.getOpenPrompt()!;
  battleService.requestAutoBattle(changed, true);
  battleService.acceptAutoRequest(changed);
  battleService.setCommandContext(`epoch-reset-${consume}`);
  battleService.noteBattleFrame();
  assert.equal(battleService.getOpenPrompt()!.role, 2, 'new context clears suppression');
  const reset = battleService.getOpenPrompt()!;
  battleService.requestAutoBattle(reset, true);
  battleService.acceptAutoRequest(reset);
  battleService.setUI({ state: 0 });
  battleService.noteBattleFrame();
  battleService.setUI({ state: 1 });
  battleService.noteBattleFrame();
  assert.ok(battleService.getOpenPrompt(), 'leaving selection clears suppression');
}
const cached = battleService.openPrompt(1);
worldService.setMaxPartyMemberIndex(0);
assert.equal((battleService.submitCommand(cached, attack(0)) as any).reason, 'stale', 'cached inactive member is unauthorized');
assert.equal((battleService.requestAutoBattle(cached, true) as any).reason, 'stale');
assert.equal((battleService.submitCommand(battleService.openPrompt(-1), attack(0)) as any).reason, 'stale', 'negative slot is unauthorized');
worldService.setMaxPartyMemberIndex(1);
const removed = battleService.openPrompt(1);
worldService.mutateParty((rows) => rows.slice(0, 1));
assert.equal((battleService.submitCommand(removed, attack(0)) as any).reason, 'stale', 'removed slot is unauthorized');

console.log('battle-pending: ok');
