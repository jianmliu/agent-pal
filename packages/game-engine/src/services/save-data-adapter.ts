import stateService from './state-service.js';
import worldService from './world-service';

type StructSnapshot = Record<string, unknown> | null;

function getStructFromState(key: string): StructSnapshot {
  const struct = stateService.getGlobal(key);
  if (struct && typeof struct === 'object') {
    return struct as Record<string, unknown>;
  }
  return null;
}

export function getPartyStructSnapshot(): StructSnapshot {
  return getStructFromState('party');
}

export function getTrailStructSnapshot(): StructSnapshot {
  return getStructFromState('trail');
}

export function getExpStructSnapshot(): StructSnapshot {
  const struct = stateService.getGlobal('exp');
  if (struct && typeof struct === 'object') {
    return struct as Record<string, unknown>;
  }
  // TODO(rxjs-cleanup): remove worldService exp fallback once save-data slice is authoritative.
  return typeof worldService.getExpState === 'function'
    ? (worldService.getExpState() as StructSnapshot)
    : null;
}

export function getPoisonStructSnapshot(): StructSnapshot {
  return getStructFromState('poisonStatus');
}

export function getInventoryStructSnapshot(): StructSnapshot {
  return getStructFromState('inventory');
}

export default {
  getPartyStructSnapshot,
  getTrailStructSnapshot,
  getExpStructSnapshot,
  getPoisonStructSnapshot,
  getInventoryStructSnapshot
};
