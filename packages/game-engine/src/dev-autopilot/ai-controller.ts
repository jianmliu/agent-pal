import aiGateway, { ensureAdaptersLoaded } from '../ai/ai-gateway';
import { worldService } from '../services/index';
import { ReplayRecorder } from './ai-replay';
import { runQwen } from '../ai/qwen-client';
import { retrieveKnowledge } from '../ai/knowledge-retriever';
import config from '../js/pal/config';

type AnyRecord = Record<string, any>;

type AIControllerOptions = {
  adapters?: string[];
  tickIntervalMs?: number;
  llmModel?: string;
  useLLM?: boolean;
  enablePlayerAutomation?: boolean;
  logLLM?: boolean;
  embeddingModel?: string;
  enableKnowledge?: boolean;
  knowledgeTopK?: number;
  minKnowledgeScore?: number;
  logStart?: boolean;
};

type LLMAction = {
  type?: string;
  action?: string;
  payload?: AnyRecord;
  cooldownMs?: number;
};

type DialogHistoryEntry = {
  text: string;
  msgId?: number | null;
  timestamp: number;
  source?: string | null;
};

const DEFAULT_ADAPTERS = ['environment', 'partyTrail', 'sceneEvents', 'battleState', 'playerState', 'gameFlags', 'dialog'];
const DEFAULT_LLM_MODEL = 'qwen3:8b';

const STREAM_CONFIG = [
  { adapter: 'environment', stream: 'environment.viewport', key: 'environment.viewport', throttleMs: 150, maxPayloadSize: 1024 },
  { adapter: 'partyTrail', stream: 'partyTrail.party', key: 'partyTrail.party', throttleMs: 200, maxPayloadSize: 2048 },
  { adapter: 'partyTrail', stream: 'partyTrail.followers', key: 'partyTrail.followers', throttleMs: 500, maxPayloadSize: 512 },
  { adapter: 'sceneEvents', stream: 'scene.events.objects', key: 'scene.events', throttleMs: 400, maxPayloadSize: 0 },
  { adapter: 'battleState', stream: 'battleState.state', key: 'battle.state', throttleMs: 200, maxPayloadSize: 32768 },
  { adapter: 'playerState', stream: 'playerState.roles', key: 'playerState.roles', throttleMs: 500, maxPayloadSize: 0 },
  { adapter: 'gameFlags', stream: 'gameFlags.collect', key: 'gameFlags.collect', throttleMs: 500, maxPayloadSize: 512 },
  { adapter: 'gameFlags', stream: 'gameFlags.chaseRange', key: 'gameFlags.chaseRange', throttleMs: 500, maxPayloadSize: 512 },
  { adapter: 'gameFlags', stream: 'gameFlags.chaseSpeedCycles', key: 'gameFlags.chaseSpeedCycles', throttleMs: 500, maxPayloadSize: 512 },
  { adapter: 'gameFlags', stream: 'gameFlags.battleSpeed', key: 'gameFlags.battleSpeed', throttleMs: 500, maxPayloadSize: 512 },
  { adapter: 'dialog', stream: 'dialog.currentLine', key: 'dialog.currentLine', throttleMs: 0, maxPayloadSize: 4096 },
  { adapter: 'dialog', stream: 'dialog.status', key: 'dialog.status', throttleMs: 0, maxPayloadSize: 1024 },
  { adapter: 'dialog', stream: 'dialog.choice', key: 'dialog.choice', throttleMs: 0, maxPayloadSize: 2048 }
];

export class AIController {
  adapters: string[];
  tickIntervalMs: number;
  state: Map<string, any>;
  subscriptions: Array<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  recorder: ReplayRecorder;
  ticks: number;
  llmModel: string;
  useLLM: boolean;
  enablePlayerAutomation: boolean;
  _tickPending: boolean;
  lastActionResult: AnyRecord | null;
  logLLM: boolean;
  dialogHistory: DialogHistoryEntry[];
  choiceMemory: Map<string, AnyRecord>;
  loggedChoiceIds: Set<string>;
  lastChoiceSummary: DialogHistoryEntry | null;
  embeddingModel: string;
  enableKnowledge: boolean;
  knowledgeTopK: number;
  minKnowledgeScore: number;
  lastKnowledgeEntries: AnyRecord[];

  constructor(options: AIControllerOptions = {}) {
    const llmPreference = resolveLLMPreference();
    this.adapters = options.adapters || DEFAULT_ADAPTERS;
    this.tickIntervalMs = options.tickIntervalMs || 500;
    this.state = new Map();
    this.subscriptions = [];
    this.timer = null;
    this.recorder = new ReplayRecorder({ adapters: this.adapters });
    this.ticks = 0;
    this.llmModel = options.llmModel || llmPreference.model || DEFAULT_LLM_MODEL;
    this.useLLM = typeof options.useLLM === 'boolean' ? options.useLLM : llmPreference.enabled;
    this.enablePlayerAutomation = typeof options.enablePlayerAutomation === 'boolean'
      ? options.enablePlayerAutomation
      : true;
    this._tickPending = false;
    this.lastActionResult = null;
    this.logLLM = typeof options.logLLM === 'boolean' ? options.logLLM : true;
    this.dialogHistory = [];
    this.choiceMemory = new Map();
    this.loggedChoiceIds = new Set();
    this.lastChoiceSummary = null;
    this.embeddingModel = options.embeddingModel || (config as AnyRecord).embeddingModel || 'nomic-embed-text';
    this.enableKnowledge = options.enableKnowledge !== false;
    this.knowledgeTopK = options.knowledgeTopK || 3;
    this.minKnowledgeScore = typeof options.minKnowledgeScore === 'number' ? options.minKnowledgeScore : 0.32;
    this.lastKnowledgeEntries = [];
  }

  async start() {
    await ensureAdaptersLoaded(this.adapters);
    await this.recorder.start();
    this._subscribeStreams();
    this.timer = setInterval(() => this._tick(), this.tickIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.subscriptions.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ai-controller] failed to unsubscribe', err);
        }
      }
    });
    this.subscriptions = [];
    this.recorder.stop();
  }

  _subscribeStreams() {
    STREAM_CONFIG.forEach((configEntry) => {
      const { adapter, stream, key, throttleMs, maxPayloadSize } = configEntry;
      if (!this.adapters.includes(adapter)) {
        return;
      }
      try {
        const unsubscribe = aiGateway.subscribe({
          adapter,
          stream,
          throttleMs,
          maxPayloadSize,
          handler: (value: any) => {
            this.state.set(key, value);
            if (key === 'dialog.currentLine') {
              this._appendDialogHistory(value);
            } else if (key === 'dialog.choice') {
              this._trackChoiceUpdate(value);
            }
            this.recorder.recordStream({ adapter, stream, value });
          }
        });
        this.subscriptions.push(unsubscribe);
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error(`[ai-controller] subscribe failed for ${adapter}:${stream}`, err);
        }
      }
    });
  }

  _appendDialogHistory(line: AnyRecord) {
    if (!line || typeof line.text !== 'string' || !line.text.trim()) {
      return;
    }
    const entry: DialogHistoryEntry = {
      text: line.text.trim(),
      msgId: line.msgId ?? null,
      timestamp: line.timestamp || Date.now(),
      source: line.source || null
    };
    this.dialogHistory.push(entry);
    if (this.dialogHistory.length > 5) {
      this.dialogHistory = this.dialogHistory.slice(-5);
    }
  }

  _trackChoiceUpdate(choice: AnyRecord) {
    if (!choice || !choice.id) {
      return;
    }
    if (choice.resolved) {
      const key = `${choice.id}:${choice.resolvedAt || choice.resolved}`;
      if (!this.loggedChoiceIds.has(key)) {
        this.loggedChoiceIds.add(key);
        this._logChoiceResolution(choice);
      }
    }
  }

  _logChoiceResolution(choice: AnyRecord) {
    let label = choice.resolvedLabel || choice.resolvedSelection?.label || null;
    const resolvedValue = choice.resolved;
    if (!label) {
      if (typeof resolvedValue === 'boolean') {
        label = resolvedValue ? 'YES' : 'NO';
      } else if (resolvedValue != null) {
        label = String(resolvedValue);
      }
    }
    if (!label && Array.isArray(choice.options)) {
      const index = Number.isFinite(choice.selectedIndex)
        ? Math.max(0, Math.min(choice.options.length - 1, Math.trunc(choice.selectedIndex)))
        : null;
      if (index != null && choice.options[index] && typeof choice.options[index].label === 'string') {
        label = choice.options[index].label.trim();
      }
    }
    if (!label) {
      label = 'UNKNOWN';
    }
    const summary: DialogHistoryEntry = {
      text: `[Choice] Selected ${label}`,
      timestamp: Date.now(),
      source: 'choice'
    };
    this.lastChoiceSummary = summary;
    this._appendDialogHistory(summary);
    if (this.logLLM && typeof console !== 'undefined' && console.info) {
      console.info('[ai-controller] dialog choice resolved', { label, choiceId: choice.id });
    }
  }

  _tick() {
    if (this._tickPending) {
      return;
    }
    this._tickPending = true;
    (async () => {
      this.ticks += 1;
      const snapshot = this._summarise();
      let action: AnyRecord | null = null;
      if (this.useLLM) {
        action = await this._decideWithLLM(snapshot);
      }
      if (!action && this.enablePlayerAutomation) {
        action = this._decideRuleBased(snapshot);
      }
      if (!action) {
        return;
      }
      try {
        const result = aiGateway.dispatch(action);
        this.lastActionResult = result;
        this.recorder.recordAction({ ...action, result });
        if (!(result as AnyRecord)?.success && typeof console !== 'undefined' && console.warn) {
          console.warn('[ai-controller] action failed', (result as AnyRecord)?.message);
        }
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[ai-controller] dispatch failed', err);
        }
      }
    })()
      .catch((err) => {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[ai-controller] tick error', err);
        }
      })
      .finally(() => {
        this._tickPending = false;
      });
  }

  _summarise() {
    const battleState = this.state.get('battle.state') || null;
    const inBattleFlag = (worldService && typeof worldService.isInBattle === 'function' && worldService.isInBattle()) ||
      (battleState && Array.isArray(battleState.player) && battleState.player.length > 0);
    const dialogState = {
      latest: this.state.get('dialog.currentLine') || null,
      history: [...this.dialogHistory],
      choice: this.state.get('dialog.choice') || null,
      status: this.state.get('dialog.status') || null,
      lastChoice: this.lastChoiceSummary
    };
    const summary: AnyRecord = {
      timestamp: Date.now(),
      ticks: this.ticks,
      sceneId: this._getSceneId(),
      viewport: this._getViewportValue(),
      party: this.state.get('partyTrail.party') || [],
      followers: this.state.get('partyTrail.followers') || 0,
      sceneEvents: this.state.get('scene.events') || [],
      battle: battleState,
      playerStats: this._getPlayerStats(),
      flags: this._getGameFlags(),
      dialog: dialogState,
      isInBattle: inBattleFlag,
      lastActionResult: this.lastActionResult
    };
    return summary;
  }

  _getViewportValue() {
    if (this.state.has('environment.viewport')) {
      return this.state.get('environment.viewport');
    }
    if (worldService && typeof worldService.getViewportComponent === 'function') {
      const component = worldService.getViewportComponent();
      if (component && Number.isFinite(component.value)) {
        return component.value;
      }
    }
    return null;
  }

  _getSceneId() {
    if (this.state.has('environment.sceneId')) {
      return this.state.get('environment.sceneId');
    }
    if (worldService && typeof worldService.getSceneId === 'function') {
      return worldService.getSceneId();
    }
    return null;
  }

  _getPlayerStats() {
    const roles = this.state.get('playerState.roles');
    if (Array.isArray(roles)) {
      return roles.slice(0, 4).map((role) => {
        if (!role) return null;
        return {
          roleId: role.playerRole,
          hp: role.hp,
          maxHp: role.maxHp,
          mp: role.mp,
          maxMp: role.maxMp,
          status: role.status
        };
      }).filter(Boolean);
    }
    return null;
  }

  _getGameFlags() {
    return {
      collect: this.state.get('gameFlags.collect') || 0,
      chaseRange: this.state.get('gameFlags.chaseRange') || 0,
      chaseCycles: this.state.get('gameFlags.chaseSpeedCycles') || 0,
      battleSpeed: this.state.get('gameFlags.battleSpeed') || 0
    };
  }


  _decideRuleBased(summary: AnyRecord) {
    if (!summary) {
      return null;
    }
    const dialogState = summary.dialog && summary.dialog.status;
    const latestLine = summary.dialog?.latest;
    const recentDialogTs = latestLine && Number.isFinite(latestLine.timestamp) ? latestLine.timestamp : null;
    const recentDialogActive = !!(recentDialogTs && Date.now() - recentDialogTs < 1500);
    if ((dialogState && (dialogState.awaitingInput || dialogState.active || dialogState.needsAdvance)) || recentDialogActive) {
      const action = dialogState && dialogState.mode === 'choice' ? 'confirm' : 'advance';
      return {
        type: 'dialog',
        payload: {
          action,
          cooldownMs: dialogState.cooldownMs ?? 200
        }
      };
    }

    const dialogAction = this._decideDialog(summary);
    if (dialogAction) {
      return dialogAction;
    }
    const inBattle = summary.isInBattle ||
      (summary.battle && Array.isArray(summary.battle.player) && summary.battle.player.length > 0);
    if (inBattle) {
      return this._decideBattle(summary);
    }
    return this._decideExploration(summary);
  }

  _decideExploration(summary: AnyRecord) {
    const party = summary.party || [];
    const leader = party[0];
    if (!leader) {
      return null;
    }
    const events = summary.sceneEvents || [];
    const nearEvent = events.find((entry: AnyRecord) => {
      if (!entry || !entry.state) {
        return false;
      }
      const dx = Math.abs((entry.state.x || 0) - (leader.x || 0));
      const dy = Math.abs((entry.state.y || 0) - (leader.y || 0));
      return dx + dy < 48;
    });
    if (nearEvent) {
      return { type: 'interact', payload: { eventId: nearEvent.id, cooldownMs: 500 } };
    }
    const direction = Math.floor(Math.random() * 4);
    return { type: 'move', payload: { direction, cooldownMs: 300 } };
  }

  _decideBattle(summary: AnyRecord) {
    const battle = summary.battle;
    if (!battle) {
      return null;
    }
    const enemies = (battle.enemy || []).map((enemy: AnyRecord, idx: number) => ({ enemy, idx }))
      .filter(({ enemy }: AnyRecord) => enemy && enemy.objectID !== 0);
    if (enemies.length === 0) {
      return null;
    }
    const preferred = enemies.find(({ enemy }: AnyRecord) => {
      const hp = typeof enemy.hp === 'number' ? enemy.hp : (enemy.e && enemy.e.health) || enemy.prevHP || 0;
      return hp > 0;
    }) || enemies[0];
    return {
      type: 'battleCommand',
      payload: {
        command: 'attack',
        targetType: 'enemy',
        targetIndex: preferred.idx,
        cooldownMs: 450
      }
    };
  }

  _decideDialog(summary: AnyRecord) {
    const dialog = summary.dialog;
    if (!dialog) {
      return null;
    }
    const choice = dialog.choice;
    if (choice) {
      if (choice.resolved && choice.id) {
        this.choiceMemory.delete(choice.id);
      } else if (!choice.resolved) {
        return this._decideChoiceAction(choice);
      }
    }
    const status = dialog.status;
    if (status && status.active) {
      return {
        type: 'dialog',
        payload: { action: 'advance', cooldownMs: status.awaitingInput ? 180 : 320 }
      };
    }
    return null;
  }

  _planChoiceNavigation(choice: AnyRecord) {
    const options = Array.isArray(choice.options) ? choice.options : [];
    if (options.length === 0) {
      return { moves: [], confirmAction: 'advance' };
    }
    const normalized = options.map((option: AnyRecord, index: number) => ({
      index,
      label: typeof option.label === 'string' ? option.label.toLowerCase() : '',
      value: option.value,
      raw: option
    }));

    const preferredTokens = [
      'yes', 'ok', '是', '確', '继续', '繼續', 'enter', 'start',
      'use', 'equip', 'buy', 'sell', '接受', 'confirm', '前进', '進入'
    ];

    const resolveTargetIndex = () => {
      if (Number.isFinite(choice.targetIndex)) {
        return Math.max(0, Math.min(options.length - 1, Math.trunc(choice.targetIndex)));
      }
      if (choice.targetLabel) {
        const targetLabel = String(choice.targetLabel).toLowerCase();
        const match = normalized.find((entry: AnyRecord) => entry.label.includes(targetLabel));
        if (match) {
          return match.index;
        }
      }
      if (choice.preferredValue != null) {
        const match = normalized.find((entry: AnyRecord) => entry.value === choice.preferredValue);
        if (match) {
          return match.index;
        }
      }
      const truthy = normalized.find((entry: AnyRecord) => entry.value === true);
      if (truthy) {
        return truthy.index;
      }
      for (const token of preferredTokens) {
        const match = normalized.find((entry: AnyRecord) => entry.label && entry.label.includes(token));
        if (match) {
          return match.index;
        }
      }
      return 0;
    };

    const columns = (() => {
      if (Number.isFinite(choice.columns)) {
        return Math.max(1, Math.trunc(choice.columns));
      }
      if (choice.layout && Number.isFinite(choice.layout.columns)) {
        return Math.max(1, Math.trunc(choice.layout.columns));
      }
      return 1;
    })();
    const currentIndex = Number.isFinite(choice.selectedIndex)
      ? Math.max(0, Math.min(options.length - 1, Math.trunc(choice.selectedIndex)))
      : 0;
    const targetIndex = resolveTargetIndex();

    const moves: string[] = [];
    if (columns > 1) {
      const currentRow = Math.floor(currentIndex / columns);
      const currentCol = currentIndex % columns;
      const targetRow = Math.floor(targetIndex / columns);
      const targetCol = targetIndex % columns;
      const verticalSteps = targetRow - currentRow;
      const horizontalSteps = targetCol - currentCol;
      const verticalDir = verticalSteps > 0 ? 'down' : 'up';
      const horizontalDir = horizontalSteps > 0 ? 'right' : 'left';
      for (let i = 0; i < Math.abs(verticalSteps); i++) {
        moves.push(verticalDir);
      }
      for (let i = 0; i < Math.abs(horizontalSteps); i++) {
        moves.push(horizontalDir);
      }
    } else {
      const delta = targetIndex - currentIndex;
      const direction = delta >= 0 ? 'right' : 'left';
      for (let i = 0; i < Math.abs(delta); i++) {
        moves.push(direction);
      }
    }

    return {
      moves,
      confirmAction: choice.confirmAction || 'advance',
      confirmCooldown: choice.confirmCooldown || 220
    };
  }

  _decideChoiceAction(choice: AnyRecord) {
    const choiceId = choice.id || `choice-${choice.type || 'generic'}`;
    let memory = this.choiceMemory.get(choiceId);
    if (!memory) {
      memory = this._planChoiceNavigation(choice);
      this.choiceMemory.set(choiceId, memory);
    }
    if (Array.isArray(memory.moves) && memory.moves.length > 0) {
      const direction = memory.moves.shift();
      if (!direction) {
        return {
          type: 'dialog',
          payload: { action: 'advance', cooldownMs: 200 }
        };
      }
      return {
        type: 'dialog',
        payload: {
          action: 'none',
          direction,
          cooldownMs: 160
        }
      };
    }
    this.choiceMemory.delete(choiceId);
    return {
      type: 'dialog',
      payload: {
        action: memory.confirmAction || 'advance',
        cooldownMs: memory.confirmCooldown || 220
      }
    };
  }

  async _decideWithLLM(summary: AnyRecord) {
    if (!summary) {
      return null;
    }
    const dialogStatus = summary.dialog?.status;
    const latestLine = summary.dialog?.latest;
    const recentDialogTs = latestLine && Number.isFinite(latestLine.timestamp) ? latestLine.timestamp : null;
    const recentDialogActive = !!(recentDialogTs && Date.now() - recentDialogTs < 1500);
    if ((dialogStatus && (dialogStatus.awaitingInput || dialogStatus.needsAdvance || dialogStatus.active)) || recentDialogActive) {
      return null;
    }
    try {
      const knowledge = await this._retrieveKnowledge(summary);
      const displayKnowledge = knowledge && knowledge.length ? [knowledge[0]] : [];
      if (displayKnowledge.length) {
        this._logLLM('knowledge', displayKnowledge);
      }
      const prompt = this._buildLLMPrompt(summary, displayKnowledge);
      this._logLLM('prompt', prompt);
      const raw = await runQwen({ prompt, model: this.llmModel });
      this._logLLM('response', raw);
      const parsed = parseLLMResponse(raw);
      return this._normaliseLLMAction(parsed);
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ai-controller] LLM decision failed', err);
      }
      return null;
    }
  }

  _normaliseLLMAction(candidate: LLMAction) {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }
    const allowed = new Set([
      'move',
      'interact',
      'startBattle',
      'useItem',
      'castMagic',
      'openMenu',
      'saveGame',
      'dialog',
      'battleCommand'
    ]);
    const type = typeof candidate.action === 'string'
      ? candidate.action
      : (typeof candidate.type === 'string' ? candidate.type : null);
    if (!type || !allowed.has(type)) {
      return null;
    }
    const payload = candidate.payload && typeof candidate.payload === 'object' ? { ...candidate.payload } : {};
    const cooldown = Number(candidate.cooldownMs);
    if (Number.isFinite(cooldown)) {
      payload.cooldownMs = cooldown;
    }
    if (type === 'move') {
      const dir = Number(payload.direction);
      payload.direction = Number.isFinite(dir) ? ((dir % 4) + 4) % 4 : 0;
    }
    if (type === 'interact') {
      const eventId = Number(payload.eventId);
      if (!Number.isFinite(eventId)) {
        return null;
      }
      payload.eventId = eventId;
    }
    if (type === 'dialog') {
      const dialogAction = typeof payload.action === 'string'
        ? payload.action
        : (typeof payload.mode === 'string' ? payload.mode : 'advance');
      payload.action = dialogAction;
      if (payload.direction && typeof payload.direction !== 'string') {
        delete payload.direction;
      }
    }
    if (type === 'battleCommand' && typeof payload.command !== 'string' && typeof payload.actionType !== 'number') {
      return null;
    }
    return { type, payload };
  }

  _logLLM(direction: string, payload: any) {
    if (!this.logLLM || typeof console === 'undefined' || typeof console.info !== 'function') {
      return;
    }
    console.info(`[ai-controller][llm] ${direction}`, payload);
  }

  async _retrieveKnowledge(summary: AnyRecord) {
    if (!this.enableKnowledge) {
      return [];
    }
    const sceneQuery = this._buildKnowledgeSceneQuery(summary);
    const dialogQuery = this._buildKnowledgeDialogQuery(summary);
    if (!sceneQuery && !dialogQuery) {
      return [];
    }
    try {
      const results = await retrieveKnowledge({
        sceneQuery,
        dialogQuery,
        topK: this.knowledgeTopK,
        minScore: this.minKnowledgeScore,
        embeddingModel: this.embeddingModel
      });
      this.lastKnowledgeEntries = results as AnyRecord[];
      return results;
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ai-controller] knowledge retrieval failed', err);
      }
      return [];
    }
  }

  _buildKnowledgeSceneQuery(summary: AnyRecord) {
    if (!summary) {
      return '';
    }
    const pieces: string[] = [];
    const sceneId = worldService && typeof worldService.getSceneId === 'function'
      ? worldService.getSceneId()
      : null;
    if (sceneId != null) {
      pieces.push(`场景编号：${sceneId}`);
    }
    const leader = (summary.party || [])[0];
    if (leader) {
      pieces.push(`主角坐标：(${leader.x || 0}, ${leader.y || 0}) 朝向 ${leader.direction || 0}`);
    }
    if (summary.dialog?.latest?.text) {
      pieces.push(`最新对白：「${summary.dialog.latest.text}」`);
    }
    if (summary.isInBattle && summary.battle) {
      pieces.push(`战斗信息：战场=${summary.battle.fieldId} 敌人数量=${(summary.battle.enemy || []).length}`);
    }
    const recentDialog = (summary.dialog?.history || []).slice(-2).map((entry: AnyRecord) => entry.text).join(' | ');
    if (recentDialog) {
      pieces.push(`对白履历：${recentDialog}`);
    }
    const events = (summary.sceneEvents || []).slice(0, 5).map((entry: AnyRecord) => entry && entry.state
      ? `事件${entry.id} 精灵=${entry.state.spriteId} 位置=(${entry.state.x},${entry.state.y})`
      : null).filter(Boolean);
    if (events.length) {
      pieces.push(`附近事件：${events.join('；')}`);
    }
    return pieces.join('\n').trim();
  }

  _buildKnowledgeDialogQuery(summary: AnyRecord) {
    if (!summary || !summary.dialog) {
      return '';
    }
    const parts: string[] = [];
    if (summary.dialog.latest?.text) {
      parts.push(summary.dialog.latest.text);
    }
    const history = (summary.dialog.history || []).map((entry: AnyRecord) => entry.text).filter(Boolean);
    if (history.length) {
      parts.push(...history.slice(-3));
    }
    if (summary.dialog.choice) {
      const choice = summary.dialog.choice;
      const options = Array.isArray(choice.options)
        ? choice.options.map((opt: AnyRecord) => opt.label || opt.text).filter(Boolean)
        : [];
      parts.push(`当前选项：${choice.type || choice.id || '未知'} -> ${options.join(' | ')}`);
    }
    return parts.join('\n').trim();
  }

  _buildLLMPrompt(summary: AnyRecord, knowledge: AnyRecord[] = []) {
    const leader = (summary.party || [])[0] || {};
    const events = (summary.sceneEvents || []).slice(0, 5).map((entry: AnyRecord) => {
      if (!entry || !entry.state) {
        return null;
      }
      const dx = (entry.state.x || 0) - (leader.x || 0);
      const dy = (entry.state.y || 0) - (leader.y || 0);
      return `- Event ${entry.id} at (${entry.state.x}, ${entry.state.y}) dx=${dx} dy=${dy} trigger=${entry.state.triggerScript || 0}`;
    }).filter(Boolean).join('\n') || '- None within sample window';

    const battle = summary.battle;
    let battleSection = 'Battle: none';
    if (battle) {
      const playerStatus = (battle.player || []).slice(0, 3).map((p: AnyRecord, idx: number) => {
        if (!p) return null;
        return `P${idx} hp=${p.hp}/${p.maxHp} mp=${p.mp}/${p.maxMp}`;
      }).filter(Boolean).join('; ');
      const enemyStatus = (battle.enemy || []).slice(0, 3).map((e: AnyRecord, idx: number) => {
        if (!e) return null;
        return `E${idx} hp=${e.hp || e.prevHP || 0}`;
      }).filter(Boolean).join('; ');
      battleSection = `Battle field=${battle.fieldId ?? 'n/a'}, players:[${playerStatus || 'n/a'}], enemies:[${enemyStatus || 'n/a'}]`;
    }

    const partyStats = (summary.playerStats || []).map((p: AnyRecord, idx: number) => `P${idx} role=${p.roleId} hp=${p.hp}/${p.maxHp} mp=${p.mp}/${p.maxMp} status=${p.status}`).join('; ') || 'n/a';
    const flags = summary.flags || {};
    const dialogStatus = summary.dialog?.status?.mode || 'idle';
    const dialogHistory = (summary.dialog?.history || []).slice(-3).map((entry: AnyRecord) => {
      if (!entry || !entry.text) {
        return null;
      }
      return `- ${entry.text}`;
    }).filter(Boolean).join('\n') || '- None';
    const pendingChoice = summary.dialog?.choice
      ? `Pending choice: ${summary.dialog.choice.type || 'unknown'}`
      : 'Pending choice: none';
    const lastChoice = summary.dialog?.lastChoice
      ? `Last choice: ${summary.dialog.lastChoice.text} at ${new Date(summary.dialog.lastChoice.timestamp).toLocaleTimeString()}`
      : 'Last choice: n/a';
    const knowledgeSection = Array.isArray(knowledge) && knowledge.length
      ? knowledge.map((entry: AnyRecord, idx: number) => {
        const title = entry.metadata?.title || entry.metadata?.kind || entry.kind || entry.source || entry.id || `chunk-${idx + 1}`;
        const text = entry.text && entry.text.length > 600 ? `${entry.text.slice(0, 600)}…` : entry.text || '';
        const score = typeof entry.score === 'number' ? entry.score.toFixed(2) : 'n/a';
        return `#${idx + 1} (${score}) ${title}\n${text}`;
      }).join('\n\n')
      : 'None';

    const needsAdvance = summary.dialog?.status?.needsAdvance ? '是' : '否';

    return [
      '你正在操控《仙剑奇侠传》游戏的主角一行，请依据下列信息决定下一步行动。',
      '阅读下方参考知识，先推导当前任务（如：端酒菜、寻找 NPC 等），再根据任务选择最合适的动作。严禁忽视对白阶段对白的推进。',
      '仅允许以下动作，务必以 JSON 输出（示例 {"action":"move","payload":{"direction":1,"cooldownMs":300}}）：',
      '- move → {"direction":数字}，0=北、1=东、2=南、3=西。',
      '- interact → {"eventId":数字}，用于与事件交互。',
      '- startBattle → {"formationId":数字}。',
      '- useItem → {"itemId":数字,"targetIndex":数字}。',
      '- castMagic → {"magicId":数字,"casterIndex":数字,"targetIndex":数字}。',
      '- battleCommand → {"command":"attack|magic|defend|useItem|throwItem|flee","targetType":"enemy|ally","targetIndex":数字,"applyAll":布尔,"objectId":数字?}。',
      '- openMenu → {"menu":字符串}。',
      '- saveGame → {"slot":数字}。',
      '- dialog → {"action":"advance|confirm|cancel|none","direction":可选方向,"cooldownMs":数字}。',
      '- 若对白状态为 dialog/choice，必须先完成对白（使用 dialog 指令），否则禁止执行移动、战斗或其他操作，直到对白结束。',
      '严禁添加解释或多余文字。',
      '',
      `时间轴 tick：${summary.ticks}`,
      `主角位置：(${leader.x || 0}, ${leader.y || 0}) 朝向 ${leader.direction || 0}`,
      `队伍状态：${partyStats}`,
      `全局旗标：collect=${flags.collect} chaseRange=${flags.chaseRange} chaseCycles=${flags.chaseCycles} battleSpeed=${flags.battleSpeed}`,
      `视窗偏移：${summary.viewport}`,
      `随从数量：${summary.followers}`,
      `对白状态：${dialogStatus}，需要继续对白：${needsAdvance}`,
      '附近事件：',
      events,
      `战斗信息：${battleSection}`,
      '近期对白：',
      dialogHistory,
      pendingChoice,
      lastChoice,
      '参考知识：',
      knowledgeSection
    ].join('\n');
  }
}

function resolveLLMPreference() {
  const configuredModel = normalizeLLMModel((config as AnyRecord) && (config as AnyRecord).llmModel);
  if (typeof window === 'undefined') {
    return {
      enabled: !!configuredModel,
      model: configuredModel
    };
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('llm');
    const model = normalizeLLMModel(raw) || configuredModel;
    return {
      enabled: !!model,
      model
    };
  } catch {
    return {
      enabled: !!configuredModel,
      model: configuredModel
    };
  }
}

function normalizeLLMModel(value: any) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === 'qwen') {
    return DEFAULT_LLM_MODEL;
  }
  return normalized;
}

let controllerInstance: AIController | null = null;

export async function bootstrapAI(options: AIControllerOptions = {}) {
  if (controllerInstance) {
    return controllerInstance;
  }
  controllerInstance = new AIController(options);
  await controllerInstance.start();
  if (typeof window !== 'undefined') {
    (window as any).AI_CONTROLLER = controllerInstance;
  }
  if (options.logStart && typeof console !== 'undefined' && console.info) {
    console.info('[ai-controller] AI bootstrap complete');
  }
  return controllerInstance;
}

export function shutdownAI() {
  if (!controllerInstance) {
    return;
  }
  controllerInstance.stop();
  controllerInstance = null;
  if (typeof window !== 'undefined' && (window as any).AI_CONTROLLER) {
    delete (window as any).AI_CONTROLLER;
  }
}

function parseLLMResponse(rawText: string) {
  if (!rawText) {
    return null;
  }
  let trimmed = rawText.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
