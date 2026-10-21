import { worldService } from '../services/index';
import resourceService from '../services/resource-service.js';
import scriptObjectAdapter from '../services/script-object-adapter.js';
import { getSceneIdValue as getCurrentSceneId } from '../services/scene-state-adapter.js';

type AnyRecord = Record<string, any>;

type TextResources = {
  msgBuf: Uint8Array;
  msgOffset: Uint32Array;
};

type ScriptNarrative = {
  scriptId: number;
  dialogues: AnyRecord[];
  choices: AnyRecord[];
  truncated: boolean;
};

type NarrativeOptions = {
  maxSteps?: number;
  maxDepth?: number;
};

type ExportOptions = {
  download?: boolean;
  filename?: string;
};

const big5Decoder = (() => {
  if (typeof TextDecoder === 'undefined') {
    return null;
  }
  try {
    return new TextDecoder('big5');
  } catch (err) {
    try {
      return new TextDecoder('big5-hkscs');
    } catch (err2) {
      return new TextDecoder();
    }
  }
})();

let textResourcesPromise: Promise<TextResources> | null = null;
const scriptNarrativeCache = new Map<number, ScriptNarrative>();

function safeNumber(value: unknown) {
  return Number.isFinite(value) ? (value as number) : null;
}

function extractSpeaker(text: unknown) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  const separators = ['：', ':'];
  for (let i = 0; i < separators.length; i++) {
    const idx = text.indexOf(separators[i]);
    if (idx > 0 && idx < 12) {
      return text.slice(0, idx).trim();
    }
  }
  return null;
}

function stripSpeakerPrefix(text: unknown, speaker: string | null) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  let normalized = text.trim();
  if (!speaker) {
    return normalized;
  }
  const separators = ['：', ':', '﹕'];
  for (let i = 0; i < separators.length; i++) {
    const prefix = `${speaker}${separators[i]}`;
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim();
      break;
    }
  }
  return normalized;
}

function mapPartySnapshot() {
  if (!worldService || typeof (worldService as any).getParty !== 'function') {
    return [] as AnyRecord[];
  }
  const party = (worldService as any).getParty() || [];
  return party.map((member: AnyRecord, index: number) => {
    if (!member || typeof member !== 'object') {
      return { index } as AnyRecord;
    }
    return {
      index,
      playerRole: member.playerRole ?? null,
      hp: safeNumber(member.hp),
      maxHp: safeNumber(member.maxHp),
      mp: safeNumber(member.mp),
      maxMp: safeNumber(member.maxMp),
      x: safeNumber(member.x),
      y: safeNumber(member.y)
    } as AnyRecord;
  });
}

function summarizeEvents(events: unknown, leader: AnyRecord | null) {
  if (!Array.isArray(events)) {
    return [] as AnyRecord[];
  }
  const leaderX = leader && Number.isFinite(leader.x) ? leader.x : null;
  const leaderY = leader && Number.isFinite(leader.y) ? leader.y : null;
  return events.map((event) => {
    const state = event && (event as AnyRecord).state ? (event as AnyRecord).state : {};
    const x = safeNumber(state.x);
    const y = safeNumber(state.y);
    return {
      id: event && (event as AnyRecord).id != null ? (event as AnyRecord).id : null,
      index: event && (event as AnyRecord).index != null ? (event as AnyRecord).index : null,
      position: { x, y },
      offsets: leaderX == null || leaderY == null || x == null || y == null
        ? null
        : { dx: x - leaderX, dy: y - leaderY },
      triggerScript: state.triggerScript ?? null,
      autoScript: state.autoScript ?? null,
      spriteId: state.spriteId ?? null
    } as AnyRecord;
  });
}

function buildSceneContext(sceneId: number, events: AnyRecord[]) {
  const viewport = typeof (worldService as any).getViewport === 'function'
    ? safeNumber((worldService as any).getViewport())
    : null;
  const followers = typeof (worldService as any).getFollowerCount === 'function'
    ? safeNumber((worldService as any).getFollowerCount())
    : null;
  const flags = {
    collect: typeof (worldService as any).getCollectValue === 'function'
      ? safeNumber((worldService as any).getCollectValue())
      : null,
    chaseRange: typeof (worldService as any).getChaseRange === 'function'
      ? safeNumber((worldService as any).getChaseRange())
      : null,
    chaseCycles: typeof (worldService as any).getChaseSpeedChangeCycles === 'function'
      ? safeNumber((worldService as any).getChaseSpeedChangeCycles())
      : null,
    battleSpeed: typeof (worldService as any).getBattleSpeed === 'function'
      ? safeNumber((worldService as any).getBattleSpeed())
      : null
  };
  const party = mapPartySnapshot();
  const leader = party.length > 0 ? party[0] : null;
  return {
    sceneId,
    viewport,
    followers,
    flags,
    leader,
    party,
    events: summarizeEvents(events, leader)
  } as AnyRecord;
}

function ensureSceneReady(sceneId: number) {
  if (!Number.isFinite(sceneId) || sceneId <= 0) {
    throw new TypeError('[storygraph] sceneId must be a positive number');
  }
  const previous = typeof getCurrentSceneId === 'function' ? getCurrentSceneId() : null;
  if (previous === sceneId) {
    return () => {};
  }
  (worldService as any).setSceneId(sceneId);
  return () => {
    if (Number.isFinite(previous) && (previous as number) > 0) {
      (worldService as any).setSceneId(previous);
    }
  };
}

function addScriptNode(nodes: AnyRecord[], cache: Map<number, AnyRecord>, scriptId: number, label?: string | null) {
  if (!Number.isFinite(scriptId) || scriptId <= 0) {
    return null;
  }
  if (cache.has(scriptId)) {
    const existing = cache.get(scriptId) as AnyRecord;
    if (label && existing.metadata) {
      existing.metadata.labels = existing.metadata.labels || [];
      if (!existing.metadata.labels.includes(label)) {
        existing.metadata.labels.push(label);
      }
    }
    return existing;
  }
  const nodeId = `script-${scriptId}`;
  const node = {
    id: nodeId,
    type: 'script',
    label: `Script ${scriptId}`,
    metadata: {
      scriptId,
      labels: label ? [label] : []
    }
  } as AnyRecord;
  nodes.push(node);
  cache.set(scriptId, node);
  return node;
}

async function ensureTextResources() {
  if (textResourcesPromise) {
    return textResourcesPromise;
  }
  textResourcesPromise = (async () => {
    const msgBuffer = await resourceService.loadFiles('M.MSG');
    const msgBytes = msgBuffer instanceof Uint8Array
      ? msgBuffer
      : msgBuffer instanceof ArrayBuffer
        ? new Uint8Array(msgBuffer)
        : new Uint8Array();
    await resourceService.loadMKF('SSS');
    const sss = resourceService.getMKF('SSS') as AnyRecord | null;
    if (!sss || typeof sss.readChunk !== 'function') {
      return {
        msgBuf: msgBytes,
        msgOffset: new Uint32Array()
      } as TextResources;
    }
    const offsetChunk = sss.readChunk(3) as Uint8Array;
    const msgOffset = new Uint32Array(
      offsetChunk.buffer,
      offsetChunk.byteOffset,
      offsetChunk.byteLength / 4
    );
    return {
      msgBuf: msgBytes,
      msgOffset
    } as TextResources;
  })();
  return textResourcesPromise;
}

async function decodeMessage(msgId: number) {
  if (!Number.isFinite(msgId) || msgId < 0) {
    return '';
  }
  const resources = await ensureTextResources();
  if (!resources || msgId >= resources.msgOffset.length - 1) {
    return '';
  }
  const start = resources.msgOffset[msgId];
  const end = resources.msgOffset[msgId + 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return '';
  }
  const slice = resources.msgBuf.subarray(start, end);
  if (big5Decoder) {
    try {
      return big5Decoder.decode(slice).trim();
    } catch (err) {
      // fall through
    }
  }
  let result = '';
  for (let i = 0; i < slice.length; i++) {
    result += String.fromCharCode(slice[i]);
  }
  return result.trim();
}

function normalizeOperands(entry: AnyRecord | null) {
  if (!entry) {
    return [] as AnyRecord[];
  }
  const operands = entry.operand;
  if (Array.isArray(operands)) {
    return operands;
  }
  if (operands && typeof operands.length === 'number') {
    const result = [] as AnyRecord[];
    for (let i = 0; i < operands.length; i++) {
      result.push(operands[i]);
    }
    return result;
  }
  return [] as AnyRecord[];
}

async function collectScriptNarrative(scriptId: number, options: NarrativeOptions = {}) {
  if (!Number.isFinite(scriptId) || scriptId <= 0) {
    return null;
  }
  if (scriptNarrativeCache.has(scriptId)) {
    return scriptNarrativeCache.get(scriptId) || null;
  }
  const maxSteps = options.maxSteps || 512;
  const maxDepth = options.maxDepth || 64;
  const summary: ScriptNarrative = {
    scriptId,
    dialogues: [],
    choices: [],
    truncated: false
  };
  const visited = new Set<string>();
  const queue: AnyRecord[] = [];
  const baseFrame = {
    pointer: scriptId,
    depth: 0,
    path: `script-${scriptId}`,
    stack: [] as number[],
    speaker: null as string | null
  };

  const extendPath = (frame: AnyRecord, segment: unknown) => {
    const basePath = frame && frame.path ? frame.path : baseFrame.path;
    if (!segment && segment !== 0) {
      return basePath;
    }
    return `${basePath}->${segment}`;
  };

  const enqueue = (frame: AnyRecord) => {
    if (!frame) {
      return;
    }
    const pointer = Number(frame.pointer);
    if (!Number.isFinite(pointer) || pointer <= 0) {
      return;
    }
    if (Number(frame.depth) > maxDepth) {
      return;
    }
    queue.push({
      pointer,
      depth: Number(frame.depth) || 0,
      path: frame.path || baseFrame.path,
      stack: Array.isArray(frame.stack) ? [...frame.stack] : [],
      speaker: typeof frame.speaker === 'string' && frame.speaker.length ? frame.speaker : null
    });
  };

  enqueue(baseFrame);

  let cursor = 0;
  let steps = 0;
  while (cursor < queue.length && steps < maxSteps) {
    const frame = queue[cursor++];
    const visitKey = `${frame.pointer}:${frame.stack.join('>')}:${frame.speaker || ''}`;
    if (visited.has(visitKey)) {
      continue;
    }
    visited.add(visitKey);
    steps += 1;

    const entry = scriptObjectAdapter.getScriptEntry(frame.pointer);
    if (!entry) {
      continue;
    }
    const op = entry.operation >>> 0;
    const operands = normalizeOperands(entry as AnyRecord);

    switch (op) {
      case 0xFFFF: {
        const msgId = Number(operands[0]);
        const rawText = await decodeMessage(msgId);
        const extractedSpeaker = extractSpeaker(rawText);
        const normalizedText = stripSpeakerPrefix(rawText, extractedSpeaker);
        const resolvedSpeaker = extractedSpeaker || frame.speaker || null;
        const carrySpeaker = extractedSpeaker || frame.speaker || null;
        if (!normalizedText) {
          enqueue({
            pointer: frame.pointer + 1,
            depth: frame.depth + 1,
            path: extendPath(frame, frame.pointer + 1),
            stack: frame.stack,
            speaker: carrySpeaker
          });
          continue;
        }
        summary.dialogues.push({
          msgId,
          text: normalizedText,
          speaker: resolvedSpeaker,
          path: frame.path,
          depth: frame.depth,
          pointer: frame.pointer
        });
        enqueue({
          pointer: frame.pointer + 1,
          depth: frame.depth + 1,
          path: extendPath(frame, frame.pointer + 1),
          stack: frame.stack,
          speaker: carrySpeaker
        });
        continue;
      }
      case 0x000A: {
        summary.choices.push({
          type: 'confirm',
          nextIfNo: Number(operands[0]) || null,
          description: 'Yes/No prompt',
          path: frame.path,
          depth: frame.depth,
          pointer: frame.pointer
        });
        enqueue({
          pointer: frame.pointer + 1,
          depth: frame.depth + 1,
          path: extendPath(frame, 'yes'),
          stack: frame.stack
        });
        if (Number.isFinite(operands[0]) && Number(operands[0]) > 0) {
          enqueue({
            pointer: operands[0],
            depth: frame.depth + 1,
            path: extendPath(frame, 'no'),
            stack: [...frame.stack]
          });
        }
        continue;
      }
      case 0x0002: {
        const target = Number(operands[0]);
        if (Number.isFinite(target) && target > 0) {
          enqueue({
            pointer: target,
            depth: frame.depth + 1,
            path: extendPath(frame, `jump:${target}`),
            stack: frame.stack
          });
        }
        enqueue({
          pointer: frame.pointer + 1,
          depth: frame.depth + 1,
          path: extendPath(frame, 'cont'),
          stack: frame.stack
        });
        continue;
      }
      case 0x0003: {
        const target = Number(operands[0]);
        if (Number.isFinite(target) && target > 0) {
          enqueue({
            pointer: target,
            depth: frame.depth + 1,
            path: extendPath(frame, `jmp:${target}`),
            stack: frame.stack
          });
        }
        continue;
      }
      case 0x0004: {
        const target = Number(operands[0]);
        if (Number.isFinite(target) && target > 0) {
          const returnPointer = frame.pointer + 1;
          enqueue({
            pointer: target,
            depth: frame.depth + 1,
            path: extendPath(frame, `call:${target}`),
            stack: [...frame.stack, returnPointer]
          });
        }
        continue;
      }
      case 0x0005: {
        if (frame.stack.length > 0) {
          const nextPointer = frame.stack[frame.stack.length - 1];
          enqueue({
            pointer: nextPointer,
            depth: frame.depth + 1,
            path: extendPath(frame, `ret:${nextPointer}`),
            stack: frame.stack.slice(0, -1)
          });
        }
        continue;
      }
      case 0x0000: {
        if (frame.stack.length > 0) {
          const nextPointer = frame.stack[frame.stack.length - 1];
          enqueue({
            pointer: nextPointer,
            depth: frame.depth + 1,
            path: extendPath(frame, `ret:${nextPointer}`),
            stack: frame.stack.slice(0, -1)
          });
        }
        continue;
      }
      default: {
        enqueue({
          pointer: frame.pointer + 1,
          depth: frame.depth + 1,
          path: extendPath(frame, frame.pointer + 1),
          stack: frame.stack
        });
        continue;
      }
    }
  }
  if (cursor < queue.length || steps >= maxSteps) {
    summary.truncated = true;
  }
  scriptNarrativeCache.set(scriptId, summary);
  return summary;
}

export async function buildStoryGraphForScene(sceneId = 2) {
  const restoreScene = ensureSceneReady(sceneId);
  const sceneNodeId = `scene-${sceneId}`;
  try {
    const sceneEntry = (worldService as any).getSceneEntry(sceneId) || {};
    const events = (worldService as any).getEventObjectsInCurrentScene() || [];
    const sceneContext = buildSceneContext(sceneId, events);
    const sceneNarrative = { dialogues: [] as AnyRecord[], choices: [] as AnyRecord[] };
    const nodes: AnyRecord[] = [
      {
        id: sceneNodeId,
        type: 'scene',
        label: `Scene ${sceneId}`,
        metadata: {
          ...sceneEntry,
          context: sceneContext
        }
      }
    ];
    const edges: AnyRecord[] = [];
    const scriptCache = new Map<number, AnyRecord>();

    const sceneScriptRefs: Array<[string, string]> = [
      ['scriptOnEnter', 'enter'],
      ['scriptOnTeleport', 'teleport']
    ];

    for (const [field, label] of sceneScriptRefs) {
      const scriptId = Number((sceneEntry as AnyRecord)[field]);
      const scriptNode = addScriptNode(nodes, scriptCache, scriptId, label);
      if (scriptNode) {
        edges.push({ source: sceneNodeId, target: scriptNode.id, type: 'scene-script', label });
        const summary = await collectScriptNarrative(scriptId);
        if (summary && (summary.dialogues.length || summary.choices.length)) {
          scriptNode.metadata = scriptNode.metadata || {};
          scriptNode.metadata.narrative = summary;
          sceneNarrative.dialogues.push(...summary.dialogues);
          sceneNarrative.choices.push(...summary.choices);
        }
      }
    }

    for (const event of events) {
      const eventNodeId = `scene-${sceneId}-event-${(event as AnyRecord).id}`;
      const eventMetadata = (event as AnyRecord).state ? { ...(event as AnyRecord).state } : {};
      const eventContext = sceneContext.events.find((entry: AnyRecord) => entry && entry.id === (event as AnyRecord).id) || null;
      (eventMetadata as AnyRecord).context = {
        sceneId,
        eventId: (event as AnyRecord).id ?? null,
        viewport: sceneContext.viewport,
        followers: sceneContext.followers,
        flags: sceneContext.flags,
        leader: sceneContext.leader,
        party: sceneContext.party,
        event: eventContext
      };
      nodes.push({
        id: eventNodeId,
        type: 'event',
        label: `Event ${(event as AnyRecord).id}`,
        metadata: eventMetadata
      });
      edges.push({ source: sceneNodeId, target: eventNodeId, type: 'contains' });

      const scriptFields: Array<[string, string]> = [
        ['triggerScript', 'trigger'],
        ['autoScript', 'auto']
      ];
      const aggregatedNarrative = { dialogues: [] as AnyRecord[], choices: [] as AnyRecord[] };

      for (const [field, label] of scriptFields) {
        const scriptId = Number((event as AnyRecord).state ? (event as AnyRecord).state[field] : null);
        const scriptNode = addScriptNode(nodes, scriptCache, scriptId, label);
        if (!scriptNode) {
          continue;
        }
        edges.push({ source: eventNodeId, target: scriptNode.id, type: 'script', label });
        const summary = await collectScriptNarrative(scriptId);
        if (summary && (summary.dialogues.length || summary.choices.length)) {
          scriptNode.metadata = scriptNode.metadata || {};
          scriptNode.metadata.narrative = summary;
          aggregatedNarrative.dialogues.push(...summary.dialogues);
          aggregatedNarrative.choices.push(...summary.choices);
        }
      }

      if (aggregatedNarrative.dialogues.length || aggregatedNarrative.choices.length) {
        (eventMetadata as AnyRecord).narrative = aggregatedNarrative;
        sceneNarrative.dialogues.push(...aggregatedNarrative.dialogues);
        sceneNarrative.choices.push(...aggregatedNarrative.choices);
      }
    }

    const graph = {
      sceneId,
      nodes,
      edges,
      metadata: {
        generatedAt: new Date().toISOString(),
        totalEvents: events.length,
        context: sceneContext,
        narrative: sceneNarrative
      }
    } as AnyRecord;
    if (nodes[0] && nodes[0].metadata) {
      (nodes[0].metadata as AnyRecord).narrative = sceneNarrative;
    }
    return graph;
  } finally {
    restoreScene();
  }
}

function triggerDownload(graph: AnyRecord, filename: string) {
  if (typeof document === 'undefined') {
    return;
  }
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportSceneStoryGraph(sceneId = 2, options: ExportOptions = {}) {
  const graph = await buildStoryGraphForScene(sceneId);
  if (options.download !== false) {
    const filename = options.filename || `scene-${sceneId}-storygraph.json`;
    triggerDownload(graph, filename);
  }
  return graph;
}

if (typeof window !== 'undefined') {
  const globalAny = window as any;
  globalAny.storygraph = globalAny.storygraph || {};
  globalAny.storygraph.exportScene = (...args: any[]) => exportSceneStoryGraph(...args);
}
