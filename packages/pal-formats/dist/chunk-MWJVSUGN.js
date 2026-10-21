import {
  yj_1_default
} from "./chunk-PSJKKUKI.js";
import {
  BinaryReader
} from "./chunk-6O2VEUJD.js";

// packages/pal-formats/src/mkf.ts
var decompressedOverride = null;
var MKF = class {
  /** install (or clear with null) the process-wide decompressed-chunk override */
  static setDecompressedOverride(fn) {
    decompressedOverride = fn;
  }
  constructor(buf, options) {
    if (typeof options === "string") {
      options = { name: options };
    }
    this.name = options && options.name ? options.name : null;
    const view = buf instanceof Uint8Array ? buf : ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength || 0) : buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(0);
    const arrBuf = view.byteLength ? view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) : new ArrayBuffer(0);
    this.arraybuffer = arrBuf;
    this.reader = arrBuf.byteLength >= 4 ? new BinaryReader(arrBuf, 0, void 0, true) : { getUint32: () => 0 };
    this.buf = new Uint8Array(arrBuf);
    this.chunkCount = arrBuf.byteLength >= 4 ? this.getChunkCount() : 0;
    this._chunks = new Array(this.chunkCount);
    this._decompressedChunks = new Array(this.chunkCount);
  }
  readChunk(chunkNum) {
    if (chunkNum >= this.getChunkCount()) {
      return new Uint8Array(0);
    }
    if (this._chunks[chunkNum]) return this._chunks[chunkNum];
    const chunkLen = this.getChunkSize(chunkNum);
    if (chunkLen !== 0) {
      const fp = this.buf;
      const offsetFP = 4 * chunkNum;
      const offset = this.reader.getUint32(offsetFP + 0);
      const buf = fp.subarray(offset, offset + chunkLen);
      return this._chunks[chunkNum] = buf;
    } else {
      return this._chunks[chunkNum] = new Uint8Array(0);
    }
  }
  getChunkCount() {
    if (!this.buf || this.buf.byteLength < 8) return 0;
    try {
      const firstOffset = this.reader.getUint32(0, true);
      let count = Math.max(0, ~~((firstOffset - 4) / 4));
      const maxEntries = ~~(this.buf.byteLength / 4) - 1;
      if (count <= 0 || count > maxEntries) {
        count = Math.max(0, Math.min(maxEntries, count || maxEntries));
      }
      if (count === 0 && typeof console !== "undefined" && console.warn) {
        console.warn("[mkf] zero chunk count", this.name || "", "firstOffset", firstOffset, "len", this.buf.byteLength);
      }
      return count;
    } catch (err) {
      return 0;
    }
  }
  getChunkSize(chunkNum) {
    if (chunkNum >= this.getChunkCount()) {
      return -1;
    }
    const offsetFP = 4 * chunkNum;
    const buf = this.buf;
    let offset = 0;
    let nextOffset = 0;
    try {
      offset = this.reader.getUint32(offsetFP + 0, true);
      nextOffset = this.reader.getUint32(offsetFP + 4, true);
    } catch (err) {
      return -1;
    }
    if (offset < 0 || nextOffset < 0 || offset > buf.byteLength || nextOffset > buf.byteLength || nextOffset < offset) {
      return -1;
    }
    return nextOffset - offset;
  }
  getDecompressedSize(chunkNum) {
    if (chunkNum >= this.getChunkCount()) {
      return -1;
    }
    const buf = this.buf;
    let offsetFP = 0;
    try {
      offsetFP = this.reader.getUint32(4 * chunkNum, true);
    } catch (err) {
      return -1;
    }
    if (offsetFP < 0 || offsetFP + 8 > buf.byteLength) {
      return -1;
    }
    const buf_0 = this.reader.getUint32(offsetFP + 0, true);
    const buf_1 = this.reader.getUint32(offsetFP + 4, true);
    return buf_0 != 828328537 ? -1 : buf_1;
  }
  decompressChunk(chunkNum) {
    if (this._decompressedChunks[chunkNum]) return this._decompressedChunks[chunkNum];
    if (decompressedOverride) {
      const override = decompressedOverride(this.name || "", chunkNum);
      if (override) {
        return this._decompressedChunks[chunkNum] = override;
      }
    }
    const buf = this.readChunk(chunkNum);
    if (!buf || !buf.length) {
      return this._decompressedChunks[chunkNum] = new Uint8Array(0);
    }
    const debugFBP = typeof globalThis !== "undefined" && globalThis.PAL_DEBUG_FBP_CHUNKS === true && this.name === "FBP";
    if (buf.length >= 4) {
      const isYj1 = buf[0] === 89 && buf[1] === 74 && buf[2] === 95 && buf[3] === 49;
      if (!isYj1) {
        if (debugFBP) {
          if (!this._debugChunkSeen) this._debugChunkSeen = /* @__PURE__ */ new Set();
          if (!this._debugChunkSeen.has(chunkNum)) {
            this._debugChunkSeen.add(chunkNum);
            console.warn("[FBP] decompress chunk", {
              chunk: chunkNum,
              rawSize: buf.length,
              yj1: false
            });
          }
        }
        return this._decompressedChunks[chunkNum] = buf;
      }
    }
    const decompressed = yj_1_default.decompress(buf, {
      name: this.name,
      chunk: chunkNum
    });
    if (debugFBP) {
      if (!this._debugChunkSeen) this._debugChunkSeen = /* @__PURE__ */ new Set();
      if (!this._debugChunkSeen.has(chunkNum)) {
        this._debugChunkSeen.add(chunkNum);
        console.warn("[FBP] decompress chunk", {
          chunk: chunkNum,
          rawSize: buf.length,
          yj1: true,
          decodedSize: decompressed.length
        });
      }
    }
    return this._decompressedChunks[chunkNum] = decompressed;
  }
};
var mkf_default = MKF;

export {
  mkf_default
};
