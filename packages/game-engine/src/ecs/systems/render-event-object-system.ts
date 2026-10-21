import config from '../../js/pal/config';
import { WorldService } from '../../services/world-service';
import type { ViewportComponent } from '../components/world';

// Helper functions
const PAL_X = (pos: number) => pos & 0xFFFF;
const PAL_Y = (pos: number) => (pos >> 16) & 0xFFFF;
const SHORT = (value: number) => {
  const result = value & 0xFFFF;
  return (result & 0x8000) ? result - 0x10000 : result;
};

enum ObjectState {
  Hidden = 0,
  Normal = 1,
  Blocker = 2
}

interface RenderEventObjectSystemContext {
  worldService?: WorldService;
  world?: WorldService;
  surface?: any;
  addToDrawList?: (frame: any, x: number, y: number, layerOffset: number, extra: any) => any;
  calcCoverTiles?: (spriteEntry: any) => void;
  getEventObjectSprite?: (id: number) => any;
  viewportComponent?: ViewportComponent;
  viewportValue?: number;
  sceneEventObjects?: any[];
  includeOffscreen?: boolean;
}

export default function renderEventObjectSystem(context: RenderEventObjectSystemContext = {}) {
  const world = context.worldService || context.world;
  if (!world) {
    return;
  }
  const surface = context.surface;
  if (!surface) {
    return;
  }
  const addToDrawList = context.addToDrawList;
  if (!addToDrawList) {
    return;
  }
  const calcCoverTiles = context.calcCoverTiles;
  const getEventObjectSprite = context.getEventObjectSprite;
  if (!getEventObjectSprite) {
    return;
  }

  const viewportComponent = context.viewportComponent || world.getViewportComponent();
  if (!viewportComponent) {
    return;
  }
  const viewportValue = typeof context.viewportValue === 'number'
    ? context.viewportValue
    : viewportComponent.value || 0;
  const viewportX = PAL_X(viewportValue);
  const viewportY = PAL_Y(viewportValue);

  const shouldLabelEvents = !!(config && config.showEventObjectLabels);
  const debugStr = shouldLabelEvents && typeof surface.__debugStr === 'function'
    ? surface.__debugStr.bind(surface)
    : null;
  
  const sceneEventObjects = Array.isArray(context.sceneEventObjects)
    ? context.sceneEventObjects
    : null;
  const includeOffscreen = context.includeOffscreen === true;

  const processEntry = (entry: any) => {
    if (!entry || !entry.state) {
      return;
    }
    const eventObj = entry.state;
    if (!eventObj || eventObj.state == null) {
      return;
    }
    if (eventObj.state === ObjectState.Hidden || eventObj.vanishTime > 0 || eventObj.state < 0) {
      return;
    }
    const sprite = getEventObjectSprite(entry.id);
    if (!sprite) {
      return;
    }
    let frameNum = eventObj.currentFrameNum || 0;
    if (eventObj.spriteFrames === 3) {
      if (frameNum === 2) {
        frameNum = 0;
      } else if (frameNum === 3) {
        frameNum = 2;
      }
    }
    const direction = typeof eventObj.direction === 'number' ? eventObj.direction : 0;
    const spriteFrames = typeof eventObj.spriteFrames === 'number' ? eventObj.spriteFrames : 1;
    const frame = sprite.getFrame(direction * spriteFrames + frameNum);
    if (!frame) {
      return;
    }

    if (debugStr) {
      debugStr('[' + entry.id + ']', SHORT(eventObj.x) - viewportX, SHORT(eventObj.y) - viewportY, '#f00', 'middle', 'center', 24);
    }

    const screenX = SHORT(eventObj.x) - viewportX - ~~(frame.width / 2);
    if (!includeOffscreen && (screenX >= 320 || screenX < -frame.width)) {
      return;
    }
    const layerValue = eventObj.layer || 0;
    const screenY = SHORT(eventObj.y) - viewportY + layerValue * 8 + 9;
    const vy = screenY - frame.height - layerValue * 8 + 2;
    if (!includeOffscreen && (vy >= 200 || vy < -frame.height)) {
      return;
    }

    const layerOffset = layerValue * 8 + 2;
    const spriteEntry = addToDrawList(frame, screenX, screenY, layerOffset, {
      kind: 'npc',
      worldX: screenX + viewportX,
      worldY: screenY - frame.height - layerOffset + viewportY,
      frame
    });
    if (spriteEntry && calcCoverTiles) {
      calcCoverTiles(spriteEntry);
    }
  };

  if (sceneEventObjects && sceneEventObjects.length > 0) {
    for (let idx = 0; idx < sceneEventObjects.length; idx++) {
      processEntry(sceneEventObjects[idx]);
    }
    return;
  }

  const fallbackEntries = world.getEventObjectsInCurrentScene() || [];
  for (let idx = 0; idx < fallbackEntries.length; idx++) {
    processEntry(fallbackEntries[idx]);
  }
}
