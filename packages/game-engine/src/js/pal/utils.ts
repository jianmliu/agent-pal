import co from './co';

const globalScope = globalThis as any;

/**
 * @module utils
 */
const utils: any = {};

/**
 * 开始计时，是console.time的简单封装，受DEBUG配置影响
 * @method
 * @param  {String} msg
 */
utils.startTiming = function(msg: string) {
  if (globalScope.DEBUG && globalScope.DEBUG.Timing) {
    console.time(msg);
  }
};
/**
 * 结束计时，是console.timeEnd的简单封装，受DEBUG配置影响
 * @method
 * @param  {String} msg
 */
utils.endTiming = function(msg: string) {
  if (globalScope.DEBUG && globalScope.DEBUG.Timing) {
    console.timeEnd(msg);
  }
};

/**
 * extend，和jQuery.extend一样
 * @method
 * @return {Object}
 */
const extend = utils.extend = (function() {
  // from node-extend
  // https://www.npmjs.org/package/extend
  const hasOwn = Object.prototype.hasOwnProperty;
  const toString = Object.prototype.toString;

  function isPlainObject(obj: any) {
    if (!obj || toString.call(obj) !== '[object Object]' || obj.nodeType || obj.setInterval)
      return false;

    const has_own_constructor = hasOwn.call(obj, 'constructor');
    const has_is_property_of_method = hasOwn.call(obj.constructor.prototype, 'isPrototypeOf');
    // Not own constructor property must be Object
    if (obj.constructor && !has_own_constructor && !has_is_property_of_method) {
      return false;
    }

    // Own properties are enumerated firstly, so to speed up,
    // if last one is own, then all properties are own.
    let key;
    for ( key in obj ) {}

    return key === undefined || hasOwn.call( obj, key );
  }

  const extend = function(this: any, ...args: any[]) {
    let options, name, src, copy, copyIsArray, clone;
    let target = args[0] || {};
    let i = 1;
    let length = args.length;
    let deep = false;

    // Handle a deep copy situation
    if ( typeof target === "boolean" ) {
      deep = target;
      target = args[1] || {};
      // skip the boolean and the target
      i = 2;
    }

    // Handle case when target is a string or something (possible in deep copy)
    if ( typeof target !== "object" && typeof target !== "function") {
      target = {};
    }

    for ( ; i < length; i++ ) {
      // Only deal with non-null/undefined values
      if ( (options = args[ i ]) !== null ) {
        // Extend the base object
        for ( name in options ) {
          src = target[ name ];
          copy = options[ name ];

          // Prevent never-ending loop
          if ( target === copy ) {
            continue;
          }

          // Recurse if we're merging plain objects or arrays
          if ( deep && copy && ( isPlainObject(copy) || (copyIsArray = Array.isArray(copy)) ) ) {
            if ( copyIsArray ) {
              copyIsArray = false;
              clone = src && Array.isArray(src) ? src : [];

            } else {
              clone = src && isPlainObject(src) ? src : {};
            }

            // Never move original objects, clone them
            target[ name ] = extend( deep, clone, copy );

          // Don't bring in undefined values
          } else if ( copy !== undefined ) {
            target[ name ] = copy;
          }
        }
      }
    }

    // Return the modified object
    return target;
  };

  return extend;
})();

const slice = Array.prototype.slice;

const toArray = function(arr: any) {
  return slice.call(arr, 0);
};

const arrClone = utils.arrClone = toArray;

const objClone = utils.objClone = function(obj: any) {
  return extend({}, obj);
};

utils.fillArray = function(arr: any[], ctor: any) {
  for (let i = 0; i < arr.length; ++i) {
    arr[i] = (typeof ctor === 'function' ? (new ctor()) : ctor);
  }
};

utils.initArray = function(ctor: any, len: number) {
  const arr = new Array(len);
  utils.fillArray(arr, ctor);
  return arr;
};

/**
 * 简单的事件机制，可以将其extend到任意对象上使其获得on/off/one/fire功能
 */
utils.Events = {
  on: function(this: any, type: string, callback: Function) {
    const events = type.split(/\s+/);
    if (typeof this._events === 'undefined') this._events = {};
    for (let i = 0; i < events.length; ++i) {
      const event = events[i];
      const callbacks = this._events[event] || (this._events[event] = []);
      callbacks.push(callback);
    }
    return this;
  },
  off: function(this: any, type: string, callback: Function) {
    const events = type.split(/\s+/);
    if (typeof this._events === 'undefined') this._events = {};
    for (let i = 0; i < events.length; ++i) {
      const event = events[i];
      const callbacks = this._events[event] || (this._events[event] = []);
      for (let j = 0; j < callbacks.length; ++j) {
        if (callbacks[j] === callback) {
          callbacks.splice(j, 1);
          break;
        }
      }
    }
    return this;
  },
  onec: function(this: any, type: string, callback: Function) {
    return this.on(type, function(this: any, e: any) {
      callback.call(this, e);
      this.off(type, arguments.callee);
    });
  },
  fire: function(this: any, type: string, data: any) {
    const events = type.split(/\s+/);
    if (typeof this._events === 'undefined') this._events = {};
    for (let i = 0; i < events.length; ++i) {
      const event = events[i];
      const callbacks = this._events[event] || (this._events[event] = []);
      for (let j = 0; j < callbacks.length; ++j) {
        callbacks[j].call(this, {
          type: event,
          data: data
        });
      }
    }
    return this;
  }
};

/**
 * 返回一个this上下文固定的函数
 * @method
 * @param  {Function} fn
 * @param  {*}   thisObj
 * @return {Function}
 */
utils.proxy = function(fn: Function, thisObj: any) {
  return function(this: any) {
    return fn.apply(thisObj, [].slice.call(arguments, 0));
  };
};

/**
 * requestAnimationFrame的兼容
 * @method
 * @return {int} 句柄
 */
utils.requestAnimationFrame = (
  (typeof window !== 'undefined' && (
    window.requestAnimationFrame ||
    (window as any).webkitRequestAnimationFrame ||
    (window as any).mozRequestAnimationFrame ||
    (window as any).oRequestAnimationFrame
  )) ||
  function (fn: Function){
    return setTimeout(fn, 1000 / 60);
  }
).bind(typeof window !== 'undefined' ? window : globalScope);

/**
 * cancelAnimationFrame的兼容
 * @method
 * @param {int} id 句柄
 */
utils.cancelAnimationFrame = (
  (typeof window !== 'undefined' && (
    window.cancelAnimationFrame ||
    (window as any).webkitCancelAnimationFrame ||
    (window as any).mozCancelAnimationFrame ||
    (window as any).oCancelAnimationFrame
  )) ||
  function (id: any){
    clearTimeout(id);
  }
).bind(typeof window !== 'undefined' ? window : globalScope);

utils.raf = function(fn: any) {
  return new Promise(function(resolve, reject) {
    utils.requestAnimationFrame(function() {
      co(fn).then(resolve, reject);
    });
  });
};

/**
 * 保持帧数的循环
 * @method
 * @param  {(elapsed: number, realElapsed: number) => void} callback 每帧回调，参数为距离上一帧游戏时间，距离上一帧真实时间
 * @param  {number}   fps
 * @param  {number}   err 允许误差，默认为每帧时间/20
 * @return {number}   ID
 */
utils.keepFPS = function(callback: Function, fps: number, err: number) {
  let lastFrameTime = 0;
  const frameTime = 1000 / fps;
  err = err | (frameTime / 20);
  const id = setInterval(function() {
    const now = globalScope.hrtime();
    const elapsed = now - lastFrameTime;
    if (elapsed + err >= frameTime) {
      callback(elapsed * globalScope.GameSpeed, elapsed);
      lastFrameTime = now;
    }
  }, 0);
  return Number(id);
};
/**
 * 取消保持帧数的循环
 * @method
 * @param  {int} id
 */
utils.cancelKeepFPS = function(id: number) {
  clearInterval(id);
};

export function memcpy(dest: Uint8Array, src: Uint8Array, length: number) {
  if (!dest || !src || typeof (dest as any).set !== 'function') {
    return;
  }
  let source: any = src;
  if (!(source instanceof Uint8Array)) {
    if (ArrayBuffer.isView(source)) {
      source = new Uint8Array(source.buffer, source.byteOffset || 0, source.byteLength || 0);
    } else if (Array.isArray(source)) {
      source = Uint8Array.from(source);
    } else if (source && ArrayBuffer.isView(source.uint8Array)) {
      source = source.uint8Array;
    }
  }
  if (!source || typeof source.subarray !== 'function') {
    return;
  }
  dest.set(source.subarray(0, length));
}

export default utils;
