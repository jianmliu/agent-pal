// ESM entrypoint that re-exports the legacy PAL engine start function.
// The legacy code lives under ./js and will be incrementally migrated to TS/ESM.
// Consumers can call start() to boot the engine once assets/services are wired.
import palRuntime from './js/h5pal';

export function start() {
  return palRuntime.start();
}

export const gameEngineReady = true;

// Narrow native interfaces for the validated classic story host.
export { wordsToBytes } from './ecs/components/state';
export { default as legacyResourceState } from './js/pal/res';
