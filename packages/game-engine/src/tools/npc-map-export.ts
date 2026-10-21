import { buildStoryGraphForScene } from './storygraph-export.js';
import stateService from '../services/state-service.js';

type AnyRecord = Record<string, any>;

type ExportOptions = {
  maxDialoguesPerEvent?: number;
  maxSceneId?: number;
  sceneIds?: number[];
  logProgress?: boolean;
  download?: boolean;
  filename?: string;
};

const DEFAULT_FILENAME = 'npc-event-map.json';
const DEFAULT_MAX_DIALOGS_PER_EVENT = 5;

function normalizeSpeaker(rawSpeaker: unknown, text: unknown) {
  if (typeof rawSpeaker === 'string' && rawSpeaker.trim()) {
    return rawSpeaker.trim();
  }
  if (typeof text === 'string') {
    const separators = ['：', ':', '﹕'];
    for (let i = 0; i < separators.length; i++) {
      const idx = text.indexOf(separators[i]);
      if (idx > 0 && idx < 12) {
        return text.slice(0, idx).trim();
      }
    }
  }
  return null;
}

function parseEventIdFromNodeId(nodeId: unknown) {
  if (typeof nodeId !== 'string') {
    return null;
  }
  const parts = nodeId.split('-');
  const last = parts[parts.length - 1];
  const value = Number(last);
  return Number.isFinite(value) ? value : null;
}

function ensureSpeakerBucket(map: Map<string, Map<string, AnyRecord>>, speaker: string) {
  let bucket = map.get(speaker);
  if (!bucket) {
    bucket = new Map();
    map.set(speaker, bucket);
  }
  return bucket;
}

function ensureEventEntry(bucket: Map<string, AnyRecord>, baseMeta: AnyRecord) {
  const key = `${baseMeta.sceneId}:${baseMeta.eventId}`;
  let entry = bucket.get(key);
  if (!entry) {
    entry = {
      sceneId: baseMeta.sceneId,
      eventId: baseMeta.eventId,
      position: baseMeta.position || null,
      offsets: baseMeta.offsets || null,
      scripts: {
        trigger: baseMeta.scripts.trigger ?? null,
        auto: baseMeta.scripts.auto ?? null
      },
      dialogues: [] as AnyRecord[]
    };
    bucket.set(key, entry);
  }
  return entry;
}

function downloadJSON(payload: AnyRecord, filename?: string) {
  if (typeof document === 'undefined') {
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || DEFAULT_FILENAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function serializeResult(
  map: Map<string, Map<string, AnyRecord>>,
  stats: AnyRecord,
  options: ExportOptions = {}
) {
  const entries: AnyRecord = {};
  const maxDialogs = Number.isFinite(options.maxDialoguesPerEvent)
    ? Math.max(1, options.maxDialoguesPerEvent || 0)
    : DEFAULT_MAX_DIALOGS_PER_EVENT;
  let totalEvents = 0;
  const sortedSpeakers = Array.from(map.keys()).sort((a, b) => {
    return a.localeCompare(b, 'zh-Hans', { sensitivity: 'base' });
  });
  sortedSpeakers.forEach((speaker) => {
    const bucket = map.get(speaker);
    if (!bucket) {
      return;
    }
    const events = Array.from(bucket.values()).map((entry) => {
      totalEvents += 1;
      return {
        sceneId: entry.sceneId,
        eventId: entry.eventId,
        position: entry.position,
        offsets: entry.offsets,
        scripts: entry.scripts,
        dialogues: entry.dialogues.slice(0, maxDialogs)
      };
    });
    entries[speaker] = {
      occurrences: events.length,
      events
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    totalSpeakers: sortedSpeakers.length,
    totalEvents,
    processedScenes: stats.processedScenes,
    requestedScenes: stats.requestedScenes,
    totalSceneCount: stats.totalSceneCount,
    entries
  } as AnyRecord;
}

async function processScene(
  sceneId: number,
  map: Map<string, Map<string, AnyRecord>>,
  options: ExportOptions
) {
  const graph = await buildStoryGraphForScene(sceneId);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  nodes.forEach((node: AnyRecord) => {
    if (!node || node.type !== 'event') {
      return;
    }
    const metadata = node.metadata || {};
    const context = metadata.context || {};
    const eventContext = context.event || {};
    const eventId = eventContext.id ?? parseEventIdFromNodeId(node.id);
    if (!eventId) {
      return;
    }
    const sceneRef = graph.sceneId ?? context.sceneId ?? null;
    const baseMeta = {
      sceneId: sceneRef || sceneId,
      eventId,
      position: eventContext.position || null,
      offsets: eventContext.offsets || null,
      scripts: {
        trigger: metadata.triggerScript ?? eventContext.triggerScript ?? null,
        auto: metadata.autoScript ?? eventContext.autoScript ?? null
      }
    };
    const dialogues = Array.isArray(metadata.narrative?.dialogues)
      ? metadata.narrative.dialogues
      : [];
    dialogues.forEach((dialogue: AnyRecord) => {
      if (!dialogue || !dialogue.text) {
        return;
      }
      const speaker = normalizeSpeaker(dialogue.speaker, dialogue.text);
      if (!speaker) {
        return;
      }
      const bucket = ensureSpeakerBucket(map, speaker);
      const entry = ensureEventEntry(bucket, baseMeta);
      entry.dialogues.push({
        text: dialogue.text,
        msgId: dialogue.msgId ?? null,
        pointer: dialogue.pointer ?? null,
        path: dialogue.path ?? null
      });
    });
  });
}

export async function exportNpcEventMap(options: ExportOptions = {}) {
  const sceneTable = stateService.getGameData('scene');
  const totalSceneCount = Array.isArray(sceneTable) ? sceneTable.length : null;
  const maxSceneId = Number.isFinite(options.maxSceneId)
    ? Math.max(1, options.maxSceneId || 0)
    : (totalSceneCount || 300);
  const requestedScenes = Array.isArray(options.sceneIds) && options.sceneIds.length
    ? options.sceneIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : Array.from({ length: maxSceneId }, (_, idx) => idx + 1);

  const speakerMap = new Map<string, Map<string, AnyRecord>>();
  let processedScenes = 0;
  for (let i = 0; i < requestedScenes.length; i++) {
    const sceneId = requestedScenes[i];
    try {
      await processScene(sceneId, speakerMap, options);
      processedScenes += 1;
      if (options.logProgress !== false && typeof console !== 'undefined' && console.info) {
        console.info(`[npc-map] processed scene ${sceneId} (${processedScenes}/${requestedScenes.length})`);
      }
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[npc-map] failed to process scene ${sceneId}`, err);
      }
    }
  }

  const payload = serializeResult(
    speakerMap,
    {
      processedScenes,
      requestedScenes: requestedScenes.length,
      totalSceneCount
    },
    options
  );

  if (options.download !== false) {
    const filename = options.filename || DEFAULT_FILENAME;
    downloadJSON(payload, filename);
  }
  return payload;
}

if (typeof window !== 'undefined') {
  const globalAny = window as any;
  globalAny.npcMap = globalAny.npcMap || {};
  globalAny.npcMap.exportMap = (...args: any[]) => exportNpcEventMap(...args);
}
