// packages/pal-formats/src/binary-helper.ts
var typeDefine = {
  "1": "Uint8",
  "2": "Uint16",
  "4": "Uint32",
  u8: "Uint8",
  UCHAR: "Uint8",
  BYTE: "Uint8",
  i8: "Int8",
  CHAR: "Int8",
  u16: "Uint16",
  WORD: "Uint16",
  USHORT: "Uint16",
  i16: "Int16",
  SHORT: "Int16",
  u32: "Uint32",
  UINT: "Uint32",
  UINT32: "Uint32",
  DWORD: "Uint32",
  i32: "Int32",
  INT: "Int32",
  BOOL: "Int32",
  FLOAT: "Float32"
};
var sizeMap = {
  Uint8: 1,
  Int8: 1,
  Uint16: 2,
  Int16: 2,
  Uint32: 4,
  Int32: 4,
  Float32: 4
};
var typeMap = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array
};
var globalScope = typeof globalThis !== "undefined" ? globalThis : typeof global !== "undefined" ? global : {};
var globalStructStore = globalScope.__PAL_STRUCT_STORE__ || (globalScope.__PAL_STRUCT_STORE__ = {});
var typedArrayCtors = /* @__PURE__ */ new Set([
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array
]);
function isTypedArrayCtor(type) {
  return typedArrayCtors.has(type);
}
function getTypeStride(type) {
  if (isTypedArrayCtor(type)) {
    return type.BYTES_PER_ELEMENT;
  }
  if (typeof type === "function" && typeof type.size === "number" && type.size > 0) {
    return type.size;
  }
  if (typeof type === "function" && typeof type.BYTES_PER_ELEMENT === "number") {
    return type.BYTES_PER_ELEMENT;
  }
  return 1;
}
function convertType(type) {
  return typeDefine[type] || type;
}
function typeToSize(type) {
  if (typeof type === "string" && type.startsWith("@")) {
    const ctor = StructStore[type.slice(1)];
    if (ctor && typeof ctor.size === "number") {
      return ctor.size;
    }
  }
  type = convertType(type);
  if (typeof type === "string" && type.endsWith("Array")) {
    const base = type.slice(0, -5);
    if (sizeMap[base]) {
      return sizeMap[base] || null;
    }
  }
  return sizeMap[type] || null;
}
function typeToArray(type, len) {
  type = convertType(type);
  const ctor = typeMap[type + "Array"] || typeMap[type];
  if (!ctor) {
    return new Uint8Array(len);
  }
  return new ctor(len);
}
function sizeToArray(type, baseArr, len, offset) {
  if (isTypedArrayCtor(type)) {
    return new type(baseArr.buffer, baseArr.byteOffset + offset, len);
  }
  const size = getTypeStride(type);
  if (typeof type === "function" && size > 1) {
    const list = new Array(len);
    for (let i = 0; i < len; i++) {
      const start = offset + i * size;
      const slice = baseArr.subarray(start, start + size);
      list[i] = new type(slice);
    }
    list.uint8Array = baseArr.subarray(offset, offset + size * len);
    return list;
  }
  return baseArr.subarray(offset, offset + len);
}
function filterProperty(arr) {
  const a = arr;
  a.name = a.name || "data";
  a.offset = 0;
  const props = [];
  arr.forEach((item) => {
    if (typeof item === "string") {
      item = item.split("|");
    }
    if (Array.isArray(item) && typeof item[1] === "string" && item[1].indexOf("*") >= 0 && item.length < 3) {
      const parts = item[1].split("*");
      item[1] = parts.shift();
      if (parts.length) {
        item[2] = parts.join("*");
      }
    }
    const type = convertType(item[1]);
    if (!item) {
      return;
    }
    const typedItem = item;
    let factor = typedItem[2] || 1;
    const baseSize = typeToSize(type);
    let totalCount = 1;
    if (typeof factor === "string" && factor.indexOf("*") >= 0) {
      totalCount = factor.split("*").map((part) => parseInt(part, 10)).filter((value) => Number.isFinite(value) && value > 0).reduce((acc, value) => acc * value, 1);
    } else if (typeof factor === "number") {
      totalCount = factor;
    } else if (factor != null) {
      const parsed = parseInt(String(factor), 10);
      totalCount = Number.isFinite(parsed) ? parsed : 1;
    }
    if (baseSize && typedItem) {
      typedItem.size = baseSize * (totalCount || 1);
    }
    if (item[0] == null) {
      item[0] = "field_" + Math.random();
    }
    if (item.length === 3 && ("" + item[2]).indexOf("*") === -1) {
      item[2] = parseInt(item[2], 10);
    }
    props.push(item);
  });
  props.forEach((item) => {
    item.offset = a.offset;
    a.offset += item.size;
  });
  a.push = function(...args) {
    const rt = Array.prototype.push.apply(this, args);
    filterProperty(this);
    return rt;
  };
  a.size = arr.reduce((cur, pre) => cur + (pre.size || 0), 0);
  a.byteLength = a.size;
  a.BYTES_PER_ELEMENT = 1;
  return a;
}
function resolveStruct(str) {
  const arr = [];
  str.split(/\s+/).forEach((item) => {
    const el = item.split("|");
    if (el.length === 2 && typeof el[1] === "string" && el[1].indexOf("*") >= 0) {
      const parts = el[1].split("*");
      const baseType = parts.shift();
      if (baseType) {
        el[1] = baseType;
        el[2] = parts.join("*");
      }
    }
    arr.push(el);
  });
  return arr;
}
var StructStore = globalStructStore;
var BinaryReader = class {
  constructor(buffer, byteOffset, byteLength, littleEndian) {
    const byteOffsetReal = byteOffset || 0;
    const byteLengthReal = byteLength || buffer.byteLength;
    this._dataview = new DataView(buffer, byteOffsetReal, byteLengthReal);
    this.littleEndian = !!littleEndian;
  }
  getUint8(byteOffset) {
    return this._dataview.getUint8(byteOffset);
  }
  setUint8(byteOffset, value) {
    this._dataview.setUint8(byteOffset, value);
  }
  getInt8(byteOffset) {
    return this._dataview.getInt8(byteOffset);
  }
  setInt8(byteOffset, value) {
    this._dataview.setInt8(byteOffset, value);
  }
  getUint16(byteOffset, littleEndian) {
    return this._dataview.getUint16(byteOffset, littleEndian ?? this.littleEndian);
  }
  setUint16(byteOffset, value, littleEndian) {
    this._dataview.setUint16(byteOffset, value, littleEndian ?? this.littleEndian);
  }
  getInt16(byteOffset, littleEndian) {
    return this._dataview.getInt16(byteOffset, littleEndian ?? this.littleEndian);
  }
  setInt16(byteOffset, value, littleEndian) {
    this._dataview.setInt16(byteOffset, value, littleEndian ?? this.littleEndian);
  }
  getUint32(byteOffset, littleEndian) {
    return this._dataview.getUint32(byteOffset, littleEndian ?? this.littleEndian);
  }
  setUint32(byteOffset, value, littleEndian) {
    this._dataview.setUint32(byteOffset, value, littleEndian ?? this.littleEndian);
  }
  getInt32(byteOffset, littleEndian) {
    return this._dataview.getInt32(byteOffset, littleEndian ?? this.littleEndian);
  }
  setInt32(byteOffset, value, littleEndian) {
    this._dataview.setInt32(byteOffset, value, littleEndian ?? this.littleEndian);
  }
  getFloat32(byteOffset, littleEndian) {
    return this._dataview.getFloat32(byteOffset, littleEndian ?? this.littleEndian);
  }
  setFloat32(byteOffset, value, littleEndian) {
    this._dataview.setFloat32(byteOffset, value, littleEndian ?? this.littleEndian);
  }
  getWORD(byteOffset, littleEndian) {
    return this.getUint16(byteOffset, littleEndian);
  }
  setWORD(byteOffset, value, littleEndian) {
    this.setUint16(byteOffset, value, littleEndian);
  }
};
["Uint8", "Int8", "Uint16", "Int16", "Uint32", "Int32", "Float32"].forEach((type) => {
  const realType = convertType(type);
  BinaryReader.prototype["get" + type] = BinaryReader.prototype["get" + realType];
  BinaryReader.prototype["set" + type] = BinaryReader.prototype["set" + realType];
});
BinaryReader.prototype.getWORD = BinaryReader.prototype.getUint16;
BinaryReader.prototype.setWORD = BinaryReader.prototype.setUint16;
var LPBYTE = Uint8Array;
var LPWORD = Uint16Array;
var LPDWORD = Uint32Array;
var LPSTR = Uint8Array;
var LPGAMEPAD = Uint32Array;
function WORD(x) {
  return x & 65535;
}
function SHORT(x) {
  return x << 16 >> 16;
}
function defineStruct(typename, define) {
  define = Array.isArray(define) ? define : resolveStruct(define);
  StructStore[typename] = function(buf) {
    if (buf instanceof ArrayBuffer || ArrayBuffer.isView(buf)) {
      const arr = filterProperty(define);
      const tarr = buf.buffer ? new LPBYTE(buf.buffer, buf.byteOffset || 0, buf.byteLength || buf.length) : new LPBYTE(buf);
      for (let i = 0; i < arr.length; i++) {
        const field = arr[i];
        let ret = null;
        const offset = field.offset;
        let len = field[2] || 1;
        const fieldType = field[1];
        let Type = null;
        if (typeof fieldType === "string") {
          const resolved = convertType(fieldType);
          if (resolved.startsWith("@")) {
            Type = StructStore[resolved.slice(1)];
          } else {
            Type = typeMap[resolved + "Array"] || typeMap[resolved];
          }
        } else if (typeof fieldType === "function") {
          Type = fieldType;
        }
        if (!Type && typeof fieldType === "string" && fieldType.startsWith("@")) {
          Type = StructStore[fieldType.slice(1)];
        }
        if (!Type) {
          Type = LPBYTE;
        }
        if (typeof len === "string" && ("" + len).indexOf("*") >= 0) {
          const l = len.split("*");
          const len1 = parseInt(l[0], 10);
          const len2 = parseInt(l[1], 10);
          const stride = getTypeStride(Type);
          ret = new Array(len1);
          for (let i2 = 0; i2 < len1; i2++) {
            const obj = sizeToArray(Type, tarr, len2, offset + i2 * stride * len2);
            ret[i2] = obj;
          }
          ret.uint8Array = tarr.subarray(offset, offset + stride * len1 * len2);
        } else if (len > 1) {
          ret = sizeToArray(Type, tarr, len, offset);
          const stride = getTypeStride(Type);
          ret.uint8Array = tarr.subarray(offset, offset + stride * len);
        } else {
          const single = sizeToArray(Type, tarr, 1, offset);
          ret = single[0];
          if (ret && typeof ret === "object" && single && single.uint8Array && !ret.uint8Array) {
            ret.uint8Array = single.uint8Array;
          }
          if (typeof ret === "number" && isTypedArrayCtor(Type)) {
            const fieldName = field[0];
            const fieldOffset = offset;
            const TypedArrayClass = Type;
            const dataView = new DataView(tarr.buffer, tarr.byteOffset, tarr.byteLength);
            const hiddenKey = `_${fieldName}_value`;
            this[hiddenKey] = ret;
            Object.defineProperty(this, fieldName, {
              get: function() {
                return this[hiddenKey];
              },
              set: function(value) {
                this[hiddenKey] = value;
                if (TypedArrayClass === Uint8Array || TypedArrayClass === Int8Array) {
                  tarr[fieldOffset] = value & 255;
                } else if (TypedArrayClass === Uint16Array) {
                  dataView.setUint16(fieldOffset, value & 65535, true);
                } else if (TypedArrayClass === Int16Array) {
                  dataView.setInt16(fieldOffset, value & 65535, true);
                } else if (TypedArrayClass === Uint32Array) {
                  dataView.setUint32(fieldOffset, value >>> 0, true);
                } else if (TypedArrayClass === Int32Array) {
                  dataView.setInt32(fieldOffset, value | 0, true);
                } else if (TypedArrayClass === Float32Array) {
                  dataView.setFloat32(fieldOffset, value, true);
                }
              },
              enumerable: true,
              configurable: true
            });
            continue;
          }
        }
        this[field[0]] = ret;
      }
      this.uint8Array = tarr;
    } else {
      let arr = filterProperty(define);
      arr = arr.map((item, idx) => {
        if (!Array.isArray(item) || item.length < 2) {
          return { value: 0, fieldName: `field${idx}` };
        }
        let ret;
        const fieldName = item[0];
        const len = item[2] || 1;
        const type = item[1];
        if (typeof type === "string" && type.indexOf("@") === 0) {
          const ctor = StructStore[type.substr(1)];
          ret = typeof ctor === "function" ? new ctor(len) : {};
        } else if (typeof len === "string" && ("" + len).indexOf("*") > 0) {
          const l = len.split("*");
          const len1 = parseInt(l[0], 10);
          const len2 = parseInt(l[1], 10);
          ret = new Array(len1);
          for (let i = 0; i < len1; i++) {
            const sub = typeToArray(type, len2);
            ret[i] = sub;
          }
        } else if (len > 1) {
          ret = typeToArray(type, len);
        } else {
          ret = 0;
        }
        if (ret && typeof ret === "object") {
          ret.fieldName = fieldName;
        } else {
          ret = { value: ret, fieldName };
        }
        return ret;
      });
      const arrFunc = function() {
        const args = arguments;
        arr.forEach((item, i) => {
          this[arr[i].fieldName] = args[i] || (item instanceof Array ? [] : item);
        });
      };
      arrFunc.byteLength = define.byteLength;
      arrFunc.BYTES_PER_ELEMENT = define.BYTES_PER_ELEMENT;
      arrFunc.size = define.size;
      arrFunc.prototype = arr;
      return arrFunc;
    }
  };
  StructStore[typename].define = filterProperty(define);
  StructStore[typename].size = define.size;
  StructStore[typename].byteLength = define.size;
  StructStore[typename].prototype = filterProperty(define);
  StructStore[typename].fieldCount = define.length;
  return StructStore[typename];
}
function readString(buf, offset, len) {
  len = len || buf.length - offset;
  let str = "";
  for (let i = 0; i < len; i++) {
    if (buf[offset + i] === 0) {
      break;
    }
    str += String.fromCharCode(buf[offset + i]);
  }
  return str;
}
function readBytes(buf, offset, len) {
  return buf.subarray(offset, offset + len);
}
function read2Bytes(buf, offset, littleEndian = true) {
  if (!buf || offset < 0 || (buf.byteLength || buf.length || 0) < offset + 2) {
    return 0;
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return dv.getUint16(offset, littleEndian);
}
function read4Bytes(buf, offset, littleEndian = true) {
  if (!buf || offset < 0 || (buf.byteLength || buf.length || 0) < offset + 4) {
    return 0;
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return dv.getUint32(offset, littleEndian);
}
function readTypedArray(ctor, bytes) {
  if (!ctor || !bytes) return [];
  const size = typeof ctor.size === "number" && ctor.size > 0 ? ctor.size : ctor.byteLength ? ctor.byteLength : 0;
  if (!size) return [];
  const view = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength || 0) : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(0);
  const count = Math.max(0, Math.floor(view.length / size));
  const arr = new Array(count);
  for (let i = 0; i < count; i++) {
    const slice = view.subarray(i * size, (i + 1) * size);
    try {
      arr[i] = new ctor(slice);
    } catch (err) {
      arr[i] = ctor ? Object.assign(/* @__PURE__ */ Object.create(null), { uint8Array: slice }) : { uint8Array: slice };
    }
  }
  return arr;
}
function SWAP16(x) {
  return (x & 255) << 8 | x >> 8 & 255;
}
function SWAP32(x) {
  return (x & 255) << 24 | (x & 65280) << 8 | x >> 8 & 65280 | x >> 24 & 255;
}
function isCopyable(x) {
  if (!x || typeof x !== "object") {
    return false;
  }
  if (ArrayBuffer.isView(x)) {
    return true;
  }
  if (Array.isArray(x) && x.length && ArrayBuffer.isView(x[0])) {
    return true;
  }
  return false;
}
function clone(src) {
  if (ArrayBuffer.isView(src)) {
    return src.slice();
  }
  if (Array.isArray(src)) {
    if (src.length && ArrayBuffer.isView(src[0])) {
      return src.map((obj) => obj.slice());
    }
    return src.map((obj) => clone(obj));
  }
  if (src && typeof src === "object") {
    const ret = {};
    Object.keys(src).forEach((key) => {
      ret[key] = clone(src[key]);
    });
    return ret;
  }
  return src;
}
globalScope.BinaryReader = BinaryReader;
globalScope.LPBYTE = LPBYTE;
globalScope.LPWORD = LPWORD;
globalScope.LPDWORD = LPDWORD;
globalScope.LPSTR = LPSTR;
globalScope.LPGAMEPAD = LPGAMEPAD;
globalScope.defineStruct = defineStruct;
globalScope.readString = readString;
globalScope.readBytes = readBytes;
globalScope.read2Bytes = read2Bytes;
globalScope.read4Bytes = read4Bytes;
globalScope.readTypedArray = readTypedArray;
globalScope.WORD = WORD;
globalScope.SWAP16 = SWAP16;
globalScope.SWAP32 = SWAP32;
globalScope.clone = clone;

export {
  StructStore,
  BinaryReader,
  LPBYTE,
  LPWORD,
  LPDWORD,
  LPSTR,
  LPGAMEPAD,
  WORD,
  SHORT,
  defineStruct,
  readString,
  readBytes,
  read2Bytes,
  read4Bytes,
  readTypedArray,
  SWAP16,
  SWAP32,
  isCopyable,
  clone
};
