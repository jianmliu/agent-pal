import config from './config';
import { getViewportValue as getViewportSnapshot, viewport$ } from '../../services/environment-adapter.js';

type OverviewMode = 'off' | 'gps' | 'panorama';

type Unsubscribe = () => void;

type ViewportSubscription = {
  unsubscribe?: Unsubscribe;
};

type ViewportObservable = {
  subscribe: (handler: (value: number) => void) => ViewportSubscription;
};

type OverviewBounds = {
  minX?: number;
  minY?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
};

type OverviewImageSize = {
  width: number;
  height: number;
};

type OverviewMetadata = {
  mapId?: number;
  bounds?: OverviewBounds | null;
  imageSize?: OverviewImageSize | null;
  [key: string]: unknown;
};

type OverviewCandidate = {
  imageUrl: string;
  metaUrl?: string;
  meta?: OverviewMetadata | null;
};

type LoadedOverviewAsset = {
  url: string;
  width: number;
  height: number;
  meta: OverviewMetadata | null;
};

type ManifestMapEntry = {
  image?: string;
  bounds?: OverviewBounds;
  imageSize?: OverviewImageSize;
  [key: string]: unknown;
};

type ManifestSceneEntry = {
  mapId?: number;
  [key: string]: unknown;
};

type OverviewManifest = {
  maps: Record<number, ManifestMapEntry>;
  scenes: Record<number, ManifestSceneEntry>;
};

type ConfigLike = {
  resolveAssetPath?: (path: string) => string | null | undefined;
  resolveModAssetPath?: (path: string) => string | null | undefined;
};

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const configAny = config as unknown as ConfigLike;
const DEFAULT_FOLDER = 'map-overview';
const EXPORTED_FOLDER = 'exported-assets/map-overview';
const LAYER_ID = 'pal-overview-layer';
const VEIL_ID = 'pal-overview-veil';
const INDICATOR_ID = 'pal-overview-indicator';
const MANIFEST_NAME = 'map-overview-manifest.json';
const OVERVIEW_WIDTH = 220;
const OVERVIEW_HEIGHT = 220;
const OVERVIEW_OFFSET = 12;
const raf: (fn: (time: number) => void) => number = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
  ? window.requestAnimationFrame.bind(window)
  : (fn) => {
    const handle = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
      ? window.setTimeout(() => fn(Date.now()), 16)
      : setTimeout(() => fn(Date.now()), 16);
    return handle as unknown as number;
  };
const PAL_X: (pos: number) => number = typeof window !== 'undefined' && typeof (window as any).PAL_X === 'function'
  ? (window as any).PAL_X
  : (pos: number) => pos & 0xFFFF;
const PAL_Y: (pos: number) => number = typeof window !== 'undefined' && typeof (window as any).PAL_Y === 'function'
  ? (window as any).PAL_Y
  : (pos: number) => (pos >> 16) & 0xFFFF;
const GLOBAL_SCOPE = (typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : ({} as typeof globalThis))
) as typeof globalThis & { fetch?: typeof fetch };
const GLOBAL_FETCH: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null =
  typeof GLOBAL_SCOPE.fetch === 'function' ? GLOBAL_SCOPE.fetch.bind(GLOBAL_SCOPE) : null;
const MAP_WIDTH = 64 * 32;
const MAP_HEIGHT = 128 * 16;
const VIEWPORT_WIDTH = 320;
const VIEWPORT_HEIGHT = 200;
const VALID_MODES: OverviewMode[] = ['off', 'gps', 'panorama'];

function normalizeMode(mode: unknown): OverviewMode {
  if (typeof mode !== 'string') {
    return 'off';
  }
  const lowered = mode.toLowerCase();
  return (VALID_MODES as string[]).includes(lowered) ? (lowered as OverviewMode) : 'off';
}

function createLayerElement(): HTMLDivElement | null {
  if (!HAS_DOM) return null;
  const wrap = document.getElementById('wrap') || document.body;
  if (!wrap) {
    return null;
  }
  const div = document.createElement('div');
  div.id = LAYER_ID;
  div.style.position = 'absolute';
  div.style.width = `${OVERVIEW_WIDTH}px`;
  div.style.height = `${OVERVIEW_HEIGHT}px`;
  div.style.right = `${OVERVIEW_OFFSET}px`;
  div.style.bottom = `${OVERVIEW_OFFSET}px`;
  div.style.backgroundSize = 'contain';
  div.style.backgroundRepeat = 'no-repeat';
  div.style.backgroundPosition = 'center';
  div.style.opacity = '0';
  div.style.transition = 'opacity 200ms ease-out';
  div.style.pointerEvents = 'none';
  div.style.zIndex = '5';
  div.style.display = 'none';
  wrap.appendChild(div);
  return div;
}

function createVeilElement(): HTMLDivElement | null {
  if (!HAS_DOM) return null;
  const wrap = document.getElementById('wrap') || document.body;
  if (!wrap) return null;
  const veil = document.createElement('div');
  veil.id = VEIL_ID;
  veil.style.display = 'none';
  veil.style.position = 'absolute';
  veil.style.left = '0';
  veil.style.top = '0';
  veil.style.right = '0';
  veil.style.bottom = '0';
  veil.style.pointerEvents = 'none';
  veil.style.background = 'rgba(0, 0, 0, 0.35)';
  veil.style.zIndex = '3';
  wrap.appendChild(veil);
  return veil;
}

function createIndicatorElement(): HTMLDivElement | null {
  if (!HAS_DOM) return null;
  const dot = document.createElement('div');
  dot.id = INDICATOR_ID;
  dot.style.display = 'none';
  dot.style.left = '0';
  dot.style.top = '0';
  return dot;
}

function dedupe<T>(list: T[], keyFn?: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  const result: T[] = [];
  list.forEach((item) => {
    if (!item) {
      return;
    }
    const key = keyFn ? keyFn(item) : (item as unknown as string | number);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  });
  return result;
}

function resolveAssetCandidates(relativePath: string, includeModFirst = true): string[] {
  const candidates: string[] = [];
  const resolvers: Array<(path: string) => string | null | undefined> = [];
  if (includeModFirst && typeof configAny.resolveModAssetPath === 'function') {
    resolvers.push(configAny.resolveModAssetPath);
  }
  if (typeof configAny.resolveAssetPath === 'function') {
    resolvers.push(configAny.resolveAssetPath);
  }
  resolvers.forEach((resolver) => {
    const resolved = resolver(relativePath);
    if (resolved) {
      candidates.push(resolved);
    }
  });
  return dedupe(candidates);
}

function buildCandidatesForRelative(relativePath: string, metaRelative?: string): OverviewCandidate[] {
  const imageCandidates = resolveAssetCandidates(relativePath);
  if (!imageCandidates.length) {
    return [];
  }
  const metaCandidates = typeof metaRelative === 'string' && metaRelative.length
    ? resolveAssetCandidates(metaRelative)
    : [];
  return imageCandidates.map((imageUrl) => {
    const base: OverviewCandidate = { imageUrl };
    if (metaCandidates.length) {
      base.metaUrl = metaCandidates[0];
    }
    return base;
  });
}

function buildLegacySceneCandidates(sceneId: number): OverviewCandidate[] {
  const names = [
    `${EXPORTED_FOLDER}/map-${sceneId}.png`,
    `${EXPORTED_FOLDER}/scene-${sceneId}.png`,
    `${EXPORTED_FOLDER}/${sceneId}.png`,
    `${DEFAULT_FOLDER}/map-${sceneId}.png`,
    `${DEFAULT_FOLDER}/scene-${sceneId}.png`,
    `${DEFAULT_FOLDER}/${sceneId}.png`
  ];
  const candidates: OverviewCandidate[] = [];
  names.forEach((relativePath) => {
    const metaRelative = relativePath.replace(/\.png$/i, '.json');
    const pairs = buildCandidatesForRelative(relativePath, metaRelative);
    candidates.push(...pairs);
  });
  return dedupe(candidates, (entry) => entry.imageUrl);
}

function resolveSceneFromManifest(manifest: OverviewManifest | null, sceneId: number) {
  if (!manifest || typeof manifest !== 'object') {
    return null;
  }
  const sceneKey = String(sceneId);
  const sceneEntry = (manifest.scenes && (manifest.scenes[sceneKey as any] || manifest.scenes[sceneId])) || null;
  const mapId = sceneEntry && Number.isFinite(sceneEntry.mapId as number)
    ? Number(sceneEntry.mapId)
    : Number(sceneId);
  const maps = manifest.maps || {};
  const mapEntry = maps[mapId] || maps[String(mapId) as any];
  if (!mapEntry || !mapEntry.image) {
    return null;
  }
  return {
    mapId,
    image: mapEntry.image,
    bounds: mapEntry.bounds || null,
    imageSize: mapEntry.imageSize || null
  };
}

function normalizeManifest(raw: unknown): OverviewManifest | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const normalized: OverviewManifest = {
    maps: {},
    scenes: {}
  };
  const rawObj = raw as { maps?: Record<string, ManifestMapEntry>; scenes?: Record<string, ManifestSceneEntry> };
  if (rawObj.maps && typeof rawObj.maps === 'object') {
    Object.keys(rawObj.maps).forEach((key) => {
      const numericKey = Number(key);
      normalized.maps[numericKey] = rawObj.maps![key];
    });
  }
  if (rawObj.scenes && typeof rawObj.scenes === 'object') {
    Object.keys(rawObj.scenes).forEach((key) => {
      const numericKey = Number(key);
      normalized.scenes[numericKey] = rawObj.scenes![key];
    });
  }
  return normalized;
}

function buildSceneCandidates(sceneId: number, manifest: OverviewManifest | null): OverviewCandidate[] {
  const candidates: OverviewCandidate[] = [];
  const manifestEntry = resolveSceneFromManifest(manifest, sceneId);
  if (manifestEntry) {
    const normalizedImageName = (manifestEntry.image && manifestEntry.image.startsWith('map-'))
      ? manifestEntry.image
      : `map-${manifestEntry.image}`;
    const relativeImages = [
      `${EXPORTED_FOLDER}/${normalizedImageName}`,
      `${DEFAULT_FOLDER}/${normalizedImageName}`
    ];
    relativeImages.forEach((relativeImage) => {
      const pairs = buildCandidatesForRelative(relativeImage);
      pairs.forEach((pair) => {
        candidates.push({
          imageUrl: pair.imageUrl,
          meta: {
            mapId: manifestEntry.mapId,
            bounds: manifestEntry.bounds,
            imageSize: manifestEntry.imageSize
          }
        });
      });
    });
  }
  if (!candidates.length) {
    candidates.push(...buildLegacySceneCandidates(sceneId));
  }
  return candidates;
}

function fetchOverviewMetadata(url: string | undefined) {
  if (!GLOBAL_FETCH || !url) {
    return Promise.resolve(null);
  }
  return GLOBAL_FETCH(url, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) {
        return null;
      }
      return response.json();
    })
    .catch(() => null);
}

function fetchJsonFromUrls(urls: string[]) {
  if (!GLOBAL_FETCH || !Array.isArray(urls) || !urls.length) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const tryFetch = (index: number) => {
      if (index >= urls.length) {
        resolve(null);
        return;
      }
      const url = urls[index];
      GLOBAL_FETCH(url, { cache: 'no-store' })
        .then((response) => {
          if (!response || !response.ok) {
            tryFetch(index + 1);
            return;
          }
          response.json()
            .then((data) => resolve(data))
            .catch(() => tryFetch(index + 1));
        })
        .catch(() => tryFetch(index + 1));
    };
    tryFetch(0);
  });
}

function loadFromCandidates(candidates: OverviewCandidate[]): Promise<LoadedOverviewAsset> {
  if (!HAS_DOM) {
    return Promise.reject(new Error('DOM unavailable'));
  }
  if (!candidates.length) {
    return Promise.reject(new Error('no overview assets configured'));
  }
  return new Promise((resolve, reject) => {
    const tryLoad = (index: number) => {
      if (index >= candidates.length) {
        reject(new Error('overview asset missing'));
        return;
      }
      const candidate = candidates[index];
      if (!candidate || !candidate.imageUrl) {
        tryLoad(index + 1);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        const metaPromise = candidate.meta
          ? Promise.resolve(candidate.meta)
          : fetchOverviewMetadata(candidate.metaUrl);
        metaPromise
          .then((meta) => {
            resolve({
              url: candidate.imageUrl,
              width,
              height,
              meta: (meta as OverviewMetadata) || null
            });
          })
          .catch(() => {
            resolve({
              url: candidate.imageUrl,
              width,
              height,
              meta: null
            });
          });
      };
      img.onerror = () => tryLoad(index + 1);
      img.src = candidate.imageUrl;
    };
    tryLoad(0);
  });
}

function loadImageForScene(sceneId: number, manifest: OverviewManifest | null): Promise<LoadedOverviewAsset> {
  const numericId = Number(sceneId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return Promise.reject(new Error('invalid scene id'));
  }
  const candidates = buildSceneCandidates(numericId, manifest);
  return loadFromCandidates(candidates);
}

class OverviewController {
  enabled: boolean;
  mode: OverviewMode;
  layer: HTMLDivElement | null;
  veil: HTMLDivElement | null;
  indicator: HTMLDivElement | null;
  sceneId: number | null;
  cache: Map<number, LoadedOverviewAsset | null>;
  viewportValue: number | null;
  activeImage: string | null;
  cachedImageSize: OverviewImageSize | null;
  currentBounds: OverviewBounds | null;
  renderedImageMetrics: { width: number; height: number; offsetX: number; offsetY: number } | null;
  suspended: boolean;
  manifest: OverviewManifest | null;
  manifestPromise: Promise<OverviewManifest | null> | null;
  manifestLoaded: boolean;
  viewportSubscription?: ViewportSubscription | null;

  constructor() {
    this.enabled = false;
    this.mode = 'off';
    this.layer = null;
    this.veil = null;
    this.indicator = null;
    this.sceneId = null;
    this.cache = new Map();
    this.viewportValue = null;
    this.activeImage = null;
    this.cachedImageSize = null;
    this.currentBounds = null;
    this.renderedImageMetrics = null;
    this.suspended = false;
    this.manifest = null;
    this.manifestPromise = null;
    this.manifestLoaded = false;
  }

  _initViewportSubscription() {
    const viewportStream = viewport$ as unknown as ViewportObservable | null;
    if (!viewportStream || typeof viewportStream.subscribe !== 'function') {
      return;
    }
    if (this.viewportSubscription && typeof this.viewportSubscription.unsubscribe === 'function') {
      this.viewportSubscription.unsubscribe();
    }
    this.viewportSubscription = viewportStream.subscribe((value) => {
      this.setViewport(value as number);
    });
  }

  _resolveViewportValue(value?: number | null) {
    if (Number.isFinite(value)) {
      return value as number;
    }
    if (Number.isFinite(this.viewportValue)) {
      return this.viewportValue as number;
    }
    if (typeof getViewportSnapshot === 'function') {
      try {
        const snapshot = getViewportSnapshot();
        if (Number.isFinite(snapshot)) {
          return snapshot;
        }
      } catch (err) {
        // ignore
      }
    }
    return 0;
  }

  setEnabled(flag: boolean) {
    this.enabled = !!flag;
    if (!HAS_DOM) return;
    if (!this.enabled || this.suspended) {
      this.hideLayer();
      return;
    }
    this.layer = this.layer || createLayerElement();
    this.veil = this.veil || createVeilElement();
    if (!this.indicator) {
      this.indicator = createIndicatorElement();
    }
    if (this.layer && this.indicator && this.indicator.parentElement !== this.layer) {
      this.layer.appendChild(this.indicator);
    }
    this._applyModeStyles();
    if (this.sceneId) {
      this.showForScene(this.sceneId);
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  setMode(mode: string) {
    this.mode = normalizeMode(mode);
    if (this.mode === 'gps') {
      this.setEnabled(true);
    } else {
      this.setEnabled(false);
      this.hideLayer();
    }
  }

  getMode() {
    return this.mode;
  }

  setSuspended(flag: boolean) {
    this.suspended = !!flag;
    if (this.suspended) {
      this.hideLayer();
      return;
    }
    if (this.enabled && this.sceneId) {
      this.showForScene(this.sceneId);
    }
  }

  _ensureManifest(): Promise<OverviewManifest | null> {
    if (this.manifestLoaded && !this.manifestPromise) {
      return Promise.resolve(this.manifest);
    }
    if (this.manifestPromise) {
      return this.manifestPromise;
    }
    const urls = dedupe([
      ...resolveAssetCandidates(`${EXPORTED_FOLDER}/${MANIFEST_NAME}`),
      ...resolveAssetCandidates(`${DEFAULT_FOLDER}/${MANIFEST_NAME}`)
    ]);
    if (!urls.length) {
      this.manifestLoaded = true;
      this.manifest = null;
      return Promise.resolve(null);
    }
    this.manifestPromise = fetchJsonFromUrls(urls)
      .then((data) => {
        this.manifest = normalizeManifest(data);
        this.manifestLoaded = true;
        this.manifestPromise = null;
        return this.manifest;
      })
      .catch(() => {
        this.manifest = null;
        this.manifestLoaded = true;
        this.manifestPromise = null;
        return null;
      });
    return this.manifestPromise;
  }

  hideLayer() {
    this.activeImage = null;
    if (this.layer) {
      this.layer.style.opacity = '0';
      this.layer.style.display = 'none';
    }
    if (this.veil) {
      this.veil.style.opacity = '0';
      this.veil.style.display = 'none';
    }
    if (this.indicator) {
      this.indicator.style.opacity = '0';
      this.indicator.style.display = 'none';
    }
    this.currentBounds = null;
  }

  showLayerWithImage(url: string | null) {
    if (this.suspended) {
      return;
    }
    if (!this.layer) {
      this.layer = createLayerElement();
    }
    if (!this.veil) {
      this.veil = createVeilElement();
    }
    if (!this.indicator) {
      this.indicator = createIndicatorElement();
    }
    if (this.layer && this.indicator && this.indicator.parentElement !== this.layer) {
      this.layer.appendChild(this.indicator);
    }
    if (!this.layer) {
      return;
    }
    this._applyModeStyles();
    this.activeImage = url;
    this.layer.style.backgroundImage = url ? `url('${url}')` : '';
    if (url) {
      const layer = this.layer;
      layer.style.display = 'block';
      this.updateRenderedImageMetrics();
      this.applyViewportTransform();
      raf(() => {
        if (layer) {
          layer.style.opacity = '1';
        }
      });
      if (this.veil) {
        if (this.mode === 'panorama') {
          this.veil.style.display = 'block';
          this.veil.style.opacity = '1';
        } else {
          this.veil.style.display = 'none';
          this.veil.style.opacity = '0';
        }
      }
      if (this.mode === 'gps') {
        this.updateIndicatorPosition();
      } else if (this.indicator) {
        this.indicator.style.display = 'none';
        this.indicator.style.opacity = '0';
      }
    } else {
      this.hideLayer();
    }
  }

  updateRenderedImageMetrics() {
    if (!this.layer) {
      this.renderedImageMetrics = null;
      return;
    }
    const natural = this.cachedImageSize;
    const containerWidth = this.layer.clientWidth || OVERVIEW_WIDTH;
    const containerHeight = this.layer.clientHeight || OVERVIEW_HEIGHT;
    if (!natural || !natural.width || !natural.height) {
      this.renderedImageMetrics = {
        width: containerWidth,
        height: containerHeight,
        offsetX: 0,
        offsetY: 0
      };
      return;
    }
    const scale = Math.min(
      containerWidth / natural.width,
      containerHeight / natural.height
    );
    const width = natural.width * scale;
    const height = natural.height * scale;
    const offsetX = (containerWidth - width) / 2;
    const offsetY = (containerHeight - height) / 2;
    this.renderedImageMetrics = { width, height, offsetX, offsetY };
  }

  setViewport(value?: number | null) {
    this.viewportValue = this._resolveViewportValue(value);
    if (this.suspended) {
      return;
    }
    this.applyViewportTransform();
    this.updateIndicatorPosition();
  }

  applyViewportTransform() {
    if (!this.layer) return;
    this.layer.style.backgroundPosition = 'center';
  }

  updateIndicatorPosition() {
    const indicator = this.indicator;
    if (this.mode !== 'gps' || !indicator) {
      if (indicator) {
        indicator.style.opacity = '0';
        indicator.style.display = 'none';
      }
      return;
    }
    if (!this.enabled || this.suspended || !this.layer || !this.activeImage) {
      indicator.style.opacity = '0';
      indicator.style.display = 'none';
      return;
    }
    const resolvedViewport = this._resolveViewportValue(this.viewportValue);
    this.viewportValue = resolvedViewport;
    const viewportX = PAL_X(resolvedViewport) || 0;
    const viewportY = PAL_Y(resolvedViewport) || 0;
    const maxX = Math.max(1, MAP_WIDTH - VIEWPORT_WIDTH);
    const maxY = Math.max(1, MAP_HEIGHT - VIEWPORT_HEIGHT);
    const bounds = this.currentBounds;
    const mapMinX = bounds && typeof bounds.minX === 'number' ? bounds.minX : 0;
    const mapMinY = bounds && typeof bounds.minY === 'number' ? bounds.minY : 0;
    const mapWidth = bounds && typeof bounds.width === 'number' && bounds.width > 0 ? bounds.width : MAP_WIDTH;
    const mapHeight = bounds && typeof bounds.height === 'number' && bounds.height > 0 ? bounds.height : MAP_HEIGHT;
    const effectiveRangeX = Math.max(1, mapWidth - VIEWPORT_WIDTH);
    const effectiveRangeY = Math.max(1, mapHeight - VIEWPORT_HEIGHT);
    const maxViewportX = mapWidth > VIEWPORT_WIDTH ? mapMinX + (mapWidth - VIEWPORT_WIDTH) : mapMinX;
    const maxViewportY = mapHeight > VIEWPORT_HEIGHT ? mapMinY + (mapHeight - VIEWPORT_HEIGHT) : mapMinY;
    const clampedViewportX = mapWidth > VIEWPORT_WIDTH
      ? Math.min(maxViewportX, Math.max(mapMinX, viewportX))
      : mapMinX;
    const clampedViewportY = mapHeight > VIEWPORT_HEIGHT
      ? Math.min(maxViewportY, Math.max(mapMinY, viewportY))
      : mapMinY;
    const ratioX = mapWidth > VIEWPORT_WIDTH
      ? (clampedViewportX - mapMinX) / effectiveRangeX
      : 0;
    const ratioY = mapHeight > VIEWPORT_HEIGHT
      ? (clampedViewportY - mapMinY) / effectiveRangeY
      : 0;
    const layerWidth = this.layer.clientWidth || OVERVIEW_WIDTH;
    const layerHeight = this.layer.clientHeight || OVERVIEW_HEIGHT;
    const metrics = this.renderedImageMetrics || {
      width: layerWidth,
      height: layerHeight,
      offsetX: 0,
      offsetY: 0
    };
    const widthRatio = mapWidth > 0 ? (VIEWPORT_WIDTH / mapWidth) * metrics.width : metrics.width;
    const heightRatio = mapHeight > 0 ? (VIEWPORT_HEIGHT / mapHeight) * metrics.height : metrics.height;
    const minIndicatorWidth = 14;
    const minIndicatorHeight = 10;
    const indicatorWidth = mapWidth <= VIEWPORT_WIDTH
      ? metrics.width
      : Math.min(metrics.width, Math.max(minIndicatorWidth, widthRatio));
    const indicatorHeight = mapHeight <= VIEWPORT_HEIGHT
      ? metrics.height
      : Math.min(metrics.height, Math.max(minIndicatorHeight, heightRatio));
    const posX = metrics.offsetX + ratioX * Math.max(0, metrics.width - indicatorWidth);
    const posY = metrics.offsetY + ratioY * Math.max(0, metrics.height - indicatorHeight);
    indicator.style.width = `${indicatorWidth}px`;
    indicator.style.height = `${indicatorHeight}px`;
    indicator.style.transform = `translate(${posX}px, ${posY}px)`;
    indicator.style.display = 'block';
    indicator.style.opacity = '1';
  }

  showForScene(sceneId: number | null) {
    if (!HAS_DOM || !this.enabled || this.suspended) {
      return;
    }
    this.layer = this.layer || createLayerElement();
    if (!this.layer) {
      return;
    }
    this.sceneId = sceneId;
    if (sceneId === null || typeof sceneId === 'undefined') {
      this.hideLayer();
      return;
    }
    if (this.cache.has(sceneId)) {
      const cached = this.cache.get(sceneId);
      if (cached && cached.url) {
        this.cachedImageSize = cached && cached.width && cached.height
          ? { width: cached.width, height: cached.height }
          : null;
        this.currentBounds = cached && cached.meta && cached.meta.bounds
          ? cached.meta.bounds
          : null;
        this.showLayerWithImage(cached.url);
      } else {
        this.currentBounds = null;
        this.cachedImageSize = null;
        this.hideLayer();
      }
      return;
    }
    const promise = this._ensureManifest()
      .catch(() => null)
      .then(() => loadImageForScene(sceneId, this.manifest))
      .then((asset) => {
        if (asset) {
          this.cache.set(sceneId, asset);
          const mapId = asset.meta && Number.isFinite(asset.meta.mapId)
            ? Number(asset.meta.mapId)
            : null;
          if (mapId && mapId !== sceneId && !this.cache.has(mapId)) {
            this.cache.set(mapId, asset);
          }
        } else {
          this.cache.set(sceneId, null);
        }
        this.cachedImageSize = asset ? { width: asset.width, height: asset.height } : null;
        this.currentBounds = asset && asset.meta && asset.meta.bounds ? asset.meta.bounds : null;
        if (asset && this.sceneId === sceneId && this.enabled) {
          this.showLayerWithImage(asset.url);
        } else if (!asset && this.sceneId === sceneId) {
          this.hideLayer();
        }
        return asset;
      })
      .catch((err) => {
        console.warn('[overview] missing asset for scene', sceneId, err && err.message ? err.message : err);
        this.cache.set(sceneId, null);
        if (this.sceneId === sceneId) {
          this.hideLayer();
        }
        return null;
      });
    this.cache.set(sceneId, null);
    return promise;
  }

  applyScene(sceneId: number | null) {
    this.sceneId = sceneId;
    if (!this.enabled) {
      return;
    }
    this.showForScene(sceneId);
  }

  _applyModeStyles() {
    if (!this.layer) {
      return;
    }
    const isPanorama = this.mode === 'panorama';
    this.layer.style.pointerEvents = 'none';
    this.layer.style.backgroundSize = 'contain';
    if (isPanorama) {
      this.layer.style.left = '0';
      this.layer.style.top = '0';
      this.layer.style.right = '0';
      this.layer.style.bottom = '0';
      this.layer.style.width = '100%';
      this.layer.style.height = '100%';
      this.layer.style.zIndex = '4';
    } else {
      this.layer.style.left = 'auto';
      this.layer.style.top = 'auto';
      this.layer.style.right = `${OVERVIEW_OFFSET}px`;
      this.layer.style.bottom = `${OVERVIEW_OFFSET}px`;
      this.layer.style.width = `${OVERVIEW_WIDTH}px`;
      this.layer.style.height = `${OVERVIEW_HEIGHT}px`;
      this.layer.style.zIndex = '5';
    }
    if (this.indicator) {
      this.indicator.style.display = this.mode === 'gps' ? 'block' : 'none';
      this.indicator.style.opacity = this.mode === 'gps' ? '1' : '0';
    }
    if (this.veil) {
      if (isPanorama) {
        this.veil.style.display = 'block';
        this.veil.style.opacity = '1';
      } else {
        this.veil.style.display = 'none';
        this.veil.style.opacity = '0';
      }
    }
  }
}

function applyPanoramaBindings(mode: OverviewMode) {
  if (typeof window === 'undefined') {
    return;
  }
  const win = window as any;
  if (win.PAL_PANORAMA && typeof win.PAL_PANORAMA.__applyMode === 'function') {
    win.PAL_PANORAMA.__applyMode(mode);
  }
  if (win.PAL_PANORAMA_UI && typeof win.PAL_PANORAMA_UI.setMode === 'function') {
    win.PAL_PANORAMA_UI.setMode(mode);
  }
}

const controller = new OverviewController();
controller._initViewportSubscription();

if (typeof window !== 'undefined') {
  (window as any).PAL_OVERVIEW = Object.assign({}, (window as any).PAL_OVERVIEW, {
    enable: () => controller.setEnabled(true),
    disable: () => controller.setEnabled(false),
    toggle: () => controller.toggle(),
    setEnabled: (flag: boolean) => controller.setEnabled(flag),
    setMode: (mode: string) => {
      controller.setMode(mode);
      applyPanoramaBindings(controller.getMode());
      return controller.getMode();
    },
    __syncFromPanorama: (mode: string) => {
      controller.setMode(mode);
      applyPanoramaBindings(controller.getMode());
      return controller.getMode();
    },
    suspend: (flag: boolean) => controller.setSuspended(flag)
  });
}

export default controller;
