import MKF from './mkf.js';
import Sprite from './sprite.js';
import type { RLEImage } from './rle.js';
declare class Map {
    mapNum: number;
    tiles: Uint32Array;
    sprite: Sprite | null;
    constructor(mapNum: number, tiles: Uint8Array, sprite: Sprite | null);
    static _createSpriteSafe(buf: Uint8Array | null): Sprite | null;
    static _loadSpriteWithFallback(gop: MKF, mapNum: number): Sprite | null;
    static fromChunk(mapNum: number, tiles: Uint8Array, sprite: Sprite | null): Map;
    static fromFile(mapNum: number, map: MKF, gop: MKF): Map | null;
    getTile(y: number, x: number, h: number): number;
    getTileBitmap(x: number, y: number, h: number, layer: number): RLEImage | false;
    isTileBlocked(x: number, y: number, h: number): boolean;
    getTileHeight(x: number, y: number, h: number, layer: number): number;
}
export default Map;
