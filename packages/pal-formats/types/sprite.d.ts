import { type RLEImage } from './rle.js';
import { BinaryReader } from './binary-helper.js';
import MKF from './mkf.js';
export declare const SPRITE_STATS: {
    created: number;
    empty: number;
    totalFrames: number;
    totalBytes: number;
    decodedFrames: number;
    histogram: Record<number, number>;
    last: any;
};
declare class Sprite {
    buf: Uint8Array;
    reader: BinaryReader | null;
    frameCount: number;
    frames: (RLEImage | null | false)[] | undefined;
    constructor(buf: Uint8Array | {
        uint8Array: Uint8Array;
    } | {
        buffer: ArrayBuffer;
        byteOffset?: number;
        byteLength?: number;
    });
    getFrameCount(): number;
    getFrameOffset(frameNum: number): number | false;
    getFrame(frameNum: number): RLEImage | false;
    readAll(): (RLEImage | null | false)[] | undefined;
    static fromMKF(mkf: MKF, decompress?: boolean): (Sprite | null)[];
}
export default Sprite;
