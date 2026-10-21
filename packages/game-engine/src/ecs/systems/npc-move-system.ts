import { WorldService } from '../../services/world-service';

interface MoveRequest {
  eventIndex?: number;
  eventObjectId?: number;
  dx?: number;
  dy?: number;
  direction?: number;
  speed?: number;
  origin?: string;
  spriteFrames?: number;
  spriteFramesAuto?: number;
}

interface NpcMoveSystemContext {
  worldService?: WorldService;
  world?: WorldService;
  sceneEventObjects?: any[];
}

export default function npcMoveSystem(context: NpcMoveSystemContext = {}) {
  const world = context.worldService || context.world;
  if (!world) {
    return;
  }

  const requests = world.drainMoveRequests() as MoveRequest[];
  if (!requests || requests.length === 0) {
    return;
  }

  const collisionState = world.getCollisionState();
  const isBlocked = collisionState && typeof collisionState.isBlocked === 'function'
    ? collisionState.isBlocked
    : null;

  const sceneEventObjects = Array.isArray(context.sceneEventObjects)
    ? context.sceneEventObjects
    : world.getEventObjectsInCurrentScene() || [];

  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    const eventIndex = typeof request.eventIndex === 'number'
      ? request.eventIndex
      : (typeof request.eventObjectId === 'number' ? request.eventObjectId - 1 : null);
    if (eventIndex == null) {
      continue;
    }
    const entry = sceneEventObjects.find((candidate: any) => candidate && candidate.index === eventIndex);
    const stateRef = entry && entry.state
      ? entry.state
      : ((world as any).getEventObject ? (world as any).getEventObject(eventIndex) : null);
    if (!stateRef) {
      continue;
    }

    const dx = typeof request.dx === 'number' ? request.dx : 0;
    const dy = typeof request.dy === 'number' ? request.dy : 0;
    const nextX = stateRef.x + dx;
    const nextY = stateRef.y + dy;

    if (isBlocked && isBlocked({ x: nextX, y: nextY }, { selfEventIndex: eventIndex, checkEventObjects: true })) {
      continue;
    }

    stateRef.x = nextX;
    stateRef.y = nextY;
    if (typeof request.direction === 'number') {
      stateRef.direction = request.direction;
    }
    const spriteFrames = stateRef.spriteFrames || request.spriteFrames || 0;
    const spriteFramesAuto = stateRef.spriteFramesAuto || request.spriteFramesAuto || 0;
    if (spriteFrames > 0) {
      const cycle = spriteFrames === 3 ? 4 : spriteFrames;
      stateRef.currentFrameNum = (stateRef.currentFrameNum + 1) % cycle;
    } else if (spriteFramesAuto > 0) {
      stateRef.currentFrameNum = (stateRef.currentFrameNum + 1) % spriteFramesAuto;
    }

    world.setMoveIntent(eventIndex, {
      id: eventIndex,
      dx,
      dy,
      direction: stateRef.direction,
      speed: request.speed || 0,
      origin: request.origin || 'script'
    });
  }
}
