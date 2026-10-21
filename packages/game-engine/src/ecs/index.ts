import createEntityRegistry, { EntityRegistry } from './entity-registry.js';
import { defineComponent } from './component.js';
import { WorldWriter, hashString, toPlain } from './world-writer.js';
import { WaitStackComponent, waitStack } from './components/wait.js';
export type { ComponentDef } from './component.js';
export type { Change, ChangeOp, Snapshot } from './world-writer.js';
export type { WaitKind, WaitFrame, WaitStack, WaitPayloads, WaitResponse, WaitChoiceItem } from './components/wait.js';
import {
  COMPONENTS as BattleComponents,
  TAGS as BattleTags,
  createBattleActorComponent,
  createTimeComponent,
  createStatsComponent,
  createStatusComponent,
  createPositionComponent,
  createSpriteComponent,
  createAnimationComponent,
  createCommandComponent,
  createQueueEntryComponent,
  createUIStateComponent
} from './components/battle.js';
import {
  COMPONENTS as WorldComponents,
  createViewportComponent,
  createEventObjectComponent,
  createSceneComponent,
  createMapMetaComponent,
  createMapTileComponent,
  createNpcStateComponent,
  createScriptRegisterComponent,
  createMoveIntentComponent,
  createMoveRequestQueueComponent,
  createCollisionStateComponent
} from './components/world.js';

export const ECSComponents = {
  Battle: BattleComponents,
  World: WorldComponents
};

export const ECSTags = {
  Battle: BattleTags
};

export {
  defineComponent,
  WorldWriter,
  hashString,
  toPlain,
  WaitStackComponent,
  waitStack,
  createEntityRegistry,
  EntityRegistry,
  BattleComponents,
  BattleTags,
  createBattleActorComponent,
  createTimeComponent,
  createStatsComponent,
  createStatusComponent,
  createPositionComponent,
  createSpriteComponent,
  createAnimationComponent,
  createCommandComponent,
  createQueueEntryComponent,
  createUIStateComponent,
  WorldComponents,
  createViewportComponent,
  createEventObjectComponent,
  createSceneComponent,
  createMapMetaComponent,
  createMapTileComponent,
  createNpcStateComponent,
  createScriptRegisterComponent,
  createMoveIntentComponent,
  createMoveRequestQueueComponent,
  createCollisionStateComponent
};

export default {
  createEntityRegistry,
  EntityRegistry,
  BattleComponents,
  BattleTags,
  createBattleActorComponent,
  createTimeComponent,
  createStatsComponent,
  createStatusComponent,
  createPositionComponent,
  createSpriteComponent,
  createAnimationComponent,
  createCommandComponent,
  createQueueEntryComponent,
  createUIStateComponent,
  WorldComponents,
  createViewportComponent,
  createEventObjectComponent,
  createSceneComponent,
  createMapMetaComponent,
  createMapTileComponent,
  createNpcStateComponent,
  createScriptRegisterComponent,
  createMoveIntentComponent,
  createMoveRequestQueueComponent,
  createCollisionStateComponent
};
