/** L0 层单元测试:快照求差 → SMSG、全量重建、CMSG → 工具调用映射。不需要游戏资产。 */
import assert from 'node:assert/strict';
import { parseServerMsg } from '@onchainpal/agent-pal-protocol';
import { diffState, fullState, toToolCall } from '../src/l0.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; process.stdout.write(`  ✓ ${name}\n`); };
const ops = (evs) => evs.map((e) => e.op);
const valid = (evs) => { for (const e of evs) assert.ok(parseServerMsg(e).ok, `invalid SMSG ${JSON.stringify(e)}`); return evs; };

const base = () => ({
  mode: 'control', scene: 1, map: 12,
  player: { gx: 60, gy: 40, facing: 'down' },
  objects: [{ id: 1, gx: 66, gy: 98, kind: 'touch-trigger', triggerMode: 5, blocking: false }, { id: 7, gx: 61, gy: 41, kind: 'npc', triggerMode: 1, blocking: true }],
  members: [{ roleId: 0, name: '李逍遙', level: 1, hp: 150, maxHp: 150, mp: 100, maxMp: 100 }],
  items: [], cash: 0, dialog: null, menu: null, battle: null, lastBattleResult: null
});

t('无前态 = 进场:SCENE_ENTER 全量 + 队伍 + 背包 + MODE', () => {
  const evs = valid(diffState(null, base()));
  assert.deepEqual(ops(evs), ['SMSG_SCENE_ENTER', 'SMSG_PARTY_UPDATE', 'SMSG_INVENTORY_UPDATE', 'SMSG_MODE']);
  assert.equal(evs[0].objects.length, 2);
});

t('走一步:只有 PLAYER_UPDATE', () => {
  const a = base(), b = base();
  b.player = { gx: 61, gy: 40, facing: 'right' };
  assert.deepEqual(valid(diffState(a, b)), [{ op: 'SMSG_PLAYER_UPDATE', gx: 61, gy: 40, facing: 'right' }]);
});

t('换场景:只发 SCENE_ENTER,不发同时变化的物体 / 主角增量', () => {
  const a = base(), b = base();
  b.scene = 3; b.player = { gx: 143, gy: 109, facing: 'down' }; b.objects = [];
  assert.deepEqual(ops(valid(diffState(a, b))), ['SMSG_SCENE_ENTER']);
});

t('物体:新增 / 变化 / 消失', () => {
  const a = base(), b = base();
  b.objects = [{ ...a.objects[0] }, { id: 9, gx: 1, gy: 2, kind: 'search-spot', triggerMode: 1, blocking: false }];
  b.objects[0].gx = 67;
  const evs = valid(diffState(a, b));
  assert.deepEqual(evs.map((e) => [e.op, e.id, e.removed ?? false]), [['SMSG_OBJECT_UPDATE', 1, false], ['SMSG_OBJECT_UPDATE', 9, false], ['SMSG_OBJECT_UPDATE', 7, true]]);
});

t('队伍 / 背包 / 银两变化', () => {
  const a = base(), b = base();
  b.members = [{ ...a.members[0], hp: 120 }];
  b.items = [{ id: 0x3d, name: '桂花酒', amount: 1 }];
  const evs = valid(diffState(a, b));
  assert.deepEqual(ops(evs), ['SMSG_PARTY_UPDATE', 'SMSG_INVENTORY_UPDATE']);
  const c = base(); c.cash = 5;
  assert.deepEqual(ops(diffState(a, c)), ['SMSG_INVENTORY_UPDATE']);
});

t('开菜单:CHOICE 在 MODE 之前;光标动了再发一次', () => {
  const a = base(), b = base();
  b.mode = 'menu';
  b.menu = { kind: 'list', title: null, items: [{ label: '是', enabled: true }, { label: '否', enabled: true }], index: 0, depth: 1 };
  assert.deepEqual(ops(valid(diffState(a, b))), ['SMSG_CHOICE', 'SMSG_MODE']);
  const c = structuredClone(b); c.menu.index = 1;
  assert.deepEqual(ops(diffState(b, c)), ['SMSG_CHOICE']);
});

t('战斗:START → STATE → PROMPT;结束发 END(带结果)', () => {
  const a = base();
  const b = base();
  b.mode = 'battle';
  b.battle = { enemies: [{ index: 0, name: '蛇妖', hp: 80, maxHp: 80 }], party: [], turn: { kind: 'command', member: 0 } };
  assert.deepEqual(ops(valid(diffState(a, b))), ['SMSG_BATTLE_START', 'SMSG_BATTLE_STATE', 'SMSG_BATTLE_PROMPT', 'SMSG_MODE']);
  const c = structuredClone(b); c.battle.enemies[0].hp = 30; c.battle.turn = { kind: 'acting' };
  assert.deepEqual(ops(diffState(b, c)), ['SMSG_BATTLE_STATE']);
  const d = base(); d.lastBattleResult = { result: 'won', cashDelta: 12, levelUps: [] };
  const end = valid(diffState(c, d));
  assert.deepEqual(ops(end), ['SMSG_BATTLE_END', 'SMSG_MODE']);
  assert.equal(end[0].result, 'won');
});

t('战斗(引擎原生事件,M5 B3):事件按发生顺序原样在前,再跟当前战况,不再由快照推 START / PROMPT / END', () => {
  const a = base();
  const b = base();
  b.mode = 'battle';
  b.battle = { enemies: [{ index: 0, name: '蛇妖', hp: 30, maxHp: 80 }], party: [], turn: { kind: 'command', member: 1 } };
  const native = [
    { op: 'SMSG_BATTLE_START', enemies: [{ index: 0, name: '蛇妖', hp: 80, maxHp: 80 }] },
    { op: 'SMSG_BATTLE_PROMPT', member: 0 },
    { op: 'SMSG_BATTLE_EVENT', kind: 'hp', side: 'enemy', index: 0, name: '蛇妖', from: 80, to: 30 },
    { op: 'SMSG_BATTLE_PROMPT', member: 1 }
  ];
  assert.deepEqual(ops(valid(diffState(a, b, native))), ['SMSG_BATTLE_START', 'SMSG_BATTLE_PROMPT', 'SMSG_BATTLE_EVENT', 'SMSG_BATTLE_PROMPT', 'SMSG_BATTLE_STATE', 'SMSG_MODE']);
  // 一条指令里打完并回到地图:END 来自事件,快照里的 lastBattleResult 不再重复发
  const d = base(); d.lastBattleResult = { result: 'won', cashDelta: 12, levelUps: [] };
  const end = valid(diffState(b, d, [{ op: 'SMSG_BATTLE_EVENT', kind: 'enemy_gone', index: 0, name: '蛇妖' }, { op: 'SMSG_BATTLE_END', result: 'won', cashDelta: 12, levelUps: [], exp: 9 }]));
  assert.deepEqual(ops(end), ['SMSG_BATTLE_EVENT', 'SMSG_BATTLE_END', 'SMSG_MODE']);
  assert.deepEqual(ops(diffState(d, base(), [])), [], '没有新事件、状态没变:什么都不发');
});

t('崩溃:MODE crashed 带原因', () => {
  const b = { ...base(), mode: 'crashed', crash: 'buyMenu is not a function' };
  const evs = valid(diffState(base(), b));
  assert.deepEqual(evs.at(-1), { op: 'SMSG_MODE', mode: 'crashed', note: 'buyMenu is not a function' });
});

t('全量:标题画面只有菜单与 MODE(没有占位队伍)', () => {
  const title = { ...base(), mode: 'menu', scene: null, map: null, player: null, objects: [], members: [], menu: { kind: 'list', title: null, items: [{ label: '新的故事', enabled: true }], index: 0, depth: 1 } };
  assert.deepEqual(ops(valid(fullState(title))), ['SMSG_CHOICE', 'SMSG_MODE']);
  const dlg = { ...base(), mode: 'dialog', dialog: { speaker: '李大娘', text: '李逍遙!' } };
  const evs = valid(fullState(dlg));
  assert.deepEqual(ops(evs), ['SMSG_SCENE_ENTER', 'SMSG_PARTY_UPDATE', 'SMSG_INVENTORY_UPDATE', 'SMSG_DIALOG', 'SMSG_MODE']);
  assert.equal(evs[3].waiting, true);
});

t('CMSG → 工具调用:与 MCP / golden 同一张调度表', () => {
  const word = (id) => ({ 61: '桂花酒' }[id] || '');
  assert.deepEqual(toToolCall({ op: 'CMSG_MOVE', dir: 'up' }, word), ['step', { direction: 'up', n: 1 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_MOVE', dir: 'left', steps: 3 }, word), ['step', { direction: 'left', n: 3 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_INTERACT' }, word), ['search', {}]);
  assert.deepEqual(toToolCall({ op: 'CMSG_DIALOG_ADVANCE' }, word), ['advance', { max: 1 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_CHOICE', index: 2 }, word), ['choose', { index: 2 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_MENU_USE_ITEM', item: 61 }, word), ['use_item', { item: '桂花酒', target: 0 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'attack', target: 1 }, word), ['battle', { action: 'attack', target: 1 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_SAVE', slot: 3 }, word), ['save', { slot: 3 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_KEY', key: 'Menu' }, word), ['press', { key: 'Menu', ms: 100 }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_WAIT' }, word), ['wait', { ms: 1000 }]);
});

t('M0 还不支持的 CMSG → REJECT 原因', () => {
  const word = () => '';
  assert.deepEqual(toToolCall({ op: 'CMSG_MENU_USE_ITEM', item: 999 }, word).reject[0], 'not_found');
  for (const op of ['CMSG_TICK', 'CMSG_MENU_EQUIP', 'CMSG_MENU_MAGIC', 'CMSG_SHOP_BUY', 'CMSG_SHOP_SELL', 'CMSG_SHOP_CLOSE']) {
    assert.equal(toToolCall({ op }, word).reject[0], 'unsupported', op);
  }
  assert.equal(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'siege' }, word).reject[0], 'unsupported');
});

t('战斗指令(M5 B4):仙术 / 物品 / 投掷按 id 或名字,合擊 = combo', () => {
  const word = (n) => ({ 295: '氣療術', 82: '止血草' }[n] || '');
  assert.deepEqual(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'magic', magic: 295, target: 0 }, word), ['battle', { action: 'magic', target: 0, name: '氣療術' }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'magic', magic: '御劍術' }, word), ['battle', { action: 'magic', name: '御劍術' }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'item', item: 82, target: 1 }, word), ['battle', { action: 'item', target: 1, name: '止血草' }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'throw', item: '梅花鏢', target: 2 }, word), ['battle', { action: 'throw', target: 2, name: '梅花鏢' }]);
  assert.deepEqual(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'combo', target: 0 }, word), ['battle', { action: 'coop', target: 0 }]);
  assert.equal(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'magic' }, word).reject[0], 'invalid', 'magic without a spell');
  assert.equal(toToolCall({ op: 'CMSG_BATTLE_ACTION', type: 'item', item: 9999 }, word).reject[0], 'not_found');
});

process.stdout.write(`\nL0 TESTS PASSED ✅ (${n})\n`);
