export const COMPONENTS = Object.freeze({
  BattleActor: 'battleActor',
  Time: 'time',
  Stats: 'stats',
  Status: 'status',
  Position: 'position',
  Sprite: 'sprite',
  Animation: 'animation',
  Command: 'command',
  QueueEntry: 'queueEntry',
  UIState: 'uiState'
});

export const TAGS = Object.freeze({
  Player: 'player',
  Enemy: 'enemy'
});

export interface BattleActorComponent {
  type: string;
  index: number;
  roleId: number | null;
  objectId: number | null;
}

export function createBattleActorComponent(options: Partial<BattleActorComponent> = {}): BattleActorComponent {
  return {
    type: options.type || 'unknown',
    index: typeof options.index === 'number' ? options.index : -1,
    roleId: typeof options.roleId === 'number' ? options.roleId : null,
    objectId: options.objectId != null ? options.objectId : null
  };
}

export interface TimeComponent {
  stateRef: any | null;
}

export function createTimeComponent(stateRef?: any): TimeComponent {
  return {
    stateRef: stateRef || null
  };
}

export interface StatsComponent {
  type: string;
  actorIndex: number | null;
  roleId: number | null;
  statsRef: any | null;
  extra: any | null;
}

export function createStatsComponent(options: Partial<StatsComponent> = {}): StatsComponent {
  return {
    type: options.type || 'unknown',
    actorIndex: typeof options.actorIndex === 'number' ? options.actorIndex : null,
    roleId: typeof options.roleId === 'number' ? options.roleId : null,
    statsRef: options.statsRef || null,
    extra: options.extra || null
  };
}

export interface StatusComponent {
  type: string;
  roleId: number | null;
  playerIndex: number | null;
  enemyIndex: number | null;
  statusRef: any | null;
}

export function createStatusComponent(options: Partial<StatusComponent> = {}): StatusComponent {
  return {
    type: options.type || 'unknown',
    roleId: typeof options.roleId === 'number' ? options.roleId : null,
    playerIndex: typeof options.playerIndex === 'number' ? options.playerIndex : null,
    enemyIndex: typeof options.enemyIndex === 'number' ? options.enemyIndex : null,
    statusRef: options.statusRef || null
  };
}

export interface CommandComponent {
  type: string;
  commandRef: any | null;
}

export function createCommandComponent(options: Partial<CommandComponent> = {}): CommandComponent {
  return {
    type: options.type || 'unknown',
    commandRef: options.commandRef || null
  };
}

export interface PositionComponent {
  type: string;
  actorIndex: number | null;
  stateRef: any | null;
  current: any | null;
  original: any | null;
}

export function createPositionComponent(options: Partial<PositionComponent> = {}): PositionComponent {
  return {
    type: options.type || 'unknown',
    actorIndex: typeof options.actorIndex === 'number' ? options.actorIndex : null,
    stateRef: options.stateRef || null,
    current: options.current != null ? options.current : null,
    original: options.original != null ? options.original : null
  };
}

export interface SpriteComponent {
  type: string;
  actorIndex: number | null;
  spriteRef: any | null;
  paletteRef: any | null;
  colorShiftRef: any | null;
}

export function createSpriteComponent(options: Partial<SpriteComponent> = {}): SpriteComponent {
  return {
    type: options.type || 'unknown',
    actorIndex: typeof options.actorIndex === 'number' ? options.actorIndex : null,
    spriteRef: options.spriteRef || null,
    paletteRef: options.paletteRef || null,
    colorShiftRef: options.colorShiftRef || null
  };
}

export interface AnimationComponent {
  type: string;
  actorIndex: number | null;
  stateRef: any | null;
  currentFrame: number | null;
  speedRef: any | null;
  frameCount: number | null;
  metadata: any | null;
}

export function createAnimationComponent(options: Partial<AnimationComponent> = {}): AnimationComponent {
  return {
    type: options.type || 'unknown',
    actorIndex: typeof options.actorIndex === 'number' ? options.actorIndex : null,
    stateRef: options.stateRef || null,
    currentFrame: options.currentFrame != null ? options.currentFrame : null,
    speedRef: options.speedRef || null,
    frameCount: options.frameCount != null ? options.frameCount : null,
    metadata: options.metadata || null
  };
}

export interface QueueEntryComponent {
  index: number;
  entryRef: any | null;
  actorEntity: any | null;
  isEnemy: boolean;
  actorType: string | null;
}

export function createQueueEntryComponent(options: Partial<QueueEntryComponent> = {}): QueueEntryComponent {
  return {
    index: typeof options.index === 'number' ? options.index : -1,
    entryRef: options.entryRef || null,
    actorEntity: options.actorEntity || null,
    isEnemy: Boolean(options.isEnemy),
    actorType: options.actorType || null
  };
}

export interface UIStateComponent {
  type: string;
  stateRef: any | null;
  state: any | null;
  menuState: any | null;
  currentPlayer: number | null;
  selectedAction: any | null;
  selectedIndex: number | null;
  autoBattle: boolean;
}

export function createUIStateComponent(options: Partial<UIStateComponent> = {}): UIStateComponent {
  return {
    type: options.type || 'unknown',
    stateRef: options.stateRef || null,
    state: options.state || null,
    menuState: options.menuState || null,
    currentPlayer: options.currentPlayer || null,
    selectedAction: options.selectedAction || null,
    selectedIndex: options.selectedIndex || null,
    autoBattle: !!options.autoBattle
  };
}
