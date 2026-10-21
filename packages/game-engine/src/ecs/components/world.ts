export const COMPONENTS = Object.freeze({
  Viewport: 'worldViewport',
  EventObject: 'worldEventObject',
  Scene: 'worldScene',
  MapMeta: 'worldMapMeta',
  MapTile: 'worldMapTile',
  NpcState: 'worldNpcState',
  ScriptRegister: 'worldScriptRegister',
  MoveIntent: 'worldMoveIntent',
  MoveRequestQueue: 'worldMoveRequestQueue',
  CollisionState: 'worldCollisionState'
});

export interface ViewportComponent {
  value: number;
  partyOffset: number;
}

export function createViewportComponent(options: Partial<ViewportComponent> = {}): ViewportComponent {
  return {
    value: options.value != null ? options.value : 0,
    partyOffset: options.partyOffset != null ? options.partyOffset : 0
  };
}

export interface EventObjectComponent {
  id: number;
  stateRef: any | null;
  sceneId: number | null;
  aiState: any | null;
}

export function createEventObjectComponent(options: Partial<EventObjectComponent> = {}): EventObjectComponent {
  return {
    id: typeof options.id === 'number' ? options.id : -1,
    stateRef: options.stateRef || null,
    sceneId: typeof options.sceneId === 'number' ? options.sceneId : null,
    aiState: options.aiState || null
  };
}

export interface SceneComponent {
  sceneId: number | null;
  sceneRef: any | null;
  nextSceneRef: any | null;
  mapId: number | null;
  mapRef: any | null;
}

export function createSceneComponent(options: Partial<SceneComponent> = {}): SceneComponent {
  return {
    sceneId: typeof options.sceneId === 'number' ? options.sceneId : null,
    sceneRef: options.sceneRef || null,
    nextSceneRef: options.nextSceneRef || null,
    mapId: typeof options.mapId === 'number' ? options.mapId : null,
    mapRef: options.mapRef || null
  };
}

export interface MapMetaComponent {
  sceneId: number | null;
  mapId: number | null;
  sceneRef: any | null;
  mapRef: any | null;
  scriptOnEnter: number | null;
  scriptOnTeleport: number | null;
}

export function createMapMetaComponent(options: Partial<MapMetaComponent> = {}): MapMetaComponent {
  return {
    sceneId: typeof options.sceneId === 'number' ? options.sceneId : null,
    mapId: typeof options.mapId === 'number' ? options.mapId : null,
    sceneRef: options.sceneRef || null,
    mapRef: options.mapRef || null,
    scriptOnEnter: typeof options.scriptOnEnter === 'number' ? options.scriptOnEnter : null,
    scriptOnTeleport: typeof options.scriptOnTeleport === 'number' ? options.scriptOnTeleport : null
  };
}

export interface MapTileComponent {
  mapId: number | null;
  sceneId: number | null;
  width: number;
  height: number;
  layers: any | null;
  tileData: any | null;
}

export function createMapTileComponent(options: Partial<MapTileComponent> = {}): MapTileComponent {
  return {
    mapId: typeof options.mapId === 'number' ? options.mapId : null,
    sceneId: typeof options.sceneId === 'number' ? options.sceneId : null,
    width: typeof options.width === 'number' ? options.width : 0,
    height: typeof options.height === 'number' ? options.height : 0,
    layers: options.layers || null,
    tileData: options.tileData || null
  };
}

export interface NpcStateComponent {
  id: number;
  sceneId: number | null;
  stateRef: any | null;
  position: any | null;
  direction: number | null;
  currentFrame: number | null;
  state: number | null;
  vanishTime: number | null;
}

export function createNpcStateComponent(options: Partial<NpcStateComponent> = {}): NpcStateComponent {
  return {
    id: typeof options.id === 'number' ? options.id : -1,
    sceneId: typeof options.sceneId === 'number' ? options.sceneId : null,
    stateRef: options.stateRef || null,
    position: options.position || null,
    direction: typeof options.direction === 'number' ? options.direction : null,
    currentFrame: typeof options.currentFrame === 'number' ? options.currentFrame : null,
    state: typeof options.state === 'number' ? options.state : null,
    vanishTime: typeof options.vanishTime === 'number' ? options.vanishTime : null
  };
}

export interface ScriptRegisterComponent {
  count: number;
  entries: any | null;
  lastSynced: number;
}

export function createScriptRegisterComponent(options: Partial<ScriptRegisterComponent> = {}): ScriptRegisterComponent {
  return {
    count: typeof options.count === 'number' ? options.count : 0,
    entries: options.entries || null,
    lastSynced: options.lastSynced || Date.now()
  };
}

export interface MoveIntentComponent {
  id: number;
  direction: number | null;
  speed: number | null;
  targetX: number | null;
  targetY: number | null;
  timestamp: number;
}

export function createMoveIntentComponent(options: Partial<MoveIntentComponent> = {}): MoveIntentComponent {
  return {
    id: typeof options.id === 'number' ? options.id : -1,
    direction: typeof options.direction === 'number' ? options.direction : null,
    speed: typeof options.speed === 'number' ? options.speed : null,
    targetX: typeof options.targetX === 'number' ? options.targetX : null,
    targetY: typeof options.targetY === 'number' ? options.targetY : null,
    timestamp: options.timestamp || Date.now()
  };
}

export interface MoveRequestQueueComponent {
  id: number;
  queue: any[];
  requests: any[];
  processing: boolean;
}

export function createMoveRequestQueueComponent(options: Partial<MoveRequestQueueComponent> = {}): MoveRequestQueueComponent {
  const queue = Array.isArray(options.queue)
    ? options.queue
    : (Array.isArray(options.requests) ? options.requests : []);
  return {
    id: typeof options.id === 'number' ? options.id : -1,
    queue,
    requests: queue,
    processing: Boolean(options.processing)
  };
}

export interface CollisionStateComponent {
  id: number;
  blocked: boolean;
  blockerId: number | null;
  lastCheck: number;
}

export function createCollisionStateComponent(options: Partial<CollisionStateComponent> = {}): CollisionStateComponent {
  return {
    id: typeof options.id === 'number' ? options.id : -1,
    blocked: Boolean(options.blocked),
    blockerId: typeof options.blockerId === 'number' ? options.blockerId : null,
    lastCheck: options.lastCheck || Date.now()
  };
}
