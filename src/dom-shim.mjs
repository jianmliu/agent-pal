/**
 * dom-shim — 让浏览器优先的 game-engine 在 Node 里跑起来的最小 DOM 垫片。
 *
 * 引擎到处用 `typeof window !== 'undefined'` 守卫;我们提供一份「在场但是空壳」的
 * window/document/$,让引擎走它已验证的浏览器分支,而所有 DOM 副作用都成 noop。
 * 关键真实对象只有一个:`#cvs` 的假 canvas —— Surface 构造器要 `cvs.getContext('2d')`
 * 非空、`cvs.width/height` 可写;真正的像素呈现被 index.mjs 覆盖 updateScreen 接管,
 * 直接读 surface.byteBuffer,所以 2D 上下文只需是 noop。
 *
 * 必须在任何引擎模块 import 之前求值(index.mjs 设好 PAL_ASSET_BASE 后第一个 import 本文件)。
 */

function makeCtx() {
  const noop = () => undefined;
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'createImageData') {
        // 按真实 w×h 分配(panorama 的整图缓冲靠它);兼容 createImageData(w,h) / (imagedata)
        return (a, b) => { const w = (a && a.width) || a | 0 || 320, h = (a && a.height) || b | 0 || 200; return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; };
      }
      if (prop === 'getImageData') {
        return (x, y, w, h) => ({ data: new Uint8ClampedArray(((w | 0) || 320) * ((h | 0) || 200) * 4), width: (w | 0) || 320, height: (h | 0) || 200 });
      }
      if (prop === 'canvas') return undefined;
      return noop;
    },
    set() { return true; }
  });
}

function makeEl(id = '') {
  return {
    id, tagName: 'DIV', width: 320, height: 200,
    style: {}, dataset: {}, className: '', innerHTML: '', textContent: '',
    children: [], childNodes: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => makeCtx(),
    appendChild: (c) => c, removeChild: (c) => c, insertBefore: (c) => c,
    replaceChildren() {}, remove() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    focus() {}, blur() {}, click() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 320, bottom: 200, width: 320, height: 200, x: 0, y: 0 }),
    toDataURL: () => '', getImageData: () => ({ data: new Uint8ClampedArray(320 * 200 * 4) })
  };
}

const cvsEl = makeEl('cvs');
const elCache = { cvs: cvsEl };
const documentShim = {
  getElementById(id) {
    if (id === 'debug') return null;                 // Surface 把 debugcvs 当可选,null 即跳过
    if (!elCache[id]) elCache[id] = makeEl(id);
    return elCache[id];
  },
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementsByTagName: () => [],
  addEventListener() {}, removeEventListener() {},
  body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'),
  readyState: 'complete', cookie: '', title: ''
};

function makeJQ() {
  const jq = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'length') return 0;
      if (prop === Symbol.iterator) return function* () {};
      return () => jq;            // 任意方法 → 返回自身(链式)
    },
    apply() { return jq; }        // $(sel) 调用 → 返回自身
  });
  return jq;
}

const windowShim = {
  PAL_CLASSIC: true,
  // 让 shouldSuppressLegacyDialog() 返回 true → 对话等待时引擎持续 makeScene(背景不黑)。
  // 不真开 panorama 渲染器(enablePanorama:false),故 surface.updateScreen 不会改道,
  // makeScene 照样画进 byteBuffer,我们的 updateScreen 覆盖照样读到。
  PAL_OVERLAY_ACTIVE: 'panorama',
  PAL_CONFIG: {
    assetBaseUrl: process.env.PAL_ASSET_BASE || 'http://localhost:5189/pal-assets/',
    audioBaseUrl: null,
    enableAudio: false,
    enableTouch: false,
    enablePanorama: false,        // 关 panorama,否则 updateScreen 绕过 byteBuffer 呈现
    mapOverlayMode: 'off',
    enableOverviewMode: false,
    enableModAssets: false,       // 无头不需要 mod 资产(相对 URL fetch 在 Node 抛)
    scriptSource: 'native'        // SSS.MKF 脚本 VM 跑剧情(storygraph JSON 不在 pal-assets)
  },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
  cancelAnimationFrame: (h) => clearTimeout(h),
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (...a) => setInterval(...a),
  clearInterval: (h) => clearInterval(h),
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  navigator: { userAgent: 'node', maxTouchPoints: 0, platform: 'node', language: 'zh-CN' },
  location: { search: '', href: 'http://localhost/', protocol: 'http:', host: 'localhost', hash: '', pathname: '/' },
  devicePixelRatio: 1, innerWidth: 320, innerHeight: 200,
  performance: globalThis.performance,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
windowShim.window = windowShim;
windowShim.document = documentShim;
windowShim.self = windowShim;
windowShim.global = globalThis;

const g = globalThis;
// 对话「按键继续」(dialogWaitForKey)默认拒绝模拟输入(防 autoplay 误跳),无头/自驱
// 必须放行,否则开场叙事的 clearDialog(true) 永远等不到真键 → 卡死。
g.PAL_ALLOW_SIMULATED_DIALOG = true;
// Node 25 把 navigator/performance 等做成只读 getter,直接赋值会抛。用 defineProperty 兜底。
function setGlobal(key, value) {
  try { g[key] = value; }
  catch { try { Object.defineProperty(g, key, { value, configurable: true, writable: true }); } catch { /* 内置只读 → 留用 */ } }
}
setGlobal('window', windowShim);
setGlobal('document', documentShim);
if (!g.navigator) setGlobal('navigator', windowShim.navigator);
if (!g.location) setGlobal('location', windowShim.location);
const jq = makeJQ();
setGlobal('$', jq);
setGlobal('jQuery', jq);
setGlobal('requestAnimationFrame', windowShim.requestAnimationFrame);
setGlobal('cancelAnimationFrame', windowShim.cancelAnimationFrame);
if (!g.localStorage) setGlobal('localStorage', windowShim.localStorage);

// Node 的 fetch 不支持相对 URL(浏览器靠 document.baseURI)。引擎里 storygraph /
// mod-manifest / .RPG 等都用相对路径 → Node 全炸。包一层把非绝对 URL 解析到资源 origin。
const ASSET_BASE = windowShim.PAL_CONFIG.assetBaseUrl;
const ORIGIN = (() => { try { return new URL(ASSET_BASE).origin + '/'; } catch { return 'http://localhost:5189/'; } })();
const origFetch = globalThis.fetch;
if (origFetch) {
  g.fetch = (input, init) => {
    if (typeof input === 'string' && !/^https?:\/\//i.test(input)) {
      try { input = new URL(input, ORIGIN).href; } catch { /* 留原样 */ }
    }
    return origFetch(input, init);
  };
}

export const cvsCanvas = cvsEl;
