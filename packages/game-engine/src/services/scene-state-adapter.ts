import { sceneEventSignals } from '../state/slices/scene-events.js';
import { createAdapterObservable } from './adapter-helpers.js';

type SceneStateSignals = {
  sceneId: { value: number };
};

const sceneSignals = sceneEventSignals() as SceneStateSignals;

export function getSceneIdValue(): number {
  const value = sceneSignals.sceneId.value;
  if (Number.isFinite(value)) {
    return value;
  }
  return 0;
}

export const sceneId$ = createAdapterObservable<number>({
  name: 'scene.state.id',
  signal: sceneSignals.sceneId,
  getValue: getSceneIdValue
});

export default {
  getSceneIdValue,
  sceneId$
};
