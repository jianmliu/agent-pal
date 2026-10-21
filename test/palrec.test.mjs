/**
 * 回放文件(src/palrec.mjs)和转视频(scripts/palrec-export.mjs)。不要游戏资产;转视频那一半要 ffmpeg(没有就跳过)。
 *  - 录:没变的不写、定期关键帧、整屏滚动用「挪过的上一帧」做增量;读回来逐帧一致(无损)
 *  - 进程被杀:文件尾巴上的半条记录不影响前面的
 *  - 从中间截:从最近的关键帧接上,不从头解
 *  - 声音:音效事件 + 波形混成一条轨;音乐按切歌 / 停分段
 *  - 转视频:时长、分辨率、帧率、有音轨
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRecorder, openRecording, estimateShift, shifted, MAGIC, REC_FRAME, REC_PALETTE } from '../src/palrec.mjs';
import { exportVideo, info, mixSfx, musicSegments, readWav } from '../scripts/palrec-export.mjs';

const say = (s) => process.stdout.write(s + '\n');
const W = 320, H = 200, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palrec-test-'));

// 一张有纹理的「地图」,从里面取 320×200 的窗口 = 走路时滚动的画面;上面叠一个会动的「人」
const WW = 1024, WH = 512, world = Buffer.alloc(WW * WH); { let s = 12345; for (let i = 0; i < world.length; i++) { s = (s * 1103515245 + 12345) >>> 0; world[i] = ((i % WW) >> 3) ^ (Math.floor(i / WW) >> 2) ^ ((s >>> 24) & 3); } }
const view = (ox, oy, sprite = null) => {
  const b = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) world.copy(b, y * W, (oy + y) * WW + ox, (oy + y) * WW + ox + W);
  if (sprite) for (let y = 0; y < 24; y++) b.fill(200 + (sprite.f % 4), (sprite.y + y) * W + sprite.x, (sprite.y + y) * W + sprite.x + 16);
  return b;
};
const pal = (k) => { const p = Buffer.alloc(768); for (let i = 0; i < 768; i++) p[i] = (i * 7 + k) & 255; return p; };
const wav = (rate, n, amp = 0.5) => {                                // 一小段 16 位单声道方波
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE((i >> 4) & 1 ? amp * 32767 : -amp * 32767, 44 + i * 2);
  return b;
};

// ---- 位移估计 ----
{
  const a = view(100, 100);
  for (const [dx, dy] of [[16, 8], [-16, 8], [32, -16], [-8, -4], [5, 0], [0, -7]]) {
    assert.deepEqual(estimateShift(view(100 + dx, 100 + dy), a, W, H), [dx, dy], `scroll by ${dx},${dy}`);
    // 挪过的上一帧和这一帧只差新露出来的边
    const s = shifted(a, W, H, dx, dy), cur = view(100 + dx, 100 + dy);
    let diff = 0; for (let i = 0; i < cur.length; i++) if (cur[i] !== s[i]) diff++;
    assert.ok(diff <= Math.abs(dx) * H + Math.abs(dy) * W, `shifted reference differs in ${diff} pixels`);
  }
  assert.deepEqual(estimateShift(view(100, 100, { x: 150, y: 90, f: 1 }), a, W, H), [0, 0], 'a moving sprite is not a scroll');
  assert.deepEqual(estimateShift(Buffer.alloc(W * H, 9), a, W, H), [0, 0], 'a scene cut has no good shift');
  say('palrec test: shift estimate ok');
}

// ---- 录 → 读 ----
const file = path.join(dir, 'a.palrec');
let clock = 1000000;
const script = [];                                                   // 我们喂进去的:[时刻, 帧, 震屏, 调色板号]
{
  const rec = createRecorder(file, { now: () => clock, w: W, h: H, fps: 30, runLog: 'run-x.jsonl' });
  assert.equal(rec.startT, 1000000);
  const feed = (dt, img, shake, p) => { clock += dt; rec.palette(pal(p)); rec.frame(img, shake); script.push([clock - 1000000, img, shake, p]); };
  feed(0, view(100, 100), 0, 0);
  feed(33, view(100, 100), 0, 0);                                    // 没变:不写
  for (let i = 1; i <= 20; i++) feed(40, view(100 + 16 * i, 100 + 8 * i, { x: 152, y: 88, f: i }), 0, 0);   // 走路:滚动 + 人在动
  feed(40, view(420, 260, { x: 152, y: 88, f: 21 }), 3, 0);          // 震屏
  feed(40, view(420, 260, { x: 152, y: 88, f: 21 }), 0, 0);
  for (let i = 1; i <= 8; i++) feed(33, view(420, 260, { x: 152, y: 88, f: 21 }), 0, i * 9);   // 淡出:只变调色板
  rec.audio({ music: 31, loop: true }); clock += 500; rec.audio({ sfx: 3 }); rec.sample(3, wav(11025, 2000)); rec.sample(3, wav(11025, 9));   // 同一个号只存一次
  assert.equal(rec.hasSample(3), true); assert.equal(rec.hasSample(4), false);
  feed(12000, view(0, 0), 0, 99);                                    // 换场(隔了 12 秒:这一帧和调色板都是关键帧)
  for (let i = 1; i <= 5; i++) feed(100, view(0, 0, { x: 40 + i * 4, y: 60, f: i }), 0, 99);
  clock += 300; rec.audio({ music: 0 }); clock += 200; rec.audio({ sfx: 3 }); rec.audio({ sfx: 9 });    // 9 号没有波形
  const st = rec.stats();
  assert.equal(st.recording, true); assert.equal(st.bytes, fs.statSync(file).size, 'every record is on disk as soon as it is written');
  rec.close();
}
const rec = openRecording(file);
{
  assert.deepEqual([rec.meta.v, rec.meta.startT, rec.meta.w, rec.meta.h, rec.meta.fps, rec.meta.runLog], [1, 1000000, W, H, 30, 'run-x.jsonl']);
  assert.equal(rec.truncated, false); assert.equal(rec.durationMs, clock - 1000000);
  const frames = rec.records.filter((r) => r.type === REC_FRAME), pals = rec.records.filter((r) => r.type === REC_PALETTE);
  const distinct = script.filter((s, i) => !i || !(s[1].equals(script[i - 1][1]) && s[2] === script[i - 1][2])).length;
  assert.equal(frames.length, distinct, 'unchanged frames are not written');
  assert.equal(pals.length, 1 + 8 + 1, 'palette is written only when it changes');
  // 走路那 20 帧:每帧远小于整帧(整屏在滚,不补偿的话几乎每个像素都变)
  const walking = frames.slice(1, 21).map((r) => r.len);
  assert.ok(Math.max(...walking) < frames[0].len / 3, `scrolling frames should be far smaller than a whole frame (${frames[0].len}), got ${walking}`);
  // 读回来和喂进去的逐帧一致
  const got = []; for (const f of rec.changes()) got.push([f.t, Buffer.from(f.indices), f.shake, Buffer.from(f.palette)]);
  for (const [t, img, shake, p] of script) {
    const at = got.filter((g) => g[0] <= t).at(-1);
    assert.ok(at, `state at ${t}ms`); assert.ok(at[1].equals(img), `frame at ${t}ms`); assert.equal(at[2], shake, `shake at ${t}ms`); assert.ok(at[3].equals(pal(p)), `palette at ${t}ms`);
  }
  // 从中间截:补一次起点时刻的状态,之后同整段放
  const cutAt = script.find((s) => s[3] === 99)[0] + 250;
  const part = []; for (const f of rec.changes({ fromMs: cutAt, toMs: cutAt + 200 })) part.push([f.t, Buffer.from(f.indices)]);
  assert.equal(part[0][0], cutAt); assert.ok(part[0][1].equals(script.filter((s) => s[0] <= cutAt).at(-1)[1]));
  assert.ok(part.length >= 2 && part.every(([t]) => t >= cutAt && t < cutAt + 200), `cut ${cutAt}: ${part.map((x) => x[0])}`);
  assert.deepEqual([...rec.changes({ fromMs: rec.durationMs + 5000 })].map((f) => f.t), [rec.durationMs + 5000], 'past the end: the last picture');
  // 声音
  assert.deepEqual(rec.audio().map((e) => ('sfx' in e ? `sfx${e.sfx}` : `music${e.music}`)), ['music31', 'sfx3', 'music0', 'sfx3', 'sfx9']);
  assert.deepEqual([...rec.samples().keys()], [3]); assert.equal(readWav(rec.samples().get(3)).mono.length, 2000);
  const i = info(rec);
  assert.deepEqual([i.frames, i.sfx, i.sfxSamples, i.music, i.truncated], [distinct, 3, 1, [31], false]);
  say(`palrec test: record / read ok (${frames.length} frames, ${fs.statSync(file).size} bytes)`);
}

// ---- 进程被杀:尾巴上的半条不影响前面的;不是回放文件的报错 ----
{
  const whole = fs.readFileSync(file), cut = path.join(dir, 'cut.palrec');
  for (const drop of [1, 5, 9, 40]) {
    fs.writeFileSync(cut, whole.subarray(0, whole.length - drop));
    const r = openRecording(cut);
    assert.equal(r.truncated, true, `drop ${drop} bytes`);
    assert.ok(r.records.length < rec.records.length && r.records.length >= rec.records.length - 3, 'only the records at the cut are lost');   // 尾巴上是几条很短的声音事件
    assert.ok([...r.changes()].length > 20);
  }
  fs.writeFileSync(cut, whole.subarray(0, MAGIC.length)); assert.throws(() => openRecording(cut), /no header/);
  fs.writeFileSync(cut, 'hello world, not a recording'); assert.throws(() => openRecording(cut), /not a \.palrec/);
  // 关了以后再写:什么也不做,不抛
  const done = createRecorder(path.join(dir, 'b.palrec'), {});
  done.close(); done.frame(view(0, 0), 0); done.audio({ sfx: 1 });
  assert.equal(done.stats().recording, false); assert.equal(openRecording(path.join(dir, 'b.palrec')).records.length, 0);
  say('palrec test: truncated tail ok');
}

// ---- 声音轨 ----
{
  const from = 0, to = rec.durationMs + 1000, { wav: mixed, used } = mixSfx(rec, from, to);   // 最后一声正好响在录像结尾:多留一秒
  assert.equal(used, 2, 'two plays of sound 3; sound 9 has no sample');
  const m = readWav(mixed);
  assert.equal(m.sampleRate, 44100); assert.equal(m.mono.length, Math.round(to / 1000 * 44100));
  const at = (ms) => Math.round(ms / 1000 * 44100), ev = rec.audio().filter((e) => e.sfx === 3);
  const loud = (a, b) => m.mono.subarray(a, b).some((v) => Math.abs(v) > 0.2);
  assert.ok(loud(at(ev[0].t), at(ev[0].t) + 4000)); assert.ok(!loud(at(ev[0].t) - 4000, at(ev[0].t) - 10)); assert.ok(loud(at(ev[1].t), at(ev[1].t) + 4000));
  assert.ok(!loud(at(ev[0].t) + at(400), at(ev[0].t) + at(800)), 'a 2000-sample clip at 11025 Hz lasts 181 ms');
  // 音乐:31 号从切歌放到「停」;目录里没有文件就没有这一段
  const md = path.join(dir, 'music'); fs.mkdirSync(md);
  assert.deepEqual(musicSegments(rec, from, to, md), []); assert.deepEqual(musicSegments(rec, from, to, null), []);
  fs.writeFileSync(path.join(md, '31.mp3'), 'x');
  const seg = musicSegments(rec, from, to, md), mus = rec.audio().filter((e) => 'music' in e);
  assert.deepEqual(seg.map((s) => [s.music, s.loop, s.atMs, s.durMs, s.skipMs]), [[31, true, mus[0].t, mus[1].t - mus[0].t, 0]]);
  const mid = musicSegments(rec, mus[0].t + 1000, mus[0].t + 3000, md);   // 从曲子放到一半的地方截
  assert.deepEqual(mid.map((s) => [s.atMs, s.durMs, s.skipMs]), [[0, 2000, 1000]]);
  say('palrec test: audio ok');
}

// ---- 转视频 ----
if (spawnSync('ffmpeg', ['-version']).status !== 0 || spawnSync('ffprobe', ['-version']).status !== 0) say('palrec test: ffmpeg not found — export part skipped');
else {
  const probe = (f) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate', '-of', 'json', f]).stdout.toString());
  const out = path.join(dir, 'a.mp4');
  const r = await exportVideo(rec, { out, scale: 2, fps: 20 });
  const p = probe(out), v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
  assert.deepEqual([v.width, v.height, v.r_frame_rate], [640, 400, '20/1']); assert.equal(a.sample_rate, '44100');
  assert.ok(Math.abs(Number(p.format.duration) - rec.durationMs / 1000) < 0.2, `duration ${p.format.duration}s vs ${rec.durationMs}ms`);
  assert.equal(r.frames, Math.round(r.durationMs / 1000 * 20)); assert.equal(r.sfx, 2);
  // 截一段、不要声音
  const cut = path.join(dir, 'cut.mp4');
  await exportVideo(rec, { out: cut, scale: 1, fps: 10, fromMs: 1000, toMs: 3000, audio: false });
  const pc = probe(cut);
  assert.deepEqual(pc.streams.map((s) => s.codec_type), ['video']); assert.ok(Math.abs(Number(pc.format.duration) - 2) < 0.15);
  await assert.rejects(exportVideo(rec, { out: cut, fromMs: 5000, toMs: 4000 }), /nothing to export/);
  // 命令行:--info、绝对时刻截取
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/palrec-export.mjs', import.meta.url)), ...args], { encoding: 'utf8' });
  assert.equal(JSON.parse(cli(file, '--info').stdout).meta.startT, 1000000);
  const c2 = cli(file, '-o', cut, '--scale', '1', '--fps', '10', '--from-t', String(1000000 + 500), '--to-t', String(1000000 + 1500), '--no-audio');
  assert.equal(c2.status, 0, c2.stderr); assert.ok(Math.abs(Number(probe(cut).format.duration) - 1) < 0.15);
  assert.equal(cli(file, '--scale', '2.5').status, 2); assert.equal(cli(path.join(dir, 'nope.palrec')).status, 1);
  say('palrec test: export ok');
}
fs.rmSync(dir, { recursive: true, force: true });
say('palrec tests passed');
