import traceModuleLoad from './util-trace';
import { log } from './common';
import config from './config';
import worldService from '../../services/world-service.js';
import { decodeSoundChunk, isWav } from '../../services/voc';

traceModuleLoad('sound module load');

type SoundArchive = {
  readChunk: (n: number) => Uint8Array | ArrayBuffer | null | undefined;
  getChunkCount: () => number;
};

let audioContext: AudioContext | null = null;
let contextFailed = false;
let archivePromise: Promise<SoundArchive | null> | null = null;
const bufferCache = new Map<number, Promise<AudioBuffer | null>>();

function soundEnabled(): boolean {
  // Same master switch as music.ts (enableAudio). audioBaseUrl only locates the
  // MP3 music folder; effects come from the MKF archives under assetBaseUrl.
  if (!config.enableAudio) return false;
  try {
    if (worldService.getNoSoundFlag()) return false;
  } catch (_) {
    // world state not initialised yet: treat as sound on
  }
  return true;
}

function getContext(): AudioContext | null {
  if (contextFailed) return null;
  if (!audioContext) {
    const g: any = typeof window !== 'undefined' ? window : null;
    const Ctor = g && (g.AudioContext || g.webkitAudioContext);
    if (typeof Ctor !== 'function') {
      contextFailed = true;
      return null;
    }
    try {
      audioContext = new Ctor() as AudioContext;
    } catch (ex: any) {
      contextFailed = true;
      log.warn('[SOUND] AudioContext unavailable: %s', ex && ex.message ? ex.message : ex);
      return null;
    }
    installGestureResume(g);
  }
  if (audioContext.state === 'suspended') {
    try {
      const p: any = audioContext.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
      // autoplay policy: retried on the next user gesture
    }
  }
  return audioContext;
}

function installGestureResume(g: any) {
  if (!g || typeof g.addEventListener !== 'function') return;
  const events = ['pointerdown', 'keydown', 'touchstart'];
  const onGesture = () => {
    if (!audioContext || audioContext.state !== 'suspended') {
      events.forEach((ev) => g.removeEventListener(ev, onGesture, true));
      return;
    }
    try {
      const p: any = audioContext.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
      // ignore
    }
  };
  events.forEach((ev) => g.addEventListener(ev, onGesture, true));
}

function isUsableArchive(mkf: any): boolean {
  try {
    return !!mkf && typeof mkf.readChunk === 'function' && typeof mkf.getChunkCount === 'function'
      && mkf.getChunkCount() > 0;
  } catch (_) {
    return false;
  }
}

function loadArchive(): Promise<SoundArchive | null> {
  if (!archivePromise) {
    archivePromise = (async () => {
      try {
        // Lazy import keeps resource-service out of this module's eval-time graph.
        const { default: resourceService } = await import('../../services/resource-service');
        // SDLPAL checks voc.mkf before sounds.mkf; the DOS data ships VOC.MKF.
        for (const name of ['VOC', 'SOUNDS']) {
          const cached = resourceService.getMKF(name);
          if (isUsableArchive(cached)) return cached as any;
          const mkf = await resourceService.loadMKF(name);
          if (isUsableArchive(mkf)) return mkf as any;
        }
      } catch (ex: any) {
        log.warn('[SOUND] sound archive unavailable: %s', ex && ex.message ? ex.message : ex);
      }
      return null;
    })();
  }
  return archivePromise;
}

function readChunk(archive: SoundArchive, num: number): Uint8Array | null {
  try {
    if (num >= archive.getChunkCount()) return null;
    const raw = archive.readChunk(num);
    if (!raw) return null;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
    return bytes.length ? bytes : null;
  } catch (_) {
    return null;
  }
}

async function decodeToBuffer(ctx: AudioContext, bytes: Uint8Array): Promise<AudioBuffer | null> {
  const pcm = decodeSoundChunk(bytes);
  if (pcm) {
    const frames = Math.floor(pcm.samples.length / pcm.channels);
    if (!frames) return null;
    const buffer = ctx.createBuffer(pcm.channels, frames, pcm.sampleRate);
    for (let c = 0; c < pcm.channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < frames; i++) data[i] = pcm.samples[i * pcm.channels + c];
    }
    return buffer;
  }
  if (isWav(bytes)) {
    // Non-PCM WAVE (e.g. ADPCM): let the browser decode it. Copy because
    // decodeAudioData detaches its input.
    const copy = bytes.slice().buffer;
    return await new Promise<AudioBuffer | null>((resolve) => {
      try {
        const p: any = ctx.decodeAudioData(copy, (b) => resolve(b), () => resolve(null));
        if (p && typeof p.catch === 'function') p.catch(() => resolve(null));
      } catch (_) {
        resolve(null);
      }
    });
  }
  return null;
}

function getBuffer(ctx: AudioContext, num: number): Promise<AudioBuffer | null> {
  let pending = bufferCache.get(num);
  if (!pending) {
    pending = loadArchive().then((archive) => {
      if (!archive) return null;
      const bytes = readChunk(archive, num);
      return bytes ? decodeToBuffer(ctx, bytes) : null;
    }).catch((ex: any) => {
      log.warn('[SOUND] decode %d failed: %s', num, ex && ex.message ? ex.message : ex);
      return null;
    });
    bufferCache.set(num, pending);
  }
  return pending;
}

function playBuffer(ctx: AudioContext, buffer: AudioBuffer) {
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  } catch (ex: any) {
    log.warn('[SOUND] start failed: %s', ex && ex.message ? ex.message : ex);
  }
}

// Loads the archive and decodes every effect in the background, like SDLPAL which has all
// sounds available from the start, so the first plays are not delayed by the download.
function preloadAll() {
  if (!config.enableAudio) return;
  const ctx = getContext();
  if (!ctx) return;
  loadArchive().then((archive) => {
    if (!archive) return;
    let count = 0;
    try {
      count = archive.getChunkCount();
    } catch (_) {
      count = 0;
    }
    for (let n = 0; n < count; n++) {
      getBuffer(ctx, n);
    }
  }, () => {});
}

var sound = {
  /**
   * Starts preloading at engine init. Returns immediately (the game does not wait for audio);
   * a no-op headless or with audio disabled.
   */
  init: function*(): Generator<any, void, any> {
    try {
      preloadAll();
    } catch (ex: any) {
      log.warn('[SOUND] preload failed: %s', ex && ex.message ? ex.message : ex);
    }
  },

  /**
   * Fire-and-forget, like SDLPAL AUDIO_PlaySound: effect |n| from VOC.MKF
   * (or SOUNDS.MKF). Never throws and never blocks the caller.
   */
  play: function(...args: any[]) {
    if (typeof (globalThis as any).PAL_SOUND_DEBUG === 'boolean' && (globalThis as any).PAL_SOUND_DEBUG) {
      log.debug(['[SOUND] play'].concat(args).join(' '));
    }
    try {
      const num = Math.abs(Math.trunc(Number(args[0])));
      if (!Number.isFinite(num) || !soundEnabled()) return;
      const ctx = getContext();
      if (!ctx) return;
      getBuffer(ctx, num).then((buffer) => {
        if (!buffer || !soundEnabled()) return;
        playBuffer(ctx, buffer);
      }, () => {});
    } catch (ex: any) {
      log.warn('[SOUND] play failed: %s', ex && ex.message ? ex.message : ex);
    }
  }
};

export default sound;
