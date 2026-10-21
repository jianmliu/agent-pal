/**
 * 回放观战页(src/replay.mjs):不要游戏资产。
 *  - 回放文件里的页面消息 / 小地图底图读得回来
 *  - 拖到中间:小地图是「最近一次换图之后的增量合成一条」
 *  - 台词本:解说按对好的时刻(startAt)排进时间线,录像里当时到的那份不放
 *  - 服务:hello 带 replay;放起来画面和消息按时间到;拖动后页面该有的东西重发一遍;暂停后不再往前走
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRecorder, openRecording } from '../src/palrec.mjs';
import { wsParse, decodeDelta, MSG_FRAME, MSG_PALETTE } from '../src/host.mjs';
import { loadReplay, mapAt, scriptEvents, startReplay } from '../src/replay.mjs';

const W = 320, H = 200, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
const T0 = 1_700_000_000_000;
const frame = (k) => Buffer.alloc(W * H, k);
const pal = Buffer.alloc(768, 9);

/** 一份 10 秒的录像:每秒一帧(第 k 秒整屏是 k),外加页面消息 */
function record(name, startT = T0) {
  const file = path.join(dir, name);
  let now = startT;
  const rec = createRecorder(file, { now: () => now, startT, w: W, h: H, speed: 'fast' });
  const at = (ms, fn) => { now = startT + ms; fn(); };
  at(0, () => { rec.page({ t: 'hello', live: true, commentator: true, speed: 'fast' }); rec.palette(pal); rec.frame(frame(0)); rec.audio({ music: 31, loop: true }); });
  at(500, () => { rec.asset('minimap/4-1-plan.png', Buffer.from('PNG-A')); rec.page({ t: 'map', scene: 4, v: 1, boot: 'abc123', place: '余杭镇', fresh: true, pos: [1, 1], add: [[1, 1]], views: { plan: { w: 10, h: 10, rad: 1, m: [1, 0, 0, 0, 1, 0] } }, exits: [] }); });
  at(600, () => rec.page({ t: 'status', party: [{ name: '李逍遙', level: 1, hp: 100, maxHp: 100, mp: 10, maxMp: 10 }], cash: 0, scene: 4 }));
  for (let k = 1; k <= 10; k++) at(k * 1000, () => {
    rec.palette(pal); rec.frame(frame(k));
    rec.page({ t: 'map', scene: 4, v: 1, boot: 'abc123', place: '余杭镇', fresh: false, pos: [1 + k, 1], add: [[1 + k, 1]] });
    rec.page({ t: 'live', type: 'call', i: k, name: 'walk_to', args: { x: k, y: 1 }, at: startT + k * 1000, seq: k });
    if (k === 4) rec.page({ t: 'live', type: 'commentary', kind: 'comment', text: '当时晚到的那句', at: startT + 4000, seq: 100 });
    if (k === 6) rec.page({ t: 'status', party: [], cash: 500, scene: 4 });
    if (k === 7) rec.audio({ sfx: 3 });
  });
  rec.close();
  return file;
}

test('回放文件:页面消息和小地图底图读得回来', () => {
  const rec = openRecording(record('a.palrec'));
  const pages = rec.pages();
  assert.equal(pages[0].msg.t, 'hello');
  assert.equal(pages.filter((p) => p.msg.t === 'map').length, 11);
  assert.equal(pages.find((p) => p.msg.t === 'status').t, 600);
  assert.equal(rec.assets().get('minimap/4-1-plan.png').toString(), 'PNG-A');
  assert.equal(rec.audio().length, 2, '页面消息不算声音事件');
});

test('拖到中间:小地图合成一条,解说改用台词本', () => {
  const file = record('b.palrec');
  const lines = [
    { seq: 1, kind: 'comment', text: '对好时刻的那句', startAt: T0 + 2500, durMs: 3000, audio: 'vc1.m4a', run: 'b.jsonl' },
    { seq: 2, kind: 'chapter', chapter: 1, title: '第 1 章', text: '小结', startAt: T0 + 60000, durMs: 9000, run: 'b.jsonl' },   // 这一轮收了之后才说的:贴在末尾
    { seq: 3, kind: 'comment', text: '别的轮的', startAt: T0 + 9e6, run: 'zzz.jsonl' }
  ];
  const [r] = loadReplay([file], lines);
  const said = r.events.filter((p) => p.msg.type === 'commentary');
  assert.deepEqual(said.map((p) => [p.t, p.msg.text]), [[2500, '对好时刻的那句'], [10000, '小结']]);
  assert.equal(said[0].msg.audio, 'vc1.m4a'); assert.equal(said[0].msg.audioMs, 3000);
  assert.equal(said[1].msg.title, '第 1 章');
  assert.ok(r.events.every((p) => p.msg.t !== 'hello'));
  const m = mapAt(r.events, 3200);
  assert.equal(m.fresh, true);
  assert.deepEqual(m.add, [[1, 1], [2, 1], [3, 1], [4, 1]]);
  assert.deepEqual(m.pos, [4, 1]);
  assert.ok(m.views.plan);
  assert.equal(mapAt(r.events, 100), null, '还没进场景:没有小地图');
  assert.deepEqual(scriptEvents([{ kind: 'comment', text: 'x' }], [r]), [[]], '没有时刻的行不排');
  const [bare] = loadReplay([file], lines, { chapterSummaries: false });
  assert.deepEqual(bare.events.filter((p) => p.msg.type === 'commentary').map((p) => p.msg.kind), ['comment'], '按章节录屏时小结不进时间线');
});

// ---- 服务 ----
function maskedFrame(payload) {
  const mask = crypto.randomBytes(4), body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
  const head = body.length < 126 ? Buffer.from([0x81, 0x80 | body.length]) : Buffer.from([0x81, 0x80 | 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, mask, body]);
}
function connect(port, origin = `http://127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0), open = false, img = null, rgb = null;
    const inbox = [];
    s.on('connect', () => s.write(`GET /ws?role=watch HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`));
    s.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!open) {
        const end = buf.indexOf('\r\n\r\n'); if (end < 0) return;
        if (!buf.subarray(0, end).toString().startsWith('HTTP/1.1 101')) { reject(new Error('refused')); s.destroy(); return; }
        open = true; buf = buf.subarray(end + 4);
        resolve({ inbox, send: (obj) => s.write(maskedFrame(JSON.stringify(obj))), close: () => s.destroy() });
      }
      const [msgs, rest] = wsParse(buf); buf = Buffer.from(rest);
      for (const { opcode, data } of msgs) {
        if (opcode === 1) inbox.push(JSON.parse(data.toString()));
        else if (data[0] === MSG_PALETTE) rgb = decodeDelta(data[1], data.subarray(2), rgb, 768);
        else if (data[0] === MSG_FRAME) { img = decodeDelta(data[10], data.subarray(11), img, W * H); inbox.push({ kind: 'frame', value: img[0] }); }
      }
    });
    s.on('close', () => { if (!open) reject(new Error('closed before handshake')); });
    s.on('error', reject);
  });
}
async function waitFor(inbox, pred, what, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    const i = inbox.findIndex(pred);
    if (i >= 0) return inbox.splice(0, i + 1)[i];
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('回放服务:放、拖、暂停、换轮', async () => {
  const a = record('r1.palrec', T0), b = record('r2.palrec', T0 + 3_600_000);
  const srv = await startReplay({ files: [b, a], port: 0, tickMs: 10, log: () => {} });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    assert.match(await (await fetch(`${base}/replay`)).text(), /id="rpSeek"/);
    assert.equal((await (await fetch(`${base}/config.json`)).json()).replay, true);
    assert.equal(await (await fetch(`${base}/minimap/abc123/4-1-plan.png`)).text(), 'PNG-A');
    assert.equal((await fetch(`${base}/minimap/abc123/9-9-plan.png`)).status, 404);
    await assert.rejects(connect(srv.port, 'http://evil.example'), /closed before handshake|refused|ECONNRESET/, '别的网页连不进来');

    const c = await connect(srv.port);
    const hello = await waitFor(c.inbox, (m) => m.t === 'hello', 'hello');
    assert.equal(hello.role, 'watch'); assert.equal(hello.commentator, true);
    assert.deepEqual(hello.replay.recs.map((r) => [r.name, r.dur]), [['r1', 10000], ['r2', 10000]], '按开录时间排');
    const first = await waitFor(c.inbox, (m) => m.t === 'replay' && m.reset, '开头的状态');
    assert.equal(first.playing, false); assert.equal(first.pos, 0);
    assert.equal((await waitFor(c.inbox, (m) => m.kind === 'frame', '第一帧')).value, 0);

    // 拖到 6.5 秒、4 倍速放:页面该有的重发一遍,然后接着往下走
    c.send({ t: 'replay', op: 'rate', x: 4 });
    c.send({ t: 'replay', op: 'seek', ms: 6500, play: true });
    const reset = await waitFor(c.inbox, (m) => m.t === 'replay' && m.reset, '拖动后的状态');
    assert.equal(reset.pos, 6500); assert.equal(reset.rate, 4); assert.equal(reset.playing, true);
    const hist = await waitFor(c.inbox, (m) => m.t === 'history', '时间线');
    assert.deepEqual(hist.events.filter((e) => e.type === 'call').map((e) => e.i), [1, 2, 3, 4, 5, 6]);
    assert.equal((await waitFor(c.inbox, (m) => m.t === 'status', '状态栏')).cash, 500);
    const map = await waitFor(c.inbox, (m) => m.t === 'map', '小地图');
    assert.equal(map.fresh, true); assert.equal(map.add.length, 7); assert.deepEqual(map.pos, [7, 1]);
    assert.equal((await waitFor(c.inbox, (m) => m.t === 'audio' && 'music' in m, '音乐')).music, 31);
    assert.equal((await waitFor(c.inbox, (m) => m.kind === 'frame', '拖到的那一帧')).value, 6);
    assert.equal((await waitFor(c.inbox, (m) => m.t === 'audio' && m.sfx === 3, '7 秒处的音效')).sfx, 3);
    assert.equal((await waitFor(c.inbox, (m) => m.t === 'live' && m.i === 8, '8 秒处的操作')).name, 'walk_to');

    // 这一轮放完自动接下一轮
    const next = await waitFor(c.inbox, (m) => m.t === 'replay' && m.reset, '下一轮');
    assert.equal(next.i, 1); assert.equal(next.pos, 0); assert.equal(next.playing, true);

    // 暂停:进度不再走
    c.send({ t: 'replay', op: 'pause' });
    const paused = await waitFor(c.inbox, (m) => m.t === 'replay' && !m.playing, '暂停');
    await new Promise((r) => setTimeout(r, 400));
    const later = c.inbox.filter((m) => m.t === 'replay').at(-1) || paused;
    assert.equal(later.pos, paused.pos);
    assert.equal(later.playing, false);

    // 录屏用的逐步推进:停着,推到哪发到哪,回执带这一步发了几条;没有新东西就是 0
    c.inbox.length = 0;
    c.send({ t: 'replay', op: 'seek', rec: 0, ms: 2100, play: false });
    await waitFor(c.inbox, (m) => m.t === 'replay' && m.reset, '拖回第一轮');
    c.inbox.length = 0;
    c.send({ t: 'replay', op: 'step', ms: 2500, ack: 1 });
    const still = await waitFor(c.inbox, (m) => m.t === 'replay' && m.ack === 1, '第一步的回执');
    assert.equal(still.sent, 0); assert.equal(still.pos, 2500); assert.equal(still.playing, false);
    c.send({ t: 'replay', op: 'step', ms: 3050, ack: 2 });
    assert.equal((await waitFor(c.inbox, (m) => m.kind === 'frame', '3 秒的那一帧')).value, 3);
    const moved = await waitFor(c.inbox, (m) => m.t === 'replay' && m.ack === 2, '第二步的回执');
    assert.equal(moved.sent, 3, '一帧 + 小地图 + 一次操作');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(c.inbox.filter((m) => m.t === 'replay').every((m) => m.pos === 3050), true, '不自己往前走');

    // 最后一轮放到头:停住,告诉页面放完了
    c.inbox.length = 0;
    c.send({ t: 'replay', op: 'rate', x: 8 });
    c.send({ t: 'replay', op: 'seek', rec: 1, ms: 9000, play: true });
    const ended = await waitFor(c.inbox, (m) => m.t === 'replay' && m.ended, '放完了');
    assert.equal(ended.playing, false); assert.equal(ended.pos, 10000);
    c.close();
  } finally { srv.close(); }
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
