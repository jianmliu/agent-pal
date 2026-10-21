import Map from '../../js/pal/map';
import Sprite from '../../js/pal/sprite';
import { WorldService } from '../../services/world-service';
import type { ViewportComponent, MapMetaComponent, MapTileComponent } from '../components/world';

// Helper functions
const PAL_X = (pos: number) => pos & 0xFFFF;
const PAL_Y = (pos: number) => (pos >> 16) & 0xFFFF;
const RECT = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

let warnedMissingMap = false;
let loggedFirstPaint = false;
let loggedMapMeta = false;
let loggedTileSample = false;
let loggedGopScan = false;
let loggedMapSelection = false;
const loggedTileStats = new Set<number>();

interface RenderMapSystemContext {
  worldService?: WorldService;
  world?: WorldService;
  surface?: any;
  viewportComponent?: ViewportComponent;
  mapMetaComponent?: MapMetaComponent;
  mapTileComponent?: MapTileComponent;
  mapId?: number;
  mapCache?: any;
  Files?: any;
  viewportValue?: number;
}

export default function renderMapSystem(context: RenderMapSystemContext = {}) {
  const world = context.worldService || context.world;
  if (!world) {
    return;
  }
  const surface = context.surface;
  if (!surface || typeof surface.blitMap !== 'function') {
    return;
  }

  const viewportComponent = context.viewportComponent || world.getViewportComponent();
  if (!viewportComponent) {
    return;
  }

  const mapMeta = context.mapMetaComponent || world.getMapMetaComponent();
  const mapTile = context.mapTileComponent || world.getMapTileComponent();
  
  if (!mapMeta && !mapTile) {
    return;
  }

  const mapIdRaw = typeof context.mapId === 'number'
    ? context.mapId
    : (mapMeta && typeof mapMeta.mapId === 'number'
      ? mapMeta.mapId
      : (mapTile && typeof mapTile.mapId === 'number' ? mapTile.mapId : 0));
  
  // Scene map ids may be 1-based; prefer raw id, but also try (id - 1).
  const mapIdPreferred = mapIdRaw;
  const mapIdFallback = Math.max(0, mapIdRaw - 1);
  const mapId = mapIdPreferred;
  if (!Number.isFinite(mapId)) {
    if (!warnedMissingMap) {
      warnedMissingMap = true;
      console.warn('[render-map] missing mapId; scene may not be initialised');
    }
    return;
  }

  const cache = context.mapCache || null;
  const files = context.Files || (globalThis as any).Files || {};
  
  function loadMap(id: number) {
    if (cache) {
      if (cache[id]) {
        return cache[id];
      }
      if (cache[mapIdPreferred]) {
        return cache[mapIdPreferred];
      }
      if (cache[mapIdFallback]) {
        return cache[mapIdFallback];
      }
    }
    if (!files.MAP || !files.GOP) return null;
    const debugFallbackEnabled = typeof window !== 'undefined' && (window as any).PAL_DEBUG_MAP_FALLBACK === true;
    const debugCandidates = debugFallbackEnabled ? [10, 11, 12, 13, 14] : [];
    const candidates = [mapIdPreferred, mapIdFallback, id, id + 1, id - 1, ...debugCandidates]
      .filter((v, i, arr) => Number.isFinite(v) && v >= 0 && arr.indexOf(v) === i);
    let fallbackInstance = null;
    for (let i = 0; i < candidates.length; i++) {
      const idx = candidates[i];
      const tiles = typeof files.MAP.decompressChunk === 'function' ? files.MAP.decompressChunk(idx) : null;
      if (!tiles || !tiles.length) {
        continue;
      }
      const tileView = new Uint32Array(tiles.buffer, tiles.byteOffset, tiles.byteLength / 4);
      let maxFrameNeeded = 0;
      let minBottom = 1e9; let minTop = 1e9; let maxBottom = 0; let maxTop = 0;
      for (let t = 0; t < tileView.length; t++) {
        const d = tileView[t];
        const bottom = (d & 0xFF) | ((d >> 4) & 0x100);
        const top = ((d >>> 16) & 0xFF) | ((d >>> 20) & 0x100);
        if (bottom < minBottom) minBottom = bottom;
        if (bottom > maxBottom) maxBottom = bottom;
        if (top < minTop) minTop = top;
        if (top > maxTop) maxTop = top;
        if (bottom > maxFrameNeeded) maxFrameNeeded = bottom;
        if (top > maxFrameNeeded) maxFrameNeeded = top;
      }

      // 地砖图片只用这张地图自己的 GOP(同 SDLPAL PAL_LoadMap);超出帧数的编号不画(PAL_SpriteGetFrame 返回 NULL)。
      // 以前这里会在「自己的 GOP 帧数不够」时去别的地图的 GOP 里找一套够大的 —— 而「够不够」是用算错的上层编号判的
      // (把图片号的高 4 位当成了 +256 的标志),几乎每张地图都被判成不够。多数地图全游戏找不到更大的,退回自己的,没事;
      // 贴图少的 11 张(十里坡、桃花林、鬼阴坛、扬州屋顶、神木林、南诏王宫几间、南诏地底通道 292、黑苗王宫下层)
      // 会换成别的地图的贴图:地面变成错乱的碎块,碎块的缝里露出上一屏的残留(战斗后尤其明显)。
      function loadSpriteMatchingFrames(_target: number) {
        return { sprite: Map._loadSpriteWithFallback(files.GOP, idx), sourceIdx: idx };
      }

      const spriteResult = loadSpriteMatchingFrames(maxFrameNeeded);
      const sprite = spriteResult.sprite;
      const spriteIdxUsed = spriteResult.sourceIdx;
      const instance = Map.fromChunk(idx, tiles, sprite);
      if (instance && instance.tiles && instance.tiles.length && sprite && Number.isFinite(sprite.frameCount)) {
        // Inspect tile frame index ranges to catch out-of-bounds that would render blank.
        let oobBottom = 0; let oobTop = 0;
        let zeroBottom = 0; let nonZeroBottom = 0;
        let zeroTop = 0; let nonZeroTop = 0;
        const uniqueBottom = new Set();
        const uniqueTop = new Set();
        const total = instance.tiles.length;
        let minX = 999, minY = 999, maxX = -1, maxY = -1;
        for (let t = 0; t < total; t++) {
          const d = instance.tiles[t];
          const bottom = (d & 0xFF) | ((d >> 4) & 0x100);
          const top = ((d >>> 16) & 0xFF) | ((d >>> 20) & 0x100);
          const h = t % 2;
          const x = ((t / 2) | 0) % 64;
          const y = ((t / 2 / 64) | 0);
          if (bottom >= sprite.frameCount) oobBottom += 1;
          if (top >= sprite.frameCount) oobTop += 1;
          if (bottom === 0) {
            zeroBottom += 1;
          } else {
            nonZeroBottom += 1;
            if (uniqueBottom.size < 12) uniqueBottom.add(bottom);
          }
          if (top === 0) {
            zeroTop += 1;
          } else {
            nonZeroTop += 1;
            if (uniqueTop.size < 12) uniqueTop.add(top);
          }
          if (bottom || top) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        const hasVisibleTiles = (nonZeroBottom + nonZeroTop) > 0;
        if (!loggedTileStats.has(idx)) {
          loggedTileStats.add(idx);
          console.debug('[render-map] tile stats', {
            idx,
            tiles: total,
            spriteFrames: sprite.frameCount,
            spriteIdxUsed,
            minBottom,
            maxBottom,
            minTop,
            maxTop,
            oobBottom,
            oobTop,
            zeroBottom,
            nonZeroBottom,
            zeroTop,
            nonZeroTop,
            sampleBottom: Array.from(uniqueBottom),
            sampleTop: Array.from(uniqueTop),
            bbox: { minX, minY, maxX, maxY }
          });
          console.debug('[render-map] tile summary', {
            idx,
            nonZeroBottom,
            nonZeroTop,
            zeroBottom,
            zeroTop
          });
        }
        if (!hasVisibleTiles) {
          // Try next candidate; remember this as fallback.
          fallbackInstance = fallbackInstance || instance;
          continue;
        }
      }
      if (instance && cache) {
        cache[idx] = instance;
        cache[id] = instance;
      }
      if (!loggedMapSelection && typeof console !== 'undefined' && console.debug) {
        console.debug('[render-map] map selection', {
          requested: id,
          selected: idx,
          tiles: tiles.length,
          spriteFrames: sprite && sprite.frameCount,
          spriteIdxUsed
        });
        loggedMapSelection = true;
      }
      return instance;
    }
    return fallbackInstance;
  }

  let mapInstance = loadMap(mapId);
  if (!mapInstance) {
    if (!warnedMissingMap) {
      warnedMissingMap = true;
      console.warn('[render-map] failed to load map instance', { mapIdRaw, mapId });
    }
    return;
  }

  if (!loggedMapMeta && typeof console !== 'undefined' && console.debug) {
    console.debug('[render-map] map meta', {
      mapIdRaw,
      mapId,
      tiles: mapInstance.tiles ? mapInstance.tiles.length : null,
      spriteFrames: mapInstance.sprite ? mapInstance.sprite.frameCount : null
    });
    loggedMapMeta = true;
  }
  if (!loggedGopScan && files.GOP && typeof console !== 'undefined' && console.debug) {
    const scan = [];
    const limit = Math.min(20, typeof files.GOP.getChunkCount === 'function' ? files.GOP.getChunkCount() : 20);
    for (let i = 0; i < limit; i++) {
      try {
        const rawBuf = files.GOP.readChunk(i);
        let frameCount = null;
        if (rawBuf) {
          const sprite = new Sprite(rawBuf);
          frameCount = sprite && typeof sprite.frameCount === 'number' ? sprite.frameCount : null;
        }
        scan.push({ idx: i, frameCount });
      } catch (err) {
        scan.push({ idx: i, error: true });
      }
    }
    console.debug('[render-map] GOP scan', scan);
    loggedGopScan = true;
  }
  if (!loggedTileSample && mapInstance.tiles && mapInstance.tiles.length) {
    const sample = Array.prototype.slice.call(mapInstance.tiles, 0, 16);
    console.debug('[render-map] tile sample', { mapIdRaw, mapId, sample });
    loggedTileSample = true;
  }

  const viewportValue = typeof context.viewportValue === 'number'
    ? context.viewportValue
    : viewportComponent.value || 0;
  const rectInstance = RECT(PAL_X(viewportValue), PAL_Y(viewportValue), 320, 200);

  if (!loggedFirstPaint && typeof console !== 'undefined' && console.debug) {
    console.debug('[render-map] paint', { mapId, viewport: rectInstance });
    loggedFirstPaint = true;
  }

  surface.blitMap(mapInstance, rectInstance, 0);
  surface.blitMap(mapInstance, rectInstance, 1);
}
