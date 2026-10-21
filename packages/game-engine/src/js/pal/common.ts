import { sprintf } from 'sprintf-js';
import { random } from '../../services/random.js';

const globalScope = globalThis as any;

globalScope.PAL_CLASSIC = true;
globalScope.INVINCIBLE = false;
globalScope.SUPER_ATTACK = false;
globalScope.SUPER_DEFENSE = false;

const slice = Array.prototype.slice;

/**
 * DEBUG配置
 * @global
 * @type {Object}
 */
globalScope.DEBUG = {
  Timing: true,
  ShowSpriteRect: false,
  ShowSpritePos:  false,
  ShowSpriteSize: false,
};

const logLevelMap: string[] = [];

globalScope.LogLevel = {
  Trace: 0,
  Debug: 1,
  Notice: 2,
  Warning: 3,
  Fatal: 4
};

/** @type {any} */
export const log = globalScope.log = {
  level: 2,
  write: function(level: number, ...args: any[]) {
    if (level < log.level) return;
    const str = sprintf.apply(this, args as [string, ...any[]]);
    console.log('[' + logLevelMap[level] + '] ' + str);
  }
} as any;

for (let name in globalScope.LogLevel) {
  const level = globalScope.LogLevel[name];
  logLevelMap[level] = name;
  name = name.toLowerCase();
  log[name] = log.write.bind(log, level);
}

// Backward-compatible aliases.
if (typeof log.warn === 'undefined' && typeof log.warning === 'function') {
  log.warn = log.warning;
}
if (typeof log.info === 'undefined' && typeof log.notice === 'function') {
  log.info = log.notice;
}

log.level = globalScope.LogLevel.Debug;

/**
 * 游戏速度倍率
 * @global
 * @type {Number}
 */
globalScope.GameSpeed = 2;

globalScope.FPS = 24;

globalScope.FrameTime = (1000 / globalScope.FPS);

/**
 * 场景帧时长(毫秒)。0 = 沿用历史节奏(FrameTime / GameSpeed ≈ 21ms,约 48 帧/秒)。
 *
 * 原版(SDLPAL game.h)场景是 FPS 10、每帧 100ms:主循环、0x0009 等帧、队伍走位 / 骑乘、0x007F 镜头移动都按它等。
 * 我们的主循环历来每帧只等 FrameTime / GameSpeed,场景逻辑实测 40 帧/秒 = 原版 4 倍:怪的追击、
 * vanishTime 这类按帧计的保护期、队伍走速全都快 4 倍(逃出战斗 0.4 秒就被追上,原版是 1.5 秒)。
 * 要原版速度的宿主(agent-pal 实时模式)设 SceneFrameTime = 100、GameSpeed = 1;
 * 只改「一帧对应多少真实时间」,每帧的逻辑不变,所以按帧数走的锁步 / golden 不受影响(它们保持默认)。
 * @global
 */
globalScope.SceneFrameTime = 0;

/* 坐标相关 */
/**
 * x, y转POS
 * @global
 * @param {int} x
 * @param {int} y
 * @return {POS}
 */
export const PAL_XY = globalScope.PAL_XY = function(x: number, y: number) {
  //return x+','+y;
  return (((y << 16) & 0xFFFF0000) | (x & 0xFFFF));
};

/**
 * x, y转POS
 * @global
 * @param {int} y
 * @param {int} x
 * @return {POS}
 */
globalScope.PAL_YX = function(y: number, x: number) {
  return (((y << 16) & 0xFFFF0000) | (x & 0xFFFF));
};

/**
 * POS取x
 * @global
 * @param {POS} yx
 * @return {int} x
 */
globalScope.PAL_X = function(yx: number) {
  //return parseInt(yx.split(',')[0], 10);
  let ret = (yx & 0xFFFF);
  if (ret > 0x8000) ret -= 0x10000;
  return ret;
};

/**
 * POS取y
 * @global
 * @param {POS} yx
 * @return {int} y
 */
globalScope.PAL_Y = function(yx: number) {
  //return parseInt(yx.split(',')[1], 10);
  let ret = ((yx >> 16) & 0xFFFF);
  if (ret > 0x8000) ret -= 0x10000;
  return ret;
};

globalScope.PAL_XYH_TO_POS = function(x: number, y: number, h: number) {
  // 用位运算会更快吗
  // Note: PAL_POS is not defined in common.js, assuming it's a typo or defined elsewhere?
  // Wait, PAL_POS is likely PAL_XY? Or maybe it was supposed to be globalScope.PAL_XY?
  // Looking at the original code: return PAL_POS((x << 5) + (h << 4), (y << 4) + (h << 3));
  // If PAL_POS is not defined, this would crash.
  // Let's assume PAL_POS is PAL_XY for now, or maybe it's defined in another file?
  // Actually, let's check if PAL_POS is defined in the workspace.
  if (typeof globalScope.PAL_POS === 'function') {
      return globalScope.PAL_POS((x << 5) + (h << 4), (y << 4) + (h << 3));
  }
  // Fallback to PAL_XY if PAL_POS is missing, assuming it constructs a POS from X,Y
  return globalScope.PAL_XY((x << 5) + (h << 4), (y << 4) + (h << 3));
};

globalScope.PAL_POS_TO_XYH = function(pos: number) {
  // 用位运算会更快吗？
  return {
    h: (((globalScope.PAL_X(pos) & 31) !== 0) ? 1 : 0),
    x: (globalScope.PAL_X(pos) >> 5),
    y: (globalScope.PAL_Y(pos) >> 4)
  };
};

export const RECT = globalScope.RECT = function(this: any, x: number, y: number, w: number, h: number) {
  //return {
  //  x: x | 0,
  //  y: y | 0,
  //  w: w | 0,
  //  h: h | 0
  //};
  // 据说这样可以实现hidden type优化
  // 无new实例化
  if (!(this instanceof globalScope.RECT)) return new globalScope.RECT(x, y, w, h);
  this.x = x | 0;
  this.y = y | 0;
  this.w = w | 0;
  this.h = h | 0;
};

/* -------------------------------------------------- */
/**
 * 高精度计时（在不支持的时候会使用低精度）
 * @method
 * @return {Double} 毫秒
 */
let hrtimeBindingKind:'browser-performance'|'date'|'process';
export function getHrtimeBinding() {
  return Object.freeze({kind:hrtimeBindingKind,...(hrtimeBindingKind==='browser-performance'?{performance:globalThis.performance,now:globalThis.performance?.now}:hrtimeBindingKind==='date'?{Date:globalThis.Date,getTime:globalThis.Date.prototype.getTime,now:globalThis.Date.now}:{})});
}
export const hrtime = globalScope.hrtime = (function(){
  if (typeof window !== 'undefined') {
    // browser
    if (typeof window.performance !== 'undefined' && typeof performance.now !== 'undefined'){
      hrtimeBindingKind='browser-performance';
      // support hrt
      return function() {
        return performance.now();
      };
    } else {
      hrtimeBindingKind='date';
      // oh no..
      return function() {
        return (new Date()).getTime();
      };
    }
  } else {
    // node.js
    hrtimeBindingKind='process';
    return function() {
      const diff = (typeof process !== 'undefined' && typeof process.hrtime === 'function')
        ? process.hrtime()
        : [0, 0];
      return (diff[0] * 1e9 + diff[1]) / 1e6; // nano second -> ms
    };
  }
})();

/* -------------------------------------------------- */
globalScope.isNumber = function(a: any){
  //return (a == +a);
  return !isNaN(a); // WARNING 靠不靠谱呢
};

globalScope.toArray = function(obj: any) {
  return slice.call(obj, 0);
};

globalScope.noop = function() {
  // nothing
};

globalScope.timestamp = function() {
  // Prefer performance.now in browsers, fall back to hrtime (node) or Date.now.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  if (typeof globalScope.hrtime === 'function') {
    const hr = globalScope.hrtime();
    // If hrtime returns [seconds, nanoseconds] (node style) vs ms (browser style shim above)
    // The shim above returns ms.
    // Let's assume the shim above is what's used.
    return hr; 
  }
  return Date.now();
};

/**
 * 生成随机整数
 *
 * @param  {Number} min 下界（包含）
 * @param  {Number} max 上界（包含）
 * @return {Number}
 */
globalScope.randomLong = function(min: number, max: number) {
  if (max <= min) return min;
  return min + ~~(random() * (max + 1 - min));
};

/**
 * 生成随机浮点数
 *
 * @param  {Number} min 下界（包含）
 * @param  {Number} max 上界（不含）
 * @return {Number}
 */
globalScope.randomFloat = function(min: number, max: number) {
  if (max <= min) return min;
  return min + (random() * (max - min));
};

/**
 * SLEEP
 *
 * @param {Number} ms
 * @return {Promise}
 */
export const sleep = globalScope.sleep = function(ms: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms / globalScope.GameSpeed);
  })
};

/**
 * SLEEP by frame counts WARNING:TBD
 *
 * @param  {Number} frames frame count to sleep
 * @return {Promise}
 */
export const sleepByFrame = globalScope.sleepByFrame = function(frames: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, globalScope.FrameTime * frames / globalScope.GameSpeed);
  });
};

/**
 * 等一个「场景帧」(主循环用)。默认与 sleepByFrame(1) 完全相同。
 * SceneFrameTime > 0 时按原版 PAL_GameMain 的节拍:等到上一帧定下的时刻,再把下一帧定在「现在 + 帧时长」
 * (PAL_DelayUntil(dwTime); dwTime = SDL_GetTicks() + FRAME_TIME)—— 一帧的逻辑耗时算在帧时长里,不额外加。
 */
let sceneFrameDeadline = 0;
export const sleepSceneFrame = globalScope.sleepSceneFrame = function() {
  if (!(globalScope.SceneFrameTime > 0)) {
    return new Promise(function(resolve) {
      setTimeout(resolve, globalScope.FrameTime / globalScope.GameSpeed);
    });
  }
  const period = globalScope.SceneFrameTime / globalScope.GameSpeed;
  return new Promise(function(resolve) {
    setTimeout(function() {
      sceneFrameDeadline = Date.now() + period;
      resolve(undefined);
    }, Math.max(0, sceneFrameDeadline - Date.now()));
  });
};

Promise.prototype.spread = function<R>(
  this: Promise<any>,
  resolve: (...args: any[]) => R,
  reject?: (reason: any) => any
) {
  return this.then((array: any) => {
    return resolve(...array);
  }, reject);
};

export {};
