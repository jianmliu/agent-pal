declare const RLE_DECORATED: unique symbol;
export declare const RLE_STATS: {
    calls: number;
    decorated: number;
    reused: number;
    totalBytes: number;
    histogram: Record<number, number>;
    last: any;
};
export interface RLEImage extends Uint8Array {
    width: number;
    height: number;
    content: Uint8Array;
    [RLE_DECORATED]?: boolean;
}
declare const RLE: (buf: Uint8Array) => RLEImage | null;
export default RLE;
