import {
  SWAP16,
  SWAP32,
  read2Bytes,
  read4Bytes,
  readString
} from "./chunk-6O2VEUJD.js";

// packages/pal-formats/src/yj_1.ts
var timingOn = () => !!globalThis.DEBUG?.Timing;
var startTiming = (msg) => {
  if (timingOn()) console.time(msg);
};
var endTiming = (msg) => {
  if (timingOn()) console.timeEnd(msg);
};
var TreeNode = class {
  constructor() {
    this.value = 0;
    this.leaf = 0;
    this.level = 0;
    this.weight = 0;
    this.parent = null;
    this.left = -1;
    this.right = -1;
  }
  static {
    this.SIZE = 1 + 1 + 2 + 4 + 4 + 4 + 4;
  }
};
var YJ_1_FILEHEADER = class {
  constructor(buf) {
    this.Signature = "";
    this.UncompressedLength = 0;
    this.CompressedLength = 0;
    this.BlockCount = 0;
    this.Unknown = 0;
    this.HuffmanTreeLength = 0;
    if (buf) {
      this.buffer = buf;
      this.Signature = readString(buf, 0, 4);
      this.UncompressedLength = read4Bytes(buf, 4);
      this.CompressedLength = read4Bytes(buf, 8);
      this.BlockCount = read2Bytes(buf, 12);
      this.Unknown = buf[14];
      this.HuffmanTreeLength = buf[15];
    }
  }
};
var YJ_1_BLOCKHEADER = class {
  constructor(buf) {
    if (buf && buf.length >= 24) {
      const aligned = buf.byteOffset % 2 === 0 ? buf : new Uint8Array(buf);
      this.buffer = aligned;
      this.UncompressedLength = read2Bytes(aligned, 0);
      this.CompressedLength = read2Bytes(aligned, 2);
      if (!this.CompressedLength) {
        this.LZSSRepeatTable = new Uint16Array(4);
        this.LZSSOffsetCodeLengthTable = new Uint8Array(4);
        this.LZSSRepeatCodeLengthTable = new Uint8Array(3);
        this.CodeCountCodeLengthTable = new Uint8Array(3);
        this.CodeCountTable = new Uint8Array(2);
        return;
      }
      this.LZSSRepeatTable = new Uint16Array(4);
      for (let i = 0; i < 4; i++) {
        this.LZSSRepeatTable[i] = read2Bytes(aligned, 4 + i * 2);
      }
      this.LZSSOffsetCodeLengthTable = aligned.subarray(12, 16);
      this.LZSSRepeatCodeLengthTable = aligned.subarray(16, 19);
      this.CodeCountCodeLengthTable = aligned.subarray(19, 22);
      this.CodeCountTable = aligned.subarray(22, 24);
    } else {
      this.LZSSRepeatTable = new Uint16Array(4);
      this.LZSSOffsetCodeLengthTable = new Uint8Array(4);
      this.LZSSRepeatCodeLengthTable = new Uint8Array(3);
      this.CodeCountCodeLengthTable = new Uint8Array(3);
      this.CodeCountTable = new Uint8Array(2);
      this.buffer = buf || new Uint8Array(0);
      this.UncompressedLength = 0;
      this.CompressedLength = 0;
    }
  }
};
var bitptr = 0;
function get_bits(src, count) {
  const tempOffset = bitptr >> 4 << 1;
  const bptr = bitptr & 15;
  let mask;
  bitptr += count;
  if (count > 16 - bptr) {
    count = count + bptr - 16;
    mask = 65535 >> bptr;
    return ((src[tempOffset + 0] | src[tempOffset + 1] << 8) & mask) << count | (src[tempOffset + 2] | src[tempOffset + 3] << 8) >> 16 - count;
  } else {
    return ((src[tempOffset + 0] | src[tempOffset + 1] << 8) << bptr & 65535) >> 16 - count;
  }
}
function get_loop(src, header) {
  if (get_bits(src, 1)) {
    return header.CodeCountTable[0];
  } else {
    const temp = get_bits(src, 2);
    if (temp) {
      return get_bits(src, header.CodeCountCodeLengthTable[temp - 1]);
    } else {
      return header.CodeCountTable[1];
    }
  }
}
function get_count(src, header) {
  const temp = get_bits(src, 2);
  if (temp) {
    if (get_bits(src, 1)) {
      return get_bits(src, header.LZSSRepeatCodeLengthTable[temp - 1]);
    } else {
      return header.LZSSRepeatTable[temp];
    }
  } else {
    return header.LZSSRepeatTable[0];
  }
}
function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
var MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
var MAX_BLOCKS = 16384;
var DEFAULT_TIMEOUT_MS = 5e3;
function normalize16(value, max, allowZero = false) {
  if (!Number.isFinite(value)) return 0;
  if (allowZero && value === 0) return 0;
  if (value > 0 && value <= max) return value;
  const swapped = SWAP16(value);
  if (allowZero && swapped === 0) return 0;
  if (swapped > 0 && swapped <= max) return swapped;
  return value;
}
function normalize32(value, max, allowZero = false) {
  if (!Number.isFinite(value)) return 0;
  if (allowZero && value === 0) return 0;
  if (value > 0 && value <= max) return value;
  const swapped = SWAP32(value);
  if (allowZero && swapped === 0) return 0;
  if (swapped > 0 && swapped <= max) return swapped;
  return value;
}
var yj_1 = {
  decompress: function(Source, context) {
    startTiming("Decompress:" + Source.length);
    const hdr = new YJ_1_FILEHEADER(Source);
    let src = Source;
    if (hdr.Signature !== "YJ_1") {
      console.warn("[yj_1] invalid signature", {
        signature: hdr.Signature,
        srcLen: Source.length,
        name: context && context.name ? context.name : "",
        chunk: context && typeof context.chunk === "number" ? context.chunk : null,
        stage: context && context.stage ? context.stage : ""
      });
      return new Uint8Array(0);
    }
    const uncompressedLength = normalize32(hdr.UncompressedLength, MAX_UNCOMPRESSED_BYTES);
    if (!Number.isFinite(uncompressedLength) || uncompressedLength <= 0 || uncompressedLength > MAX_UNCOMPRESSED_BYTES) {
      console.warn("[yj_1] invalid uncompressed length", {
        len: hdr.UncompressedLength,
        swapped: SWAP32(hdr.UncompressedLength),
        srcLen: Source.length,
        name: context && context.name ? context.name : "",
        chunk: context && typeof context.chunk === "number" ? context.chunk : null,
        stage: context && context.stage ? context.stage : ""
      });
      return new Uint8Array(0);
    }
    const blockCount = normalize16(hdr.BlockCount, MAX_BLOCKS);
    if (!Number.isFinite(blockCount) || blockCount <= 0 || blockCount > MAX_BLOCKS) {
      console.warn("[yj_1] invalid block count", {
        blocks: hdr.BlockCount,
        swapped: SWAP16(hdr.BlockCount),
        srcLen: Source.length,
        name: context && context.name ? context.name : "",
        chunk: context && typeof context.chunk === "number" ? context.chunk : null,
        stage: context && context.stage ? context.stage : ""
      });
      return new Uint8Array(0);
    }
    const Destination = new Uint8Array(uncompressedLength);
    let dest = Destination;
    let i;
    let root;
    let node;
    do {
      const tree_len = hdr.HuffmanTreeLength * 2;
      if (!Number.isFinite(tree_len) || tree_len < 0 || 16 + tree_len > src.length) {
        console.warn("[yj_1] invalid huffman tree length", {
          tree_len,
          srcLen: src.length,
          name: context && context.name ? context.name : "",
          chunk: context && typeof context.chunk === "number" ? context.chunk : null,
          stage: context && context.stage ? context.stage : ""
        });
        return new Uint8Array(0);
      }
      const treeBytes = (tree_len & 15 ? (tree_len >> 4) + 1 : tree_len >> 4) << 1;
      if (16 + tree_len + treeBytes > src.length) {
        console.warn("[yj_1] invalid huffman tree bytes", {
          tree_len,
          treeBytes,
          srcLen: src.length,
          name: context && context.name ? context.name : "",
          chunk: context && typeof context.chunk === "number" ? context.chunk : null,
          stage: context && context.stage ? context.stage : ""
        });
        return new Uint8Array(0);
      }
      const flag = src.subarray(16 + tree_len);
      bitptr = 0;
      root = Array.from({ length: tree_len + 1 }, () => new TreeNode());
      root[0].leaf = 0;
      root[0].value = 0;
      root[0].left = 1;
      root[0].right = 2;
      for (i = 1; i <= tree_len; i++) {
        root[i].leaf = !get_bits(flag, 1);
        root[i].value = src[15 + i];
        if (root[i].leaf) {
          root[i].left = root[i].right = -1;
        } else {
          root[i].left = (root[i].value << 1) + 1;
          root[i].right = root[i].left + 1;
        }
      }
      src = src.subarray(16 + tree_len + treeBytes);
    } while (0);
    const start = nowMs();
    const timeoutMs = typeof globalThis !== "undefined" && typeof globalThis.PAL_DECOMPRESS_TIMEOUT_MS === "number" ? globalThis.PAL_DECOMPRESS_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const maxOpsOverride = typeof globalThis !== "undefined" && typeof globalThis.PAL_DECOMPRESS_MAX_OPS === "number" ? globalThis.PAL_DECOMPRESS_MAX_OPS : null;
    const maxOps = typeof maxOpsOverride === "number" && Number.isFinite(maxOpsOverride) && maxOpsOverride > 0 ? maxOpsOverride : null;
    let ops = 0;
    const guard = () => {
      ops += 1;
      if ((ops & 16383) === 0) {
        const elapsed = nowMs() - start;
        if (elapsed > timeoutMs || maxOps && ops > maxOps) {
          console.error("[yj_1] decompress guard tripped", {
            elapsedMs: Math.round(elapsed),
            ops,
            maxOps: maxOps || void 0,
            name: context && context.name ? context.name : "",
            chunk: context && typeof context.chunk === "number" ? context.chunk : null,
            stage: context && context.stage ? context.stage : ""
          });
          return true;
        }
      }
      if (maxOps && ops > maxOps) {
        const elapsed = nowMs() - start;
        console.error("[yj_1] decompress guard tripped", {
          elapsedMs: Math.round(elapsed),
          ops,
          maxOps,
          name: context && context.name ? context.name : "",
          chunk: context && typeof context.chunk === "number" ? context.chunk : null,
          stage: context && context.stage ? context.stage : ""
        });
        return true;
      }
      return false;
    };
    for (i = 0; i < blockCount; i++) {
      const header = new YJ_1_BLOCKHEADER(src);
      src = src.subarray(4);
      const blockUncompressed = normalize16(header.UncompressedLength, 16384);
      const blockCompressed = normalize16(header.CompressedLength, 65535, true);
      if (!blockCompressed) {
        if (!blockUncompressed || blockUncompressed > src.length) {
          console.warn("[yj_1] invalid block length", {
            uncompressed: header.UncompressedLength,
            swapped: SWAP16(header.UncompressedLength),
            srcLen: src.length,
            name: context && context.name ? context.name : "",
            chunk: context && typeof context.chunk === "number" ? context.chunk : null,
            stage: context && context.stage ? context.stage : ""
          });
          return new Uint8Array(0);
        }
        let hul = blockUncompressed;
        while (hul--) {
          dest[0] = src[0];
          dest = dest.subarray(1);
          src = src.subarray(1);
          if (guard()) return new Uint8Array(0);
        }
        continue;
      }
      src = src.subarray(20);
      bitptr = 0;
      for (; ; ) {
        if (guard()) return new Uint8Array(0);
        let loop;
        loop = get_loop(src, header);
        if (loop == 0) {
          break;
        }
        while (loop--) {
          node = 0;
          for (; !root[node].leaf; ) {
            if (get_bits(src, 1)) {
              node = root[node].right;
            } else {
              node = root[node].left;
            }
            if (guard()) return new Uint8Array(0);
          }
          dest[0] = root[node].value;
          dest = dest.subarray(1);
          if (guard()) return new Uint8Array(0);
        }
        loop = get_loop(src, header);
        if (loop == 0) {
          break;
        }
        while (loop--) {
          let pos, count;
          count = get_count(src, header);
          pos = get_bits(src, 2);
          pos = get_bits(src, header.LZSSOffsetCodeLengthTable[pos]);
          while (count--) {
            dest[0] = Destination[dest.byteOffset - pos];
            dest = dest.subarray(1);
            if (guard()) return new Uint8Array(0);
          }
        }
      }
      if (blockCompressed > header.buffer.length) {
        console.warn("[yj_1] invalid compressed length", {
          compressed: header.CompressedLength,
          swapped: SWAP16(header.CompressedLength),
          bufferLen: header.buffer.length,
          name: context && context.name ? context.name : "",
          chunk: context && typeof context.chunk === "number" ? context.chunk : null,
          stage: context && context.stage ? context.stage : ""
        });
        return new Uint8Array(0);
      }
      src = header.buffer.subarray(blockCompressed);
      if (guard()) return new Uint8Array(0);
    }
    endTiming("Decompress:" + Source.length);
    return Destination;
  }
};
var yj_1_default = yj_1;

export {
  yj_1_default
};
