import utils from './utils';
import { random } from '../../services/random.js';
import resourceService from '../../services/resource-service.js';
import MKF from './mkf';
import Sprite from './sprite';
import Palette from './palette';
import input, { Key } from './input';
import rng from './rng';
import co from './co';
import config from './config';

declare const log: any;
declare const sleep: any;
declare const randomLong: ((min: number, max: number) => number) | undefined;
declare const FrameTime: number | undefined;
declare const PAL_XY: any;

type SurfaceLike = {
  setPalette: (palette: any) => void;
  fadeOut: (steps: number) => any;
  blitFBP: (buffer: any, src: any, dest: any) => void;
  blitRLE: (frame: any, pos: any) => void;
  updateScreen: (rect?: any) => void;
};

log.trace('welcome module load');

const BITMAPNUM_SPLASH_UP = 0x26;
const BITMAPNUM_SPLASH_DOWN = 0x27;
const SPRITENUM_SPLASH_TITLE = 0x47;
const SPRITENUM_SPLASH_CRANE = 0x49;
const NUM_RIX_TITLE = 0x5;

type MkfGuardOptions = {
  decompress?: boolean;
};

function assertMkfChunk(stage: string, mkf: MKF | null | undefined, name: string, chunk: number, label: string, options?: MkfGuardOptions) {
  if (!mkf || typeof mkf.getChunkCount !== 'function') {
    console.error('[welcome] MKF guard missing instance', {
      stage,
      name,
      chunk,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[welcome] MKF guard missing ${name} @${stage}`);
  }
  let chunkCount = 0;
  try {
    chunkCount = mkf.getChunkCount();
  } catch {
    chunkCount = 0;
  }
  if (chunkCount <= chunk) {
    console.error('[welcome] MKF guard chunk out of range', {
      stage,
      name,
      chunk,
      chunkCount,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[welcome] MKF guard chunk out of range ${name}#${chunk} @${stage}`);
  }
  const chunkSize = mkf.getChunkSize(chunk);
  if (chunkSize <= 0) {
    console.error('[welcome] MKF guard chunk empty', {
      stage,
      name,
      chunk,
      chunkCount,
      chunkSize,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[welcome] MKF guard empty chunk ${name}#${chunk} @${stage}`);
  }
  const data = options && options.decompress === false
    ? mkf.readChunk(chunk)
    : mkf.decompressChunk(chunk);
  if (!data || data.length === 0) {
    console.error('[welcome] MKF guard decompressed empty', {
      stage,
      name,
      chunk,
      chunkSize,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[welcome] MKF guard empty data ${name}#${chunk} @${stage}`);
  }
  return data;
}

function getOverlayPreference() {
  if (typeof window !== 'undefined' && typeof (window as any).PAL_OVERLAY_PREFERENCE === 'string') {
    return (window as any).PAL_OVERLAY_PREFERENCE;
  }
  return 'off';
}

function setOverlayMode(mode: string) {
  if (typeof window !== 'undefined' && typeof (window as any).PAL_SET_OVERLAY_MODE === 'function') {
    (window as any).PAL_SET_OVERLAY_MODE(mode);
  }
}

function setLegacyCanvasVisible(show = true) {
  if (typeof document === 'undefined') {
    return;
  }
  const canvas = document.getElementById('cvs') as HTMLCanvasElement | null;
  if (canvas) {
    canvas.style.display = show ? '' : 'none';
  }
  const debugCanvas = document.getElementById('debug') as HTMLCanvasElement | null;
  if (debugCanvas) {
    debugCanvas.style.display = show ? '' : 'none';
  }
}

function withOverlaySuspended<T extends (surface: SurfaceLike) => Generator<any, any, any>>(generatorFn: T) {
  return function* overlayWrapper(this: unknown, surface: SurfaceLike): Generator<any, any, any> {
    const preferred = getOverlayPreference();
    setOverlayMode('off');
    setLegacyCanvasVisible(true);
    try {
      return yield* generatorFn.call(this, surface);
    } finally {
      if (preferred && preferred !== 'off') {
        setOverlayMode(preferred);
      }
    }
  };
}

const welcome: any = {};

welcome.trademarkScreen = withOverlaySuspended(function* (surface: SurfaceLike) {
  const safeSleep = (ms: number) => (typeof sleep === 'function' ? sleep(ms) : Promise.resolve());
  log.debug('[welcome] trademark start');
  try {
    const pat = resourceService.getMKF('PAT') as unknown as MKF;
    assertMkfChunk('welcome.trademark', pat, 'PAT', 3, 'trademark-palette', { decompress: false });
    const palette = Palette.get(3).day;
    surface.setPalette(palette);
    const rngNum = 6;
    const startFrame = 0;
    const endFrame = 200;
    const speed: number = 25;
    // Play RNG with a generous cap so it doesn't skip prematurely.
    const frameDelayMs = 1000 / (speed === 0 ? 16 : speed);
    const expectedMs = Math.ceil((endFrame - startFrame + 1) * frameDelayMs);
    const capMs = expectedMs + 800;
    const playPromise = co(rng.play(rngNum, startFrame, endFrame, speed));
    const timeout = safeSleep(capMs);
    yield Promise.race([playPromise, timeout]);
    yield safeSleep(300);
    yield surface.fadeOut(1);
  } catch (err) {
    console.warn('[welcome] trademark error', err);
  } finally {
    input.init();
    input.clear();
    log.debug('[welcome] trademark end');
  }
});

welcome.splashScreen = withOverlaySuspended(function* (surface: SurfaceLike) {
  const skipSplash = (typeof window !== 'undefined' && 'PAL_SKIP_SPLASH' in window)
    ? !!(window as any).PAL_SKIP_SPLASH
    : false; // default skip to avoid hangs; set PAL_SKIP_SPLASH=false to force play
  if (skipSplash) {
    log.warn('[welcome] splash skipped (PAL_SKIP_SPLASH)');
    try {
      yield surface.fadeOut(0);
    } catch {
      // ignore
    }
    return;
  }
  const rand = (typeof randomLong === 'function')
    ? randomLong
    : (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
  const frameTime = (typeof FrameTime === 'number' && FrameTime > 0) ? FrameTime : (1000 / 24);
  const safeSleep = (ms: number) => (typeof sleep === 'function' ? sleep(ms) : Promise.resolve());
  log.debug('[welcome] splash start');
  const splashStartTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    yield resourceService.loadMKF('FBP', 'PAT', 'MGO');
    const fbp = resourceService.getMKF('FBP') as unknown as MKF;
    const mgo = resourceService.getMKF('MGO') as unknown as MKF;
    const pat = resourceService.getMKF('PAT') as unknown as MKF;
    assertMkfChunk('welcome.splash', pat, 'PAT', 1, 'splash-palette', { decompress: false });
    const up = assertMkfChunk('welcome.splash', fbp, 'FBP', BITMAPNUM_SPLASH_UP, 'splash-up');
    const down = assertMkfChunk('welcome.splash', fbp, 'FBP', BITMAPNUM_SPLASH_DOWN, 'splash-down');
    const titleChunk = assertMkfChunk('welcome.splash', mgo, 'MGO', SPRITENUM_SPLASH_TITLE, 'splash-title');
    const craneChunk = assertMkfChunk('welcome.splash', mgo, 'MGO', SPRITENUM_SPLASH_CRANE, 'splash-crane');
    const titleSprite = new Sprite(titleChunk);
    const titleBitmap = titleSprite.getFrame(0) as any;
    if (!titleBitmap) {
      throw new Error('[welcome] splash missing title frame');
    }
    const craneSprite = new Sprite(craneChunk);
    const titleHeight = titleBitmap.height || 0;
    titleBitmap[2] = titleBitmap[3] = 0; // force width animation

    // Generate the positions of the cranes
    const cranepos = utils.initArray(Array, 6);
    for (let idx = 0; idx < cranepos.length; idx++) {
      cranepos[idx][0] = rand(300, 600);
      cranepos[idx][1] = rand(0, 80);
      cranepos[idx][2] = rand(0, 8);
    }

    input.init();
    input.clear();
    const palette = Palette.get(1).day;
    const currentPalette: Array<{ r: number; g: number; b: number }> = [];
    const fadeInTime = 1500;
    const rollTime = 2000;
    const minTitleRevealMs = titleHeight > 0 ? Math.ceil((titleHeight + 8) * frameTime) : 0;
    const splashTime = Math.max(4000, rollTime + 1000, minTitleRevealMs + 1000);
    const maxElapsedMs = Math.max(12000, splashTime + 2000); // guard to avoid hanging
    const maxFramesHardCap = Math.max(240, Math.ceil((maxElapsedMs / frameTime) + 10));
    for (let idx = 0; idx < palette.length; ++idx) {
      const p = palette[idx];
      currentPalette[idx] = { r: p.r, g: p.g, b: p.b };
    }
    let iCraneFrame = 0;
    let time = 0;
    let lastFrame = performance.now();
    let maxFrames = Math.ceil(splashTime / frameTime) + 10;
    let exitReason = 'time';
    const inputGateAt = Date.now() + 200;

    while (time < splashTime && maxFrames-- > 0 && iCraneFrame < maxFramesHardCap) {
      const totalElapsed = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - splashStartTs;
      if (totalElapsed > maxElapsedMs) {
        exitReason = 'timeout-guard';
        log.warn('[welcome] splash timeout guard hit', totalElapsed, 'ms');
        break;
      }
      const now = performance.now();
      const delta = now - lastFrame;
      lastFrame = now;
      time += delta;

      let imagePos = ~~(200 * (rollTime - time) / rollTime);
      if (imagePos > 200) imagePos = 200;
      if (imagePos < 0) imagePos = 0;
      surface.blitFBP(up, { x: 0, y: imagePos, w: 320, h: 200 - imagePos }, { x: 0, y: 0, w: 320, h: 200 - imagePos });
      surface.blitFBP(down, { x: 0, y: 0, w: 320, h: imagePos }, { x: 0, y: 200 - imagePos, w: 320, h: imagePos });

      for (let idx = 0; idx < cranepos.length; idx++) {
        const frame = craneSprite.getFrame(
          cranepos[idx][2] = (cranepos[idx][2] + (iCraneFrame % 2)) % 8
        );
        cranepos[idx][1] += ((imagePos > 0) && (imagePos % 2)) ? 1 : 0;
        surface.blitRLE(frame, PAL_XY(cranepos[idx][0], cranepos[idx][1]));
        cranepos[idx][0]--;
      }
      iCraneFrame++;

      if (titleBitmap.height < titleHeight) {
        let w2 = titleBitmap[2] | (titleBitmap[3] << 8);
        w2++;
        titleBitmap[2] = (w2 & 0xFF);
        titleBitmap[3] = (w2 >> 8);
      }
      surface.blitRLE(titleBitmap, PAL_XY(255, 10));

      if (time < splashTime) {
        for (let idx = 0; idx < 256; idx++) {
          currentPalette[idx].r = (palette[idx].r * (time / fadeInTime));
          currentPalette[idx].g = (palette[idx].g * (time / fadeInTime));
          currentPalette[idx].b = (palette[idx].b * (time / fadeInTime));
        }
      }
      surface.setPalette(currentPalette);
      surface.updateScreen(null);

      if (input.keyPress & (Key.Menu | Key.Search)) {
        const isSimulated = typeof input.isSimulatedInputActive === 'function'
          ? input.isSimulatedInputActive(350)
          : false;
        const isFreshUser = input.lastUserInputAt >= inputGateAt;
        if (isFreshUser && !isSimulated) {
          log.debug('[welcome] splash skipped by key');
          exitReason = 'user-skip';
          break;
        }
      }
      yield safeSleep(frameTime);
    }

    if (iCraneFrame >= maxFramesHardCap) {
      exitReason = 'hard-cap';
    } else if (maxFrames <= 0) {
      exitReason = 'frame-limit';
    } else if (time < splashTime) {
      exitReason = exitReason || 'early-exit';
    }

    yield surface.fadeOut(1);
    const splashEndTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    log.debug('[welcome] splash end', {
      frames: iCraneFrame,
      exitReason,
      elapsedMs: Math.round(splashEndTs - splashStartTs)
    });
  } catch (err) {
    console.warn('[welcome] splash error, skipping', err);
  } finally {
    input.init();
    input.clear();
  }
});

export default welcome;
