import {AsyncResource} from 'node:async_hooks';
/**
 * clock — 确定性模式:虚拟时钟 + 本地资源 fetch。
 *
 * 引擎的时间全部来自全局 setTimeout / Date / performance.now(dom-shim 的 rAF 也是 setTimeout),
 * 资源全部经 fetch 从资产服务拉。确定性模式下:
 *  - 接管上述全局:计时器按(到期时间, 登记顺序)逐个触发,每触发一个就让微任务跑干净。
 *    帧节奏、动画、按键时长都变成逻辑时间,与机器快慢无关。
 *  - 资产 URL 的 fetch 改为同步读盘、立即返回 Response —— 没有真实 I/O 掺进时序。
 *  - 时间只在 drive(promise) 期间推进(锁步):工具调用之间游戏静止,LLM 想多久都行。
 * 配合引擎 services.random.setSeed:同存档 + 同种子 + 同指令序列 ⇒ 同一条轨迹。
 */
import fs from 'node:fs';
import path from 'node:path';

const EPOCH = Date.UTC(2026, 0, 1);          // 虚拟纪元:存档时间戳等也确定

export function installVirtualClock({presentationPace='fast'}={}) {
  const real = {
    setTimeout: globalThis.__agentPalRealSetTimeout || globalThis.setTimeout,
    setImmediate: globalThis.setImmediate,
    Date: globalThis.Date
  };
  globalThis.__agentPalRealSetTimeout = real.setTimeout;
  let owners=0,maxOwners=0;
  if(!['fast','realtime'].includes(presentationPace))throw new TypeError('invalid presentation pace');
  let now = 0;                                // 虚拟毫秒,可为小数(引擎按 FrameTime/GameSpeed 算)
  let seq = 0;
  let fired = 0;
  let holds = 0;                              // 进行中的真实 I/O(动态 import 等):期间不推进虚拟时间
  let trace=null;
  const record=event=>{if(trace)trace.events.push(event);};
  const timers = new Map();                   // id → { due, order, fn, args, interval }

  const handle = (id) => ({
    id,
    ref() { return this; },
    unref() { return this; },
    hasRef() { return true; },
    refresh() { const t = timers.get(id); if (t) { t.due = now + t.delay; t.order = ++seq; if(trace)record({kind:'refresh',id,now,delay:t.delay,due:t.due,order:t.order}); } return this; },
    [Symbol.toPrimitive]() { return id; }
  });
  const idOf = (h) => (h && typeof h === 'object' ? h.id : h);
  function schedule(fn, ms, args, interval) {
    if (typeof fn !== 'function') return handle(0);
    const delay = Math.max(0, Number(ms) || 0);
    const id = ++seq;
    timers.set(id, { due: now + delay, delay, order: id, fn: AsyncResource.bind(fn), args, interval });
    if(trace)record({kind:'schedule',id,now,delay,due:now+delay,order:id,interval});
    return handle(id);
  }
  function next() {
    let best = null;
    for (const [id, t] of timers) {
      if (!best || t.due < best.t.due || (t.due === best.t.due && t.order < best.t.order)) best = { id, t };
    }
    return best;
  }

  globalThis.setTimeout = (fn, ms, ...args) => schedule(fn, ms, args, false);
  globalThis.setInterval = (fn, ms, ...args) => schedule(fn, ms, args, true);
  globalThis.clearTimeout = globalThis.clearInterval = (h) => {const id=idOf(h);if(trace)record({kind:'cancel',id,now,existed:timers.has(id)});timers.delete(id);};

  class VirtualDate extends real.Date {
    constructor(...a) { if (a.length === 0) super(EPOCH + Math.floor(now)); else super(...a); }
    static now() { return EPOCH + Math.floor(now); }
  }
  globalThis.Date = VirtualDate;
  Object.defineProperty(globalThis.performance, 'now', { value: () => now, configurable: true, writable: true });

  const turn = () => new Promise((r) => real.setImmediate(r));   // 一个真实宏任务 = 微任务全部跑完

  /** 推进虚拟时间直到 promise 落定。期间若既无计时器又未落定,说明在等真实 I/O:按真实时间小等。 */
  async function drive(promise) {
    // Reentrant calls join the existing pump: never run two timer consumers.
    if(owners)return await promise;
    owners=1;maxOwners=Math.max(maxOwners,owners);
    try{return await pump(promise);}finally{owners=0;}
  }
  async function pump(promise) {
    let done = false, failed = false, value, error;
    Promise.resolve(promise).then((v) => { done = true; value = v; }, (e) => { done = true; failed = true; error = e; });
    let idleTurns = 0;
    while (true) {
      await turn();
      if (done) break;
      if (holds > 0) { await new Promise((r) => real.setTimeout(r, 1)); continue; }
      const n = next();
      if (!n) {
        if (++idleTurns > 20000) throw new Error('virtual clock: no timers pending and the awaited work never settled');
        await new Promise((r) => real.setTimeout(r, 1));
        continue;
      }
      idleTurns = 0;
      const { id, t } = n;
      const due = t.due,before=now,order=t.order;
      if(presentationPace==='realtime'&&due>now){
        await new Promise(r=>real.setTimeout(r,due-now));
        // A real I/O continuation may cancel or replace this timer while pacing.
        if(done||holds>0||timers.get(id)!==t||t.due!==due||next()?.id!==id){continue;}
      }
      if (t.interval) { t.due += Math.max(1, t.delay); t.order = ++seq; } else timers.delete(id);
      now = Math.max(now, due);
      fired++;
      if(trace)record({kind:'fire',id,due,order,before,now,nextOrder:t.interval?t.order:null,nextDue:t.interval?t.due:null});
      try { t.fn(...(t.args || [])); }
      catch (e) { process.stderr.write(`[clock] timer threw: ${e && e.stack ? e.stack : e}\n`); }
    }
    if (failed) throw error;
    return value;
  }

  /** 标记一段真实 I/O:落定前 drive 不推进虚拟时间,免得时间流逝取决于磁盘/模块加载快慢。 */
  function hold(promise) {
    holds++;
    return Promise.resolve(promise).finally(() => { holds--; });
  }

  return {
    drive,
    hold,
    now: () => now,
    stats: () => ({ now, fired, pending: timers.size, owners, maxOwners }),
    enableTrace:()=>{trace={epoch:EPOCH,initialNow:now,initialSeq:seq,initialTimers:[...timers].map(([id,t])=>({id,due:t.due,delay:t.delay,order:t.order,interval:t.interval})),events:[]};},
    traceIndex:()=>trace?.events.length??null,
    trace:()=>trace?{...trace,initialTimers:trace.initialTimers.map(t=>({...t})),events:trace.events.map(event=>({...event}))}:null
  };
}

/** 资产 URL 的 fetch 直接读盘(同资产服务的路径映射与大小写兜底),其余 URL 交给原 fetch。 */
export function installLocalAssetFetch(assetBase, assetDir) {
  const prev = globalThis.fetch;
  const resolveFile = (rel) => {
    let file = path.join(assetDir, rel.replace(/\.\.[/\\]/g, ''));
    if (fs.existsSync(file)) return file;
    try {
      const dir = path.dirname(file), base = path.basename(file).toLowerCase();
      const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === base);
      if (hit) return path.join(dir, hit);
    } catch { /* 目录不存在 */ }
    return null;
  };
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    let abs = url;
    try { abs = new URL(url, assetBase).href; } catch { /* 留原样 */ }
    if (!abs.startsWith(assetBase)) return prev(input, init);
    const rel = decodeURIComponent(abs.slice(assetBase.length).split('?')[0]);
    const file = resolveFile(rel);
    if (!file) return Promise.resolve(new Response(null, { status: 404 }));
    const buf = fs.readFileSync(file);
    return Promise.resolve(new Response(buf, { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
  };
}
