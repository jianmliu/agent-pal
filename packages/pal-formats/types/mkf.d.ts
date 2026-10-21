import { BinaryReader } from './binary-helper.js';
/**
 * Replaces a chunk's decompressed bytes (e.g. a MOD's repainted FBP background).
 * Return null to fall through to the archive. The engine's mod-service registers
 * one at load time; the decoders themselves know nothing about MODs.
 */
export type DecompressedOverride = (mkfName: string, chunkNum: number) => Uint8Array | null | undefined;
interface MkfOptions {
    name?: string;
}
declare class MKF {
    /** install (or clear with null) the process-wide decompressed-chunk override */
    static setDecompressedOverride(fn: DecompressedOverride | null): void;
    name: string | null;
    arraybuffer: ArrayBuffer;
    reader: BinaryReader | {
        getUint32: (offset: number, littleEndian?: boolean) => number;
    };
    buf: Uint8Array;
    chunkCount: number;
    _chunks: Uint8Array[];
    _decompressedChunks: Uint8Array[];
    _debugChunkSeen?: Set<number>;
    constructor(buf: Uint8Array | ArrayBuffer, options?: MkfOptions | string);
    readChunk(chunkNum: number): Uint8Array;
    getChunkCount(): number;
    getChunkSize(chunkNum: number): number;
    getDecompressedSize(chunkNum: number): number;
    decompressChunk(chunkNum: number): Uint8Array;
}
export default MKF;
