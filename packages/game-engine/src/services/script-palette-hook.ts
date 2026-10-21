/** Native hook provenance is live renderer configuration, never checkpoint data. */
const standardSceneHooks = new WeakSet<Function>();

export function registerPaletteSceneHook(hook: Function): void {
  standardSceneHooks.add(hook);
}

export function isRegisteredPaletteSceneHook(hook: unknown): boolean {
  return typeof hook === 'function' && standardSceneHooks.has(hook);
}

/** Nonfunctions follow Surface.paletteFade's native no-hook branch. */
export function supportsOwnedPaletteSceneHook(hook: unknown): boolean {
  return typeof hook !== 'function' || standardSceneHooks.has(hook);
}
