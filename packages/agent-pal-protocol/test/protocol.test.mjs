/** 协议 v0 单元测试:opcode 表、客户端消息校验、服务端消息解析、编解码往返。不需要游戏资产。 */
import assert from 'node:assert/strict';
import {
  CMSG, SMSG, MOVE_MAX_STEPS, opName, opNumber, isClientOp, isServerOp,
  parseClientMsg, parseServerMsg, serialize, ack, reject, describe
} from '../src/index.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; process.stdout.write(`  ✓ ${name}\n`); };

t('opcode 数字唯一,客户端 < 0x80 ≤ 服务端', () => {
  const nums = [...Object.values(CMSG), ...Object.values(SMSG)];
  assert.equal(new Set(nums).size, nums.length);
  for (const v of Object.values(CMSG)) assert.ok(v > 0 && v < 0x80);
  for (const v of Object.values(SMSG)) assert.ok(v >= 0x80 && v <= 0xff);
});

t('名字 ↔ 数字', () => {
  assert.equal(opName(0x01), 'CMSG_MOVE');
  assert.equal(opName('SMSG_ACK'), 'SMSG_ACK');
  assert.equal(opName('CMSG_NOPE'), null);
  assert.equal(opNumber('SMSG_SCENE_ENTER'), SMSG.SMSG_SCENE_ENTER);
  assert.ok(isClientOp('CMSG_TICK') && !isClientOp('SMSG_HELLO'));
  assert.ok(isServerOp(0x94) && !isServerOp(0x01));
});

t('合法 CMSG:数字 op 归一成名字,保留 seq', () => {
  const r = parseClientMsg({ op: 0x01, seq: 7, dir: 'left', steps: 2 });
  assert.deepEqual(r, { ok: true, msg: { op: 'CMSG_MOVE', seq: 7, dir: 'left', steps: 2 } });
  assert.ok(parseClientMsg('{"op":"CMSG_INTERACT"}').ok);
  assert.ok(parseClientMsg({ op: 'CMSG_MENU_USE_ITEM', item: '桂花酒' }).ok);
  assert.ok(parseClientMsg({ op: 'CMSG_MENU_USE_ITEM', item: 0x50, target: 1 }).ok);
});

t('MOVE.steps 有上限(不能变成「走到某处」)', () => {
  assert.ok(parseClientMsg({ op: 'CMSG_MOVE', dir: 'up', steps: MOVE_MAX_STEPS }).ok);
  const r = parseClientMsg({ op: 'CMSG_MOVE', dir: 'up', steps: MOVE_MAX_STEPS + 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /≤ 4/);
});

t('非法 CMSG:未知 op / 缺字段 / 多字段 / 类型错 / 枚举外', () => {
  const bad = [
    [{ op: 'CMSG_TELEPORT', seq: 1 }, /unknown client op/],
    [{ op: 'SMSG_ACK', seq: 1 }, /unknown client op/],
    [{ op: 'CMSG_MOVE', seq: 2 }, /needs "dir"/],
    [{ op: 'CMSG_MOVE', dir: 'up', x: 3 }, /no field "x"/],
    [{ op: 'CMSG_CHOICE', index: 1.5 }, /integer/],
    [{ op: 'CMSG_MOVE', dir: 'north' }, /one of/],
    [{ op: 'CMSG_KEY', key: 'Escape' }, /one of/],
    ['not json', /JSON/],
    [[1, 2], /object/]
  ];
  for (const [m, re] of bad) {
    const r = parseClientMsg(m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.match(r.error, re);
  }
  assert.equal(parseClientMsg({ op: 'CMSG_MOVE', seq: 9 }).seq, 9, '出错时仍回传 seq,便于 REJECT 对号');
});

t('SMSG 解析:必填字段 + 多余字段放行', () => {
  assert.ok(parseServerMsg({ op: 'SMSG_PLAYER_UPDATE', gx: 1, gy: 2, facing: 'up', extra: true }).ok);
  assert.equal(parseServerMsg({ op: 'SMSG_REJECT', seq: 1 }).ok, false);
  assert.equal(parseServerMsg({ op: 'CMSG_MOVE', dir: 'up' }).ok, false);
});

t('编解码往返 + ack/reject 构造', () => {
  const msgs = [ack(3, 'moved 1'), reject(4, 'blocked'), { op: 'SMSG_MODE', mode: 'dialog' }];
  for (const m of msgs) {
    const back = parseServerMsg(serialize(m));
    assert.ok(back.ok);
    assert.deepEqual(back.msg, m);
  }
  assert.equal(JSON.parse(serialize({ op: 0x84, scene: 1, player: {}, objects: [] })).op, 'SMSG_SCENE_ENTER');
  assert.throws(() => serialize({ op: 'NOPE' }));
});

t('describe 覆盖全部 opcode', () => {
  const d = describe();
  assert.equal(Object.keys(d.client).length, Object.keys(CMSG).length);
  assert.equal(Object.keys(d.server).length, Object.keys(SMSG).length);
  assert.equal(d.client.CMSG_MOVE.fields.steps.max, MOVE_MAX_STEPS);
});

process.stdout.write(`\nPROTOCOL TESTS PASSED ✅ (${n})\n`);
