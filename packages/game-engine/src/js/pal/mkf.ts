// moved to @onchainpal/pal-formats — this path stays so engine imports are unchanged.
// The engine wires its MOD layer in here: mod-service may replace decompressed
// chunks (repainted FBP backgrounds). Resolved lazily — mod-service sits in an
// import cycle with the renderer, so it must not be touched at module-eval time.
import MKF from '@onchainpal/pal-formats/mkf';
import modService from '../../services/mod-service';

MKF.setDecompressedOverride((name, chunk) => modService?.getDecompressedOverride?.(name, chunk) ?? null);

export * from '@onchainpal/pal-formats/mkf';
export default MKF;
