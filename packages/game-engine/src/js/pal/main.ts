import traceModuleLoad from './util-trace';
import { configureTimeline } from '../../ai/timeline';
import input from '../../services/input-service';
import Surface from './surface';
import Palette from './palette';
import welcome from './welcome';
import _ui from './ui';
import scene from './scene';

const ui = _ui as any;
import uigame from './uigame';
import music from './music';
import game from './game';
import rng from '../../services/rng-service';
import co from './co';
import _services from '../../services/index';
import modService from '../../services/mod-service';
import worldService from '../../services/world-service';
import { isNightPaletteEnabled } from '../../services/environment-adapter';
import { bootstrapAI } from '../../dev-autopilot/ai-controller';
import '../../tools/storygraph-export';
import '../../tools/npc-map-export';
import config from './config';
import overviewController from './overview-controller.js';
import panoramaRenderer from './panorama-renderer.js';
import panoramaControls from './panorama-controls.js';
import panoramaDialog from './panorama-dialog.js';
import { Files, PAL_CLASSIC, PAL_XY } from './pal-global';

const services = _services as any;

traceModuleLoad('main module load');

const main: any = {};
const STARTUP_MKFS = ['FBP', 'MGO', 'BALL', 'DATA', 'F', 'FIRE', 'RGM', 'SSS', 'PAT'] as const;
const SCENE_MKFS = ['MAP', 'GOP', 'MGO'] as const;

main.initGlobals = function*(): Generator<any, any, any> {
  worldService.setPartyDirection(4);
  worldService.setFrameNum(0);
  worldService.setObjectDescTable(null);
  if (!PAL_CLASSIC) {
    //#ifndef PAL_CLASSIC
    //   BYTE             bBattleSpeed;        // Battle Speed (1 = Fastest, 5 = Slowest)
    //#endif
    worldService.setBattleSpeed(2);
  }

  // Open files
  yield services.resource.loadMKF(...STARTUP_MKFS);
  STARTUP_MKFS.forEach(function(name) {
    Files[name] = services.resource.getMKF(name);
  });

  const objectDesc = yield services.resource.loadObjectDesc('desc.dat');
  worldService.setObjectDescTable(objectDesc);

  worldService.setCurrentSaveSlot(1);
};

function assertMkfsLoaded(stage: string, names: readonly string[]) {
  const resource = services && services.resource;
  if (!resource || typeof resource.getMKF !== 'function') {
    console.error('[main] MKF guard missing resource service', { stage });
    throw new Error(`[main] MKF guard missing resource service at ${stage}`);
  }
  const missing: string[] = [];
  names.forEach((name) => {
    let mkf = Files[name];
    if (!mkf) {
      mkf = resource.getMKF(name);
      if (mkf) {
        Files[name] = mkf;
      }
    }
    let chunkCount = 0;
    try {
      chunkCount = mkf && typeof mkf.getChunkCount === 'function' ? mkf.getChunkCount() : 0;
    } catch (err) {
      chunkCount = 0;
    }
    if (!mkf || chunkCount <= 0) {
      missing.push(name);
      console.error('[main] MKF guard failed', {
        stage,
        name,
        chunkCount,
        assetBaseUrl: (config as any).assetBaseUrl
      });
    }
  });
  if (missing.length) {
    throw new Error(`[main] MKF guard failed @${stage}: ${missing.join(', ')}`);
  }
}

function assertMkfChunk(stage: string, name: string, chunk: number, label: string) {
  const resource = services && services.resource;
  if (!resource || typeof resource.getMKF !== 'function') {
    console.error('[main] MKF guard missing resource service', { stage, name, chunk, label });
    throw new Error(`[main] MKF guard missing resource service at ${stage}`);
  }
  let mkf = Files[name];
  if (!mkf) {
    mkf = resource.getMKF(name);
    if (mkf) {
      Files[name] = mkf;
    }
  }
  if (!mkf || typeof mkf.getChunkCount !== 'function') {
    console.error('[main] MKF guard missing instance', {
      stage,
      name,
      chunk,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard missing ${name} @${stage}`);
  }
  let chunkCount = 0;
  try {
    chunkCount = mkf.getChunkCount();
  } catch {
    chunkCount = 0;
  }
  if (chunkCount <= chunk) {
    console.error('[main] MKF guard chunk out of range', {
      stage,
      name,
      chunk,
      chunkCount,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard chunk out of range ${name}#${chunk} @${stage}`);
  }
  const chunkSize = typeof mkf.getChunkSize === 'function' ? mkf.getChunkSize(chunk) : -1;
  if (chunkSize <= 0) {
    console.error('[main] MKF guard chunk empty', {
      stage,
      name,
      chunk,
      chunkCount,
      chunkSize,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard empty chunk ${name}#${chunk} @${stage}`);
  }
  const data = typeof mkf.decompressChunk === 'function'
    ? mkf.decompressChunk(chunk)
    : (typeof mkf.readChunk === 'function' ? mkf.readChunk(chunk) : null);
  if (!data || data.length === 0) {
    console.error('[main] MKF guard decompressed empty', {
      stage,
      name,
      chunk,
      chunkSize,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard empty data ${name}#${chunk} @${stage}`);
  }
}

function assertMkfHasNonEmptyChunk(stage: string, name: string, label: string) {
  const resource = services && services.resource;
  if (!resource || typeof resource.getMKF !== 'function') {
    console.error('[main] MKF guard missing resource service', { stage, name, label });
    throw new Error(`[main] MKF guard missing resource service at ${stage}`);
  }
  let mkf = Files[name];
  if (!mkf) {
    mkf = resource.getMKF(name);
    if (mkf) {
      Files[name] = mkf;
    }
  }
  if (!mkf || typeof mkf.getChunkCount !== 'function') {
    console.error('[main] MKF guard missing instance', {
      stage,
      name,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard missing ${name} @${stage}`);
  }
  const chunkCount = mkf.getChunkCount();
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
    console.error('[main] MKF guard invalid chunk count', {
      stage,
      name,
      chunkCount,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard invalid chunk count ${name} @${stage}`);
  }
  let found = -1;
  let chunkSize = 0;
  for (let i = 0; i < chunkCount; i++) {
    const size = mkf.getChunkSize(i);
    if (size > 0) {
      found = i;
      chunkSize = size;
      break;
    }
  }
  if (found < 0) {
    console.error('[main] MKF guard no non-empty chunks', {
      stage,
      name,
      chunkCount,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard no non-empty chunks ${name} @${stage}`);
  }
  if (found !== 0) {
    console.warn('[main] MKF guard chunk 0 empty, using fallback', {
      stage,
      name,
      fallbackChunk: found,
      chunkSize,
      label
    });
  }
  const data = typeof mkf.decompressChunk === 'function'
    ? mkf.decompressChunk(found)
    : (typeof mkf.readChunk === 'function' ? mkf.readChunk(found) : null);
  if (!data || data.length === 0) {
    console.error('[main] MKF guard decompressed empty', {
      stage,
      name,
      chunk: found,
      chunkSize,
      label,
      assetBaseUrl: (config as any).assetBaseUrl
    });
    throw new Error(`[main] MKF guard empty data ${name}#${found} @${stage}`);
  }
}

function runStage(label: string, gen: any, timeoutMs = 8000) {
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let timeoutHandle: any = null;
  const stage = co(gen);
  const timeoutSentinel = Symbol('timeout');
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve(timeoutSentinel), timeoutMs);
  });
  return Promise.race([stage, timeoutPromise])
    .then((res) => {
      clearTimeout(timeoutHandle);
      const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (res === timeoutSentinel) {
        console.warn('[main] stage timeout - skipping', label, 'after', timeoutMs, 'ms');
      } else {
        console.log('[main] stage done', label, 'in', Math.round(end - start), 'ms');
      }
      if (res === timeoutSentinel) {
        return null;
      }
      return res;
    })
    .catch((err) => {
      clearTimeout(timeoutHandle);
      console.error('[main] stage failed', label, err);
      throw err;
    });
}

function PAL_XY_safe(x: number, y: number) {
  if (typeof PAL_XY === 'function') {
    return PAL_XY(x, y);
  }
  return (y << 16) | (x & 0xffff);
}

main.showStartMenu = function*(): Generator<any, number, any> {
  let selection = ui.MENUITEM_VALUE_CANCELLED;
  while (selection === ui.MENUITEM_VALUE_CANCELLED) {
    selection = yield uigame.openingMenu();
  }
  return selection;
};

main.start = function() {
  return co(function*() {
    yield main.initGlobals();
    assertMkfsLoaded('initGlobals', STARTUP_MKFS);

    const resource = services.resource;
    if (resource) {
      yield resource.loadMKF('DATA', 'FBP');
    }

    (globalThis as any).services = services;
    services.world.init();
    if (typeof window !== 'undefined') {
      (window as any).services = services;
    }

    if (config.enableMud && services.mud && typeof services.mud.start === 'function') {
      try {
        yield services.mud.start();
        if (typeof window !== 'undefined') {
          (window as any).mudBridge = services.mud;
        }
      } catch (err) {
        console.warn('[main] Mud bridge failed to start', err);
      }
    }

    Palette.init(Files.PAT);

    const panoramaPreferred = !!config.enablePanorama;
    const gpsPreferred = !!config.enableOverviewMode;
    const applyPanoramaMode = (enabled: boolean) => {
      const targetMode = enabled ? 'panorama' : 'off';
      if (panoramaRenderer && typeof panoramaRenderer.setMode === 'function') {
        panoramaRenderer.setMode(targetMode);
      }
      if (panoramaControls && typeof panoramaControls.init === 'function') {
        panoramaControls.init();
        panoramaControls.setMode(targetMode);
      }
      if (panoramaDialog && typeof panoramaDialog.setMode === 'function') {
        panoramaDialog.setMode(targetMode);
      }
      if (typeof window !== 'undefined') {
        (window as any).PAL_OVERLAY_ACTIVE = targetMode;
      }
      return targetMode;
    };
    const applyGpsOverlay = (enabled: boolean) => {
      if (overviewController && typeof overviewController.setMode === 'function') {
        overviewController.setMode(enabled ? 'gps' : 'off');
      } else if (overviewController && typeof overviewController.setEnabled === 'function') {
        overviewController.setEnabled(!!enabled);
      }
      return !!enabled;
    };

    const overlayPreference = panoramaPreferred
      ? 'panorama'
      : (gpsPreferred ? 'gps' : 'off');

    let currentPanoramaMode = applyPanoramaMode(panoramaPreferred);
    let gpsOverlayEnabled = applyGpsOverlay(gpsPreferred);
    if (typeof window !== 'undefined') {
      (window as any).PAL_OVERLAY_PREFERENCE = overlayPreference;
      (window as any).PAL_SET_OVERLAY_MODE = (mode: string) => applyPanoramaMode(mode === 'panorama');
      (window as any).PAL_SET_GPS_MODE = (flag: boolean) => applyGpsOverlay(flag !== false);
      (window as any).PAL_GPS_ENABLED = gpsPreferred;
    }
    if (!services.panorama) {
      services.panorama = panoramaRenderer;
    }
    services.panoramaDialog = panoramaDialog;
    if (panoramaRenderer && typeof panoramaRenderer.ensureCanvas === 'function') {
      panoramaRenderer.ensureCanvas();
    }

    if (modService && typeof modService.prepare === 'function') {
      yield modService.prepare();
    }

    const baseWidth = 320;
    const baseHeight = 200;
    const canvas = document.getElementById('cvs') as HTMLCanvasElement;
    const debugCanvas = document.getElementById('debug') as HTMLCanvasElement;
    var surf: any = new Surface(
      canvas,
      baseWidth,
      baseHeight,
      debugCanvas
    );
    // Ensure the surface starts with the correct palette to avoid a black screen.
    try {
      const initialPalette = Palette.get(0);
      const paletteColors = initialPalette
        ? (isNightPaletteEnabled() ? initialPalette.night : initialPalette.day)
        : null;
      if (Array.isArray(paletteColors) && paletteColors.length > 0) {
        surf.setPalette(paletteColors, true);
      }
    } catch (err: any) {
      console.warn('[main] failed to set initial palette', err && err.message ? err.message : err);
    }
    // Paint an initial frame so the canvas is visibly non-black before rendering kicks in.
    try {
      surf.byteBuffer.fill(7);
      surf.updateScreen(null);
    } catch (err: any) {
      console.warn('[main] failed to paint initial frame', err && err.message ? err.message : err);
    }

    yield ui.init(surf, services); // 初始化UI，内含初始化文字
    if (panoramaDialog && typeof panoramaDialog.init === 'function') {
      panoramaDialog.init({ dialogService: services.dialog });
    }

    yield rng.init(surf);

    input.init();

    yield runStage('welcome.trademark', welcome.trademarkScreen(surf), 8000); // 软星商标

    yield runStage('welcome.splash', welcome.splashScreen(surf), 12000); // 开场动画

    // 先初始化场景，确保有背景，再显示开始菜单
    yield runStage('scene.init', scene.init(surf), 60000); // 初始化场景 — GOP.MKF 11.5MB,慢网需宽超时(8s 会半截掐断→MKF 空→guard 报 chunkCount 0)
    assertMkfsLoaded('scene.init', SCENE_MKFS);
    assertMkfHasNonEmptyChunk('scene.init', 'MAP', 'map-any');
    assertMkfHasNonEmptyChunk('scene.init', 'GOP', 'gop-any');

    if (panoramaPreferred && currentPanoramaMode !== 'panorama') {
      currentPanoramaMode = applyPanoramaMode(true);
    }
    if (gpsPreferred !== gpsOverlayEnabled) {
      gpsOverlayEnabled = applyGpsOverlay(gpsPreferred);
    }

    input.init();

    yield game.init(surf);

    // ?ai=1 → dev autopilot (player automation). AI NPCs live on the PAL
    // server now (?server=1, wired in the playground bootstrap), not in here.
    let runtimeAiFlag = false;
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        runtimeAiFlag = params.get('ai') === '1' || window.location.search.includes('ai=1');
      } catch (err) {
        runtimeAiFlag = typeof window !== 'undefined' && window.location.search.includes('ai=1');
      }
    }
    const enablePlayerAI = runtimeAiFlag && config.enableAIControl;
    if (enablePlayerAI) {
      bootstrapAI({
        logStart: true,
        useLLM: enablePlayerAI,
        enablePlayerAutomation: enablePlayerAI
      }).catch((err: any) => {
        console.error('[main] Failed to bootstrap AI controller', err);
      });
    }

    if (typeof window !== 'undefined') {
      (window as any).bootstrapAI = bootstrapAI;
    }

    // Kick off the main game loop asynchronously; do not block start() on it.
    // aigg-mud-pal new timeline (?timeline=yuhang|suzhou|<scene>): skip the
    // start menu, boot a fresh game straight into the living world — the
    // spawn jump + story suppression happen in play.update (see ai/timeline).
    const timeline = configureTimeline(
      typeof location !== 'undefined' ? new URLSearchParams(location.search).get('timeline') : null
    );
    if (timeline) {
      console.log(`[main] 新时间线: ${timeline.name} → scene ${timeline.startScene}(原剧情脚本停用)`);
      // the panorama overlay belongs to the canon's cinematic dialogs —
      // the new timeline always renders classic (no story, no cinematics)
      if (typeof window !== 'undefined') {
        (window as any).PAL_OVERLAY_PREFERENCE = 'off';
      }
    }
    co(function*() {
      let selection = 0;
      if (!timeline) {
        selection = yield* main.showStartMenu();
        // PAL_OpeningMenu ends by stopping the music and fading out; the scene then fades in
        // through fNeedToFadeIn.
        music.play(0, false, 1);
        yield surf.fadeOut(1);
      }
      yield* game.main(selection);
    }).catch((err: any) => {
      console.error('[main] game loop exited with error', err);
    });
  });
};

export default main;
