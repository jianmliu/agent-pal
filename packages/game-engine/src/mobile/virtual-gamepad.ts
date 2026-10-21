/**
 * Virtual Gamepad for Mobile Devices
 * Provides on-screen controls for game interaction
 */

import { isMobilePlatform } from './mobile-adapter';

/**
 * Create and mount virtual gamepad
 */
export function createVirtualGamepad() {
  // Only create on mobile platforms
  if (!isMobilePlatform()) {
    console.log('[VirtualGamepad] Not on mobile, skipping');
    return;
  }

  console.log('[VirtualGamepad] Creating virtual gamepad');

  // Create gamepad container
  const gamepad = document.createElement('div');
  gamepad.id = 'virtual-gamepad';
  gamepad.innerHTML = `
    <div class="gamepad-dpad">
      <button class="dpad-btn dpad-up" data-key="ArrowUp" aria-label="上">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M7 14l5-5 5 5z"/>
        </svg>
      </button>
      <button class="dpad-btn dpad-down" data-key="ArrowDown" aria-label="下">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M7 10l5 5 5-5z"/>
        </svg>
      </button>
      <button class="dpad-btn dpad-left" data-key="ArrowLeft" aria-label="左">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M14 7l-5 5 5 5z"/>
        </svg>
      </button>
      <button class="dpad-btn dpad-right" data-key="ArrowRight" aria-label="右">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M10 17l5-5-5-5z"/>
        </svg>
      </button>
      <div class="dpad-center"></div>
    </div>
    <div class="gamepad-buttons">
      <button class="action-btn btn-a" data-key="Enter">
        <span>A</span>
        <small>确认</small>
      </button>
      <button class="action-btn btn-b" data-key="Escape">
        <span>B</span>
        <small>取消</small>
      </button>
      <button class="action-btn btn-menu" data-key="KeyM">
        <span>☰</span>
        <small>菜单</small>
      </button>
    </div>
  `;

  // Add styles
  injectGamepadStyles();

  // Mount to DOM
  document.body.appendChild(gamepad);

  // Bind events
  bindGamepadEvents(gamepad);

  console.log('[VirtualGamepad] Virtual gamepad created');
}

/**
 * Inject CSS styles for virtual gamepad
 */
function injectGamepadStyles() {
  const style = document.createElement('style');
  style.id = 'virtual-gamepad-styles';
  style.textContent = `
    #virtual-gamepad {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding: 20px;
      padding-bottom: max(20px, env(safe-area-inset-bottom));
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }

    /* D-Pad Container */
    .gamepad-dpad {
      position: relative;
      width: 180px;
      height: 180px;
      pointer-events: auto;
    }

    .dpad-btn {
      position: absolute;
      width: 60px;
      height: 60px;
      border: none;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(10px);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: none;
      transition: all 0.1s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .dpad-btn:active {
      background: rgba(255, 255, 255, 0.4);
      transform: scale(0.95);
    }

    .dpad-up {
      top: 0;
      left: 60px;
    }

    .dpad-down {
      bottom: 0;
      left: 60px;
    }

    .dpad-left {
      top: 60px;
      left: 0;
    }

    .dpad-right {
      top: 60px;
      right: 0;
    }

    .dpad-center {
      position: absolute;
      top: 60px;
      left: 60px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.3);
      pointer-events: none;
    }

    /* Action Buttons */
    .gamepad-buttons {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      pointer-events: auto;
    }

    .action-btn {
      width: 70px;
      height: 70px;
      border: none;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(10px);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      touch-action: none;
      transition: all 0.1s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      gap: 2px;
    }

    .action-btn span {
      font-size: 24px;
      font-weight: bold;
      line-height: 1;
    }

    .action-btn small {
      font-size: 10px;
      opacity: 0.8;
    }

    .action-btn:active {
      background: rgba(255, 255, 255, 0.4);
      transform: scale(0.95);
    }

    .btn-a {
      background: rgba(52, 211, 153, 0.6);
    }

    .btn-b {
      background: rgba(248, 113, 113, 0.6);
    }

    .btn-menu {
      background: rgba(59, 130, 246, 0.6);
      width: 60px;
      height: 60px;
    }

    /* Landscape mode adjustments */
    @media (orientation: landscape) and (max-height: 500px) {
      #virtual-gamepad {
        padding: 10px;
        padding-bottom: max(10px, env(safe-area-inset-bottom));
      }

      .gamepad-dpad {
        width: 140px;
        height: 140px;
      }

      .dpad-btn {
        width: 46px;
        height: 46px;
      }

      .dpad-up { left: 47px; }
      .dpad-down { left: 47px; }
      .dpad-left { top: 47px; }
      .dpad-right { top: 47px; }
      .dpad-center {
        top: 47px;
        left: 47px;
        width: 46px;
        height: 46px;
      }

      .action-btn {
        width: 56px;
        height: 56px;
      }

      .btn-menu {
        width: 48px;
        height: 48px;
      }

      .action-btn span {
        font-size: 20px;
      }

      .action-btn small {
        font-size: 9px;
      }
    }
  `;

  document.head.appendChild(style);
}

/**
 * Bind touch events to gamepad buttons
 */
function bindGamepadEvents(gamepad: HTMLElement) {
  const buttons = gamepad.querySelectorAll('button[data-key]');

  buttons.forEach((button) => {
    const key = button.getAttribute('data-key')!;

    // Touch start - simulate key down
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);

      // Visual feedback
      button.classList.add('active');
    });

    // Touch end - simulate key up
    button.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const event = new KeyboardEvent('keyup', {
        key,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);

      // Remove visual feedback
      button.classList.remove('active');
    });

    // Touch cancel - also trigger key up
    button.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const event = new KeyboardEvent('keyup', {
        key,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);

      button.classList.remove('active');
    });
  });
}

/**
 * Remove virtual gamepad from DOM
 */
export function removeVirtualGamepad() {
  const gamepad = document.getElementById('virtual-gamepad');
  if (gamepad) {
    gamepad.remove();
  }

  const styles = document.getElementById('virtual-gamepad-styles');
  if (styles) {
    styles.remove();
  }
}

/**
 * Toggle gamepad visibility
 */
export function toggleGamepadVisibility(visible: boolean) {
  const gamepad = document.getElementById('virtual-gamepad');
  if (gamepad) {
    gamepad.style.display = visible ? 'flex' : 'none';
  }
}
