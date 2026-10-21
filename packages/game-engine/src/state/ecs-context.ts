import { EMPTY, Observable } from 'rxjs';
import {
  createWorld,
  defineComponent,
  getComponentValue,
  hasComponent,
  removeComponent,
  setComponent,
  Type,
  updateComponent
} from '@latticexyz/recs';

export type EcsEntity = string;

export type PlayerStateComponentValue = {
  x?: number | null;
  y?: number | null;
  direction?: number | null;
  followers?: number | null;
  updatedAt?: number | null;
};

export type DialogStateComponentValue = {
  active?: boolean;
  awaitingInput?: boolean;
  needsAdvance?: boolean;
  lastMsgId?: number | null;
  position?: number | null;
  updatedAt?: number | null;
};

export type NpcBehaviorComponentValue = {
  npcId?: string | null;
  speaker?: string | null;
  lastLine?: string | null;
  lastSpokenAt?: number | null;
  state?: string | null;
};

export type MudRecordComponentValue = {
  tableId?: string | null;
  tableName?: string | null;
  key?: string | null;
  valueJson?: string | null;
};

type ObservableLike<T> = {
  subscribe: (listener: (value: T) => void) => { unsubscribe: () => void };
};

export type EcsComponent<T = unknown> = {
  update$?: ObservableLike<{ entity: EcsEntity; value: T }>;
};

export type EcsComponents = {
  playerState: EcsComponent<PlayerStateComponentValue>;
  dialogState: EcsComponent<DialogStateComponentValue>;
  npcBehavior: EcsComponent<NpcBehaviorComponentValue>;
  mudRecord: EcsComponent<MudRecordComponentValue>;
  [key: string]: EcsComponent<any>;
};

export type EcsEntities = {
  player: EcsEntity;
  dialog: EcsEntity;
  [key: string]: EcsEntity;
};

const world = createWorld() as any;
const entityCache = new Map<string, EcsEntity>();

function ensureEntity(key: string) {
  if (!key) {
    throw new Error('[ecs-context] entity key is required');
  }
  if (!entityCache.has(key)) {
    world.registerEntity({ id: key });
    entityCache.set(key, key);
  }
  return entityCache.get(key)!;
}

const components = Object.freeze({
  playerState: defineComponent(
    world,
    {
      x: Type.OptionalNumber,
      y: Type.OptionalNumber,
      direction: Type.OptionalNumber,
      followers: Type.OptionalNumber,
      updatedAt: Type.OptionalNumber
    },
    { id: 'PlayerState' }
  ),
  dialogState: defineComponent(
    world,
    {
      active: Type.Boolean,
      awaitingInput: Type.Boolean,
      needsAdvance: Type.Boolean,
      lastMsgId: Type.OptionalNumber,
      position: Type.OptionalNumber,
      updatedAt: Type.OptionalNumber
    },
    { id: 'DialogState' }
  ),
  npcBehavior: defineComponent(
    world,
    {
      npcId: Type.OptionalString,
      speaker: Type.OptionalString,
      lastLine: Type.OptionalString,
      lastSpokenAt: Type.OptionalNumber,
      state: Type.OptionalString
    },
    { id: 'NpcBehavior' }
  ),
  mudRecord: defineComponent(
    world,
    {
      tableId: Type.OptionalString,
      tableName: Type.OptionalString,
      key: Type.OptionalString,
      valueJson: Type.OptionalString
    },
    { id: 'MudRecord' }
  )
}) as unknown as EcsComponents;

const entities = Object.freeze({
  player: ensureEntity('entity:player'),
  dialog: ensureEntity('entity:dialog')
}) as EcsEntities;

function mergeComponentValue<T>(component: EcsComponent<T>, entity: EcsEntity, patch: Partial<T>) {
  if (!component || !entity || !patch || typeof patch !== 'object') {
    return;
  }
  if (hasComponent(component as any, entity as any)) {
    updateComponent(component as any, entity as any, patch as any);
  } else {
    setComponent(component as any, entity as any, patch as any);
  }
}

function writePlayerState(patch: Partial<PlayerStateComponentValue> = {}) {
  const payload = Object.assign({ updatedAt: Date.now() }, patch);
  mergeComponentValue(components.playerState, entities.player, payload);
}

function writeDialogState(patch: Partial<DialogStateComponentValue> = {}) {
  const payload = Object.assign({ updatedAt: Date.now() }, patch);
  mergeComponentValue(components.dialogState, entities.dialog, payload);
}

function writeNpcBehavior(npcId: string | number, patch: Partial<NpcBehaviorComponentValue> = {}) {
  if (!npcId) {
    return;
  }
  const entity = ensureEntity(`npc:${npcId}`);
  const payload = Object.assign({ npcId, lastSpokenAt: Date.now() }, patch);
  mergeComponentValue(components.npcBehavior, entity, payload);
}

type MudRecordInput = {
  tableId: string;
  tableName?: string | null;
  keyTuple?: unknown[];
  record?: unknown;
};

function writeMudRecord({ tableId, tableName, keyTuple = [], record }: MudRecordInput) {
  if (!tableId) {
    return;
  }
  const key = Array.isArray(keyTuple) && keyTuple.length ? keyTuple.join(',') : '::';
  const entity = ensureEntity(`mud:${tableId}:${key}`);
  mergeComponentValue(components.mudRecord, entity, {
    tableId,
    tableName: tableName || '',
    key,
    valueJson: JSON.stringify(record ?? {})
  });
}

function removeMudRecord(tableId: string, keyTuple: unknown[] = []) {
  if (!tableId) {
    return;
  }
  const key = Array.isArray(keyTuple) && keyTuple.length ? keyTuple.join(',') : '::';
  const entity = ensureEntity(`mud:${tableId}:${key}`);
  if (hasComponent(components.mudRecord as any, entity as any)) {
    removeComponent(components.mudRecord as any, entity as any);
  }
}

function componentObservable<T>(component: EcsComponent<T>, entity: EcsEntity): Observable<T> {
  if (!component || !entity) {
    return EMPTY as Observable<T>;
  }
  return new Observable((subscriber) => {
    const initialValue = getComponentValue(component as any, entity as any);
    if (initialValue !== undefined) {
      subscriber.next(initialValue as T);
    }
    const update$ = (component as EcsComponent<T>).update$;
    if (!update$) {
      return undefined;
    }
    const subscription = update$.subscribe((update) => {
      if (update.entity !== entity) {
        return;
      }
      subscriber.next(update.value);
    });
    return () => subscription.unsubscribe();
  });
}

const ecsContext = {
  world,
  components,
  entities,
  ensureEntity,
  writePlayerState,
  writeDialogState,
  writeNpcBehavior,
  writeMudRecord,
  removeMudRecord,
  componentObservable
};

export default ecsContext;

export {
  world as ecsWorld,
  components as ecsComponents,
  entities as ecsEntities,
  ensureEntity as ensureEcsEntity,
  writePlayerState,
  writeDialogState,
  writeNpcBehavior,
  writeMudRecord,
  removeMudRecord,
  componentObservable
};
