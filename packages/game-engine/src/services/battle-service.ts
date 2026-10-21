import { battleScriptExecution, copyNativeBattleScriptContext } from './battle-script-execution';
import type { ScriptRunner } from './script-runner';
import type { ScriptExecutionFrame } from './script-execution-runtime';
import { battleCommandRuntime } from './battle-command-runtime';
import EventBus from './event-bus.js';
import { battleSnapshot, battleStateHash } from './battle-snapshot.js';
import { BattleEventLog, type BattleEvent, type BattleView } from './battle-events.js';
import {
  BattleCommandsComponent, ACTION_FIELDS, actionState, sameAction, samePrompt, emptyCommands, commandHashView,
  type ActionState, type BattleCommandsState, type CommandChoice, type PromptIdentity
} from '../ecs/components/battle-commands.js';
import { validateChoice, type CommandRuleDeps } from './battle-command-rules.js';
import { hashString, stableStringify } from '../ecs/world-writer.js';
import { random } from './random.js';
import stateService from './state-service.js';
import worldService from './world-service';
import scriptService from './script-service.js';
import co from '../js/pal/co';
import type { PalGlobal, PlayerRoles } from '../types/pal.js';

declare const GameData: { playerRoles?: any; [key: string]: any } | undefined;
declare const randomLong: ((min: number, max: number) => number) | undefined;
declare const Const: { MAX_LEVELS?: number } | undefined;
declare const global: any;
declare const BattleActionType: { [key: string]: number } | undefined;
import {
  getPlayerRolesSnapshot,
  getPlayerHP,
  getPlayerMP,
  getPlayerLevel,
  getPlayerMaxHP,
  getPlayerMaxMP,
  getPlayerAttackStrength,
  getPlayerMagicStrength,
  getPlayerDefense,
  getPlayerDexterity,
  getPlayerFleeRate,
  getPlayerStatusRow,
  getMaxPartyMemberIndex
} from './player-state-adapter.js';
import partyTrailAdapter from './party-trail-adapter.js';
import { getExpStateSnapshot } from './game-data-adapter.js';
import {
  createEntityRegistry,
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
  createUIStateComponent
} from '../ecs/index.js';
import { autoBattleStream, getAutoBattleValue } from '../state/slices/auto-battle.js';
import { updateBattleFlagsFromState, resetBattleFlagsSlice } from '../state/slices/battle-flags.js';

/** 没注入 epoch 时的默认上下文编号(进程内递增) */
let commandContextCounter = 0;

function getBattleActionEnum(): Record<string, number> | null {
  const globalThisAny: unknown = typeof globalThis !== 'undefined' ? (globalThis as any) : null;
  const globalAny: unknown = typeof global !== 'undefined' ? (global as any) : null;
  if (typeof BattleActionType !== 'undefined' && BattleActionType) {
    return BattleActionType;
  }
  if (globalThisAny && (globalThisAny as any).BattleActionType) {
    return (globalThisAny as any).BattleActionType as Record<string, number>;
  }
  if (globalAny && (globalAny as any).BattleActionType) {
    return (globalAny as any).BattleActionType as Record<string, number>;
  }
  return null;
}

function ensureGameGlobal(): PalGlobal | null {
  let store = stateService.getGlobal<PalGlobal>();
  if (store) return store;
  const globalThisAny: any = typeof globalThis !== 'undefined' ? (globalThis as any) : null;
  if (globalThisAny) {
    globalThisAny.Global = globalThisAny.Global || {};
    store = globalThisAny.Global;
  } else if (typeof global !== 'undefined') {
    const globalAny = global as any;
    globalAny.Global = globalAny.Global || {};
    store = globalAny.Global;
  }
  return store || null;
}

function getPartySnapshot() {
  // TODO(rxjs-cleanup): remove worldService party fallback once party slice is authoritative.
  const fallback = worldService.getParty();
  const party = partyTrailAdapter.getPartyState();
  const globalParty = stateService.getGlobal('party');
  if (Array.isArray(party) && party.length > 0 && party.length >= (Array.isArray(fallback) ? fallback.length : 0)) {
    return party;
  }
  if (Array.isArray(fallback) && fallback.length > 0) {
    return fallback;
  }
  if (Array.isArray(globalParty) && globalParty.length > 0) {
    return globalParty;
  }
  return Array.isArray(party) ? party : [];
}

function getAutoBattleFlag() {
  return !!getAutoBattleValue(false);
}

type UpdateOptions = { emit?: boolean };
type DamageOptions = { isBoss?: boolean; boss?: boolean; emit?: boolean };
type MagicOptions = { magicId?: number; casterIndex?: number; targetIndex?: number; emit?: boolean };
type ValueOrUpdater<T> = T | ((prev: T) => T);
type PlayerIndex = number;
type EnemyIndex = number;
type QueueIndex = number;
type StateMutator<T> = (current: T) => T;
type Path = string | number | Array<string | number>;
type UnknownRecord = { [key: string]: any; [key: number]: any };
type BattleState = {
  enemyMoving?: boolean;
  player?: PlayerState[];
  enemy?: EnemyState[];
  actionQueue?: Record<string, unknown>[];
  UI?: UIState;
  primaryExp?: Record<string, any>;
  [key: string]: any;
  [key: number]: any;
};
type ExpBucket = { exp?: number; level?: number; count?: number };
type ExpState = {
  __raw__?: BattleState;
  primaryExp?: Record<string, ExpBucket>;
  healthExp?: Record<string, ExpBucket>;
  magicExp?: Record<string, ExpBucket>;
  attackExp?: Record<string, ExpBucket>;
  magicPowerExp?: Record<string, ExpBucket>;
  defenseExp?: Record<string, ExpBucket>;
  dexterityExp?: Record<string, ExpBucket>;
  fleeExp?: Record<string, ExpBucket>;
  [key: string]: Record<string, ExpBucket> | ExpBucket | BattleState | undefined;
};
type BattleContext = Record<string, unknown>;

type EnemyState = {
  e?: {
    health?: number;
    magic?: number;
    magicRate?: number;
    idleFrames?: number;
    idleAnimSpeed?: number;
    maxHealth?: number;
  };
  status?: number[];
  poisons?: Array<Record<string, unknown>>;
  pos?: number | null;
  originalPos?: number | null;
  colorShift?: unknown;
  objectID?: number;
  wCurrentFrame?: number;
  currentFrame?: number | null;
  sprite?: unknown;
  action?: unknown;
};

type PlayerState = {
  action?: { actionType?: number | string };
  colorShift?: unknown;
  pos?: number | null;
  originalPos?: number | null;
  sprite?: unknown;
  currentFrame?: number | null;
};

type UIState = {
  state?: unknown;
  menuState?: unknown;
  curPlayerIndex?: number | null;
  selectedAction?: unknown;
  selectedIndex?: number | null;
  [key: string]: unknown;
};

type StateMutatedPayload = {
  path: Array<string | number | symbol>;
  value: unknown;
  previous: unknown;
  state: BattleState | null;
  deleted?: boolean;
};

type StateChangedPayload = {
  previous: BattleState | null;
  state: BattleState | null;
};

type SystemManager = {
  run?: (phase: string, context: BattleContext) => void;
  runPipeline?: (phases: string[], context: BattleContext) => void;
  runGenerator?: (phase: string, context: BattleContext) => IterableIterator<unknown>;
  runTick?: (context: BattleContext) => IterableIterator<unknown> | void;
  fire?: (event: string, payload: StateChangedPayload | StateMutatedPayload) => void;
  onStateChanged?: (payload: StateChangedPayload) => void;
  onStateMutated?: (payload: StateMutatedPayload) => void;
} | null;

type EcsRegistry = {
  createEntity: (...args: any[]) => any;
  addComponent: (entity: any, component: any, data: any) => void;
  getComponent: (entity: any, component: any) => any;
  hasEntity?: (entity: any) => boolean;
  destroyEntity?: (entity: any) => void;
  clear: () => void;
};

class BattleService extends EventBus {
  module: Record<string, unknown> | null;
  rawState: BattleState | null;
  state: BattleState | null;
  _globalAccessorInstalled: boolean;
  _proxyCache: WeakMap<object, any>;
  ecs: EcsRegistry;
  entityMaps: {
    player: Map<number, PlayerState>;
    enemy: Map<number, EnemyState>;
    queue: Map<number, unknown>;
    ui: unknown;
  };
  systemManager: SystemManager;
  _autoBattleSubscription: { unsubscribe?: () => void } | (() => void) | null;
  _activeBattleTask: Promise<unknown> | null;

  constructor() {
    super();
    this.module = null;
    this.rawState = null;
    this.state = null;
    this._globalAccessorInstalled = false;
    this._proxyCache = new WeakMap();
    this.ecs = createEntityRegistry() as unknown as EcsRegistry;
    this.entityMaps = {
      player: new Map(),
      enemy: new Map(),
      queue: new Map(),
      ui: null
    };
    this.systemManager = null;
    this._autoBattleSubscription = null;
    this._ensureAutoBattleSubscription();
    resetBattleFlagsSlice();
    this._activeBattleTask = null;
  }

  bindModule(moduleRef: Record<string, unknown>) {
    if (this.module === moduleRef) {
      this._installGlobalAccessor();
      this._syncStateFromGlobal();
      return;
    }
    this.module = moduleRef;
    this._installGlobalAccessor();
    this._syncStateFromGlobal();
  }

  _ensureAutoBattleSubscription() {
    if (this._autoBattleSubscription) {
      if (typeof (this._autoBattleSubscription as any).unsubscribe === 'function') {
        (this._autoBattleSubscription as { unsubscribe: () => void }).unsubscribe();
      } else if (typeof this._autoBattleSubscription === 'function') {
        this._autoBattleSubscription();
      }
    }
    const stream = autoBattleStream();
    if (stream && typeof stream.subscribe === 'function') {
      this._autoBattleSubscription = stream.subscribe(() => {
        this.syncUIComponent();
      });
    }
  }

  _syncStateFromGlobal() {
    const gameGlobal = stateService.getGlobal<PalGlobal>();
    const battleState = gameGlobal && gameGlobal.battle;
    if (battleState && this.rawState !== (battleState as any).__raw__) {
      this.rawState = (battleState as any).__raw__ || battleState;
      this.state = battleState as BattleState;
      this._syncBattleFlags('battleService:syncFromGlobal');
    }
    return this.state;
  }

  _wrapState<T extends Record<string, unknown>>(target: T): T {
    if (!target || typeof target !== 'object') {
      return target;
    }
    const service = this;
    const cache = new WeakMap();

    const isTypedArray = (value: unknown) => ArrayBuffer.isView(value as ArrayBufferView) && !(value instanceof DataView);
    const unwrapProxy = (value: any) => {
      let raw = value;
      while (raw && typeof raw === 'object' && !isTypedArray(raw)) {
        const inner = raw.__raw__;
        if (!inner || inner === raw) break;
        raw = inner;
      }
      return raw;
    };

    function wrap(obj: any, path: (string | number | symbol)[]) {
      if (!obj || typeof obj !== 'object' || isTypedArray(obj)) {
        return obj;
      }
      if (cache.has(obj)) {
        return cache.get(obj);
      }
      const proxy = new Proxy(obj, {
        get(t, prop, receiver) {
          if (prop === '__raw__') {
            return obj;
          }
          const value = Reflect.get(t, prop, receiver);
          if (typeof value === 'function') {
            return value.bind(t);
          }
          return wrap(value, path.concat(prop));
        },
        set(t, prop, value, receiver) {
          const previous = t[prop];
          // 写回前解包:读出来的是代理,原样存进原始状态的话,下次读会在代理外再包一层。
          // set()/setPlayer 的 mutator 惯常 `return patch(player) || player`,每回合多套一层,
          // 每次读要穿过所有层 —— 战斗帧耗时随回合指数增长(第 14 回合 7.7s/帧)。
          value = unwrapProxy(value);
          const result = Reflect.set(t, prop, value, receiver);
      const payload: StateMutatedPayload = {
        path: path.concat(prop),
        value,
        previous,
        state: service.state
      };
      battleCommandRuntime.checkPark();
      service.fire('stateMutated', payload);
      if (service.systemManager && typeof service.systemManager.onStateMutated === 'function') {
        service.systemManager.onStateMutated(payload);
      }
      return result;
      },
      deleteProperty(t, prop) {
        const previous = t[prop];
        const result = Reflect.deleteProperty(t, prop);
        const payload: StateMutatedPayload = {
          path: path.concat(prop),
          value: undefined,
          previous,
          state: service.state,
          deleted: true
        };
        battleCommandRuntime.checkPark();
        service.fire('stateMutated', payload);
        if (service.systemManager && typeof service.systemManager.onStateMutated === 'function') {
          service.systemManager.onStateMutated(payload);
        }
        return result;
      }
    });
      cache.set(obj, proxy);
      return proxy;
    }

    this._proxyCache = cache;
    return wrap(target, []);
  }

  _installGlobalAccessor() {
    const gameGlobal = ensureGameGlobal();
    if (!gameGlobal || this._globalAccessorInstalled) {
      return;
    }
    const service = this;
    let backingValue = stateService.getGlobal('battle') || this.state || null;

    Object.defineProperty(gameGlobal, 'battle', {
      configurable: true,
      enumerable: true,
      get() {
        return service.state || backingValue;
      },
      set(nextState) {
        battleCommandRuntime.invalidate('raw battle replaced');
        battleScriptExecution.invalidate(true);
        const previous = service.state || backingValue || null;
        service.rawState = nextState;
        service.state = service._wrapState(nextState);
        backingValue = service.state;
        service._syncBattleFlags('battleService:globalAccessor');
        const payload = { previous, state: service.state };
        service.fire('stateChanged', payload);
        if (service.systemManager && typeof service.systemManager.onStateChanged === 'function') {
          service.systemManager.onStateChanged(payload);
        }
      }
    });

    this._globalAccessorInstalled = true;
    if (backingValue && !this.state) {
      const raw = (backingValue as { __raw__?: BattleState }).__raw__;
      this.rawState = raw || backingValue;
      this.state = backingValue;
      this._syncBattleFlags('battleService:globalAccessor');
    }
  }

  fire(event: string, payload?: StateChangedPayload | StateMutatedPayload | Record<string, unknown>): unknown {
    return super.fire(event, payload);
  }

  getModule() {
    return this.module;
  }

  getState(): BattleState | null {
    if (this.state) {
      return this.state;
    }
    if (this.rawState) {
      this.state = this._wrapState(this.rawState);
      return this.state;
    }
    this._syncStateFromGlobal();
    if (this.state) {
      return this.state;
    }
    return null;
  }

  isInBattle(): boolean {
    return worldService.isInBattle();
  }

  isEnemyMoving(): boolean {
    return !!this.getState()?.enemyMoving;
  }

  // ---- 战斗指令组件(M5 C1b,docs/specs/agent-pal-m5-command.md)---------------------------------------
  // committed / previous 以组件为真;player[i].action / prevAction 是投影。写者先写组件,再执行原有的赋值语句完成投影
  // (状态代理对每次字段赋值都发 stateMutated,所以原有赋值的顺序与次数原样保留)。

  /** 组件只读原件;还没有就建一份空的 */
  getCommands(): Readonly<BattleCommandsState> {
    const w = worldService.getWorldWriter();
    // set() 返回的是可改的副本:初始化后再 peek,保证每次给出的都是组件里冻结的原件
    if (!w.peek(w.world(), BattleCommandsComponent)) w.set(w.world(), BattleCommandsComponent, emptyCommands(this._commandContext));
    return w.peek(w.world(), BattleCommandsComponent)!;
  }

  /** 改组件的若干字段(其余沿用当前值) */
  private _patchCommands(patch: Partial<BattleCommandsState>) {
    const w = worldService.getWorldWriter();
    w.set(w.world(), BattleCommandsComponent, { ...this.getCommands(), ...patch } as BattleCommandsState);
  }

  /**
   * 开战的导入边界:建战斗状态 / 开战初始化(BattlePlayer.reset、target = -1)写的是旧结构,这里把各槽位此刻的
   * action / prevAction 收进组件,之后的写入都先经组件。
   */
  importCommitted() {
    const st: any = this.getState();
    const players: any[] = st && Array.isArray(st.player) ? st.player : [];
    this._patchCommands({
      committed: players.map((p) => actionState(p && p.action)),
      previous: players.map((p) => actionState(p && p.prevAction)),
      open: null, pending: null, autoRequest: null            // 新的一场:上一场没关掉的提示一并作废
    });
    this._acceptedActor = null;
  }

  /** 改槽位 member 的当前动作(逐字段补丁):只写组件,返回新值;调用方随后用原有的赋值语句投影到 player[member].action */
  writeCommitted(member: number, patch: Partial<ActionState>): ActionState {
    const cur = this.getCommands();
    const base = cur.committed[member] ?? actionState((this.getState() as any)?.player?.[member]?.action) ?? { actionType: 0, actionID: 0, target: 0, remainingTime: 0 };
    const next: ActionState = { ...base };
    for (const f of ACTION_FIELDS) if (patch[f] !== undefined) next[f] = Number(patch[f]);
    if (cur.committed[member] && sameAction(cur.committed[member], next)) return next;
    const committed = cur.committed.slice();
    while (committed.length <= member) committed.push(null);
    committed[member] = next;
    this._patchCommands({ committed });
    return next;
  }

  /** 把槽位 member 的当前动作备份成「上一行动」(repeat 的来源):只写组件,返回备份的副本(没有当前动作返回 null) */
  backupPrevious(member: number): ActionState | null {
    const cur = this.getCommands();
    const source = cur.committed[member];
    if (!source) return null;
    const copy: ActionState = { ...source };
    if (!sameAction(cur.previous[member], copy)) {
      const previous = cur.previous.slice();
      while (previous.length <= member) previous.push(null);
      previous[member] = copy;
      this._patchCommands({ previous });
    }
    return { ...copy };
  }


  // ---- 提示身份 / 待提交回应(M5 C2,docs/specs/agent-pal-m5-command.md §4)---------------------------------
  // 写 pending / autoRequest 不产生任何游戏效果;消费(accept → commitCommand / setAutoBattle)由执行层在 M5b 接线,
  // 这期生产上没有调用方。

  /** 运行 / 恢复上下文的 epoch。没注入时的默认值只保证同一进程内不重复(不承诺跨运行唯一) */
  private _commandContext = `local:${++commandContextCounter}`;
  /** 转换期:这个槽位的提示已被接受 / 取消,在它离开选指令之前不自动重开(M5b 接手后由调度器的等待自己开关) */
  private _acceptedActor: { member: number; role: number } | null = null;

  /** 运行层注入上下文 epoch:换了就关闭当前提示,旧身份一律 stale */
  setCommandContext(epoch: string) {
    if (typeof epoch !== 'string' || !epoch) throw new Error('setCommandContext: epoch must be a non-empty string');
    if (epoch === this._commandContext && this.getCommands().context === epoch) return;
    battleCommandRuntime.invalidate('command context changed');
    battleScriptExecution.invalidate();
    this._commandContext = epoch;
    this._patchCommands({ context: epoch, open: null, pending: null, autoRequest: null });
    this._acceptedActor = null;
  }

  getOpenPrompt(): Readonly<PromptIdentity> | null {
    return this.getCommands().open;
  }

  /** 开放一次新的可提交等待(修订号加一);已有开放的提示先关掉。promptEvent 是 B3 日志里对应事件的 seq(关联信息) */
  openPrompt(member: number, promptEvent?: number): PromptIdentity {
    const cur = this.getCommands();
    const party: any = worldService._partyView();
    const role = Number(party?.members?.[member]?.playerRole);
    const open: PromptIdentity = {
      context: cur.context, battle: this._eventLog.battle, revision: cur.revision + 1, member, role: Number.isInteger(role) ? role : -1,
      ...(promptEvent != null ? { promptEvent } : {})
    };
    this._patchCommands({ revision: open.revision, open, pending: null, autoRequest: null });
    this._acceptedActor = null;
    return { ...open };
  }

  /** Called only by the native owned parent, before BCE freezes its payload. */
  publishOwnedPrompt(prompt: PromptIdentity, kind: 'battle.command' | 'battle.auto-mode' = 'battle.command'): PromptIdentity {
    const open = this.getOpenPrompt();
    if (!battleCommandRuntime.owned || !open || !samePrompt(open, prompt)) throw new Error('owned prompt changed before publication');
    // A mode identity anchors its parent; it never advertises a fighter command.
    // Native frame logging still records completed HP/gone changes.
    if (kind === 'battle.auto-mode') return { ...open };
    const seq = this._eventLog.ownedPrompt(open.member, open.role, open.revision, this._battleView());
    if (seq != null) this._patchCommands({ open: { ...open, promptEvent: seq } });
    return { ...this.getOpenPrompt()! };
  }

  /** 关闭当前提示:open / pending / autoRequest 都清;旧身份此后永不再有效 */
  closePrompt() {
    const cur = this.getCommands();
    if (cur.open || cur.pending || cur.autoRequest) this._patchCommands({ open: null, pending: null, autoRequest: null });
  }

  /** 撤回已接受未消费的回应(指令或自动请求)= 关闭这个提示;要再收须 openPrompt(新修订号) */
  cancelPending(id: PromptIdentity): { ok: boolean } {
    const cur = this.getCommands();
    if (this._identityProblem(id) || !(cur.pending || cur.autoRequest)) return { ok: false };
    this._acceptedActor = cur.open ? { member: cur.open.member, role: cur.open.role } : null;
    this.closePrompt();
    return { ok: true };
  }

  /** Only active party slots authorize actors; cached inactive members do not. */
  private _livePromptRole(member: number): number | null {
    const party: any = worldService._partyView();
    if (!Number.isInteger(member) || member < 0 || member > party?.maxIndex) return null;
    const role = Number(party?.members?.[member]?.playerRole);
    return Number.isInteger(role) && role >= 0 ? role : null;
  }

  /** 身份与当前开放的提示是否一致;一致返回 null */
  private _identityProblem(id: PromptIdentity): { reason: 'stale' | 'wrong-actor'; note: string } | null {
    const cur = this.getCommands();
    const open = cur.open;
    if (!id || typeof id !== 'object') return { reason: 'stale', note: 'an identity is required' };
    if (id.context !== cur.context) return { reason: 'stale', note: 'this identity belongs to another run / restore context' };
    if (!open) return { reason: 'stale', note: 'no prompt is open' };
    if (id.battle !== open.battle || id.revision !== open.revision) return { reason: 'stale', note: `this prompt is no longer open (open: battle ${open.battle} revision ${open.revision})` };
    if (this._livePromptRole(open.member) !== open.role) return { reason: 'stale', note: 'the prompted actor is no longer in this active party slot' };
    if (id.member !== open.member || id.role !== open.role) return { reason: 'wrong-actor', note: `the open prompt is for member ${open.member} (role ${open.role})` };
    return null;
  }

  /** 这次等待是否已经接受过一个回应(指令与自动请求互斥) */
  private _busyNote(): string | null {
    const cur = this.getCommands();
    return cur.pending ? 'a command was already accepted for this prompt' : cur.autoRequest ? 'an auto-battle request was already accepted for this prompt' : null;
  }

  /** 校验规则读游戏数据的口子(只读) */
  private _commandRuleDeps(open: PromptIdentity): CommandRuleDeps {
    const g: any = globalThis as any;
    const T = getBattleActionEnum() || ({} as any);
    const MF = g.MagicFlag || {}, IF = g.ItemFlag || {};
    const st: any = this.getState() || {};
    const roles: any = stateService.getGameData('playerRoles') || {};
    const objects: any = stateService.getGameData('object') || [];
    const party: any = worldService._partyView();
    const inventory: any = worldService._inventoryView();
    const magicFlags = (id: number) => Number(objects[id]?.magic?.flags) || 0;
    const available: CommandRuleDeps['available'] = (kind) => {
      if (this._livePromptRole(open.member) !== open.role) return false;
      if (kind === 'attack') return true;
      if (kind === 'magic') return (Number(getPlayerStatusRow(open.role)[g.PlayerStatus?.Silence]) || 0) === 0;
      // Native's role-based health helper reads HP/maxHP/status only. Preserve its receiver
      // and count active slots exactly as the Native GUI does, without changing UI.curPlayerIndex.
      const battle = g.uibattle?.battle;
      if (typeof battle?.isPlayerHealthy !== 'function') return false;
      let healthyCount = 0;
      for (let i = 0; i <= party.maxIndex; i++) {
        const member = party.members[i];
        if (member && battle.isPlayerHealthy(member.playerRole)) healthyCount++;
      }
      return !!battle.isPlayerHealthy(open.role) && healthyCount > 1;
    };
    return {
      types: { Pass: T.Pass, Defend: T.Defend, Attack: T.Attack, Magic: T.Magic, CoopMagic: T.CoopMagic, Flee: T.Flee, ThrowItem: T.ThrowItem, UseItem: T.UseItem },
      flags: {
        magicUsableInBattle: MF.UsableInBattle, magicToEnemy: MF.UsableToEnemy, magicApplyToAll: MF.ApplyToAll,
        itemUsable: IF.Usable, itemThrowable: IF.Throwable, itemApplyToAll: IF.ApplyToAll
      },
      available,
      enemyAlive: (index) => { const x = st.enemy?.[index]; return !!(x && x.objectID && (Number(x.e?.health) || 0) > 0); },
      partySize: (Number(party?.maxIndex) || 0) + 1,
      magic: (id) => {
        const slots: any[] = Array.isArray(roles.magic) ? roles.magic : [];
        return id > 0 && slots.some((slot) => slot && Number(slot[open.role]) === id) ? { flags: magicFlags(id) } : null;
      },
      coop: () => {
        // 同 script-runner 的 getPlayerCooperativeMagic:角色自己的合擊仙术,被装备加成表里最后一个非零项覆盖。
        // 直接读数据(脚本解释器是模块、不在全局上;装备加成的 getter 有写副作用,不经它)
        let id = Number(roles.cooperativeMagic?.[open.role]) || 0;
        const effects: any = stateService.getGlobal('equipmentEffect');
        if (Array.isArray(effects)) {
          for (const effect of effects) {
            const over = Number(effect?.cooperativeMagic?.[open.role]) || 0;
            if (over) id = over;
          }
        }
        return id ? { id, flags: magicFlags(id) } : null;
      },
      item: (id) => {
        const slot = (inventory?.slots || []).find((x: any) => x && x.item === id && x.amount > 0);
        return slot ? { flags: Number(objects[id]?.item?.flags) || 0, free: slot.amount - Math.max(0, slot.amountInUse) } : null;
      }
    };
  }

  /**
   * 外部回应:提交一条指令。只写 pending —— 不提交、不扣物品 / MP、不改界面与队员状态、不推进帧、不抽随机数。
   * 校验顺序(都在写入之前):stale → wrong-actor → busy → invalid。invalid 不占用身份,合法提交可重试。
   */
  submitCommand(id: PromptIdentity, choice: CommandChoice): { ok: true } | { ok: false; reason: 'stale' | 'wrong-actor' | 'busy' | 'invalid'; note: string } {
    const problem = this._identityProblem(id);
    if (problem) return { ok: false, ...problem };
    const busy = this._busyNote();
    if (busy) return { ok: false, reason: 'busy', note: busy };
    const open = this.getCommands().open!;
    const checked = validateChoice(choice, this._commandRuleDeps(open));
    if (!checked.ok) return { ok: false, reason: 'invalid', note: checked.note };
    this._patchCommands({ pending: { for: { ...open }, choice: checked.choice } });
    return { ok: true };
  }

  /** 外部回应:请求切换自动战斗(模式请求,不是某个队员的指令)。只写 autoRequest,不改 UI.autoAttack */
  requestAutoBattle(id: PromptIdentity, on: boolean): { ok: true } | { ok: false; reason: 'stale' | 'wrong-actor' | 'busy' | 'invalid'; note: string } {
    const problem = this._identityProblem(id);
    if (problem) return { ok: false, ...problem };
    const busy = this._busyNote();
    if (busy) return { ok: false, reason: 'busy', note: busy };
    if (typeof on !== 'boolean') return { ok: false, reason: 'invalid', note: 'on must be a boolean' };
    this._patchCommands({ autoRequest: { for: { ...this.getCommands().open! }, on } });
    return { ok: true };
  }

  /** 接受并关闭(两种 accept 共用):只在有对应的那类请求时成功;成功则关闭提示、两类请求都清 */
  private _accept<K extends 'pending' | 'autoRequest'>(expect: PromptIdentity, kind: K): NonNullable<BattleCommandsState[K]> | null {
    if (this._identityProblem(expect)) return null;
    const cur = this.getCommands();
    const taken = cur[kind];
    if (!taken) return null;                     // 手里是另一种请求(或没有):不关闭、不清
    const detached = JSON.parse(JSON.stringify(taken));
    this._acceptedActor = cur.open ? { member: cur.open.member, role: cur.open.role } : null;
    this._patchCommands({ open: null, pending: null, autoRequest: null });
    return detached;
  }

  /**
   * 执行层的消费:接受并关闭这次等待,取走指令(与组件脱钩的副本)。同步完成,先于任何提交副作用;
   * 之后同一身份的 submit / request 一律 stale、accept 一律 null。提交若抛异常,不会自动重开这个身份。
   */
  acceptPendingCommand(expect: PromptIdentity): CommandChoice | null {
    return this._accept(expect, 'pending')?.choice ?? null;
  }

  acceptAutoRequest(expect: PromptIdentity): { on: boolean } | null {
    const taken = this._accept(expect, 'autoRequest');
    return taken ? { on: taken.on } : null;
  }

  /** 内部即时写口:只改 UI.autoAttack 这个模式位。给消费方 / 现有按键路径用,不作为外部回应入口 */
  setAutoBattle(on: boolean) {
    this.setUI({ autoAttack: !!on });
  }

  /** 完整快照:与组件脱钩的整份数据(含顶层与嵌套的 context / revision)。是数据,不表示可以原样重新授权 */
  getCommandSnapshot(): BattleCommandsState {
    return JSON.parse(JSON.stringify(this.getCommands()));
  }

  /** 规范化视图的哈希:不含任何 context 与关联字段 —— 只有 epoch 不同的两个状态哈希相同 */
  commandHash(): string {
    return hashString(stableStringify(commandHashView(this.getCommands())));
  }

  /**
   * 配对恢复安装(内部接口,M5b 用):装入已校验的动作数据并投影到 player[i].action / prevAction;身份不沿用 ——
   * 关闭当前提示,带了已接受的指令就为它开一个新提示(新修订号、当前 context)并返回新身份。
   * 不接受外来的 context / revision。
   */
  installCommands(data: { committed: Array<ActionState | null>; previous: Array<ActionState | null>; pending?: { member: number; choice: CommandChoice } | null }): PromptIdentity | null {
    battleCommandRuntime.invalidate('command snapshot installation');
    const committed = (data.committed || []).map((a) => actionState(a));
    const previous = (data.previous || []).map((a) => actionState(a));
    this._patchCommands({ committed, previous, open: null, pending: null, autoRequest: null });
    this._acceptedActor = null;
    const st: any = this.getState();
    const players: any[] = st && Array.isArray(st.player) ? st.player : [];
    players.forEach((p, i) => {
      if (!p) return;
      if (committed[i]) { if (p.action) Object.assign(p.action, committed[i]); else p.action = { ...committed[i] }; }
      p.prevAction = previous[i] ? { ...previous[i] } : undefined;
    });
    if (!data.pending) return null;
    const open = this.openPrompt(data.pending.member);
    const checked = validateChoice(data.pending.choice, this._commandRuleDeps(open));
    if (checked.ok) this._patchCommands({ pending: { for: { ...this.getCommands().open! }, choice: checked.choice } });
    return open;
  }

  /** 组件与投影(player[i].action / prevAction)是否逐字段一致;不一致返回第一处的描述(golden --shadow 与测试用) */
  commandsProjectionMismatch(): string | null {
    const st: any = this.getState();
    const players: any[] = st && Array.isArray(st.player) ? st.player : [];
    const cur = this.getCommands();
    for (let i = 0; i < players.length; i++) {
      const live = actionState(players[i] && players[i].action), prev = actionState(players[i] && players[i].prevAction);
      if (!sameAction(cur.committed[i] ?? null, live)) return `committed[${i}] ${JSON.stringify(cur.committed[i] ?? null)} != player.action ${JSON.stringify(live)}`;
      if (!sameAction(cur.previous[i] ?? null, prev)) return `previous[${i}] ${JSON.stringify(cur.previous[i] ?? null)} != player.prevAction ${JSON.stringify(prev)}`;
    }
    return null;
  }

  // ---- 战斗事件日志(M5 B3,见 battle-events.ts):开战 / 每帧之后 / 结束各记一次,纯读 --------------------
  private _eventLog = new BattleEventLog();

  /** 记事件那一刻的战斗视图:敌人取战斗状态,队伍 / 钱取世界组件与角色结构体。只读,不经有副作用的 getter */
  private _battleView(): BattleView {
    const st: any = this.getState() || {};
    const enemies = (Array.isArray(st.enemy) ? st.enemy : [])
      .map((x: any, index: number) => (x ? { index, objectID: Number(x.objectID) || 0, hp: Number(x.e?.health) || 0 } : null))
      .filter(Boolean) as BattleView['enemies'];      // 含已离场的槽位(objectID 0):日志要它离场那一刻的血量
    const partyComp: any = worldService._partyView();          // 组件只读原件(不拷贝);每帧都读,不走整份快照
    const inventory: any = worldService._inventoryView();
    const roles: any = stateService.getGameData('playerRoles') || {};
    const num = (arr: any, i: number) => Number(arr && arr[i]) || 0;
    const members = partyComp ? partyComp.members.slice(0, (partyComp.maxIndex ?? 0) + 1) : [];
    const party = members.map((m: any) => ({ role: m.playerRole, hp: num(roles.HP, m.playerRole), mp: num(roles.MP, m.playerRole), level: num(roles.level, m.playerRole) }));
    const ui = st.UI || {};
    return {
      isBoss: !!st.isBoss,
      enemies,
      party,
      cash: Number(inventory?.cash) || 0,
      promptMember: !ui.autoAttack && ui.state === 1 ? Number(ui.curPlayerIndex) || 0 : null,      // 1 = 选指令
      expGained: Number(st.expGained) || 0,
      cashGained: Number(st.cashGained) || 0
    };
  }

  /** 以下三个由 battle.ts 在开战 / 主循环每帧之后 / 结算之后调用;出错不影响战斗 */
  /** 最近一场战斗若被引擎异常打断,这里是那次异常(下一场开战时清掉);正常结束为 null */
  lastBattleError: { battle: number; message: string; stack: string | null } | null = null;
  /** battle.ts 在吞掉战斗循环的异常时调用:记下来,别让它无声无息 */
  noteBattleError(ex: unknown) {
    const err: any = ex;
    this.lastBattleError = { battle: this._eventLog.battle, message: String(err && err.message ? err.message : err), stack: err && err.stack ? String(err.stack) : null };
  }

  noteBattleStart() { this.lastBattleError = null; try { this._eventLog.start(this._battleView()); this.closePrompt(); this._acceptedActor = null; } catch { /* 只是记录 */ } }
  noteBattleFrame() {
    try {
      const view = this._battleView();
      if (battleCommandRuntime.owned) {
        const prompt = this.getOpenPrompt();
        // Only the captured manual parent can publish an owned fighter prompt.
        // Frame observations record HP/gone without deriving authority from UI.
        this._eventLog.frame({ ...view, promptMember: null, promptRevision: prompt ? prompt.revision : null });
        return;
      }
      // 转换期的提示开关(M5 C2):与 B3 的 prompt 事件同一个观察点。进入选指令 / 换人 → 开放(新修订号);离开选指令 → 关闭。
      // 已被接受 / 取消的那个槽位在离开选指令之前不重开。M5b 接手后由调度器的等待自己开关
      const want = view.promptMember;
      const role = want == null ? null : this._livePromptRole(want);
      const suppressed = want != null && role != null && this._acceptedActor?.member === want && this._acceptedActor.role === role;
      if (!suppressed) this._acceptedActor = null;
      const open = this.getOpenPrompt();
      if (want == null || role == null) {
        this.closePrompt();
      } else if (!suppressed && !(open && open.member === want && open.role === role && open.battle === this._eventLog.battle)) {
        this.openPrompt(want);
      }
      const now = this.getOpenPrompt();
      const promptSeq = this._eventLog.frame({ ...view, promptRevision: now ? now.revision : null });
      if (promptSeq != null && now && now.promptEvent !== promptSeq) this._patchCommands({ open: { ...now, promptEvent: promptSeq } });
    } catch { /* 只是记录 */ }
  }
  noteBattleEnd(result: number) { battleCommandRuntime.invalidate('battle ended'); try { this._eventLog.end(Number(result), this._battleView(), this.lastBattleError ? this.lastBattleError.message : null); this.closePrompt(); this._acceptedActor = null; } catch { /* 只是记录 */ } }

  /** seq 之后的战斗事件(协议层按它出 SMSG_BATTLE_*);lastBattleEventSeq 是当前最新的 seq */
  battleEventsSince(seq: number): BattleEvent[] { return this._eventLog.since(seq); }
  get lastBattleEventSeq(): number { return this._eventLog.lastSeq; }
  /** 当前(或最近一场)战斗的实例编号,与事件里的 battle 一致 */
  get battleInstance(): number { return this._eventLog.battle; }

  /** 战斗状态里可序列化的部分(M5 B1,见 battle-snapshot.ts);纯读 */
  getSnapshot() {
    return battleSnapshot(this.getState());
  }

  /** 战斗快照的哈希;没有战斗状态时为 null */
  stateHash() {
    return battleStateHash(this.getState());
  }

  replaceState(nextState: BattleState) {
    battleCommandRuntime.invalidate('raw battle replaced');
    battleScriptExecution.invalidate(true);
    const gameGlobal = stateService.getGlobal();
    const previous = this.getState();
    if (gameGlobal) {
      if (!this._globalAccessorInstalled) {
        this._installGlobalAccessor();
      }
      const descriptor = Object.getOwnPropertyDescriptor(gameGlobal, 'battle');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(gameGlobal, nextState);
        return this.state;
      }
      this.rawState = nextState;
      this.state = this._wrapState(nextState);
      this._syncBattleFlags('battleService:replaceState');
      stateService.setGlobal('battle', this.state);
      return this.state;
    }
    this.rawState = nextState;
    this.state = this._wrapState(nextState);
    this._syncBattleFlags('battleService:replaceState');
    const payload: StateChangedPayload = { previous: previous as BattleState | null, state: this.state };
    this.fire('stateChanged', payload);
    return this.state;
  }

  updateState(updater: StateMutator<BattleState | null>) {
    const current = this.getState();
    const next = updater ? updater(current) || current : current;
    if (!next) {
      return current;
    }
    if (next !== current) {
      return this.replaceState(next);
    }
    const payload = { previous: current, state: current };
    this.fire('stateChanged', payload);
    if (this.systemManager && typeof this.systemManager.onStateChanged === 'function') {
      this.systemManager.onStateChanged(payload);
    }
    this._syncBattleFlags('battleService:updateState');
    return current;
  }

  getRegistry(): EcsRegistry {
    return this.ecs;
  }

  resetEntityRegistry() {
    this.ecs.clear();
    this.entityMaps.player.clear();
    this.entityMaps.enemy.clear();
    this.entityMaps.queue.clear();
    this.entityMaps.ui = null;
  }

  initialiseBattleEntities() {
    this.resetEntityRegistry();
    this._ensureAutoBattleSubscription();
    const state = this.getState();
    if (!state) {
      return;
    }
    const registry = this.ecs;
    const party = getPartySnapshot();
    const rawMaxPartyMemberIndex = getMaxPartyMemberIndex();
    const maxPartyMemberIndex = Math.max(
      -1,
      Math.min(
        (typeof rawMaxPartyMemberIndex === 'number' && rawMaxPartyMemberIndex >= 0)
          ? rawMaxPartyMemberIndex
          : party.length - 1,
        party.length - 1
      )
    );

    const gameData = typeof GameData !== 'undefined' ? GameData : null;

    for (let idx = 0; idx <= maxPartyMemberIndex; idx++) {
      const partyEntry = party[idx];
      const playerState = state.player && state.player[idx];
      if (!partyEntry || !playerState) {
        continue;
      }
      const roleId = partyEntry.playerRole;
      const statusRow = getPlayerStatusRow(roleId);
      const entityId = registry.createEntity({ tags: BattleTags.Player });
      registry.addComponent(entityId, BattleComponents.BattleActor, createBattleActorComponent({
        type: 'player',
        index: idx,
        roleId
      }));
      registry.addComponent(entityId, BattleComponents.Time, createTimeComponent(playerState));
      registry.addComponent(entityId, BattleComponents.Status, createStatusComponent({
        type: 'player',
        playerIndex: idx,
        roleId,
        statusRef: statusRow
      }));
      registry.addComponent(entityId, BattleComponents.Stats, createStatsComponent({
        type: 'player',
        actorIndex: idx,
        roleId,
        statsRef: gameData && gameData.playerRoles ? {
          hp: gameData.playerRoles.HP,
          mp: gameData.playerRoles.MP,
          maxHP: gameData.playerRoles.maxHP,
          maxMP: gameData.playerRoles.maxMP
        } : null,
        extra: {
          statusRef: statusRow
        }
      }));
      registry.addComponent(entityId, BattleComponents.Position, createPositionComponent({
        type: 'player',
        actorIndex: idx,
        stateRef: playerState,
        current: playerState.pos != null ? playerState.pos : null,
        original: playerState.originalPos != null ? playerState.originalPos : null
      }));
      registry.addComponent(entityId, BattleComponents.Sprite, createSpriteComponent({
        type: 'player',
        actorIndex: idx,
        spriteRef: playerState.sprite || null,
        colorShiftRef: playerState
      }));
      registry.addComponent(entityId, BattleComponents.Animation, createAnimationComponent({
        type: 'player',
        actorIndex: idx,
        stateRef: playerState,
        currentFrame: playerState.currentFrame != null ? playerState.currentFrame : 0
      }));
      if (playerState.action) {
        registry.addComponent(entityId, BattleComponents.Command, createCommandComponent({
          type: 'player',
          commandRef: playerState.action
        }));
      }
      this.entityMaps.player.set(idx, entityId);
    }

    const maxEnemyIndex = typeof state.maxEnemyIndex === 'number' ? state.maxEnemyIndex : -1;
    for (let idx = 0; idx <= maxEnemyIndex; idx++) {
      const enemyState = state.enemy && state.enemy[idx];
      if (!enemyState || enemyState.objectID === 0) {
        continue;
      }
      this._createEnemyEntity(registry, idx, enemyState);
    }

    if (Array.isArray(state.actionQueue)) {
      for (let idx = 0; idx < state.actionQueue.length; idx++) {
        const entryRef = state.actionQueue[idx];
        if (!entryRef) {
          continue;
        }
        const entityId = registry.createEntity();
        registry.addComponent(entityId, BattleComponents.QueueEntry, createQueueEntryComponent({
          index: idx,
          entryRef
        }));
        this.entityMaps.queue.set(idx, entityId);
      }
    }

    const uiState = state.UI || null;
    const uiEntity = registry.createEntity();
    registry.addComponent(uiEntity, BattleComponents.UIState, createUIStateComponent({
      stateRef: uiState,
      state: uiState ? uiState.state : null,
      menuState: uiState ? uiState.menuState : null,
      currentPlayer: uiState ? uiState.curPlayerIndex : null,
      selectedAction: uiState ? uiState.selectedAction : null,
      selectedIndex: uiState ? uiState.selectedIndex : null,
      autoBattle: getAutoBattleFlag()
    }));
    this.entityMaps.ui = uiEntity;

    this.syncActorComponents();
  }

  getPlayerEntity(index: PlayerIndex) {
    return this.entityMaps.player.get(index) || null;
  }

  getEnemyEntity(index: EnemyIndex) {
    return this.entityMaps.enemy.get(index) || null;
  }

  getQueueEntity(index: QueueIndex) {
    return this.entityMaps.queue.get(index) || null;
  }

  getUIEntity() {
    return this.entityMaps.ui;
  }

  getUIComponent() {
    if (!this.entityMaps.ui) {
      return null;
    }
    const registry = this.getRegistry();
    if (!registry) {
      return null;
    }
    return registry.getComponent(this.entityMaps.ui, BattleComponents.UIState);
  }

  syncUIComponent() {
    const component = this.getUIComponent();
    if (!component) {
      return;
    }
    const state = this.getState();
    const uiState = state ? state.UI : null;
    component.stateRef = uiState;
    component.state = uiState ? uiState.state : null;
    component.menuState = uiState ? uiState.menuState : null;
    component.currentPlayer = uiState ? uiState.curPlayerIndex : null;
    component.selectedAction = uiState ? uiState.selectedAction : null;
    component.selectedIndex = uiState ? uiState.selectedIndex : null;
    component.autoBattle = getAutoBattleFlag();
  }

  _createEnemyEntity(registry: EcsRegistry, idx: number, enemyState: any) {
    const entityId = registry.createEntity({ tags: BattleTags.Enemy });
    registry.addComponent(entityId, BattleComponents.BattleActor, createBattleActorComponent({
      type: 'enemy',
      index: idx,
      objectId: enemyState.objectID
    }));
    registry.addComponent(entityId, BattleComponents.Time, createTimeComponent(enemyState));
    registry.addComponent(entityId, BattleComponents.Status, createStatusComponent({
      type: 'enemy',
      enemyIndex: idx,
      statusRef: enemyState.status || null
    }));
    registry.addComponent(entityId, BattleComponents.Stats, createStatsComponent({
      type: 'enemy',
      actorIndex: idx,
      roleId: enemyState.objectID,
      statsRef: enemyState.e || null,
      extra: {
        poisonRef: enemyState.poisons || null
      }
    }));
    registry.addComponent(entityId, BattleComponents.Position, createPositionComponent({
      type: 'enemy',
      actorIndex: idx,
      stateRef: enemyState,
      current: enemyState.pos != null ? enemyState.pos : null,
      original: enemyState.originalPos != null ? enemyState.originalPos : null
    }));
    registry.addComponent(entityId, BattleComponents.Sprite, createSpriteComponent({
      type: 'enemy',
      actorIndex: idx,
      spriteRef: enemyState.sprite || null,
      colorShiftRef: enemyState
    }));
    registry.addComponent(entityId, BattleComponents.Animation, createAnimationComponent({
      type: 'enemy',
      actorIndex: idx,
      stateRef: enemyState,
      currentFrame: enemyState.currentFrame != null ? enemyState.currentFrame : 0,
      speedRef: enemyState.e || null,
      frameCount: enemyState.e && enemyState.e.idleFrames != null ? enemyState.e.idleFrames : null,
      metadata: {
        idleAnimSpeed: enemyState.e ? enemyState.e.idleAnimSpeed : null
      }
    }));
    if (enemyState.action) {
      registry.addComponent(entityId, BattleComponents.Command, createCommandComponent({
        type: 'enemy',
        commandRef: enemyState.action
      }));
    }
    this.entityMaps.enemy.set(idx, entityId);
  }

  // Enemies placed in a slot after the battle started (0x009C division, 0x009E summon) had no
  // entity, so they were never drawn and their statuses never counted down (though they still
  // acted). Give every occupied slot an entity.
  _ensureEnemyEntities(registry: EcsRegistry, state: any) {
    const maxEnemyIndex = typeof state.maxEnemyIndex === 'number' ? state.maxEnemyIndex : -1;
    for (let idx = 0; idx <= maxEnemyIndex; idx++) {
      const enemyState = state.enemy && state.enemy[idx];
      if (!enemyState || enemyState.objectID === 0 || this.entityMaps.enemy.has(idx)) {
        continue;
      }
      this._createEnemyEntity(registry, idx, enemyState);
    }
  }

  syncActorComponents() {
    const registry = this.getRegistry();
    const state = this.getState();
    if (!registry || !state) {
      return;
    }
    const party = getPartySnapshot();
    const gameData = typeof GameData !== 'undefined' ? GameData : null;

    this.entityMaps.player.forEach((entityId, index) => {
      const playerState = state.player && state.player[index];
      const partyEntry = party[index];
      if (!playerState) {
        return;
      }
      const statsComp = registry.getComponent(entityId, BattleComponents.Stats);
      if (statsComp) {
        statsComp.stateRef = playerState;
        statsComp.actorIndex = index;
        if (statsComp.extra && partyEntry && typeof partyEntry.playerRole === 'number') {
          const roleId = partyEntry.playerRole;
          statsComp.extra.roleId = roleId;
          statsComp.extra.statusRef = getPlayerStatusRow(roleId);
          if (gameData && gameData.playerRoles) {
            statsComp.current = {
              hp: gameData.playerRoles.HP ? gameData.playerRoles.HP[roleId] : null,
              mp: gameData.playerRoles.MP ? gameData.playerRoles.MP[roleId] : null,
              maxHP: gameData.playerRoles.maxHP ? gameData.playerRoles.maxHP[roleId] : null,
              maxMP: gameData.playerRoles.maxMP ? gameData.playerRoles.maxMP[roleId] : null
            };
          }
        } else if (statsComp.extra) {
          statsComp.extra.statusRef = null;
        }
      }
      const positionComp = registry.getComponent(entityId, BattleComponents.Position);
      if (positionComp) {
        positionComp.actorIndex = index;
        positionComp.stateRef = playerState;
        positionComp.current = playerState.pos != null ? playerState.pos : positionComp.current;
        positionComp.original = playerState.originalPos != null ? playerState.originalPos : positionComp.original;
      }
      const spriteComp = registry.getComponent(entityId, BattleComponents.Sprite);
      if (spriteComp) {
        spriteComp.actorIndex = index;
        spriteComp.spriteRef = playerState.sprite || spriteComp.spriteRef || null;
        spriteComp.colorShiftRef = playerState;
      }
      const animationComp = registry.getComponent(entityId, BattleComponents.Animation);
      if (animationComp) {
        animationComp.actorIndex = index;
        animationComp.stateRef = playerState;
        animationComp.currentFrame = playerState.currentFrame != null ? playerState.currentFrame : animationComp.currentFrame;
      }
    });

    this._ensureEnemyEntities(registry, state);

    this.entityMaps.enemy.forEach((entityId, index) => {
      const enemyState = state.enemy && state.enemy[index];
      if (!enemyState) {
        return;
      }
      // Cloning, summoning and 0x009F transformation replace the enemy's data in place.
      const actorComp = registry.getComponent(entityId, BattleComponents.BattleActor);
      if (actorComp) {
        actorComp.objectId = enemyState.objectID;
      }
      const statusComp = registry.getComponent(entityId, BattleComponents.Status);
      if (statusComp) {
        statusComp.statusRef = enemyState.status || null;
      }
      const statsComp = registry.getComponent(entityId, BattleComponents.Stats);
      if (statsComp) {
        statsComp.actorIndex = index;
        statsComp.stateRef = enemyState;
        statsComp.statsRef = enemyState.e || null;
        statsComp.current = enemyState.e && enemyState.e.health != null ? {
          hp: enemyState.e.health,
          maxHP: enemyState.e.maxHealth != null ? enemyState.e.maxHealth : null
        } : statsComp.current;
      }
      const positionComp = registry.getComponent(entityId, BattleComponents.Position);
      if (positionComp) {
        positionComp.actorIndex = index;
        positionComp.stateRef = enemyState;
        positionComp.current = enemyState.pos != null ? enemyState.pos : positionComp.current;
        positionComp.original = enemyState.originalPos != null ? enemyState.originalPos : positionComp.original;
      }
      const spriteComp = registry.getComponent(entityId, BattleComponents.Sprite);
      if (spriteComp) {
        spriteComp.actorIndex = index;
        spriteComp.spriteRef = enemyState.sprite || spriteComp.spriteRef || null;
        spriteComp.colorShiftRef = enemyState;
      }
      const animationComp = registry.getComponent(entityId, BattleComponents.Animation);
      if (animationComp) {
        animationComp.actorIndex = index;
        animationComp.stateRef = enemyState;
        animationComp.currentFrame = enemyState.currentFrame != null ? enemyState.currentFrame : animationComp.currentFrame;
        if (animationComp.metadata) {
          animationComp.metadata.idleAnimSpeed = enemyState.e ? enemyState.e.idleAnimSpeed : animationComp.metadata.idleAnimSpeed;
        }
      }
    });

    const payload = { registry, state, source: 'syncActorComponents', previous: null as BattleState | null };
    this.fire('ecs:componentsSynced', payload);
    if (this.systemManager && typeof this.systemManager.fire === 'function') {
      this.systemManager.fire('componentsSynced', payload);
    }
  }

  setSystemManager(manager: SystemManager) {
    this.systemManager = manager;
  }

  getSystemManager() {
    return this.systemManager;
  }

  runSystems(phases: string | string[], context: BattleContext) {
    if (!this.systemManager) {
      return;
    }
    const runtimeContext = copyNativeBattleScriptContext(context, Object.assign({}, context, { battleService: this }));
    if (Array.isArray(phases)) {
      if (this.systemManager.runPipeline) {
        this.systemManager.runPipeline(phases, runtimeContext);
      }
      return;
    }
    if (this.systemManager.run) {
      this.systemManager.run(phases, runtimeContext);
    }
  }

  *runGeneratorSystems(phases: string | string[], context: BattleContext) {
    if (!this.systemManager) {
      return;
    }
    const runtimeContext = copyNativeBattleScriptContext(context, Object.assign({}, context, { battleService: this }));
    if (Array.isArray(phases)) {
      for (let i = 0; i < phases.length; i++) {
        if (this.systemManager.runGenerator) {
          yield* this.systemManager.runGenerator(phases[i], runtimeContext);
        }
      }
      return;
    }
    if (this.systemManager.runGenerator) {
      yield* this.systemManager.runGenerator(phases, runtimeContext);
    }
  }

  *runTick(context: BattleContext) {
    if (!this.systemManager || typeof this.systemManager.runTick !== 'function') {
      return;
    }
    const runtimeContext = copyNativeBattleScriptContext(context, Object.assign({}, context, { battleService: this }));
    const result = this.systemManager.runTick(runtimeContext);
    if (result && typeof (result as any)[Symbol.iterator] === 'function') {
      yield* result as IterableIterator<unknown>;
    }
  }

  _ensureModule(method: string) {
    if (!this.module || typeof (this.module as any)[method] !== 'function') {
      throw new Error(`Battle module is not bound or missing method "${method}"`);
    }
    return (this.module as any)[method];
  }

  *_wrapGeneratorCall(method: string, payloadBuilder: (...args: any[]) => Record<string, unknown>, ...args: any[]) {
    const fn = this._ensureModule(method);
    const payload = payloadBuilder ? payloadBuilder(...args) : {};
    this.fire(`before${method[0].toUpperCase()}${method.slice(1)}`, payload);
    const result = yield* fn.apply(this.module, args);
    this._syncStateFromGlobal();
    this.fire(`after${method[0].toUpperCase()}${method.slice(1)}`, {
      ...payload,
      result,
      state: this.state
    });
    return result;
  }

  *init(...args: any[]) {
    return yield* this._wrapGeneratorCall('init', (...params: any[]) => ({ args: params }), ...args);
  }

  *start(enemyTeam: any, isBoss: any, ...parent: unknown[]) {
    return yield* this._wrapGeneratorCall('start', (team: any, boss: any) => ({ enemyTeam: team, isBoss: boss }), enemyTeam, isBoss, ...parent);
  }

  startBattle(formationId: any, options: DamageOptions = {}, invocation?: {runner: ScriptRunner; frame: ScriptExecutionFrame}) {
    const enemyTeam = Number.isFinite(formationId) ? Math.trunc(formationId) : 0;
    const bossFlag = options && typeof (options as any).isBoss === 'boolean' ? (options as any).isBoss : !!(options && (options as any).boss);
    if (this._activeBattleTask) {
      if (battleScriptExecution.owned) throw new Error('owned battle script invocation is already active');
      return this._activeBattleTask;
    }
    const parent = battleScriptExecution.begin(invocation?.runner || scriptService.getModule(), invocation?.frame);
    let completed = true;
    const task = co(parent ? this.start.bind(this, enemyTeam, bossFlag, parent) : this.start.bind(this, enemyTeam, bossFlag))
      .catch((err: any) => {
        completed = false;
        if (typeof console !== 'undefined' && console.error) {
          console.error('[battle-service] startBattle failed', err);
        }
        throw err;
      })
      .finally(() => {
        battleScriptExecution.finish(parent, completed);
        if (this._activeBattleTask === task) this._activeBattleTask = null;
      });
    this._activeBattleTask = task;
    return task;
  }

  *won(...args: any[]) {
    return yield* this._wrapGeneratorCall('won', (...params: any[]) => ({ args: params }), ...args);
  }

  *playerEscape(...args: any[]) {
    return yield* this._wrapGeneratorCall('playerEscape', (...params: any[]) => ({ args: params }), ...args);
  }

  *enemyEscape(...args: any[]) {
    return yield* this._wrapGeneratorCall('enemyEscape', (...params: any[]) => ({ args: params }), ...args);
  }

  castMagic(options: MagicOptions = {}) {
    const { magicId, casterIndex, targetIndex } = options || {};
    const state = this.getState();
    if (!state || !Array.isArray(state.player)) {
      return false;
    }
    const actionEnum = getBattleActionEnum();
    const magicAction = actionEnum && typeof actionEnum.Magic === 'number' ? actionEnum.Magic : 3;
    const playerIndex = Number.isFinite(casterIndex as number) ? Math.trunc(casterIndex as number) : 0;
    if (playerIndex < 0 || playerIndex >= state.player.length) {
      return false;
    }
    const resolvedMagic = Number.isFinite(magicId as number) ? Math.trunc(magicId as number) : 0;
    const resolvedTarget = Number.isFinite(targetIndex as number) ? Math.trunc(targetIndex as number) : -1;
    // W9:先写组件,再投影(没有 action 对象时新建的那份 remainingTime = 0)
    const hasAction = !!(state.player[playerIndex] && (state.player[playerIndex] as any).action);
    this.writeCommitted(playerIndex, { actionType: magicAction, actionID: resolvedMagic, target: resolvedTarget, ...(hasAction ? {} : { remainingTime: 0 }) });
    this.updatePlayer(playerIndex, (player: any) => {
      if (!player) {
        return player;
      }
      if (!player.action) {
        player.action = { actionType: magicAction, actionID: resolvedMagic, target: resolvedTarget, remainingTime: 0 };
        return player;
      }
      player.action.actionType = magicAction;
      player.action.actionID = resolvedMagic;
      player.action.target = resolvedTarget;
      return player;
    });
    return true;
  }

  _syncBattleFlags(source: string, emitEvent = true) {
    updateBattleFlagsFromState(this.getState(), { source, emitEvent });
  }

  emitStateChanged() {
    const state = this.getState();
    const payload: StateChangedPayload = { previous: state, state };
    this.fire('stateChanged', payload);
    if (this.systemManager && typeof this.systemManager.onStateChanged === 'function') {
      this.systemManager.onStateChanged(payload);
    }
    this._syncBattleFlags('battleService:emitStateChanged');
  }

  withState<T>(callback: (state: BattleState) => T, options: UpdateOptions = {}) {
    const state = this.getState();
    if (!state || typeof callback !== 'function') {
      return null;
    }
    const result = callback(state);
    if (options.emit !== false) {
      this.emitStateChanged();
    } else {
      this._syncBattleFlags('battleService:withState', false);
    }
    if (typeof callback === 'function') {
      this.syncUIComponent();
    }
    return result;
  }

  set(path: Path, value: unknown, options: UpdateOptions = {}) {
    const state = this.getState();
    if (!state) return null;
    const segments = Array.isArray(path) ? path : [path];
    let target: any = state;
    for (let i = 0; i < segments.length - 1; i++) {
      if (target == null) return null;
      target = target[segments[i]];
    }
    if (target == null) return null;
    const key = segments[segments.length - 1];
    const nextValue = typeof value === 'function' ? (value as any)(target[key]) : value;
    target[key] = nextValue;
    if ((options as any).emit !== false) {
      this.emitStateChanged();
    } else {
      this._syncBattleFlags('battleService:set', false);
    }
    return target[key];
  }

  update(path: Path, updater: StateMutator<any>, options: UpdateOptions = {}) {
    return this.set(path, updater, options);
  }

  getPlayer(index: PlayerIndex) {
    const state = this.getState();
    return state && state.player ? state.player[index] : null;
  }

  updatePlayer(index: PlayerIndex, updater: StateMutator<PlayerState>, options: UpdateOptions = {}) {
    return this.update(['player', index], updater, options);
  }

  setPlayer(index: PlayerIndex, patch: Record<string, unknown> | StateMutator<PlayerState>, options: UpdateOptions = {}) {
    return this.updatePlayer(index, function(player: PlayerState) {
      if (!player) return player;
      if (typeof patch === 'function') {
        return patch(player) || player;
      }
      Object.assign(player, patch);
      return player;
    }, options);
  }

  getEnemy(index: EnemyIndex) {
    const state = this.getState();
    return state && state.enemy ? state.enemy[index] : null;
  }

  updateEnemy(index: EnemyIndex, updater: StateMutator<any>, options: UpdateOptions = {}) {
    return this.update(['enemy', index], updater, options);
  }

  setEnemy(index: EnemyIndex, patch: Record<string, unknown> | StateMutator<EnemyState>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy) return enemy;
      if (typeof patch === 'function') {
        return patch(enemy) || enemy;
      }
      Object.assign(enemy, patch);
      return enemy;
    }, options);
  }

  getUI() {
    const state = this.getState();
    return state ? state.UI : null;
  }

  updateUI(updater: StateMutator<Record<string, unknown>>, options: UpdateOptions = {}) {
    const result = this.update(['UI'], updater, options);
    this.syncUIComponent();
    return result;
  }

  setUI(patch: Record<string, unknown> | StateMutator<Record<string, unknown>>, options: UpdateOptions = {}) {
    const result = this.update(['UI'], function(uiState: Record<string, unknown>) {
      if (!uiState) return uiState;
      if (typeof patch === 'function') {
        return patch(uiState) || uiState;
      }
      Object.assign(uiState, patch);
      return uiState;
    }, options);
    this.syncUIComponent();
    return result;
  }

  getActionQueue() {
    const state = this.getState();
    return state ? state.actionQueue : null;
  }

  updateActionQueue(index: QueueIndex, updater: StateMutator<Record<string, unknown>>, options: UpdateOptions = {}) {
    if (typeof index === 'function' && updater === undefined) {
      return this.update(['actionQueue'], index, options);
    }
    return this.update(['actionQueue', index], updater, options);
  }

  setActionQueue(index: QueueIndex, patch: Record<string, unknown> | StateMutator<Record<string, unknown>>, options: UpdateOptions = {}) {
    return this.updateActionQueue(index, function(queueItem: Record<string, unknown>) {
      if (!queueItem) return queueItem;
      if (typeof patch === 'function') {
        return patch(queueItem) || queueItem;
      }
      Object.assign(queueItem, patch);
      return queueItem;
    }, options);
  }

  getSceneBuffer() {
    const state = this.getState();
    return state ? state.sceneBuf : null;
  }

  setSceneBuffer(buffer: any, options: UpdateOptions = {}) {
    return this.set(['sceneBuf'], buffer, options);
  }

  getBackground() {
    const state = this.getState();
    return state ? state.background : null;
  }

  setBackground(background: unknown, options: UpdateOptions = {}) {
    return this.set(['background'], background, options);
  }

  setEnemyHealth(index: EnemyIndex, updater: ValueOrUpdater<number>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy || !enemy.e) return enemy;
      const current = typeof enemy.e.health === 'number' ? enemy.e.health : 0;
      const next = typeof updater === 'function' ? updater(current) : updater;
      enemy.e.health = next;
      return enemy;
    }, options);
  }

  setEnemyMagic(index: EnemyIndex, value: ValueOrUpdater<number>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy || !enemy.e) return enemy;
      const current = typeof enemy.e.magic === 'number' ? enemy.e.magic : 0;
      enemy.e.magic = typeof value === 'function' ? value(current) : value;
      return enemy;
    }, options);
  }

  setEnemyMagicRate(index: EnemyIndex, value: ValueOrUpdater<number>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy || !enemy.e) return enemy;
      const current = typeof enemy.e.magicRate === 'number' ? enemy.e.magicRate : 0;
      enemy.e.magicRate = typeof value === 'function' ? value(current) : value;
      return enemy;
    }, options);
  }

  setEnemyStatus(index: EnemyIndex, statusIndex: number, value: ValueOrUpdater<number>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy || !enemy.status) return enemy;
      if (!Number.isFinite(statusIndex)) return enemy;
      const idx = Math.trunc(statusIndex);
      const current = enemy.status[idx] || 0;
      enemy.status[idx] = typeof value === 'function' ? value(current) : value;
      return enemy;
    }, options);
  }

  setEnemyPoison(index: EnemyIndex, slot: number, patch: Record<string, unknown> | StateMutator<Record<string, unknown>>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy) return enemy;
      const slotIndex = Number(slot);
      if (Number.isNaN(slotIndex)) return enemy;
      if (!enemy.poisons) {
        enemy.poisons = [];
      }
      const poison = enemy.poisons[slotIndex] || (enemy.poisons[slotIndex] = {});
      if (typeof patch === 'function') {
        patch(poison);
      } else if (patch && typeof patch === 'object') {
        Object.assign(poison, patch);
      }
      return enemy;
    }, options);
  }

  clearEnemyPoison(index: EnemyIndex, slot: number, options: UpdateOptions = {}) {
    return this.setEnemyPoison(index, slot, function(poison: Record<string, unknown>) {
      poison.poisonID = 0;
      poison.poisonScript = 0;
      return poison;
    }, options);
  }

  setEnemyPosition(index: EnemyIndex, pos: number | ValueOrUpdater<number | null | undefined>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy) return enemy;
      const current = enemy.pos == null ? null : enemy.pos;
      enemy.pos = typeof pos === 'function' ? pos(current) : pos;
      return enemy;
    }, options);
  }

  setEnemyColorShift(index: EnemyIndex, value: unknown, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy) return enemy;
      enemy.colorShift = typeof value === 'function' ? value(enemy.colorShift) : value;
      return enemy;
    }, options);
  }

  replaceEnemy(index: EnemyIndex, enemyData: EnemyState, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function() {
      return enemyData;
    }, options);
  }

  setEnemyObject(index: EnemyIndex, objectID: number | ValueOrUpdater<number | undefined>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy) return enemy;
      enemy.objectID = typeof objectID === 'function' ? objectID(enemy.objectID) : objectID;
      return enemy;
    }, options);
  }

  setEnemyFrame(index: EnemyIndex, frame: number | ValueOrUpdater<number | undefined>, options: UpdateOptions = {}) {
    return this.updateEnemy(index, function(enemy: EnemyState) {
      if (!enemy) return enemy;
      enemy.wCurrentFrame = typeof frame === 'function' ? frame(enemy.wCurrentFrame) : frame;
      return enemy;
    }, options);
  }

  setHidingTime(value: number | ValueOrUpdater<number>, options: UpdateOptions = {}) {
    return this.set(['hidingTime'], value, options);
  }

  setBattleBlow(value: number | ValueOrUpdater<number>, options: UpdateOptions = {}) {
    return this.set(['blow'], value, options);
  }

  setBattleResult(value: number | ValueOrUpdater<number>, options: UpdateOptions = {}) {
    return this.set(['battleResult'], value, options);
  }

  setPlayerActionType(index: PlayerIndex, actionType: number | string | ValueOrUpdater<number | string | undefined>, options: UpdateOptions = {}) {
    const service = this;
    return this.updatePlayer(index, function(player: PlayerState) {
      if (!player || !player.action) return player;
      // 动作类型归一成数字,组件与投影写同一个值;不是有限数字的(旧签名允许传字符串)不写,两边都不动
      const next = Number(typeof actionType === 'function' ? actionType(player.action.actionType) : actionType);
      if (!Number.isFinite(next)) return player;
      service.writeCommitted(Number(index), { actionType: next });      // 先写组件,再投影
      player.action.actionType = next;
      return player;
    }, options);
  }

  setPlayerColorShift(index: PlayerIndex, value: unknown, options: UpdateOptions = {}) {
    return this.updatePlayer(index, function(player: PlayerState) {
      if (!player) return player;
      player.colorShift = typeof value === 'function' ? value(player.colorShift) : value;
      return player;
    }, options);
  }

  getExpState() {
    const snapshot = getExpStateSnapshot();
    if (snapshot) {
      return snapshot;
    }
    // TODO(rxjs-cleanup): drop worldService exp fallback once adapter snapshot is guaranteed.
    return typeof worldService.getExpState === 'function'
      ? worldService.getExpState()
      : null;
  }

  mutateExpState(mutator: (state: UnknownRecord) => UnknownRecord) {
    return worldService.mutateExpState(mutator);
  }

  getPlayerRoles(): PlayerRoles | null {
    return getPlayerRolesSnapshot() as PlayerRoles | null;
  }

  mutatePlayerRoles(
    mutator: (roles: PlayerRoles | null) => PlayerRoles | null,
    options: UpdateOptions = {}
  ) {
    return worldService.mutatePlayerRoles(mutator, options);
  }

  getPlayerHP(roleId: number) {
    return getPlayerHP(roleId);
  }

  setPlayerHP(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerHP(roleId, value);
  }

  getPlayerMP(roleId: number) {
    return getPlayerMP(roleId);
  }

  setPlayerMP(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerMP(roleId, value);
  }

  getPlayerLevel(roleId: number) {
    return getPlayerLevel(roleId);
  }

  setPlayerLevel(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerLevel(roleId, value);
  }

  getPlayerMaxHP(roleId: number) {
    return getPlayerMaxHP(roleId);
  }

  getPlayerMaxMP(roleId: number) {
    return getPlayerMaxMP(roleId);
  }

  getPlayerAttackStrength(roleId: number) {
    return getPlayerAttackStrength(roleId);
  }

  setPlayerAttackStrength(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerAttackStrength(roleId, value);
  }

  getPlayerMagicStrength(roleId: number) {
    return getPlayerMagicStrength(roleId);
  }

  setPlayerMagicStrength(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerMagicStrength(roleId, value);
  }

  getPlayerDefense(roleId: number) {
    return getPlayerDefense(roleId);
  }

  setPlayerDefense(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerDefense(roleId, value);
  }

  getPlayerDexterity(roleId: number) {
    return getPlayerDexterity(roleId);
  }

  setPlayerDexterity(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerDexterity(roleId, value);
  }

  getPlayerFleeRate(roleId: number) {
    return getPlayerFleeRate(roleId);
  }

  setPlayerFleeRate(roleId: number, value: ValueOrUpdater<number>) {
    return worldService.setPlayerFleeRate(roleId, value);
  }

  getPlayerSnapshot(roleId: PlayerIndex) {
    const roles = this.getPlayerRoles() as PlayerRoles | null;
    if (!roles) {
      return null;
    }
    return {
      roleId: roleId,
      nameId: Array.isArray(roles.name) ? roles.name[roleId] || 0 : 0,
      level: Array.isArray(roles.level) ? roles.level[roleId] || 0 : 0,
      hp: Array.isArray(roles.HP) ? roles.HP[roleId] || 0 : 0,
      maxHP: Array.isArray(roles.maxHP) ? roles.maxHP[roleId] || 0 : 0,
      mp: Array.isArray(roles.MP) ? roles.MP[roleId] || 0 : 0,
      maxMP: Array.isArray(roles.maxMP) ? roles.maxMP[roleId] || 0 : 0,
      attackStrength: this.getPlayerAttackStrength(roleId),
      magicStrength: this.getPlayerMagicStrength(roleId),
      defense: this.getPlayerDefense(roleId),
      dexterity: this.getPlayerDexterity(roleId),
      fleeRate: this.getPlayerFleeRate(roleId)
    };
  }

  awardExp(roleId: number, expGained: number) {
    const before = this.getPlayerSnapshot(roleId);
    if (!before) {
      return { roleId, before: null, after: null, levelUp: false, expApplied: 0 };
    }
    if (!expGained || expGained <= 0 || before.hp <= 0) {
      return { roleId, before, after: before, levelUp: false, expApplied: 0 };
    }

    const maxLevel = typeof Const !== 'undefined' && Const && typeof Const.MAX_LEVELS === 'number'
      ? Const.MAX_LEVELS
      : 99;
    const levelUpExpTable = stateService.getGameData('levelUpExp') || (typeof GameData !== 'undefined' && GameData.levelUpExp ? GameData.levelUpExp : []);

    const bucketNames = ['primaryExp', 'attackExp', 'defenseExp', 'dexterityExp', 'fleeExp', 'healthExp', 'magicExp', 'magicPowerExp'];
    this.mutateExpState((expState: any) => {
      if (!expState) {
        return expState;
      }
      bucketNames.forEach((name) => {
        if (!expState[name]) {
          expState[name] = [];
        }
        if (!expState[name][roleId]) {
          expState[name][roleId] = { exp: 0, level: 0, count: 0 };
        }
      });
      return expState;
    });

    // 以下逐行对照 SDLPAL battle.c PAL_BattleWon(主经验 + CHECK_HIDDEN_EXP):
    //  - dwExp 是 DWORD 整数运算,写回 (WORD)dwExp;隐藏经验 gained × count / total 是整数除法
    //  - 满级后循环照样扣经验(隐藏属性照样 +RandomLong(1, 2)),只是不再升级
    //  - 升过级的话,隐藏属性成长之后把 HP / MP 补满到新的上限
    const threshold = (lvl: number) => {
      const v = levelUpExpTable ? levelUpExpTable[lvl] : undefined;
      return typeof v === 'number' && v > 0 ? v : Infinity;   // 表外 / 0:不再循环(原版的表不会有 0)
    };
    const rand = (min: number, max: number) => {
      const rng: any = (typeof randomLong === 'function' ? randomLong : (globalThis as any).randomLong);
      if (typeof rng === 'function') {
        return rng(min, max);
      }
      return Math.floor(random() * (max - min + 1)) + min;
    };
    const expOf = (bucket: string) => (((this.getExpState() || {}) as ExpState)[bucket] as Record<number, ExpBucket> | undefined)?.[roleId];
    const writeExp = (bucket: string, fields: Partial<ExpBucket>) => this.mutateExpState((state) => {
      const entry = state && state[bucket] && state[bucket][roleId];
      if (entry) Object.assign(entry, fields);
      return state;
    });

    let currentLevel = before.level;
    if (currentLevel > maxLevel) {
      currentLevel = maxLevel;
      this.setPlayerLevel(roleId, currentLevel);
    }
    let dwExp = (expOf('primaryExp')?.exp || 0) + expGained;
    let levelUpOccurred = false;
    while (dwExp >= threshold(currentLevel)) {
      dwExp -= threshold(currentLevel);
      if (currentLevel < maxLevel) {
        levelUpOccurred = true;
        // PAL_PlayerLevelUp raises the level itself (and grows the stats); setting the level
        // first as well would add two levels per level-up.
        if (scriptService && typeof scriptService.playerLevelUp === 'function') {
          scriptService.playerLevelUp(roleId, 1);
        } else {
          this.setPlayerLevel(roleId, currentLevel + 1);
        }
        currentLevel++;
        this.setPlayerHP(roleId, this.getPlayerMaxHP(roleId));
        this.setPlayerMP(roleId, this.getPlayerMaxMP(roleId));
      }
    }
    writeExp('primaryExp', { exp: dwExp });

    const hiddenBuckets = [
      { bucket: 'healthExp', stat: 'maxHP' },
      { bucket: 'magicExp', stat: 'maxMP' },
      { bucket: 'attackExp', stat: 'attackStrength' },
      { bucket: 'magicPowerExp', stat: 'magicStrength' },
      { bucket: 'defenseExp', stat: 'defense' },
      { bucket: 'dexterityExp', stat: 'dexterity' },
      { bucket: 'fleeExp', stat: 'fleeRate' }
    ];
    let totalCount = 0;
    hiddenBuckets.forEach(({ bucket }) => {
      totalCount += expOf(bucket)?.count || 0;
    });

    if (totalCount > 0) {
      hiddenBuckets.forEach(({ bucket, stat }) => {
        const entry = expOf(bucket);
        if (!entry) {
          return;
        }
        let hiddenExp = Math.floor((expGained * (entry.count || 0)) / totalCount) * 2 + (entry.exp || 0);
        let bucketLevel = entry.level || 0;
        if (bucketLevel > maxLevel) {
          bucketLevel = maxLevel;
          writeExp(bucket, { level: bucketLevel });
        }
        while (hiddenExp >= threshold(bucketLevel)) {
          hiddenExp -= threshold(bucketLevel);
          const increment = rand(1, 2);
          this.mutatePlayerRoles((roles) => {
            const column = roles ? (roles as any)[stat] : null;
            // 列是 Uint16Array(不是 Array):写入按 WORD 截断,同 C 的 rgwXxx[w] += …
            if (column && typeof column.length === 'number') {
              column[roleId] = (column[roleId] ?? 0) + increment;
            }
            return roles;
          });
          if (bucketLevel < maxLevel) {
            bucketLevel++;
          }
        }
        writeExp(bucket, { exp: hiddenExp, level: bucketLevel });
      });
    }

    // Avoid HP/MP out of sync with upgraded maxHP/MP
    if (levelUpOccurred) {
      this.setPlayerHP(roleId, this.getPlayerMaxHP(roleId));
      this.setPlayerMP(roleId, this.getPlayerMaxMP(roleId));
    }

    const after = this.getPlayerSnapshot(roleId) || before;
    return {
      roleId,
      before,
      after,
      levelUp: levelUpOccurred,
      expApplied: expGained
    };
  }
}

const serviceInstance = new BattleService();

const battleService = new Proxy(serviceInstance as any, {
  get(target: any, prop, receiver) {
    if (prop === 'module' || prop === 'state' || prop in target) {
      return Reflect.get(target, prop, receiver);
    }
    const moduleRef = target.getModule();
    if (moduleRef && prop in moduleRef) {
      const value = moduleRef[prop];
      if (typeof value === 'function') {
        return value.bind(moduleRef);
      }
      return value;
    }
    return undefined;
  },
  set(target: any, prop, value) {
    if (prop === 'module' || prop === 'state' || prop in target) {
      target[prop] = value;
    } else if (target.getModule()) {
      target.getModule()[prop] = value;
    } else {
      target[prop] = value;
    }
    return true;
  },
  has(target: any, prop) {
    if (prop in target) return true;
    const moduleRef = target.getModule();
    return moduleRef ? prop in moduleRef : false;
  },
  ownKeys(target: any) {
    const keys = new Set(Reflect.ownKeys(target));
    const moduleRef = target.getModule();
    if (moduleRef) {
      Reflect.ownKeys(moduleRef).forEach((key) => keys.add(key));
    }
    return Array.from(keys);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop in target) {
      return Object.getOwnPropertyDescriptor(target, prop);
    }
    const moduleRef = target.getModule();
    if (moduleRef && prop in moduleRef) {
      return Object.getOwnPropertyDescriptor(moduleRef, prop);
    }
    return undefined;
  }
});

export { BattleService };
export default battleService;
