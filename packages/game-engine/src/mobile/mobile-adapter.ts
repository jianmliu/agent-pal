/**
 * Mobile Platform Adapter
 * Handles mobile-specific initialization and optimizations
 */

import { Capacitor } from '@capacitor/core';

/**
 * Initialize mobile app environment
 */
export async function initMobileApp() {
  // Only run on native platforms
  if (!Capacitor.isNativePlatform()) {
    console.log('[Mobile] Running on web platform, skipping mobile init');
    return;
  }

  console.log('[Mobile] Initializing mobile app on:', Capacitor.getPlatform());

  // 1. Prevent page scrolling and bouncing
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.height = '100%';
  document.body.style.touchAction = 'none';

  // 2. Disable context menu (long press)
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // 3. Prevent touch events from scrolling the page
  document.addEventListener(
    'touchmove',
    (e) => {
      // Allow input fields to scroll
      if ((e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  // 4. Prevent iOS rubber band effect
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  });

  // 5. Apply safe area insets for notch screens
  const root = document.documentElement;
  root.style.setProperty('--safe-area-inset-top', 'env(safe-area-inset-top)');
  root.style.setProperty('--safe-area-inset-bottom', 'env(safe-area-inset-bottom)');
  root.style.setProperty('--safe-area-inset-left', 'env(safe-area-inset-left)');
  root.style.setProperty('--safe-area-inset-right', 'env(safe-area-inset-right)');

  console.log('[Mobile] Mobile initialization complete');
}

/**
 * Load mobile-specific plugins dynamically
 */
export async function loadMobilePlugins() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    // Import plugins only when running on mobile
    const [
      { StatusBar },
      { ScreenOrientation },
    ] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/screen-orientation'),
    ]);

    // Hide status bar for immersive experience
    try {
      await StatusBar.hide();
      console.log('[Mobile] Status bar hidden');
    } catch (e) {
      console.warn('[Mobile] Failed to hide status bar:', e);
    }

    // Lock to landscape orientation (RPG games typically use landscape)
    try {
      await ScreenOrientation.lock({ orientation: 'landscape' });
      console.log('[Mobile] Screen locked to landscape');
    } catch (e) {
      console.warn('[Mobile] Failed to lock orientation:', e);
    }
  } catch (e) {
    console.warn('[Mobile] Failed to load mobile plugins:', e);
  }
}

/**
 * Setup touch controls for mobile gameplay
 */
export function setupTouchControls() {
  const canvas = document.querySelector('canvas');
  if (!canvas) {
    console.warn('[Mobile] Canvas not found, skipping touch controls');
    return;
  }

  let touchStartPos = { x: 0, y: 0 };
  let touchStartTime = 0;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };
      touchStartTime = Date.now();
    }
  });

  canvas.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartPos.x;
      const deltaY = touch.clientY - touchStartPos.y;
      const deltaTime = Date.now() - touchStartTime;

      // Short tap (< 200ms) = Enter key (interact/confirm)
      if (Math.abs(deltaX) < 30 && Math.abs(deltaY) < 30 && deltaTime < 200) {
        simulateKeyPress('Enter');
        return;
      }

      // Swipe gesture recognition
      const minSwipeDistance = 50;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe
        if (deltaX > minSwipeDistance) {
          simulateKeyPress('ArrowRight');
        } else if (deltaX < -minSwipeDistance) {
          simulateKeyPress('ArrowLeft');
        }
      } else {
        // Vertical swipe
        if (deltaY > minSwipeDistance) {
          simulateKeyPress('ArrowDown');
        } else if (deltaY < -minSwipeDistance) {
          simulateKeyPress('ArrowUp');
        }
      }
    }
  });

  console.log('[Mobile] Touch controls enabled');
}

/**
 * Simulate keyboard press event
 */
function simulateKeyPress(key: string) {
  const keydownEvent = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(keydownEvent);

  // Also dispatch keyup for completeness
  setTimeout(() => {
    const keyupEvent = new KeyboardEvent('keyup', {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(keyupEvent);
  }, 100);
}

/**
 * Check if running on mobile platform
 */
export function isMobilePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Get current platform (ios, android, web)
 */
export function getPlatform(): string {
  return Capacitor.getPlatform();
}
