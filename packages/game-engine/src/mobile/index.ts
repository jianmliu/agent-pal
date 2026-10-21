/**
 * Mobile Platform Integration
 * Main entry point for mobile-specific functionality
 */

export {
  initMobileApp,
  loadMobilePlugins,
  setupTouchControls,
  isMobilePlatform,
  getPlatform,
} from './mobile-adapter';

export {
  createVirtualGamepad,
  removeVirtualGamepad,
  toggleGamepadVisibility,
} from './virtual-gamepad';

export {
  initStorageAdapter,
  getItem,
  setItem,
  removeItem,
  getAllKeys,
  clearStorage,
  saveGameData,
  loadGameData,
  hasSaveData,
  getSaveSlots,
} from './storage-adapter';

/**
 * Bootstrap mobile platform
 * Call this early in your app initialization
 */
export async function bootstrapMobile() {
  const { initMobileApp, loadMobilePlugins } = await import('./mobile-adapter');
  const { initStorageAdapter } = await import('./storage-adapter');

  // Initialize mobile environment
  await initMobileApp();

  // Load mobile plugins (status bar, screen orientation)
  await loadMobilePlugins();

  // Initialize storage adapter
  await initStorageAdapter();

  console.log('[Mobile] Bootstrap complete');
}

/**
 * Setup mobile controls
 * Call this after game canvas is ready
 */
export async function setupMobileControls() {
  const { setupTouchControls } = await import('./mobile-adapter');
  const { createVirtualGamepad } = await import('./virtual-gamepad');

  // Setup touch controls on canvas
  setupTouchControls();

  // Create virtual gamepad
  createVirtualGamepad();

  console.log('[Mobile] Controls setup complete');
}
