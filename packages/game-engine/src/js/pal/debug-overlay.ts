import sceneEventAdapter from '../../services/scene-event-adapter.js';

type AnyRecord = Record<string, any>;

declare global {
  interface Window {
    debugUtils?: AnyRecord;
    services?: AnyRecord;
    BATTLE?: () => AnyRecord;
  }
}

const OVERLAY_ID = 'pal-debug-overlay';

function createOverlayElement(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = OVERLAY_ID;
  container.style.position = 'fixed';
  container.style.top = '8px';
  container.style.right = '8px';
  container.style.zIndex = '2147483647';
  container.style.fontFamily = 'monospace';
  container.style.fontSize = '11px';
  container.style.color = '#0f0';
  container.style.background = 'rgba(0, 0, 0, 0.6)';
  container.style.padding = '6px 8px';
  container.style.border = '1px solid rgba(0, 255, 0, 0.4)';
  container.style.borderRadius = '4px';
  container.style.minWidth = '200px';
  container.style.maxWidth = '320px';
  container.style.maxHeight = '240px';
  container.style.overflowY = 'auto';
  container.style.overflowX = 'hidden';
  container.style.pointerEvents = 'auto';
  container.style.userSelect = 'text';
  container.style.whiteSpace = 'pre';
  container.style.wordBreak = 'break-word';
  container.style.lineHeight = '1.3';
  return container;
}

let overlayElement: HTMLElement | null = null;
let frameHandle: number | null = null;
let lastUpdate = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
let frameCount = 0;

function ensureOverlay(): HTMLElement | null {
  if (overlayElement && document.body && document.body.contains(overlayElement)) {
    return overlayElement;
  }
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    overlayElement = existing;
    return overlayElement;
  }
  if (!document.body) {
    return null;
  }
  overlayElement = createOverlayElement();
  document.body.appendChild(overlayElement);
  return overlayElement;
}

function updateOverlay(content?: string) {
  const el = ensureOverlay();
  if (!el) {
    return;
  }
  const nextContent = content || '';
  if (el.textContent === nextContent) {
    return;
  }
  const previousScrollTop = el.scrollTop;
  const isAtBottom = Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 4;
  el.textContent = nextContent;
  if (isAtBottom) {
    el.scrollTop = el.scrollHeight;
  } else {
    el.scrollTop = previousScrollTop;
  }
}

function computeFPS(): number | null {
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  frameCount += 1;
  const elapsed = now - lastUpdate;
  if (elapsed >= 500) {
    const fps = (frameCount / elapsed) * 1000;
    frameCount = 0;
    lastUpdate = now;
    return fps;
  }
  return null;
}

function scheduleLoop(renderFn: (context: { fps: number | null }) => string | null | undefined) {
  const callback = () => {
    const fps = computeFPS();
    const payload = renderFn({ fps });
    if (payload && typeof payload === 'string') {
      updateOverlay(payload);
    }
    frameHandle = requestAnimationFrame(callback);
  };
  frameHandle = requestAnimationFrame(callback);
}

function cancelLoop() {
  if (typeof cancelAnimationFrame === 'function' && frameHandle) {
    cancelAnimationFrame(frameHandle);
  }
  frameHandle = null;
}

function formatLine(label: string, value: unknown) {
  return `${label}: ${value}`;
}

function formatDelta(delta: number | null | undefined) {
  if (delta == null || Number.isNaN(delta)) {
    return '-';
  }
  if (delta >= 60000) {
    return `${Math.round(delta / 1000)}s`;
  }
  if (delta >= 1000) {
    return `${(delta / 1000).toFixed(1)}s`;
  }
  return `${Math.round(delta)}ms`;
}

function formatValueSummary(value: unknown) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return `len=${value.length}`;
    }
    const record = value as AnyRecord;
    if (typeof record.type !== 'undefined') {
      return `type=${record.type}`;
    }
    if (typeof record.actionType !== 'undefined') {
      return `action=${record.actionType}`;
    }
    if (typeof record.state !== 'undefined' && typeof record.menuState !== 'undefined') {
      return `state=${record.state}`;
    }
    if (typeof record.id !== 'undefined') {
      return `id=${record.id}`;
    }
    return '';
  }
  if (typeof value === 'string') {
    return value.length > 12 ? `${value.slice(0, 12)}…` : value;
  }
  if (typeof value === 'number') {
    return `value=${value}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return '';
}

function gatherSceneStats() {
  const viewport = window.debugUtils ? window.debugUtils.getViewportSnapshot?.() : null;
  const adapters = window.services && window.services.adapters;
  const sceneId = adapters && adapters.sceneData ? adapters.sceneData.getSceneIdValue?.() : null;
  const eventCount = adapters && adapters.sceneEvents ? adapters.sceneEvents.getEventObjects?.()?.length : null;
  let eventVersion = null;
  try {
    eventVersion = sceneEventAdapter.getEventObjectsVersion();
  } catch (err) {
    eventVersion = null;
  }
  return { viewport, sceneId, eventCount, eventVersion };
}

function gatherBattleStats() {
  const adapters = window.services && window.services.adapters;
  const battleAdapter = adapters && adapters.battleState;
  let battleState = null;
  if (battleAdapter && typeof battleAdapter.getBattleStateSnapshot === 'function') {
    try {
      battleState = battleAdapter.getBattleStateSnapshot();
    } catch (err) {
      battleState = null;
    }
  }
  if (!battleState && typeof window.BATTLE === 'function') {
    try {
      battleState = window.BATTLE();
    } catch (err) {
      battleState = null;
    }
  }
  if (!battleState) {
    return null;
  }
  const autoBattle = battleAdapter && typeof battleAdapter.isAutoBattleEnabled === 'function'
    ? battleAdapter.isAutoBattleEnabled()
    : (battleState.autoBattle != null ? !!battleState.autoBattle : null);
  const playerStates = Array.isArray(battleState.player)
    ? (battleState.player as AnyRecord[]).filter(Boolean)
    : [];
  const playerReady = playerStates.filter((player: AnyRecord) => player && player.action && player.action.actionType != null).length;
  const enemyStates = Array.isArray(battleState.enemy)
    ? (battleState.enemy as AnyRecord[]).filter((enemy: AnyRecord) => enemy && enemy.objectID !== 0)
    : [];
  const actionQueue = Array.isArray(battleState.actionQueue) ? (battleState.actionQueue as AnyRecord[]) : [];
  const curActionIndex = Number.isFinite(battleState.curAction) ? battleState.curAction : 0;
  const queueEntry = actionQueue[curActionIndex] || null;
  const currentAction = queueEntry ? {
    actorType: queueEntry.actorType || (queueEntry.actor && queueEntry.actor.type) || (queueEntry.isEnemy ? 'enemy' : 'player'),
    actionType: queueEntry.action && queueEntry.action.actionType != null
      ? queueEntry.action.actionType
      : (queueEntry.command != null ? queueEntry.command : null)
  } : null;
  const phase = battleState.phase != null
    ? battleState.phase
    : (battleState.ui && (battleState.ui.state || battleState.ui.menuState)) || null;
  return {
    playerCount: playerStates.length,
    playerReady,
    enemyCount: enemyStates.length,
    actionQueue: actionQueue.length,
    curActionIndex,
    currentAction,
    autoBattle,
    phase
  };
}

function gatherSpriteStats() {
  if (!window.debugUtils || typeof window.debugUtils.getSpriteStats !== 'function') {
    return null;
  }
  return window.debugUtils.getSpriteStats({ limit: 3 });
}

function gatherRLEStats() {
  if (!window.debugUtils || typeof window.debugUtils.getRLEStats !== 'function') {
    return null;
  }
  return window.debugUtils.getRLEStats();
}

function gatherReactiveStats() {
  if (!window.debugUtils || typeof window.debugUtils.getReactiveDiagnostics !== 'function') {
    return null;
  }
  const snapshot = window.debugUtils.getReactiveDiagnostics();
  if (!snapshot || !Array.isArray(snapshot.streams) || snapshot.streams.length === 0) {
    return null;
  }
  const byName = new Map<string, AnyRecord>();
  snapshot.streams.forEach((entry: AnyRecord) => {
    byName.set(entry.name, entry);
  });
  const buses = ['rootEvent$', 'battleBus$', 'sceneBus$']
    .map((name) => byName.get(name))
    .filter((entry): entry is AnyRecord => Boolean(entry));
  const signals = snapshot.streams
    .filter((entry: AnyRecord) => entry.kind === 'signal' && /^signal:world\./.test(entry.name))
    .sort((a: AnyRecord, b: AnyRecord) => {
      const aDelta = a.lastEmissionDelta != null ? a.lastEmissionDelta : Number.POSITIVE_INFINITY;
      const bDelta = b.lastEmissionDelta != null ? b.lastEmissionDelta : Number.POSITIVE_INFINITY;
      return aDelta - bDelta;
    })
    .slice(0, 3);
  if (!buses.length && !signals.length) {
    return null;
  }
  return { buses, signals };
}

function gatherAdapterStats(limit = 3) {
  const services = window.services;
  const manifest = services && services.adapterManifest;
  if (!manifest) {
    return null;
  }
  const entries = Object.keys(manifest).map((key) => (manifest as AnyRecord)[key]).filter(Boolean) as AnyRecord[];
  if (!entries.length) {
    return null;
  }
  const withStreams: AnyRecord[] = [];
  const legacyOnly: AnyRecord[] = [];
  entries.forEach((entry: AnyRecord) => {
    const streamCount = Array.isArray(entry.streams) ? entry.streams.length : 0;
    if (streamCount > 0) {
      withStreams.push({
        id: entry.id,
        primary: entry.primaryStream || entry.streams[0],
        streamCount
      });
    } else {
      legacyOnly.push({
        id: entry.id,
        description: entry.description || ''
      });
    }
  });
  const pick = (list: AnyRecord[]) => {
    if (!list.length) {
      return [];
    }
    return list.slice(0, Math.max(0, limit));
  };
  return {
    withStreams,
    legacyOnly,
    preview: {
      withStreams: pick(withStreams),
      legacyOnly: pick(legacyOnly)
    }
  };
}

function renderSummary(scope: string | null | undefined, context: { fps: number | null }) {
  const lines = [];
  if (context.fps != null) {
    lines.push(formatLine('FPS', context.fps.toFixed(1)));
  }
  const rxStats = gatherReactiveStats();
  if (rxStats) {
    lines.push('Rx:');
    rxStats.buses.forEach((entry: AnyRecord) => {
      const summary = formatValueSummary(entry.lastValue);
      const suffix = summary ? ` ${summary}` : '';
      lines.push(
        `  ${entry.name} subs:${entry.subscribers} emit:${entry.emissions} last:${formatDelta(entry.lastEmissionDelta)}${suffix}`
      );
    });
    rxStats.signals.forEach((entry: AnyRecord) => {
      const label = entry.name.replace(/^signal:/, '');
      const summary = formatValueSummary(entry.lastValue);
      const suffix = summary ? ` ${summary}` : '';
      lines.push(
        `  ${label} subs:${entry.subscribers} last:${formatDelta(entry.lastEmissionDelta)}${suffix}`
      );
    });
  }
  const adapterStats = gatherAdapterStats();
  if (adapterStats) {
    lines.push(`Adapters: streams=${adapterStats.withStreams.length} legacy=${adapterStats.legacyOnly.length}`);
    adapterStats.preview.withStreams.forEach((entry: AnyRecord) => {
      lines.push(`  ✓ ${entry.id} (${entry.streamCount}) → ${entry.primary || '-'}`);
    });
    adapterStats.preview.legacyOnly.forEach((entry: AnyRecord) => {
      lines.push(`  ! ${entry.id} legacy${entry.description ? ` – ${entry.description}` : ''}`);
    });
  }
  if (!scope || scope === 'scene') {
    const sceneStats = gatherSceneStats();
    if (sceneStats) {
      lines.push(formatLine('Scene', sceneStats.sceneId != null ? sceneStats.sceneId : '-'));
      if (sceneStats.viewport != null) {
        lines.push(formatLine('Viewport', `0x${sceneStats.viewport.toString(16)}`));
      }
      if (sceneStats.eventCount != null) {
        const suffix = sceneStats.eventVersion != null ? ` v${sceneStats.eventVersion}` : '';
        lines.push(formatLine('Events', `${sceneStats.eventCount}${suffix}`));
      }
    }
    const spriteStats = gatherSpriteStats();
    if (spriteStats) {
      lines.push(formatLine('Sprites', `${spriteStats.cacheSize}/${spriteStats.stats.created}`));
      spriteStats.cache.forEach((entry: AnyRecord) => {
        lines.push(`  #${entry.spriteNum}: ${entry.frameCount}f`);
      });
    }
  }
  if (!scope || scope === 'battle') {
    const battleStats = gatherBattleStats();
    if (battleStats) {
      lines.push('Battle: active');
      if (battleStats.autoBattle != null) {
        lines.push(`  Auto: ${battleStats.autoBattle ? 'ON' : 'OFF'}`);
      }
      if (battleStats.phase != null) {
        lines.push(`  Phase: ${battleStats.phase}`);
      }
      if (battleStats.playerCount != null) {
        const readySuffix = battleStats.playerReady != null ? ` ready:${battleStats.playerReady}` : '';
        lines.push(`  Players: ${battleStats.playerCount}${readySuffix}`);
      }
      if (battleStats.enemyCount != null) {
        lines.push(`  Enemies: ${battleStats.enemyCount}`);
      }
      if (battleStats.actionQueue != null) {
        const cursor = battleStats.curActionIndex != null && battleStats.actionQueue > 0
          ? `@${Math.min(battleStats.curActionIndex, battleStats.actionQueue - 1)}`
          : '';
        lines.push(`  Queue: ${battleStats.actionQueue}${cursor}`);
      }
      if (battleStats.currentAction) {
        const actionLabel = battleStats.currentAction.actionType != null
          ? battleStats.currentAction.actionType
          : '-';
        lines.push(`    -> ${battleStats.currentAction.actorType || '?'}:${actionLabel}`);
      }
    }
  }
  const rleStats = gatherRLEStats();
  if (rleStats) {
    lines.push(formatLine('RLE calls', rleStats.calls));
    lines.push(formatLine('RLE reused', rleStats.reused));
  }
  return lines.join('\n');
}

function startOverlay(scope?: string) {
  ensureOverlay();
  cancelLoop();
  scheduleLoop((context) => renderSummary(scope, context));
}

function stopOverlay() {
  cancelLoop();
  if (overlayElement && overlayElement.parentNode) {
    overlayElement.parentNode.removeChild(overlayElement);
  }
  overlayElement = null;
  frameCount = 0;
}

function toggleOverlay(scope?: string) {
  if (overlayElement) {
    stopOverlay();
  } else {
    startOverlay(scope);
  }
}

export {
  startOverlay,
  stopOverlay,
  toggleOverlay
};

export default {
  startOverlay,
  stopOverlay,
  toggleOverlay
};
