import Map from '../../js/pal/map';
import { WorldService } from '../../services/world-service';
import type { MapMetaComponent, MapTileComponent } from '../components/world';

// Helper functions
const PAL_X = (pos: number) => pos & 0xFFFF;
const PAL_Y = (pos: number) => (pos >> 16) & 0xFFFF;

enum ObjectState {
  Hidden = 0,
  Normal = 1,
  Blocker = 2
}

interface Position {
  x: number;
  y: number;
}

function decodePosition(position: number | Position): Position | null {
  if (typeof position === 'number') {
    return {
      x: PAL_X(position),
      y: PAL_Y(position)
    };
  }
  if (position && typeof position.x === 'number' && typeof position.y === 'number') {
    return { x: position.x, y: position.y };
  }
  return null;
}

function computeTileIndices(x: number, y: number) {
  let tileX = Math.floor(x / 32);
  let tileY = Math.floor(y / 16);
  let tileH = 0;
  const xr = x % 32;
  const yr = y % 16;

  if ((xr + yr * 2) >= 16) {
    if ((xr + yr * 2) >= 48) {
      tileX++;
      tileY++;
    } else if ((32 - (xr + yr * 2)) > 16) {
      tileX++;
    } else if ((32 - (xr + yr * 2)) < 48) {
      tileH = 1;
    } else {
      tileY++;
    }
  }

  return { tileX, tileY, tileH };
}

function getMapInstance(mapId: number | null, cache: any, files: any) {
  if (mapId == null) {
    return null;
  }
  if (cache && cache[mapId]) {
    return cache[mapId];
  }
  const sources = files || (globalThis as any).Files || {};
  if (!sources.MAP || !sources.GOP) {
    return null;
  }
  const instance = Map.fromFile(mapId, sources.MAP, sources.GOP);
  if (instance && cache) {
    cache[mapId] = instance;
  }
  return instance;
}

interface CollisionSystemContext {
  worldService?: WorldService;
  world?: WorldService;
  mapMetaComponent?: MapMetaComponent;
  mapTileComponent?: MapTileComponent;
  mapCache?: any;
  Files?: any;
  sceneEventObjects?: any[];
}

export default function collisionSystem(context: CollisionSystemContext = {}) {
  const world = context.worldService || context.world;
  if (!world) {
    return;
  }

  const mapMeta = context.mapMetaComponent || world.getMapMetaComponent();
  const mapTile = context.mapTileComponent || world.getMapTileComponent();
  
  const mapId = (mapMeta && typeof mapMeta.mapId === 'number')
    ? mapMeta.mapId
    : (mapTile && typeof mapTile.mapId === 'number' ? mapTile.mapId : null);

  const mapInstance = getMapInstance(mapId, context.mapCache, context.Files);

  let eventStates: any[] = [];
  if (Array.isArray(context.sceneEventObjects) && context.sceneEventObjects.length > 0) {
    eventStates = context.sceneEventObjects.map((entry) => ({
      id: entry.index,
      stateRef: entry.state || null
    }));
  } else {
    const entries = world.getEventObjectsInCurrentScene() || [];
    eventStates = entries.map((entry: any) => ({
      id: entry ? entry.index : null,
      stateRef: entry ? entry.state || null : null
    }));
  }

  const collisionState = {
    mapId,
    isBlocked(position: number | Position, options: any = {}) {
      const coords = decodePosition(position);
      if (!coords) {
        return false;
      }
      const { tileX, tileY, tileH } = computeTileIndices(coords.x, coords.y);
      if (!mapInstance) {
        return false;
      }
      if (tileX < 0 || tileY < 0 || tileX >= 64 || tileY >= 128) {
        return true;
      }
      if (mapInstance.isTileBlocked(tileX, tileY, tileH)) {
        if (options.checkEventObjects === false) {
          return true;
        }
        const allowByEvent = eventStates.some((evt) => {
          const stateRef = evt.stateRef;
          if (!stateRef) {
            return false;
          }
          const blockerThreshold = ObjectState.Blocker;
          if (typeof stateRef.state === 'number' && stateRef.state >= blockerThreshold) {
            return false;
          }
          const dxEvt = Math.abs(stateRef.x - coords.x);
          const dyEvt = Math.abs(stateRef.y - coords.y);
          return dxEvt + dyEvt * 2 < 16;
        });
        if (!allowByEvent) {
          return true;
        }
      }
      if (options.checkEventObjects === false) {
        return false;
      }
      const ignoreId = typeof options.selfEventIndex === 'number'
        ? options.selfEventIndex
        : (typeof options.selfId === 'number' ? options.selfId : null);
      for (let i = 0; i < eventStates.length; i++) {
        const evt = eventStates[i];
        const stateRef = evt.stateRef;
        if (!stateRef) {
          continue;
        }
        if (ignoreId != null && evt.id === ignoreId) {
          continue;
        }
        const blockerThreshold = ObjectState.Blocker;
        if (typeof stateRef.state === 'number' && stateRef.state < blockerThreshold) {
          continue;
        }
        const dx = Math.abs(evt.stateRef.x - coords.x);
        const dy = Math.abs(evt.stateRef.y - coords.y);
        if (dx + dy * 2 < 16) {
          return true;
        }
      }
      return false;
    }
  };

  world.setCollisionState(collisionState);
}
