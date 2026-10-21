/**
 * 回放观战页:把录下来的一局(.palrec,见 palrec.mjs)照当时的时间线,在同一个观战页(host-client.html)上重放一遍 ——
 * 画面、声音事件、时间线(AI 的操作 / 对白 / 解说)、状态栏、小地图都和直播时一样,只是时钟是录像的时钟,能暂停、拖动、换倍速。
 * 不起引擎、不要游戏资产:要的东西都在回放文件里(画面、音效波形、发给页面的消息、小地图底图);音乐 MP3 和解说配音另给目录。
 *
 *   GET  /  /watch  /replay   观战页(回放模式:hello 里带 replay)
 *   GET  /sfx/<n>.wav         回放文件里存的音效波形
 *   GET  /minimap/<启动标识>/<场景>-<版本>-<plan|art>.png   回放文件里存的小地图底图(启动标识分得清是哪一轮的)
 *   GET  /voice/…  /music/…   同 host.mjs
 *   WS   /ws                  host → 浏览器:同直播(帧 / 调色板 / JSON),外加 { t: 'replay', i, pos, dur, playing, rate, reset? }
 *                             浏览器 → host:{ t: 'replay', op: 'seek' | 'play' | 'pause' | 'rate' | 'step', rec?, ms?, play?, x?, ack? }
 *                             step = 录屏用(replay-capture.mjs):停着,把时间线推到 ms,回一条带 ack 和 sent(这一步发了几条)的状态
 * 每个浏览器各放各的(各有各的进度)。给了几个回放文件(连跑的几轮)就是一张播放单:一轮放完接下一轮。
 *
 * 解说:直播时解说总比事情晚几秒到(要等模型写、等配音合成),录进文件的是「到的时刻」。给了台词本(主播台词.jsonl)
 * 就改用台词本里对好的时刻(startAt)和配音,录像里的那份解说不放。
 *
 * 只听 127.0.0.1;WebSocket 只接受本页面(同源 Origin)发起的连接。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecording } from './palrec.mjs';
import { wsAccept, wsFrame, wsParse, encodeDelta, loopbackHost, serveMedia, MSG_FRAME, MSG_PALETTE } from './host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HISTORY = 60, RATES = [0.25, 0.5, 1, 2, 4, 8];
const stem = (f) => path.basename(String(f || '')).replace(/\.(palrec|jsonl)$/, '');

/** 台词本的行 → 各轮时间线上的解说事件(按 startAt 落到哪一轮;落不进任何一轮的按运行日志的名字找,贴在那一轮的末尾) */
export function scriptEvents(lines, recs, { chapterSummaries = true } = {}) {
  const out = recs.map(() => []);
  for (const l of lines) {
    if (!l || (l.kind !== 'comment' && l.kind !== 'chapter') || typeof l.text !== 'string' || !Number.isFinite(l.startAt)) continue;
    if (l.kind === 'chapter' && !chapterSummaries) continue;
    let i = recs.findIndex((r) => l.startAt >= r.startT && l.startAt <= r.startT + r.durationMs);
    if (i < 0) i = recs.findIndex((r) => r.name === stem(l.run));
    if (i < 0) continue;
    const r = recs[i], t = Math.max(0, Math.min(r.durationMs, l.startAt - r.startT));
    out[i].push({ t, msg: { t: 'live', type: 'commentary', kind: l.kind, text: l.text, at: r.startT + t, seq: 1e9 + (l.seq || 0),
      ...(l.kind === 'chapter' ? { title: l.title || '章节小结', ...(Number.isInteger(l.chapter) ? { chapter: l.chapter } : {}) } : {}),
      ...(l.audio ? { audio: l.audio, audioMs: l.durMs } : {}) } });
  }
  return out;
}

/** 读回放文件,排好每一轮的时间线。files 按时间先后;scriptLines = 台词本的行(可无) */
export function loadReplay(files, scriptLines = null, opt = {}) {
  const recs = files.map((file) => {
    const rec = openRecording(file);
    const pages = rec.pages(), hello = pages.find((p) => p.msg.t === 'hello')?.msg || {};
    return { file, name: stem(file), rec, startT: rec.meta.startT, durationMs: rec.durationMs, hello,
      boot: pages.find((p) => p.msg.t === 'map' && p.msg.boot)?.msg.boot || null,
      events: pages.filter((p) => p.msg.t !== 'hello'), audio: rec.audio(), assets: rec.assets(), samples: rec.samples() };
  }).sort((a, b) => a.startT - b.startT);
  if (scriptLines) {
    const extra = scriptEvents(scriptLines, recs, opt);
    recs.forEach((r, i) => { r.events = [...r.events.filter((p) => !(p.msg.t === 'live' && p.msg.type === 'commentary')), ...extra[i]]; });
  }
  for (const r of recs) r.events.sort((a, b) => a.t - b.t);          // 稳定排序:同一毫秒的保持原来的先后
  return recs;
}

/** 拖到 ms 时页面该有的小地图:最近一次换图(fresh)之后的增量合成一条 */
export function mapAt(events, ms) {
  let m = null;
  for (const p of events) {
    if (p.t > ms) break;
    if (p.msg.t !== 'map') continue;
    if (p.msg.fresh || !m) m = { ...p.msg, fresh: true, add: [...(p.msg.add || [])], views: p.msg.views || m?.views || {}, exits: p.msg.exits || [] };
    else { m.add.push(...(p.msg.add || [])); if (p.msg.pos) m.pos = p.msg.pos; if (p.msg.exits) m.exits = p.msg.exits; }
  }
  return m;
}

/**
 * 起回放服务。files = 回放文件(一个或几个);script = 台词本路径(可无)。返回 { server, port, recs, close }
 * chapterSummaries = false:台词本里的章节小结不进时间线(按章节录屏时由录屏那边放在章末,不让上一章的小结出现在下一章开头)
 */
export async function startReplay({ files, port = 8096, script = null, voiceDir = '', musicDir = '', tickMs = 33, chapterSummaries = true, log = (s) => process.stderr.write(s + '\n') } = {}) {
  let lines = null;
  if (script) lines = fs.readFileSync(script, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const recs = loadReplay(files, lines, { chapterSummaries });
  if (!recs.length) throw new Error('replay: no recordings');
  const narrated = recs.some((r) => r.hello.commentator || r.events.some((p) => p.msg.type === 'commentary'));
  const clientHtml = () => fs.readFileSync(path.join(here, 'host-client.html'));
  const W = recs[0].rec.width, H = recs[0].rec.height;
  const sessions = new Set();
  const send = (c, buf) => { if (!c.destroyed) c.write(buf); };
  const sendJson = (c, obj) => send(c, wsFrame(1, Buffer.from(JSON.stringify(obj))));

  // ---- 一个浏览器的一次回放 ----
  function session(socket) {
    const S = { i: 0, pos: 0, playing: false, rate: 1, it: null, next: null, done: false, ev: 0, au: 0, wall: Date.now(), pal: null, img: null, due: null, frames: 0, lastState: 0, sent: 0 };
    const state = (extra = {}) => ({ t: 'replay', i: S.i, pos: Math.round(S.pos), dur: recs[S.i].durationMs, playing: S.playing, rate: S.rate, ...extra });
    const paint = (ch, force = false) => {
      if (!force && socket.writableLength > 512 * 1024) { S.due = ch; return; }       // 浏览器跟不上:这一拍不发,下一拍发当时最新的
      S.due = null; S.sent++;
      const pal = Buffer.from(ch.palette), img = Buffer.from(ch.indices);
      if (!S.pal || !pal.equals(S.pal)) { const { enc, data } = encodeDelta(pal, S.pal); send(socket, wsFrame(2, Buffer.concat([Buffer.from([MSG_PALETTE, enc]), data]))); S.pal = pal; }
      const head = Buffer.alloc(10);
      head[0] = MSG_FRAME; head.writeUInt32LE(++S.frames >>> 0, 1); head.writeInt8(ch.shake | 0, 5);
      const { enc, data } = encodeDelta(img, S.img);
      send(socket, wsFrame(2, Buffer.concat([head, Buffer.from([enc]), data]))); S.img = img;
    };
    /** 把时间线推到 S.pos:这之前的画面只发最后一份,消息和声音事件按顺序都发 */
    const pump = (force = false) => {
      const r = recs[S.i];
      let latest = S.due;
      while (!S.done) {
        if (!S.next) { const n = S.it.next(); if (n.done) { S.done = true; break; } S.next = n.value; }
        if (S.next.t > S.pos) break;
        latest = S.next; S.next = null;
      }
      if (latest) paint(latest, force);
      while (S.ev < r.events.length && r.events[S.ev].t <= S.pos) { sendJson(socket, r.events[S.ev++].msg); S.sent++; }
      while (S.au < r.audio.length && r.audio[S.au].t <= S.pos) { const { t, ...a } = r.audio[S.au++]; sendJson(socket, { t: 'audio', ...a }); }
    };
    const seek = (i, ms, play = S.playing) => {
      if (!Number.isInteger(i) || i < 0 || i >= recs.length) i = S.i;
      const r = recs[i];
      S.i = i; S.pos = Math.max(0, Math.min(r.durationMs, Number(ms) || 0)); S.playing = !!play; S.wall = Date.now();
      S.it = r.rec.changes({ fromMs: S.pos }); S.next = null; S.done = false; S.due = null;
      S.ev = r.events.findIndex((p) => p.t > S.pos); if (S.ev < 0) S.ev = r.events.length;
      S.au = r.audio.findIndex((a) => a.t > S.pos); if (S.au < 0) S.au = r.audio.length;
      // 页面从头摆一遍:时间线(这一轮里这之前最近的几十条)、各章小结(前面几轮的也算)、状态栏、小地图、正在放的音乐
      sendJson(socket, state({ reset: true }));
      const before = r.events.slice(0, S.ev).map((p) => p.msg);
      const chapters = [...recs.slice(0, i).flatMap((x) => x.events.map((p) => p.msg)), ...before].filter((m) => m.type === 'commentary' && m.kind === 'chapter');
      sendJson(socket, { t: 'history', events: before.filter((m) => m.t === 'live').slice(-HISTORY), chapters });
      const speed = before.findLast((m) => m.t === 'speed'); if (speed) sendJson(socket, speed);
      const status = before.findLast((m) => m.t === 'status'); if (status) sendJson(socket, status);
      const map = mapAt(r.events, S.pos); if (map) sendJson(socket, map);
      const music = r.audio.slice(0, S.au).findLast((a) => 'music' in a);
      sendJson(socket, { t: 'audio', music: music?.music || 0, loop: music?.loop !== false });
      pump(true);
    };
    const tick = () => {
      const now = Date.now(), r = recs[S.i];
      if (S.playing) S.pos = Math.min(r.durationMs, S.pos + (now - S.wall) * S.rate);
      S.wall = now;
      pump();
      if (S.playing && S.pos >= r.durationMs) {
        if (S.i + 1 < recs.length) seek(S.i + 1, 0, true);
        else { S.playing = false; sendJson(socket, state({ ended: true })); }
      }
      if (now - S.lastState >= 250) { S.lastState = now; sendJson(socket, state()); }
    };
    const onMessage = (msg) => {
      if (msg.t === 'ping') return sendJson(socket, { t: 'pong', ts: msg.ts });
      if (msg.t !== 'replay') return;
      if (msg.op === 'step') {
        const ms = Math.max(0, Math.min(recs[S.i].durationMs, Number(msg.ms) || 0));
        S.sent = 0;
        if (ms < S.pos || S.playing) seek(S.i, ms, false); else { S.pos = ms; S.wall = Date.now(); pump(true); }
        return sendJson(socket, state({ ack: msg.ack, sent: S.sent }));
      }
      if (msg.op === 'seek') seek(msg.rec ?? S.i, msg.ms, msg.play ?? S.playing);
      else if (msg.op === 'play') { if (S.pos >= recs[S.i].durationMs && S.i === recs.length - 1) seek(S.i, 0, true); else { S.playing = true; S.wall = Date.now(); } }
      else if (msg.op === 'pause') S.playing = false;
      else if (msg.op === 'rate' && RATES.includes(msg.x)) S.rate = msg.x;
      sendJson(socket, state());
    };
    return { seek, tick, onMessage };
  }

  const sfx = (n) => { for (const r of recs) { const w = r.samples.get(n); if (w) return w; } return null; };
  const server = http.createServer((req, res) => {
    if (!loopbackHost(req.headers.host)) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && ['/', '/index.html', '/watch', '/replay'].includes(url.pathname)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(clientHtml());
    }
    const mm = req.method === 'GET' && url.pathname.match(/^\/minimap\/([0-9a-f]{1,16})\/(\d+-\d+-(?:plan|art)\.png)$/);
    if (mm) {
      const png = recs.find((r) => r.boot === mm[1])?.assets.get(`minimap/${mm[2]}`);
      if (!png) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
      return res.end(png);
    }
    const m = req.method === 'GET' && url.pathname.match(/^\/sfx\/(\d+)\.wav$/);
    if (m) {
      const wav = sfx(Number(m[1]));
      if (!wav) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'max-age=86400' });
      return res.end(wav);
    }
    if (serveMedia(req, res, url, { voiceDir, musicDir })) return;
    if (req.method === 'GET' && url.pathname === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ musicBase: musicDir ? '/music/' : '', speed: recs[0].hello.speed ?? recs[0].rec.meta.speed ?? null, replay: true }));
    }
    res.writeHead(404); res.end();
  });

  server.on('upgrade', (req, socket) => {
    const { host, origin } = req.headers;
    const wsUrl = new URL(req.url, 'http://x');
    if (wsUrl.pathname !== '/ws' || !loopbackHost(host) || !origin || origin !== `http://${host}`) { socket.destroy(); return; }
    if (!wsAccept(req, socket)) return;
    const s = session(socket);
    sessions.add(socket);
    sendJson(socket, { t: 'hello', w: W, h: H, keys: [], role: 'watch', live: true, chat: false, commentator: narrated, speed: recs[0].hello.speed ?? recs[0].rec.meta.speed ?? null,
      replay: { recs: recs.map((r) => ({ name: r.name, startT: r.startT, dur: r.durationMs })), rates: RATES } });
    s.seek(0, 0, false);
    const timer = setInterval(() => { try { s.tick(); } catch (err) { log(`[agent-pal] replay: ${err.message}`); socket.destroy(); } }, tickMs);
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      const [msgs, rest] = wsParse(Buffer.concat([pending, chunk])); pending = Buffer.from(rest);
      for (const { opcode, data } of msgs) {
        if (opcode === 8) { socket.end(wsFrame(8, Buffer.alloc(0))); continue; }
        if (opcode === 9) { send(socket, wsFrame(10, data)); continue; }
        if (opcode !== 1) continue;
        let msg; try { msg = JSON.parse(data.toString('utf8')); } catch { continue; }
        try { s.onMessage(msg); } catch (err) { log(`[agent-pal] replay: ${err.message}`); }
      }
    });
    const bye = () => { clearInterval(timer); sessions.delete(socket); };
    socket.on('close', bye); socket.on('error', bye); socket.on('end', bye);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  log(`[agent-pal] replay of ${recs.length} recording(s) on http://127.0.0.1:${actual}/replay`);
  return { server, port: actual, recs, close: () => { for (const c of sessions) c.destroy(); server.close(); } };
}
