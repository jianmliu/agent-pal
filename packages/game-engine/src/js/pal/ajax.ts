import traceModuleLoad from './util-trace';
import utils from './utils';
import MKF from './mkf';
import co from './co';
import config from './config';

traceModuleLoad('ajax module load');

type MkfCache = Record<string, unknown>;
type FileCache = Record<string, Uint8Array>;

const ajax: any = {
  cache: {} as FileCache,
  MKF: {} as MkfCache
};

utils.extend(ajax, utils.Events);
// Legacy compatibility: some callers expect trigger/on/off API shape.
if (typeof ajax.trigger !== 'function' && typeof ajax.fire === 'function') {
  ajax.trigger = ajax.fire.bind(ajax);
}
if (typeof ajax.one !== 'function' && typeof ajax.onec === 'function') {
  ajax.one = ajax.onec.bind(ajax);
}

ajax.requestBinary = function(filePath: string, targetUrl: string | null, callback?: (data: Uint8Array | null) => void) {
  const cb = typeof callback === 'function' ? callback : () => {};
  const isRpg = /\.rpg$/i.test(filePath);
  // Resolve URL using PAL config; default to MKF assets under the configured base.
  if (!targetUrl) {
    const cfg: any = config || {};
    const base = typeof cfg.assetBaseUrl === 'string' ? cfg.assetBaseUrl : '';
    const hasExt = /\.[a-z0-9]+$/i.test(filePath);
    const normalizedBase = base.replace(/\/+$/, '') + (base ? '/' : '');
    targetUrl = normalizedBase + filePath + (hasExt ? '' : '.MKF');
  }
  // if (targetUrl.indexOf('?') === -1) {
  //   targetUrl += '?v=' + Math.random();
  // }
  fetch(targetUrl, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        console.warn('[ajax] fetch failed', filePath, response.status, response.statusText, targetUrl);
        return null;
      }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const arrayBuffer = await response.arrayBuffer();
      const buf = arrayBuffer ? new Uint8Array(arrayBuffer) : null;
      if (buf) {
        if (contentType.includes('text/html') || contentType.includes('text/plain')) {
          console.warn('[ajax] fetched text response for', filePath, 'content-type', contentType, 'url', targetUrl);
          return null;
        }
        if (isRpg && buf.length < 1024) {
          let head = '';
          const limit = Math.min(64, buf.length);
          for (let i = 0; i < limit; i++) {
            const c = buf[i];
            if (c === 0) break;
            head += String.fromCharCode(c);
          }
          if (/<html|<!doctype/i.test(head)) {
            console.warn('[ajax] fetched html fallback for', filePath, 'url', targetUrl);
            return null;
          }
        }
      }
      console.warn('[ajax] fetched', filePath, 'len', buf ? buf.length : 0, 'url', targetUrl);
      return buf;
    })
    .then(cb)
    .catch((err) => {
      console.warn('[ajax] fetch error', filePath, err);
      cb(null);
    });
};

ajax.load = function(filePath: string, targetUrl: string | null, callback?: (data: Uint8Array | null) => void) {
  const cb = typeof callback === 'function' ? callback : () => {};
  const cached = ajax.cache[filePath];
  if (cached && cached.length > 0) {
    cb(cached);
    return;
  }
  if (cached && cached.length === 0) {
    // purge stale empty cache
    delete ajax.cache[filePath];
  }

  ajax.requestBinary(filePath, targetUrl, function(binary: Uint8Array | null) {
    if (!binary || !binary.length) {
      console.warn('[ajax] load returned empty for', filePath);
      cb(null);
      return;
    }
    console.debug('[ajax] cache set', filePath, 'len', binary.length);
    ajax.cache[filePath] = binary;
    cb(binary);
  });
};

ajax.loadMKF = function(...filePaths: string[]) {
  var callback = arguments[arguments.length - 1];
  if (typeof callback === 'string') {
    callback = null;
  } else {
    filePaths = filePaths.slice(0, -1);
  }
  filePaths = Array.prototype.slice.call(filePaths);
  return co(function*() {
    for (var i = 0; i < filePaths.length; i++) {
      var filePath = filePaths[i];
      var cachedMkf = ajax.MKF[filePath];
      var hasValidMkf = cachedMkf
        && typeof cachedMkf.getChunkCount === 'function'
        && cachedMkf.getChunkCount() > 0
        && typeof cachedMkf.readChunk === 'function';
      if (hasValidMkf) {
        continue;
      }
      if (cachedMkf) {
        // purge invalid stale entry
        ajax.MKF[filePath] = null;
      }
      var binary: Uint8Array | null = yield function(callback2: (data: Uint8Array | null) => void) {
        ajax.load(filePath, null, callback2);
      };
      if (!binary) {
        console.warn('[ajax] loadMKF failed', filePath);
        continue;
      }
      if (!binary.length) {
        console.warn('[ajax] loadMKF empty payload', filePath);
      }
      ajax.MKF[filePath] = new (MKF as any)(binary, { name: filePath });
      ajax.trigger('mkfLoaded', filePath);
    }
    if (typeof callback === 'function') {
      callback();
    }
    return ajax.MKF;
  });
};

export default ajax;
