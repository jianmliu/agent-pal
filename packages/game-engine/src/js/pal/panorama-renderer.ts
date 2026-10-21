import config from './config';
import Palette, { type PaletteColor } from './palette';
import { getPaletteIdValue as getPaletteIdSnapshot, isNightPaletteEnabled } from '../../services/environment-adapter.js';

type PanoramaMode = 'off' | 'panorama';

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type RenderOverlay = {
  kind?: string;
  worldX?: number;
  worldY?: number;
  frame?: Uint8Array | null;
};

type RenderCacheEntry = {
  bitmap: ImageData;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  bounds: Bounds;
  scale: number;
  containerWidth: number;
  containerHeight: number;
};

type MapInstance = {
  mapNum?: number;
  getTileBitmap: (x: number, y: number, h: number, layer: number) => Uint8Array | null;
};

type SceneContext = {
  mapInstance?: MapInstance | null;
  mapId?: number | null;
  paletteId?: number;
  viewport?: number;
  viewportMode?: string;
  overlays?: RenderOverlay[];
  uiCanvas?: HTMLCanvasElement | null;
};

type SurfaceLike = {
  width?: number;
  height?: number;
  cvs?: HTMLCanvasElement | null;
  byteBuffer?: Uint8Array | null;
  palette?: PaletteColor[] | null;
  getPalette?: () => PaletteColor[] | null;
};

type PanoramaUiBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const configAny = config as unknown as { enablePanorama?: boolean };

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const WRAP: HTMLElement | null = HAS_DOM ? (document.getElementById('wrap') || document.body) : null;
const CANVAS_ID = 'pal-panorama-layer';
const VALID_MODES: PanoramaMode[] = ['off', 'panorama'];
const TILE_WIDTH = 32;
const TILE_HEIGHT = 16;
const HALF_TILE_HEIGHT = 8;
let runtimeScale = 0.5;
let paletteReady = false;
const DEFAULT_COLOR = { r: 0, g: 0, b: 0 };
const PLAYER_VIEWPORT_RATIO_X = 0.5;
const PLAYER_VIEWPORT_RATIO_Y = 0.56;
const PANORAMA_SCALE = typeof (globalThis as any).PANORAMA_SCALE === 'number'
  ? (globalThis as any).PANORAMA_SCALE
  : 1;

function normalizeMode(mode: unknown): PanoramaMode {
  if (typeof mode !== 'string') {
    return 'off';
  }
  const lowered = mode.toLowerCase();
  return (VALID_MODES as string[]).includes(lowered) ? (lowered as PanoramaMode) : 'off';
}

function computeTilePosition(x: number, y: number, h: number) {
  return {
    x: x * TILE_WIDTH + h * 16 - 16,
    y: y * TILE_HEIGHT + h * HALF_TILE_HEIGHT - 8
  };
}

function decodeAndBlit(
  frame: Uint8Array,
  dest: Uint8ClampedArray,
  destWidth: number,
  destHeight: number,
  offsetX: number,
  offsetY: number,
  palette: PaletteColor[],
  scale = 1
) {
  if (!frame || !dest || !palette) {
    return;
  }
  let buffer = frame;
  if (buffer[0] === 0x02 && buffer[1] === 0x00 && buffer[2] === 0x00 && buffer[3] === 0x00) {
    buffer = buffer.subarray(4);
  }
  if (buffer.length < 4) {
    return;
  }
  const width = buffer[0] | (buffer[1] << 8);
  const height = buffer[2] | (buffer[3] << 8);
  const total = width * height;
  if (!width || !height || !total) {
    return;
  }
  let i = 0;
  let idx = 4;
  while (i < total && idx < buffer.length) {
    const T = buffer[idx++];
    if ((T & 0x80) && T <= 0x80 + width) {
      i += T - 0x80;
    } else {
      for (let j = 0; j < T && (i + j) < total && (idx + j) < buffer.length; j++) {
        const paletteIndex = buffer[idx + j];
        if (!paletteIndex) {
          continue;
        }
        const localIndex = i + j;
        const localY = Math.floor(localIndex / width);
        const localX = localIndex % width;
        const baseX = offsetX + localX * scale;
        const baseY = offsetY + localY * scale;
        const startX = Math.floor(baseX);
        const endX = Math.ceil(baseX + scale);
        const startY = Math.floor(baseY);
        const endY = Math.ceil(baseY + scale);
        const color = palette[paletteIndex] || palette[0] || DEFAULT_COLOR;
        for (let targetY = startY; targetY < endY; targetY++) {
          if (targetY < 0 || targetY >= destHeight) {
            continue;
          }
          for (let targetX = startX; targetX < endX; targetX++) {
            if (targetX < 0 || targetX >= destWidth) {
              continue;
            }
            const pos = (targetY * destWidth + targetX) << 2;
            dest[pos] = color.r;
            dest[pos + 1] = color.g;
            dest[pos + 2] = color.b;
            dest[pos + 3] = 255;
          }
        }
      }
      idx += T;
      i += T;
    }
  }
}

function resolveFiles(): Record<string, unknown> | null {
  if (typeof globalThis !== 'undefined' && (globalThis as any).Files) {
    return (globalThis as any).Files as Record<string, unknown>;
  }
  if (typeof window !== 'undefined' && (window as any).Files) {
    return (window as any).Files as Record<string, unknown>;
  }
  return null;
}

function resolvePaletteColors(paletteId: number, night: boolean): PaletteColor[] | null {
  try {
    const palette = Palette.get(paletteId);
    if (!palette) {
      return null;
    }
    const paletteAny = palette as unknown as { day?: PaletteColor[]; night?: PaletteColor[] };
    if (night && Array.isArray(paletteAny.night)) {
      return paletteAny.night;
    }
    if (Array.isArray(paletteAny.day)) {
      return paletteAny.day;
    }
    return palette as unknown as PaletteColor[];
  } catch (err) {
    return null;
  }
}

class PanoramaRenderer {
  mode: PanoramaMode;
  enabled: boolean;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  currentSceneId: number | null;
  currentMapId: number | null;
  cache: Map<string, RenderCacheEntry>;
  boundsCache: Map<number, Bounds>;
  uiCanvas: HTMLCanvasElement | null;
  uiCtx: CanvasRenderingContext2D | null;
  uiWidth: number;
  uiHeight: number;
  uiDirty: boolean;
  uiHasContent: boolean;
  uiBounds: PanoramaUiBounds | null;
  uiBoundsDirty: boolean;
  lastDisplayWidth: number;
  lastDisplayHeight: number;
  lastSourceWidth: number;
  lastSourceHeight: number;
  lastFrameReady: boolean;
  lastPlayerScreen: { x: number; y: number } | null;
  viewportMode: string;
  uiPresentPending: boolean;
  captureLegacyUi: boolean;
  lastRenderSignature: string | null;
  uiTransparentWarned: boolean;
  uiTransparentWarnAt: number;

  constructor() {
    this.mode = configAny.enablePanorama ? 'panorama' : 'off';
    this.enabled = this.mode === 'panorama';
    this.canvas = null;
    this.ctx = null;
    this.currentSceneId = null;
    this.currentMapId = null;
    this.cache = new Map();
    this.boundsCache = new Map();
    this.uiCanvas = null;
    this.uiCtx = null;
    this.uiWidth = 0;
    this.uiHeight = 0;
    this.uiDirty = false;
    this.uiHasContent = false;
    this.uiBounds = null;
    this.uiBoundsDirty = true;
    this.lastDisplayWidth = 0;
    this.lastDisplayHeight = 0;
    this.lastSourceWidth = 0;
    this.lastSourceHeight = 0;
    this.lastFrameReady = false;
    this.lastPlayerScreen = null;
    this.viewportMode = 'auto';
    this.uiPresentPending = false;
    this.captureLegacyUi = false;
    this.lastRenderSignature = null;
    this.uiTransparentWarned = false;
    this.uiTransparentWarnAt = 0;
  }

  setMode(mode: string) {
    const wasEnabled = this.enabled;
    this.mode = normalizeMode(mode);
    this.enabled = this.mode === 'panorama';
    if (!this.enabled) {
      this.hide();
    }
    if (wasEnabled !== this.enabled) {
      this.clearUiOverlay();
    }
    this.lastRenderSignature = null;
    this.lastFrameReady = false;
  }

  getMode() {
    return this.mode;
  }

  isActive() {
    return this.enabled;
  }

  getUiCanvas() {
    return this.uiCanvas;
  }

  setLegacyUiCapture(enabled: boolean) {
    this.captureLegacyUi = enabled === true;
  }

  clearUiOverlay() {
    if (this.uiCtx && this.uiCanvas) {
      this.uiCtx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    }
    this.uiDirty = false;
    this.uiHasContent = false;
    this.uiBounds = null;
    this.uiBoundsDirty = true;
    this.uiPresentPending = false;
    this.uiTransparentWarned = false;
    this.uiTransparentWarnAt = 0;
  }

  shouldCaptureUi() {
    return this.enabled && this.captureLegacyUi === true;
  }

  hide() {
    if (this.canvas) {
      this.canvas.style.display = 'none';
    }
  }

  ensureUiCanvas(width = 320, height = 200) {
    if (!HAS_DOM) {
      return null;
    }
    if (!this.uiCanvas) {
      this.uiCanvas = document.createElement('canvas');
      this.uiCtx = this.uiCanvas.getContext('2d');
    }
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    if (this.uiCanvas.width !== targetWidth || this.uiCanvas.height !== targetHeight) {
      this.uiCanvas.width = targetWidth;
      this.uiCanvas.height = targetHeight;
    }
    this.uiWidth = this.uiCanvas.width;
    this.uiHeight = this.uiCanvas.height;
    return this.uiCanvas;
  }

  beginUiFrame(surface?: SurfaceLike | null) {
    if (!this.enabled || !HAS_DOM) {
      return;
    }
    const width = surface && surface.width ? surface.width : 320;
    const height = surface && surface.height ? surface.height : 200;
    const canvas = this.ensureUiCanvas(width, height);
    if (canvas && this.uiCtx) {
      const resized = (this.uiWidth !== canvas.width) || (this.uiHeight !== canvas.height);
      this.uiWidth = canvas.width;
      this.uiHeight = canvas.height;
      if (resized) {
        this.uiCtx.clearRect(0, 0, canvas.width, canvas.height);
        this.uiHasContent = false;
        this.uiBounds = null;
        this.uiBoundsDirty = true;
      }
    }
  }

  renderUiBuffer(rect: unknown, surface?: SurfaceLike | null) {
    // console.debug('[panorama] renderUiBuffer', rect);
    if (!this.enabled || !HAS_DOM || !surface || !this.shouldCaptureUi()) {
      return;
    }
    const byteBuffer = surface.byteBuffer;
    const frameWidth = surface.width || (surface.cvs && surface.cvs.width) || 0;
    const frameHeight = surface.height || (surface.cvs && surface.cvs.height) || 0;
    if (!byteBuffer || !byteBuffer.length || !frameWidth || !frameHeight) {
      return;
    }
    const canvas = this.ensureUiCanvas(frameWidth, frameHeight);
    if (!canvas || !this.uiCtx) {
      return;
    }
    let colors = (typeof surface.getPalette === 'function' ? surface.getPalette() : surface.palette) || null;
    if (!colors) {
      try {
        const paletteId = getPaletteIdSnapshot();
        colors = resolvePaletteColors(paletteId, isNightPaletteEnabled());
      } catch (err) {
        colors = null;
      }
    }
    if (!colors) {
      colors = [];
    }
    const startX = 0;
    const startY = 0;
    const drawWidth = frameWidth;
    const drawHeight = frameHeight;
    if (drawWidth <= 0 || drawHeight <= 0) {
      return;
    }
    const imageData = this.uiCtx.createImageData(drawWidth, drawHeight);
    const pixels = imageData.data;
    for (let row = 0; row < drawHeight; row++) {
      const sourceY = startY + row;
      const rowOffset = sourceY * frameWidth;
      for (let col = 0; col < drawWidth; col++) {
        const sourceX = startX + col;
        const bufferIndex = rowOffset + sourceX;
        if (bufferIndex >= byteBuffer.length) {
          continue;
        }
        const paletteIndex = byteBuffer[bufferIndex];
        const color = colors[paletteIndex] || colors[0] || DEFAULT_COLOR;
        const targetIndex = (row * drawWidth + col) << 2;
        pixels[targetIndex] = color.r;
        pixels[targetIndex + 1] = color.g;
        pixels[targetIndex + 2] = color.b;
        pixels[targetIndex + 3] = paletteIndex === 0 ? 0 : 255;
      }
    }
    this.uiCtx.putImageData(imageData, 0, 0);
    let hasPixel = false;
    if (pixels) {
      for (let idx = 3; idx < pixels.length; idx += 4) {
        if (pixels[idx] !== 0) {
          hasPixel = true;
          break;
        }
      }
      if (!hasPixel) {
        const debugTransparent = typeof globalThis !== 'undefined' &&
          (globalThis as any).PAL_DEBUG_UI_TRANSPARENT === true;
        if (debugTransparent) {
          const now = Date.now();
          if (!this.uiTransparentWarned || (now - this.uiTransparentWarnAt) > 2000) {
            console.warn('[panorama] ui buffer all transparent');
            this.uiTransparentWarned = true;
            this.uiTransparentWarnAt = now;
          }
        }
      } else {
        this.uiTransparentWarned = false;
        this.uiTransparentWarnAt = 0;
      }
    }
    this.uiDirty = true;
    this.uiHasContent = hasPixel;
    this.uiBoundsDirty = true;
    if (!this.lastFrameReady) {
      this.uiPresentPending = true;
    }
    this.presentUiOverlay();
  }

  ensureCanvas() {
    if (!HAS_DOM) {
      return null;
    }
    if (this.canvas) {
      return this.canvas;
    }
    const canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.right = '0';
    canvas.style.bottom = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.zIndex = '4';
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'none';
    if (WRAP) {
      WRAP.appendChild(canvas);
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    return this.canvas;
  }

  applyScene(sceneId: number | null, mapId?: number | null) {
    this.currentSceneId = sceneId;
    if (typeof mapId === 'number') {
      this.currentMapId = mapId;
    }
  }

  render(sceneContext: SceneContext = {}) {
    if (!this.enabled || !HAS_DOM) {
      this.hide();
      return false;
    }
    const canvas = this.ensureCanvas();
    if (!canvas || !this.ctx) {
      return false;
    }
    const mapInstance = sceneContext.mapInstance || null;
    if (mapInstance) {
      return !!this.renderFromMap(mapInstance, sceneContext);
    } else {
      this.hide();
      return false;
    }
  }

  renderFromMap(mapInstance: MapInstance, options: SceneContext = {}) {
    if (!this.enabled || !HAS_DOM || !mapInstance) {
      this.hide();
      return null;
    }
    const canvas = this.ensureCanvas();
    if (!canvas || !this.ctx) {
      return null;
    }
    const mapId = typeof mapInstance.mapNum === 'number'
      ? mapInstance.mapNum
      : (typeof options.mapId === 'number' ? options.mapId : null);
    if (!paletteReady) {
      const files = resolveFiles();
      if (files && (files as any).PAT && typeof Palette.init === 'function') {
        try {
          Palette.init((files as any).PAT);
          paletteReady = true;
        } catch (err) {
          const errAny = err as any;
          console.warn('[panorama] failed to init palette', errAny && errAny.message ? errAny.message : errAny);
        }
      }
    }

    const paletteId = Number.isFinite(options.paletteId as number)
      ? (options.paletteId as number)
      : getPaletteIdSnapshot();
    const night = isNightPaletteEnabled();
    let palette = resolvePaletteColors(paletteId, night);
    if (palette) {
      paletteReady = true;
    }
    if (!palette) {
      console.warn('[panorama] palette lookup returned null', { paletteId, night });
      this.hide();
      return null;
    }
    const containerWidth = (this.canvas && this.canvas.clientWidth) || (WRAP && WRAP.clientWidth) || (window && window.innerWidth) || 1280;
    const containerHeight = (this.canvas && this.canvas.clientHeight) || (WRAP && WRAP.clientHeight) || (window && window.innerHeight) || 800;
    const cacheKey = `${mapId != null ? mapId : 'scene'}:${paletteId}:${night ? 1 : 0}:${containerWidth}x${containerHeight}:${runtimeScale}`;
    let cached: RenderCacheEntry | null | undefined = this.cache.get(cacheKey);
    if (!cached) {
      cached = this.renderMapToBitmap(mapInstance, palette, {
        containerWidth,
        containerHeight
      });
      if (!cached) {
        this.hide();
        console.warn('[panorama] renderFromMap returned null');
        return null;
      }
      this.cache.set(cacheKey, cached);
    }
    const overlays = Array.isArray(options.overlays) ? options.overlays : null;
    if (typeof options.viewportMode === 'string') {
      this.viewportMode = options.viewportMode;
    }
    const leader = overlays && overlays.find((entry) => entry && entry.kind === 'player');
    const focusX = leader ? leader.worldX : null;
    const focusY = leader ? leader.worldY : null;
    const viewportKey = typeof options.viewport === 'number' ? options.viewport : null;
    const overlayKey = overlays
      ? overlays.map((entry) => {
          const wx = Number.isFinite(entry.worldX as number) ? Math.round(entry.worldX as number) : 0;
          const wy = Number.isFinite(entry.worldY as number) ? Math.round(entry.worldY as number) : 0;
          const kind = entry.kind || 'entity';
          return `${kind}:${wx},${wy}`;
        }).join('|')
      : '';
    const renderSignature = `${mapId != null ? mapId : 'scene'}:${paletteId}:${night ? 1 : 0}:${containerWidth}x${containerHeight}:${runtimeScale}:${focusX == null ? '' : Math.round(focusX)},${focusY == null ? '' : Math.round(focusY)}:${viewportKey || ''}:${overlayKey}:${this.uiDirty ? 'ui' : 'clean'}`;
    if (this.lastRenderSignature === renderSignature && !this.uiPresentPending && !this.uiDirty) {
      if (this.canvas) {
        this.canvas.style.display = 'block';
      }
      return cached;
    }
    this.drawFromCache(
      cached,
      focusX == null ? null : focusX,
      focusY == null ? null : focusY,
      overlays || [],
      palette,
      options.uiCanvas || this.uiCanvas || null
    );
    this.lastRenderSignature = renderSignature;
    return cached;
  }

  renderMapToBitmap(
    mapInstance: MapInstance,
    palette: PaletteColor[],
    options: { containerWidth?: number; containerHeight?: number } = {}
  ) {
    if (!mapInstance || !palette) {
      return null;
    }
    const bounds = this.measureBounds(mapInstance.mapNum || 0, mapInstance);
    const containerWidth = Number.isFinite(options.containerWidth as number)
      ? (options.containerWidth as number)
      : (WRAP && WRAP.clientWidth) || 1280;
    const containerHeight = Number.isFinite(options.containerHeight as number)
      ? (options.containerHeight as number)
      : (WRAP && WRAP.clientHeight) || 800;
    const fitScale = Math.min(
      containerWidth / Math.max(bounds.width, 1),
      containerHeight / Math.max(bounds.height, 1)
    );
    const scale = Math.min(Math.max(fitScale * runtimeScale, 0.75), 2);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width = width;
    bufferCanvas.height = height;
    const ctx = bufferCanvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    const imageData = ctx.createImageData(width, height);
    const dest = imageData.data;
    const layers = [0, 1];
    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx];
      for (let y = 0; y < 128; y++) {
        for (let h = 0; h < 2; h++) {
          for (let x = 0; x < 64; x++) {
            const frame = mapInstance.getTileBitmap(x, y, h, layer);
            if (!frame) {
              continue;
            }
            const pos = computeTilePosition(x, y, h);
            const targetX = (pos.x - bounds.minX) * scale;
            const targetY = (pos.y - bounds.minY) * scale;
            decodeAndBlit(frame, dest, width, height, targetX, targetY, palette, scale);
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    return {
      bitmap: imageData,
      canvas: bufferCanvas,
      width,
      height,
      bounds,
      scale,
      containerWidth,
      containerHeight
    };
  }

  drawFromCache(
    cached: RenderCacheEntry,
    focusX: number | null,
    focusY: number | null,
    overlays: RenderOverlay[],
    palette: PaletteColor[],
    uiCanvas: HTMLCanvasElement | null
  ) {
    if (!cached || !this.canvas || !this.ctx) {
      return;
    }
    const { bitmap, canvas: cachedCanvas, width, height, bounds, scale, containerWidth, containerHeight } = cached;
    const displayWidth = (this.canvas.clientWidth || containerWidth || width);
    const displayHeight = (this.canvas.clientHeight || containerHeight || height);
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }
    let offscreen = cachedCanvas;
    if (!offscreen && bitmap) {
      offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const offscreenCtx = offscreen.getContext('2d');
      if (offscreenCtx) {
        offscreenCtx.putImageData(bitmap, 0, 0);
        cached.canvas = offscreen;
      }
    }
    if (!offscreen) {
      return;
    }
    const zoom = Math.min(Math.max(runtimeScale, 0.75), 2);
    const invZoom = zoom > 1 ? 1 / zoom : zoom;
    const sourceWidth = Math.max(1, Math.round(displayWidth * invZoom));
    const sourceHeight = Math.max(1, Math.round(displayHeight * invZoom));
    const centerX = typeof focusX === 'number' ? focusX : (bounds.minX + bounds.width / 2);
    const centerY = typeof focusY === 'number' ? focusY : (bounds.minY + bounds.height / 2);
    let srcX = Math.round((centerX - bounds.minX) * scale - sourceWidth / 2);
    let srcY = Math.round((centerY - bounds.minY) * scale - sourceHeight / 2);
    srcX = Math.max(0, Math.min(width - sourceWidth, srcX));
    srcY = Math.max(0, Math.min(height - sourceHeight, srcY));
    this.ctx.clearRect(0, 0, displayWidth, displayHeight);
    this.ctx.drawImage(offscreen, srcX, srcY, sourceWidth, sourceHeight, 0, 0, displayWidth, displayHeight);
    if (width < displayWidth || height < displayHeight) {
      this.drawLetterbox(displayWidth, displayHeight, width, height);
    }
    if (overlays && overlays.length) {
      const overlayBounds: Bounds = {
        minX: bounds.minX + srcX / scale,
        minY: bounds.minY + srcY / scale,
        width: sourceWidth / scale,
        height: sourceHeight / scale,
        maxX: bounds.minX + srcX / scale + sourceWidth / scale,
        maxY: bounds.minY + srcY / scale + sourceHeight / scale
      };
      const overlayScale = (displayWidth / sourceWidth) * scale;
      this.drawOverlays(overlays, Object.assign({}, cached, { bounds: overlayBounds, scale: overlayScale }), palette);
    }
    this.lastSourceWidth = sourceWidth;
    this.lastSourceHeight = sourceHeight;

    this.lastPlayerScreen = null;
    const overlayCanvas = this.uiCanvas;
    if (overlayCanvas && this.uiHasContent) {
      this.drawUiCanvas(overlayCanvas, displayWidth, displayHeight);
      this.uiPresentPending = false;
    }
    this.uiDirty = false;
    this.canvas.style.display = 'block';
    this.lastDisplayWidth = displayWidth;
    this.lastDisplayHeight = displayHeight;
    this.lastFrameReady = true;
    if (this.uiPresentPending && this.uiCanvas) {
      this.presentUiOverlay();
    }
  }

  getUiContentBounds() {
    if (!this.uiCanvas || !this.uiCtx) {
      return null;
    }
    if (!this.uiBoundsDirty && this.uiBounds) {
      return this.uiBounds;
    }
    const width = this.uiCanvas.width || 0;
    const height = this.uiCanvas.height || 0;
    if (!width || !height) {
      this.uiBounds = null;
      this.uiBoundsDirty = false;
      return null;
    }
    const imageData = this.uiCtx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const alpha = pixels[((rowOffset + x) << 2) + 3];
        if (alpha) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) {
      this.uiBounds = null;
    } else {
      this.uiBounds = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      };
    }
    this.uiBoundsDirty = false;
    return this.uiBounds;
  }

  drawUiCanvas(uiCanvas: HTMLCanvasElement, displayWidth: number, displayHeight: number) {
    if (!uiCanvas || !this.ctx) {
      return;
    }
    const baseWidth = uiCanvas.width || 320;
    const baseHeight = uiCanvas.height || 200;
    const visibleSourceWidth = this.lastSourceWidth || baseWidth;
    const visibleSourceHeight = this.lastSourceHeight || baseHeight;
    const scaleX = Math.min(displayWidth / Math.max(visibleSourceWidth, 1), 1);
    const scaleY = Math.min(displayHeight / Math.max(visibleSourceHeight, 1), 1);
    const targetWidth = Math.max(1, baseWidth * scaleX);
    const targetHeight = Math.max(1, baseHeight * scaleY);
    const destX = Math.round((displayWidth - targetWidth) / 2);
    const destY = Math.round((displayHeight - targetHeight) / 2);
    this.ctx.save();
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(
      uiCanvas,
      0,
      0,
      baseWidth,
      baseHeight,
      destX,
      destY,
      targetWidth,
      targetHeight
    );
    this.ctx.restore();
  }

  drawLetterbox(displayWidth: number, displayHeight: number, contentWidth: number, contentHeight: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const horizontalPadding = Math.max(0, (displayWidth - contentWidth) / 2);
    const verticalPadding = Math.max(0, (displayHeight - contentHeight) / 2);
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    if (horizontalPadding > 0) {
      ctx.fillRect(0, 0, horizontalPadding, displayHeight);
      ctx.fillRect(displayWidth - horizontalPadding, 0, horizontalPadding, displayHeight);
    }
    if (verticalPadding > 0) {
      ctx.fillRect(0, 0, displayWidth, verticalPadding);
      ctx.fillRect(0, displayHeight - verticalPadding, displayWidth, verticalPadding);
    }
    ctx.restore();
  }

  seedUiFromSurface() {}

  presentUiOverlay() {
    if (!this.enabled || !this.uiCanvas || !this.canvas || !this.ctx) {
      this.uiPresentPending = this.uiHasContent;
      return;
    }
    if (!this.lastFrameReady) {
      this.uiPresentPending = this.uiHasContent;
      return;
    }
    const width = this.lastDisplayWidth || this.canvas.width || this.uiCanvas.width;
    const height = this.lastDisplayHeight || this.canvas.height || this.uiCanvas.height;
    this.drawUiCanvas(this.uiCanvas, width, height);
    this.uiPresentPending = false;
  }

  drawOverlays(overlays: RenderOverlay[], cached: RenderCacheEntry, palette: PaletteColor[]) {
    const ctx = this.ctx;
    if (!overlays || !overlays.length || !cached || !palette || !ctx) {
      return;
    }
    const bounds = cached.bounds;
    const scale = cached.scale || PANORAMA_SCALE;
    overlays.forEach((overlay) => {
      if (!overlay || !overlay.frame) {
        return;
      }
      const frame = overlay.frame as unknown as { width?: number; height?: number };
      const frameWidth = Number.isFinite(frame.width as number) ? (frame.width as number) : 0;
      const frameHeight = Number.isFinite(frame.height as number) ? (frame.height as number) : 0;
      if (!frameWidth || !frameHeight) {
        return;
      }
      const spriteWidth = Math.max(1, Math.round(frameWidth * scale));
      const spriteHeight = Math.max(1, Math.round(frameHeight * scale));
      const imageData = ctx.createImageData(spriteWidth, spriteHeight);
      decodeAndBlit(overlay.frame as Uint8Array, imageData.data, spriteWidth, spriteHeight, 0, 0, palette, scale);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = spriteWidth;
      tempCanvas.height = spriteHeight;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        return;
      }
      tempCtx.putImageData(imageData, 0, 0);
      const worldX = Number.isFinite(overlay.worldX as number) ? (overlay.worldX as number) : bounds.minX;
      const worldY = Number.isFinite(overlay.worldY as number) ? (overlay.worldY as number) : bounds.minY;
      const destX = Math.round((worldX - bounds.minX) * scale);
      const destY = Math.round((worldY - bounds.minY) * scale);
      ctx.drawImage(tempCanvas, destX, destY);
      if (overlay.kind === 'player') {
        this.lastPlayerScreen = {
          x: destX + spriteWidth / 2,
          y: destY + spriteHeight
        };
      }
    });
  }

  measureBounds(mapId: number, mapInstance: MapInstance): Bounds {
    if (this.boundsCache.has(mapId)) {
      return this.boundsCache.get(mapId) as Bounds;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const layers = [0, 1];
    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx];
      for (let y = 0; y < 128; y++) {
        for (let h = 0; h < 2; h++) {
          for (let x = 0; x < 64; x++) {
            const frame = mapInstance.getTileBitmap(x, y, h, layer);
            if (!frame) {
              continue;
            }
            let buffer = frame;
            if (buffer[0] === 0x02 && buffer[1] === 0x00 && buffer[2] === 0x00 && buffer[3] === 0x00) {
              buffer = buffer.subarray(4);
            }
            const width = buffer[0] | (buffer[1] << 8);
            const height = buffer[2] | (buffer[3] << 8);
            const pos = computeTilePosition(x, y, h);
            const left = pos.x;
            const top = pos.y - height;
            const right = pos.x + width;
            const bottom = pos.y;
            if (left < minX) minX = left;
            if (top < minY) minY = top;
            if (right > maxX) maxX = right;
            if (bottom > maxY) maxY = bottom;
          }
        }
      }
    }
    const resolvedMinX = Math.floor(minX);
    const resolvedMinY = Math.floor(minY);
    const resolvedMaxX = Math.ceil(maxX);
    const resolvedMaxY = Math.ceil(maxY);
    const bounds: Bounds = {
      minX: resolvedMinX,
      minY: resolvedMinY,
      maxX: resolvedMaxX,
      maxY: resolvedMaxY,
      width: Math.max(1, resolvedMaxX - resolvedMinX),
      height: Math.max(1, resolvedMaxY - resolvedMinY)
    };
    this.boundsCache.set(mapId, bounds);
    return bounds;
  }
}

const panoramaRenderer = new PanoramaRenderer();

function applyRendererMode(mode: string) {
  panoramaRenderer.setMode(mode);
  return panoramaRenderer.getMode();
}

if (typeof window !== 'undefined') {
  const win = window as any;
  win.PAL_PANORAMA = {
    setMode: (mode: string) => {
      if (win.PAL_OVERVIEW && typeof win.PAL_OVERVIEW.__syncFromPanorama === 'function') {
        return win.PAL_OVERVIEW.__syncFromPanorama(mode);
      }
      return applyRendererMode(mode);
    },
    __applyMode: (mode: string) => applyRendererMode(mode),
    render: (context: SceneContext) => panoramaRenderer.render(context),
    getMode: () => panoramaRenderer.getMode(),
    setScale: (value: number | string) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        runtimeScale = numeric;
        panoramaRenderer.cache.clear();
        panoramaRenderer.render({});
      }
      return runtimeScale;
    },
    getScale: () => runtimeScale
  };
}

export default panoramaRenderer;
