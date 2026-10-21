/**
 * Storage Adapter for Mobile Platforms
 * Uses Capacitor Preferences API on mobile, localStorage on web
 */

import { Capacitor } from '@capacitor/core';

// Type for Capacitor Preferences (will be loaded dynamically)
type PreferencesPlugin = {
  get: (options: { key: string }) => Promise<{ value: string | null }>;
  set: (options: { key: string; value: string }) => Promise<void>;
  remove: (options: { key: string }) => Promise<void>;
  keys: () => Promise<{ keys: string[] }>;
  clear: () => Promise<void>;
};

let Preferences: PreferencesPlugin | null = null;

/**
 * Initialize storage adapter
 */
export async function initStorageAdapter() {
  if (Capacitor.isNativePlatform()) {
    try {
      const module = await import('@capacitor/preferences');
      Preferences = module.Preferences;
      console.log('[Storage] Using Capacitor Preferences API');
    } catch (e) {
      console.warn('[Storage] Failed to load Preferences plugin, falling back to localStorage');
    }
  } else {
    console.log('[Storage] Using localStorage (web platform)');
  }
}

/**
 * Get item from storage
 */
export async function getItem(key: string): Promise<string | null> {
  if (Preferences) {
    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch (e) {
      console.error('[Storage] Failed to get item:', key, e);
      return null;
    }
  } else {
    // Fallback to localStorage
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error('[Storage] localStorage.getItem failed:', key, e);
      return null;
    }
  }
}

/**
 * Set item in storage
 */
export async function setItem(key: string, value: string): Promise<void> {
  if (Preferences) {
    try {
      await Preferences.set({ key, value });
    } catch (e) {
      console.error('[Storage] Failed to set item:', key, e);
    }
  } else {
    // Fallback to localStorage
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('[Storage] localStorage.setItem failed:', key, e);
    }
  }
}

/**
 * Remove item from storage
 */
export async function removeItem(key: string): Promise<void> {
  if (Preferences) {
    try {
      await Preferences.remove({ key });
    } catch (e) {
      console.error('[Storage] Failed to remove item:', key, e);
    }
  } else {
    // Fallback to localStorage
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error('[Storage] localStorage.removeItem failed:', key, e);
    }
  }
}

/**
 * Get all keys
 */
export async function getAllKeys(): Promise<string[]> {
  if (Preferences) {
    try {
      const { keys } = await Preferences.keys();
      return keys;
    } catch (e) {
      console.error('[Storage] Failed to get keys:', e);
      return [];
    }
  } else {
    // Fallback to localStorage
    try {
      return Object.keys(localStorage);
    } catch (e) {
      console.error('[Storage] localStorage.keys failed:', e);
      return [];
    }
  }
}

/**
 * Clear all storage
 */
export async function clearStorage(): Promise<void> {
  if (Preferences) {
    try {
      await Preferences.clear();
    } catch (e) {
      console.error('[Storage] Failed to clear storage:', e);
    }
  } else {
    // Fallback to localStorage
    try {
      localStorage.clear();
    } catch (e) {
      console.error('[Storage] localStorage.clear failed:', e);
    }
  }
}

/**
 * Save game data (convenience wrapper)
 */
export async function saveGameData(slot: number, data: any): Promise<void> {
  const key = `pal-save-${slot}`;
  const value = JSON.stringify(data);
  await setItem(key, value);
  console.log(`[Storage] Game saved to slot ${slot}`);
}

/**
 * Load game data (convenience wrapper)
 */
export async function loadGameData(slot: number): Promise<any | null> {
  const key = `pal-save-${slot}`;
  const value = await getItem(key);

  if (value) {
    try {
      return JSON.parse(value);
    } catch (e) {
      console.error(`[Storage] Failed to parse save data from slot ${slot}:`, e);
      return null;
    }
  }

  return null;
}

/**
 * Check if save exists
 */
export async function hasSaveData(slot: number): Promise<boolean> {
  const key = `pal-save-${slot}`;
  const value = await getItem(key);
  return value !== null;
}

/**
 * Get all save slots with data
 */
export async function getSaveSlots(): Promise<number[]> {
  const keys = await getAllKeys();
  const saveKeys = keys.filter((k) => k.startsWith('pal-save-'));
  return saveKeys
    .map((k) => {
      const match = k.match(/pal-save-(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}
