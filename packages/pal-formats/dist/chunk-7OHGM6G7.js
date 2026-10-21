import {
  BinaryReader
} from "./chunk-6O2VEUJD.js";

// packages/pal-formats/src/rle.ts
var RLE_DECORATED = /* @__PURE__ */ Symbol("rleDecorated");
var RLE_STATS = {
  calls: 0,
  decorated: 0,
  reused: 0,
  totalBytes: 0,
  histogram: /* @__PURE__ */ Object.create(null),
  last: null
};
function recordRLEStats(alreadyDecorated, buffer) {
  RLE_STATS.calls += 1;
  if (alreadyDecorated) {
    RLE_STATS.reused += 1;
  } else {
    RLE_STATS.decorated += 1;
  }
  const length = buffer ? buffer.length : 0;
  RLE_STATS.totalBytes += length;
  if (length) {
    RLE_STATS.histogram[length] = (RLE_STATS.histogram[length] || 0) + 1;
  }
  if (buffer && buffer.length >= 4) {
    const width = buffer[0] | buffer[1] << 8;
    const height = buffer[2] | buffer[3] << 8;
    RLE_STATS.last = { length, width, height, reused: alreadyDecorated };
  } else {
    RLE_STATS.last = { length, reused: alreadyDecorated };
  }
}
var RLEMixin = {
  width: {
    configurable: true,
    enumerable: false,
    get: function() {
      return this.reader.getUint16(0);
    }
  },
  height: {
    configurable: true,
    enumerable: false,
    get: function() {
      return this.reader.getUint16(2);
    }
  },
  content: {
    configurable: true,
    enumerable: false,
    get: function() {
      return this.tmp.subarray(4);
    }
  }
};
var RLE = function(buf) {
  let tmp = buf;
  if (!buf || !buf.length) return null;
  if (tmp[0] === 2 && tmp[1] === 0 && tmp[2] === 0 && tmp[3] === 0) {
    tmp = tmp.subarray(4);
  }
  try {
    buf.tmp = tmp;
    buf.reader = new BinaryReader(tmp.buffer, tmp.byteOffset || 0, tmp.byteLength || tmp.length, true);
    buf.reader.littleEndian = true;
  } catch (err) {
    return null;
  }
  const alreadyDecorated = !!buf[RLE_DECORATED];
  if (!alreadyDecorated) {
    Object.defineProperties(buf, RLEMixin);
    Object.defineProperty(buf, RLE_DECORATED, {
      value: true,
      enumerable: false,
      configurable: true
    });
  }
  recordRLEStats(alreadyDecorated, tmp);
  return buf;
};
var rle_default = RLE;

export {
  RLE_STATS,
  rle_default
};
