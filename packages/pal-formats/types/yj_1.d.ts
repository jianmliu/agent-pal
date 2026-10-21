type DecompressContext = {
    name?: string | null;
    chunk?: number;
    stage?: string;
};
declare const yj_1: {
    decompress: (Source: Uint8Array, context?: DecompressContext) => Uint8Array<ArrayBuffer>;
};
export default yj_1;
