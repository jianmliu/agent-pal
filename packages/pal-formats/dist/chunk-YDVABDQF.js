import {
  sprite_default
} from "./chunk-I2PN4VET.js";

// packages/pal-formats/src/map.ts
var Map = class _Map {
  constructor(mapNum, tiles, sprite) {
    this.mapNum = mapNum;
    this.tiles = new Uint32Array(tiles.buffer, tiles.byteOffset, tiles.byteLength / 4);
    this.sprite = sprite;
  }
  static _createSpriteSafe(buf) {
    if (!buf) return null;
    const sprite = new sprite_default(buf);
    if (!sprite || !Number.isFinite(sprite.frameCount) || sprite.frameCount <= 0 || sprite.frameCount > 2e3) {
      return null;
    }
    return sprite;
  }
  static _loadSpriteWithFallback(gop, mapNum) {
    if (!gop) return null;
    const candidates = [mapNum, mapNum - 1, mapNum + 1, 4, 8, 19, 0].filter((v, i, arr) => Number.isFinite(v) && v >= 0 && arr.indexOf(v) === i);
    let fallbackSprite = null;
    for (let i = 0; i < candidates.length; i++) {
      const idx = candidates[i];
      if (typeof gop.decompressChunk === "function") {
        try {
          const decBuf = gop.decompressChunk(idx);
          const sprite = _Map._createSpriteSafe(decBuf);
          if (sprite) {
            return sprite;
          }
          if (!fallbackSprite && decBuf) {
            fallbackSprite = new sprite_default(decBuf);
          }
        } catch (err) {
        }
      }
      try {
        const rawBuf = gop.readChunk(idx);
        const sprite = _Map._createSpriteSafe(rawBuf);
        if (sprite) {
          return sprite;
        }
        if (!fallbackSprite && rawBuf) {
          fallbackSprite = new sprite_default(rawBuf);
        }
      } catch (err) {
      }
    }
    return fallbackSprite;
  }
  static fromChunk(mapNum, tiles, sprite) {
    return new _Map(mapNum, tiles, sprite);
  }
  static fromFile(mapNum, map, gop) {
    const tiles = map.decompressChunk(mapNum);
    if (!tiles) return null;
    const sprite = _Map._loadSpriteWithFallback(gop, mapNum);
    return _Map.fromChunk(mapNum, tiles, sprite);
  }
  getTile(y, x, h) {
    return this.tiles[y * 64 * 2 + x * 2 + h];
  }
  getTileBitmap(x, y, h, layer) {
    if (x >= 64 || y >= 128 || h >= 2) {
      return false;
    }
    let d = this.getTile(y, x, h);
    if (layer === 0) {
      return this.sprite?.frames?.[d & 255 | d >> 4 & 256] || false;
    } else {
      d >>= 16;
      return this.sprite?.frames?.[(d & 255 | d >> 4 & 256) - 1] || false;
    }
  }
  isTileBlocked(x, y, h) {
    if (x >= 64 || y >= 128 || h >= 2) {
      return true;
    }
    return (this.getTile(y, x, h) & 8192) >> 13 == 1;
  }
  getTileHeight(x, y, h, layer) {
    if (x >= 64 || y >= 128 || h >= 2) {
      return 0;
    }
    let d = this.getTile(y, x, h);
    if (layer) {
      d >>= 16;
    }
    d >>= 8;
    const ret = d & 15;
    if (d < 0) {
      throw "maybe err";
    }
    return ret;
  }
};
var map_default = Map;

export {
  map_default
};
