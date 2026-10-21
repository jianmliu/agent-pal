/**
 * pal-host —— 远程屏幕(docs/specs/pal-companion.md P1)。
 *
 * 游戏只在这个 node 进程里跑一份(实时时钟,与 agent 工具面是同一局);浏览器只是远程的屏幕 / 键盘 / 扬声器:
 *   GET  /            远程屏幕页面(host-client.html):能按键,自己玩
 *   GET  /watch       观战页(同一个页面):只看不按 —— 服务端对 ?role=watch 的连接一律不收按键
 *   GET  /minimap/<启动标识>/<场景>-<版本>-<plan|art>.png  小地图底图(当前场景:实景图 / 兜底的平面图;见 minimap.mjs)
 *   POST /speed {"x": 2} 或 {"x": {"scene": 2, "battle": 1}}  调游戏倍速(1 = 原版速度;场景、战斗可分开;
 *                     只收本机、非跨源的 JSON 请求)—— 全员观战时主持人用它调
 *   POST /live/thought {"text": …}  AI 的想法(模型在工具调用之间写的话),由跑 AI 的一端推过来(scripts/live-narrate.mjs);
 *                     只收本机、非浏览器跨源的 JSON 请求
 *   POST /live/commentary {"kind": "comment" | "chapter", "text": …, "title"?, "chapter"?, "audio"?, "audioMs"?}
 *                     解说进程(「文官」)推来的解说 / 章节小结;audio 是配音文件名。安全检查同 /live/thought
 *   GET  /voice/<名字>.m4a  解说的配音(AGENT_PAL_VOICE_DIR 目录下的文件;只认文件名,不认路径)
 *   GET  /music/<曲号>.mp3  游戏音乐(AGENT_PAL_MUSIC_DIR 目录下的文件;设了它页面就从这里取音乐,见 scripts/music-from-midi.mjs)
 *   录制(record = 文件路径):把发给观众的画面(调色板索引帧 + 调色板)和音效 / 音乐事件边跑边写进回放文件(palrec.mjs),
 *                     事后用 scripts/palrec-export.mjs 转成视频。发给观战页的消息(时间线、状态栏、小地图)和小地图底图也录进去,
 *                     事后能把整个观战页重放一遍(replay.mjs / scripts/palrec-replay.mjs)。不开就没有任何额外开销
 *   GET  /sfx/<n>.wav 第 n 个音效(VOC.MKF 解码成 16 位 WAV,浏览器缓存后自己播)
 *   WS   /ws          host → 浏览器:二进制 帧(1)/ 调色板(2),JSON 声音 / 控制 / 直播;浏览器 → host:JSON 按键 / 聊天 / ping
 *
 * 直播(live = live.mjs 的中枢):AI 每次工具调用的开始 / 结束、AI 与观众的聊天转播给所有浏览器(新来的先补看最近的);
 * 观众发言交给中枢,AI 用 chat 工具读。
 *
 * 帧和调色板都按「这个浏览器手上那一份」做增量(encodeDelta):没变 → 空;变了 → 与上一份异或后 deflate,
 * 比整帧 deflate 还大(换场)就发整帧。实测走路 / 对白平均每帧约 1KB(原始 64000 字节)。
 *   帧:    [1][u32 引擎帧号][i8 震屏][u32 输入回执][u8 编码][数据]
 *   调色板:[2][u8 编码][数据(768 字节 RGB)]
 *
 * 只听 127.0.0.1;WebSocket 只接受本页面(同源 Origin)发起的连接 —— 别的网页不能借浏览器来按键。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { sceneName } from './scene-names.mjs';
import { createMinimap } from './minimap.mjs';
import { VOICE_FILE } from './live.mjs';
import { createRecorder } from './palrec.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 320, H = 200;
export const MSG_FRAME = 1, MSG_PALETTE = 2;
/** 增量编码:SAME = 与对方手上那份一样(没有数据);KEY = deflate(整份);XOR = deflate(这份 ^ 对方那份) */
export const ENC_SAME = 0, ENC_KEY = 1, ENC_XOR = 2;
const FRAME_HEAD = 11, PAL_HEAD = 2;
/** 浏览器发来的按键名 = 引擎 Key 枚举名 */
export const KEY_NAMES = ['Up', 'Down', 'Left', 'Right', 'Search', 'Menu', 'PageUp', 'PageDown', 'Home', 'End', 'Repeat', 'Auto', 'Defend', 'UseItem', 'ThrowItem', 'Flee', 'Status', 'Force'];

// ---- 最小 WebSocket(RFC 6455):握手、收短文本帧、发文本 / 二进制 --------------------------------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  return true;
}

export function wsFrame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255])
      : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}

/** 解析客户端发来的(带掩码)帧;返回 [消息..., 剩余字节]。只处理不分片的帧(浏览器发的短 JSON 都是) */
export function wsParse(buf) {
  const out = [];
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length < p + 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length < p + len) break;
    const data = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    out.push({ opcode, data });
    off = p + len;
  }
  return [out, buf.subarray(off)];
}

/** Host 头是不是回环地址本身(127.0.0.1 / localhost / [::1],可带端口) */
export const loopbackHost = (host) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(host || ''));

// ---- 帧 / 调色板增量编码 ---------------------------------------------------------------------------------
const deflate = (b) => zlib.deflateRawSync(b, { level: 1 });     // level 1:≈0.05ms/帧,比 6 只大一点

/** cur 对照 ref(对方手上那份,没有就 null)编码成 { enc, data } */
export function encodeDelta(cur, ref) {
  if (ref && ref.length === cur.length) {
    if (cur.equals(ref)) return { enc: ENC_SAME, data: Buffer.alloc(0) };
    const x = Buffer.allocUnsafe(cur.length);
    for (let i = 0; i < cur.length; i++) x[i] = cur[i] ^ ref[i];
    const xd = deflate(x);
    if (xd.length < cur.length >> 3) return { enc: ENC_XOR, data: xd };   // 小增量直接用,不必再算整份
    const kd = deflate(cur);
    return kd.length < xd.length ? { enc: ENC_KEY, data: kd } : { enc: ENC_XOR, data: xd };
  }
  return { enc: ENC_KEY, data: deflate(cur) };
}

/** encodeDelta 的逆(测试 / node 客户端用;浏览器端在 host-client.html 里用 DecompressionStream) */
export function decodeDelta(enc, data, ref, len) {
  if (enc === ENC_SAME) return Buffer.from(ref);
  const raw = zlib.inflateRawSync(data);
  if (raw.length !== len) throw new Error(`delta: got ${raw.length} bytes, want ${len}`);
  if (enc === ENC_KEY) return raw;
  if (enc !== ENC_XOR || !ref) throw new Error(`delta: bad encoding ${enc}`);
  for (let i = 0; i < len; i++) raw[i] ^= ref[i];
  return raw;
}

// ---- 声音:VOC → WAV --------------------------------------------------------------------------------------
function pcmToWav({ sampleRate, channels, samples }) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

/**
 * 解说的配音(解说进程把合成好的 .m4a 写进 voiceDir)和游戏音乐(musicDir 里的 <曲号>.mp3):都只按文件名(不含路径)提供。
 * 是这两类地址就答掉并返回 true(replay.mjs 也用)
 */
export function serveMedia(req, res, url, { voiceDir = '', musicDir = '' } = {}) {
  const vm = req.method === 'GET' && url.pathname.match(/^\/(voice|music)\/([^/]+)$/);
  if (!vm) return false;
  const [dir, ok, type] = vm[1] === 'voice' ? [voiceDir, VOICE_FILE.test(vm[2]), 'audio/mp4'] : [musicDir, /^\d{1,4}\.mp3$/.test(vm[2]), 'audio/mpeg'];
  let buf = null;
  if (dir && ok) { try { const f = path.join(dir, vm[2]); if (fs.statSync(f).size <= 16 << 20) buf = fs.readFileSync(f); } catch { /* 没有这个文件 */ } }
  if (!buf) { res.writeHead(404); res.end(); return true; }
  const head = { 'content-type': type, 'cache-control': 'max-age=3600', 'accept-ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');                      // 有的浏览器取媒体文件一定带 Range
  if (range && (range[1] || range[2])) {
    const from = range[1] ? Number(range[1]) : Math.max(0, buf.length - Number(range[2])), to = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (from > to || from >= buf.length) { res.writeHead(416, { 'content-range': `bytes */${buf.length}` }); res.end(); return true; }
    res.writeHead(206, { ...head, 'content-range': `bytes ${from}-${to}/${buf.length}`, 'content-length': to - from + 1 });
    res.end(buf.subarray(from, to + 1)); return true;
  }
  res.writeHead(200, { ...head, 'content-length': buf.length });
  res.end(buf); return true;
}

/**
 * 起 pal-host。e = bootEngine() 的引擎(实时模式);返回 { server, port, close, stats }。
 */
export async function startHost(e, { port = 8090, live = null, readonly = false, agent = null, voiceDir = process.env.AGENT_PAL_VOICE_DIR || '', musicDir = process.env.AGENT_PAL_MUSIC_DIR || '', record = null, recordFps = Number(process.env.AGENT_PAL_RECORD_FPS) || 30, recordMeta = {}, log = (s) => process.stderr.write(s + '\n') } = {}) {
  // 字面量 import:打包版(scripts/pack-npx.mjs)里 esbuild 才会把它们打进同一个文件(与引擎共用模块实例)
  const sound = (await import('@onchainpal/game-engine/js/pal/sound')).default;
  const music = (await import('@onchainpal/game-engine/js/pal/music')).default;
  const resourceService = (await import('@onchainpal/game-engine/services/resource-service')).default;
  const { decodeSoundChunk } = await import('@onchainpal/game-engine/services/voc');
  const clientHtml = () => fs.readFileSync(path.join(here, 'host-client.html'));   // 每次现读:改页面不用重启这一局

  const clients = new Set();
  const send = (c, buf) => { if (!c.destroyed) c.write(buf); };
  const broadcastJson = (obj) => { const f = wsFrame(1, Buffer.from(JSON.stringify(obj))); for (const c of clients) send(c, f); };
  const sendJson = (c, obj) => send(c, wsFrame(1, Buffer.from(JSON.stringify(obj))));
  const audience = () => { let watchers = 0; for (const c of clients) if (c.watch) watchers++; return { t: 'viewers', n: clients.size, watchers }; };
  /** 调倍速(引擎说了算:确定性模式不让调,不合法的不收);变了就告诉所有浏览器 */
  const setSpeed = (x) => {
    if (typeof e.setSpeed !== 'function' || !e.validSpeed?.(x)) return false;
    const before = JSON.stringify(e.speed), after = e.setSpeed(x);
    if (JSON.stringify(after) !== before) { broadcastJson({ t: 'speed', x: after }); rec?.page({ t: 'speed', x: after }); }
    return true;
  };
  const unsubscribe = live ? live.subscribe((ev) => { broadcastJson({ t: 'live', ...ev }); rec?.page({ t: 'live', ...ev }); }) : () => {};

  // ---- 声音事件:包一层引擎的 sound.play / music.play / music.stop(无头模式下它们本来就不出声) ----
  let musicNow = { music: 0, loop: true };
  const origSfx = sound.play.bind(sound), origPlay = music.play.bind(music), origStop = music.stop.bind(music);
  sound.play = (n, ...rest) => { if (n > 0) { broadcastJson({ t: 'audio', sfx: n }); recSfx(n); } return origSfx(n, ...rest); };
  music.play = (track, loop = true, ...rest) => { musicNow = { music: track | 0, loop: loop !== false }; broadcastJson({ t: 'audio', ...musicNow }); rec?.audio(musicNow); return origPlay(track, loop, ...rest); };
  music.stop = (...rest) => { musicNow = { music: 0, loop: true }; broadcastJson({ t: 'audio', music: 0 }); rec?.audio({ music: 0 }); return origStop(...rest); };

  // ---- 画面:引擎每出一帧就(合并到本轮事件循环末尾)推最新一帧;浏览器跟不上就丢帧,不排队 ----
  let surface = null, shake = 0, frames = 0, sentFrames = 0, lastInputId = 0, bytesOut = 0;
  const prevOnFrame = e.probes.onFrame;
  let flushQueued = false;
  e.probes.onFrame = (s, sh = 0) => {
    surface = s; shake = sh; frames++; prevOnFrame?.(s, sh);
    if (rec) recFrame(s, sh);
    try { minimap.sample(); } catch { /* 小地图出错不影响画面 */ }
    if (!flushQueued && clients.size) { flushQueued = true; setImmediate(() => { flushQueued = false; flush(); }); }
  };
  const paletteRgb = (pal) => { const b = Buffer.alloc(768); for (let i = 0; i < 256; i++) { const c = pal?.[i] || { r: 0, g: 0, b: 0 }; b[i * 3] = c.r; b[i * 3 + 1] = c.g; b[i * 3 + 2] = c.b; } return b; };
  /** 同一拍里,手上那份相同的浏览器共用一次编码(一般大家都一样) */
  const encoder = (cur, wrap) => { const memo = new Map(); return (ref) => { let m = memo.get(ref ?? null); if (!m) { const { enc, data } = encodeDelta(cur, ref); m = wsFrame(2, wrap(enc, data)); memo.set(ref ?? null, m); } return m; }; };
  const flush = () => {
    if (!surface || !clients.size) return;
    // 淡入淡出只改调色板、不出新帧(fadeIn / fadeOut 原地改同一个数组:按内容比,不按引用),所以调色板每拍都看
    const pal = paletteRgb(surface.palette);
    const palMsg = encoder(pal, (enc, data) => Buffer.concat([Buffer.from([MSG_PALETTE, enc]), data]));
    let img = null, frameMsg = null;
    for (const c of clients) {
      const palDue = !c.pal || !pal.equals(c.pal), frameDue = c.sentFrame !== frames;
      if (!palDue && !frameDue) continue;
      if (c.writableLength > 512 * 1024) continue;        // 这个浏览器跟不上:丢这一拍,下一拍对着它手上那份发当时最新的
      if (palDue) { const m = palMsg(c.pal); send(c, m); bytesOut += m.length; c.pal = pal; }
      if (frameDue) {
        if (!frameMsg) {
          img = Buffer.from(surface.byteBuffer.subarray(0, W * H));
          const head = Buffer.alloc(FRAME_HEAD - 1);
          head[0] = MSG_FRAME; head.writeUInt32LE(frames >>> 0, 1); head.writeInt8(Math.max(-127, Math.min(127, shake)), 5); head.writeUInt32LE(lastInputId >>> 0, 6);
          frameMsg = encoder(img, (enc, data) => Buffer.concat([head, Buffer.from([enc]), data]));
        }
        const m = frameMsg(c.img); send(c, m); bytesOut += m.length; c.img = img; c.sentFrame = frames;
      }
    }
    if (frameMsg) sentFrames++;
  };
  const pushTimer = setInterval(flush, 33);                // 兜底:淡入淡出期间引擎不出帧,只改调色板

  // ---- 录制:画面在引擎出帧的那一刻取(这时一定是画完的一帧),最多每秒 recordFps 帧;声音记事件 ----
  const rec = record ? createRecorder(record, { w: W, h: H, fps: recordFps, speed: e.speed, fleeGrace: e.fleeGrace ?? null, ...recordMeta,
    onError: (err) => log(`[agent-pal] recording stopped: ${err.message}`) }) : null;
  const recEvery = 1000 / recordFps;
  let recAt = 0, recHeld = null;                           // recHeld = 来得太密、还没写的最新一帧(之后画面停住的话要补上它)
  const recWrite = (img, sh) => { rec.palette(paletteRgb(surface.palette)); rec.frame(img, sh); recAt = Date.now(); recHeld = null; };
  const recFrame = (s, sh) => {
    const img = Buffer.from(s.byteBuffer.subarray(0, W * H));
    if (Date.now() - recAt >= recEvery - 2) recWrite(img, sh); else recHeld = { img, sh };
  };
  /** 音效:记事件;这个音效的波形第一次响时也存一份(回放文件自己就能出声) */
  const recSfx = (n) => {
    if (!rec) return;
    rec.audio({ sfx: n });
    if (!rec.hasSample(n)) sfxWav(n).then((wav) => rec.sample(n, wav)).catch(() => {});
  };
  // 兜底:补上被压下的那一帧;淡入淡出只改调色板
  const recTimer = rec ? setInterval(() => {
    if (!surface) return;
    if (recHeld && Date.now() - recAt >= recEvery - 2) recWrite(recHeld.img, recHeld.sh); else rec.palette(paletteRgb(surface.palette));
  }, recEvery) : null;
  if (rec) { rec.audio(musicNow); rec.page({ t: 'hello', live: !!live, commentator: !!live?.commentator, speed: e.speed }); }

  // ---- 小地图:底图走 HTTP(换场景才变),位置 / 新走过的格子 / 出口每 250ms 推一次(有变化才推) ----
  const minimap = createMinimap(e, { agent });
  /** 给一个看的人(c 记着它手上有什么)算这一拍的小地图消息;没变化就 null */
  const mapMsg = (c, st, exitsText) => {
    const fresh = c.mapKey !== `${st.scene}-${st.v}`;                 // 连接是这个进程里的,不用带启动标识
    if (fresh) { c.mapKey = `${st.scene}-${st.v}`; c.trailSent = 0; c.mapPos = ''; c.mapExits = ''; }
    const add = st.cells > c.trailSent ? minimap.trail(st.scene, c.trailSent) : [];
    const posText = JSON.stringify(st.pos), exitsChanged = exitsText !== c.mapExits;
    if (!fresh && !add.length && posText === c.mapPos && !exitsChanged) return null;
    c.trailSent = st.cells; c.mapPos = posText; c.mapExits = exitsText;
    return { t: 'map', scene: st.scene, v: st.v, boot: st.boot, place: st.place, fresh, pos: st.pos, add, ...(fresh ? { views: st.views } : {}), ...(fresh || exitsChanged ? { exits: st.exits } : {}) };
  };
  const recMap = {};                                       // 录像也算一个「看的人」:它手上的小地图
  const mapTimer = setInterval(() => {
    if (!clients.size && !rec) return;
    const st = minimap.state(); if (!st) return;
    const exitsText = JSON.stringify(st.exits);
    for (const c of clients) { const m = mapMsg(c, st, exitsText); if (m) sendJson(c, m); }
    if (rec) {
      const m = mapMsg(recMap, st, exitsText);
      if (m) {
        if (m.fresh) for (const name of Object.keys(st.views)) rec.asset(`minimap/${st.scene}-${st.v}-${name}.png`, minimap.png(st.scene, name));
        rec.page(m);
      }
    }
  }, 250);
  const mapTick = setInterval(() => { minimap.tick().catch(() => {}); }, 1000);

  // ---- 状态栏:队伍(等级、HP / MP)、银两、场景、开播以来的统计;每秒看一次,变了才推 ----
  const snapshot = () => {
    const ws = e.worldService, out = { t: 'status', party: [], cash: null, scene: null, inBattle: false, stats: live ? live.stats() : null };
    try {
      const members = ws.getParty() || [], n = Math.max(0, (ws.getMaxPartyMemberIndex?.() ?? members.length - 1) + 1);
      for (let i = 0; i < Math.min(n, members.length); i++) {
        const role = members[i]?.playerRole;
        if (typeof role !== 'number') continue;
        const f = (k) => ws._getPlayerRoleArrayValue(k, role, null);
        out.party.push({ name: e.word?.(f('name')) || `role${role}`, level: f('level'), hp: f('HP'), maxHp: f('maxHP'), mp: f('MP'), maxMp: f('maxMP') });
      }
      out.cash = ws.getCash?.() ?? null; out.scene = ws.getSceneId?.() ?? null; out.inBattle = !!ws.isInBattle?.();
      out.place = sceneName(out.scene);                    // 地名(scene-names.mjs);表里没有就 null,页面退回显示场景号
    } catch { /* 还没进游戏(标题画面):队伍为空 */ }
    return out;
  };
  let lastStatus = '';
  const statusTimer = setInterval(() => {
    if (!clients.size && !rec) return;
    const text = JSON.stringify(snapshot());
    if (text === lastStatus) return;
    lastStatus = text;
    rec?.page(JSON.parse(text));
    const f = wsFrame(1, Buffer.from(text));
    for (const c of clients) send(c, f);
  }, 1000);

  // ---- 按键:按名字查引擎 Key 枚举;按下 / 松开分开(保留长按走路的手感) ----
  const input = e.inputService, Key = e.Key;
  const held = new Map();                                  // 每个连接按着的键,断线时全部松开
  const keyEvent = (c, name, down, id) => {
    const k = Key?.[name];
    if (c.watch || !KEY_NAMES.includes(name) || typeof k !== 'number') return;   // 观战连接只看不按
    const mine = held.get(c);
    if (down) { if (mine.has(name)) return; mine.add(name); input.pressKey(k); }
    else { if (!mine.delete(name)) return; input.releaseKey(k); }
    if (Number.isFinite(id)) lastInputId = id >>> 0;
  };
  const releaseAll = (c) => { for (const name of held.get(c) || []) input.releaseKey(Key[name]); held.delete(c); };

  const sfxCache = new Map();
  const sfxWav = async (n) => {
    if (sfxCache.has(n)) return sfxCache.get(n);
    // 同 sound.ts 的 loadArchive:getMKF 可能给个空壳(还没真正读进来),要看块数
    const usable = (m) => m && typeof m.readChunk === 'function' && m.getChunkCount() > 0;
    let mkf = resourceService.getMKF('VOC');
    if (!usable(mkf)) mkf = await resourceService.loadMKF('VOC');
    if (!usable(mkf) || n >= mkf.getChunkCount()) return null;
    const raw = mkf.readChunk(n); const pcm = raw && decodeSoundChunk(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
    const wav = pcm ? pcmToWav(pcm) : null;
    sfxCache.set(n, wav);
    return wav;
  };

  const server = http.createServer(async (req, res) => {
    if (!loopbackHost(req.headers.host)) { res.writeHead(403); return res.end(); }   // 同样挡 DNS 重绑定(音效是游戏资产,不外泄)
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/watch')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(clientHtml());
    }
    const mm = req.method === 'GET' && url.pathname.match(/^\/minimap\/(?:[0-9a-f]{1,16}\/)?(\d+)-(\d+)-(plan|art)\.png$/);
    if (mm) {
      const png = minimap.png(Number(mm[1]), mm[3]);
      if (!png) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
      return res.end(png);
    }
    const m = req.method === 'GET' && url.pathname.match(/^\/sfx\/(\d+)\.wav$/);
    if (m) {
      try { const wav = await sfxWav(Number(m[1])); if (wav) { res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'max-age=86400' }); return res.end(wav); } } catch (err) { log(`[agent-pal] sfx ${m[1]}: ${err.message}`); }
      res.writeHead(404); return res.end();
    }
    if (url.pathname === '/speed') {
      const origin = req.headers.origin;
      if (req.method !== 'POST' || (origin && origin !== `http://${req.headers.host}`) || !/^application\/json\b/i.test(req.headers['content-type'] || '')) { res.writeHead(403); return res.end(); }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (d) => { body += d; if (body.length > 1024) req.destroy(); });
      req.on('end', () => {
        let x; try { x = JSON.parse(body).x; } catch { /* */ }
        const ok = x !== undefined && setSpeed(x);
        res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: !!ok, speed: e.speed }));
      });
      return;
    }
    if (url.pathname === '/live/thought' || url.pathname === '/live/commentary') {
      // 带 Origin 却不同源 = 别的网页在借浏览器发请求:拒(同 --http 的 /rpc);要求 JSON,跨源时浏览器先发预检,我们不答 CORS
      const origin = req.headers.origin;
      if (req.method !== 'POST' || !live || (origin && origin !== `http://${req.headers.host}`) || !/^application\/json\b/i.test(req.headers['content-type'] || '')) { res.writeHead(403); return res.end(); }
      const commentary = url.pathname === '/live/commentary';
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (d) => { body += d; if (body.length > 16384) req.destroy(); });
      req.on('end', () => {
        let msg = null;
        try { msg = JSON.parse(body); } catch { /* */ }
        const ev = !msg || typeof msg.text !== 'string' ? null : commentary ? live.commentary(msg) : live.thought(msg.text);
        res.writeHead(ev ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: !!ev }));
      });
      return;
    }
    if (serveMedia(req, res, url, { voiceDir, musicDir })) return;
    if (req.method === 'GET' && url.pathname === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      // 音乐:给了 musicDir 就由 host 自己发(/music/<曲号>.mp3);否则照旧去资源目录的 MP3/ 下找
      return res.end(JSON.stringify({ musicBase: musicDir ? '/music/' : (process.env.PAL_ASSET_BASE || '').replace(/\/?$/, '/') + 'MP3/', speed: e.speed, fleeGrace: e.fleeGrace ?? null }));
    }
    res.writeHead(404); res.end();
  });

  server.on('upgrade', (req, socket) => {
    const { host, origin } = req.headers;
    // 只认本页面:Host 必须是回环地址本身(挡 DNS 重绑定 —— evil.com 解析到 127.0.0.1 时 Host / Origin 都是 evil.com,
    // 光比同源会放进来),Origin 还得与 Host 同源(别的网页连不进来驱动游戏)
    const wsUrl = new URL(req.url, 'http://x');
    if (wsUrl.pathname !== '/ws' || !loopbackHost(host) || !origin || origin !== `http://${host}`) { socket.destroy(); return; }
    if (!wsAccept(req, socket)) return;
    socket.watch = readonly || wsUrl.searchParams.get('role') === 'watch';
    clients.add(socket); held.set(socket, new Set());
    sendJson(socket, { t: 'hello', w: W, h: H, keys: KEY_NAMES, role: socket.watch ? 'watch' : 'play', live: !!live, chat: !!live?.viewerChat, commentator: !!live?.commentator, speed: e.speed });
    if (live) sendJson(socket, { t: 'history', events: live.history(), chapters: live.chapters() });
    sendJson(socket, snapshot());
    broadcastJson(audience());
    socket.pal = null; socket.img = null; socket.sentFrame = -1;   // 新来的浏览器下一拍就拿到整份调色板 + 当前画面
    if (musicNow.music) send(socket, wsFrame(1, Buffer.from(JSON.stringify({ t: 'audio', ...musicNow }))));
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      const [msgs, rest] = wsParse(Buffer.concat([pending, chunk])); pending = Buffer.from(rest);
      for (const { opcode, data } of msgs) {
        if (opcode === 8) { socket.end(wsFrame(8, Buffer.alloc(0))); continue; }
        if (opcode === 9) { send(socket, wsFrame(10, data)); continue; }
        if (opcode !== 1) continue;
        let msg; try { msg = JSON.parse(data.toString('utf8')); } catch { continue; }
        if (msg.t === 'key') keyEvent(socket, String(msg.key), !!msg.down, Number(msg.id));
        else if (msg.t === 'speed' && !socket.watch) setSpeed(msg.x);        // 在玩的人可以调倍速;观战的不行
        else if (msg.t === 'chat' && live?.viewerChat) {
          const now = Date.now();                          // 一个连接每秒最多一句
          if (now - (socket.lastChat || 0) < 1000) { sendJson(socket, { t: 'chat-throttled' }); continue; }
          socket.lastChat = now;
          live.viewerSay(msg.from, msg.text);
        }
        else if (msg.t === 'ping') send(socket, wsFrame(1, Buffer.from(JSON.stringify({ t: 'pong', ts: msg.ts, frames, sentFrames, bytesOut }))));
      }
    });
    const bye = () => { if (clients.delete(socket)) { releaseAll(socket); broadcastJson(audience()); } };
    socket.on('close', bye); socket.on('error', bye); socket.on('end', bye);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  log(`[agent-pal] pal-host remote screen on http://127.0.0.1:${actual}/`);
  if (rec) log(`[agent-pal] recording → ${record} (≤ ${recordFps} fps)`);
  return {
    server, port: actual,
    stats: () => ({ frames, sentFrames, clients: clients.size, lastInputId, bytesOut }),
    minimap,
    recording: rec ? { file: record, stats: rec.stats } : null,
    close: () => { unsubscribe(); clearInterval(recTimer); rec?.close(); clearInterval(mapTimer); clearInterval(mapTick); clearInterval(statusTimer); clearInterval(pushTimer); for (const c of clients) c.destroy(); server.close(); sound.play = origSfx; music.play = origPlay; music.stop = origStop; e.probes.onFrame = prevOnFrame; }
  };
}
