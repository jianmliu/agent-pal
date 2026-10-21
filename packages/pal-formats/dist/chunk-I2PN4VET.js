import {
  rle_default
} from "./chunk-7OHGM6G7.js";
import {
  BinaryReader,
  WORD
} from "./chunk-6O2VEUJD.js";

// packages/pal-formats/src/sprite.ts
var SPRITE_STATS = {
  created: 0,
  empty: 0,
  totalFrames: 0,
  totalBytes: 0,
  decodedFrames: 0,
  histogram: /* @__PURE__ */ Object.create(null),
  last: null
};
var Sprite = class _Sprite {
  constructor(buf) {
    const originalBuf = buf;
    let buffer;
    if (buf && buf.uint8Array instanceof Uint8Array) {
      buffer = buf.uint8Array;
    } else if (buf && !(buf instanceof Uint8Array) && buf.buffer instanceof ArrayBuffer) {
      const byteOffset = buf.byteOffset || 0;
      const byteLength = buf.byteLength || 0;
      buffer = new Uint8Array(buf.buffer, byteOffset, byteLength);
    } else {
      buffer = buf;
    }
    this.buf = buffer && buffer.buffer instanceof ArrayBuffer ? buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength || 0) : new Uint8Array(0);
    SPRITE_STATS.created += 1;
    SPRITE_STATS.totalBytes += this.buf.length || originalBuf && originalBuf.length || 0;
    this.reader = this.buf.length >= 2 ? new BinaryReader(this.buf.buffer, this.buf.byteOffset || 0, this.buf.byteLength || this.buf.length, true) : null;
    if (this.reader) {
      this.reader.littleEndian = true;
    }
    this.frameCount = this.getFrameCount();
    SPRITE_STATS.totalFrames += this.frameCount;
    if (this.frameCount <= 0) {
      SPRITE_STATS.empty += 1;
    }
    if (this.frameCount) {
      SPRITE_STATS.histogram[this.frameCount] = (SPRITE_STATS.histogram[this.frameCount] || 0) + 1;
    }
    SPRITE_STATS.last = {
      bufferLength: this.buf.length,
      frameCount: this.frameCount
    };
    this.readAll();
  }
  getFrameCount() {
    if (!this.reader || this.buf.length < 2) {
      return 0;
    }
    const frameTableCount = this.reader.getUint16(0);
    if (!Number.isFinite(frameTableCount) || frameTableCount <= 0) {
      return 0;
    }
    return frameTableCount - 1;
  }
  getFrameOffset(frameNum) {
    if (!this.reader) {
      return false;
    }
    if (frameNum >= this.frameCount) {
      return false;
    }
    const tableOffset = frameNum << 1;
    if (tableOffset < 0 || tableOffset + 2 > this.buf.length) {
      return false;
    }
    const offsetWord = this.reader.getUint16(tableOffset);
    const offset = WORD(offsetWord << 1);
    if (!Number.isFinite(offset) || offset < 0 || offset >= this.buf.length) {
      return false;
    }
    return offset;
  }
  getFrame(frameNum) {
    const offset = this.getFrameOffset(frameNum);
    if (offset === false) return false;
    if (offset >= this.buf.length) {
      return false;
    }
    const ret = this.buf.subarray(offset);
    if (!ret || ret.length < 4) {
      return false;
    }
    const rle = rle_default(ret);
    return rle || false;
  }
  readAll() {
    if (this.frames) return this.frames;
    const count = this.frameCount;
    if (!this.reader || count <= 0) {
      this.frames = [];
      return;
    }
    this.frames = new Array(count);
    for (let i = 0; i < count; ++i) {
      this.frames[i] = this.getFrame(i);
      if (this.frames[i]) {
        SPRITE_STATS.decodedFrames += 1;
      }
    }
    return this.frames;
  }
  static fromMKF(mkf, decompress) {
    const count = mkf.getChunkCount();
    const arr = new Array(count);
    const useDecompress = decompress || false;
    for (let i = 0; i < count; ++i) {
      const buf = useDecompress ? mkf.decompressChunk(i) : mkf.readChunk(i);
      if (buf && buf.length > 0) {
        const sprite = new _Sprite(buf);
        arr[i] = sprite;
      } else {
        arr[i] = null;
      }
    }
    return arr;
  }
};
var sprite_default = Sprite;

export {
  SPRITE_STATS,
  sprite_default
};
