import {rewardServiceProviderProbeActive,rewardRunnerServiceSelection,assertRewardServiceSelection,assertRewardServiceProvider,type RewardServiceSelection} from './battle-reward-runtime';
import {hasBattleRewardTask,invokeRewardWorldDispatch,registerRewardRunnerIdentity,rewardRunnerIdentity} from './battle-reward-fence';
import {battleEndScriptRuntime} from './battle-end-script-runtime';
import {type BattleEndScriptCursor} from './battle-end-script-cursor';
import {battlePreBattleScriptRuntime} from './battle-prebattle-script-runtime';
import {type BattlePreBattleScriptCursor} from './battle-prebattle-script-cursor';
import {battlePoisonRuntime} from './battle-poison-runtime';
import {type BattlePoisonCursor} from './battle-poison-cursor';
import {battleEnemyScriptRuntime} from './battle-enemy-script-runtime';
import {type BattleEnemyScriptCursor} from './battle-enemy-script-cursor';
import {selectChildFrame,commitChildFrame,pushChildFrame,returnChildFrame,type ChildCursor} from './battle-child-script-cursor';
import { battleScriptExecution } from './battle-script-execution';
import {createGeneratedDialogCursor,generatedDialogWait,advanceGeneratedDialogPoll,type GeneratedDialogCursor} from './script-generated-dialog-cursor';
import {generatedDialogLeases,type GeneratedDomainBinding,type GeneratedObservation} from './generated-dialog-reference-leases';
import {nativeTextCapability} from './native-text-capabilities';
import {generatedOwnData,generatedPlain,generatedResourceObserver,generatedItemBitmapObserver,generatedBytes} from './generated-dialog-observation';
import {getRuntimeStoreBinding as readGeneratedStores} from './game-data-adapter';
import {getRuntimeBinding as readGeneratedScripts} from './script-object-adapter';
import {getRuntimeBinding as readGeneratedService} from './dialog-service';
import {getRandomState} from './random';
import {createEndingAnimationCursor,validateEndingAnimationCursor,type EndingAnimationCursor} from './script-ending-animation-cursor';
import {endingAnimationLeases,captureEndingAnimationBinding} from './ending-animation-reference-leases';
import nativePanorama from '../js/pal/panorama-renderer';
import NativeSurface from '../js/pal/surface';
import {acquireOwnedCanvasPixels} from '../js/pal/owned-canvas-pixels';
import {createEndingScrollCursor,validateEndingScrollCursor,type EndingScrollCursor} from './script-ending-scroll-cursor';
import {endingScrollLeases} from './ending-scroll-reference-leases';
import {endingClockUnits,endingClockRound,isEndingClockCapability,type EndingClockCapability,type EndingClockLane} from './script-ending-clock';
import {isEndingClockBinding,endingClockLeases,type EndingClockReferenceLeases,type EndingClockLease} from './ending-clock-reference-leases';
import {getHrtimeBinding} from '../js/pal/common';
import {createEndingShowCursor,type EndingShowCursor} from './script-ending-show-cursor';
import {endingShowLeases,endingShowDigest} from './ending-show-reference-leases';
import {createScreenFadeSource,type ScreenFadeSource} from './script-screen-fade-cursor';
import {screenFadeLeases,screenFadeDigest} from './screen-fade-reference-leases';
import rngService from './rng-service';
import {createRngCursor,advanceRngWait,finishRngPrefix,type RngCursor} from './script-rng-cursor';
import {createSceneFadeCursor,type SceneFadeCursor} from './script-scene-fade-cursor';
import {createComposeCursor,type ComposeCursor,type ComposeSource} from './script-compose-cursor';
import {createTimedFadeCursor,paintTimedFade,advanceTimedFade,validateTimedFadeArgs,denseFadePalette,fadeInterval,type TimedFadeArgs,type TimedFadeCursor,type FadeOpcodeCursor} from './script-timed-fade-cursor';
import {isRegisteredPaletteSceneHook,supportsOwnedPaletteSceneHook} from './script-palette-hook';
import {sameJsonValue} from './script-json-value';
import {paletteFamily,clonePalette,redPaletteStep,blendPaletteStep,colorPaletteStep,type PaletteCursor} from './script-palette-cursor';
import type {RedrawCursor} from './script-redraw-cursor';
import {motionFamily,motionSpeed,type PartyMotionCursor} from './script-party-motion-cursor';
import {isNpcMotionOpcode,type NpcMotionCursor} from './script-npc-motion-cursor';
import {shopMenu,validateShopSelection,type ShopCursor,type ShopSelection} from './script-shop-cursor';
import {createDialogContext,setupDialog,clearOwnedDialog,beginDialogLine,advanceDialogLine,completeDialogCondition,dialogAdvance,validateDialogText,type DialogContext,type DialogAction,type DialogCodec,type DialogTimeWait} from './script-dialog-progress';
import {createInputWait,validateInputResponse,inputNextPC,type ScriptInputResponse,type ScriptInputWait} from './script-input-wait';
import {createEquipmentCursor,advanceEquipmentCursor,type EquipmentCursor,type PartyEquipmentCursor} from './script-equipment-cursor';
import type {PoisonCursor} from './script-poison-cursor';
import type {FrameWaitCursor,WorldUpdateCursor} from './world-update-cursor';
import { copyDelayCheckpoint, normalizeCheckpointWait, validateDelayCheckpoint, CheckpointRevisionRegistry, ManualExecutionSignal, type ScriptDelayCheckpoint, type DelayCheckpointFrame, type ScriptExecutionOutcome } from './script-delay-checkpoint';
import { ScriptExecutionRuntime, type ScriptExecutionFrame, type ScriptExecutionSnapshot } from './script-execution-runtime';
import scene, {getGeneratedSceneCapability} from '../js/pal/scene';
import generatedSceneService from './scene-service';
import { random } from './random.js';
import play,{consumeRewardWorldCallSite,invokeRewardWorldUpdate,installRewardWorldEntryConsumer} from '../js/pal/play';
import ending from '../js/pal/ending';
import uigame from '../js/pal/uigame';
import Palette from '../js/pal/palette';
import scriptHelper from '../js/pal/script-helper';
import res from '../js/pal/res';
import rng from '../js/pal/rng';
import music from '../js/pal/music';
import sound from '../js/pal/sound';
import co from '../js/pal/co';
import { Files } from '../js/pal/pal-global';
import inputService from './input-service.js';
import battleService from './battle-service';
import worldService from './world-service';
import stateService from './state-service';
import dialogService from './dialog-service';
import gameDataAdapter from './game-data-adapter';
import sceneEventAdapter from './scene-event-adapter';
import partyTrailAdapter from './party-trail-adapter';
import scriptObjectAdapter from './script-object-adapter';
import { storyGraphService } from './storygraph-service';
import { getSceneIdValue as getSceneIdSnapshot } from './scene-state-adapter';
import { getSceneEntry as getSceneEntrySnapshot } from './scene-data-adapter';
import {
  getPlayerEquipment as getPlayerEquipmentFromAdapter,
  getPlayerHP as getPlayerHPValue,
  getPlayerMaxHP as getPlayerMaxHPValue,
  getPlayerMP as getPlayerMPValue,
  getPlayerMaxMP as getPlayerMaxMPValue,
  getPlayerAttackStrength as getPlayerAttackStrengthValue,
  getPlayerMagicStrength as getPlayerMagicStrengthValue,
  getPlayerDefense as getPlayerDefenseValue,
  getPlayerDexterity as getPlayerDexterityValue,
  getPlayerFleeRate as getPlayerFleeRateValue,
  getPlayerNameId as getPlayerNameIdValue,
  getPlayerRoleWord as getPlayerRoleWordValue,
  getMaxPartyMemberIndex as getMaxPartyMemberIndexValue,
  findPlayerMagicSlot as findPlayerMagicSlotValue,
  getPlayerMagicSlots as getPlayerMagicSlotsValue,
  getPlayerLevel as getPlayerLevelValue,
  getPoisonStatusMatrix as getPoisonStatusMatrixValue,
  getPlayerStatusValue as getPlayerStatusValueFromAdapter,
  getPlayerRolesSnapshot,
  getEquipmentEffectScalar as getEquipmentEffectScalarFromAdapter,
  getEquipmentEffectElemental as getEquipmentEffectElementalFromAdapter,
  getEquipmentEffect as getEquipmentEffectValue
} from './player-state-adapter.js';
import {
  getBattleStateSnapshot,
  subscribeBattleState
} from './battle-state-adapter.js';
import { inventorySignals } from '../state/slices/inventory.js';
import { gameFlagSignals } from '../state/slices/game-flags.js';
import { viewportSignals } from '../state/slices/viewport.js';
import {
  shouldFadeIn,
  getCurrentSaveSlotValue as getCurrentSaveSlotSnapshot,
  getPaletteIdValue as getPaletteIdSnapshot,
  isNightPaletteEnabled,
  getViewportValue as getViewportSnapshot,
  getPartyOffsetValue as getPartyOffsetSnapshot,
  getPartyDirectionValue as getPartyDirectionSnapshot
} from './environment-adapter.js';
import {
  getChaseRange as getChaseRangeFlagValue,
  getCollectValue as getCollectValueFlagValue
} from './game-flags-adapter.js';

function PAL_XY(x: number, y: number) {
  return (y << 16) | (x & 0xffff);
}
function PAL_X(xy: number) {
  return xy & 0xffff;
}
function PAL_Y(xy: number) {
  return (xy >> 16) & 0xffff;
}

function clearFbpOverlay(reason: string) {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as any;
  if (!win.PAL_FBP_ACTIVE) {
    return null;
  }
  const previous = win.PAL_FBP_OVERLAY_PREV || win.PAL_OVERLAY_ACTIVE || win.PAL_OVERLAY_PREFERENCE || 'off';
  win.PAL_FBP_ACTIVE = false;
  win.PAL_FBP_OVERLAY_PREV = null;
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[SCRIPT] clear FBP overlay', { reason, previous });
  }
  return previous;
}

function restoreOverlayMode(previous: string | null) {
  if (!previous || typeof window === 'undefined') {
    return;
  }
  const win = window as any;
  if (previous === 'panorama' && typeof win.PAL_SET_OVERLAY_MODE === 'function') {
    win.PAL_SET_OVERLAY_MODE('panorama');
    return;
  }
  if (previous === 'gps' && typeof win.PAL_SET_GPS_MODE === 'function') {
    win.PAL_SET_GPS_MODE(true);
  }
}

function debugBgEvent(label: string, payload?: Record<string, unknown>) {
  if (typeof globalThis === 'undefined') {
    return;
  }
  if ((globalThis as any).PAL_DEBUG_BG !== true) {
    return;
  }
  const win = globalThis as any;
  if (!win.PAL_DEBUG_BG_SEEN) {
    win.PAL_DEBUG_BG_SEEN = true;
  }
  const world = win.services?.world;
  const sceneId = world && typeof world.getSceneId === 'function' ? world.getSceneId() : null;
  console.warn('[BG]', label, Object.assign({
    sceneId,
    overlay: win.PAL_OVERLAY_ACTIVE ?? null,
    fbpActive: win.PAL_FBP_ACTIVE ?? null
  }, payload || {}));
}

function shouldTraceBgScript() {
  if (typeof globalThis === 'undefined') {
    return false;
  }
  const win = globalThis as any;
  if (win.PAL_DEBUG_BG !== true) {
    return false;
  }
  if (win.PAL_DEBUG_BG_SEEN) {
    return false;
  }
  return true;
}

function debugBgScriptStep(
  kind: 'trigger' | 'auto',
  scriptEntry: number,
  eventObjectID: number,
  operation: number,
  operands?: ArrayLike<number> | null
) {
  if (!shouldTraceBgScript()) {
    return;
  }
  const operandList = operands && typeof operands.length === 'number'
    ? Array.from(operands).slice(0, 4)
    : null;
  const payload = {
    kind,
    entry: scriptEntry,
    eventId: eventObjectID,
    op: operation,
    opHex: `0x${operation.toString(16)}`,
    operands: operandList
  };
  const win = globalThis as any;
  if (!win.PAL_DEBUG_BG_TRACE) {
    win.PAL_DEBUG_BG_TRACE = [];
  }
  if (Array.isArray(win.PAL_DEBUG_BG_TRACE) && win.PAL_DEBUG_BG_TRACE.length < 2000) {
    win.PAL_DEBUG_BG_TRACE.push(payload);
  }
  console.warn('[BG] script-step', payload);
}

function resolveUiTask<T>(task: any): Promise<T> | T {
  if (!task) {
    return task as T;
  }
  if (typeof task.next === 'function' && typeof task.throw === 'function') {
    return co(task as any);
  }
  return task as T;
}

function invalidateDialogBackup(source: string) {
  if (typeof (ui as any).invalidateDialogBackup === 'function') {
    (ui as any).invalidateDialogBackup(source);
  }
}

function markBgDirty(reason: string) {
  if (typeof globalThis === 'undefined') {
    return;
  }
  const win = globalThis as any;
  win.PAL_BG_DIRTY = reason || true;
}

function consumeBgDirty(context: string) {
  if (typeof globalThis === 'undefined') {
    return;
  }
  const win = globalThis as any;
  if (!win.PAL_BG_DIRTY) {
    return;
  }
  invalidateDialogBackup(`bg-dirty:${context}`);
  win.PAL_BG_DIRTY = null;
}

// Helper types
interface Surface {
  byteBuffer: Uint8Array;
  pitch: number;
  width: number;
  height: number;
  ctx: CanvasRenderingContext2D;
  cvs?: HTMLCanvasElement;
  updateScreen: (rect?: any) => void;
  fadeIn: (paletteId: number, night: boolean, speed: number) => Promise<void>;
  fadeOut: (speed: number) => Promise<void>;
  fadeToRed: () => Promise<void>;
  colorFade: (color: number, speed: number, intensity: number) => Promise<void>;
  paletteFade: (paletteId: number, night: boolean, speed: number) => Promise<void>;
  shakeScreen: (level: number, duration: number) => Promise<void>;
  blit: (src: any) => void;
  restoreScreen: () => void;
  backupScreen: () => void;
  setPalette: (palette: any,norefresh?:boolean) => void;
  getPalette:()=>any; palette:any;len:number;sceneUpdateHook?:unknown;
  fadeScreen: (speed: number) => Promise<void>;
}

enum Direction {
  South = 0,
  West = 1,
  North = 2,
  East = 3,
  Unknown = 4
}

// 须与 js/pal/battle.ts 的 global.BattleResult 一致(同 SDLPAL kBattleResult*):
// 之前写成 Won=0/Fleed=2,startBattle 实际返回 Fleed=0xFFFF → 0x0007 的逃跑分支永远不走。
enum BattleResult {
  Terminated = 0,
  Lost = 1,
  Won = 3,
  Fleed = 0xFFFF
}

enum DialogPosition {
  Upper = 0,
  Center = 1,
  Lower = 2,
  CenterWindow = 3
}

enum TriggerMode {
  TouchNormal = 5
}

enum LoadFlag {
  Scene = 1,
  PlayerSprite = 2
}

enum BodyPart {
  Head = 0,
  Body = 1,
  Shoulder = 2,
  Hand = 3,
  Feet = 4,
  Misc = 5,
  Extra = 6
}

enum PlayerStatus {
  Confused = 0,
  Paralyzed = 1,
  Sleep = 2,
  Silence = 3,
  Puppet = 4,
  Bravery = 5,
  Protect = 6,
  Haste = 7,
  DualAttack = 8,
  All = 9,
  Slow = 10 // Extended
}

const Const = {
  MAX_STORE_ITEM: 9,
  MAX_PLAYABLE_PLAYER_ROLES: 5,
  MAX_PLAYER_ROLES: 6,
  MAX_PLAYER_EQUIPMENTS: 6,
  MAX_POISONS: 16,
  MAX_SCENES: 300,
  MAX_ENEMIES_IN_TEAM: 5,
  MAX_PLAYER_MAGICS: 32,
  MAX_LEVELS: 99,
  MAX_INVENTORY: 256
};

// Helper functions
/** SDLPAL WORD: event object x / y are WORD, so C arithmetic wraps on assignment (0x0012 with a negative
 *  offset, NPC steps). The struct getter caches the raw JS value, so wrap before writing or logic reads 67080
 *  while the bytes / SDLPAL hold 1544. */
function WORD(val: number): number {
  return val & 0xffff;
}

function SHORT(val: number): number {
  return (val << 16) >> 16;
}

function randomLong(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sleepByFrame(frames: number): Promise<void> {
  return sleep(frames * 16); // Approx 60fps
}

/**
 * 0x004B「让事件对象暂时失效」的帧数。原版写死 15(SDLPAL script.c:sVanishTime = -15)。
 * 全游戏只有一处用它:所有怪共用的「逃跑后」脚本 —— 也就是逃出战斗后,怪要过多少帧才能再碰你。
 * 宿主可设 globalThis.NullifyFrames 调这个保护期(难度开关;agent-pal 的 --flee-grace);不设 = 原版 15 帧。
 * vanishTime 存档里是 16 位有符号数,所以封顶 30000。
 */
function nullifyFrames(): number {
  const n = Number((globalThis as any).NullifyFrames);
  return Number.isFinite(n) && n >= 1 ? Math.min(30000, Math.round(n)) : 15;
}

/**
 * 等一个场景帧:原版里按 FRAME_TIME(100ms)等的那几处 —— 队伍走位 / 骑乘、0x0009 等帧、0x007F 镜头移动。
 * 默认(SceneFrameTime = 0)与 sleepByFrame(1) 完全相同;宿主要原版速度时设 SceneFrameTime(见 common.ts)。
 */
function sleepSceneFrame(): Promise<void> {
  const g = globalThis as any;
  return g.SceneFrameTime > 0 ? sleep(g.SceneFrameTime / (g.GameSpeed || 1)) : sleepByFrame(1);
}

function shouldTraceScript(): boolean {
  return typeof (globalThis as any).PAL_SCRIPT_TRACE === 'boolean' && (globalThis as any).PAL_SCRIPT_TRACE;
}

function shouldDebugScript(): boolean {
  const globalAny = globalThis as any;
  return typeof globalAny.PAL_SCRIPT_DEBUG === 'boolean' ? globalAny.PAL_SCRIPT_DEBUG : false;
}

// Logger shim
const log = {
  trace: (msg: string, ...args: any[]) => {
    if (!shouldTraceScript()) return;
    console.debug(msg, ...args);
  },
  debug: (msg: string, ...args: any[]) => {
    if (!shouldDebugScript()) return;
    console.debug(msg, ...args);
  },
  warn: (msg: string, ...args: any[]) => console.warn(msg, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(msg, ...args),
  error: (msg: string, ...args: any[]) => console.error(msg, ...args)
};

/**
 * 尾迹后移一格(SDLPAL 对 TRAIL 结构的 memmove):逐字段复制进已有的条目。
 * 不能换对象 —— 无论是共享引用(trail[0] 与 trail[1] 成了同一个对象)还是换成新的普通对象,
 * 都会让条目与 Global.trail 的字节脱钩,之后的写入进不了字节,存档里的尾迹就是旧的(M2 D2b)。
 */
export function rewardNativeRunnerProtected(runner:object):boolean {const id=rewardRunnerIdentity(runner);return !!id&&hasBattleRewardTask(id);}
// Native provider lookup and its returned Promise retain receiver provenance.
// Nested original kernels still need their own private one-use invocation proof.
const rewardNativeProviders=new Set<object>();
const nativeBattleDispatchers=new WeakMap<object,(entry:number,event:number,parent:ScriptExecutionFrame|undefined,authority:unknown,kind?:'trigger'|'auto',worldCheck?:()=>void)=>Promise<number>>();
/** Internal service adapter: exact parent capability plus one-use synchronous VM-entry proof. */
export function invokeBattleNativeTrigger(runner:object,entry:number,event:number,parent:ScriptExecutionFrame|undefined,authority:unknown):Promise<number> {
 battleScriptExecution.validate(authority,runner as any);const dispatch=nativeBattleDispatchers.get(runner);if(!dispatch)throw new Error('battle native dispatcher unavailable');return dispatch(entry,event,parent,authority);
}
interface RewardWorldProof {runner:ScriptRunner;runtime:ScriptExecutionRuntime;frame:ScriptExecutionFrame;kind:'trigger'|'auto';entry:number;event:number;stage:'dispatch'|'invoke';selection:RewardServiceSelection;}
const rewardWorldProofs=new WeakMap<object,RewardWorldProof>();
const rewardWorldEntries=new WeakMap<object,()=>void>();
/** Consumes an exact private Runner hook entry; never registers or issues one. */
export function consumeRewardWorldEntry(hooks:unknown):void {
 const entry=hooks&&typeof hooks==='object'?rewardWorldEntries.get(hooks as object):undefined;
 if(hooks&&typeof hooks==='object')rewardWorldEntries.delete(hooks as object);
 if(!entry)throw new Error('Native battle task is opaque: World entry provenance required');
 entry();
}
installRewardWorldEntryConsumer(consumeRewardWorldEntry);
// A hoisted declaration preserves the one static installation across the existing PAL ESM cycle.
var rewardWorldDispatch:((kind:'trigger'|'auto',entry:number,event:number,proof:object)=>Promise<number>)|undefined;
/** Static native service routing, not an invocation/capability issuer. */
export function installRewardWorldDispatch(dispatch:NonNullable<typeof rewardWorldDispatch>):void {if(rewardWorldDispatch)throw new Error('native World dispatcher already installed');rewardWorldDispatch=dispatch;}
function takeRewardWorldProof(token:unknown,stage:RewardWorldProof['stage'],kind:'trigger'|'auto',entry:number,event:number):RewardWorldProof {
 const proof=token&&typeof token==='object'?rewardWorldProofs.get(token as object):undefined;
 if(token&&typeof token==='object')rewardWorldProofs.delete(token as object);
 if(!proof||proof.stage!==stage||proof.kind!==kind||proof.entry!==entry||proof.event!==event||proof.runner.getExecutionRuntime()!==proof.runtime||!proof.runtime.owns(proof.frame,proof.runner)||!proof.runtime.hasBattleOrigin(proof.frame)||proof.frame.status!=='waiting')throw new Error('Native battle task is opaque: World provenance required');
 assertRewardServiceSelection(proof.selection);
 return proof;
}
function invokeProvenRewardWorldDispatch(token:object,kind:'trigger'|'auto',entry:number,event:number):Promise<number> {const proof=takeRewardWorldProof(token,'dispatch',kind,entry,event);if(!rewardWorldDispatch)throw new Error('native World dispatcher unavailable');rewardWorldProofs.set(token,{...proof,stage:'invoke'});try{return rewardWorldDispatch(kind,entry,event,token);}finally{rewardWorldProofs.delete(token);}}
/** Exact one-use original World proof is consumed before selected-helper VM entry. */
export function invokeRewardNativeWorld(runner:object,kind:'trigger'|'auto',entry:number,event:number,token?:unknown):Promise<number> {if(token===undefined)return invokeRewardWorldDispatch(kind,entry,event);const proof=takeRewardWorldProof(token,'invoke',kind,entry,event);if(runner!==proof.selection.helper||(runner as ScriptRunner).getExecutionRuntime()!==proof.selection.runtime)throw new Error('Native battle task is opaque: selected helper receiver mismatch');assertRewardServiceSelection(proof.selection);const check=()=>{assertRewardServiceProvider(proof.selection);if(proof.runner.getExecutionRuntime()!==proof.runtime||!proof.runtime.owns(proof.frame,proof.runner)||!proof.runtime.hasBattleOrigin(proof.frame)||proof.frame.status!=='waiting')throw new Error('Native battle task is opaque: World origin changed');assertRewardServiceSelection(proof.selection);};check();const dispatch=nativeBattleDispatchers.get(runner);if(!dispatch)throw new Error('native World dispatcher unavailable');return dispatch(entry,event,undefined,undefined,kind,check);}


export function shiftTrailInPlace(trail: any[]) {
  for (var i = 3; i >= 0; i--) {
    var from = trail[i];
    if (!from) {
      continue;
    }
    var to = trail[i + 1] || (trail[i + 1] = {});
    to.x = from.x;
    to.y = from.y;
    to.direction = from.direction;
  }
}

interface EndingClockRestoreContext {
  readonly cap:EndingClockCapability;
  readonly scope:EndingClockReferenceLeases;
  readonly lease:EndingClockLease;
  readonly lane:EndingClockLane;
}

interface OwnedChildSession {
  cursor: ChildCursor<unknown>;
  assert(): void;
  bindFrame(frame: ScriptExecutionFrame): void;
  releaseFrame(frame: ScriptExecutionFrame): void;
  pauseAt(): Promise<void> | null;
  invokeTrigger?: (entry: number, event: number, parent: ScriptExecutionFrame) => Promise<number>;
}

class ScriptRunner {
  private surface: Surface | null = null;
  private readonly executionRuntime: ScriptExecutionRuntime;
  // Dead opaque handles stay with still-live source frames until their own finally.
  // They retain no parent Runner/World aliases after adapter retirement.
  private readonly battleAuthorities = new WeakMap<ScriptExecutionFrame, unknown>();
  public getExecutionRuntime(): ScriptExecutionRuntime { return this.executionRuntime; }
  public get scriptSuccess(): boolean { return this.executionRuntime.scriptSuccess; }
  public set scriptSuccess(value: boolean) { this.executionRuntime.scriptSuccess = value; }
  public get curEquipPart(): number { return this.executionRuntime.curEquipPart; }
  public set curEquipPart(value: number) { this.executionRuntime.curEquipPart = value; }

  public getExecutionSnapshot(): ScriptExecutionSnapshot {
    return this.executionRuntime.snapshot();
  }

  // Manual auto recursion saves the selected edge on its source frame.
  private teleportReturns = new Map<number,Extract<NonNullable<DelayCheckpointFrame['parentReturn']>,{kind:'teleport-child'}>>();
  private autoTailReturns = new Map<number,Extract<NonNullable<DelayCheckpointFrame['parentReturn']>,{kind:'auto-tail'}>>();
  private equipmentCursors = new Map<number,EquipmentCursor>();
  private partyEquipmentCursors = new Map<number,PartyEquipmentCursor>();
  private childFrameLinks = new WeakMap<ScriptExecutionFrame, {releaseFrame(frame:ScriptExecutionFrame):void}>();
  private poisonCursors = new Map<number,PoisonCursor>();
  private npcMotions = new Map<number,NpcMotionCursor>();
  private timedFades=new Map<number,TimedFadeCursor>();
  private compositions=new Map<number,ComposeCursor>();
  private rngCursors=new Map<number,RngCursor>();
  private generatedDialogs=new Map<number,GeneratedDialogCursor>();
  private generatedNativeEnds=new Map<number,NonNullable<DelayCheckpointFrame['generatedNativeEnd']>>();
  private endingAnimations=new Map<number,EndingAnimationCursor>();
  private endingScrolls=new Map<number,EndingScrollCursor>();
  private endingShows=new Map<number,EndingShowCursor>();
  private screenFades=new Map<number,ScreenFadeSource>();
  private sceneFades=new Map<number,SceneFadeCursor>();
  private fadeSources=new Map<number,FadeOpcodeCursor>();
  private palettes=new Map<number,PaletteCursor>();
  private redraws=new Map<number,RedrawCursor>();
  private motions = new Map<number,PartyMotionCursor>();
  private frameWaits = new Map<number,FrameWaitCursor>();
  private dialogContext:DialogContext | null = null;
  private restoreDialogLeaf=false;
  private dialogActions=new Map<number,DialogAction>();
  private manualExecution = false;
  private manualRootEntryGranted = false;
  private manualOwnedFrames = new Set<number>();
  private restoreFrames: DelayCheckpointFrame[] = [];
  private shopCursors=new Map<number,ShopCursor>();
  private shopResponse:boolean|ShopSelection|null=null;
  private inputResponse: {wait:ScriptInputWait;value:boolean} | null = null;
  private checkpointRevisions = new CheckpointRevisionRegistry();
  private checkpointSequence = 0;
  private checkpointNamespace: string | null = null;
  private endingClockCapability?:EndingClockCapability;
  private rootEndingClock:{scope:EndingClockReferenceLeases;lease:EndingClockLease;lane:EndingClockLane}|null=null;
  public setEndingClock(cap:EndingClockCapability|undefined):void{if(cap!==undefined&&!isEndingClockCapability(cap))throw new Error('Ending clock capability must come from createEndingClock');this.endingClockCapability=cap;}
  private validateRootClock(cp:ScriptDelayCheckpoint,elapsed=0):{reason:string|null;context:EndingClockRestoreContext|null} {
    if(!cp.clock)return {reason:worldService.isEndingClockRoot(cp.id)?'Missing ending clock descriptor':null,context:null};
    try {
      const cap=this.endingClockCapability;
      if(!cap)return {reason:'Ending clock capability is required',context:null};
      const scope=endingClockLeases(cap),row=scope.resolve(cp,cap,getHrtimeBinding());
      if(!row)return {reason:'Missing, foreign, changed or expired ending clock progress',context:null};
      const context={cap,scope,lease:cp.clock.lease,lane:row.lane};
      if(!scope.validateSprites(context.lease,ending.peekCachedShowEffect))return {reason:'Ending Sprite immutable binding changed',context:null};
      row.lane.previewElapsed(elapsed);
      row.lane.validateCounter();
      // A user counter can change the selector or expire/change the actual row.
      // Retain and recheck this context rather than resolving a new selector later.
      return {reason:this.rootClockContextReason(cp,context),context};
    }catch(error){return {reason:(error as Error).message,context:null};}
  }
  private rootClockContextReason(cp:ScriptDelayCheckpoint,context:EndingClockRestoreContext|null):string|null {
    if(!context)return null;
    try {
      if(this.manualExecution||this.executionRuntime.snapshot().activeFrames.length)return 'Execution context changed during ending clock validation';
      if(this.endingClockCapability!==context.cap)return 'Ending clock capability changed during validation';
      const row=context.scope.resolve(cp,context.cap,getHrtimeBinding());
      if(!row||row.lane!==context.lane)return 'Ending clock context changed or expired during validation';
      if(!context.scope.validateSprites(context.lease,ending.peekCachedShowEffect))return 'Ending Sprite immutable binding changed';
      return this.endingClockCapability===context.cap?null:'Ending clock capability changed during validation';
    }catch(error){return (error as Error).message;}
  }
  private restoreRootClock(context:EndingClockRestoreContext|null,elapsed=0):void {
    if(!context){this.rootEndingClock=null;return;}
    context.scope.consume(context.lease);
    context.lane.addElapsed(elapsed);
    this.rootEndingClock=context;
  }
  private publishRootClock(cp:ScriptDelayCheckpoint):void{const r=this.rootEndingClock;if(r){cp.clock=r.scope.descriptor(r.lease);r.scope.publish(r.lease,cp);}}
  /** Exclude continuation metadata while retaining one root execution span. */
  private clockMetadata<T>(read:()=>T):T{const lane=this.rootEndingClock?.lane,active=lane?.active;
    const control=(error:unknown):never=>{if(this.generatedDialogs.size||this.generatedNativeEnds.size)throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});throw error;};
    try{lane?.end();}catch(error){control(error);}
    try{return read();}finally{if(active)try{lane?.begin();}catch(error){control(error);}}
  }
  private manualIdentity: {id:string;revision:number} | null = null;

  public runFadeUntilWait(args:TimedFadeArgs):Promise<ScriptExecutionOutcome> {
    if (rewardNativeRunnerProtected(this)||battleScriptExecution.hasOpaqueTask(this)) return Promise.resolve({status:'unsupported',reason:'Native battle task is opaque'});
    if(!validateTimedFadeArgs(args))return Promise.resolve({status:'unsupported',reason:'Invalid fade arguments'});
    return this.executeManually('fade',0,0,args);
  }
  public runEquipmentsUntilWait():Promise<ScriptExecutionOutcome> {
    return this.executeManually('equipment',0,0);
  }
  public runTriggerUntilWait(entry:number, event:number): Promise<ScriptExecutionOutcome> {
    return this.executeManually('trigger', entry, event);
  }
  public runAutoUntilWait(entry:number, event:number): Promise<ScriptExecutionOutcome> {
    return this.executeManually('auto', entry, event);
  }
  public resumeExecution(value:unknown,elapsedMs:number):Promise<ScriptExecutionOutcome>{return this.resumeGeneratedOrTimedExecution(value,elapsedMs,false);}
  private async resumeGeneratedOrTimedExecution(value:unknown, elapsedMs:number,generatedAcknowledgement:boolean): Promise<ScriptExecutionOutcome> {
    if (rewardNativeRunnerProtected(this)||battleScriptExecution.hasOpaqueTask(this)) return {status:'unsupported',reason:'Native battle task is opaque'};
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return {status:'unsupported',reason:'Elapsed milliseconds must be finite and nonnegative'};
    if (this.manualExecution || this.executionRuntime.snapshot().activeFrames.length) return {status:'unsupported',reason:'Execution context must be idle'};
    const teleportInitial=worldService.validateTeleportCheckpoint(value,pc=>generatedOwnData(readGeneratedScripts().entries,String(pc)));if(teleportInitial)return {status:'unsupported',reason:teleportInitial};
    if ((dialogService.getStatus().active || dialogService.getStatus().awaitingInput || dialogService.getChoice()) && !(Array.isArray((value as any)?.frames)&&(value as any).frames.some((f:any)=>f?.generatedDialog))) return {status:'unsupported',reason:'Active UI dialog cannot be manually resumed'};
    const reason=validateDelayCheckpoint(value, pc=>scriptObjectAdapter.getScriptEntry(pc), itemId=>scriptObjectAdapter.getObjectEntry(itemId));
    if (reason) return {status:'unsupported',reason};
    const checkpoint=copyDelayCheckpoint(value as ScriptDelayCheckpoint);
    const clock=this.validateRootClock(checkpoint,elapsedMs);if(clock.reason)return {status:'unsupported',reason:clock.reason};
    const referenceReason=this.validateWorldCompositions(checkpoint);if(referenceReason)return {status:'unsupported',reason:referenceReason};
    if(checkpoint.frames.some(f=>f.compose) && (!this.surface || scene.surface!==this.surface))return {status:'unsupported',reason:'Scene composition requires the same Surface as its owned fade'};
    const fadeReason=this.validateOwnedFades(checkpoint);if(fadeReason)return {status:'unsupported',reason:fadeReason};
    const rngReason=this.validateOwnedRng(checkpoint);if(rngReason)return {status:'unsupported',reason:rngReason};
    const generatedReason=this.validateGeneratedDialogs(checkpoint);if(generatedReason)return {status:'unsupported',reason:generatedReason};
    const endingAnimationReason=this.validateOwnedEndingAnimations(checkpoint);if(endingAnimationReason)return {status:'unsupported',reason:endingAnimationReason};
    const endingScrollReason=this.validateOwnedEndingScrolls(checkpoint);if(endingScrollReason)return {status:'unsupported',reason:endingScrollReason};
    const endingShowReason=this.validateOwnedEndingShows(checkpoint);if(endingShowReason)return {status:'unsupported',reason:endingShowReason};
    const screenFadeReason=this.validateOwnedScreenFades(checkpoint);if(screenFadeReason)return {status:'unsupported',reason:screenFadeReason};
    const sceneFadeReason=this.validateOwnedSceneFades(checkpoint);if(sceneFadeReason)return {status:'unsupported',reason:sceneFadeReason};
    const paletteReason=this.validateOwnedPalettes(checkpoint);if(paletteReason)return {status:'unsupported',reason:paletteReason};
    const npcReason=this.validateOwnedNpcMotion(checkpoint);if(npcReason)return {status:'unsupported',reason:npcReason};
    const shopReason=this.validateOwnedShops(checkpoint);if(shopReason)return {status:'unsupported',reason:shopReason};
    const dialogReason=this.validateOwnedDialog(checkpoint);if(dialogReason)return {status:"unsupported",reason:dialogReason};
    const wait=normalizeCheckpointWait(checkpoint);
    if(wait.kind==='input'||wait.kind==='menu')return {status:'unsupported',reason:'Input wait requires a response'};
    if(wait.kind==='generated-dialog'&&!Number.isFinite(checkpoint.frames[checkpoint.frames.length-1].generatedDialog!.elapsedMs+elapsedMs))return {status:'unsupported',reason:'Generated dialog elapsed offset must remain finite'};
    if(wait.kind==='timed-fade' && !Number.isFinite(wait.elapsedMs+elapsedMs))return {status:'unsupported',reason:'Timed fade elapsed offset must remain finite'};
    if(wait.kind==='rng'&&(!Number.isFinite(wait.logicalNow+elapsedMs)||!Number.isFinite(wait.waitElapsed+elapsedMs)||!Number.isFinite(wait.sleepStart+(wait.waitElapsed+elapsedMs))))return {status:'unsupported',reason:'RNG logical clock must remain finite'};
    const partial=elapsedMs<wait.remainingMs;
    const successorId=checkpoint.revision === Number.MAX_SAFE_INTEGER-1 ? globalThis.crypto.randomUUID() : null;
    const clockContextReason=this.rootClockContextReason(checkpoint,clock.context);if(clockContextReason)return {status:'unsupported',reason:clockContextReason};
    const animationFence=this.validateOwnedEndingAnimations(checkpoint);if(animationFence)return {status:'unsupported',reason:animationFence};
    const scrollFence=this.validateOwnedEndingScrolls(checkpoint);if(scrollFence)return {status:'unsupported',reason:scrollFence};
    const finalAnimationFence=this.endingAnimationConsumeFence(checkpoint,clock.context);if(finalAnimationFence)return {status:'unsupported',reason:finalAnimationFence};
    const generatedClockFence=this.generatedDialogClockFence(checkpoint,clock.context);if(generatedClockFence)return {status:'unsupported',reason:generatedClockFence};
    const generatedFence=this.validateGeneratedDialogs(checkpoint,false);if(generatedFence)return {status:'unsupported',reason:generatedFence};
    const teleportFence=worldService.validateTeleportCheckpoint(value,pc=>generatedOwnData(readGeneratedScripts().entries,String(pc)));if(teleportFence)return {status:'unsupported',reason:teleportFence};
    if(checkpoint.frames.some(f=>f.generatedDialog||f.generatedNativeEnd))this.checkpointRevisions.publish(checkpoint.id,checkpoint.revision);
    if (!this.checkpointRevisions.consume(checkpoint.id,checkpoint.revision)) return {status:'unsupported',reason:'Checkpoint revision was already consumed'};
    if(!worldService.consumeTeleportCheckpoint(checkpoint))return {status:'unsupported',reason:'Teleport checkpoint publication was already consumed'};
    for(const f of checkpoint.frames)if(f.generatedDialog)generatedDialogLeases(this.surface!).consume(f.generatedDialog.lease);
    if(checkpoint.frames.some(f=>f.generatedDialog||f.generatedNativeEnd)||worldService.hasGeneratedDialogOwner(checkpoint.id))generatedDialogLeases(this.surface!).consumeRoot(checkpoint.id);
    this.restoreRootClock(clock.context,elapsedMs);
    for(const f of checkpoint.frames)if(f.generatedDialog){const scope=generatedDialogLeases(this.surface!),work=scope.getWork(f.generatedDialog.lease) as any;if(work){const field=wait.kind==='generated-dialog'?'sourceElapsedUnits':'childElapsedUnits';work[field]=(BigInt(work[field])+endingClockUnits(elapsedMs)).toString();}}
    if (successorId) { worldService.transferTeleportOwner(checkpoint.id,successorId);this.transferWorldCompositions(checkpoint,successorId);checkpoint.id=successorId; checkpoint.revision=0; }
    else checkpoint.revision++;
    if(generatedAcknowledgement){const c=checkpoint.frames.find(f=>f.generatedDialog)!.generatedDialog!;c.acknowledged=true;}
    if(wait.kind==='generated-dialog'){const c=checkpoint.frames[checkpoint.frames.length-1].generatedDialog!;advanceGeneratedDialogPoll(c,elapsedMs);wait.remainingMs=c.remainingMs;}
    if(wait.kind==='rng'){const c=checkpoint.frames[checkpoint.frames.length-1].rng!;advanceRngWait(c,elapsedMs);Object.assign(wait,c);}
    if(wait.kind==='timed-fade'){const c=checkpoint.frames[checkpoint.frames.length-1].timedFade!;advanceTimedFade(c,elapsedMs);wait.elapsedMs=c.elapsedMs;wait.remainingMs=c.remainingMs;}
    if (partial) {
      if(wait.kind!=='timed-fade'&&wait.kind!=='rng'&&wait.kind!=='generated-dialog')wait.remainingMs-=elapsedMs;
      if (checkpoint.version===1) checkpoint.delay.remainingMs=wait.remainingMs;
      if(wait.kind==='party-motion')checkpoint.frames[checkpoint.frames.length-1].motion!.remainingMs=0;
    if(wait.kind==='npc-motion')checkpoint.frames[checkpoint.frames.length-1].npcMotion!.remainingMs=wait.remainingMs;
      if(wait.kind==='palette')checkpoint.frames[checkpoint.frames.length-1].palette!.remainingMs=wait.remainingMs;
      if(wait.kind==='redraw')checkpoint.frames[checkpoint.frames.length-1].redraw!.remainingMs=wait.remainingMs;
      if(wait.kind==='ending-animation')checkpoint.frames[checkpoint.frames.length-1].endingAnimation!.remainingMs=wait.remainingMs;
      if(wait.kind==='ending-scroll')checkpoint.frames[checkpoint.frames.length-1].endingScroll!.remainingMs=wait.remainingMs;
      if(wait.kind==='ending-show'){const c=checkpoint.frames[checkpoint.frames.length-1].endingShow!;c.remainingMs=wait.remainingMs;endingShowLeases(this.surface!).publish(c.lease!,c,checkpoint.revision);}
      if(wait.kind==='screen-fade'){const p=checkpoint.frames[checkpoint.frames.length-1].screenFade!.screen!;p.remainingMs=wait.remainingMs;screenFadeLeases(this.surface!).publish(p.lease,p);}
      if(wait.kind==='scene-fade')checkpoint.frames[checkpoint.frames.length-1].sceneFade!.remainingMs=wait.remainingMs;
      if (wait.kind==='party-motion') checkpoint.frames[checkpoint.frames.length-1].motion!.remainingMs=wait.remainingMs;
      if (wait.kind==='frame') checkpoint.frames[checkpoint.frames.length-1].frameWait!.remainingMs=wait.remainingMs;
      try{this.publishRootClock(checkpoint);this.publishEndingAnimations(checkpoint);this.publishEndingScrolls(checkpoint);this.publishGeneratedDialogs(checkpoint);worldService.publishTeleportCheckpoint(checkpoint);}catch(error){
        worldService.releaseTeleportOwner(checkpoint.id);
        if(checkpoint.frames.some(f=>f.endingAnimation||f.generatedDialog)){
          worldService.releaseGeneratedDialogOwner(checkpoint.id);worldService.releaseCompositionOwner(checkpoint.id);worldService.releaseScreenFadeOwner(checkpoint.id);worldService.releaseEndingShowOwner(checkpoint.id);worldService.releaseEndingAnimationOwner(checkpoint.id);worldService.releaseEndingScrollOwner(checkpoint.id);worldService.releaseEndingClockOwner(checkpoint.id);this.rootEndingClock=null;
        }
        throw error;
      }
      this.rootEndingClock=null;
      this.checkpointRevisions.publish(checkpoint.id,checkpoint.revision);
      return {status:'suspended',checkpoint};
    }
    for(const f of checkpoint.frames)if(f.endingAnimation)endingAnimationLeases(this.surface!).consume(f.endingAnimation.lease!);
    for(const f of checkpoint.frames)if(f.endingScroll)endingScrollLeases(this.surface!).consume(f.endingScroll.lease!);
    if(wait.kind==='ending-show')endingShowLeases(this.surface!).consumeProgress(checkpoint.frames[checkpoint.frames.length-1].endingShow!.lease!);
    if(wait.kind==='screen-fade')screenFadeLeases(this.surface!).consumeProgress(checkpoint.frames[checkpoint.frames.length-1].screenFade!.screen!.lease);
    this.scriptSuccess=checkpoint.registers.scriptSuccess;
    this.curEquipPart=checkpoint.registers.curEquipPart;
    if (checkpoint.wait?.kind==='frame') {const w=checkpoint.frames[checkpoint.frames.length-1].frameWait!;w.remainingMs=0;}
    if(wait.kind==='party-motion')checkpoint.frames[checkpoint.frames.length-1].motion!.remainingMs=0;
    if(wait.kind==='npc-motion')checkpoint.frames[checkpoint.frames.length-1].npcMotion!.remainingMs=0;
    if(wait.kind==='palette')checkpoint.frames[checkpoint.frames.length-1].palette!.remainingMs=0;
    if(wait.kind==='redraw')checkpoint.frames[checkpoint.frames.length-1].redraw!.remainingMs=0;
    if(wait.kind==='ending-animation')checkpoint.frames[checkpoint.frames.length-1].endingAnimation!.remainingMs=0;
    if(wait.kind==='ending-scroll')checkpoint.frames[checkpoint.frames.length-1].endingScroll!.remainingMs=0;
    if(wait.kind==='ending-show')checkpoint.frames[checkpoint.frames.length-1].endingShow!.remainingMs=0;
    if(wait.kind==='screen-fade')checkpoint.frames[checkpoint.frames.length-1].screenFade!.screen!.remainingMs=0;
    if(wait.kind==='scene-fade')checkpoint.frames[checkpoint.frames.length-1].sceneFade!.remainingMs=0;
    this.restoreDialogLeaf=wait.kind==='dialog-time';
    this.dialogContext=checkpoint.dialog||null;
    if(wait.kind==='dialog-time'){completeDialogCondition(checkpoint.dialog!);if(!checkpoint.dialog!.cursor)checkpoint.frames[checkpoint.frames.length-1].currentPC++;}
    this.restoreFrames=checkpoint.frames;
    this.manualIdentity={id:checkpoint.id,revision:checkpoint.revision};
    const root=checkpoint.frames[0];
    return this.executeManually(root.kind,root.currentPC,root.eventId);
  }
  public async respondExecution(value:unknown,response:ScriptInputResponse):Promise<ScriptExecutionOutcome> {
    if (rewardNativeRunnerProtected(this)||battleScriptExecution.hasOpaqueTask(this)) return {status:'unsupported',reason:'Native battle task is opaque'};
    const teleportInitial=worldService.validateTeleportCheckpoint(value,pc=>generatedOwnData(readGeneratedScripts().entries,String(pc)));if(teleportInitial)return {status:'unsupported',reason:teleportInitial};
    if(Array.isArray((value as any)?.frames)&&(value as any).frames.some((f:any)=>f?.generatedDialog)&&['generated-dialog','timed-fade'].includes((value as any)?.wait?.kind)){const cp=value as ScriptDelayCheckpoint;if(!validateInputResponse(response,cp.id,cp.revision,{kind:'input',opcodePC:cp.wait!.opcodePC,nextPC:cp.wait!.opcodePC,operands:[],prompt:{kind:'advance',options:[{label:'Continue',value:true}]}}))return {status:'unsupported',reason:'Invalid generated acknowledgement'};return this.resumeGeneratedOrTimedExecution(value,0,true);}
    if(this.manualExecution || this.executionRuntime.snapshot().activeFrames.length)return {status:'unsupported',reason:'Execution context must be idle'};
    if(dialogService.getStatus().active || dialogService.getStatus().awaitingInput || dialogService.getChoice())return {status:'unsupported',reason:'Active UI dialog cannot be manually resumed'};
    const reason=validateDelayCheckpoint(value,pc=>scriptObjectAdapter.getScriptEntry(pc),itemId=>scriptObjectAdapter.getObjectEntry(itemId));
    if(reason)return {status:'unsupported',reason};
    const checkpoint=copyDelayCheckpoint(value as ScriptDelayCheckpoint),wait=normalizeCheckpointWait(checkpoint);
    const clock=this.validateRootClock(checkpoint);if(clock.reason)return {status:'unsupported',reason:clock.reason};
    const referenceReason=this.validateWorldCompositions(checkpoint);if(referenceReason)return {status:'unsupported',reason:referenceReason};
    if(checkpoint.frames.some(f=>f.compose) && (!this.surface || scene.surface!==this.surface))return {status:'unsupported',reason:'Scene composition requires the same Surface as its owned fade'};
    const fadeReason=this.validateOwnedFades(checkpoint);if(fadeReason)return {status:'unsupported',reason:fadeReason};
    const rngReason=this.validateOwnedRng(checkpoint);if(rngReason)return {status:'unsupported',reason:rngReason};
    const generatedReason=this.validateGeneratedDialogs(checkpoint);if(generatedReason)return {status:'unsupported',reason:generatedReason};
    const endingAnimationReason=this.validateOwnedEndingAnimations(checkpoint);if(endingAnimationReason)return {status:'unsupported',reason:endingAnimationReason};
    const endingScrollReason=this.validateOwnedEndingScrolls(checkpoint);if(endingScrollReason)return {status:'unsupported',reason:endingScrollReason};
    const endingShowReason=this.validateOwnedEndingShows(checkpoint);if(endingShowReason)return {status:'unsupported',reason:endingShowReason};
    const screenFadeReason=this.validateOwnedScreenFades(checkpoint);if(screenFadeReason)return {status:'unsupported',reason:screenFadeReason};
    const sceneFadeReason=this.validateOwnedSceneFades(checkpoint);if(sceneFadeReason)return {status:'unsupported',reason:sceneFadeReason};
    const paletteReason=this.validateOwnedPalettes(checkpoint);if(paletteReason)return {status:'unsupported',reason:paletteReason};
    const npcReason=this.validateOwnedNpcMotion(checkpoint);if(npcReason)return {status:'unsupported',reason:npcReason};
    const shopReason=this.validateOwnedShops(checkpoint);if(shopReason)return {status:'unsupported',reason:shopReason};
    const dialogReason=this.validateOwnedDialog(checkpoint);if(dialogReason)return {status:"unsupported",reason:dialogReason};
    if(wait.kind!=='menu' && wait.kind!=='input' && !(wait.kind==='dialog-time' && (wait.phase==='glyph' || wait.phase==='window')))return {status:'unsupported',reason:'Response requires an input wait, skippable glyph or classic window'};
    if(wait.kind==='menu' ? (!response || response.id!==checkpoint.id || response.revision!==checkpoint.revision || !validateShopSelection(response.value,checkpoint.frames[checkpoint.frames.length-1].shopCursor!)) : !validateInputResponse(response,checkpoint.id,checkpoint.revision,wait.kind==='dialog-time'?{kind:'input',opcodePC:wait.opcodePC,nextPC:wait.nextPC,operands:[],prompt:{kind:'advance',options:[{label:'Continue',value:true}]}}:wait))return {status:'unsupported',reason:'Invalid input response identity, revision or value'};
    const successorId=checkpoint.revision===Number.MAX_SAFE_INTEGER-1 ? globalThis.crypto.randomUUID() : null;
    const clockContextReason=this.rootClockContextReason(checkpoint,clock.context);if(clockContextReason)return {status:'unsupported',reason:clockContextReason};
    const animationFence=this.validateOwnedEndingAnimations(checkpoint);if(animationFence)return {status:'unsupported',reason:animationFence};
    const scrollFence=this.validateOwnedEndingScrolls(checkpoint);if(scrollFence)return {status:'unsupported',reason:scrollFence};
    const finalAnimationFence=this.endingAnimationConsumeFence(checkpoint,clock.context);if(finalAnimationFence)return {status:'unsupported',reason:finalAnimationFence};
    const generatedClockFence=this.generatedDialogClockFence(checkpoint,clock.context);if(generatedClockFence)return {status:'unsupported',reason:generatedClockFence};
    const generatedFence=this.validateGeneratedDialogs(checkpoint,false);if(generatedFence)return {status:'unsupported',reason:generatedFence};
    const teleportFence=worldService.validateTeleportCheckpoint(value,pc=>generatedOwnData(readGeneratedScripts().entries,String(pc)));if(teleportFence)return {status:'unsupported',reason:teleportFence};
    if(checkpoint.frames.some(f=>f.generatedDialog||f.generatedNativeEnd))this.checkpointRevisions.publish(checkpoint.id,checkpoint.revision);
    if(!this.checkpointRevisions.consume(checkpoint.id,checkpoint.revision))return {status:'unsupported',reason:'Checkpoint revision was already consumed'};
    if(!worldService.consumeTeleportCheckpoint(checkpoint))return {status:'unsupported',reason:'Teleport checkpoint publication was already consumed'};
    for(const f of checkpoint.frames)if(f.generatedDialog)generatedDialogLeases(this.surface!).consume(f.generatedDialog.lease);
    if(checkpoint.frames.some(f=>f.generatedDialog||f.generatedNativeEnd)||worldService.hasGeneratedDialogOwner(checkpoint.id))generatedDialogLeases(this.surface!).consumeRoot(checkpoint.id);
    this.restoreRootClock(clock.context);
    if(successorId){worldService.transferTeleportOwner(checkpoint.id,successorId);this.transferWorldCompositions(checkpoint,successorId);checkpoint.id=successorId;checkpoint.revision=0;}else checkpoint.revision++;
    this.scriptSuccess=checkpoint.registers.scriptSuccess;
    this.curEquipPart=checkpoint.registers.curEquipPart;
    this.restoreDialogLeaf=wait.kind==='dialog-time' || (wait.kind==='input' && wait.action==='dialog');
    this.dialogContext=checkpoint.dialog||null;
    this.restoreFrames=checkpoint.frames;
    this.manualIdentity={id:checkpoint.id,revision:checkpoint.revision};
    if(wait.kind==='dialog-time'){completeDialogCondition(checkpoint.dialog!,wait.phase==='glyph');if(!checkpoint.dialog!.cursor)checkpoint.frames[checkpoint.frames.length-1].currentPC++;}
    else if(wait.kind==='menu' || (wait.kind==='input' && wait.action==='shop'))this.shopResponse=response.value;
    else if(wait.action==='dialog'){if(wait.phase==='page'||wait.phase==='window'){completeDialogCondition(checkpoint.dialog!);if(!checkpoint.dialog!.cursor)checkpoint.frames[checkpoint.frames.length-1].currentPC++;}else {checkpoint.dialog!.skip=false;clearOwnedDialog(checkpoint.dialog!,wait.phase==='terminal');}}
    else this.inputResponse={wait,value:(response as ScriptInputResponse).value as boolean};
    const root=checkpoint.frames[0];
    return this.executeManually(root.kind,root.currentPC,root.eventId);
  }
  private async executeManually(kind:'trigger'|'auto'|'equipment'|'fade',entry:number,event:number,fadeArgs?:TimedFadeArgs): Promise<ScriptExecutionOutcome> {
    if (rewardNativeRunnerProtected(this)||battleScriptExecution.hasOpaqueTask(this)) return {status:'unsupported',reason:'Native battle task is opaque'};
    if (this.manualExecution || this.executionRuntime.snapshot().activeFrames.length) return {status:'unsupported',reason:'Manual execution requires a single idle root'};
    const generatedTriggerEntry=(kind==='trigger'||kind==='auto')&&!this.restoreFrames.length&&!dialogService.getChoice()&&scriptObjectAdapter.getScriptEntry(entry)?.operation===0x34;
    if ((dialogService.getStatus().active || dialogService.getStatus().awaitingInput || dialogService.getChoice()) && !this.restoreFrames.some(f=>f.generatedDialog) && !generatedTriggerEntry) return {status:'unsupported',reason:'Active UI dialog cannot be manually resumed'};
    this.manualExecution=true;
    let suspended=false;
    try {
      if (!this.manualIdentity) {
        this.checkpointNamespace ??= globalThis.crypto.randomUUID();
        this.manualIdentity = {id:`${this.checkpointNamespace}-${++this.checkpointSequence}`,revision:0};
      }
      if(!this.restoreFrames.length && this.endingClockCapability){if(!isEndingClockBinding(getHrtimeBinding()))throw new ManualExecutionSignal({status:'unsupported',reason:'Ending clock requires browser-performance module binding'});const scope=endingClockLeases(this.endingClockCapability),lease=scope.acquire(this.manualIdentity.id,this.endingClockCapability,getHrtimeBinding());worldService.registerEndingClockReferenceScope(scope,this.manualIdentity.id);this.rootEndingClock={scope,lease,lane:scope.lane(lease)};}
      if(!this.restoreFrames.length)this.rootEndingClock?.lane.begin();
      this.manualRootEntryGranted=true;
      const nextEntry=kind==='fade' ? (await this.runOwnedFade(fadeArgs ?? this.restoreFrames[0].fadeArgs!),0) : kind==='equipment' ? (await this.runManualEquipments(),0) : await (kind==='trigger' ? this.#invokeRewardTrigger(entry,event) : this.#invokeRewardAuto(entry,event));
      this.rootEndingClock?.lane.end();
      return {status:'completed',nextEntry,...(this.dialogContext?{dialog:JSON.parse(JSON.stringify(this.dialogContext))}:{})};
    } catch (error) {
      if (error instanceof ManualExecutionSignal) {suspended=error.outcome.status==='suspended';return error.outcome;}
      throw error;
    } finally { try{this.rootEndingClock?.lane.end();}finally{this.rootEndingClock=null; if(!suspended && this.manualIdentity){worldService.releaseTeleportOwner(this.manualIdentity.id);worldService.releaseGeneratedDialogOwner(this.manualIdentity.id);worldService.releaseCompositionOwner(this.manualIdentity.id);worldService.releaseScreenFadeOwner(this.manualIdentity.id);worldService.releaseEndingShowOwner(this.manualIdentity.id);worldService.releaseEndingAnimationOwner(this.manualIdentity.id);worldService.releaseEndingScrollOwner(this.manualIdentity.id);worldService.releaseEndingClockOwner(this.manualIdentity.id);}this.generatedDialogs.clear();this.generatedNativeEnds.clear();this.endingAnimations.clear();this.endingScrolls.clear();this.endingShows.clear();this.screenFades.clear();this.rngCursors.clear();this.sceneFades.clear();this.compositions.clear();this.timedFades.clear();this.fadeSources.clear();this.palettes.clear();this.redraws.clear();this.shopCursors.clear();this.shopResponse=null;this.manualExecution=false; this.manualRootEntryGranted=false; this.manualOwnedFrames.clear(); this.frameWaits.clear();this.motions.clear(); this.npcMotions.clear(); this.poisonCursors.clear(); this.equipmentCursors.clear(); this.partyEquipmentCursors.clear(); this.autoTailReturns.clear();this.teleportReturns.clear(); this.restoreFrames=[]; this.manualIdentity=null; this.inputResponse=null; this.dialogContext=null;this.restoreDialogLeaf=false;this.dialogActions.clear(); }}
  }
  private requireManualOwner(parentFrame?: ScriptExecutionFrame): void {
    if (!this.manualExecution) return;
    if (parentFrame && this.manualOwnedFrames.has(parentFrame.id)) return;
    if (!parentFrame && this.manualRootEntryGranted) { this.manualRootEntryGranted=false; return; }
    throw new Error('Manual execution context is busy; legacy entry is not owned by this chain');
  }
  private checkManualOpcode(sc:any,kind:'trigger'|'auto'): void {
    if (!this.manualExecution) return;
    const operation=sc.operation;
    if(operation===0x96&&!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending animation requires root clock'});
    if(operation===0xa4&&!this.endingScrolls.size&&ending.getEffectSpriteId()!==0&&!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending scroll nonzero effect requires root clock'});
    if([0x96,0xa4,0x76,0xa5,0x35,0x73,0x9b].includes(operation)&&(!sc.operand||sc.operand.length<3||!Array.from({length:sc.operand.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(sc.operand,i)&&Number.isInteger(sc.operand[i])&&sc.operand[i]>=0&&sc.operand[i]<=65535)))throw new ManualExecutionSignal({status:'unsupported',reason:'Screen source requires dense uint16 operands'});
    if([0x36,0x37,0x93,0x4e].includes(operation) && (!sc.operand || sc.operand.length<3 || !Array.from(sc.operand).every((v:any)=>Number.isSafeInteger(v)&&v>=0&&v<=0xffff)))throw new ManualExecutionSignal({status:'unsupported',reason:'Source opcode requires dense uint16 operands'});
    if([0x6d,0x6f,0x71].includes(operation) && (!sc.operand || !Number.isSafeInteger(sc.operand.length) || sc.operand.length<3 || !Array.from({length:sc.operand.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(sc.operand,i)&&Number.isInteger(sc.operand[i])&&sc.operand[i]>=0&&sc.operand[i]<=0xffff)))throw new ManualExecutionSignal({status:'unsupported',reason:'Atomic scene/event source requires dense uint16 operands'});
    if([0x24,0x25,0x7e].includes(operation) && (!sc.operand || !Number.isSafeInteger(sc.operand.length) || sc.operand.length<3 || !Array.from({length:sc.operand.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(sc.operand,i)&&Number.isInteger(sc.operand[i])&&sc.operand[i]>=0&&sc.operand[i]<=0xffff)))throw new ManualExecutionSignal({status:'unsupported',reason:'Atomic event metadata source requires dense uint16 operands'});
    if([0x2b,0x2c,0x2d,0x2f,0x5d,0x61].includes(operation) && (!sc.operand || !Number.isSafeInteger(sc.operand.length) || sc.operand.length<3 || !Array.from({length:sc.operand.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(sc.operand,i)&&Number.isInteger(sc.operand[i])&&sc.operand[i]>=0&&sc.operand[i]<=0xffff)))throw new ManualExecutionSignal({status:'unsupported',reason:'Atomic player status source requires dense uint16 operands'});
    if([0x1f,0x20,0x23].includes(operation) && (!sc.operand || !Number.isSafeInteger(sc.operand.length) || sc.operand.length<3 || !Array.from({length:sc.operand.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(sc.operand,i)&&Number.isInteger(sc.operand[i])&&sc.operand[i]>=0&&sc.operand[i]<=0xffff)))throw new ManualExecutionSignal({status:'unsupported',reason:'Atomic inventory/equipment source requires dense uint16 operands'});
    if([0x1b,0x1c,0x1d,0x22,0x5f,0x74].includes(operation) && (!sc.operand || !Number.isSafeInteger(sc.operand.length) || sc.operand.length<3 || !Array.from({length:sc.operand.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(sc.operand,i)&&Number.isInteger(sc.operand[i])&&sc.operand[i]>=0&&sc.operand[i]<=0xffff)))throw new ManualExecutionSignal({status:'unsupported',reason:'Atomic player vitals source requires dense uint16 operands'});
    // Palette80 returns without a Surface; its no-update and nonfunction-hook
    // paths paint only their own renderer and require no Scene pairing.
    const composes=operation!==0x80 || !!this.surface && !sc.operand[0] && typeof this.surface.sceneUpdateHook==='function';
    if(composes && [5,9,0x80,0x26,0x27,0x10,0x11,0x6c,0x7c,0x82,0x70,0x7a,0x7b,0x3f,0x44,0x97,0x7f].includes(operation)) {
      const sceneSurface=scene.surface || (globalThis as any).ui?.surface;
      // Missing and foreign Runner targets must reject before opcode effects.
      if(sceneSurface && sceneSurface!==this.surface)throw new ManualExecutionSignal({status:'unsupported',reason:'Scene composition requires the same Surface as its owned fade'});
    }
    const safe=[0x24,0x25,0x7e,0x1f,0x20,0x23,0x1b,0x1c,0x1d,0x22,0x5f,0x74,0x2b,0x2c,0x2d,0x2f,0x5d,0x61,0x6d,0x6f,0x71,0x38,0x34,0x96,0xa4,0x76,0xa5,0x35,0x73,0x9b,0x36,0x37,0x93,0x4e,0x50,0x51,0x4f,0x80,0x8c,0x70,0x7a,0x7b,0x3f,0x44,0x97,0x7f,0x10,0x11,0x6c,0x7c,0x82,0,1,2,3,4,6,8,9,0xa,0x4d,0xb,0xc,0xd,0xe,0xf,0x12,0x13,0x14,0x15,0x16,0x40,0x49,0x4b,0x4c,0x52,0x59,0x62,0x63,0x7d,0x87,0x85,0x1e,0x41,0x18,0x19,0x1a,0x72,0x78,0xa2,0xa7,0x28,0x29,0x75,0x26,0x27];
    if(kind==='trigger' && [5,0x8e].includes(operation))return;
    if(operation===0xffff || (kind==='trigger' && [0x3b,0x3c,0x3d,0x3e].includes(operation)))return;
    if(operation===0x34&&(!sc.operand||sc.operand.length<3||Array.from({length:sc.operand.length},(_,i)=>i).some(i=>!Object.prototype.hasOwnProperty.call(sc.operand,i)||!Number.isInteger(sc.operand[i])||sc.operand[i]<0||sc.operand[i]>65535)))throw new ManualExecutionSignal({status:'unsupported',reason:'Generated source requires dense uint16 operands'});
    if (!safe.includes(operation)) {
      throw new ManualExecutionSignal({status:'unsupported',reason:`Opcode 0x${operation.toString(16)} cannot be manually resumed in ${kind} execution`});
    }
  }
  private validateOwnedNpcMotion(c:ScriptDelayCheckpoint):string|null {
    const f=c.frames.find(f=>f.npcMotion),m=f?.npcMotion;if(!m || !f)return null;
    const base=f.eventId>0?f.eventId:null,evt=base?this.getEventObjectById(base):null;
    const target=this.resolveEventTarget(m.operands[0],base);
    const targetId=m.operation===0x6c?(target.id??base??0):f.eventId;
    const current=m.operation===0x6c?(target.object||(target.id===base?evt:null)):evt;
    return targetId!==m.targetId || !!current!==m.targetPresent ? 'NPC target selection does not match world data' : null;
  }
  private ownedCodec():DialogCodec {
    const codec=ui.getDialogCodec?.();
    if(!codec || typeof codec.bytes!=='function' || typeof codec.decode!=='function' || typeof codec.publish!=='function')throw new ManualExecutionSignal({status:'unsupported',reason:'Native dialog codec is unavailable'});
    return codec;
  }
  private ownedContext():DialogContext {
    return this.dialogContext??=createDialogContext(ui.getDialogPresentationMode?.()==='suppressed'?'suppressed':'classic');
  }
  private messageForId(id:number):unknown {
    if(storyGraphService.isStoryGraphMode() && storyGraphService.getFullGameGraph()) {
      const msg=storyGraphService.getMessageText(getSceneIdSnapshot(),id);if(msg!==null)return msg;
    }
    return ui.getMsg(id);
  }
  private validateOwnedDialog(c:ScriptDelayCheckpoint):string|null {
    if(!c.dialog?.cursor)return null;
    if(dialogService.hasInjectedLine(line=>!Number.isFinite(line.expiresAt as number) || line.expiresAt!>Date.now()))return 'Injected native dialog is not yet supported by owned presentation';
    const t=c.dialog.cursor,sc=scriptObjectAdapter.getScriptEntry(t.opcodePC);
    try {
      if(!sc || sc.operation!==0xffff || JSON.stringify(Array.from(sc.operand))!==JSON.stringify(t.operands) || !validateDialogText(c.dialog,this.ownedCodec(),this.messageForId(sc.operand[0])))return 'Dialog source or progress does not match';
      if(c.version===2 && c.wait.kind==='dialog-time' && c.wait.phase==='inline') {
        const b=t.raw,o=t.byteOffset-3,ms=parseInt(String.fromCharCode(b[o+1],b[o+2]))*80/7;
        if(b[o]!==126 || ms!==c.wait.requestedMs)return 'Inline delay does not match dialog bytes';
      }
    }catch{return 'Dialog source or codec is unavailable';}
    return null;
  }
  private clearBeforeOpcode(frame:ScriptExecutionFrame,sc:any):void {
    if(!this.dialogContext)return;
    const saved=this.dialogActions.get(frame.id);
    if(saved){this.dialogActions.delete(frame.id);return;}
    if(this.dialogContext.line>0) {
      this.dialogActions.set(frame.id,{phase:'clear',opcodePC:frame.currentPC,operation:sc.operation,operands:Array.from(sc.operand),ended:false,continuationPC:frame.continuationPC});
      this.captureWait(dialogAdvance(frame.currentPC,sc.operand,'clear'));
    }
    clearOwnedDialog(this.dialogContext);
  }
  private showOwnedText(frame:ScriptExecutionFrame,sc:any):void {
    if(dialogService.hasInjectedLine(line=>!Number.isFinite(line.expiresAt as number) || line.expiresAt!>Date.now()))throw new ManualExecutionSignal({status:'unsupported',reason:'Injected native dialog is not yet supported by owned presentation'});
    const payload=this.messageForId(sc.operand[0]);
    if(!payload){frame.currentPC++;return;}
    const c=this.ownedContext(),codec=this.ownedCodec();
    if(!c.cursor)beginDialogLine(c,frame.currentPC,payload,codec,Array.from(sc.operand));
    let wait:ReturnType<typeof advanceDialogLine>;
    try{wait=advanceDialogLine(c,codec);}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:error instanceof Error?error.message:'Unsupported dialog bytes'});}
    if(wait) {
      if(wait.kind==='dialog-time')this.captureWait(wait);
      this.captureWait(dialogAdvance(frame.currentPC,sc.operand,wait.phase));
    }
    frame.currentPC++;
  }
  private generatedDomain():GeneratedDomainBinding {
    const s=this.surface as any,actualUi=(globalThis as any).ui,cap=actualUi&&nativeTextCapability(actualUi);
    if(!s||!cap||generatedOwnData(actualUi,'getNativeTextRuntimeBinding')!==cap.read)throw new Error('Generated dialog requires initialized actual text');
    const t=cap.read(),pixels=acquireOwnedCanvasPixels(s.ctx,s.width,s.height);
    if(t.surface!==s||t.ui!==actualUi||t.text!==(globalThis as any).text||!pixels||s.width!==320||s.height!==200||s.pitch!==320)throw new Error('Generated dialog requires matching actual Surface and trusted pixels');
    const scripts=readGeneratedScripts(),stores=readGeneratedStores(),service=readGeneratedService(),services=generatedOwnData(actualUi,'services'),adapter=generatedOwnData(services,'script'),installed=generatedOwnData(adapter,'module');
    if(!installed||generatedOwnData(services,'world')!==worldService)throw new Error('Generated dialog requires its actual installed script adapter');
    const sceneCapability=getGeneratedSceneCapability(),actualScene=generatedOwnData(globalThis,'scene'),actualComposer=generatedOwnData(actualScene,'makeScene'),actualGestures=generatedOwnData(actualScene,'updatePartyGestures'),callableScene=typeof actualComposer==='function';
    if(callableScene&&(actualScene!==scene||actualComposer!==sceneCapability.makeScene||scene.updatePartyGestures!==sceneCapability.updatePartyGestures||generatedSceneService.makeScene!==sceneCapability.serviceMakeScene||generatedSceneService.render!==sceneCapability.serviceRender||generatedSceneService.updatePartyGestures!==sceneCapability.serviceGestures))throw new Error('Generated dialog requires installed Native Scene composer capability');
    if(callableScene&&generatedOwnData(generatedSceneService,'surface')!==s)throw new Error('Generated installed Scene requires the same actual Surface before effects');
    const mode=(globalThis as any).window?.PAL_OVERLAY_ACTIVE==='panorama'||(nativePanorama as any).mode==='panorama'?'suppressed':'classic';
    return {surface:s,ui:actualUi,
      refs:[actualUi,cap,services,adapter,installed,t.text,t.surface,s.ctx,s.byteBuffer,s.backup,pixels,this.endingClockCapability,t.decoder,t.bytes,t.decode,t.wordBuffer,t.messageBuffer,t.offsets,t.dialogIcons,t.dialogIconsBuffer,t.font.surface,t.font.glyphs,t.font.ascii,t.font.dictionary,t.font.drawChar,t.font.drawASCIIChar,...t.resources,...Object.values(t.methods),scripts.entries,scripts.objects,scripts.getScriptEntry,scripts.getScriptGetter,scripts.getObjectEntry,scripts.getObjectGetter,scripts.getRuntimeBinding,scripts.getRuntimeGetter,stores.table,stores.getStoreEntry,stores.getStoreGetter,stores.getRuntimeStoreBinding,stores.getRuntimeGetter,...Object.values(service.methods),...service.signals,...service.signalBindings,actualScene,actualComposer,actualGestures,scene,generatedOwnData(generatedSceneService,'surface'),Object.getOwnPropertyDescriptor(scene,'surface')?.get,Object.getOwnPropertyDescriptor(scene,'surface')?.set,scene.makeScene,scene.updatePartyGestures,generatedSceneService.makeScene,generatedSceneService.render,generatedSceneService.updatePartyGestures,(globalThis as any).window?.PAL_PANORAMA,(globalThis as any).window?.PAL_PANORAMA?.getMode,generatedOwnData(Palette,'get'),(globalThis as any).randomLong,inputService.clear,inputService.isSimulatedInputActive,(globalThis as any).input,s.updateScreen,s.getPalette,s.setPalette,s.blitRLE,s.getRect,s.putRect,s.setPixel,s.ctx.getImageData,s.ctx.putImageData,s.panoramaHandler,generatedOwnData(actualUi,'sprite'),generatedOwnData(generatedOwnData(actualUi,'sprite'),'frames'),generatedOwnData(actualUi,'numFrames'),generatedOwnData(actualUi,'SPRITENUM_ITEMBOX'),Files.BALL,Files.BALL&&Object.getOwnPropertyDescriptor(Files.BALL,'readChunk')?.value,Files.BALL&&Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Files.BALL),'readChunk')?.value],
      values:{generation:t.generation,mode,width:s.width,height:s.height,pitch:s.pitch,allowSimulated:inputService.allowSimulatedConfirm,globalSimulated:(globalThis as any).PAL_ALLOW_SIMULATED_DIALOG===true}};
  }
  private generatedPhysical(callbacks=false):GeneratedObservation {
    const s=this.surface as any,pixels=acquireOwnedCanvasPixels(s.ctx,s.width,s.height);
    if(!pixels)throw new Error('Generated dialog pixel capability changed');
    if(callbacks){s.getPalette();s.ctx.getImageData(0,0,s.width,s.height);}
    const rgba=pixels.read(),text=nativeTextCapability((globalThis as any).ui)!.read(),service=readGeneratedService();
    return {refs:[s,s.ctx,s.byteBuffer,s.backup,s.palette,pixels,pixels.target,text.faceBackup,text.faceRect,text.faces,service.status,service.current,service.history,service.choice,service.pending,service.injected],values:{front:generatedBytes(s.byteBuffer)?.digest,backup:generatedBytes(s.backup)?.digest,palette:generatedPlain(s.palette),rgba:generatedBytes(rgba)?.digest,shake:generatedOwnData(NativeSurface,'shakeTime'),level:generatedOwnData(NativeSurface,'shakeLevel')}};
  }
  private generatedState():unknown {
    const actualUi=(globalThis as any).ui,cap=nativeTextCapability(actualUi);
    if(!cap)throw new Error('Generated text capability expired');
    const t=cap.read(),d=readGeneratedService();
    return {text:generatedPlain(t.presentation),service:generatedPlain({status:d.status,current:d.current,history:d.history,choice:d.choice,pending:d.pending,injected:d.injected}),rng:getRandomState()};
  }
  private syncGeneratedTextContext(c:GeneratedDialogCursor,publish=false):void {
    const native=nativeTextCapability((globalThis as any).ui)!.read().presentation;
    const context=this.dialogContext??=createDialogContext(c.mode);
    if(context.cursor)throw new ManualExecutionSignal({status:'unsupported',reason:'Generated source cannot adopt an active sibling text cursor'});
    Object.assign(context,{mode:c.mode,position:native.position,portrait:native.face,color:native.color,speed:native.delayTime,icon:native.icon,line:native.line,skip:native.skip,playingRNG:native.playingRNG,speaker:native.speaker,faces:{...native.faces}});
    if(publish){const actual=readGeneratedService().current;
      if(!actual||actual.scriptEntry!==c.opcodePC||actual.eventObjectId!==c.eventId||actual.source!==null)throw new ManualExecutionSignal({status:'unsupported',reason:'Generated native publication does not match its source'});
      context.publications.push({text:actual.text,source:actual.source,line:actual.line??native.line,sequence:++context.sequence,opcodePC:c.opcodePC,position:native.position,portrait:native.face,mode:c.mode,color:native.color,speed:native.delayTime,title:false,renderLine:native.line,raw:c.raw!.slice(),byteOffset:c.raw!.length,glyphs:0,pixels:0});
    }
  }
  private generatedWaitWork(c:GeneratedDialogCursor,anchor=false):void {
    const scope=generatedDialogLeases(this.surface!),lane=this.rootEndingClock?.lane;
    if(!lane){if(anchor)scope.setWork(c.lease,{anchor:null,childElapsedUnits:'0',sourceElapsedUnits:'0'});return;}
    let offset:string;try{lane.sample();offset=lane.elapsedUnits;}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
    if(anchor){scope.setWork(c.lease,{anchor:offset,childElapsedUnits:'0',sourceElapsedUnits:'0'});c.activeWorkMs=0;return;}
    const work=scope.getWork(c.lease) as {anchor:string|null;childElapsedUnits:string;sourceElapsedUnits:string}|undefined;
    if(work?.anchor!==null&&work?.anchor!==undefined){const elapsed=endingClockRound(BigInt(offset)-BigInt(work.anchor)-BigInt(work.sourceElapsedUnits)-BigInt(work.childElapsedUnits));if(!Number.isFinite(elapsed)||elapsed<0)throw new ManualExecutionSignal({status:'unsupported',reason:'Generated source work contribution changed'});c.activeWorkMs=elapsed;}
  }
  private generatedFixed(c:GeneratedDialogCursor):unknown {
    return {source:c.source,operation:c.operation,opcodePC:c.opcodePC,nextPC:c.nextPC,operands:c.operands,ownerKind:c.ownerKind,eventId:c.eventId,mode:c.mode,collectBound:c.collectBound,sample:c.sample,cap:c.cap,index:c.index,itemId:c.itemId,word42:c.word42,wordItem:c.wordItem,raw:c.raw,hasBox:c.hasBox,rect:c.rect,offsetX:c.offsetX,offsetY:c.offsetY,shadow:c.shadow};
  }
  private generatedDialogClockFence(cp:ScriptDelayCheckpoint,context:EndingClockRestoreContext|null):string|null {
    if(!cp.frames.some(f=>f.generatedDialog||f.generatedNativeEnd))return null;
    try{
      context?.lane.validateCounter();
      if(this.manualExecution||this.executionRuntime.snapshot().activeFrames.length)return 'Generated execution context changed during final counter';
      if(context){const reason=this.rootClockContextReason(cp,context);if(reason)return reason;}
      return null;
    }catch(error){return (error as Error).message;}
  }
  private validateGeneratedDialogs(cp:ScriptDelayCheckpoint,callbacks=true):string|null {
    if(!cp.frames.some(f=>f.generatedDialog||f.generatedNativeEnd)&&!worldService.hasGeneratedDialogOwner(cp.id))return null;
    try{if(!callbacks){const plain=(o:any,keys:string[])=>{for(const key of keys){let base=o;while(base){const d=Object.getOwnPropertyDescriptor(base,key);if(d){if(d.get||d.set)throw new Error('Generated final binding is not a pure data field: '+key);break;}base=Object.getPrototypeOf(base);}}};plain(globalThis,['ui','text','scene','input','window','PAL_ALLOW_SIMULATED_DIALOG','GameSpeed']);plain(this.surface,['ctx','width','height','pitch','byteBuffer','backup','palette','updateScreen','getPalette','setPalette','blitRLE','getRect','putRect','panoramaHandler']);plain((this.surface as any)?.ctx,['getImageData','putImageData']);plain(inputService,['clear','isSimulatedInputActive','allowSimulatedConfirm']);plain(nativePanorama,['mode']);plain((globalThis as any).scene,['makeScene','updatePartyGestures']);plain(scene,['makeScene','updatePartyGestures']);plain(generatedSceneService,['surface','makeScene','render','updatePartyGestures']);plain((globalThis as any).window,['PAL_OVERLAY_ACTIVE','PAL_PANORAMA']);plain((globalThis as any).window?.PAL_PANORAMA,['getMode']);}
    for(const f of cp.frames)if(f.generatedDialog){const c=f.generatedDialog,scope=generatedDialogLeases(this.surface!);
      const domain=this.generatedDomain();if(!scope.resolve(c.lease,cp.id,domain))return 'Generated native resource parent or domain binding changed';
      const physical=this.generatedPhysical(callbacks),state=this.generatedState(),reads=scope.observeReads(c.lease);
      if(!scope.matches(c.lease,cp,domain,physical,state,reads,(c.site==='preclear'?undefined:this.generatedFixed(c))))return 'Generated dialog source, pixels or published checkpoint changed';
    }
    const scope=generatedDialogLeases(this.surface!);
    if(scope.hasRoot(cp.id)){
      for(const [i,f]of cp.frames.entries())if(!sameJsonValue(scope.nativeFrame(cp.id,i)??null,f.generatedNativeEnd??null))return 'Generated native parent ownership changed';
      if(!scope.matchesRoot(cp.id,cp,this.generatedDomain(),this.generatedPhysical(callbacks),this.generatedState()))return 'Generated native root source, presentation or whole checkpoint changed';
    }else if(cp.frames.some(f=>f.generatedNativeEnd)||worldService.hasGeneratedDialogOwner(cp.id)&&!cp.frames.some(f=>f.generatedDialog))return 'Missing actual generated native root lease';
    return null;}catch(error){return (error as Error).message;}
  }
  private publishGeneratedDialogs(cp:ScriptDelayCheckpoint):void {
    if(!cp.frames.some(f=>f.generatedDialog||f.generatedNativeEnd)&&!worldService.hasGeneratedDialogOwner(cp.id))return;
    for(const f of cp.frames)if(f.generatedDialog){const c=f.generatedDialog,scope=generatedDialogLeases(this.surface!);
      const domain=this.generatedDomain(),physical=this.generatedPhysical(),state=this.generatedState(),reads=scope.observeReads(c.lease);
      scope.publish(c.lease,cp,domain,physical,state,reads,c.site==='preclear'?undefined:this.generatedFixed(c));
    }
    const scope=generatedDialogLeases(this.surface!);if(scope.hasRoot(cp.id))scope.publishRoot(cp.id,cp,this.generatedDomain(),this.generatedPhysical(),this.generatedState());
  }
  private async runManualGeneratedDialog(frame:ScriptExecutionFrame,sc:any):Promise<number> {
    let c=this.generatedDialogs.get(frame.id),scope=generatedDialogLeases(this.surface!);
    const unsupported=(reason:string):never=>{throw new ManualExecutionSignal({status:'unsupported',reason});};
    const domain=()=>{try{return this.clockMetadata(()=>this.generatedDomain());}catch(error){return unsupported((error as Error).message);}};
    const guard=()=>{if(!scope.resolve(c!.lease,this.manualIdentity!.id,domain())||!scope.readsMatch(c!.lease,scope.observeReads(c!.lease)))unsupported('Generated native binding changed during prefix');};
    if(!c){
      const b=domain();
      if(dialogService.hasInjectedLine(line=>!Number.isFinite(line.expiresAt as number)||line.expiresAt!>Date.now()))unsupported('Generated dialog does not own injected lines');
      const lease=scope.acquire(this.manualIdentity!.id,b);worldService.registerGeneratedDialogReferenceScope(scope);
      c=createGeneratedDialogCursor(frame.currentPC,sc,frame.kind as 'auto'|'trigger',frame.eventId,(b.values as any).mode,lease);this.generatedDialogs.set(frame.id,c);
      const sourceObserve=generatedResourceObserver(sc,()=>generatedOwnData(readGeneratedScripts().entries,String(c!.opcodePC)));scope.captureRead(c.lease,'opcode',sourceObserve(),sourceObserve);
      for(const [i,parent]of this.executionRuntime.snapshot().activeFrames.entries())if(parent.kind==='trigger'){const marker={sourcePC:c.opcodePC,sourceEventId:c.eventId,sourceKind:c.ownerKind};this.generatedNativeEnds.set(parent.id,marker);scope.markNativeFrame(this.manualIdentity!.id,i,marker,b);}
    }
    if(c.phase==='poll-check'){this.generatedWaitWork(c);guard();}
    if(c.site==='preclear'&&c.phase==='poll-check'){
      const wait=scope.getPrefixes(c.lease).wait;
      // clearDialog(true) calls native dialogWaitForKey() with maxSeconds=0.
      // Its elapsed progress never creates a timeout; only an eligible key ends it.
      ui.rotateGeneratedDialogWaitPalette(wait);guard();const accepted=ui.checkGeneratedDialogInput(wait,c.acknowledged);c.acknowledged=false;guard();
      if(accepted){ui.finishGeneratedDialogWait(wait);guard();ui.finishGeneratedDialogClear();guard();c.phase='preclear';c.elapsedMs=0;c.activeWorkMs=0;c.requestedMs=0;c.remainingMs=0;}
      else {c.poll++;c.phase=c.mode==='suppressed'?'gesture':'poll-sleep';if(c.mode==='classic'){c.gameSpeed=(globalThis as any).GameSpeed;c.requestedMs=100/c.gameSpeed!;c.remainingMs=c.requestedMs;this.captureWait(generatedDialogWait(c));}}
    }
    if(c.phase==='preclear'){
      if(frame.kind==='trigger'&&c.poll===0){
        const wait=ui.prepareGeneratedDialogClear(()=>this.generatedWaitWork(c!,true));guard();
        if(wait){scope.bindWaitPrefix(c.lease,wait);this.generatedWaitWork(c);guard();c.poll=1;c.phase=c.mode==='suppressed'?'gesture':'poll-sleep';if(c.mode==='classic'){c.gameSpeed=(globalThis as any).GameSpeed;c.requestedMs=100/c.gameSpeed!;c.remainingMs=c.requestedMs;this.captureWait(generatedDialogWait(c));}}
        else {ui.finishGeneratedDialogClear();guard();}
      }
      if(c.phase==='preclear'){
      const collect=getCollectValueFlagValue();guard();
      if(collect<=0){scope.sealRootSource(this.manualIdentity!.id,c.lease);worldService.releaseGeneratedDialogReference(scope,c.lease);this.generatedDialogs.delete(frame.id);return sc.operand[0];}
      c.collectBound=collect;c.sample=randomLong(1,collect);guard();c.cap=Math.min(c.sample,9);
      worldService.adjustCollectValue(-c.cap);guard();c.index=c.cap-1;
      c.itemId=this.getStoreItemId(0,c.index,store=>{const observe=generatedResourceObserver(store,()=>generatedOwnData(readGeneratedStores().table,'0'));scope.captureRead(c!.lease,'store',observe(),observe);});guard();
      if(c.itemId)this.addItemToInventory(c.itemId,1);guard();
      ui.setDialogShadow(5);guard();ui.startDialog(DialogPosition.CenterWindow,0,0,false,0,-10);guard();
      const captureWord=(id:number,raw:any,site:string)=>{const observe=generatedResourceObserver(raw,()=>{const text=nativeTextCapability((globalThis as any).ui)!.read(),cached=generatedOwnData(text.wordCache,String(id));return cached===undefined?raw:cached;});scope.captureRead(c!.lease,site,observe(),observe);};
      const word42=ui.getWord(42);c.word42=Array.from(word42 as ArrayLike<number>);captureWord(42,word42,'word42');guard();
      const wordItem=ui.getWord(c.itemId);c.wordItem=Array.from(wordItem as ArrayLike<number>);captureWord(c.itemId!,wordItem,'wordItem');guard();
      c.raw=c.word42.concat([64],c.wordItem,[64]);this.drawCollectedItemBox(c.itemId!,(site,value,current,bitmap)=>{const observe=site==='item-object'?generatedItemBitmapObserver(value,bitmap!,current):generatedResourceObserver(value,current);scope.captureRead(c!.lease,site,observe(),observe);guard();});guard();
      dialogService.setPendingLineMetadata({scriptEntry:c.opcodePC,eventObjectId:c.eventId,source:'collect-transform',metadata:{storeItemId:c.itemId}});guard();
      const fontObserve=()=>{const f=nativeTextCapability((globalThis as any).ui)!.read().font;return {refs:[f.surface,f.glyphs,f.ascii,f.dictionary,f.drawChar,f.drawASCIIChar],values:{glyphs:generatedBytes(f.glyphs)?.digest,ascii:generatedPlain(f.ascii),dictionary:generatedPlain(f.dictionary)}};};
      let fontCaptured=false,renderRead=0;
      const observeRender=(site:string,index:number|null,value:any)=>{
        if(site==='font'){if(!fontCaptured){scope.captureRead(c!.lease,'font',fontObserve(),fontObserve);fontCaptured=true;}guard();return;}
        const current=()=>{if(site==='box-handle')return value;const u=(globalThis as any).ui;if(site==='box-frame'){const frames=generatedOwnData(generatedOwnData(u,'sprite'),'frames');return generatedOwnData(frames,String(index));}const frames=generatedOwnData(generatedOwnData(u,'numFrames'),String(Math.floor(index!/10)));return generatedOwnData(frames,String(index!%10));};
        const observe=generatedResourceObserver(value,current);scope.captureRead(c!.lease,`${site}-${++renderRead}`,observe(),observe);guard();
      };
      const renderer=await resolveUiTask<any>(ui.prepareGeneratedDialog(c.raw,observeRender));guard();scope.bindRendererPrefix(c.lease,renderer);
      c.site='generated';c.hasBox=!!renderer.box;c.rect=renderer.rect;c.phase='wait-enter';this.syncGeneratedTextContext(c,true);
      const publication=readGeneratedService().current,publicationObserve=generatedResourceObserver(publication,()=>publication);scope.captureRead(c.lease,'publication',publicationObserve(),publicationObserve);
      scope.completePrefix(c.lease,this.generatedFixed(c));
      const wait=ui.beginGeneratedDialogWait(()=>this.generatedWaitWork(c!,true));guard();scope.bindWaitPrefix(c.lease,wait);this.generatedWaitWork(c);guard();
      c.poll=1;c.phase=c.mode==='suppressed'?'gesture':'poll-sleep';if(c.mode==='classic'){c.gameSpeed=(globalThis as any).GameSpeed;c.requestedMs=100/c.gameSpeed!;c.remainingMs=c.requestedMs;this.captureWait(generatedDialogWait(c));}
      }
    }
    guard();
    if(c.site==='generated'&&c.phase==='poll-check'){
      const timedOut=c.mode==='classic'&&c.elapsedMs+c.activeWorkMs>1400;
      if(timedOut)c.phase='wait-exit';
      else {const wait=scope.getPrefixes(c.lease).wait;ui.rotateGeneratedDialogWaitPalette(wait);guard();const accepted=ui.checkGeneratedDialogInput(wait,c.acknowledged);c.acknowledged=false;guard();if(accepted)c.phase='wait-exit';else {c.poll++;c.phase=c.mode==='suppressed'?'gesture':'poll-sleep';}}
    }
    if((c.phase==='gesture'||c.phase==='compose'||c.phase==='screen')&&typeof generatedOwnData(generatedOwnData(globalThis,'scene'),'makeScene')!=='function')c.phase='poll-sleep';
    if(c.phase==='gesture'||c.phase==='compose'||c.phase==='screen'){
      try{if(c.phase==='gesture'){scene.updatePartyGestures(false,{preserveFrames:true});guard();c.phase='compose';}
        if(c.phase==='compose'){await this.runOwnedCompose(frame,sc,'generated-dialog-poll');guard();c.phase='screen';}
        if(c.phase==='screen'){this.surface!.updateScreen(null);guard();}
      }catch(error){if(error instanceof ManualExecutionSignal)throw error;guard();}
      c.phase='poll-sleep';
    }
    if(c.phase==='poll-sleep'){c.gameSpeed=(globalThis as any).GameSpeed;c.requestedMs=100/c.gameSpeed!;c.remainingMs=c.requestedMs;this.captureWait(generatedDialogWait(c));}
    if(c.phase==='wait-exit'){
      ui.finishGeneratedDialogWait(scope.getPrefixes(c.lease).wait);guard();c.phase='generated-end';
      await resolveUiTask(ui.finishGeneratedDialog(scope.getPrefixes(c.lease).renderer));guard();c.phase='shadow-reset';
      ui.setDialogShadow(0);guard();this.syncGeneratedTextContext(c);c.phase='done';scope.sealRootSource(this.manualIdentity!.id,c.lease);worldService.releaseGeneratedDialogReference(scope,c.lease);this.generatedDialogs.delete(frame.id);return c.nextPC;
    }
    return unsupported('Invalid generated dialog continuation phase');
  }
  private fadeAsset(args:Extract<TimedFadeArgs,{family:'in'}>):any {
    try {const entry=(Palette as any).get(args.paletteId);return Array.isArray(entry)?entry:entry && Array.isArray(entry.day)?(args.night?(entry.night||entry.day):entry.day):null;}catch{return null;}
  }
  private validateOwnedFades(cp:ScriptDelayCheckpoint):string|null {
    for(const f of cp.frames)if(f.timedFade) {
      if(!this.surface || typeof this.surface.setPalette!=='function' || typeof this.surface.getPalette!=='function')return 'Fade checkpoint requires a matching Surface';
      const c=f.timedFade;
      if(!sameJsonValue(this.surface.getPalette(),c.working))return 'Fade physical palette does not match saved paint';
      if(c.args.family==='in') {const target=this.fadeAsset(c.args);if(!denseFadePalette(target)||!sameJsonValue(target,c.base))return 'Fade source asset does not match saved palette';}
    }
    try{if(cp.frames.some(f=>f.timedFade || f.fadeSource && (f.fadeSource.operation!==0x4e || !!this.surface)))fadeInterval((globalThis as any).FrameTime,(globalThis as any).GameSpeed);}catch(error){return (error as Error).message;}
    return null;
  }
  /** Real helper child, reusable by owned scene composition. It never enters a script row. */
  private async runOwnedFade(args:TimedFadeArgs,parentFrame?:ScriptExecutionFrame):Promise<void> {
    this.requireManualOwner(parentFrame);
    const frame=this.executionRuntime.begin('fade',0,0,parentFrame?.id??null,this);
    this.manualOwnedFrames.add(frame.id);
    const restored=this.restoreFrames.shift();if(!this.restoreFrames.length)this.rootEndingClock?.lane.begin();let completed=true;
    try {
      if(!this.surface)return;
      let c=restored?.timedFade;
      if(!c) {
        if(args.family==='out' && args.time<=0)return;
        const base=args.family==='in'?this.fadeAsset(args):this.surface.getPalette();
        if(args.family==='in' && (!base || base.length<256)){this.surface.setPalette(this.surface.palette || Array.from({length:256},(_,i)=>({r:i,g:i,b:i})),true);return;}
        if(args.time<=0){this.surface.setPalette(base,true);return;}
        try{const frameTime=(globalThis as any).FrameTime,gameSpeed=(globalThis as any).GameSpeed;c=this.clockMetadata(()=>createTimedFadeCursor(args,base,frameTime,gameSpeed));}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
      }
      this.timedFades.set(frame.id,c);
      paintTimedFade(c,(globalThis as any).FrameTime,(globalThis as any).GameSpeed);
      if(c.phase==='sleep') {
        this.surface.setPalette(c.working);
        // Surface.sleep(FrameTime) evaluates native configuration after the implicit repaint.
        c.frameTime=(globalThis as any).FrameTime;c.gameSpeed=(globalThis as any).GameSpeed;
        try{c.requestedMs=fadeInterval(c.frameTime,c.gameSpeed);}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
        c.remainingMs=c.requestedMs;frame.status='waiting';this.captureWait({kind:'timed-fade',...c});
      }
      this.surface.setPalette(c.base,true);
    }catch(error){completed=false;throw error;}finally{this.timedFades.delete(frame.id);this.manualOwnedFrames.delete(frame.id);this.executionRuntime.finish(frame,completed);}
  }
  private validateWorldCompositions(cp:ScriptDelayCheckpoint):string|null {
    for(const f of cp.frames) {
      const u=f.frameWait?.worldUpdate || f.motion?.worldUpdate || f.palette?.worldUpdate,c=u?.composition;
      if(!c)continue;
      if(c.site==='proximity-compose' && (!c.lease || !worldService.resolveCompositionReference(c.lease,cp.id,{...c,site:'proximity-compose'})))return 'Missing, foreign or expired World composition reference';
    }
    return null;
  }
  private transferWorldCompositions(cp:ScriptDelayCheckpoint,next:string):void {
    worldService.transferGeneratedDialogOwner(cp.id,next);
    for(const f of cp.frames)if(f.generatedDialog)f.generatedDialog.lease.owner=next;
    worldService.transferCompositionOwner(cp.id,next);
    worldService.transferScreenFadeOwner(cp.id,next);
    worldService.transferEndingAnimationOwner(cp.id,next);
    worldService.transferEndingScrollOwner(cp.id,next);
    worldService.transferEndingShowOwner(cp.id,next);
    worldService.transferEndingClockOwner(cp.id,next);
    if(cp.clock){cp.clock.lease.owner=next;if(this.rootEndingClock)this.rootEndingClock.lease.owner=next;}
    for(const f of cp.frames)if(f.endingAnimation)f.endingAnimation.lease!.owner=next;
    for(const f of cp.frames)if(f.endingScroll)f.endingScroll.lease!.owner=next;
    for(const f of cp.frames)if(f.endingShow)f.endingShow.lease!.owner=next;
    for(const f of cp.frames)if(f.screenFade?.screen)f.screenFade.screen.lease.owner=next;
    for(const f of cp.frames) {
      const lease=f.frameWait?.worldUpdate?.composition?.lease;if(lease)lease.owner=next;
      if(f.parentReturn?.kind==='world-compose-fade' && f.parentReturn.selection.lease)f.parentReturn.selection.lease.owner=next;
    }
  }
  private async runOwnedCompose(frame:ScriptExecutionFrame,sc:any,source:ComposeSource):Promise<void> {
    const sceneSurface=scene.surface || (globalThis as any).ui?.surface;
    const screenNoScene=source==='screen-fade' && !getSceneEntrySnapshot(getSceneIdSnapshot());
    if(!screenNoScene && sceneSurface && sceneSurface!==this.surface)throw new ManualExecutionSignal({status:'unsupported',reason:'Scene composition requires the same Surface as its owned fade'});
    const pending=this.compositions.get(frame.id);
    if(pending) {
      frame.status='waiting';await this.runOwnedFade(pending.args,frame);frame.status='running';
      worldService.setNeedToFadeIn(false);this.compositions.delete(frame.id);return;
    }
    await co(scene.makeScene(async(target,paletteId,night)=>{
      if((target as unknown)!==this.surface)throw new ManualExecutionSignal({status:'unsupported',reason:'Scene composition requires the same Surface as its owned fade'});
      const c=this.clockMetadata(()=>createComposeCursor(source,frame.currentPC,sc,{family:'in',time:1,paletteId,night}));
      this.compositions.set(frame.id,c);frame.status='waiting';await this.runOwnedFade(c.args,frame);frame.status='running';
      this.compositions.delete(frame.id);
    }));
  }
  private async runManualFadeOpcode(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    if(sc.operation!==0x4e || this.surface)try{fadeInterval((globalThis as any).FrameTime,(globalThis as any).GameSpeed);}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
    let c=this.fadeSources.get(frame.id);
    if(!c){c={opcodePC:frame.currentPC,nextPC:sc.operation===0x4e?0:frame.currentPC+1,operation:sc.operation,operands:Array.from(sc.operand),phase:'clear',args:null,needFade:sc.operation===0x50};this.fadeSources.set(frame.id,c);}
    if(c.phase==='clear') {
      if(frame.kind==='trigger')this.clearBeforeOpcode(frame,sc);if(sc.operation!==0x4e)this.surface?.updateScreen(null);
      const time=SHORT(sc.operand[0]);
      c.args=sc.operation===0x4e?{family:'out',time:1}:sc.operation===0x50?{family:'out',time:sc.operand[0]||1}:{family:'in',time:time>0?time:1,paletteId:getPaletteIdSnapshot(),night:isNightPaletteEnabled()};c.phase='child';
    }
    frame.status='waiting';await this.runOwnedFade(c.args!,frame);frame.status='running';
    if(sc.operation===0x4e)play.reloadInNextTick(worldService.getCurrentSaveSlot());else worldService.setNeedToFadeIn(c.needFade);this.fadeSources.delete(frame.id);
  }
  private rngClock():number {
    const p=globalThis.performance;
    if(!p||typeof p.now!=='function')throw new Error('Owned RNG requires continuous performance.now');
    const n=p.now();if(!Number.isFinite(n))throw new Error('Owned RNG requires a finite continuous clock');return n;
  }
  private rngWork(anchor:number):number {const d=this.rngClock()-anchor;if(!Number.isFinite(d)||d<0)throw new Error('Owned RNG clock must be monotonic');return d;}
  private validateOwnedRng(cp:ScriptDelayCheckpoint):string|null {
    try {for(const f of cp.frames)if(f.rng){this.rngWork(this.rngClock());if(!rngService.matchesOwnedTarget(this.surface))return 'RNG requires a matching Surface';if(!sameJsonValue(rngService.getVideoContentIdentity(f.rng.rngNum),f.rng.asset))return 'RNG video content does not match checkpoint';if(!sameJsonValue(rngService.getFrontBinding(this.surface),f.rng.front))return 'RNG front buffer does not match checkpoint';}}catch(error){return (error as Error).message;}
    return null;
  }
  private async runManualRng(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.rngCursors.get(frame.id);
    if(!c){
      // This method is reached after generic dialog ACK, so resource/target decisions are deliberately late.
      const rngNum=worldService.getCurPlayingRng() as number,start=sc.operand[0],end=sc.operand[1]>0?sc.operand[1]:999;
      if(start>end||rngNum<0||!rngService.hasTarget())return;
      try {this.rngWork(this.rngClock());if(!rngService.matchesOwnedTarget(this.surface))throw new Error('RNG requires a matching Surface');
        const asset=this.clockMetadata(()=>rngService.getVideoContentIdentity(rngNum));if(!asset)return;
        c=this.clockMetadata(()=>createRngCursor(frame.currentPC,sc,rngNum,asset,rngService.getFrontBinding(this.surface)));
      }catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
      this.rngCursors.set(frame.id,c);
    }
    if(c.phase==='sleep'){c.frame++;c.phase='blit';c.remainingMs=0;c.requestedMs=0;}
    if(c.phase==='fade'){
      frame.status='waiting';await this.runOwnedFade(c.args!,frame);frame.status='running';
      worldService.setNeedToFadeIn(false);const resetAnchor=this.rngClock();c.logicalNow=0;c.deadline=c.delay/2;c.resetFrame=c.frame;c.args=null;
      finishRngPrefix(c,this.rngWork(resetAnchor));
      frame.status='waiting';this.captureWait({kind:'rng',...c});
    }
    if(c.frame>c.end){this.rngCursors.delete(frame.id);return;}
    // Hash and restoration work are excluded from the measured frame prefix.
    c.deadline+=c.delay;
    const anchor=this.rngClock();let painted:boolean;
    try{painted=rngService.blitToSurface(c.rngNum,c.frame);}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:'RNG decode failed: '+(error as Error).message});}
    if(!painted){this.rngCursors.delete(frame.id);return;}
    rngService.updateOwnedScreen(this.surface);
    if(worldService.getNeedToFadeIn()){
      c.phase='fade';c.logicalNow=0;c.sleepStart=0;c.waitElapsed=0;c.args={family:'in',time:1,paletteId:getPaletteIdSnapshot(),night:!!isNightPaletteEnabled()};c.front=this.clockMetadata(()=>rngService.getFrontBinding(this.surface));
      frame.status='waiting';await this.runOwnedFade(c.args,frame);frame.status='running';
      worldService.setNeedToFadeIn(false);const resetAnchor=this.rngClock();c.logicalNow=0;c.deadline=c.delay/2;c.resetFrame=c.frame;c.args=null;
      finishRngPrefix(c,this.rngWork(resetAnchor));
    }else finishRngPrefix(c,this.rngWork(anchor));
    c.front=this.clockMetadata(()=>rngService.getFrontBinding(this.surface));frame.status='waiting';this.captureWait({kind:'rng',...c});
  }
  private endingScrollGeometry():boolean {
    const s=this.surface as any;
    return this.screenFadeGeometry()&&s instanceof NativeSurface&&(!s.panoramaHandler||s.panoramaHandler===nativePanorama&&!nativePanorama.shouldCaptureUi())&&typeof s.ctx?.getImageData==='function'&&typeof s.ctx?.putImageData==='function';
  }
  private endingAnimationGeometry():boolean {
    const s=this.surface as any;
    return this.endingScrollGeometry()&&(!s.panoramaHandler||!nativePanorama.isActive());
  }
  private publishEndingAnimations(cp:ScriptDelayCheckpoint):void {
    for(const f of cp.frames)if(f.endingAnimation){if(!validateEndingAnimationCursor(f.endingAnimation,scriptObjectAdapter.getScriptEntry(f.currentPC),f.currentPC))throw new Error('Ending animation source changed before publication');endingAnimationLeases(this.surface!).publish(f.endingAnimation.lease!,cp,ending.getAnimationBinding());}
  }
  private validateOwnedEndingAnimations(cp:ScriptDelayCheckpoint):string|null {
    if(cp.frames.some(f=>f.endingAnimation)&&(this.manualExecution||this.executionRuntime.snapshot().activeFrames.length))return 'Ending animation execution context changed during validation';
    try {for(const f of cp.frames)if(f.endingAnimation){
      const c=f.endingAnimation,s=this.surface as any,b=ending.getAnimationBinding();
      if(!validateEndingAnimationCursor(c,scriptObjectAdapter.getScriptEntry(f.currentPC),f.currentPC))return 'Ending animation source changed during validation';
      if(!this.endingAnimationGeometry())return 'Ending animation requires classic canvas renderer';
      if(!cp.clock)return 'Ending animation nonzero effect requires root clock';
      const scope=endingAnimationLeases(s),row=scope.resolve(c.lease!,cp.id,c,b,s);
      if(!row)return 'Missing, foreign, replaced or expired ending animation resources';
      if(!scope.bytesMatch(row,c)||!scope.matches(c.lease!,cp,b))return 'Ending animation published progress, wave or physical renderer changed';
    }return null;}catch(error){return (error as Error).message;}
  }
  /** Recheck captured context and source after all callback-capable physical reads. */
  private endingAnimationConsumeFence(cp:ScriptDelayCheckpoint,context:EndingClockRestoreContext|null):string|null {
    if(!cp.frames.some(f=>f.endingAnimation))return null;
    const s=this.surface;
    if(!context)return 'Ending animation requires its captured root clock context';
    // This final provider probe can call user code; all following checks are
    // binding/source observations and never read physical canvas/palette getters.
    try{context.lane.validateCounter();}catch(error){return (error as Error).message;}
    const clockReason=this.rootClockContextReason(cp,context);if(clockReason)return clockReason;
    if(!context)return 'Ending animation requires its captured root clock context';
    try{for(const f of cp.frames)if(f.endingAnimation){
      const c=f.endingAnimation,b=ending.getAnimationBinding(),scope=endingAnimationLeases(s!);
      if(!validateEndingAnimationCursor(c,scriptObjectAdapter.getScriptEntry(f.currentPC),f.currentPC))return 'Ending animation source changed after physical validation';
      const row=scope.resolve(c.lease!,cp.id,c,b,s);
      if(!row||!scope.bytesMatch(row,c)||!scope.matchesPublishedBindings(c.lease!,cp,b))return 'Ending animation binding changed after physical validation';
    }
    if((s as any)?.panoramaHandler&&((s as any).panoramaHandler!==nativePanorama||(nativePanorama as any).enabled))return 'Ending animation panorama changed after physical validation';
    if(this.surface!==s||this.endingClockCapability!==context.cap||this.manualExecution||this.executionRuntime.snapshot().activeFrames.length)return 'Ending animation context changed after physical validation';
    return null;}catch(error){return (error as Error).message;}
  }
  private publishEndingScrolls(cp:ScriptDelayCheckpoint):void {
    for(const f of cp.frames)if(f.endingScroll)endingScrollLeases(this.surface!).publish(f.endingScroll.lease!,cp,ending.getScrollBinding());
  }
  private validateOwnedEndingScrolls(cp:ScriptDelayCheckpoint):string|null {
    if(cp.frames.some(f=>f.endingScroll)&&(this.manualExecution||this.executionRuntime.snapshot().activeFrames.length))return 'Ending scroll execution context changed during validation';
    try {for(const f of cp.frames)if(f.endingScroll){
      const c=f.endingScroll,s=this.surface as any,b=ending.getScrollBinding();
      if(!validateEndingScrollCursor(c,scriptObjectAdapter.getScriptEntry(f.currentPC),f.currentPC))return 'Ending scroll source changed during validation';
      if(!this.endingScrollGeometry())return 'Ending scroll requires classic canvas renderer';
      if(!cp.clock&&ending.getEffectSpriteId()!==0)return 'Ending scroll nonzero effect requires root clock';
      const scope=endingScrollLeases(s),row=scope.resolve(c.lease!,cp.id,c,b,s);
      if(!row)return 'Missing, foreign, replaced or expired ending scroll resources';
      if(!scope.bytesMatch(row,c)||!scope.matches(c.lease!,cp,b))return 'Ending scroll published progress, wave or physical renderer changed';
    }return null;}catch(error){return (error as Error).message;}
  }
  private async runManualEndingAnimation(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.endingAnimations.get(frame.id),fresh=!c;
    if(!c){
      if(!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending animation requires root clock'});
      const b=this.clockMetadata(()=>captureEndingAnimationBinding(ending.getAnimationBinding())),s=this.surface as any;
      if(!this.clockMetadata(()=>this.endingAnimationGeometry())||b.surface!==s||b.screen!==s.byteBuffer||b.scene.surface!==s)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending animation requires matching classic Scene Surface and canvas'});
      const source=this.clockMetadata(()=>({operation:sc.operation,operand:Array.from(sc.operand)}));
      if(frame.kind==='trigger')this.clearBeforeOpcode(frame,sc);
      if(!this.clockMetadata(()=>{const current=scriptObjectAdapter.getScriptEntry(frame.currentPC);return sameJsonValue(source,{operation:sc.operation,operand:Array.from(sc.operand)})&&sameJsonValue(source,{operation:current?.operation,operand:Array.from(current?.operand||[])});}))throw new ManualExecutionSignal({status:'unsupported',reason:'Ending animation source changed before entry'});
      log.debug('[SCRIPT] Show the ending animation');
      const entry=ending.beginAnimation();
      c=this.clockMetadata(()=>createEndingAnimationCursor(frame.currentPC,source,entry));
      this.clockMetadata(()=>{c!.upperDigest=endingShowDigest(entry.upper);c!.lowerDigest=endingShowDigest(entry.lower);const scope=endingAnimationLeases(s);c!.lease=scope.acquire(this.manualIdentity!.id,c!,b,entry);worldService.registerEndingAnimationReferenceScope(scope);});
      this.endingAnimations.set(frame.id,c);
      if(!this.clockMetadata(()=>{const current=scriptObjectAdapter.getScriptEntry(frame.currentPC);return sameJsonValue(source,{operation:sc.operation,operand:Array.from(sc.operand)})&&sameJsonValue(source,{operation:current?.operation,operand:Array.from(current?.operand||[])});}))throw new ManualExecutionSignal({status:'unsupported',reason:'Ending animation source changed before entry'});
      this.clockMetadata(()=>{this.rootEndingClock!.scope.bindSprite(this.rootEndingClock!.lease,571,entry.sprite);this.rootEndingClock!.scope.bindSprite(this.rootEndingClock!.lease,572,entry.girl);});
    }else if(c.phase==='sleep')c.frameIndex++;
    const s=this.surface as any,scope=endingAnimationLeases(s),row=this.clockMetadata(()=>scope.resolve(c!.lease!,this.manualIdentity!.id,c!,ending.getAnimationBinding(),s));
    if(!row)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending animation binding changed during native work'});
    if(c.frameIndex<400){
      if(fresh||c.phase==='sleep'){
        ending.animationStep(row.entry,c.frameIndex,()=>this.rootEndingClock!.lane.sample());
        c.girlPos=row.entry.girlPos;
        this.clockMetadata(()=>scope.completePrefix(c!.lease!,ending.getAnimationBinding()));
        if(shouldFadeIn()){c.phase='fade';c.args={family:'in',time:1,paletteId:getPaletteIdSnapshot(),night:!!isNightPaletteEnabled()};c.requestedMs=c.remainingMs=0;}
      }
      if(c.phase==='fade'){
        frame.status='waiting';await this.runOwnedFade(c.args!,frame);frame.status='running';worldService.setNeedToFadeIn(false);c.phase='sleep';c.args=null;
      }
      const requested=50/(globalThis as any).GameSpeed;
      if(!Number.isFinite(requested)||requested<0)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending animation relative sleep must be finite and nonnegative'});
      this.rootEndingClock!.lane.end();c.requestedMs=c.remainingMs=requested;
      frame.status='waiting';this.captureWait({kind:'ending-animation',opcodePC:c.opcodePC,nextPC:c.nextPC,frameIndex:c.frameIndex,requestedMs:requested,remainingMs:requested});
    }
    ending.finishAnimation();
    worldService.releaseEndingAnimationReference(scope,c.lease!);this.endingAnimations.delete(frame.id);
  }
  private async runManualEndingScroll(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.endingScrolls.get(frame.id),fresh=!c;
    if(!c){
      if(ending.getEffectSpriteId()!==0&&!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending scroll nonzero effect requires root clock'});
      const b=ending.getScrollBinding(),s=this.surface as any;
      if(!this.clockMetadata(()=>this.endingScrollGeometry())||b.surface!==s||b.screen!==s.byteBuffer||b.scene.surface!==s)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending scroll requires matching classic Scene Surface and canvas'});
      if(frame.kind==='trigger')this.clearBeforeOpcode(frame,sc);
      const source={operation:sc.operation,operand:Array.from(sc.operand)};
      log.debug('[SCRIPT] Scroll FBP to the screen');
      if(source.operand[0]===0x44){const show=ending.beginShowFBP(0x45,0);ending.finishShowFBP(0x45,0,show.bitmap,show.debugFBP);}
      if(!sameJsonValue(source,{operation:sc.operation,operand:Array.from(sc.operand)}))throw new ManualExecutionSignal({status:'unsupported',reason:'Ending scroll source changed before entry'});
      const entry=ending.beginScrollFBP(source.operand[0],source.operand[2],true);
      c=this.clockMetadata(()=>createEndingScrollCursor(frame.currentPC,source,entry));
      this.clockMetadata(()=>{c!.bitmapDigest=endingShowDigest(entry.bitmap);c!.targetDigest=endingShowDigest(entry.p);const scope=endingScrollLeases(s);c!.lease=scope.acquire(this.manualIdentity!.id,c!,b,entry);worldService.registerEndingScrollReferenceScope(scope);});
      this.endingScrolls.set(frame.id,c);
    }else if(c.phase==='sleep')c.frameIndex++;
    const s=this.surface as any,scope=endingScrollLeases(s),row=this.clockMetadata(()=>scope.resolve(c!.lease!,this.manualIdentity!.id,c!,ending.getScrollBinding(),s));
    if(!row)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending scroll binding changed during native work'});
    if(c.frameIndex<220){
      if(fresh||c.phase==='sleep'){
        ending.scrollFBPBackgroundStep(row.target,c.frameIndex,true,row.rect,row.dstrect);
        if(ending.getEffectSpriteId()!==0){if(!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending scroll effect enabled after drawn prefix'});ending.drawOwnedShowEffect(()=>this.rootEndingClock!.lane.sample(),(sprite:any,id:number)=>this.clockMetadata(()=>this.rootEndingClock!.scope.bindSprite(this.rootEndingClock!.lease,id,sprite)));}
        s.updateScreen(null);
        this.clockMetadata(()=>scope.completePrefix(c!.lease!,ending.getScrollBinding()));
        if(shouldFadeIn()){c.phase='fade';c.args={family:'in',time:1,paletteId:getPaletteIdSnapshot(),night:!!isNightPaletteEnabled()};c.requestedMs=c.remainingMs=0;}
      }
      if(c.phase==='fade'){
        frame.status='waiting';await this.runOwnedFade(c.args!,frame);frame.status='running';worldService.setNeedToFadeIn(false);c.phase='sleep';c.args=null;
      }
      const requested=800/c.speed/(globalThis as any).GameSpeed;
      if(!Number.isFinite(requested)||requested<0)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending scroll relative sleep must be finite and nonnegative'});
      this.rootEndingClock?.lane.end();c.requestedMs=c.remainingMs=requested;
      frame.status='waiting';this.captureWait({kind:'ending-scroll',opcodePC:c.opcodePC,nextPC:c.nextPC,frameIndex:c.frameIndex,requestedMs:requested,remainingMs:requested});
    }
    ending.finishScrollFBP(c.chunk,c.speed,true,row.bitmap,row.target,c.debug);
    worldService.releaseEndingScrollReference(scope,c.lease!);this.endingScrolls.delete(frame.id);
    this.surface?.backupScreen();markBgDirty('scroll-fbp');invalidateDialogBackup('scrollFBP');
  }
  private validateOwnedEndingShows(cp:ScriptDelayCheckpoint):string|null {
    for(const f of cp.frames)if(f.endingShow){const c=f.endingShow,s=this.surface as any;
      if(!this.screenFadeGeometry())return 'Ending show requires classic 320x200 geometry';
      if(!cp.clock&&ending.getEffectSpriteId()!==0)return 'Ending show background effect changed';
      const scope=endingShowLeases(s),row=scope.resolve(c.lease!,cp.id,c,ending.getShowBinding(),s);
      if(!row)return 'Missing, foreign, changed or expired ending show resources';
      if(!scope.matchesProgress(c.lease!,c,cp.revision))return 'Ending show progress does not match published snapshot';
      if(endingShowDigest(c.bitmap)!==c.bitmapDigest||endingShowDigest(row.bitmap)!==c.bitmapDigest||endingShowDigest(c.target)!==c.targetDigest||endingShowDigest(row.target)!==c.targetDigest||endingShowDigest(row.front)!==c.frontDigest||endingShowDigest(row.backup)!==c.backupDigest)return 'Ending show matching bytes changed';
    }return null;
  }
  private async runManualEndingShow(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.endingShows.get(frame.id);
    if(!c){
      if(frame.kind==='trigger')this.clearBeforeOpcode(frame,sc);
      const source={operation:sc.operation,operand:Array.from(sc.operand) as number[]};
      const fade=source.operand[source.operation===0x76?1:2];
      const effect=source.operation===0x76?0:source.operand[1]===0xffff?ending.getEffectSpriteId():source.operand[1];
      if(fade&&effect!==0&&!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending show nonzero fade requires background effect 0'});
      const binding=ending.getShowBinding(),s=this.surface as any;
      if(!this.screenFadeGeometry()||binding.surface!==s||binding.screen!==s.byteBuffer)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending show requires matching classic Surface and screen aliases'});
      if(sc.operation===0x76){log.debug('[SCRIPT] Show FBP picture');debugBgEvent('script-show-fbp',{chunk:sc.operand[0],fade});ending.setEffectSprite(0);}
      else {log.debug('[SCRIPT] Show FBP picture with sprite effects');if(sc.operand[1]!==0xffff)ending.setEffectSprite(sc.operand[1]);}
      if(!sameJsonValue(source,{operation:sc.operation,operand:Array.from(sc.operand)}))throw new ManualExecutionSignal({status:'unsupported',reason:'Ending show source changed before native helper entry'});
      const entry=ending.beginShowFBP(source.operand[0],fade);
      if(!fade){ending.finishShowFBP(source.operand[0],fade,entry.bitmap,entry.debugFBP);this.finishManualEndingShow(source.operation);return;}
      if(ending.getEffectSpriteId()!==0&&!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending show background effect changed during entry'});
      c=this.clockMetadata(()=>createEndingShowCursor(frame.currentPC,source,entry.bitmap,entry.p,entry.debugFBP));
      this.clockMetadata(()=>{c!.bitmapDigest=endingShowDigest(entry.bitmap);c!.targetDigest=endingShowDigest(entry.p);});
      const scope=endingShowLeases(s);c.lease=scope.acquire(this.manualIdentity!.id,c,ending.getShowBinding(),entry.bitmap,entry.p);
      worldService.registerEndingShowReferenceScope(scope);this.endingShows.set(frame.id,c);
    }else c.step++;
    const s=this.surface as any,scope=endingShowLeases(s),row=scope.resolve(c.lease!,this.manualIdentity!.id,c,ending.getShowBinding(),s);
    if(!row)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending show aliases changed during entry'});
    if(c.step<96){
      ending.showFBPBackgroundStep(row.target,c.step);
      if(ending.getEffectSpriteId()!==0){if(!this.rootEndingClock)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending show background effect changed during blend'});ending.drawOwnedShowEffect(()=>this.rootEndingClock!.lane.sample(),(sprite:any,id:number)=>this.clockMetadata(()=>this.rootEndingClock!.scope.bindSprite(this.rootEndingClock!.lease,id,sprite)));}
      s.updateScreen(null);
      const requested=(c.fade+1)*10/(globalThis as any).GameSpeed;
      if(!Number.isFinite(requested)||requested<0)throw new ManualExecutionSignal({status:'unsupported',reason:'Ending show relative sleep must be finite and nonnegative'});
      this.rootEndingClock?.lane.end();
      c.requestedMs=c.remainingMs=requested;c.frontDigest=endingShowDigest(s.byteBuffer);c.backupDigest=endingShowDigest(s.backup);scope.publish(c.lease!,c,this.manualIdentity!.revision);
      frame.status='waiting';this.captureWait({kind:'ending-show',opcodePC:c.opcodePC,nextPC:c.nextPC,step:c.step,requestedMs:requested,remainingMs:requested});
    }
    ending.finishShowFBP(c.chunk,(c.fade+1)*10,row.bitmap,c.debug);
    worldService.releaseEndingShowReference(scope,c.lease!);this.endingShows.delete(frame.id);this.finishManualEndingShow(c.operation);
  }
  private finishManualEndingShow(operation:number):void {
    this.surface?.backupScreen();markBgDirty(operation===0x76?'show-fbp':'show-fbp-effects');invalidateDialogBackup(operation===0x76?'showFBP':'showFBP-effects');
  }
  private screenFadeGeometry():boolean {
    const s=this.surface as any;return !!s&&s.width===320&&s.height===200&&s.pitch===320&&s.len===64000&&s.byteBuffer instanceof Uint8Array&&s.byteBuffer.length===64000&&s.backup instanceof Uint8Array&&s.backup.length===64000;
  }
  private validateOwnedScreenFades(cp:ScriptDelayCheckpoint):string|null {
    for(const f of cp.frames)if(f.screenFade){const c=f.screenFade,p=c.screen;
      if(!p)continue;
      if(!this.screenFadeGeometry())return 'Screen fade requires classic 320x200 geometry';
      const s=this.surface as any,row=screenFadeLeases(s).resolve(p.lease,cp.id,c,s);
      if(!row)return 'Missing, foreign, replaced or expired screen fade aliases';
      if(!screenFadeLeases(s).matchesProgress(p.lease,p))return 'Screen fade progress does not match renderer lease';
      if(screenFadeDigest(p.target)!==p.targetDigest||screenFadeDigest(row.front)!==p.frontDigest||screenFadeDigest(row.backup)!==p.backupDigest)return 'Screen fade matching indexed bytes changed';
    }return null;
  }
  private async runManualScreenFade(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.screenFades.get(frame.id);
    if(!c){
      if(frame.kind==='trigger')this.clearBeforeOpcode(frame,sc);
      const active=getSceneEntrySnapshot(getSceneIdSnapshot()),target=scene.surface||(globalThis as any).ui?.surface;
      if(active&&target&&target!==this.surface)throw new ManualExecutionSignal({status:'unsupported',reason:'Screen composition requires matching Runner and Scene Surface'});
      if(this.surface&&!this.screenFadeGeometry())throw new ManualExecutionSignal({status:'unsupported',reason:'Screen fade requires classic 320x200 geometry'});
      debugBgEvent(sc.operation===0x73?'script-fade-to-scene':'script-fade-current-scene',sc.operation===0x73?{speed:sc.operand[0]}:undefined);
      const previousOverlay=clearFbpOverlay(sc.operation===0x73?'fade-to-scene':'fade-current-scene');
      this.surface?.backupScreen();c=createScreenFadeSource(frame.currentPC,sc,previousOverlay);this.screenFades.set(frame.id,c);
    }
    if(c.phase==='compose'){await this.runOwnedCompose(frame,sc,'screen-fade');c.phase='screen';
      if(this.surface){const s=this.surface as any,front=s.byteBuffer,target=s.getRect(0,0,320,200),backup=s.backup;
        if(!this.screenFadeGeometry()||front!==s.byteBuffer)throw new ManualExecutionSignal({status:'unsupported',reason:'Screen fade requires classic 320x200 geometry'});
        this.clockMetadata(()=>{const targetDigest=screenFadeDigest(target),lease=screenFadeLeases(s).acquire(this.manualIdentity!.id,c,front,backup,targetDigest);
        worldService.registerScreenFadeReferenceScope(screenFadeLeases(s));
        c.screen={target:Array.from(target),substep:0,nominalMs:((sc.operation===0x73?sc.operand[0]:2)+1)*4,requestedMs:0,remainingMs:0,frontDigest:screenFadeDigest(front),backupDigest:screenFadeDigest(backup),targetDigest,width:320,height:200,pitch:320,lease};});
      }
    }else if(c.screen)c.screen.substep++;
    const p=c.screen;
    if(p){const s=this.surface as any,row=screenFadeLeases(s).resolve(p.lease,this.manualIdentity!.id,c,s);
      if(!row)throw new ManualExecutionSignal({status:'unsupported',reason:'Screen fade captured aliases changed during initialization'});
      if(p.substep<72){s.fadeScreenSubstep(row.front,p.target,row.backup,Math.floor(p.substep/6),p.substep%6);
        const speed=(globalThis as any).GameSpeed,requested=p.nominalMs/speed;
        if(!Number.isFinite(requested)||requested<0)throw new ManualExecutionSignal({status:'unsupported',reason:'Screen fade relative sleep must be finite and nonnegative'});
        this.rootEndingClock?.lane.end();
        p.requestedMs=p.remainingMs=requested;p.frontDigest=screenFadeDigest(row.front);p.backupDigest=screenFadeDigest(row.backup);screenFadeLeases(s).publish(p.lease,p);
        frame.status='waiting';this.captureWait({kind:'screen-fade',opcodePC:c.opcodePC,nextPC:c.nextPC,substep:p.substep,requestedMs:p.requestedMs,remainingMs:p.remainingMs});
      }
      s.updateScreen(null);worldService.releaseScreenFadeReference(screenFadeLeases(s),p.lease);
    }
    markBgDirty(sc.operation===0x73?'fade-to-scene':'fade-current-scene');restoreOverlayMode(c.previousOverlay);this.screenFades.delete(frame.id);
  }
  private sceneFadeAsset(paletteId:number,night:boolean):any {
    const entry=(Palette as any).get(paletteId);
    return Array.isArray(entry)?entry:entry&&Array.isArray(entry.day)?(night?(entry.night||entry.day):entry.day):null;
  }
  private validateOwnedSceneFades(cp:ScriptDelayCheckpoint):string|null {
    for(const f of cp.frames)if(f.sceneFade){const q=f.sceneFade;let asset:any;try{asset=this.sceneFadeAsset(q.paletteId,q.night);}catch{return 'Scene fade asset lookup failed';}
      if(!denseFadePalette(asset)||!sameJsonValue(asset,q.asset))return 'Scene fade source asset does not match';
      const target=scene.surface || (globalThis as any).ui?.surface;if(!this.surface || target && target!==this.surface)return 'Scene fade requires matching Runner and Scene Surface';
      if(q.phase==='sleep'&&!sameJsonValue(this.surface.getPalette(),q.asset.map(p=>({r:p.r*q.level>>6,g:p.g*q.level>>6,b:p.b*q.level>>6}))))return 'Scene fade physical palette does not match saved level';
    }return null;
  }
  private async runManualSceneFade(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.sceneFades.get(frame.id);
    if(!c) {
      if(frame.kind==='trigger')this.clearBeforeOpcode(frame,sc);
      const paletteId=getPaletteIdSnapshot(),night=isNightPaletteEnabled();let asset:any;
      try{asset=this.sceneFadeAsset(paletteId,night);}catch{throw new ManualExecutionSignal({status:'unsupported',reason:'Scene fade asset lookup failed'});}
      if(!asset || !this.surface){worldService.setNeedToFadeIn(SHORT(sc.operand[0])<0);return;}
      if(!this.clockMetadata(()=>denseFadePalette(asset)))throw new ManualExecutionSignal({status:'unsupported',reason:'Scene fade requires dense RGB asset'});
      const target=scene.surface || (globalThis as any).ui?.surface;
      if(target && target!==this.surface)throw new ManualExecutionSignal({status:'unsupported',reason:'Scene fade requires matching Runner and Scene Surface'});
      c=this.clockMetadata(()=>createSceneFadeCursor(frame.currentPC,sc,paletteId,night,asset));this.sceneFades.set(frame.id,c);
      worldService.setNeedToFadeIn(false);
    }
    while(c.level>=0&&c.level<64) {
      if(c.phase==='clear'){inputService.clear();c.phase='world';}
      if(c.phase==='world') {
        c.worldUpdate??={sceneId:getSceneIdSnapshot(),phase:'entry',eventIds:[],index:0,viewport:0,partyOffset:0,pendingReturn:null};
        await co(this.#invokeRewardWorldUpdate(false,c.worldUpdate,this.#guardRewardWorldHooks(frame,{invoke:(kind:'trigger'|'auto',entry:number,event:number)=>kind==='trigger'?this.#invokeRewardTrigger(entry,event,frame):this.#invokeRewardAuto(entry,event,frame)})));
        delete c.worldUpdate;c.phase='compose';
      }
      if(c.phase==='compose'){await this.runOwnedCompose(frame,sc,'scene-fade');c.phase='screen';}
      if(c.phase==='screen'){this.surface?.updateScreen(null);c.phase='scale';}
      if(c.phase==='scale'){this.surface?.setPalette(c.asset.map(p=>({r:p.r*c!.level>>6,g:p.g*c!.level>>6,b:p.b*c!.level>>6})));c.phase='sleep';c.remainingMs=100;this.captureWait({kind:'scene-fade',...c});}
      if(c.phase==='sleep'){c.iteration++;c.level+=c.step;c.phase='clear';c.remainingMs=0;}
    }
    worldService.setNeedToFadeIn(SHORT(sc.operand[0])<0);this.sceneFades.delete(frame.id);
  }
  private validateOwnedPalettes(cp:ScriptDelayCheckpoint):string|null {
    for(const f of cp.frames)if(f.palette) {
      const c=f.palette;
      if(c.phase==='world' && !isRegisteredPaletteSceneHook(this.surface?.sceneUpdateHook))return 'Pending palette world update requires its standard scene hook';
      if(c.updateScene && !supportsOwnedPaletteSceneHook(this.surface?.sceneUpdateHook))return 'Custom palette scene update hooks cannot be manually resumed';
      if(!c.initialized)continue;
      if(!this.surface || typeof this.surface.setPalette!=='function' || !this.surface.byteBuffer || !this.surface.palette)return 'Palette checkpoint requires a matching Surface';
      if(c.family!=='red') {
        let target:any;try{target=(Palette as any).getColors(c.paletteId,c.night);}catch{return 'Palette asset is unavailable';}
        if(!target || !sameJsonValue(clonePalette(target),c.target))return 'Palette source asset does not match saved palette';
      }
    }
    return null;
  }
  private async runManualPalette(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    if(sc.operation===0x80 && !sc.operand[0] && !supportsOwnedPaletteSceneHook(this.surface?.sceneUpdateHook))throw new ManualExecutionSignal({status:'unsupported',reason:'Custom palette scene update hooks cannot be manually resumed'});
    let c=this.palettes.get(frame.id);
    if(!c) {
      const family=paletteFamily(sc.operation)!,frameTime=(globalThis as any).FrameTime,gameSpeed=(globalThis as any).GameSpeed;
      const delay=family==='color'?(sc.operand[1]*5||5):5,updateScene=family==='blend'&&!sc.operand[0];
      c={opcodePC:frame.currentPC,nextPC:frame.currentPC+1,operation:sc.operation,operands:Array.from(sc.operand),family,initialized:false,step:0,phase:'clear',remainingMs:0,requestedMs:family==='color'?delay/gameSpeed:frameTime/gameSpeed/(family==='blend'&&!updateScene?4:1),frameTime,gameSpeed,paletteId:null,night:null,color:family==='color'?sc.operand[0]:0,from:family==='color'&&!!sc.operand[2],delay,updateScene,original:null,target:null,working:null,final:null};
      this.palettes.set(frame.id,c);
    }
    if(c.phase==='clear') {
      // Trigger caller owns the normal dialog-clear condition before initializing.
      if(frame.kind==='trigger')this.clearBeforeOpcode(frame,sc);
      if(c.family==='blend')worldService.setNightPaletteFlag(!isNightPaletteEnabled());
      if(!this.surface){if(c.family==='color')worldService.setNeedToFadeIn(false);this.palettes.delete(frame.id);return;}
      if(c.family==='red') {
        const original=this.surface.getPalette();c.original=this.clockMetadata(()=>clonePalette(original));c.working=clonePalette(c.original);
        for(let i=0;i<this.surface.len;i++)if(this.surface.byteBuffer[i]===0x4f)this.surface.byteBuffer[i]=0x4e;
      }else {
        c.paletteId=getPaletteIdSnapshot();c.night=isNightPaletteEnabled();
        const target=(Palette as any).getColors(c.paletteId,c.night);
        if(!target){if(c.family==='color')worldService.setNeedToFadeIn(false);this.palettes.delete(frame.id);return;}
        c.target=this.clockMetadata(()=>clonePalette(target));
        if(c.family==='blend'){c.original=clonePalette(this.surface.palette);c.working=this.clockMetadata(()=>clonePalette(c!.original!));}
        else {
          c.original=this.clockMetadata(()=>clonePalette(c!.target!));const color=c.target[c.color];
          // Preserve native invalid color failure instead of inventing a clamp.
          const filled=c.target.map(()=>({r:color.r,g:color.g,b:color.b}));
          c.working=c.from?filled:clonePalette(c.original);c.final=c.from?this.clockMetadata(()=>clonePalette(c!.original!)):filled;
        }
      }
      c.initialized=true;c.phase='step';
    }
    while(true) {
      if(c.phase==='sleep'){c.remainingMs=0;c.step++;c.phase=c.step===(c.family==='color'?64:32)?'final':'step';}
      if(c.phase==='step') {
        if(c.family==='red')redPaletteStep(c.original!,c.working!);
        else if(c.family==='blend')c.working=blendPaletteStep(c.original!,c.target!,c.step);
        else colorPaletteStep(c.target!,c.working!,c.color,c.from);
        this.surface!.setPalette(c.working);
        if(c.updateScene && typeof this.surface!.sceneUpdateHook==='function') {
          inputService.clear();inputService.dir=Direction.Unknown;inputService.prevDir=Direction.Unknown;c.phase='world';
        }else c.phase=c.updateScene?'screen':'sleep';
      }
      if(c.phase==='world') {
        c.worldUpdate ??={sceneId:getSceneIdSnapshot(),phase:'entry',eventIds:[],index:0,viewport:0,partyOffset:0,pendingReturn:null};
        await co(this.#invokeRewardWorldUpdate(false,c.worldUpdate,this.#guardRewardWorldHooks(frame,{invoke:(kind:'trigger'|'auto',entry:number,event:number)=>kind==='trigger'?this.#invokeRewardTrigger(entry,event,frame):this.#invokeRewardAuto(entry,event,frame)})));
        delete c.worldUpdate;c.phase='compose';
      }
      if(c.phase==='compose'){await this.runOwnedCompose(frame,sc,'palette');c.phase='screen';}
      if(c.phase==='screen'){this.surface!.updateScreen(null);c.phase='sleep';}
      if(c.phase==='sleep'){c.frameTime=(globalThis as any).FrameTime;c.gameSpeed=(globalThis as any).GameSpeed;c.requestedMs=c.family==='color'?c.delay/c.gameSpeed:c.frameTime/c.gameSpeed/(c.family==='blend'&&!c.updateScene?4:1);c.remainingMs=c.requestedMs;this.captureWait({kind:'palette',...c});}
      if(c.phase==='final'){if(c.family==='color'){this.surface!.setPalette(c.final);worldService.setNeedToFadeIn(false);}this.palettes.delete(frame.id);return;}
    }
  }
  private async runManualRedraw(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.redraws.get(frame.id);
    if(!c) {
      c={opcodePC:frame.currentPC,nextPC:frame.currentPC+1,operation:5,operands:Array.from(sc.operand),previousOverlay:clearFbpOverlay('redraw-screen'),branch:null,phase:'clear',requestedMs:(sc.operand[1]||1)*60,remainingMs:0};
      this.redraws.set(frame.id,c);
    }
    if(c.phase==='clear'){this.clearBeforeOpcode(frame,sc);c.phase='branch';}
    if(c.phase==='branch') {
      c.branch=(this.dialogContext?this.dialogContext.playingRNG:ui.dialogIsPlayingRNG())?'rng':this.BATTLE() && worldService.isInBattle()?'battle':'normal';
      if(c.branch==='rng'){this.surface?.restoreScreen();c.phase='final';}
      else if(c.branch==='battle'){battleService.makeSceneToScreen();this.surface?.updateScreen(null);c.phase='final';}
      else c.phase='gestures';
    }
    if(c.phase==='gestures'){if(sc.operand[2])scene.updatePartyGestures(false);c.phase='compose';}
    if(c.phase==='compose'){await this.runOwnedCompose(frame,sc,'redraw');c.phase='screen';}
    if(c.phase==='screen'){this.surface?.updateScreen(null);c.phase='sleep';c.remainingMs=c.requestedMs;this.captureWait({kind:'redraw',...c});}
    if(c.phase==='sleep')c.phase='final';
    if(c.phase==='final'){markBgDirty('redraw-screen');restoreOverlayMode(c.previousOverlay);this.redraws.delete(frame.id);frame.currentPC++;}
  }
  private captureDelay(scriptEntry:number,requestedMs:number): never {
    return this.captureWait({kind:'delay',opcodePC:scriptEntry,nextPC:scriptEntry+1,requestedMs,remainingMs:requestedMs});
  }
  private captureWait(wait:NonNullable<ScriptDelayCheckpoint['wait']>): never {
    for(const c of this.generatedDialogs.values()){this.generatedWaitWork(c);this.syncGeneratedTextContext(c);}
    try{this.rootEndingClock?.lane.end();}catch(error){if(this.generatedDialogs.size||this.generatedNativeEnds.size)throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});throw error;}
    const snapshot=this.executionRuntime.snapshot();
    const frames:DelayCheckpointFrame[]=snapshot.activeFrames.map((f,i,all)=>{
      const child=all[i+1],sc=(f.kind==='equipment' || f.kind==='fade') ? null : scriptObjectAdapter.getScriptEntry(f.currentPC),frameWait=this.frameWaits.get(f.id),poisonCursor=this.poisonCursors.get(f.id),equipmentCursor=this.equipmentCursors.get(f.id),partyEquipmentCursor=this.partyEquipmentCursors.get(f.id);
      if (i===0 ? f.parentId!==null : f.parentId!==all[i-1].id) throw new ManualExecutionSignal({status:'unsupported',reason:'Multiple roots or unsupported parent stack'});
      let parentReturn:DelayCheckpointFrame['parentReturn']=null;
      if (child) {
        const u=frameWait?.worldUpdate || this.motions.get(f.id)?.worldUpdate || this.palettes.get(f.id)?.worldUpdate || this.sceneFades.get(f.id)?.worldUpdate,p=u?.pendingReturn;
        if(this.compositions.has(f.id)){const c=this.compositions.get(f.id)!;parentReturn=c.source==='generated-dialog-poll'?{kind:'generated-dialog-compose-fade',opcodePC:c.opcodePC,nextPC:c.opcodePC,ownerKind:this.generatedDialogs.get(f.id)!.ownerKind,site:this.generatedDialogs.get(f.id)!.site,poll:this.generatedDialogs.get(f.id)!.poll,frameIndex:i,phase:'compose',args:c.args}:c.source.startsWith('world-')?{kind:'world-compose-fade',opcodePC:c.opcodePC,nextPC:c.opcodePC+1,args:c.args,selection:u!.composition!}:{kind:'compose-fade',opcodePC:c.opcodePC,nextPC:c.opcodePC+1,args:c.args};}
        else if(this.endingAnimations.get(f.id)?.phase==='fade'){const c=this.endingAnimations.get(f.id)!;parentReturn={kind:'ending-animation-fade',opcodePC:c.opcodePC,nextPC:c.nextPC,frameIndex:c.frameIndex,girlPos:c.girlPos,args:c.args!};}
        else if(this.endingScrolls.get(f.id)?.phase==='fade'){const c=this.endingScrolls.get(f.id)!;parentReturn={kind:'ending-scroll-fade',opcodePC:c.opcodePC,nextPC:c.nextPC,frameIndex:c.frameIndex,args:c.args!};}
        else if(this.rngCursors.get(f.id)?.phase==='fade'){const c=this.rngCursors.get(f.id)!;parentReturn={kind:'rng-fade',opcodePC:c.opcodePC,nextPC:c.nextPC,args:c.args!};}
        else if(this.fadeSources.get(f.id)?.phase==='child'){const c=this.fadeSources.get(f.id)!;parentReturn={kind:'fade',opcodePC:c.opcodePC,nextPC:c.nextPC,args:c.args!,needFade:c.needFade};}
        else if (equipmentCursor?.pending) parentReturn={kind:'equipment-item',...equipmentCursor.pending};
        else if (partyEquipmentCursor) parentReturn={kind:'party-equipment',opcodePC:f.currentPC,nextPC:f.currentPC+1};
        else if (poisonCursor?.pending) parentReturn={kind:'poison',opcodePC:f.currentPC,nextPC:f.currentPC+1,...poisonCursor.pending};
        else if (this.teleportReturns.has(f.id)) parentReturn=this.teleportReturns.get(f.id)!;
        else if (this.autoTailReturns.has(f.id)) parentReturn=this.autoTailReturns.get(f.id)!;
        else if (sc?.operation===4) parentReturn={opcodePC:f.currentPC,nextPC:f.currentPC+1,childEntry:sc.operand[0],childEventId:child.eventId};
        else if ((sc?.operation===9 || motionFamily(sc?.operation) || sc?.operation===0x80 || sc?.operation===0x93) && u && p) parentReturn={kind:'world-update',opcodePC:f.currentPC,nextPC:f.currentPC+1,childEntry:p.entry,childEventId:child.eventId,childKind:p.kind,field:p.field,sceneId:u.sceneId,eventId:p.eventId,nextPhase:u.phase};
        else throw new ManualExecutionSignal({status:'unsupported',reason:'Unsupported parent stack'});
      }
      const shopCursor=this.shopCursors.get(f.id);
      const dialogAction=this.dialogActions.get(f.id);
      return {...(this.generatedNativeEnds.has(f.id)?{generatedNativeEnd:this.generatedNativeEnds.get(f.id)}:{}),...(this.generatedDialogs.has(f.id)?{generatedDialog:this.generatedDialogs.get(f.id)}:{}),...(this.endingAnimations.has(f.id)?{endingAnimation:this.endingAnimations.get(f.id)}:{}),...(this.endingScrolls.has(f.id)?{endingScroll:this.endingScrolls.get(f.id)}:{}),...(this.endingShows.has(f.id)?{endingShow:this.endingShows.get(f.id)}:{}),...(this.screenFades.has(f.id)?{screenFade:this.screenFades.get(f.id)}:{}),...(this.rngCursors.has(f.id)?{rng:this.rngCursors.get(f.id)}:{}),...(this.sceneFades.has(f.id)?{sceneFade:this.sceneFades.get(f.id)}:{}),...(this.compositions.has(f.id)?{compose:this.compositions.get(f.id)}:{}),...(this.timedFades.has(f.id)?{timedFade:this.timedFades.get(f.id),fadeArgs:this.timedFades.get(f.id)!.args}:{}),...(this.fadeSources.has(f.id)?{fadeSource:this.fadeSources.get(f.id)}:{}),...(this.palettes.has(f.id)?{palette:this.palettes.get(f.id)}:{}),...(this.redraws.has(f.id)?{redraw:this.redraws.get(f.id)}:{}),...(this.motions.has(f.id)?{motion:this.motions.get(f.id)}:{}),...(this.npcMotions.has(f.id)?{npcMotion:this.npcMotions.get(f.id)}:{}),...(shopCursor?{shopCursor}:{}),...(dialogAction?{dialogAction}:{}),kind:f.kind,currentPC:f.currentPC,continuationPC:f.continuationPC,eventId:f.eventId,loopSafetyCounter:f.loopSafetyCounter,parentReturn,...(frameWait?{frameWait}: {}),...(poisonCursor?{poisonCursor}:{}),...(equipmentCursor?{equipmentCursor}:{}),...(partyEquipmentCursor?{partyEquipmentCursor}:{})} as DelayCheckpointFrame;
    });
    const legacy=!this.dialogContext && wait.kind==='delay' && !frames.some(f=>f.kind==='equipment' || f.endingAnimation || f.endingScroll || f.endingShow || f.screenFade || f.rng || f.sceneFade || f.fadeSource || f.compose || f.palette || f.motion || f.npcMotion || f.partyEquipmentCursor || f.frameWait || f.poisonCursor || f.parentReturn?.kind==='auto-tail' || f.parentReturn?.kind==='teleport-child');
    const checkpoint:ScriptDelayCheckpoint={version:legacy?1:2,...this.manualIdentity!,registers:{scriptSuccess:this.scriptSuccess,curEquipPart:this.curEquipPart},frames,...(this.dialogContext?{dialog:this.dialogContext}:{}),...(legacy?{delay:{opcodePC:wait.opcodePC,nextPC:wait.nextPC,requestedMs:(wait as any).requestedMs,remainingMs:wait.remainingMs}}:{wait})} as ScriptDelayCheckpoint;
    const reason=validateDelayCheckpoint(checkpoint,pc=>scriptObjectAdapter.getScriptEntry(pc),itemId=>scriptObjectAdapter.getObjectEntry(itemId));
    if(reason) throw new ManualExecutionSignal({status:'unsupported',reason});
    this.publishRootClock(checkpoint);this.publishEndingAnimations(checkpoint);this.publishEndingScrolls(checkpoint);this.publishGeneratedDialogs(checkpoint);worldService.publishTeleportCheckpoint(checkpoint);
    this.checkpointRevisions.publish(checkpoint.id,checkpoint.revision);
    throw new ManualExecutionSignal({status:'suspended',checkpoint:copyDelayCheckpoint(checkpoint)});
  }
  private shopShelf(store:number):number[] {
    const items=gameDataAdapter.getStoreEntry(store)?.items as ArrayLike<number>|undefined;
    if(!items || !Number.isSafeInteger(items.length) || items.length<0)throw new Error('Shop store table unavailable');
    const ids:number[]=[];
    for(let i=0;i<Math.min(Const.MAX_STORE_ITEM,items.length);i++){const id=items[i];if(!Number.isSafeInteger(id)||id<0||id>65535)throw new Error('Invalid shop shelf');if(!id)break;ids.push(id);}
    return ids;
  }
  private shopPrice(id:number):number {const item=scriptObjectAdapter.getObjectEntry(id)?.item;return item&&typeof item.price==='number'?item.price:0;}
  private validateOwnedShops(cp:ScriptDelayCheckpoint):string|null {
    try {for(const f of cp.frames)if(f.shopCursor){const c=f.shopCursor;if(c.phase==='initial')continue;
      if(c.options.some(o=>!scriptObjectAdapter.getObjectEntry(o.itemId)?.item))return 'Shop object unavailable';
      if(c.mode==='sell' && c.phase==='select') {
        const slots=worldService.getInventory().slice(0,Const.MAX_INVENTORY).filter((slot:any)=>slot.item!==0&&slot.amount>0);
        if(slots.length!==c.options.length || slots.some((slot:any,i:number)=>{const o=c.options[i];return slot.item!==o.itemId || slot.amount!==o.quantity || slot.amountInUse!==o.amountInUse || scriptObjectAdapter.getObjectEntry(o.itemId)?.item?.flags!==o.flags;}))return 'Shop inventory source changed';
      }
      if(c.mode==='buy' && JSON.stringify(this.shopShelf(c.operands[0]))!==JSON.stringify(c.options.map(o=>o.itemId)))return 'Shop shelf source changed';
    }}catch{return 'Shop source unavailable';}return null;
  }
  private shopOptions(c:ShopCursor):void {
    if(c.mode==='sell')this.compressInventory();
    const rows=c.mode==='buy'?this.shopShelf(c.operands[0]).map(item=>({item,amount:0,amountInUse:0})):worldService.getInventory().slice(0,Const.MAX_INVENTORY).filter((slot:any)=>slot.item!==0);
    c.options=rows.map((slot:any,index:number)=>{
      const item=scriptObjectAdapter.getObjectEntry(slot.item)?.item;
      if(!item)throw new Error('Shop object unavailable');
      return {index,itemId:slot.item,flags:item.flags,enabled:c.mode==='buy'||!!(item.flags&32)&&slot.amount>slot.amountInUse,displayPrice:c.mode==='buy'?this.shopPrice(slot.item):~~(this.shopPrice(slot.item)/2),quantity:slot.amount,amountInUse:slot.amountInUse};
    });
    if(c.mode==='sell') {
      let index=worldService.getInventoryMenuIndex();
      if(index>=c.options.length){worldService.setInventoryMenuIndex(c.options.length-1);index=worldService.getInventoryMenuIndex();}
      if(index<0){worldService.setInventoryMenuIndex(0);index=0;}
      c.index=index;
    } else c.index=Math.max(0,Math.min(c.index,Math.max(0,c.options.length-1)));
    c.phase='select';c.selected=null;
  }
  private async runManualShop(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let c=this.shopCursors.get(frame.id);
    if(!c){
      c={opcodePC:frame.currentPC,nextPC:frame.currentPC+1,operation:sc.operation,operands:Array.from(sc.operand),mode:sc.operation===0x26?'buy':'sell',phase:'initial',prepared:false,index:0,options:[],selected:null};
      // Validate the source without mutating the inventory or starting presentation.
      try {
        const ids=c.mode==='buy'?this.shopShelf(c.operands[0]):worldService.getInventory().filter((slot:any)=>slot.item!==0&&slot.amount>0).map((slot:any)=>slot.item);
        if(ids.some(id=>!scriptObjectAdapter.getObjectEntry(id)?.item))throw new Error('Shop object unavailable');
      } catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
      this.shopCursors.set(frame.id,c);
    }
    if(c.phase==='initial'){
      await this.runOwnedCompose(frame,sc,'shop');this.surface?.updateScreen(null);
      try{this.shopOptions(c);c.prepared=true;}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
    }
    const response=this.shopResponse;this.shopResponse=null;
    if(response!==null){
      if(c.phase==='confirm'){
        const item=c.options[c.selected!].itemId;
        if(response===true){if(c.mode==='buy'){worldService.adjustCash(-this.shopPrice(item));this.addItemToInventory(item,1);}else if(this.addItemToInventory(item,-1))worldService.adjustCash(~~(this.shopPrice(item)/2));}
        if(c.mode==='buy'){c.index=c.options.findIndex(o=>o.itemId===item);c.phase='select';c.selected=null;}
        else try{this.shopOptions(c);}catch(error){throw new ManualExecutionSignal({status:'unsupported',reason:(error as Error).message});}
      }else {
        const selection=response as ShopSelection;
        if(selection.kind==='cancel'){this.shopCursors.delete(frame.id);return;}
        c.index=selection.index;
        if(c.mode==='sell')worldService.setInventoryMenuIndex(c.index);
        if(c.mode==='sell'||this.shopPrice(c.options[c.index].itemId)<=worldService.getCash()){c.phase='confirm';c.selected=c.index;}
        else c.index=c.options.findIndex(o=>o.itemId===c!.options[selection.index].itemId);
      }
    }
    if(c.phase==='confirm')this.captureWait({kind:'input',action:'shop',opcodePC:c.opcodePC,nextPC:c.nextPC,operands:c.operands,prompt:{kind:'confirm',noPC:c.opcodePC,options:[{label:'No',value:false},{label:'Yes',value:true}]}});
    this.captureWait(shopMenu(c));
  }
  private async runManualPoison(frame:ScriptExecutionFrame,sc:any,event:number):Promise<void> {
    let c=this.poisonCursors.get(frame.id);
    if(!c) {
      const kind=sc.operation===0x29?'player':'enemy', all=!!sc.operand[0], targets:number[]=[];
      if(!all) targets.push(event);
      else if(kind==='player') this.forEachPartyMember((member:any)=>targets.push(member.playerRole));
      else for(let i=0;i<=this.BATTLE().maxEnemyIndex;i++) targets.push(i);
      c={opcodePC:frame.currentPC,nextPC:frame.currentPC+1,poisonId:sc.operand[1],kind,all,targets,index:0,pending:null};
      this.poisonCursors.set(frame.id,c);
    }
    // Pending selection is the suspended legacy local state: never scan or reroll it.
    while(c.index<c.targets.length) {
      const target=c.targets[c.index];
      if(!c.pending) {
        let slot=0,partyIndex:number|undefined,childEntry:number;
        if(c.kind==='player') {
          if(randomLong(1,100)<=this.getPlayerPoisonResistance(target)) {c.index++;continue;}
          partyIndex=this.partyIndexOfRole(target);
          if(partyIndex<0) {c.index++;continue;}
          for(;slot<Const.MAX_POISONS;slot++) {
            const current=this.readPoisonEntry(slot,partyIndex)?.poisonID||0;
            if(!current) break;
            if(current===c.poisonId) {slot=Const.MAX_POISONS;break;}
          }
          const obj=scriptObjectAdapter.getObjectEntry(c.poisonId);
          childEntry=obj?.poison ? (obj.poison as any).playerScript : 0;
        } else {
          const enemy=this.BATTLE().enemy[target];
          if(!enemy || (c.all && enemy.objectID===0)) {c.index++;continue;}
          if(randomLong(0,9)<this.getObjectEnemyResistance(enemy.objectID)) {c.index++;continue;}
          if(enemy.poisons.some((p:any)=>p.poisonID===c!.poisonId)) {c.index++;continue;}
          for(;slot<Const.MAX_POISONS;slot++) if(enemy.poisons[slot].poisonID===0) break;
          childEntry=this.getObjectPoisonEnemyScript(c.poisonId) ?? 0;
        }
        if(slot>=Const.MAX_POISONS) {c.index++;continue;}
        c.pending={target,slot,childEntry,childEventId:c.kind==='player'?target:event,...(partyIndex===undefined?{}:{partyIndex})};
        if(c.kind==='enemy') battleService.setEnemyPoison(target,slot,(p:any)=>{p.poisonID=c!.poisonId;return p;});
      }
      const p=c.pending;
      const continuation=this.executionRuntime.resume(frame,(frame.status='waiting',await this.runChildTrigger(p.childEntry,p.childEventId,frame)));
      // Player IDs are committed after the child; enemies already committed theirs.
      if(c.kind==='player') worldService.mutatePoisonStatus((matrix:any)=>{const slot=this.poisonEntry(matrix,p.slot,p.partyIndex!);slot.poisonID=c!.poisonId;slot.poisonScript=continuation;return matrix;});
      else battleService.setEnemyPoison(p.target,p.slot,(slot:any)=>{slot.poisonScript=continuation;return slot;});
      c.pending=null;c.index++;
    }
    this.poisonCursors.delete(frame.id);
  }
  private async runManualNpcMotion(frame:ScriptExecutionFrame,sc:any,eventId:number,targetId:number,current:any):Promise<number> {
    const saved=this.npcMotions.get(frame.id);
    if(saved) {if(saved.phase==='compose'){await this.runOwnedCompose(frame,sc,'npc');this.surface?.updateScreen(null);saved.phase='sleep';saved.remainingMs=16;this.captureWait({kind:'npc-motion',...saved});}this.npcMotions.delete(frame.id);return saved.returnPC;}
    const pc=frame.currentPC,op=sc.operation;
    if((op===0x11 || op===0x7c) && !((eventId&1) ^ ((op===0x11?worldService.getFrameCount():this.getFrameCounter())&1)))return pc;
    const cursor:NpcMotionCursor={opcodePC:pc,operation:op,operands:Array.from(sc.operand),eventId,targetId:op===0x6c?targetId:eventId,targetPresent:!!(op===0x6c?current:this.getEventObjectById(eventId)),movementCompleted:false,returnPC:op===0x6c?pc+1:pc,nextPC:pc+1,phase:'compose',remainingMs:0};
    this.npcMotions.set(frame.id,cursor);
    let completed=false;
    if(op===0x6c) {
      if(current){current.x+=SHORT(sc.operand[1]);current.y+=SHORT(sc.operand[2]);}
      this.NPCWalkOneStep(targetId,0);completed=true;
    } else {
      completed=this.NPCWalkTo(eventId,sc.operand[0],sc.operand[1],sc.operand[2],op===0x10?3:op===0x11?2:op===0x7c?4:8);
      if(completed){this.npcMotions.delete(frame.id);return pc+1;}
    }
    cursor.movementCompleted=completed;
    scene.updatePartyGestures(false,{preserveFrames:true});
    await this.runOwnedCompose(frame,sc,'npc');this.surface?.updateScreen(null);cursor.phase='sleep';cursor.remainingMs=16;
    this.captureWait({kind:'npc-motion',...cursor});
  }
  private async runManualPartyMotion(frame:ScriptExecutionFrame,sc:any,eventId:number):Promise<void> {
    let c=this.motions.get(frame.id);
    if(!c) {
      const family=motionFamily(sc.operation)!,[x,y,z]=sc.operand;
      if(family!=='viewport'){const trail=worldService.getTrail();if(!Array.isArray(trail) || !trail.length)return;}
      if(family==='ride' && this.normalizeEventIndex(eventId)==null)return;
      const viewport=getViewportSnapshot(),partyOffset=getPartyOffsetSnapshot();
      const event=family==='ride'?this.getEventObjectById(eventId):null;
      if(family==='ride' && !event)return;
      c={opcodePC:frame.currentPC,nextPC:frame.currentPC+1,operation:sc.operation,operands:Array.from(sc.operand),eventId,family,speed:motionSpeed(sc.operation),targetX:family==='viewport'?x*32-160:x*32+z*16,targetY:family==='viewport'?y*16-112:y*16+z*8,viewport,partyOffset,offsetX:0,offsetY:0,lastPartyIndex:family==='viewport'?getMaxPartyMemberIndexValue()+worldService.getFollowerCount():0,iteration:0,phase:'move',remainingMs:0};
      if(family!=='viewport'){c.offsetX=c.targetX-(event?event.x:PAL_X(viewport)+PAL_X(partyOffset));c.offsetY=c.targetY-(event?event.y:PAL_Y(viewport)+PAL_Y(partyOffset));}
      this.motions.set(frame.id,c);
    }
    const shift=(dx:number,dy:number)=>worldService.mutateParty((party:any)=>{for(let i=0;i<=c!.lastPartyIndex;i++){if(party[i]){party[i].x+=dx;party[i].y+=dy;}}return party;});
    while(c.phase!=='done') {
      if(c.phase==='sleep'){c.remainingMs=0;if(c.family==='viewport')c.iteration++;c.phase=c.family==='viewport' && c.iteration>=SHORT(c.operands[2])?'done':'move';}
      if(c.phase==='move') {
        if(c.family==='viewport') {
          const [x,y,z]=c.operands;
          if(x===0 && y===0){const leader=this.getPartyMember(0);if(!leader){c.phase='done';continue;}const dx=leader.x-160,dy=leader.y-112,vp=getViewportSnapshot();worldService.setViewport(PAL_XY(PAL_X(vp)+dx,PAL_Y(vp)+dy));worldService.setPartyOffset(PAL_XY(160,112));shift(-dx,-dy);c.phase=z===0xffff?'done':'compose';}
          else if(z===0xffff){const vp=getViewportSnapshot(),target=PAL_XY(c.targetX,c.targetY);worldService.setViewport(target);shift(PAL_X(vp)-PAL_X(target),PAL_Y(vp)-PAL_Y(target));c.phase='compose';}
          else{const dx=SHORT(x),dy=SHORT(y),vp=getViewportSnapshot(),offset=getPartyOffsetSnapshot();worldService.setViewport(PAL_XY(PAL_X(vp)+dx,PAL_Y(vp)+dy));worldService.setPartyOffset(PAL_XY(PAL_X(offset)-dx,PAL_Y(offset)-dy));shift(-dx,-dy);c.phase='world';}
        } else {
          if(c.offsetX===0 && c.offsetY===0){c.phase=c.family==='walk'?'final':'done';continue;}
          const dx=Math.abs(c.offsetX)>c.speed*2?c.speed*(c.offsetX<0?-2:2):c.offsetX,dy=Math.abs(c.offsetY)>c.speed?c.speed*(c.offsetY<0?-1:1):c.offsetY;
          const direction=c.offsetY<0?(c.offsetX<0?Direction.West:Direction.North):(c.offsetX<0?Direction.South:Direction.East);
          if(c.family==='ride')worldService.setPartyDirection(direction);
          const oldDirection=this.getPartyDirection();
          worldService.mutateTrail((rows:any)=>{if(!Array.isArray(rows)||!rows.length)return rows;shiftTrailInPlace(rows);rows[0]=rows[0]||{};rows[0].direction=oldDirection;rows[0].x=PAL_X(c!.viewport)+PAL_X(c!.partyOffset)+(c!.family==='ride'?dx:0);rows[0].y=PAL_Y(c!.viewport)+PAL_Y(c!.partyOffset)+(c!.family==='ride'?dy:0);return rows;});
          if(c.family==='walk')worldService.setPartyDirection(direction);
          c.viewport=PAL_XY(PAL_X(c.viewport)+dx,PAL_Y(c.viewport)+dy);worldService.setViewport(c.viewport);
          if(c.family==='ride')worldService.mutateEventObjectById(eventId,(event:any)=>{if(event){event.x+=dx;event.y+=dy;}return event;});
          c.phase=c.family==='walk'?'gestures':'world';
        }
      }
      if(c.phase==='gestures'){scene.updatePartyGestures(true);c.phase='world';}
      if(c.phase==='world') {
        c.worldUpdate ??={sceneId:getSceneIdSnapshot(),phase:'entry',eventIds:[],index:0,viewport:0,partyOffset:0,pendingReturn:null};
        await co(this.#invokeRewardWorldUpdate(false,c.worldUpdate,this.#guardRewardWorldHooks(frame,{invoke:(kind:'trigger'|'auto',entry:number,event:number)=>kind==='trigger'?this.#invokeRewardTrigger(entry,event,frame):this.#invokeRewardAuto(entry,event,frame)})));
        delete c.worldUpdate;c.phase='compose';
      }
      if(c.phase==='compose'){await this.runOwnedCompose(frame,sc,'party');c.phase='screen';}
      if(c.phase==='screen'){this.surface?.updateScreen(null);c.phase='measure';}
      if(c.phase==='measure') {
        if(c.family==='viewport' && c.operands[0]===0 && c.operands[1]===0){c.phase='done';continue;}
        if(c.family==='ride'){const event=this.getEventObjectById(eventId);if(!event){c.phase='done';continue;}c.offsetX=c.targetX-event.x;c.offsetY=c.targetY-event.y;}
        else if(c.family==='walk'){c.offsetX=c.targetX-PAL_X(c.viewport)-PAL_X(c.partyOffset);c.offsetY=c.targetY-PAL_Y(c.viewport)-PAL_Y(c.partyOffset);}
        c.phase='sleep';c.remainingMs=16;this.captureWait({kind:'party-motion',...c});
      }
      if(c.phase==='final'){scene.updatePartyGestures(false);c.phase='done';}
    }
    this.motions.delete(frame.id);
  }

  private async runManualFrameWait(frame:ScriptExecutionFrame,sc:any):Promise<void> {
    let cursor = this.frameWaits.get(frame.id);
    if (!cursor) {
      cursor = {
        opcodePC:frame.currentPC, nextPC:frame.currentPC+1,
        frameCount:sc.operand[0]||1, trigger:!!sc.operand[1], gestures:!!sc.operand[2],
        frameIndex:0, phase:'clear', remainingMs:0
      };
      this.frameWaits.set(frame.id,cursor);
    }
    if (cursor.phase==='clear') {
      if(this.dialogContext)clearOwnedDialog(this.dialogContext);
      else await resolveUiTask(ui.clearDialog(false));
      cursor.phase='gestures';
    }
    while (cursor.frameIndex<cursor.frameCount) {
      if (cursor.phase==='gestures') {
        if (cursor.gestures) scene.updatePartyGestures(false);
        cursor.phase='world';
      }
      if (cursor.phase==='world') {
        cursor.worldUpdate ??= {
          sceneId:getSceneIdSnapshot(), phase:'entry', eventIds:[], index:0,
          viewport:0, partyOffset:0, pendingReturn:null
        };
        // The owned runner also handles cold restores; the global script service
        // would otherwise enter a different execution context for these children.
        await co(this.#invokeRewardWorldUpdate(cursor.trigger,cursor.worldUpdate,this.#guardRewardWorldHooks(frame,{
          compose:async(u:WorldUpdateCursor,raw?:object)=>{
            if(u.composition!.site==='proximity-compose' && !u.composition!.lease)u.composition!.lease=worldService.acquireCompositionReference(this.manualIdentity!.id,{...u.composition!,site:'proximity-compose'},raw!);
            await this.runOwnedCompose(frame,sc,u.composition!.site==='entry-compose'?'world-entry':'world-proximity');
          },
          resolveComposition:(u:WorldUpdateCursor)=>worldService.resolveCompositionReference(u.composition!.lease!,this.manualIdentity!.id,{...u.composition!,site:'proximity-compose'}),
          releaseComposition:(u:WorldUpdateCursor)=>worldService.releaseCompositionReference(u.composition!.lease!),
          invoke:(kind:'trigger'|'auto',entry:number,eventId:number) => kind==='trigger'
            ? this.#invokeRewardTrigger(entry,eventId,frame)
            : this.#invokeRewardAuto(entry,eventId,frame)
        })));
        cursor.phase='compose';
        delete cursor.worldUpdate;
      }
      if (cursor.phase==='compose') {
        await this.runOwnedCompose(frame,sc,'frame');
        cursor.phase='screen';
      }
      if (cursor.phase==='screen') {
        this.surface?.updateScreen(null);
        cursor.phase='sleep';
        cursor.remainingMs=16;
        this.captureWait({kind:'frame',...cursor});
      }
      // Reaching this boundary means resumeExecution consumed the saved sleep.
      if (cursor.phase==='sleep') {
        cursor.frameIndex++;
        cursor.phase='gestures';
        cursor.remainingMs=0;
      }
    }
    this.frameWaits.delete(frame.id);this.motions.delete(frame.id);
    frame.currentPC++;
  }

  // Caches
  private partyStateCache: any[] = [];
  private trailStateCache: any[] = [];
  private partyTrailUnsubscribe: (() => void) | null = null;
  private battleStateCache: any = null;
  private battleStateUnsubscribe: (() => void) | null = null;

  // Signals
  private inventorySlice = inventorySignals();
  private cashSignal = this.inventorySlice.cash;
  private gameFlagSlice = gameFlagSignals();
  private collectSignal = this.gameFlagSlice.collect;
  private chaseRangeSignal = this.gameFlagSlice.chaseRange;
  private chaseCyclesSignal = this.gameFlagSlice.chaseSpeedChangeCycles;
  private battleSpeedSignal = this.gameFlagSlice.battleSpeed;
  private viewportSlice = viewportSignals();
  private viewportSignal = this.viewportSlice.viewport;
  private partyOffsetSignal = this.viewportSlice.partyOffset;
  private partyDirectionSignal = this.viewportSlice.partyDirection;

  constructor(executionRuntime = new ScriptExecutionRuntime()) {
    nativeBattleDispatchers.set(this,(entry,event,parent,authority,kind,worldCheck)=>kind==='auto'?this.#invokeRewardAuto(entry,event,parent,worldCheck):this.#invokeRewardTrigger(entry,event,parent,authority,undefined,worldCheck));
    this.executionRuntime = executionRuntime;
    registerRewardRunnerIdentity(this,executionRuntime.identity);
    this.handlePartyTrailUpdate = this.handlePartyTrailUpdate.bind(this);
    this.handleBattleStateUpdate = this.handleBattleStateUpdate.bind(this);
  }

  public setSurface(surface: Surface) {
    this.surface = surface;
  }

  public async init(surface: Surface) {
    this.setSurface(surface);
  }

  public isInBattle() {
    return battleService.isInBattle();
  }

  public getFrameCounter() {
    return worldService.getFrameCount();
  }

  private handlePartyTrailUpdate(event: any) {
    if (!event) return;
    switch (event.type) {
      case 'snapshot':
        this.partyStateCache = Array.isArray(event.party) ? event.party : this.partyStateCache;
        this.trailStateCache = Array.isArray(event.trail) ? event.trail : this.trailStateCache;
        break;
      case 'party':
        this.partyStateCache = Array.isArray(event.value) ? event.value : this.partyStateCache;
        break;
      case 'trail':
        this.trailStateCache = Array.isArray(event.value) ? event.value : this.trailStateCache;
        break;
      case 'disposed':
        if (typeof this.partyTrailUnsubscribe === 'function') {
          this.partyTrailUnsubscribe();
        }
        this.partyTrailUnsubscribe = null;
        this.partyStateCache = [];
        this.trailStateCache = [];
        break;
    }
  }

  private ensurePartyTrailBinding() {
    if (this.partyTrailUnsubscribe) return;
    this.partyTrailUnsubscribe = partyTrailAdapter.subscribe(this.handlePartyTrailUpdate);
  }

  private handleBattleStateUpdate(event: any) {
    if (!event) return;
    if (event.type === 'disposed') {
      this.battleStateCache = null;
      return;
    }
    if (event.state) {
      this.battleStateCache = event.state;
    }
  }

  private ensureBattleStateBinding() {
    if (this.battleStateUnsubscribe) return;
    this.battleStateCache = getBattleStateSnapshot() || {};
    this.battleStateUnsubscribe = subscribeBattleState(this.handleBattleStateUpdate);
  }

  private BATTLE() {
    this.ensureBattleStateBinding();
    if (battleService && typeof battleService.getState === 'function') {
      const proxyState = battleService.getState();
      if (proxyState) {
        this.battleStateCache = proxyState;
        return proxyState;
      }
    }
    if (!this.battleStateCache) {
      this.battleStateCache = getBattleStateSnapshot() || {};
    }
    return this.battleStateCache;
  }

  private getScriptEntrySafe(scriptEntry: number, eventObjectID: number, context: string) {
    if (!Number.isFinite(scriptEntry)) {
      this.scriptSuccess = false;
      log.warn(`[SCRIPT] ${context || 'script'} invalid script index ${scriptEntry} (event ${eventObjectID || 0})`);
      return null;
    }
    const sc = scriptObjectAdapter.getScriptEntry(scriptEntry);
    if (!sc) {
      log.warn(`[SCRIPT] ${context || 'script'} missing script entry ${scriptEntry} (event ${eventObjectID || 0})`);
      this.scriptSuccess = false;
      return null;
    }
    if (!sc.operand || typeof sc.operand.length !== 'number') {
      // Keep malformed atomic sources visible to manual preflight; Native keeps its fallback.
      if (!(this.manualExecution && [0x1f,0x20,0x23,0x1b,0x1c,0x1d,0x22,0x5f,0x74,0x2b,0x2c,0x2d,0x2f,0x5d,0x61,0x6d,0x6f,0x71,0x24,0x25,0x7e].includes(sc.operation))) sc.operand = [0, 0, 0, 0];
    }
    if (typeof sc.operation !== 'number') {
      log.warn(`[SCRIPT] ${context || 'script'} invalid operation at entry ${scriptEntry} (event ${eventObjectID || 0})`);
      this.scriptSuccess = false;
      return null;
    }
    // 黄金轨迹埋点:每条被取出执行的指令。没挂钩子时只多一次全局读。
    const traceHook = (globalThis as any).__PAL_SCRIPT_TRACE__;
    if (typeof traceHook === 'function') {
      traceHook(scriptEntry, sc.operation, eventObjectID || 0, context);
    }
    return sc;
  }

  private getEventObjectById(eventId: number) {
    const index = eventId > 0 ? eventId - 1 : null;
    if (index === null) return null;
    const entry = sceneEventAdapter.getEventObjectEntryById(eventId);
    if (entry && entry.state) return entry.state;
    const stateByIndex = sceneEventAdapter.getEventObjectStateByIndex(index);
    if (stateByIndex) return stateByIndex;
    const gameData = stateService.getGameData('eventObject');
    if (Array.isArray(gameData) && gameData[index]) return gameData[index];
    return null;
  }

  private resolveEventTarget(operand: number, fallbackId: number | null) {
    if (typeof operand !== 'number' || operand === 0 || operand === 0xFFFF || operand < 0) {
      const fallbackResolved = (typeof fallbackId === 'number' && fallbackId > 0) ? fallbackId : null;
      return {
        id: fallbackResolved,
        object: fallbackResolved ? this.getEventObjectById(fallbackResolved) : null
      };
    }
    let targetId = operand;
    let index = targetId - 1;
    if (index > 0x9000) {
      index -= 0x9000;
      targetId = index + 1;
    }
    if (index < 0) {
      return { id: null, object: null };
    }
    const resolvedObject = this.getEventObjectById(targetId);
    return {
      id: resolvedObject ? targetId : null,
      object: resolvedObject
    };
  }

  private getPartyState() {
    this.ensurePartyTrailBinding();
    if (!Array.isArray(this.partyStateCache)) {
      this.partyStateCache = partyTrailAdapter.getPartyState();
    }
    return this.partyStateCache;
  }

  private getPartyMember(index: number) {
    this.ensurePartyTrailBinding();
    if (typeof partyTrailAdapter.getPartyMember === 'function') {
      return partyTrailAdapter.getPartyMember(index);
    }
    const party = this.getPartyState();
    return Array.isArray(party) ? party[index] || null : null;
  }

  private getMaxPartyMemberIndex() {
    const value = getMaxPartyMemberIndexValue();
    if (typeof value === 'number' && value >= 0) return value;
    const party = this.getPartyState();
    if (Array.isArray(party) && party.length > 0) return party.length - 1;
    return value;
  }

  private getViewportValue() {
    const value = this.viewportSignal.value;
    if (Number.isFinite(value)) return value;
    return getViewportSnapshot();
  }

  private getViewportX() {
    return PAL_X(this.getViewportValue());
  }

  private getViewportY() {
    return PAL_Y(this.getViewportValue());
  }

  private getPartyOffsetValue() {
    const value = this.partyOffsetSignal.value;
    if (Number.isFinite(value)) return value;
    return getPartyOffsetSnapshot();
  }

  private getPartyOffsetX() {
    return PAL_X(this.getPartyOffsetValue());
  }

  private getPartyOffsetY() {
    return PAL_Y(this.getPartyOffsetValue());
  }

  private getPartyDirection() {
    const value = this.partyDirectionSignal.value;
    if (Number.isFinite(value)) return value;
    return getPartyDirectionSnapshot();
  }

  private getSceneEventRange() {
    const sceneId = getSceneIdSnapshot();
    const currentScene = getSceneEntrySnapshot(sceneId);
    const nextScene = getSceneEntrySnapshot(sceneId + 1);
    const startIndex = currentScene && typeof currentScene.eventObjectIndex === 'number' ? currentScene.eventObjectIndex : 0;
    const totalObjects = sceneEventAdapter.getEventObjectIds().length;
    const endIndex = nextScene && typeof nextScene.eventObjectIndex === 'number' ? nextScene.eventObjectIndex : totalObjects;
    return { sceneId, startIndex, endIndex };
  }

  private syncViewportToParty({ preserveFrames = true } = {}) {
    try {
      const viewportValue = getViewportSnapshot();
      const partyOffsetValue = getPartyOffsetSnapshot();
      const heroX = PAL_X(viewportValue) + PAL_X(partyOffsetValue);
      const heroY = PAL_Y(viewportValue) + PAL_Y(partyOffsetValue);
      worldService.setViewport(PAL_XY(heroX - PAL_X(partyOffsetValue), heroY - PAL_Y(partyOffsetValue)));
      if (scene && typeof scene.updatePartyGestures === 'function') {
        scene.updatePartyGestures(false, { preserveFrames });
      }
    } catch (err) {
      // ignore
    }
  }

  private forEachPartyMember(callback: (member: any) => void) {
    const party = this.getPartyState();
    const maxIndex = this.getMaxPartyMemberIndex();
    for (let i = 0; i <= maxIndex && i < party.length; i++) {
      const member = party[i];
      if (member) {
        callback(member);
      }
    }
  }

  private normalizeEventIndex(eventId: number) {
    var numericId = Number(eventId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return null;
    }
    var index = numericId - 1;
    return index >= 0 ? index : null;
  }

  // PAL_NPCWalkOneStep: move by direction * speed without any obstacle check and advance the
  // walking frame unconditionally. Speed 0 (0x006C, 0x0087, a chasing monster whose target is
  // out of range) therefore only animates. Scripted walks (0x0010/0x0011/0x007C/0x0082) rely on
  // this never being blocked.
  private NPCWalkOneStep(eventObjectID: number, speed: number) {
    var eventIndex = this.normalizeEventIndex(eventObjectID);
    if (eventIndex == null) {
      return;
    }
    var evtObj = this.getEventObjectById(eventObjectID);
    if (!evtObj) {
      return;
    }

    worldService.mutateEventObjectById(eventObjectID, (current: any) => {
      if (!current) {
        return current;
      }
      var direction = current.direction;
      current.x = WORD(current.x + ((direction === Direction.West || direction === Direction.South) ? -2 : 2) * speed);
      current.y = WORD(current.y + ((direction === Direction.West || direction === Direction.North) ? -1 : 1) * speed);
      if (current.spriteFrames > 0) {
        current.currentFrameNum = (current.currentFrameNum + 1) % (current.spriteFrames === 3 ? 4 : current.spriteFrames);
      } else if (current.spriteFramesAuto > 0) {
        current.currentFrameNum = (current.currentFrameNum + 1) % current.spriteFramesAuto;
      }
      return current;
    });
  }

  private NPCWalkTo(eventObjectID: number, x: number, y: number, z: number, speed: number) {
    if (shouldDebugScript()) {
      log.debug(`[SCRIPT] NPCWalkTo(${eventObjectID}, ${x}, ${y}, ${speed})`);
    }
    var eventIndex = this.normalizeEventIndex(eventObjectID);
    if (eventIndex == null) {
      return false;
    }
    var evtObj = this.getEventObjectById(eventObjectID);
    if (!evtObj) {
      return false;
    }
    var targetX = x * 32 + z * 16;
    var targetY = y * 16 + z * 8;
    var offsetX = targetX - evtObj.x;
    var offsetY = targetY - evtObj.y;
    var moveSpeed = (typeof speed === 'number' && Number.isFinite(speed) && speed !== 0)
      ? Math.abs(speed)
      : 1;
    var nextDirection = (offsetY < 0)
      ? (offsetX < 0 ? Direction.West : Direction.North)
      : (offsetX < 0 ? Direction.South : Direction.East);

    worldService.mutateEventObjectById(eventObjectID, (current: any) => {
      if (!current) {
        return current;
      }
      current.direction = nextDirection;
      return current;
    });

    if (Math.abs(offsetX) < moveSpeed * 2 || Math.abs(offsetY) < moveSpeed * 2) {
      worldService.mutateEventObjectById(eventObjectID, (current: any) => {
        if (!current) {
          return current;
        }
        current.x = WORD(targetX);
        current.y = WORD(targetY);
        current.currentFrameNum = 0;
        return current;
      });
    } else {
      this.NPCWalkOneStep(eventObjectID, moveSpeed);
    }

    var updated = this.getEventObjectById(eventObjectID);
    if (updated && updated.x === targetX && updated.y === targetY) {
      worldService.mutateEventObjectById(eventObjectID, (current: any) => {
        if (!current) {
          return current;
        }
        current.currentFrameNum = 0;
        return current;
      });
      return true;
    }

    return false;
  }

  private async partyRideEventObject(eventObjectID: number, x: number, y: number, z: number, speed: number) {
    log.debug(`[SCRIPT] partyRideEventObject(${eventObjectID}, ${x}, ${y}, ${speed})`);
    var trail = worldService.getTrail();
    if (!Array.isArray(trail) || trail.length === 0) {
      return;
    }
    var eventIndex = this.normalizeEventIndex(eventObjectID);
    if (eventIndex == null) {
      return;
    }
    var targetX = x * 32 + z * 16;
    var targetY = y * 16 + z * 8;
    var viewport = getViewportSnapshot();
    var partyOffset = getPartyOffsetSnapshot();
    var currentEvent = this.getEventObjectById(eventObjectID);
    if (!currentEvent) {
      return;
    }
    var offsetX = targetX - currentEvent.x;
    var offsetY = targetY - currentEvent.y;

    while (offsetX !== 0 || offsetY !== 0) {
      var nextDirection = (offsetY < 0)
        ? (offsetX < 0 ? Direction.West : Direction.North)
        : (offsetX < 0 ? Direction.South : Direction.East);
      worldService.setPartyDirection(nextDirection);

      var dx: any;
      var dy: any;
      if (Math.abs(offsetX) > speed * 2) {
        dx = speed * (offsetX < 0 ? -2 : 2);
      } else {
        dx = offsetX;
      }
      if (Math.abs(offsetY) > speed) {
         dy = speed * (offsetY < 0 ? -1 : 1);
      } else {
         dy = offsetY;
      }

      // Store trail
      var previousDirection = this.getPartyDirection();
      worldService.mutateTrail((trailState: any) => {
        if (!Array.isArray(trailState) || trailState.length === 0) {
          return trailState;
        }
        shiftTrailInPlace(trailState);
        trailState[0] = trailState[0] || {};
        trailState[0].direction = previousDirection;
        trailState[0].x = PAL_X(viewport) + dx + PAL_X(partyOffset);
        trailState[0].y = PAL_Y(viewport) + dy + PAL_Y(partyOffset);
        return trailState;
      });

      // Move the viewport
      var newViewport = PAL_XY(
        PAL_X(viewport) + dx,
        PAL_Y(viewport) + dy
      );
      worldService.setViewport(newViewport);
      viewport = newViewport;

      worldService.mutateEventObjectById(eventObjectID, (current: any) => {
        if (!current) {
          return current;
        }
        current.x = WORD(current.x + dx);
        current.y = WORD(current.y + dy);
        return current;
      });

      await co(play.update(false));
      await co(scene.makeScene());
      this.surface?.updateScreen(null);
      currentEvent = this.getEventObjectById(eventObjectID);
      if (!currentEvent) {
        break;
      }
      offsetX = targetX - currentEvent.x;
      offsetY = targetY - currentEvent.y;

      await sleepSceneFrame();
    }
  }

  private monsterChasePlayer(eventObjectID: number, speed: number, range: number, unknown: number) {
    if (shouldDebugScript()) {
      log.debug(`[SCRIPT] monsterChasePlayer(${eventObjectID}, ${speed}, ${range})`);
    }
    var eventIndex = this.normalizeEventIndex(eventObjectID);
    if (eventIndex == null) {
      this.NPCWalkOneStep(eventObjectID, 0);
      return;
    }
    var evtObj = this.getEventObjectById(eventObjectID);
    if (!evtObj) {
      this.NPCWalkOneStep(eventObjectID, 0);
      return;
    }
    var monsterSpeed = 0;
    var posX = evtObj.x;
    var posY = evtObj.y;
    var direction = typeof evtObj.direction === 'number' ? evtObj.direction : Direction.South;
    var chaseRangeModifier = getChaseRangeFlagValue();
    if (chaseRangeModifier !== 0) {
      var viewport = getViewportSnapshot();
      var partyOffset = getPartyOffsetSnapshot();
      var relativeX = PAL_X(viewport) + PAL_X(partyOffset) - posX;
      var relativeY = PAL_Y(viewport) + PAL_Y(partyOffset) - posY;

      if (relativeX === 0) {
        relativeX = randomLong(0, 1) ? -1 : 1;
      }
      if (relativeY === 0) {
        relativeY = randomLong(0, 1) ? -1 : 1;
      }
      var prevx = posX;
      var prevy = posY;
      var i = prevx % 32;
      var j = prevy % 16;
      prevx = Math.floor(prevx / 32);
      prevy = Math.floor(prevy / 16);
      var l = 0;
      if (i + j * 2 >= 16) {
        if (i + j * 2 >= 48) {
          prevx++;
          prevy++;
        } else if (32 - i + j * 2 < 16) {
          prevx++;
        } else if (32 - i + j * 2 < 48) {
          l = 1;
        } else {
          prevy++;
        }
      }
      prevx = prevx * 32 + l * 16;
      prevy = prevy * 16 + l * 8;

      // Is the party near to the event object?
      if (Math.abs(relativeX) + Math.abs(relativeY) * 2 < range * 32 * chaseRangeModifier) {
        if (relativeX < 0) {
          direction = (relativeY < 0) ? Direction.West : Direction.South;
        } else {
          direction = (relativeY < 0) ? Direction.North : Direction.East;
        }

        var targetX = posX;
        var targetY = posY;
        if (relativeX !== 0) {
          targetX = posX + Math.floor(relativeX / Math.abs(relativeX)) * 16;
        }
        if (relativeY !== 0) {
          targetY = posY + Math.floor(relativeY / Math.abs(relativeY)) * 8;
        }

        var floating = unknown; 

        if (floating) {
          monsterSpeed = speed;
        } else {
          var adjustedX = posX;
          var adjustedY = posY;
          if (!scene.checkObstacle(PAL_XY(targetX, targetY), true, eventObjectID)) {
            monsterSpeed = speed;
          } else {
            adjustedX = prevx;
            adjustedY = prevy;
          }
          for (l = 0; l < 4; l++) {
            var testX = adjustedX;
            var testY = adjustedY;
            switch (l) {
              case 0:
                testX -= 4;
                testY += 2;
                break;
              case 1:
                testX -= 4;
                testY -= 2;
                break;
              case 2:
                testX += 4;
                testY -= 2;
                break;
              case 3:
                testX += 4;
                testY += 2;
                break;
            }
            if (scene.checkObstacle(PAL_XY(testX, testY), false, 0)) {
              testX = prevx;
              testY = prevy;
            }
            adjustedX = testX;
            adjustedY = testY;
          }
          posX = adjustedX;
          posY = adjustedY;
        }
      }
    } else if (this.getFrameCounter() & 1) {
      // Chase range 0 (repel incense): the monster just turns around in place every other frame.
      direction = (direction + 1) % 4;
    }

    worldService.mutateEventObjectById(eventObjectID, (current: any) => {
      if (!current) {
        return current;
      }
      current.direction = direction;
      current.x = WORD(posX);
      current.y = WORD(posY);
      return current;
    });
    this.NPCWalkOneStep(eventObjectID, monsterSpeed);
  }

  private addMagic(roleId: number, magicId: number) {
    if (findPlayerMagicSlotValue(roleId, magicId) >= 0) {
      // already have this magic
      return false;
    }

    var slots = getPlayerMagicSlotsValue(roleId);
    var targetSlot = -1;
    for (var i = 0; i < Const.MAX_PLAYER_MAGICS && i < slots.length; ++i) {
      if (!slots[i]) {
        targetSlot = i;
        break;
      }
    }
    if (targetSlot < 0) {
      // Not enough slots
      return false;
    }

    worldService.setPlayerMagicSlot(roleId, targetSlot, magicId);

    return true;
  }

  private removeMagic(roleId: number, magicId: number) {
    var slotIndex = findPlayerMagicSlotValue(roleId, magicId);
    if (slotIndex >= 0) {
      worldService.setPlayerMagicSlot(roleId, slotIndex, 0);
    }
  }

  private increaseHPMP(roleId: number, hp: number, mp: number) {
    var currentHP = getPlayerHPValue(roleId);
    if (currentHP <= 0) {
      return false;
    }

    var maxHP = getPlayerMaxHPValue(roleId);
    var nextHP = currentHP + hp;
    if (nextHP < 0) {
      nextHP = 0;
    } else if (maxHP && nextHP > maxHP) {
      nextHP = maxHP;
    }
    worldService.setPlayerHP(roleId, nextHP);

    var currentMP = getPlayerMPValue(roleId);
    var maxMP = getPlayerMaxMPValue(roleId);
    var nextMP = currentMP + mp;
    if (nextMP < 0) {
      nextMP = 0;
    } else if (maxMP && nextMP > maxMP) {
      nextMP = maxMP;
    }
    worldService.setPlayerMP(roleId, nextMP);

    return nextHP !== currentHP || nextMP !== currentMP;
  }

  private addItemToInventory(itemId: number, amount: number): boolean | number {
    if (itemId == 0) {
      return false;
    }
    if (amount == 0) {
      amount = 1;
    }

    var success: boolean | number = false;
    worldService.mutateInventory((inventory: any) => {
      var capacity = worldService.getInventoryCapacity();
      var index = 0;
      var found = false;
      while (index < capacity) {
        var slot = inventory[index];
        if (!slot) {
          break;
        }
        if (slot.item === itemId) {
          found = true;
          break;
        }
        if (slot.item === 0) {
          break;
        }
        index++;
      }

      if (amount > 0) {
        if (index >= capacity) {
          return inventory;
        }
        var target = inventory[index];
        if (!target) {
          return inventory;
        }
        if (found) {
          target.amount += amount;
          if (target.amount > 99) {
            target.amount = 99;
          }
        } else {
          target.item = itemId;
          target.amount = Math.min(amount, 99);
        }
        success = true;
        return inventory;
      }

      if (!found) {
        success = false;
        return inventory;
      }

      var removal = amount * -1;
      var removalTarget = inventory[index];
      if (!removalTarget) {
        success = false;
        return inventory;
      }
      if (removalTarget.amount < removal) {
        // PAL_AddItemToInventory returns -(still missing) here; 0x0020 takes the rest from equipment.
        success = -(removal - removalTarget.amount);
        removalTarget.amount = 0;
        return inventory;
      }
      removalTarget.amount -= removal;
      success = true;
      return inventory;
    });

    return success;
  }

  private removeEquipmentEffect(roleId: number, equipPart: number) {
    worldService.clearEquipmentEffect(equipPart, roleId);
    if (equipPart === BodyPart.Hand) {
      this.setPlayerStatus(roleId, PlayerStatus.DualAttack, 0);
    } else if (equipPart === BodyPart.Misc) {
      // Misc is SDLPAL's kBodyPartWear (5). Taking it off drops the special (level >= 99)
      // poisons it granted and keeps ordinary ones, compacted to the front.
      var partyIndex = this.partyIndexOfRole(roleId);
      if (partyIndex < 0) {
        return;
      }
      worldService.mutatePoisonStatus((matrix: any) => {
        var kept: any[] = [];
        for (var i = 0; i < Const.MAX_POISONS; i++) {
          var entry = this.poisonEntry(matrix, i, partyIndex);
          if (!entry.poisonID) {
            break;
          }
          if (this.poisonLevelOf(entry.poisonID) < 99) {
            kept.push({ poisonID: entry.poisonID, poisonScript: entry.poisonScript });
          }
        }
        for (var j = 0; j < Const.MAX_POISONS; j++) {
          var slot = this.poisonEntry(matrix, j, partyIndex);
          slot.poisonID = j < kept.length ? kept[j].poisonID : 0;
          slot.poisonScript = j < kept.length ? kept[j].poisonScript : 0;
        }
        return matrix;
      });
    }
  }

  // The poison matrix is [slot][party index] (as in SDLPAL); everything here takes a role id.
  private partyIndexOfRole(roleId: number) {
    const party = this.getPartyState();
    const maxIndex = this.getMaxPartyMemberIndex();
    for (let i = 0; i <= maxIndex && i < party.length; i++) {
      if (party[i] && party[i].playerRole === roleId) {
        return i;
      }
    }
    return -1;
  }

  private poisonEntry(matrix: any, slot: number, partyIndex: number) {
    if (!matrix[slot]) {
      matrix[slot] = [];
    }
    if (!matrix[slot][partyIndex]) {
      matrix[slot][partyIndex] = { poisonID: 0, poisonScript: 0 };
    }
    return matrix[slot][partyIndex];
  }

  private readPoisonEntry(slot: number, partyIndex: number) {
    const matrix = getPoisonStatusMatrixValue() as any;
    const row = matrix && matrix[slot];
    return (row && row[partyIndex]) || null;
  }

  private poisonLevelOf(poisonId: number) {
    var obj = scriptObjectAdapter.getObjectEntry(poisonId);
    return (obj && obj.poison) ? ((obj.poison as any).poisonLevel || 0) : 0;
  }

  private async addPoisonForPlayer(roleId: number, poisonId: number, parentFrame?: ScriptExecutionFrame) {
    var partyIndex = this.partyIndexOfRole(roleId);
    if (partyIndex < 0) {
      return;
    }
    var slotIndex: number;
    for (slotIndex = 0; slotIndex < Const.MAX_POISONS; slotIndex++) {
      var entry = this.readPoisonEntry(slotIndex, partyIndex);
      var current = entry ? entry.poisonID : 0;
      if (!current) {
        break;
      }
      if (current === poisonId) {
        return; // already poisoned
      }
    }
    if (slotIndex >= Const.MAX_POISONS) {
      return;
    }
    // SDLPAL runs the poison's player script right away and keeps its continuation.
    var poisonObject = scriptObjectAdapter.getObjectEntry(poisonId);
    var playerScript = (poisonObject && poisonObject.poison) ? (poisonObject.poison as any).playerScript : 0;
    var continuation = await this.runChildTrigger(playerScript, roleId, parentFrame);
    worldService.mutatePoisonStatus((matrix: any) => {
      var slot = this.poisonEntry(matrix, slotIndex, partyIndex);
      slot.poisonID = poisonId;
      slot.poisonScript = continuation;
      return matrix;
    });
  }

  // PAL_IsPlayerPoisonedByLevel: any ordinary (< 99) poison of at least minLevel.
  private isPlayerPoisonedByLevel(roleId: number, minLevel: number) {
    var partyIndex = this.partyIndexOfRole(roleId);
    if (partyIndex < 0) {
      return false;
    }
    for (var i = 0; i < Const.MAX_POISONS; ++i) {
      var entry = this.readPoisonEntry(i, partyIndex);
      if (!entry || !entry.poisonID) {
        continue;
      }
      var level = this.poisonLevelOf(entry.poisonID);
      if (level >= 99) {
        continue;
      }
      if (level >= minLevel) {
        return true;
      }
    }
    return false;
  }

  private setPlayerStatus(roleId: number, statusId: number, duration: number) {
    worldService.mutatePlayerStatus((matrix: any) => {
      if (!matrix[roleId]) {
        matrix[roleId] = [];
      }
      var row = matrix[roleId] as any;
      if (Array.isArray(row)) {
        row[statusId] = duration;
      }
      return matrix;
    });
  }

  // PAL_RemovePlayerStatus: values above 999 are permanent (from equipment) and stay.
  private removePlayerStatus(roleId: number, statusId: number) {
    if (getPlayerStatusValueFromAdapter(roleId, statusId) <= 999) {
      this.setPlayerStatus(roleId, statusId, 0);
    }
  }

  // PAL_SetPlayerStatus (classic): returns false when the status cannot be applied.
  private applyPlayerStatus(roleId: number, statusId: number, rounds: number) {
    const current = getPlayerStatusValueFromAdapter(roleId, statusId) || 0;
    const alive = getPlayerHPValue(roleId) !== 0;
    switch (statusId) {
      case PlayerStatus.Confused:
      case PlayerStatus.Sleep:
      case PlayerStatus.Silence:
      case PlayerStatus.Paralyzed:
        // Not refreshed while it is still in effect.
        if (current === 0) {
          this.setPlayerStatus(roleId, statusId, rounds);
        }
        return true;
      case PlayerStatus.Puppet:
        // Only works on a fallen member.
        if (!alive) {
          if (current < rounds) {
            this.setPlayerStatus(roleId, statusId, rounds);
          }
          return true;
        }
        return false;
      case PlayerStatus.Bravery:
      case PlayerStatus.Protect:
      case PlayerStatus.DualAttack:
      case PlayerStatus.Haste:
        if (alive && current < rounds) {
          this.setPlayerStatus(roleId, statusId, rounds);
        }
        return true;
      default:
        return true;
    }
  }

  private curePoisonByKind(roleId: number, poisonId: number, frame?:ScriptExecutionFrame) {
    var partyIndex = this.partyIndexOfRole(roleId);
    if (partyIndex < 0) {
      return;
    }
    const cleared:number[]=[];
    worldService.mutatePoisonStatus((matrix: any) => {
      for (var i = 0; i < Const.MAX_POISONS; ++i) {
        var entry = this.poisonEntry(matrix, i, partyIndex);
        if (entry.poisonID === poisonId) {
          cleared.push(i);entry.poisonID = 0;
          entry.poisonScript = 0;
        }
      }
      return matrix;
    });
    for(const slot of cleared)battlePoisonRuntime.noteSlotCleared(frame,'party',partyIndex,slot);
  }

  private curePoisonByLevel(roleId: number, maxLevel: number, frame?:ScriptExecutionFrame) {
    var partyIndex = this.partyIndexOfRole(roleId);
    if (partyIndex < 0) {
      return;
    }
    const cleared:number[]=[];
    worldService.mutatePoisonStatus((matrix: any) => {
      for (var i = 0; i < Const.MAX_POISONS; ++i) {
        var entry = this.poisonEntry(matrix, i, partyIndex);
        if (this.poisonLevelOf(entry.poisonID) <= maxLevel) {
          cleared.push(i);entry.poisonID = 0;
          entry.poisonScript = 0;
        }
      }
      return matrix;
    });
    for(const slot of cleared)battlePoisonRuntime.noteSlotCleared(frame,'party',partyIndex,slot);
  }

  // PAL_UpdateEquipments: clear all equipment effects, then replay the equip script of every
  // equipped item for all MAX_PLAYER_ROLES roles (not only the party), keeping each script's
  // continuation as the item's new wScriptOnEquip. The 0x0018 inside an equip script removes
  // that part's effect itself (dual attack, level-99 poisons), as in SDLPAL.
  private async runManualEquipments(parentFrame?:ScriptExecutionFrame):Promise<void> {
    this.requireManualOwner(parentFrame);
    const frame=this.executionRuntime.begin('equipment',0,0,parentFrame?.id??null,this);
    this.manualOwnedFrames.add(frame.id);
    const restored=this.restoreFrames.shift();
    const cursor=restored?.equipmentCursor ?? createEquipmentCursor();
    this.equipmentCursors.set(frame.id,cursor);
    if(!this.restoreFrames.length)this.rootEndingClock?.lane.begin();
    let completed=false;
    try {
      if(!cursor.resetDone){worldService.resetEquipmentEffects();cursor.resetDone=true;}
      // A restored pending child runs before any equipment/item world reread.
      while(cursor.role<6){
        if(!cursor.pending){
          const itemId=getPlayerEquipmentFromAdapter(cursor.part,cursor.role);
          const entry=itemId ? scriptObjectAdapter.getObjectEntry(itemId) : null;
          const itemData=(entry as any)?.item;
          const scriptEntry=typeof itemData?.scriptOnEquip==='number' ? itemData.scriptOnEquip : 0;
          if(!scriptEntry){advanceEquipmentCursor(cursor);continue;}
          cursor.pending={itemId,scriptEntry,role:cursor.role,part:cursor.part};
        }
        const pending=cursor.pending;
        const next=this.executionRuntime.resume(frame,(frame.status='waiting',await this.runChildTrigger(pending.scriptEntry,pending.role,frame)));
        worldService.mutateObjectEntry(pending.itemId,(entry:any)=>{if(entry?.item)entry.item.scriptOnEquip=next;return entry;});
        advanceEquipmentCursor(cursor);
      }
      completed=true;
    } finally {this.equipmentCursors.delete(frame.id);this.manualOwnedFrames.delete(frame.id);this.executionRuntime.finish(frame,completed);}
  }

  public async updateEquipments(parentFrame?: ScriptExecutionFrame) {
    if(this.manualExecution){await this.runManualEquipments(parentFrame);return;}
    worldService.resetEquipmentEffects();

    for (let roleId = 0; roleId < Const.MAX_PLAYER_ROLES; roleId++) {
      for (let part = 0; part < Const.MAX_PLAYER_EQUIPMENTS; part++) {
        const itemId = getPlayerEquipmentFromAdapter(part, roleId);
        if (!itemId) continue;
        const objectEntry = scriptObjectAdapter.getObjectEntry(itemId);
        const itemData = objectEntry && (objectEntry as any).item ? (objectEntry as any).item : null;
        const equipScript = itemData && typeof itemData.scriptOnEquip === 'number' ? itemData.scriptOnEquip : 0;
        if (!equipScript) continue;
        const nextEquipScript = await this.runChildTrigger(equipScript, roleId, parentFrame);
        worldService.mutateObjectEntry(itemId, (entry: any) => {
          if (entry && entry.item) {
            entry.item.scriptOnEquip = nextEquipScript;
          }
          return entry;
        });
      }
    }
  }

  /** PAL_CompressInventory —— 走 worldService 写口(M2 D1:背包真相源是组件) */
  public compressInventory() {
    worldService.compressInventory();
  }

  private async partyWalkTo(x: number, y: number, z: number, speed: number) {
    log.debug(`[SCRIPT] partyWalkTo(${x}, ${y}, ${speed})`);
    var trail = worldService.getTrail();
    if (!Array.isArray(trail) || trail.length === 0) {
      return;
    }
    var viewport = getViewportSnapshot();
    var partyOffset = getPartyOffsetSnapshot();
    var offsetX = (x * 32 + z * 16) - PAL_X(viewport) - PAL_X(partyOffset);
    var offsetY = (y * 16 + z * 8) - PAL_Y(viewport) - PAL_Y(partyOffset);

    while (offsetX !== 0 || offsetY !== 0) {
      var currentDirection = this.getPartyDirection();
      worldService.mutateTrail((trailState: any) => {
        if (!Array.isArray(trailState) || trailState.length === 0) {
          return trailState;
        }
        shiftTrailInPlace(trailState);
        trailState[0] = trailState[0] || {};
        trailState[0].direction = currentDirection;
        trailState[0].x = PAL_X(viewport) + PAL_X(partyOffset);
        trailState[0].y = PAL_Y(viewport) + PAL_Y(partyOffset);
        return trailState;
      });

      var nextDirection = (offsetY < 0)
        ? (offsetX < 0 ? Direction.West : Direction.North)
        : (offsetX < 0 ? Direction.South : Direction.East);
      worldService.setPartyDirection(nextDirection);

      var dx = PAL_X(viewport);
      var dy = PAL_Y(viewport);
      if (Math.abs(offsetX) <= speed * 2) {
        dx += offsetX;
      } else {
        dx += speed * (offsetX < 0 ? -2 : 2);
      }
      if (Math.abs(offsetY) <= speed) {
        dy += offsetY;
      } else {
        dy += speed * (offsetY < 0 ? -1 : 1);
      }

      log.trace('[SCRIPT] Move the viewport');
      var newViewport = PAL_XY(dx, dy);
      worldService.setViewport(newViewport);
      viewport = newViewport;

      scene.updatePartyGestures(true);
      await co(play.update(false));
      await co(scene.makeScene());
      this.surface?.updateScreen(null);

      offsetX = (x * 32 + z * 16) - PAL_X(viewport) - PAL_X(partyOffset);
      offsetY = (y * 16 + z * 8) - PAL_Y(viewport) - PAL_Y(partyOffset);

      await sleepSceneFrame();
    }

    scene.updatePartyGestures(false);
  }

  // PAL_PlayerLevelUp: raises the level and grows the stats (random part per level, capped at
  // 999). It does not heal; the battle reward code restores HP/MP itself.
  private playerLevelUp(roleId: number, levels: number) {
    // PLAYERROLES word fields, in SDLPAL order.
    const LEVEL = 6, MAX_HP = 7, MAX_MP = 8, ATTACK = 17, MAGIC = 18, DEFENSE = 19, DEXTERITY = 20, FLEE = 21;
    const word = (field: number) => worldService.getPlayerRoleWord(field, roleId) || 0;
    var level = Math.min(word(LEVEL) + levels, Const.MAX_LEVELS);
    worldService.setPlayerRoleWord(LEVEL, roleId, level);
    var growth: Record<number, number> = {};
    [MAX_HP, MAX_MP, ATTACK, MAGIC, DEFENSE, DEXTERITY, FLEE].forEach((field) => {
      growth[field] = word(field);
    });
    for (var i = 0; i < levels; i++) {
      growth[MAX_HP] += 10 + randomLong(0, 7);
      growth[MAX_MP] += 8 + randomLong(0, 5);
      growth[ATTACK] += 4 + randomLong(0, 1);
      growth[MAGIC] += 4 + randomLong(0, 1);
      growth[DEFENSE] += 2 + randomLong(0, 1);
      growth[DEXTERITY] += 2 + randomLong(0, 1);
      growth[FLEE] += 2;
    }
    Object.keys(growth).forEach((field) => {
      worldService.setPlayerRoleWord(Number(field), roleId, Math.min(growth[Number(field)], 999));
    });
    worldService.mutateExpState((state: any) => {
      if (state && state.primaryExp && state.primaryExp[roleId]) {
        state.primaryExp[roleId].exp = 0;
        state.primaryExp[roleId].level = level;
      }
      return state;
    });
  }

  private getMagicNumberFromObject(objectId: number) {
    var obj = scriptObjectAdapter.getObjectEntry(objectId);
    if (obj && obj.magic) {
      return (obj.magic as any).magicNumber;
    }
    return 0;
  }

  /**
   * Draw the item box with the item bitmap at the center of the screen,
   * as 0x0034 does in SDLPAL before showing the text.
   */
  private drawCollectedItemBox(itemId: number,observe?:(site:string,value:any,current:()=>any,bitmap?:number)=>void) {
    var surface = this.surface as any;
    var itemBox = ui.sprite && ui.sprite.frames ? ui.sprite.frames[ui.SPRITENUM_ITEMBOX] : null;
    observe?.('itembox',itemBox,()=>{const u=(globalThis as any).ui,sprite=generatedOwnData(u,'sprite'),frames=generatedOwnData(sprite,'frames'),index=generatedOwnData(u,'SPRITENUM_ITEMBOX');return frames?generatedOwnData(frames,String(index)):null;});
    if (!surface || !itemBox) {
      return;
    }
    var bgX = ~~((320 - itemBox.width) / 2);
    var bgY = ~~((200 - itemBox.height) / 2);
    surface.blitRLE(itemBox, PAL_XY(bgX, bgY));

    var obj = scriptObjectAdapter.getObjectEntry(itemId);
    var bitmapId = obj && obj.item ? obj.item.bitmap : 0;
    observe?.('item-object',obj,()=>generatedOwnData(readGeneratedScripts().objects,String(itemId)),bitmapId);
    var bufImage = Files.BALL ? Files.BALL.readChunk(bitmapId) : null;
    observe?.('ball',Files.BALL,()=>Files.BALL);
    observe?.('ball-chunk',bufImage,()=>Files.BALL?generatedOwnData(generatedOwnData(Files.BALL,'_chunks'),String(bitmapId)):null);
    if (bufImage && bufImage.length > 0) {
      surface.blitRLE(bufImage, PAL_XY(bgX + 8, bgY + 7));
    }

    surface.updateScreen({ x: bgX, y: bgY, w: itemBox.width, h: itemBox.height });
  }

  private getStoreItemId(storeId: number, index: number,observe?: (store:any)=>void) {
    var store = gameDataAdapter.getStoreEntry(storeId);
    const items = store?.items as ArrayLike<number> | undefined;
    observe?.(store);
    if (items && (Array.isArray(items) || ArrayBuffer.isView(items)) && index >= 0 && index < items.length) {
      return items[index];
    }
    return 0;
  }

  private getObjectEnemyResistance(objectId: number) {
    var obj = scriptObjectAdapter.getObjectEntry(objectId);
    if (obj && obj.enemy) {
      return (obj.enemy as any).resistance;
    }
    return 0;
  }

  private getObjectPoisonEnemyScript(poisonId: number) {
    var obj = scriptObjectAdapter.getObjectEntry(poisonId);
    if (obj && obj.poison) {
      return (obj.poison as any).enemyScript;
    }
    return 0;
  }

  private getEnemyIdFromObject(objectId: number) {
    var obj = scriptObjectAdapter.getObjectEntry(objectId);
    if (obj && obj.enemy) {
      return (obj.enemy as any).enemyID;
    }
    return 0;
  }

  private getEnemyEntry(enemyId: number) {
    return gameDataAdapter.getEnemyEntry(enemyId);
  }

  private copyEnemyTemplate(enemyId: number) {
    return worldService.copyEnemyTemplate(enemyId);
  }

  /**
   * PAL_SceneFade: fade the palette in (step > 0) or out (step < 0) over 64 levels while the
   * game keeps updating and redrawing the scene, one level group every 100ms.
   */
  private async sceneFade(paletteId: number, night: boolean, step: number) {
    const entry = (Palette as any).get(paletteId);
    const palette = Array.isArray(entry)
      ? entry
      : (entry && Array.isArray(entry.day) ? (night ? (entry.night || entry.day) : entry.day) : null);
    if (!palette || !this.surface) {
      return;
    }
    if (step === 0) {
      step = 1;
    }
    worldService.setNeedToFadeIn(false);
    const showLevel = async (level: number) => {
      inputService.clear();
      await co(play.update(false));
      await co(scene.makeScene());
      this.surface?.updateScreen(null);
      const scaled = [];
      for (let j = 0; j < 256; j++) {
        const c = palette[j];
        scaled.push({ r: (c.r * level) >> 6, g: (c.g * level) >> 6, b: (c.b * level) >> 6 });
      }
      this.surface?.setPalette(scaled);
      await sleep(100);
    };
    if (step > 0) {
      for (let i = 0; i < 64; i += step) {
        await showLevel(i);
      }
    } else {
      for (let i = 63; i >= 0; i += step) {
        await showLevel(i);
      }
    }
  }

  #invokeRewardWorldUpdate(trigger:boolean,cursor:WorldUpdateCursor|undefined,hooks:any){return rewardNativeRunnerProtected(this)?invokeRewardWorldUpdate(trigger,cursor,hooks):play.update(trigger,cursor,hooks);}
  #guardRewardWorldHooks(frame:ScriptExecutionFrame,hooks:any){
    if(!rewardNativeRunnerProtected(this))return hooks;
    const runtime=this.executionRuntime;let entered=false;
    const guarded=Object.freeze({...hooks,rewardBegin:()=>{if(entered||this.executionRuntime!==runtime||!runtime.owns(frame,this)||!runtime.hasBattleOrigin(frame))throw new Error('Native battle task is opaque: World entry provenance required');rewardRunnerServiceSelection(this);entered=true;},invoke:(kind:'trigger'|'auto',entry:number,event:number,cursor:unknown,callSite?:unknown)=>{
      if(!entered||!consumeRewardWorldCallSite(guarded,callSite,kind,entry,event)||this.executionRuntime!==runtime||!runtime.owns(frame,this)||!runtime.hasBattleOrigin(frame))throw new Error('Native battle task is opaque: World call-site provenance required');
      rewardRunnerServiceSelection(this);return hooks.invoke(kind,entry,event,cursor);
    }});rewardWorldEntries.set(guarded,guarded.rewardBegin);return guarded;
  }
  #rewardWorldHooks(frame?:ScriptExecutionFrame){
    if(!frame||!rewardNativeRunnerProtected(this))return undefined;
    const runtime=this.executionRuntime;
    return this.#guardRewardWorldHooks(frame,{invoke:(kind:'trigger'|'auto',entry:number,event:number)=>{
      const selection=rewardRunnerServiceSelection(this);if(!selection)throw new Error('Native battle task is opaque: selected helper provenance unavailable');const token={};rewardWorldProofs.set(token,{runner:this,runtime,frame,kind,entry,event,stage:'dispatch',selection});try{return invokeProvenRewardWorldDispatch(token,kind,entry,event);}finally{rewardWorldProofs.delete(token);}
    }});
  }
  #rewardNativeInvocations=new WeakMap<object,{kind:'trigger'|'auto';entry:number;event:number;parent:ScriptExecutionFrame|undefined;authority:unknown;child:OwnedChildSession|undefined;worldCheck?:()=>void}>();
  #invokeRewardTrigger(entry:number,event:number,parent?:ScriptExecutionFrame,authority?:unknown,child?:OwnedChildSession,worldCheck?:()=>void):Promise<number> {if(!rewardNativeRunnerProtected(this))return child?this.runTriggerScript(entry,event,parent,authority,child):authority!==undefined?this.runTriggerScript(entry,event,parent,authority):parent?this.runTriggerScript(entry,event,parent):this.runTriggerScript(entry,event);const token={};this.#rewardNativeInvocations.set(token,{kind:'trigger',entry,event,parent,authority,child,worldCheck});return this.#invokeRewardProvider(token,()=>this.runTriggerScript(entry,event,parent,authority,child,token));}
  #invokeRewardAuto(entry:number,event:number,parent?:ScriptExecutionFrame,worldCheck?:()=>void):Promise<number> {if(!rewardNativeRunnerProtected(this))return parent?this.runAutoScript(entry,event,parent):this.runAutoScript(entry,event);const token={};this.#rewardNativeInvocations.set(token,{kind:'auto',entry,event,parent,authority:undefined,child:undefined,worldCheck});return this.#invokeRewardProvider(token,()=>this.runAutoScript(entry,event,parent,token));}
  #invokeRewardProvider(token:object,invoke:()=>Promise<number>):Promise<number> {
    const provider={};rewardNativeProviders.add(provider);
    try{return Promise.resolve(invoke()).finally(()=>rewardNativeProviders.delete(provider));}
    catch(error){rewardNativeProviders.delete(provider);throw error;}
    finally{this.#rewardNativeInvocations.delete(token);}
  }
  private requireRewardNativeOwner(token:object|undefined,kind:'trigger'|'auto',entry:number,event:number,parent?:ScriptExecutionFrame,authority?:unknown,child?:OwnedChildSession):void {
    const proof=token&&this.#rewardNativeInvocations.get(token);if(token)this.#rewardNativeInvocations.delete(token);
    const internal=!!proof&&proof.kind===kind&&proof.entry===entry&&proof.event===event&&proof.parent===parent&&proof.authority===authority&&proof.child===child;
    if((rewardNativeProviders.size||rewardServiceProviderProbeActive())&&!internal)throw new Error('Native battle task is opaque: provider receiver provenance required');
    if(rewardNativeRunnerProtected(this)){if(!internal)throw new Error('Native battle task is opaque');const selection=rewardRunnerServiceSelection(this);if(selection)assertRewardServiceProvider(selection);proof?.worldCheck?.();}
  }

  private inheritedBattleAuthority(parentFrame?: ScriptExecutionFrame, explicit?: unknown): unknown {
    if (parentFrame && this.executionRuntime.hasBattleOrigin(parentFrame) && !this.executionRuntime.owns(parentFrame,this)) {
      throw new Error('battle script parent Runner mismatch');
    }
    const authority = explicit !== undefined ? explicit : parentFrame ? this.battleAuthorities.get(parentFrame) : undefined;
    if (authority !== undefined) battleScriptExecution.validate(authority,this);
    return authority;
  }

  private registerBattleFrame(frame: ScriptExecutionFrame, authority: unknown, parentFrame?: ScriptExecutionFrame): void {
    try {
      if (authority !== undefined) {
        this.battleAuthorities.set(frame,authority);
        battleScriptExecution.enter(authority,this,frame);
      } else this.executionRuntime.inheritBattleOrigin(frame,parentFrame);
      const poison=battlePoisonRuntime.inheritFrame(parentFrame,frame,this);if(poison)this.childFrameLinks.set(frame,{releaseFrame:f=>battlePoisonRuntime.releaseFrame(poison,f)});
      const enemy=battleEnemyScriptRuntime.inheritFrame(parentFrame,frame,this);if(enemy)this.childFrameLinks.set(frame,{releaseFrame:f=>battleEnemyScriptRuntime.releaseFrame(enemy,f)});
      const pre=battlePreBattleScriptRuntime.inheritFrame(parentFrame,frame,this);if(pre)this.childFrameLinks.set(frame,{releaseFrame:f=>battlePreBattleScriptRuntime.releaseFrame(pre,f)});
      const end=battleEndScriptRuntime.inheritFrame(parentFrame,frame,this);if(end)this.childFrameLinks.set(frame,{releaseFrame:f=>battleEndScriptRuntime.releaseFrame(end,f)});
    } catch (error) {
      const poisonFrame=this.childFrameLinks.get(frame);if(poisonFrame){poisonFrame.releaseFrame(frame);this.childFrameLinks.delete(frame);}
      this.battleAuthorities.delete(frame);
      this.executionRuntime.finish(frame,false);
      throw error;
    }
  }

  /** Preserve the legacy two-argument delegate call when there is no owning frame. */
  private runChildTrigger(scriptEntry: number, eventObjectID: number, parentFrame?: ScriptExecutionFrame): Promise<number> {
    return parentFrame
      ? this.#invokeRewardTrigger(scriptEntry, eventObjectID, parentFrame)
      : this.#invokeRewardTrigger(scriptEntry, eventObjectID);
  }

  /** Owned poison uses the same instruction kernel; the detached cursor selects each next PC. */
  public runBattlePoisonScript(entry:number,event:number,authority:unknown,cursor:BattlePoisonCursor,live:NonNullable<ReturnType<typeof battlePoisonRuntime.capture>>,invokeTrigger?:(entry:number,event:number,parent:ScriptExecutionFrame)=>Promise<number>):Promise<number> {
    return this.#invokeRewardTrigger(entry,event,undefined,authority,{
      cursor,invokeTrigger,assert:()=>battlePoisonRuntime.assert(live),
      bindFrame:frame=>battlePoisonRuntime.bindFrame(live,frame),
      releaseFrame:frame=>battlePoisonRuntime.releaseFrame(live,frame),
      pauseAt:()=>battlePoisonRuntime.pauseAt(live),
    });
  }
  public runBattleEnemyScript(entry:number,event:number,authority:unknown,cursor:BattleEnemyScriptCursor,live:NonNullable<ReturnType<typeof battleEnemyScriptRuntime.capture>>,invokeTrigger?:(entry:number,event:number,parent:ScriptExecutionFrame)=>Promise<number>):Promise<number> {
    return this.#invokeRewardTrigger(entry,event,undefined,authority,{
      cursor,invokeTrigger,assert:()=>battleEnemyScriptRuntime.assert(live),
      bindFrame:frame=>battleEnemyScriptRuntime.bindFrame(live,frame),
      releaseFrame:frame=>battleEnemyScriptRuntime.releaseFrame(live,frame),
      pauseAt:()=>battleEnemyScriptRuntime.pauseAt(live),
    });
  }
  public runBattlePreBattleScript(entry:number,event:number,authority:unknown,cursor:BattlePreBattleScriptCursor,live:NonNullable<ReturnType<typeof battlePreBattleScriptRuntime.capture>>,invokeTrigger?:(entry:number,event:number,parent:ScriptExecutionFrame)=>Promise<number>):Promise<number> {
    return this.#invokeRewardTrigger(entry,event,undefined,authority,{
      cursor,invokeTrigger,assert:()=>battlePreBattleScriptRuntime.assert(live),
      bindFrame:frame=>battlePreBattleScriptRuntime.bindFrame(live,frame),
      releaseFrame:frame=>battlePreBattleScriptRuntime.releaseFrame(live,frame),
      pauseAt:()=>battlePreBattleScriptRuntime.pauseAt(live),
    });
  }
  public runBattleEndScript(entry:number,event:number,authority:unknown,cursor:BattleEndScriptCursor,live:NonNullable<ReturnType<typeof battleEndScriptRuntime.capture>>,invokeTrigger?:(entry:number,event:number,parent:ScriptExecutionFrame)=>Promise<number>):Promise<number> {
    return this.#invokeRewardTrigger(entry,event,undefined,authority,{
      cursor,invokeTrigger,assert:()=>battleEndScriptRuntime.assert(live),
      bindFrame:frame=>battleEndScriptRuntime.bindFrame(live,frame),
      releaseFrame:frame=>battleEndScriptRuntime.releaseFrame(live,frame),
      pauseAt:()=>battleEndScriptRuntime.pauseAt(live),
    });
  }
  private childCommit(frame:ScriptExecutionFrame,cursor:ChildCursor<unknown>):void {
    const f=selectChildFrame(cursor);
    commitChildFrame(cursor,{...f,currentPC:frame.currentPC,continuationPC:frame.continuationPC,eventId:frame.eventId,ended:frame.ended,loopSafetyCounter:frame.loopSafetyCounter});
    cursor.registers={scriptSuccess:this.scriptSuccess,curEquipPart:this.curEquipPart};
  }
  private async runChildFrameWait(frame:ScriptExecutionFrame,sc:any,owned:OwnedChildSession):Promise<void> {
    const c=owned.cursor,f=selectChildFrame(c);
    if(!f.frameWait){
      f.effect='opaque';this.executionRuntime.resume(frame,(frame.status='waiting',await resolveUiTask(ui.clearDialog(true))));
      owned.assert();f.effect='explicit';
      f.frameWait={frame:0,remainingFrames:sc.operand[0]||1,stage:'update',remainingMs:0};
    }
    const wait=f.frameWait;
    while(wait.remainingFrames>0){
      owned.assert();
      if(wait.stage==='update'){
        f.effect='opaque';if(sc.operand[2])scene.updatePartyGestures(false);
        this.executionRuntime.resume(frame,(frame.status='waiting',await co(this.#invokeRewardWorldUpdate(!!sc.operand[1],undefined,this.#guardRewardWorldHooks(frame,{invoke:(kind:'trigger'|'auto',entry:number,event:number)=>kind==='trigger'?(owned.invokeTrigger?owned.invokeTrigger(entry,event,frame):this.#invokeRewardTrigger(entry,event,frame)):this.#invokeRewardAuto(entry,event,frame)})))));
        this.executionRuntime.resume(frame,(frame.status='waiting',await co(scene.makeScene())));
        owned.assert();wait.stage='present';
      }
      if(wait.stage==='present'){
        this.surface?.updateScreen(null);owned.assert();
        wait.stage='sleep';const g=globalThis as any;wait.remainingMs=g.SceneFrameTime>0?g.SceneFrameTime/(g.GameSpeed||1):16;f.effect='explicit';
        const gate=owned.pauseAt();if(gate)this.executionRuntime.resume(frame,(frame.status='waiting',await gate));
      }
      if(wait.stage==='sleep'){
        owned.assert();this.executionRuntime.resume(frame,(frame.status='waiting',await sleep(wait.remainingMs)));
        wait.remainingMs=0;wait.remainingFrames--;wait.frame++;wait.stage='update';
      }
    }
    delete f.frameWait;frame.currentPC=f.currentPC+1;
  }
  public async runTriggerScript(
    scriptEntry: number,
    eventObjectID: number,
    parentFrame?: ScriptExecutionFrame,
    battleAuthority?: unknown,
    ownedChild?: OwnedChildSession,
    rewardInvocation?:object
  ): Promise<number> {
    this.requireRewardNativeOwner(rewardInvocation,'trigger',scriptEntry,eventObjectID,parentFrame,battleAuthority,ownedChild);
    this.requireManualOwner(parentFrame);
    battleAuthority = this.inheritedBattleAuthority(parentFrame,battleAuthority);
    const frame = this.executionRuntime.begin('trigger', scriptEntry, eventObjectID, parentFrame?.id ?? null,this);
    this.registerBattleFrame(frame,battleAuthority,parentFrame);
    if(ownedChild){
      try{ownedChild.bindFrame(frame);this.childFrameLinks.set(frame,ownedChild);}
      catch(error){
        // Initial binding precedes the instruction loop's cleanup region. Close
        // this newly registered frame even when its exact-child guard rejects.
        const poisonFrame=this.childFrameLinks.get(frame);if(poisonFrame){poisonFrame.releaseFrame(frame);this.childFrameLinks.delete(frame);}
        this.battleAuthorities.delete(frame);this.executionRuntime.finish(frame,false);throw error;
      }
    }
    if (this.manualExecution) this.manualOwnedFrames.add(frame.id);
    const restored = this.manualExecution ? this.restoreFrames.shift() : undefined;
    if(restored?.redraw)this.redraws.set(frame.id,restored.redraw);
    if(restored?.generatedDialog)this.generatedDialogs.set(frame.id,restored.generatedDialog);
    if(restored?.generatedNativeEnd)this.generatedNativeEnds.set(frame.id,restored.generatedNativeEnd);
    if(restored?.rng)this.rngCursors.set(frame.id,restored.rng);
    if(restored?.endingAnimation)this.endingAnimations.set(frame.id,restored.endingAnimation);
    if(restored?.endingScroll)this.endingScrolls.set(frame.id,restored.endingScroll);
    if(restored?.endingShow)this.endingShows.set(frame.id,restored.endingShow);
    if(restored?.screenFade)this.screenFades.set(frame.id,restored.screenFade);
    if(restored?.sceneFade)this.sceneFades.set(frame.id,restored.sceneFade);
    if(restored?.compose)this.compositions.set(frame.id,restored.compose);
    if(restored?.fadeSource)this.fadeSources.set(frame.id,restored.fadeSource);
    if(restored?.palette)this.palettes.set(frame.id,restored.palette);
    if(restored?.motion)this.motions.set(frame.id,restored.motion);
    if(restored?.npcMotion)this.npcMotions.set(frame.id,restored.npcMotion);
    if(restored?.shopCursor)this.shopCursors.set(frame.id,restored.shopCursor);
    if (restored?.poisonCursor) this.poisonCursors.set(frame.id,restored.poisonCursor);
    if (restored?.partyEquipmentCursor) this.partyEquipmentCursors.set(frame.id,restored.partyEquipmentCursor);
    if(restored?.parentReturn?.kind==='teleport-child')this.teleportReturns.set(frame.id,restored.parentReturn);
    if (restored) Object.assign(frame, {currentPC:restored.currentPC,continuationPC:restored.continuationPC,eventId:restored.eventId,loopSafetyCounter:restored.loopSafetyCounter});
    if (restored?.frameWait) this.frameWaits.set(frame.id,restored.frameWait);
    if(restored?.dialogAction)this.dialogActions.set(frame.id,restored.dialogAction);
    if(restored?.dialogAction?.phase==='terminal')frame.ended=true;
    let restoredParentStep = !!(restored?.generatedDialog || restored?.endingAnimation || restored?.endingScroll || restored?.endingShow || restored?.screenFade || restored?.rng || restored?.sceneFade || restored?.compose || restored?.fadeSource || restored?.palette || restored?.redraw || restored?.motion || restored?.npcMotion || restored?.parentReturn || restored?.shopCursor || restored?.frameWait || restored?.dialogAction || this.dialogContext?.cursor);
    if(!this.restoreFrames.length)this.rootEndingClock?.lane.begin();
    let completed = true;
    try {
      if (restored) eventObjectID=restored.eventId;
      if (typeof frame.currentPC === 'undefined') {
        log.warn(`[SCRIPT] runTriggerScript received undefined entry (event ${eventObjectID || 0})`);
        this.scriptSuccess = false;
        return frame.continuationPC = 0;
      }
      if (typeof frame.currentPC !== 'number' || Number.isNaN(frame.currentPC)) {
        log.warn(`[SCRIPT] runTriggerScript received invalid entry ${frame.currentPC} (event ${eventObjectID || 0})`);
        this.scriptSuccess = false;
        return frame.continuationPC = 0;
      }
      if (frame.currentPC === 0) {
        // Like PAL_RunTriggerScript: success is set before the loop, which never runs for entry 0.
        // Many magics/items have no OnUse script (0) and must still count as succeeded.
        this.scriptSuccess = true;
        if(this.generatedNativeEnds.has(frame.id)){this.generatedNativeEnds.delete(frame.id);const index=this.executionRuntime.snapshot().activeFrames.findIndex(f=>f.id===frame.id);generatedDialogLeases(this.surface!).finishNativeFrame(this.manualIdentity!.id,index);}
      this.curEquipPart = -1;
        return frame.continuationPC = 0;
      }
      if (frame.currentPC < 0 || !scriptObjectAdapter.getScriptEntry(frame.currentPC)) {
        log.trace(`[SCRIPT] runTriggerScript skipped missing entry ${frame.currentPC} (event ${eventObjectID || 0})`);
        this.scriptSuccess = false;
        return frame.continuationPC = 0;
      }

      const lastEventObjectID = worldService.getLastEventObjectId();
      let sc;
      let evtObj: any = null;
      let i;

      if (!restored && eventObjectID == 0xFFFF) {
        eventObjectID = lastEventObjectID;
      }

      frame.eventId = eventObjectID;
      if (!restored) worldService.setLastEventObjectId(eventObjectID);

      if (eventObjectID !== 0) {
        evtObj = this.getEventObjectById(eventObjectID);
      }
      if (!restored) this.scriptSuccess = true;
      if (restored && !restored.generatedDialog && !restored.endingAnimation && !restored.endingScroll && !restored.endingShow && !restored.screenFade && !restored.rng && !restored.sceneFade && !restored.compose && !restored.fadeSource && !restored.palette && !restored.redraw && !restored.motion && !restored.npcMotion && !restored.parentReturn && !restored.frameWait && !restored.dialogAction && !restored.shopCursor && !this.restoreDialogLeaf) {
        if(this.inputResponse) {
          frame.currentPC=inputNextPC(this.inputResponse.wait,this.inputResponse.value);
          this.inputResponse=null;
        } else {frame.currentPC++;this.syncViewportToParty();}
      }

      // Set the default dialog speed.
      if (!restored) {ui.setDialogDelayTime(3);if(this.manualExecution && this.dialogContext)this.dialogContext.speed=3;}

      if(ownedChild)this.childCommit(frame,ownedChild.cursor);
      while (frame.currentPC !== 0 && !frame.ended) {
        if(ownedChild){ownedChild.assert();const selected=selectChildFrame(ownedChild.cursor);Object.assign(frame,{currentPC:selected.currentPC,continuationPC:selected.continuationPC,eventId:selected.eventId,ended:selected.ended,loopSafetyCounter:selected.loopSafetyCounter});}
        if (!restoredParentStep && ++frame.loopSafetyCounter > 1000) {
          if (this.manualExecution) throw new ManualExecutionSignal({status:"unsupported",reason:"Manual loop safety yield is unsupported"});
          if(ownedChild)selectChildFrame(ownedChild.cursor).effect='opaque';
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await new Promise(resolve => setTimeout(resolve, 0))));
          frame.loopSafetyCounter = 0;
        }
        restoredParentStep=false;
        sc = this.getScriptEntrySafe(frame.currentPC, eventObjectID, 'runTriggerScript');
        if (!sc) {
          frame.currentPC = 0;
          break;
        }
        if(ownedChild){this.childCommit(frame,ownedChild.cursor);selectChildFrame(ownedChild.cursor).effect=sc.operation===9?'explicit':'opaque';}
        this.checkManualOpcode(sc,'trigger');
        debugBgScriptStep('trigger', frame.currentPC, eventObjectID, sc.operation, sc.operand);

        if (typeof (globalThis as any).PAL_SCRIPT_TRACE === 'boolean' && (globalThis as any).PAL_SCRIPT_TRACE) {
          log.trace(`[SCRIPT] runTriggerScript ${frame.currentPC}: (${sc.operation}(0x${sc.operation.toString(16)}) - ${sc.operand[0]}, ${sc.operand[1]}, ${sc.operand[2]}, ${sc.operand[3]})`);
        }

        if(this.manualExecution && this.dialogContext && ![0,1,2,3,4,5,6,7,8,10,0xffff,0x93,0x4e,0x50,0x51,0x4f,0x80,0x8c,0x96,0xa4,0x34].includes(sc.operation))this.clearBeforeOpcode(frame,sc);
        if(this.manualExecution && sc.operation===10 && this.dialogContext)clearOwnedDialog(this.dialogContext);
        switch (sc.operation) {
        case 0x0000:
          frame.ended = true;
          break;
        case 0x0001:
          frame.ended = true;
          frame.continuationPC = frame.currentPC + 1;
          break;
        case 0x0002:
          // Without an event object there is no idle counter: behave as "stop, resume at operand[0]".
          if (!evtObj) {
            frame.ended = true;
            frame.continuationPC = sc.operand[0];
            break;
          }
          // Counts only when there is a limit (operand[1] != 0), as in SDLPAL's short-circuit.
          if (sc.operand[1] === 0 || ++evtObj.scriptIdleFrame < sc.operand[1]) {
            frame.ended = true;
            frame.continuationPC = sc.operand[0];
          } else {
            evtObj.scriptIdleFrame = 0;
            frame.currentPC++;
          }
          this.syncViewportToParty({ preserveFrames: sc.operand[0] !== 0xFFFF });
          break;
        case 0x0003:
          try {
            if (sc.operand[1] === 0 || ++(evtObj.scriptIdleFrame) < sc.operand[1]) {
              frame.currentPC = sc.operand[0];
            } else {
              evtObj.scriptIdleFrame = 0;
              frame.currentPC++;
            }
          } catch (ex) {
            frame.currentPC++;
          }
          this.syncViewportToParty({ preserveFrames: sc.operand[0] !== 0xFFFF });
          break;
        case 0x0004:
          if(ownedChild){
            pushChildFrame(ownedChild.cursor,sc.operand[0],sc.operand[1]||eventObjectID);
            this.executionRuntime.resume(frame,(frame.status='waiting',await this.#invokeRewardTrigger(sc.operand[0],sc.operand[1]||eventObjectID,frame,battleAuthority,ownedChild)));
            frame.currentPC=selectChildFrame(ownedChild.cursor).currentPC;
          }else {
            this.executionRuntime.resume(frame, (frame.status = 'waiting', await this.runChildTrigger(sc.operand[0], ((sc.operand[1] == 0) ? eventObjectID : sc.operand[1]), frame)));
            frame.currentPC++;
          }
          break;
        case 0x0005:
          if(this.manualExecution){await this.runManualRedraw(frame,sc);break;}
          log.debug('[SCRIPT] Redraw screen');
          const redrawOverlay = clearFbpOverlay('redraw-screen');
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          if (ui.dialogIsPlayingRNG()) {
            this.surface?.restoreScreen();
          } else if (this.BATTLE() && worldService.isInBattle()) {
            battleService.makeSceneToScreen();
            this.surface?.updateScreen(null);
          } else {
            if (sc.operand[2]){
               scene.updatePartyGestures(false);
            }
            this.executionRuntime.resume(frame, (frame.status = 'waiting', await co(scene.makeScene())));
            this.surface?.updateScreen(null);
            this.executionRuntime.resume(frame, (frame.status = 'waiting', await sleep((sc.operand[1] === 0) ? 60 : (sc.operand[1] * 60))));
          }
          markBgDirty('redraw-screen');
          restoreOverlayMode(redrawOverlay);
          frame.currentPC++;
          break;
        case 0x0006:
          log.debug('[SCRIPT] Jump to the specified address by the specified rate');
          if (randomLong(1, 100) >= sc.operand[0]) {
            frame.currentPC = sc.operand[1];
            break;
          } else {
            frame.currentPC++;
          }
          break;
        case 0x0007:
          log.debug('[SCRIPT] Start battle');
          var ret = this.executionRuntime.resume(frame, (frame.status = 'waiting', await (battleScriptExecution.owned ? battleService.startBattle(sc.operand[0], { isBoss: !sc.operand[2] }, { runner: this, frame }) : battleService.startBattle(sc.operand[0], { isBoss: !sc.operand[2] }))));

          if (ret == BattleResult.Lost && sc.operand[1] != 0) {
            frame.currentPC = sc.operand[1];
          } else if (ret == BattleResult.Fleed && sc.operand[2] != 0) {
            frame.currentPC = sc.operand[2];
          } else {
            frame.currentPC++;
          }
          worldService.setAutoBattle(false);
          break;
        case 0x0008:
          log.debug('[SCRIPT] Replace the entry with the next instruction');
          frame.currentPC++;
          frame.continuationPC = frame.currentPC;
          break;
        case 0x0009:
          if(ownedChild){await this.runChildFrameWait(frame,sc,ownedChild);break;}
          if (this.manualExecution) {await this.runManualFrameWait(frame,sc);break;}
          if (shouldTraceScript()) {
            log.debug('[SCRIPT] wait for the specified number of frames');
          }
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          var len = sc.operand[0] ? sc.operand[0] : 1;
          for (i = 0; i < len; i++){
            if (sc.operand[2]) {
              scene.updatePartyGestures(false);
            }
            this.executionRuntime.resume(frame, (frame.status = 'waiting', await co(this.#invokeRewardWorldUpdate(sc.operand[1] ? true : false,undefined,this.#rewardWorldHooks(frame)))));
            this.executionRuntime.resume(frame, (frame.status = 'waiting', await co(scene.makeScene())));
            this.surface?.updateScreen(null);
            this.executionRuntime.resume(frame, (frame.status = 'waiting', await sleepSceneFrame()));
          }
          frame.currentPC++;
          break;
        case 0x000A:
          if(this.manualExecution)this.captureWait(createInputWait(frame.currentPC,sc));
          log.debug('[SCRIPT] Goto the specified address if player selected no');
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(ui.clearDialog(false))));
          dialogService.publishChoice({
            type: 'confirm',
            scriptEntry: frame.currentPC,
            eventObjectId: eventObjectID,
            options: [
              { label: 'No', value: false },
              { label: 'Yes', value: true }
            ]
          });
          var ret = this.executionRuntime.resume(frame, (frame.status = 'waiting', await co(uigame.confirmMenu())));
          dialogService.resolveChoice(ret === true, ret ? 1 : 0, ret ? 'Yes' : 'No');
          frame.currentPC=inputNextPC(createInputWait(frame.currentPC,sc),!!ret);
          break;
        case 0x003B:
          if(this.manualExecution){setupDialog(this.ownedContext(),sc.operation,sc.operand);frame.currentPC++;break;}
          consumeBgDirty('dialog-center');
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          ui.startDialog(DialogPosition.Center, sc.operand[0], 0, sc.operand[2] ? true : false);
          frame.currentPC++;
          break;
        case 0x003C:
          if(this.manualExecution){setupDialog(this.ownedContext(),sc.operation,sc.operand);frame.currentPC++;break;}
          consumeBgDirty('dialog-upper');
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          ui.startDialog(DialogPosition.Upper, sc.operand[1], sc.operand[0], sc.operand[2] ? true : false);
          frame.currentPC++;
          break;
        case 0x003D:
          if(this.manualExecution){setupDialog(this.ownedContext(),sc.operation,sc.operand);frame.currentPC++;break;}
          consumeBgDirty('dialog-lower');
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          ui.startDialog(DialogPosition.Lower, sc.operand[1], sc.operand[0], sc.operand[2] ? true : false);
          frame.currentPC++;
          break;
        case 0x003E:
          if(this.manualExecution){setupDialog(this.ownedContext(),sc.operation,sc.operand);frame.currentPC++;break;}
          consumeBgDirty('dialog-center-window');
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          ui.startDialog(DialogPosition.CenterWindow, sc.operand[0], 0, false);
          frame.currentPC++;
          break;
        case 0x008E:
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          this.surface?.restoreScreen();
          this.surface?.updateScreen(null);
          frame.currentPC++;
          break;
        case 0xFFFF:
          if(this.manualExecution){this.showOwnedText(frame,sc);break;}
          consumeBgDirty('dialog-line');
          // Try storygraph first if available, fallback to ui.getMsg
          var msgId = sc.operand[0];
          var msg: string;
          if (storyGraphService.isStoryGraphMode() && storyGraphService.getFullGameGraph()) {
            const sceneId = getSceneIdSnapshot();
            const graphMsg = storyGraphService.getMessageText(sceneId, msgId);
            msg = graphMsg !== null ? graphMsg : ui.getMsg(msgId);
          } else {
            msg = ui.getMsg(msgId);
          }
          dialogService.setPendingLineMetadata({
            msgId: msgId,
            scriptEntry: frame.currentPC,
            eventObjectId: eventObjectID
          });
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(ui.showDialogText(msg))));
          frame.currentPC++;
          break;
        default:
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? undefined : ui.clearDialog(true))));
          frame.currentPC = this.executionRuntime.resume(frame, (frame.status = 'waiting', await this.interpretInstruction(frame.currentPC, eventObjectID, frame)));
          this.syncViewportToParty();
          break;
      }
      if(ownedChild){ownedChild.assert();this.childCommit(frame,ownedChild.cursor);selectChildFrame(ownedChild.cursor).effect='explicit';}
    }

      if(this.manualExecution && this.dialogContext) {
        const saved=this.dialogActions.get(frame.id);
        if(saved?.phase==='terminal')this.dialogActions.delete(frame.id);
        else if(this.dialogContext.line>0) {
          const terminal=scriptObjectAdapter.getScriptEntry(frame.currentPC);
          if(!terminal)throw new ManualExecutionSignal({status:'unsupported',reason:'Dialog EOF closure without terminal instruction is unsupported'});
          this.dialogActions.set(frame.id,{phase:'terminal',opcodePC:frame.currentPC,operation:terminal.operation,operands:Array.from(terminal.operand),ended:true,continuationPC:frame.continuationPC});
          this.captureWait(dialogAdvance(frame.currentPC,terminal.operand,'terminal'));
        }
        clearOwnedDialog(this.dialogContext,true);
      }
      if(ownedChild)selectChildFrame(ownedChild.cursor).effect='opaque';
      this.executionRuntime.resume(frame, (frame.status = 'waiting', await resolveUiTask(this.manualExecution ? (this.generatedNativeEnds.has(frame.id)?ui.endDialog():undefined) : ui.endDialog())));
      // The actual Native closure has succeeded. Retire only this finished
      // frame before a sibling can reuse its depth; retain root source reads.
      if(this.generatedNativeEnds.has(frame.id)){
        this.generatedNativeEnds.delete(frame.id);
        const index=this.executionRuntime.snapshot().activeFrames.findIndex(f=>f.id===frame.id);
        generatedDialogLeases(this.surface!).finishNativeFrame(this.manualIdentity!.id,index);
      }
      this.curEquipPart = -1;

      if (!Number.isFinite(frame.continuationPC) || frame.continuationPC < 0) {
        frame.continuationPC = 0;
      }
      this.syncViewportToParty();
      return frame.continuationPC;
    } catch (error) {
      completed = false;
      throw error;
    } finally {
      try {if(ownedChild&&completed){this.childCommit(frame,ownedChild.cursor);returnChildFrame(ownedChild.cursor,Number.isFinite(frame.continuationPC)&&frame.continuationPC>=0?frame.continuationPC:0);}} finally {
      if(ownedChild)ownedChild.releaseFrame(frame);
      this.autoTailReturns.delete(frame.id);this.teleportReturns.delete(frame.id);
      this.manualOwnedFrames.delete(frame.id);
      this.frameWaits.delete(frame.id);this.motions.delete(frame.id);
      this.npcMotions.delete(frame.id);
      this.poisonCursors.delete(frame.id);
      this.partyEquipmentCursors.delete(frame.id);
      const poisonFrame=this.childFrameLinks.get(frame);if(poisonFrame){poisonFrame.releaseFrame(frame);this.childFrameLinks.delete(frame);}
      this.battleAuthorities.delete(frame);
      this.executionRuntime.finish(frame, completed);
      }
    }
  }

  public async runAutoScript(scriptEntry: number, eventObjectID: number, parentFrame?: ScriptExecutionFrame,rewardInvocation?:object): Promise<number> {
    this.requireRewardNativeOwner(rewardInvocation,'auto',scriptEntry,eventObjectID,parentFrame);
    this.requireManualOwner(parentFrame);
    const battleAuthority = this.inheritedBattleAuthority(parentFrame);
    const frame = this.executionRuntime.begin('auto', scriptEntry, eventObjectID, parentFrame?.id ?? null,this);
    this.registerBattleFrame(frame,battleAuthority,parentFrame);
    if (this.manualExecution) this.manualOwnedFrames.add(frame.id);
    const restored = this.manualExecution ? this.restoreFrames.shift() : undefined;
    if(restored?.generatedDialog)this.generatedDialogs.set(frame.id,restored.generatedDialog);
    if(restored?.generatedNativeEnd)this.generatedNativeEnds.set(frame.id,restored.generatedNativeEnd);
    if(restored?.rng)this.rngCursors.set(frame.id,restored.rng);
    if(restored?.endingAnimation)this.endingAnimations.set(frame.id,restored.endingAnimation);
    if(restored?.endingScroll)this.endingScrolls.set(frame.id,restored.endingScroll);
    if(restored?.endingShow)this.endingShows.set(frame.id,restored.endingShow);
    if(restored?.screenFade)this.screenFades.set(frame.id,restored.screenFade);
    if(restored?.sceneFade)this.sceneFades.set(frame.id,restored.sceneFade);
    if(restored?.compose)this.compositions.set(frame.id,restored.compose);
    if(restored?.fadeSource)this.fadeSources.set(frame.id,restored.fadeSource);
    if(restored?.palette)this.palettes.set(frame.id,restored.palette);
    if(restored?.motion)this.motions.set(frame.id,restored.motion);
    if(restored?.npcMotion)this.npcMotions.set(frame.id,restored.npcMotion);
    if(restored?.shopCursor)this.shopCursors.set(frame.id,restored.shopCursor);
    if (restored?.poisonCursor) this.poisonCursors.set(frame.id,restored.poisonCursor);
    if (restored?.partyEquipmentCursor) this.partyEquipmentCursors.set(frame.id,restored.partyEquipmentCursor);
    if(restored?.parentReturn?.kind==='teleport-child')this.teleportReturns.set(frame.id,restored.parentReturn);
    if (restored) Object.assign(frame, {currentPC:restored.currentPC,continuationPC:restored.continuationPC,eventId:restored.eventId,loopSafetyCounter:restored.loopSafetyCounter});
    if(!this.restoreFrames.length)this.rootEndingClock?.lane.begin();
    let completed = true;
    try {
      if (restored) eventObjectID=restored.eventId;
      if (restored?.parentReturn?.kind==='auto-tail') {
        this.autoTailReturns.set(frame.id,restored.parentReturn);
        return this.executionRuntime.resume(frame,(frame.status='waiting',frame.continuationPC=await this.#invokeRewardAuto(restored.parentReturn.childEntry,eventObjectID,frame)));
      }
      if (restored && !restored.generatedDialog && !restored.endingAnimation && !restored.endingScroll && !restored.endingShow && !restored.screenFade && !restored.rng && !restored.sceneFade && !restored.compose && !restored.fadeSource && !restored.palette && !restored.motion && !restored.npcMotion && !restored.parentReturn && !restored.shopCursor) {
        if(this.inputResponse) {frame.currentPC=inputNextPC(this.inputResponse.wait,this.inputResponse.value);this.inputResponse=null;return frame.continuationPC=frame.currentPC;}
        return frame.continuationPC = frame.currentPC + 1;
      }
      var sc = this.getScriptEntrySafe(frame.currentPC, eventObjectID, 'runAutoScript');
      if (!sc) {
        return frame.continuationPC = frame.currentPC;
      }
      this.checkManualOpcode(sc,'auto');
      var evtObj = this.getEventObjectById(eventObjectID);

      // traceScript(scriptEntry, sc, eventObjectID);

      debugBgScriptStep('auto', frame.currentPC, eventObjectID, sc.operation, sc.operand);
      if (shouldTraceScript()) {
        log.trace(`[SCRIPT] runAutoScript ${frame.currentPC}: (${sc.operation}(0x${sc.operation.toString(16)}) - ${sc.operand[0]}, ${sc.operand[1]}, ${sc.operand[2]}, ${sc.operand[3]})`);
      }

      switch (sc.operation) {
        case 0x0000:
          break;
        case 0x0001:
          frame.currentPC++;
          break;
        case 0x0002:
          if (!evtObj || sc.operand[1] === 0 || (++evtObj.scriptIdleFrameCountAuto) < sc.operand[1]) {
            frame.currentPC = sc.operand[0];
          } else {
            evtObj.scriptIdleFrameCountAuto = 0;
            frame.currentPC++;
          }
          break;
        case 0x0003:
          // No executing event (id 0 / out of range): SDLPAL indexes lprgEventObject[id - 1] here (UB); jump
          // unconditionally like 0x0002 above instead of throwing.
          if (!evtObj || sc.operand[1] === 0 || (++evtObj.scriptIdleFrameCountAuto) < sc.operand[1]) {
            const target=sc.operand[0];
            if (this.manualExecution) this.autoTailReturns.set(frame.id,{kind:'auto-tail',opcodePC:frame.currentPC,nextPC:frame.currentPC+1,childEntry:target,childEventId:eventObjectID});
            else frame.currentPC=target;
            return this.executionRuntime.resume(frame, (frame.status = 'waiting', frame.continuationPC = await this.#invokeRewardAuto(target, eventObjectID, frame)));
          } else {
            evtObj.scriptIdleFrameCountAuto = 0;
            frame.currentPC++;
          }
          break;
        case 0x0004:
          this.executionRuntime.resume(frame, (frame.status = 'waiting', await this.runChildTrigger(sc.operand[0], sc.operand[1] ? sc.operand[1] : eventObjectID, frame)));
          frame.currentPC++;
          break;
        case 0x0006:
          if (randomLong(1, 100) >= sc.operand[0]) {
            // A hit without a target stays on this instruction and rolls again next frame.
            if (sc.operand[1] != 0) {
              const target=sc.operand[1];
              if (this.manualExecution) this.autoTailReturns.set(frame.id,{kind:'auto-tail',opcodePC:frame.currentPC,nextPC:frame.currentPC+1,childEntry:target,childEventId:eventObjectID});
              else frame.currentPC=target;
              return this.executionRuntime.resume(frame, (frame.status = 'waiting', frame.continuationPC = await this.#invokeRewardAuto(target, eventObjectID, frame)));
            }
          } else {
            frame.currentPC++;
          }
          break;
        case 0x0009:
          // No executing event: nothing to count the wait on, so do not wait (SDLPAL would be UB here).
          if (!evtObj) { frame.currentPC++; break; }
          if ((++evtObj.scriptIdleFrameCountAuto) >= sc.operand[0]) {
             evtObj.scriptIdleFrameCountAuto = 0;
             frame.currentPC++;
          }
          break;
        case 0xFFFF:
          frame.currentPC++;
          break;
        case 0x00A7:
          frame.currentPC++;
          break;
        default:
          frame.currentPC = this.executionRuntime.resume(frame, (frame.status = 'waiting', await this.interpretInstruction(frame.currentPC, eventObjectID, frame)));
          break;
      }

      return frame.continuationPC = frame.currentPC;
    } catch (error) {
      completed = false;
      throw error;
    } finally {
      this.autoTailReturns.delete(frame.id);this.teleportReturns.delete(frame.id);
      this.manualOwnedFrames.delete(frame.id);
      this.frameWaits.delete(frame.id);this.motions.delete(frame.id);
      this.npcMotions.delete(frame.id);
      this.poisonCursors.delete(frame.id);
      this.partyEquipmentCursors.delete(frame.id);
      const poisonFrame=this.childFrameLinks.get(frame);if(poisonFrame){poisonFrame.releaseFrame(frame);this.childFrameLinks.delete(frame);}
      this.battleAuthorities.delete(frame);
      this.executionRuntime.finish(frame, completed);
    }
  }

  public async interpretInstruction(scriptEntry: number, eventObjectID: number, parentFrame?: ScriptExecutionFrame): Promise<number> {
    const frame = parentFrame;
    var sc = this.getScriptEntrySafe(scriptEntry, eventObjectID, 'interpretInstruction');
    if (!sc) {
      return scriptEntry + 1;
    }
    var baseEventId = (typeof eventObjectID === 'number' && eventObjectID > 0) ? eventObjectID : null;
    var evtObj = baseEventId ? this.getEventObjectById(baseEventId) : null;
    var targetInfo = this.resolveEventTarget(sc.operand[0], baseEventId);
    var curEventObjectID = targetInfo.id != null ? targetInfo.id : (baseEventId || 0);
    var current = targetInfo.object || (targetInfo.id === baseEventId ? evtObj : null);
    if(this.manualExecution && frame && isNpcMotionOpcode(sc.operation))return this.runManualNpcMotion(frame,sc,eventObjectID,curEventObjectID,current);
    if(this.manualExecution && frame && [0x4e,0x50,0x51].includes(sc.operation)){await this.runManualFadeOpcode(frame,sc);return sc.operation===0x4e?0:scriptEntry+1;}
    if(this.manualExecution && frame && sc.operation===0x37){await this.runManualRng(frame,sc);return scriptEntry+1;}
    if(this.manualExecution && frame && sc.operation===0x34)return this.runManualGeneratedDialog(frame,sc);
    if(this.manualExecution && frame && sc.operation===0x96){await this.runManualEndingAnimation(frame,sc);return scriptEntry+1;}
    if(this.manualExecution && frame && sc.operation===0xa4){await this.runManualEndingScroll(frame,sc);return scriptEntry+1;}
    if(this.manualExecution && frame && [0x76,0xa5].includes(sc.operation)){await this.runManualEndingShow(frame,sc);return scriptEntry+1;}
    if(this.manualExecution && frame && [0x73,0x9b].includes(sc.operation)){await this.runManualScreenFade(frame,sc);return scriptEntry+1;}
    if(this.manualExecution && frame && sc.operation===0x93){await this.runManualSceneFade(frame,sc);return scriptEntry+1;}
    if(this.manualExecution && frame && paletteFamily(sc.operation)){await this.runManualPalette(frame,sc);return scriptEntry+1;}
    var playerRole: any, i: any, j: any, x: any, y: any, w: any, ret: any;
    var party = this.getPartyState();
    var partyIndex = sc.operand[0];
    var partyMember = null;
    if (party.length) {
      if (partyIndex >= 0 && partyIndex < party.length) {
        partyMember = party[partyIndex];
      } else if (partyIndex < Const.MAX_PLAYABLE_PLAYER_ROLES) {
        var clamped = Math.min(Math.max(partyIndex, 0), party.length - 1);
        partyMember = party[clamped];
      }
      if (!partyMember) {
        partyMember = party[0];
      }
    }
    playerRole = partyMember && typeof partyMember.playerRole !== 'undefined'
      ? partyMember.playerRole
      : 0;
    
    if (shouldTraceScript()) {
      log.trace(`[SCRIPT] interpretInstruction ${scriptEntry}: (${sc.operation}(0x${sc.operation.toString(16)}) - ${sc.operand[0]}, ${sc.operand[1]}, ${sc.operand[2]}, ${sc.operand[3]})`);
    }

    switch (sc.operation) {
      case 0x000B:
      case 0x000C:
      case 0x000D:
      case 0x000E:
        if (baseEventId) {
          worldService.mutateEventObjectById(baseEventId, function(target: any) {
            if (!target) return target;
            target.direction = sc.operation - 0x000B;
            return target;
          });
        }
        this.NPCWalkOneStep(eventObjectID, 2);
        break;
      case 0x000F:
        if (baseEventId) {
          worldService.mutateEventObjectById(baseEventId, function(target: any) {
            if (!target) return target;
            if (sc.operand[0] !== 0xFFFF) target.direction = sc.operand[0];
            if (sc.operand[1] !== 0xFFFF) target.currentFrameNum = sc.operand[1];
            return target;
          });
        }
        break;
      case 0x0010:
        ret = this.NPCWalkTo(eventObjectID, sc.operand[0], sc.operand[1], sc.operand[2], 3);
        if (!ret) {
          scriptEntry--;
          // Render scene to show NPC movement animation
          scene.updatePartyGestures(false, { preserveFrames: true });
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
          this.surface?.updateScreen(null);
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await sleepByFrame(1)));
        }
        break;
      case 0x0011:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Walk straight to the specified position, at a lower speed');
        }
        if ((eventObjectID & 1) ^ (worldService.getFrameCount() & 1)) {
          ret = this.NPCWalkTo(eventObjectID, sc.operand[0], sc.operand[1], sc.operand[2], 2);
          if (!ret) {
            scriptEntry--;
            // Render scene to show NPC movement animation
            scene.updatePartyGestures(false, { preserveFrames: true });
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
            this.surface?.updateScreen(null);
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await sleepByFrame(1)));
          }
        } else {
          scriptEntry--;
        }
        break;
      case 0x0012:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Set the position of the event object, relative to the party');
        }
        if (curEventObjectID > 0) {
          worldService.mutateEventObjectById(curEventObjectID, (target: any) => {
            if (!target) return target;
            target.x = WORD(sc.operand[1] + this.getViewportX() + this.getPartyOffsetX());
            target.y = WORD(sc.operand[2] + this.getViewportY() + this.getPartyOffsetY());
            return target;
          });
        }
        break;
      case 0x0013:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Set the position of the event object');
        }
        if (curEventObjectID > 0) {
          worldService.mutateEventObjectById(curEventObjectID, (target: any) => {
            if (!target) return target;
            target.x = sc.operand[1];
            target.y = sc.operand[2];
            return target;
          });
        }
        break;
      case 0x0014:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Set the gesture of the event object');
        }
        if (baseEventId) {
          worldService.mutateEventObjectById(baseEventId, (target: any) => {
            if (!target) return target;
            target.currentFrameNum = sc.operand[0];
            target.direction = Direction.South;
            return target;
          });
        }
        break;
      case 0x0015:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Set the direction and gesture for a party member');
        }
        var partyDirection = Number(sc.operand[0]) || 0;
        worldService.setPartyDirection(partyDirection);
        worldService.mutatePartyMember(sc.operand[2], (member: any) => {
          if (!member) return member;
          member.frame = partyDirection * 3 + sc.operand[1];
          return member;
        });
        break;
      case 0x0016:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Set the direction and gesture for an event object');
        }
        if (sc.operand[0] !== 0 && curEventObjectID > 0) {
          worldService.mutateEventObjectById(curEventObjectID, (target: any) => {
            if (!target) return target;
            target.direction = sc.operand[1];
            target.currentFrameNum = sc.operand[2];
            return target;
          });
        }
        break;
      case 0x0017:
        log.debug('[SCRIPT] set the player\'s extra attribute');
        i = sc.operand[0] - 0xB;
        worldService.setEquipmentEffectWord(i, sc.operand[1], eventObjectID, SHORT(sc.operand[2]));
        break;
      case 0x0018:
        log.debug('[SCRIPT] Equip the selected item');
        i = sc.operand[0] - 0x0B;
        this.curEquipPart = i;
        // The eventObjectID parameter here should indicate the player role
        this.removeEquipmentEffect(eventObjectID, i);
        var currentEquipment = getPlayerEquipmentFromAdapter(i, eventObjectID);
        if (currentEquipment !== sc.operand[1]) {
          w = currentEquipment;
          worldService.setPlayerEquipment(i, eventObjectID, sc.operand[1]);
          // As in SDLPAL: when the new item is the last one in the inventory and the old item
          // is not in the inventory, swap it into the same slot instead of removing the new
          // item and appending the old one at the end of the item menu.
          var newItemSlot = this.findInventorySlot(sc.operand[1]);
          var newItemEntry: any = newItemSlot >= 0 ? inventorySignals().items.value[newItemSlot] : null;
          if (newItemEntry && newItemEntry.amount === 1 && w !== 0 && this.findInventorySlot(w) < 0) {
            worldService.mutateInventory((inventory: any) => {
              if (inventory[newItemSlot]) {
                inventory[newItemSlot].item = w;
              }
              return inventory;
            });
          } else {
            this.addItemToInventory(sc.operand[1], -1);
            if (w !== 0) {
              this.addItemToInventory(w, 1);
            }
          }
          worldService.setLastUnequippedItem(w);
        }
        break;
      case 0x0019:
        log.debug('[SCRIPT] Increase/decrease the player\'s attribute');
        playerRole = (sc.operand[2] === 0 ? eventObjectID : (sc.operand[2] - 1));
        worldService.adjustPlayerRoleWord(sc.operand[0], playerRole, SHORT(sc.operand[1]));
        break;
      case 0x001A:
        log.debug('[SCRIPT] Set player\'s stat');
        var playerRole;
        if (sc.operand[2] === 0) {
          playerRole = eventObjectID;
        } else {
          playerRole = sc.operand[2] - 1;
        }
        if (this.curEquipPart !== -1) {
          worldService.setEquipmentEffectWord(this.curEquipPart, sc.operand[0], playerRole, SHORT(sc.operand[1]));
        } else {
          worldService.setPlayerRoleWord(sc.operand[0], playerRole, SHORT(sc.operand[1]));
        }
        break;
      case 0x001B:
        log.debug('[SCRIPT] Increase/decrease player\'s HP');
        if (sc.operand[0]) {
          this.scriptSuccess = false;
          this.forEachPartyMember((member: any) => {
            if (this.increaseHPMP(member.playerRole, SHORT(sc.operand[1]), 0)) {
              this.scriptSuccess = true;
            }
          });
        } else {
          if (!this.increaseHPMP(eventObjectID, SHORT(sc.operand[1]), 0)) {
            this.scriptSuccess = false;
          }
        }
        break;
      case 0x001C:
        log.debug('[SCRIPT] Increase/decrease player\'s MP');
        if (sc.operand[0]) {
          this.forEachPartyMember((member: any) => {
            this.increaseHPMP(member.playerRole, 0, SHORT(sc.operand[1]));
          });
        } else {
          if (!this.increaseHPMP(eventObjectID, 0, SHORT(sc.operand[1]))) {
            this.scriptSuccess = false;
          }
        }
        break;
      case 0x001D:
        log.debug('[SCRIPT] Increase/decrease player\'s HP and MP');
        if (sc.operand[0]) {
          this.forEachPartyMember((member: any) => {
            this.increaseHPMP(member.playerRole, SHORT(sc.operand[1]), SHORT(sc.operand[1]));
          });
        } else {
          if (!this.increaseHPMP(eventObjectID, SHORT(sc.operand[1]), SHORT(sc.operand[1]))) {
            this.scriptSuccess = false;
          }
        }
        break;
      case 0x001E:
        log.debug('[SCRIPT] Increase or decrease cash by the specified amount');
        if (SHORT(sc.operand[0]) < 0 && this.cashSignal.value < -SHORT(sc.operand[0])) {
          scriptEntry = sc.operand[1] - 1;
        } else {
          worldService.adjustCash(SHORT(sc.operand[0]));
        }
        break;
      case 0x001F:
        log.debug('[SCRIPT] Add item to inventory');
        this.addItemToInventory(sc.operand[0], SHORT(sc.operand[1]));
        break;
      case 0x0020:
        log.debug('[SCRIPT] Remove item from inventory');
        x = sc.operand[1] || 1;
        if (x <= this.countItem(sc.operand[0]) || sc.operand[2] === 0) {
          y = this.addItemToInventory(sc.operand[0], -x);
          if (y === false || (typeof y === 'number' && y < 0)) {
            // Not (enough) in the inventory: take the rest from what the party has equipped.
            if (typeof y === 'number') {
              x = -y;
            }
            const party = this.getPartyState();
            const maxIndex = this.getMaxPartyMemberIndex();
            for (let partyIndex = 0; partyIndex <= maxIndex && partyIndex < party.length && x > 0; partyIndex++) {
              const member = party[partyIndex];
              if (!member) continue;
              const roleId = member.playerRole;
              for (let equipIndex = 0; equipIndex < Const.MAX_PLAYER_EQUIPMENTS; equipIndex++) {
                if (getPlayerEquipmentFromAdapter(equipIndex, roleId) === sc.operand[0]) {
                  this.removeEquipmentEffect(roleId, equipIndex);
                  worldService.setPlayerEquipment(equipIndex, roleId, 0);
                  if (--x === 0) break;
                }
              }
            }
          }
        } else {
          scriptEntry = sc.operand[2] - 1;
        }
        break;
      case 0x0021:
        log.debug('[SCRIPT] Inflict damage to the enemy');
        if (sc.operand[0]) {
          for (i = 0; i <= this.BATTLE().maxEnemyIndex; i++) {
            var enemy = this.BATTLE().enemy[i];
            if (enemy && enemy.objectID != 0) {
              battleService.setEnemyHealth(i, (health: number) => (health || 0) - sc.operand[1]);
            }
          }
        } else {
          battleService.setEnemyHealth(eventObjectID, (health: number) => (health || 0) - sc.operand[1]);
        }
        break;
      case 0x0022:
        log.debug('[SCRIPT] Revive player');
        if (sc.operand[0]) {
          this.scriptSuccess = false;
          this.forEachPartyMember((member: any) => {
            var roleIndex = member.playerRole;
            if (getPlayerHPValue(roleIndex) === 0) {
              var revivedHP = Math.floor(getPlayerMaxHPValue(roleIndex) * sc.operand[1] / 10);
              worldService.setPlayerHP(roleIndex, revivedHP);
              this.curePoisonByLevel(roleIndex, 3);
              for (x = 0; x < PlayerStatus.All; x++) {
                this.removePlayerStatus(roleIndex, x);
              }
              this.scriptSuccess = true;
            }
          });
        } else {
          if (getPlayerHPValue(eventObjectID) === 0) {
            var revivedHP = Math.floor(getPlayerMaxHPValue(eventObjectID) * sc.operand[1] / 10);
            worldService.setPlayerHP(eventObjectID, revivedHP);
            this.curePoisonByLevel(eventObjectID, 3);
            for (x = 0; x < PlayerStatus.All; x++) {
              this.removePlayerStatus(eventObjectID, x);
            }
          } else {
            this.scriptSuccess = false;
          }
        }
        break;
      case 0x0023:
        log.debug('[SCRIPT] Remove equipment from the specified player');
        playerRole = sc.operand[0]; // a role id, not a party slot
        if (sc.operand[1] === 0) {
          for (i = 0; i < Const.MAX_PLAYER_EQUIPMENTS; i++) {
            w = getPlayerEquipmentFromAdapter(i, playerRole);
            if (w !== 0) {
              this.addItemToInventory(w, 1);
              worldService.setPlayerEquipment(i, playerRole, 0);
            }
            this.removeEquipmentEffect(playerRole, i);
          }
        } else {
          w = getPlayerEquipmentFromAdapter(sc.operand[1] - 1, playerRole);
          if (w !== 0) {
            this.removeEquipmentEffect(playerRole, sc.operand[1] - 1);
            this.addItemToInventory(w, 1);
            worldService.setPlayerEquipment(sc.operand[1] - 1, playerRole, 0);
          }
        }
        break;
      case 0x0024:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Set the autoscript entry address for an event object');
        }
        if (sc.operand[0] !== 0 && curEventObjectID > 0) {
          var nextAutoScript = Number.isFinite(sc.operand[1]) ? sc.operand[1] : 0;
          worldService.mutateEventObjectById(curEventObjectID, (target: any) => {
            if (!target) return target;
            target.autoScript = nextAutoScript;
            return target;
          });
          if (current) {
            current.autoScript = nextAutoScript;
          }
        }
        break;
      case 0x0025:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Set the trigger sc entry address for an event object');
        }
        if (sc.operand[0] !== 0 && curEventObjectID > 0) {
          var nextTriggerScript = Number.isFinite(sc.operand[1]) ? sc.operand[1] : 0;
          worldService.mutateEventObjectById(curEventObjectID, (target: any) => {
            if (!target) return target;
            target.triggerScript = nextTriggerScript;
            return target;
          });
          if (current) {
            current.triggerScript = nextTriggerScript;
          }
        }
        break;
      case 0x0026:
        if(this.manualExecution && frame){await this.runManualShop(frame,sc);break;}
        log.debug('[SCRIPT] Show the buy item menu');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
        this.surface?.updateScreen(null);
        // 商店界面在 uigame 上,不在 ui 上:之前调 ui.buyMenu → TypeError 直接打死主循环,游戏永久卡住。
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(uigame.buyMenu(sc.operand[0]))));
        break;
      case 0x0027:
        if(this.manualExecution && frame){await this.runManualShop(frame,sc);break;}
        log.debug('[SCRIPT] Show the sell item menu');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
        this.surface?.updateScreen(null);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(uigame.sellMenu())));
        break;
      case 0x0028:
        log.debug('[SCRIPT] Apply poison to enemy');
        if(this.manualExecution && frame) {await this.runManualPoison(frame,sc,eventObjectID); break;}
        if (sc.operand[0]) {
          for (i = 0; i <= this.BATTLE().maxEnemyIndex; i++) {
            var targetEnemy = this.BATTLE().enemy[i];
            if (!targetEnemy || targetEnemy.objectID === 0) continue;
            var resistance = this.getObjectEnemyResistance(targetEnemy.objectID);
            if (randomLong(0, 9) >= resistance) {
              for (j = 0; j < Const.MAX_POISONS; j++) {
                if (targetEnemy.poisons[j].poisonID === sc.operand[1]) break;
              }
              if (j >= Const.MAX_POISONS) {
                for (j = 0; j < Const.MAX_POISONS; j++) {
                  if (targetEnemy.poisons[j].poisonID === 0) {
                    battleService.setEnemyPoison(i, j, (poison: any) => {
                      poison.poisonID = sc.operand[1];
                      return poison;
                    });
                    var poisonScript = this.getObjectPoisonEnemyScript(sc.operand[1]);
                    if (typeof poisonScript === 'undefined' || poisonScript === null) poisonScript = 0;
                    ret = this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.runChildTrigger(poisonScript, eventObjectID, frame)));
                    battleService.setEnemyPoison(i, j, (poison: any) => {
                      poison.poisonScript = ret;
                      return poison;
                    });
                    break;
                  }
                }
              }
            }
          }
        } else {
          var singleEnemy = this.BATTLE().enemy[eventObjectID];
          if (singleEnemy) {
            var enemyObjectId = singleEnemy.objectID;
            var singleResistance = this.getObjectEnemyResistance(enemyObjectId);
            if (randomLong(0, 9) >= singleResistance) {
              for (j = 0; j < Const.MAX_POISONS; j++) {
                if (singleEnemy.poisons[j].poisonID == sc.operand[1]) break;
              }
              if (j >= Const.MAX_POISONS) {
                for (j = 0; j < Const.MAX_POISONS; j++) {
                  if (singleEnemy.poisons[j].poisonID == 0) {
                    battleService.setEnemyPoison(eventObjectID, j, (poison: any) => {
                      poison.poisonID = sc.operand[1];
                      return poison;
                    });
                    var singlePoisonScript = this.getObjectPoisonEnemyScript(sc.operand[1]);
                    if (typeof singlePoisonScript === 'undefined' || singlePoisonScript === null) singlePoisonScript = 0;
                    var singleRet = this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.runChildTrigger(singlePoisonScript, eventObjectID, frame)));
                    battleService.setEnemyPoison(eventObjectID, j, (poison: any) => {
                      poison.poisonScript = singleRet;
                      return poison;
                    });
                    break;
                  }
                }
              }
            }
          }
        }
        break;
      case 0x0029:
        log.debug('[SCRIPT] Apply poison to player');
        if(this.manualExecution && frame) {await this.runManualPoison(frame,sc,eventObjectID); break;}
        if (sc.operand[0]) {
          var poisonTargets: number[] = [];
          this.forEachPartyMember((member: any) => {
            poisonTargets.push(member.playerRole);
          });
          for (var poisonTarget of poisonTargets) {
            if (randomLong(1, 100) > this.getPlayerPoisonResistance(poisonTarget)) {
              this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await (frame ? this.addPoisonForPlayer(poisonTarget, sc.operand[1], frame) : this.addPoisonForPlayer(poisonTarget, sc.operand[1]))));
            }
          }
        } else {
          if (randomLong(1, 100) > this.getPlayerPoisonResistance(eventObjectID)) {
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await (frame ? this.addPoisonForPlayer(eventObjectID, sc.operand[1], frame) : this.addPoisonForPlayer(eventObjectID, sc.operand[1]))));
          }
        }
        break;
      case 0x002A:
        log.debug('[SCRIPT] Cure poison by object ID for enemy');
        if (sc.operand[0]) {
          for (i = 0; i <= this.BATTLE().maxEnemyIndex; i++) {
            if (this.BATTLE().enemy[i].objectID === 0) continue;
            for (j = 0; j < Const.MAX_POISONS; j++) {
              if (this.BATTLE().enemy[i].poisons[j].poisonID === sc.operand[1]) {
                battleService.clearEnemyPoison(i, j);
                battlePoisonRuntime.noteSlotCleared(frame,'enemy',i,j);
                break;
              }
            }
          }
        } else {
          for (j = 0; j < Const.MAX_POISONS; j++) {
            if (this.BATTLE().enemy[eventObjectID].poisons[j].poisonID == sc.operand[1]) {
              battleService.clearEnemyPoison(eventObjectID, j);
              battlePoisonRuntime.noteSlotCleared(frame,'enemy',eventObjectID,j);
              break;
            }
          }
        }
        break;
      case 0x002B:
        log.debug('[SCRIPT] Cure poison by object ID for player');
        if (sc.operand[0]) {
          this.forEachPartyMember((member: any) => {
            this.curePoisonByKind(member.playerRole, sc.operand[1],frame);
          });
        } else {
          this.curePoisonByKind(eventObjectID, sc.operand[1],frame);
        }
        break;
      case 0x002C:
        log.debug('[SCRIPT] Cure poisons by level');
        if (sc.operand[0]) {
          this.forEachPartyMember((member: any) => {
            this.curePoisonByLevel(member.playerRole, sc.operand[1],frame);
          });
        } else {
          this.curePoisonByLevel(eventObjectID, sc.operand[1],frame);
        }
        break;
      case 0x002D:
        log.debug('[SCRIPT] Set the status for player');
        if (!this.applyPlayerStatus(eventObjectID, sc.operand[0], sc.operand[1])) {
          this.scriptSuccess = false;
        }
        break;
      case 0x002E:
        log.debug('[SCRIPT] Set the status for enemy');
        w = this.BATTLE().enemy[eventObjectID].objectID;
        i = 9; // classic
        var enemyResistance = this.getObjectEnemyResistance(w);
        if (randomLong(0, i) > enemyResistance) {
          battleService.setEnemyStatus(eventObjectID, sc.operand[0], sc.operand[1]);
        } else {
          scriptEntry = sc.operand[2] - 1;
        }
        break;
      case 0x002F:
        log.debug('[SCRIPT] Remove player\'s status');
        this.removePlayerStatus(eventObjectID, sc.operand[0]);
        break;
      case 0x0030:
        log.debug('[SCRIPT] Increase player\'s stat temporarily by percent');
        if (sc.operand[2] === 0) {
          playerRole = eventObjectID;
        } else {
          playerRole = sc.operand[2] - 1;
        }
        var baseValue = getPlayerRoleWordValue(sc.operand[0], playerRole);
        var val = Math.trunc(baseValue * SHORT(sc.operand[1]) / 100);
        worldService.setEquipmentEffectWord(BodyPart.Extra, sc.operand[0], playerRole, val);
        break;
      case 0x0031:
        log.debug('[SCRIPT] Change battle sprite temporarily for player');
        worldService.mutateEquipmentEffect(BodyPart.Extra, (effect: any) => {
          if (effect && effect.spriteNumInBattle) {
            effect.spriteNumInBattle[eventObjectID] = sc.operand[0];
          }
          return effect;
        });
        break;
      case 0x0033:
        log.debug('[SCRIPT] collect the enemy for items');
        var collectedEnemy = this.BATTLE().enemy[eventObjectID];
        if (collectedEnemy?.e && collectedEnemy.e.collectValue !== 0) {
          worldService.adjustCollectValue(collectedEnemy.e.collectValue);
        } else {
          scriptEntry = sc.operand[0] - 1;
        }
        break;
      case 0x0034:
        log.debug('[SCRIPT] Transform collected enemies into items');
        var collectValue = getCollectValueFlagValue();
        if (collectValue > 0) {
          // Classic: RandomLong(1, collect) capped at 9.
          i = randomLong(1, collectValue);
          if (i > 9) i = 9;
          worldService.adjustCollectValue(-i);
          i--;
          var storeItemId = this.getStoreItemId(0, i);
          if (storeItemId) {
            this.addItemToInventory(storeItemId, 1);
          }
          // SDLPAL uses PAL_StartDialogWithOffset(kDialogCenterWindow, 0, 0, FALSE, 0, -10);
          // the TS dialog has no offset API yet, so the window is not raised by 10.
          ui.setDialogShadow(5);
          ui.startDialog(DialogPosition.CenterWindow, 0, 0, false, 0, -10);
          // "%ls@%ls@": the item name is shown in the '@' colour.
          var s = Array.from(ui.getWord(42) as ArrayLike<number>)
            .concat([0x40], Array.from(ui.getWord(storeItemId) as ArrayLike<number>), [0x40]);
          this.drawCollectedItemBox(storeItemId);
          dialogService.setPendingLineMetadata({
            scriptEntry,
            eventObjectId: eventObjectID,
            source: 'collect-transform',
            metadata: { storeItemId }
          });
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(ui.showDialogText(s))));
          ui.setDialogShadow(0);
        } else {
          scriptEntry = sc.operand[0] - 1;
        }
        break;
      case 0x0035:
        log.debug('[SCRIPT] Shake the screen');
        i = sc.operand[1];
        if (i === 0) i = 4;
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.shakeScreen(sc.operand[0], i))));
        if (!sc.operand[0]) {
           this.surface?.updateScreen(null);
        }
        break;
      case 0x0036:
        log.debug('[SCRIPT] Set the current playing RNG animation');
        worldService.setCurPlayingRng(sc.operand[0]);
        break;
      case 0x0037:
        log.debug('[SCRIPT] Play RNG animation');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(rng.play(
          worldService.getCurPlayingRng() as number,
          sc.operand[0],
          sc.operand[1] > 0 ? sc.operand[1] : 999,
          sc.operand[2] > 0 ? sc.operand[2] : 16
        ))));
        break;
      case 0x0038: {
        const saved=frame && this.teleportReturns.get(frame.id);
        if(saved) {
          this.executionRuntime.resume(frame,(frame.status='waiting',await this.runChildTrigger(saved.childEntry,saved.childEventId,frame)));
          this.teleportReturns.delete(frame.id);
          break;
        }
        const sceneId=getSceneIdSnapshot(),currentScene=getSceneEntrySnapshot(sceneId),entry=currentScene?.scriptOnTeleport as number;
        if(!worldService.isInBattle() && currentScene && entry!==0) {
          if(this.manualExecution && frame){
            worldService.acquireTeleportRoot(this.manualIdentity!.id,scriptEntry,sc);
            this.teleportReturns.set(frame.id,{kind:'teleport-child',opcodePC:scriptEntry,nextPC:scriptEntry+1,operation:0x38,operands:Array.from(sc.operand),selectedScene:sceneId,childEntry:entry,childEventId:0xffff,effectiveEventId:worldService.getLastEventObjectId(),returnPolicy:'discard'});
          }
          this.executionRuntime.resume(frame,(frame && (frame.status='waiting'),await this.runChildTrigger(entry,0xffff,frame)));
          if(frame)this.teleportReturns.delete(frame.id);
        } else {this.scriptSuccess=false;scriptEntry=sc.operand[0]-1;}
        break;
      }
      case 0x0039:
        log.debug('[SCRIPT] Drain HP from enemy');
        var movingMember = this.getPartyMember(this.BATTLE().movingPlayerIndex);
        w = movingMember ? movingMember.playerRole : 0;
        battleService.updateEnemy(eventObjectID, (enemy: any) => {
          if (!enemy?.e) return enemy;
          enemy.e.health -= sc.operand[0];
          return enemy;
        });
        worldService.mutatePlayerRoles((playerRoles: any) => {
          playerRoles.HP[w] += sc.operand[0];
          if (playerRoles.HP[w] > playerRoles.maxHP[w]) {
            playerRoles.HP[w] = playerRoles.maxHP[w];
          }
          return playerRoles;
        });
        break;
      case 0x003A:
        log.debug('[SCRIPT] Player flee from the battle');
        if (this.BATTLE().isBoss) {
          scriptEntry = sc.operand[0] - 1;
        } else {
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.playerEscape())));
        }
        break;
      case 0x003F:
        if(this.manualExecution && frame){await this.runManualPartyMotion(frame,sc,eventObjectID);break;}
        log.debug('[SCRIPT] Ride the event object to the specified position, at a low speed');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.partyRideEventObject(eventObjectID, sc.operand[0], sc.operand[1], sc.operand[2], 2)));
        break;
      case 0x0040:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] set the trigger method for a event object');
        }
        if (sc.operand[0] !== 0 && current) {
          current.triggerMode = sc.operand[1];
        }
        break;
      case 0x0041:
        log.debug('[SCRIPT] Mark the sc as failed');
        this.scriptSuccess = false;
        break;
      case 0x0042:
        log.debug('[SCRIPT] Simulate a magic for player');
        i = SHORT(sc.operand[2]) - 1;
        if (i < 0) i = eventObjectID;
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.simulateMagic(i, sc.operand[0], sc.operand[1]))));
        break;
      case 0x0043:
        log.debug('[SCRIPT] Set background music');
        worldService.setMusicTrack(sc.operand[0]);
        // As in SDLPAL: operand[1] == 1 plays once; 3 fades in over 3 seconds (except track 9).
        music.play(sc.operand[0], sc.operand[1] != 1, (sc.operand[1] == 3 && sc.operand[0] != 9) ? 3.0 : 0.0);
        break;
      case 0x0044:
        if(this.manualExecution && frame){await this.runManualPartyMotion(frame,sc,eventObjectID);break;}
        log.debug('[SCRIPT] Ride the event object to the specified position, at the normal speed');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.partyRideEventObject(eventObjectID, sc.operand[0], sc.operand[1], sc.operand[2], 4)));
        break;
      case 0x0045:
        log.debug('[SCRIPT] Set battle music');
        worldService.setBattleMusicTrack(sc.operand[0]);
        break;
      case 0x0046:
        log.debug('[SCRIPT] Set the party position on the map');
        var offsetX: any, offsetY: any;
        var currentDirection = this.getPartyDirection();
        offsetX = ((currentDirection === Direction.West || currentDirection === Direction.South) ? 16 : -16);
        offsetY = ((currentDirection === Direction.West || currentDirection === Direction.North) ? 8 : -8);
        x = sc.operand[0] * 32 + sc.operand[2] * 16;
        y = sc.operand[1] * 16 + sc.operand[2] * 8;
        x -= this.getPartyOffsetX();
        y -= this.getPartyOffsetY();
        var viewportPos = PAL_XY(x, y);
        worldService.setViewport(viewportPos);
        var partyStartX = this.getPartyOffsetX();
        var partyStartY = this.getPartyOffsetY();
        var viewportX = PAL_X(viewportPos);
        var viewportY = PAL_Y(viewportPos);
        var direction = this.getPartyDirection();
        worldService.mutateParty((party: any) => {
          worldService.mutateTrail((trail: any) => {
            var currentX = partyStartX;
            var currentY = partyStartY;
            for (var idx = 0; idx < Const.MAX_PLAYABLE_PLAYER_ROLES; idx++) {
              var member = party && party[idx];
              if (member) {
                member.x = currentX;
                member.y = currentY;
              }
              var trailEntry = trail && trail[idx];
              if (trailEntry) {
                trailEntry.x = currentX + viewportX;
                trailEntry.y = currentY + viewportY;
                trailEntry.direction = direction;
              }
              currentX += offsetX;
              currentY += offsetY;
            }
            return trail;
          });
          return party;
        });
        break;
      case 0x0047:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Play sound effect');
        }
        sound.play(sc.operand[0]);
        break;
      case 0x0049:
        log.debug('[SCRIPT] Set the state of event object');
        if (sc.operand[0] !== 0 && current) {
          worldService.mutateEventObjectById(curEventObjectID, (target: any) => { target.state = SHORT(sc.operand[1]); return target; });
        }
        break;
      case 0x004A:
        log.debug('[SCRIPT] Set the current battlefield');
        worldService.setBattleFieldId(sc.operand[0]);
        break;
      case 0x004B:
        log.debug('[SCRIPT] Nullify the event object for a short while');
        // SDLPAL dereferences pEvtObj, which is NULL for event id 0 (a crash): skip instead of throwing.
        if (evtObj) worldService.mutateEventObjectById(baseEventId!, (target: any) => { target.vanishTime = -nullifyFrames(); return target; });
        break;
      case 0x004C:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] chase the player');
        }
        i = sc.operand[0]; // max. distance
        j = sc.operand[1]; // speed
        if (i === 0) i = 8;
        if (j === 0) j = 4;
        this.monsterChasePlayer(eventObjectID, j, i, sc.operand[2]);
        break;
      case 0x004D:
        if(this.manualExecution)this.captureWait(createInputWait(scriptEntry,sc));
        log.debug('[SCRIPT] wait for any key');
        // Report the key wait like a dialog line awaiting input, so headless drivers (agent-pal) see it.
        dialogService.setAwaitingInput(true);
        try {
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(inputService.waitForKey(0))));
        } finally {
          dialogService.setAwaitingInput(false);
        }
        break;
      case 0x004E:
        log.debug('[SCRIPT] Load the last saved game');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.fadeOut(1))));
        // Loading mid-script would let the callers write stale script entries back into the
        // freshly loaded data, so (like PAL_ReloadInNextTick) the main loop loads at the next frame.
        // The current slot lives in worldService (new game = 0, save/load menus and play.reloadInNextTick
        // all write it); the viewport-slice copy behind getCurrentSaveSlotSnapshot is never written and
        // stays 1, which made a defeat always reload slot 1 (cf. #13).
        play.reloadInNextTick(worldService.getCurrentSaveSlot());
        return 0; // don't go further
      case 0x004F:
        log.debug('[SCRIPT] Fade the screen to red color (game over)');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.fadeToRed())));
        break;
      case 0x0050:
        log.debug('[SCRIPT] screen fade out');
        this.surface?.updateScreen(null);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.fadeOut((sc.operand[0] ? sc.operand[0] : 1)))));
        worldService.setNeedToFadeIn(true);
        break;
      case 0x0051:
        log.debug('[SCRIPT] screen fade in');
        this.surface?.updateScreen(null);
        var time = SHORT(sc.operand[0]);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.fadeIn(getPaletteIdSnapshot(), isNightPaletteEnabled(), (time > 0 ? time : 1)))));
        worldService.setNeedToFadeIn(false);
        break;
      case 0x0052:
        log.debug('[SCRIPT] hide the event object for a while, default 800 frames');
        // As 0x004B: no executing event (SDLPAL NULL deref) -> skip instead of throwing.
        if (evtObj) {
          evtObj.state *= -1;
          evtObj.vanishTime = (sc.operand[0] ? sc.operand[0] : 800);
        }
        break;
      case 0x0053:
        log.debug('[SCRIPT] use the day palette');
        worldService.setNightPaletteFlag(false);
        break;
      case 0x0054:
        log.debug('[SCRIPT] use the night palette');
        worldService.setNightPaletteFlag(true);
        break;
      case 0x0055:
        log.debug('[SCRIPT] Add magic to a player');
        i = sc.operand[1];
        if (i === 0) {
          i = eventObjectID;
        } else {
          i--;
        }
        this.addMagic(i, sc.operand[0]);
        break;
      case 0x0056:
        log.debug('[SCRIPT] Remove magic from a player');
        i = sc.operand[1];
        if (i === 0) {
          i = eventObjectID;
        } else {
          i--;
        }
        this.removeMagic(i, sc.operand[0]);
        break;
      case 0x0057:
        log.debug('[SCRIPT] Set the base damage of magic according to MP value');
        i = ((sc.operand[1] === 0) ? 8 : sc.operand[1]);
        j = this.getMagicNumberFromObject(sc.operand[0]);
        var mpValue = getPlayerMPValue(eventObjectID);
        worldService.mutateMagicTable((magicData: any) => {
          if (magicData && magicData[j]) {
            magicData[j].baseDamage = mpValue * i;
          }
        });
        worldService.setPlayerMP(eventObjectID, 0);
        break;
      case 0x0058:
        log.debug('[SCRIPT] Jump if there is less than the specified number of the specified items in the inventory');
        if (this.getItemAmount(sc.operand[0]) < SHORT(sc.operand[1])) {
          scriptEntry = sc.operand[2] - 1;
        }
        break;
      case 0x0059:
        log.debug('[SCRIPT] Change to the specified scene');
        debugBgEvent('script-change-scene', { targetScene: sc.operand[0] });
        const sceneOverlay = clearFbpOverlay('change-scene');
        if (sc.operand[0] > 0 && sc.operand[0] <= Const.MAX_SCENES && getSceneIdSnapshot() !== sc.operand[0]) {
          worldService.setSceneId(sc.operand[0]);
          res.setLoadFlags(LoadFlag.Scene);
          worldService.setEnteringScene(true);
          worldService.setLayer(0);
        }
        markBgDirty('change-scene');
        restoreOverlayMode(sceneOverlay);
        break;
      case 0x005A:
        log.debug('[SCRIPT] Halve the player\'s HP');
        var currentHP = getPlayerHPValue(eventObjectID);
        worldService.setPlayerHP(eventObjectID, Math.floor(currentHP / 2));
        break;
      case 0x005B:
        log.debug('[SCRIPT] Halve the enemy\'s HP');
        var halvedEnemy = this.BATTLE().enemy[eventObjectID];
        if (!halvedEnemy?.e) break;
        w = ~~(halvedEnemy.e.health / 2) + 1;
        if (w > sc.operand[0]) w = sc.operand[0];
        battleService.updateEnemy(eventObjectID, (enemy: any) => {
          if (!enemy?.e) return enemy;
          enemy.e.health -= w;
          return enemy;
        });
        break;
      case 0x005C:
        log.debug('[SCRIPT] Hide for a while');
        battleService.setHidingTime(-sc.operand[0]);
        break;
      case 0x005D:
        log.debug('[SCRIPT] Jump if player doesn\'t have the specified poison');
        if (!this.isPlayerPoisonedByKind(eventObjectID, sc.operand[0])) {
          scriptEntry = sc.operand[1] - 1;
        }
        break;
      case 0x005E:
        log.debug('[SCRIPT] Jump if enemy doesn\'t have the specified poison');
        for (i = 0; i < Const.MAX_POISONS; i++) {
          if (this.BATTLE().enemy[eventObjectID].poisons[i].poisonID == sc.operand[0]) break;
        }
        if (i >= Const.MAX_POISONS) {
          scriptEntry = sc.operand[1] - 1;
        }
        break;
      case 0x005F:
        log.debug('[SCRIPT] Kill the player immediately');
        worldService.mutatePlayerRoles((playerRoles: any) => {
          playerRoles.HP[eventObjectID] = 0;
          return playerRoles;
        });
        break;
      case 0x0060:
        log.debug('[SCRIPT] Immediate KO of the enemy');
        battleService.setEnemyHealth(eventObjectID, 0);
        break;
      case 0x0061:
        log.debug('[SCRIPT] Jump if player is not poisoned');
        if (!this.isPlayerPoisonedByLevel(eventObjectID, 0)) {
          scriptEntry = sc.operand[0] - 1;
        }
        break;
      case 0x0062:
        log.debug('[SCRIPT] Pause enemy chasing for a while');
        worldService.setChaseSpeedChangeCycles(sc.operand[0]);
        worldService.setChaseRange(0);
        break;
      case 0x0063:
        log.debug('[SCRIPT] Speed up enemy chasing for a while');
        worldService.setChaseSpeedChangeCycles(sc.operand[0]);
        worldService.setChaseRange(3);
        break;
      case 0x0064:
        log.debug('[SCRIPT] Jump if enemy\'s HP is more than the specified percentage');
        var enemyState = this.BATTLE().enemy[eventObjectID];
        if (enemyState?.e) {
          var enemyId = this.getEnemyIdFromObject(enemyState.objectID);
          var enemyTemplate = this.getEnemyEntry(enemyId);
          var enemyMaxHealth = enemyTemplate && typeof enemyTemplate.health === 'number' ? enemyTemplate.health : 0;
          if (enemyState.e.health * 100 > enemyMaxHealth * sc.operand[0]) {
            scriptEntry = sc.operand[1] - 1;
          }
        }
        break;
      case 0x0065:
        log.debug('[SCRIPT] Set the player\'s sprite');
        worldService.mutatePlayerRoles((playerRoles: any) => {
          playerRoles.spriteNum[sc.operand[0]] = sc.operand[1];
          return playerRoles;
        });
        if (!this.isInBattle() && sc.operand[2]) {
          res.setLoadFlags(LoadFlag.PlayerSprite);
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(res.loadResources())));
        }
        break;
      case 0x0066:
        log.debug('[SCRIPT] Throw weapon to enemy');
        w = sc.operand[1] * 5;
        var attackingMember = this.getPartyMember(this.BATTLE().movingPlayerIndex);
        var attackingRole = attackingMember ? attackingMember.playerRole : 0;
        w += getPlayerAttackStrengthValue(attackingRole) * randomLong(0, 3);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.simulateMagic(SHORT(eventObjectID), sc.operand[0], w))));
        break;
      case 0x0067:
        log.debug('[SCRIPT] Enemy use magic');
        battleService.setEnemyMagic(eventObjectID, sc.operand[0]);
        battleService.setEnemyMagicRate(eventObjectID, (sc.operand[1] == 0) ? 10 : sc.operand[1]);
        break;
      case 0x0068:
        log.debug('[SCRIPT] Jump if it\'s enemy\'s turn');
        if (battleService.isEnemyMoving()) {
          scriptEntry = sc.operand[0] - 1;
        }
        break;
      case 0x0069:
        log.debug('[SCRIPT] Enemy escape in battle');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.enemyEscape())));
        break;
      case 0x006A:
        log.debug('[SCRIPT] Steal from the enemy');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.stealFromEnemy(eventObjectID, sc.operand[0]))));
        break;
      case 0x006B:
        log.debug('[SCRIPT] Blow away enemies');
        battleService.setBattleBlow(SHORT(sc.operand[0]));
        break;
      case 0x006C:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Walk the NPC in one step');
        }
        if (current) {
          current.x = WORD(current.x + SHORT(sc.operand[1]));
          current.y = WORD(current.y + SHORT(sc.operand[2]));
        }
        this.NPCWalkOneStep(curEventObjectID, 0);
        // Render scene to show NPC movement animation
        scene.updatePartyGestures(false, { preserveFrames: true });
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
        this.surface?.updateScreen(null);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await sleepByFrame(1)));
        break;
      case 0x006D:
        log.debug('[SCRIPT] Set the enter sc and teleport sc for a scene');
        if (sc.operand[0]) {
          worldService.mutateSceneEntry(sc.operand[0], (sceneEntry: any) => {
            if (!sceneEntry) {
              return sceneEntry;
            }
            if (sc.operand[1]) {
              sceneEntry.scriptOnEnter = sc.operand[1];
            }
            if (sc.operand[2]) {
              sceneEntry.scriptOnTeleport = sc.operand[2];
            }
            if (sc.operand[1] === 0 && sc.operand[2] === 0) {
              sceneEntry.scriptOnEnter = 0;
              sceneEntry.scriptOnTeleport = 0;
            }
            return sceneEntry;
          });
        }
        break;
        case 0x006E:
        if (shouldTraceScript()) {
          log.debug('[SCRIPT] Move the player to the specified position in one step');
        }
        var currentViewport = getViewportSnapshot();
        var partyOffset = getPartyOffsetSnapshot();
        var currentDirection = this.getPartyDirection();
        worldService.mutateTrail((trail: any) => {
          if (!Array.isArray(trail) || trail.length === 0) {
            return trail;
          }
          shiftTrailInPlace(trail);
          trail[0] = trail[0] || {};
          trail[0].direction = currentDirection;
          trail[0].x = PAL_X(currentViewport) + PAL_X(partyOffset);
          trail[0].y = PAL_Y(currentViewport) + PAL_Y(partyOffset);
          return trail;
        });
        var newViewport = PAL_XY(
          PAL_X(currentViewport) + SHORT(sc.operand[0]),
          PAL_Y(currentViewport) + SHORT(sc.operand[1])
        );
        worldService.setViewport(newViewport);
        worldService.setLayer(sc.operand[2] * 8);
        if (sc.operand[0] !== 0 || sc.operand[1] !== 0){
          scene.updatePartyGestures(true);
        }
        break;
      case 0x006F:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Sync the state of current event object with another event object');
        }
        if (current && current.state === SHORT(sc.operand[1])) {
          // Native historically throws when a matching source has no executing event.
          // Manual execution rejects this domain before the write; keep Native failure.
          if (!evtObj) {
            if (this.manualExecution) throw new ManualExecutionSignal({status:'unsupported',reason:'Matching event state requires an executing event'});
            evtObj.state = SHORT(sc.operand[1]);
          }
          worldService.mutateEventObjectById(baseEventId!, (target: any) => { target.state = SHORT(sc.operand[1]); return target; });
        }
        break;
      case 0x0070:
        if(this.manualExecution && frame){await this.runManualPartyMotion(frame,sc,eventObjectID);break;}
        log.debug('[SCRIPT] Walk the party to the specified position');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.partyWalkTo(sc.operand[0], sc.operand[1], sc.operand[2], 2)));
        break;
      case 0x0071:
        log.debug('[SCRIPT] Wave the screen');
        worldService.setScreenWave(sc.operand[0]);
        worldService.setWaveProgression(SHORT(sc.operand[1]));
        break;
      case 0x0072:
        log.debug('[SCRIPT] unknown 0x0072');
        break;
      case 0x0073:
        log.debug('[SCRIPT] Fade the screen to scene');
        debugBgEvent('script-fade-to-scene', { speed: sc.operand[0] });
        const fadeOverlay = clearFbpOverlay('fade-to-scene');
        this.surface?.backupScreen();
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.fadeScreen(sc.operand[0]))));
        markBgDirty('fade-to-scene');
        restoreOverlayMode(fadeOverlay);
        break;
      case 0x0074:
        log.debug('[SCRIPT] Jump if not all players are full HP');
        {
          let shouldJump = false;
          this.forEachPartyMember((member: any) => {
            var roleId = member.playerRole;
            if (getPlayerHPValue(roleId) < getPlayerMaxHPValue(roleId)) {
              shouldJump = true;
            }
          });
          if (shouldJump) {
            scriptEntry = sc.operand[0] - 1;
          }
        }
        break;
      case 0x0075:
        if(!this.manualExecution || !frame || !this.partyEquipmentCursors.has(frame.id)) {
          log.debug('[SCRIPT] Set the player party');
          worldService.setMaxPartyMemberIndex(0);
          var assignedCount = 0;
          worldService.mutateParty((party: any) => {
            if (!party) {
              return party;
            }
            for (var idx = 0; idx < 3; idx++) {
              if (sc.operand[idx] != 0) {
                var member = party[assignedCount];
                if (member) {
                  member.playerRole = sc.operand[idx] - 1;
                }
                assignedCount++;
              }
            }
            if (assignedCount === 0 && party[0]) {
              // HACK for Dream 2.11
              party[0].playerRole = 0;
              assignedCount = 1;
            }
            return party;
          });
          worldService.setMaxPartyMemberIndex(assignedCount > 0 ? assignedCount - 1 : 0);
          // Reload the player sprites
          res.setLoadFlags(LoadFlag.PlayerSprite);
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(res.loadResources())));
          worldService.resetPoisonStatusMatrix();
          if(this.manualExecution && frame)this.partyEquipmentCursors.set(frame.id,{opcodePC:frame.currentPC,nextPC:frame.currentPC+1,operands:Array.from(sc.operand).slice(0,3) as number[],assignmentDone:true,resourcesDone:true,poisonResetDone:true});
        }
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await (frame ? this.updateEquipments(frame) : this.updateEquipments())));
        if(frame)this.partyEquipmentCursors.delete(frame.id);
        break;
      case 0x0076:
        log.debug('[SCRIPT] Show FBP picture');
        debugBgEvent('script-show-fbp', { chunk: sc.operand[0], fade: sc.operand[1] });
        ending.setEffectSprite(0);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(ending.showFBP(sc.operand[0], sc.operand[1]))));
        this.surface?.backupScreen();
        markBgDirty('show-fbp');
        invalidateDialogBackup('showFBP');
        break;
      case 0x0077:
        log.debug('[SCRIPT] Stop current playing music');
        music.play(0, false, sc.operand[0] == 0 ? 2.0 : sc.operand[0] * 3); // stops it
        break;
      case 0x0078:
        log.debug('[SCRIPT] unknown 0x0078');
        break;
      case 0x0079:
        log.debug('[SCRIPT] Jump if the specified player is in the party');
        {
          let party = this.getPartyState();
          let maxIndex = getMaxPartyMemberIndexValue();
          for (let partyIndex = 0; partyIndex <= maxIndex && partyIndex < party.length; partyIndex++) {
            let member = party[partyIndex];
            if (!member) continue;
            if (getPlayerNameIdValue(member.playerRole) === sc.operand[0]) {
              scriptEntry = sc.operand[1] - 1;
              break;
            }
          }
        }
        break;
      case 0x007A:
        if(this.manualExecution && frame){await this.runManualPartyMotion(frame,sc,eventObjectID);break;}
        log.debug('[SCRIPT] Walk the party to the specified position, at a higher speed');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.partyWalkTo(sc.operand[0], sc.operand[1], sc.operand[2], 4)));
        break;
      case 0x007B:
        if(this.manualExecution && frame){await this.runManualPartyMotion(frame,sc,eventObjectID);break;}
        log.debug('[SCRIPT] Walk the party to the specified position, at the highest speed');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.partyWalkTo(sc.operand[0], sc.operand[1], sc.operand[2], 8)));
        break;
      case 0x007C:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Walk straight to the specified position');
        }
        if ((eventObjectID & 1) ^ (this.getFrameCounter() & 1)) {
          ret = this.NPCWalkTo(eventObjectID, sc.operand[0], sc.operand[1], sc.operand[2], 4);
          if (!ret){
            scriptEntry--;
            // Render scene to show NPC movement animation
            scene.updatePartyGestures(false, { preserveFrames: true });
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
            this.surface?.updateScreen(null);
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await sleepByFrame(1)));
          }
        } else {
          scriptEntry--;
        }
        break;
      case 0x007D:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Move the event object');
        }
        if (current) {
          current.x = WORD(current.x + SHORT(sc.operand[1]));
          current.y = WORD(current.y + SHORT(sc.operand[2]));
        }
        break;
      case 0x007E:
        log.debug('[SCRIPT] Set the layer of event object');
        if (current) {
          worldService.mutateEventObjectById(curEventObjectID, (target: any) => {
            target.layer = SHORT(sc.operand[1]);
            return target;
          });
        }
        break;
      case 0x007F:
        if(this.manualExecution && frame){await this.runManualPartyMotion(frame,sc,eventObjectID);break;}
        log.debug('[SCRIPT] Move the viewport');
        // The party positions shifted here include the followers (wMaxPartyMemberIndex + nFollower), as in SDLPAL.
        var lastPartyIndex = getMaxPartyMemberIndexValue() + worldService.getFollowerCount();
        var shiftParty = (dx: number, dy: number) => {
          worldService.mutateParty((party: any) => {
            for (var partyIdx = 0; partyIdx <= lastPartyIndex; partyIdx++) {
              var member = party[partyIdx];
              if (member) {
                member.x += dx;
                member.y += dy;
              }
            }
            return party;
          });
        };
        if (sc.operand[0] === 0 && sc.operand[1] === 0) {
          // Move the viewport back to normal state
          var leader = this.getPartyMember(0);
          if (!leader) {
            break;
          }
          var deltaX = leader.x - 160;
          var deltaY = leader.y - 112;
          var vp = getViewportSnapshot();
          worldService.setViewport(PAL_XY(PAL_X(vp) + deltaX, PAL_Y(vp) + deltaY));
          worldService.setPartyOffset(PAL_XY(160, 112));
          shiftParty(-deltaX, -deltaY);
          if (sc.operand[2] !== 0xFFFF) {
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
            this.surface?.updateScreen(null);
          }
        } else {
          i = 0;
          var stepX = SHORT(sc.operand[0]);
          var stepY = SHORT(sc.operand[1]);
          // With operand[2] == 0xFFFF the viewport jumps once and that frame is still drawn:
          // (SHORT)0xFFFF ends the loop after a single pass.
          do {
            if (sc.operand[2] === 0xFFFF) {
              var previousViewport = getViewportSnapshot();
              var targetViewport = PAL_XY(sc.operand[0] * 32 - 160, sc.operand[1] * 16 - 112);
              worldService.setViewport(targetViewport);
              shiftParty(PAL_X(previousViewport) - PAL_X(targetViewport), PAL_Y(previousViewport) - PAL_Y(targetViewport));
            } else {
              var currentViewport = getViewportSnapshot();
              worldService.setViewport(PAL_XY(PAL_X(currentViewport) + stepX, PAL_Y(currentViewport) + stepY));
              var currentPartyOffset = getPartyOffsetSnapshot();
              worldService.setPartyOffset(PAL_XY(PAL_X(currentPartyOffset) - stepX, PAL_Y(currentPartyOffset) - stepY));
              shiftParty(-stepX, -stepY);
            }
            if (sc.operand[2] !== 0xFFFF) {
              this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(this.#invokeRewardWorldUpdate(false,undefined,this.#rewardWorldHooks(frame)))));
            }
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
            this.surface?.updateScreen(null);
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await sleepSceneFrame()));
          } while (++i < SHORT(sc.operand[2]));
        }
        break;
      case 0x0080:
        log.debug('[SCRIPT] Toggle day/night palette');
        var toggledNightPalette = !isNightPaletteEnabled();
        worldService.setNightPaletteFlag(toggledNightPalette);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.paletteFade(getPaletteIdSnapshot(), toggledNightPalette, !sc.operand[0] ? 1 : 0))));
        break;
      case 0x0081:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Jump if the player is not facing the specified event object');
        }
        var eventRange = this.getSceneEventRange();
        if (sc.operand[0] <= eventRange.startIndex
            || sc.operand[0] > eventRange.endIndex) {
           // The event object is not in the current scene
           scriptEntry = sc.operand[2] - 1;
           this.scriptSuccess = false;
           break;
        }
        if (current) {
          x = current.x;
          y = current.y;
          var partyDir = this.getPartyDirection();
          x += ((partyDir == Direction.West || partyDir == Direction.South) ? 16 : -16);
          y += ((partyDir == Direction.West || partyDir == Direction.North) ? 8 : -8);
          x -= PAL_X(getViewportSnapshot()) + PAL_X(getPartyOffsetSnapshot());
          y -= PAL_Y(getViewportSnapshot()) + PAL_Y(getPartyOffsetSnapshot());
          var facingTarget = this.getEventObjectById(sc.operand[0]);
          if (Math.abs(x) + Math.abs(y * 2) < sc.operand[1] * 32 + 16 &&
              facingTarget && SHORT(facingTarget.state) > 0) {
            if (sc.operand[1] > 0) {
              // Change the trigger mode so that the object can be triggered in next frame
              current.triggerMode = TriggerMode.TouchNormal + sc.operand[1];
            }
          } else {
            scriptEntry = sc.operand[2] - 1;
            this.scriptSuccess = false;
          }
        }
        break;
      case 0x0082:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Walk straight to the specified position, at a high speed');
        }
        ret = this.NPCWalkTo(eventObjectID, sc.operand[0], sc.operand[1], sc.operand[2], 8);
        if (!ret) {
          scriptEntry--;
          // Render scene to show NPC movement animation
          scene.updatePartyGestures(false, { preserveFrames: true });
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
          this.surface?.updateScreen(null);
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await sleepByFrame(1)));
        }
        break;
      case 0x0083:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Jump if event object is not in the specified zone of the current event object');
        }
        var zoneEventRange = this.getSceneEventRange();
        if (sc.operand[0] <= zoneEventRange.startIndex
            || sc.operand[0] > zoneEventRange.endIndex) {
          // The event object is not in the current scene
          scriptEntry = sc.operand[2] - 1;
          this.scriptSuccess = false;
          break;
        }
        if (evtObj && current) {
          x = evtObj.x - current.x;
          y = evtObj.y - current.y;
          if (Math.abs(x) + Math.abs(y * 2) >= sc.operand[1] * 32 + 16) {
             scriptEntry = sc.operand[2] - 1;
             this.scriptSuccess = false;
          }
        }
        break;
      case 0x0084:
        log.debug('[SCRIPT] Place the item which player used as an event object to the scene');
        var placementEventRange = this.getSceneEventRange();
        if (sc.operand[0] <= placementEventRange.startIndex
            || sc.operand[0] > placementEventRange.endIndex) {
          // The event object is not in the current scene
          scriptEntry = sc.operand[2] - 1;
          this.scriptSuccess = false;
          break;
        }
        x = PAL_X(getViewportSnapshot()) + PAL_X(getPartyOffsetSnapshot());
        y = PAL_Y(getViewportSnapshot()) + PAL_Y(getPartyOffsetSnapshot());
        var partyDirPlacement = this.getPartyDirection();
        x += ((partyDirPlacement == Direction.West || partyDirPlacement == Direction.South) ? -16 : 16);
        y += ((partyDirPlacement == Direction.West || partyDirPlacement == Direction.North) ? -8 : 8);
        if (scene.checkObstacle(PAL_XY(x, y), false, 0)) {
          scriptEntry = sc.operand[2] - 1;
          this.scriptSuccess = false;
        } else {
          if (current) {
            current.x = WORD(x);
            current.y = WORD(y);
            current.state = SHORT(sc.operand[1]);
          }
        }
        break;
      case 0x0085:
        log.debug('[SCRIPT] Delay for a period');
        if (this.manualExecution) this.captureDelay(scriptEntry,sc.operand[0]*80);
        // SDLPAL just waits (UTIL_Delay): nothing is redrawn, so whatever is on screen
        // (an FBP picture, a dialog box) stays and party gestures do not change.
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await sleep(sc.operand[0] * 80)));
        break;
      case 0x0086:
        log.debug('[SCRIPT] Jump if the specified item is not equipped');
        // Jump unless the party has at least operand[1] (default 1) of the item equipped.
        if (this.countEquipped(sc.operand[0]) < (sc.operand[1] || 1)) {
          scriptEntry = sc.operand[2] - 1;
        }
        break;
      case 0x0087:
        if (shouldDebugScript()) {
          log.debug('[SCRIPT] Animate the event object');
        }
        this.NPCWalkOneStep(curEventObjectID, 0);
        break;
      case 0x0088:
        log.debug('[SCRIPT] Set the base damage of magic according to amount of money'); // 扔钱。。
        var currentCash = worldService.getCash();
        i = (currentCash > 5000) ? 5000 : currentCash;
        worldService.adjustCash(-i);
        j = this.getMagicNumberFromObject(sc.operand[0]);
        worldService.mutateMagicTable((magicData: any) => {
          if (magicData && magicData[j]) {
            magicData[j].baseDamage = Math.floor(i * 2 / 5);
          }
        });
        break;
      case 0x0089:
        log.debug('[SCRIPT] Set the battle result');
        battleService.setBattleResult(sc.operand[0]);
        break;
      case 0x008A:
        log.debug('[SCRIPT] Enable Auto-Battle for next battle');
        worldService.setAutoBattle(true);
        break;
      case 0x008B:
        log.debug('[SCRIPT] change the current palette');
        worldService.setPaletteId(sc.operand[0]);
        if (!shouldFadeIn()) {
          // PAL_SetPalette(n, FALSE): the day colours of the palette.
          this.surface?.setPalette(Palette.get(getPaletteIdSnapshot()).day);
        }
        break;
      case 0x008C:
        log.debug('[SCRIPT] Fade from/to color');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.colorFade(sc.operand[1], sc.operand[0], sc.operand[2]))));
        worldService.setNeedToFadeIn(false);
        break;
      case 0x008D:
        log.debug('[SCRIPT] Increase player\'s level');
        this.playerLevelUp(eventObjectID, sc.operand[0]);
        break;
      case 0x008F:
        log.debug('[SCRIPT] Halve the cash amount');
        var halvedCash = Math.trunc(worldService.getCash() / 2);
        worldService.setCash(halvedCash);
        break;
      case 0x0090:
        log.debug('[SCRIPT] Set the object script');
        worldService.setObjectScriptValue(sc.operand[0], 2 + sc.operand[2], sc.operand[1]);
        break;
      case 0x0091:
        // SDLPAL: jump if the enemy is not the first of its kind (not "not alone").
        log.debug('[SCRIPT] Jump if the enemy is not first of same kind');
        if (this.isInBattle()) {
          var battleState = this.BATTLE();
          var enemies = (battleState && battleState.enemy) || [];
          var selfEnemy = enemies[eventObjectID];
          var sameKindBefore = 0;
          if (selfEnemy) {
            for (i = 0; i < eventObjectID && i <= battleState.maxEnemyIndex; i++) {
              if (enemies[i] && enemies[i].objectID === selfEnemy.objectID) {
                sameKindBefore++;
              }
            }
          }
          if (sameKindBefore > 0) {
            scriptEntry = sc.operand[0] - 1;
          }
        }
        break;
      case 0x0092:
        log.debug('[SCRIPT] Show a magic-casting animation for a player in battle');
        if (this.isInBattle()) {
          if (sc.operand[0] !== 0) {
            const playerIndex = sc.operand[0] - 1;
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.showPlayerPreMagicAnim(playerIndex, false))));
            battleService.setPlayer(playerIndex, function(player: any) {
              if (player) {
                player.currentFrame = 6;
              }
              return player;
            });
          }

          for (i = 0; i < 5; i++) {
            var partyMax = getMaxPartyMemberIndexValue();
            for (j = 0; j <= partyMax; j++) {
              battleService.setPlayerColorShift(j, i * 2);
            }
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.delay(1, 0, true))));
          }
          battleService.backupScene();
          battleService.updateFighters();
          battleService.makeScene();
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.fadeScene())));
        }
        break;
      case 0x0093:
        log.debug('[SCRIPT] Fade the screen. Update scene in the process.');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.sceneFade(getPaletteIdSnapshot(), isNightPaletteEnabled(), SHORT(sc.operand[0]))));
        worldService.setNeedToFadeIn((SHORT(sc.operand[0]) < 0));
        break;
      case 0x0094:
        log.debug('[SCRIPT] Jump if the state of event object is the specified one');
        if (current && SHORT(current.state) === SHORT(sc.operand[1])) {
           scriptEntry = sc.operand[2] - 1;
        }
        break;
      case 0x0095:
        log.debug('[SCRIPT] Jump if the current scene is the specified one');
        if (getSceneIdSnapshot() === sc.operand[0]) {
          scriptEntry = sc.operand[1] - 1;
        }
        break;
      case 0x0096:
        log.debug('[SCRIPT] Show the ending animation');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(ending.endingAnimation())));
        break;
      case 0x0097:
        if(this.manualExecution && frame){await this.runManualPartyMotion(frame,sc,eventObjectID);break;}
        log.debug('[SCRIPT] Ride the event object to the specified position, at a higher speed');
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await this.partyRideEventObject(eventObjectID, sc.operand[0], sc.operand[1], sc.operand[2], 8)))
        break;
      case 0x0098:
        log.debug('[SCRIPT] Set follower of the party');
        // SDLPAL handles two followers: operand[i] goes to party slot max + i + 1 and starts at trail[3 + i].
        j = 0;
        for (let followerSlot = 0; followerSlot < 2; followerSlot++) {
          const followerRole = sc.operand[followerSlot];
          if (!(followerRole > 0)) {
            continue;
          }
          const curFollower = j = followerSlot + 1;
          worldService.setFollowerCount(curFollower);
          const followerIndex = getMaxPartyMemberIndexValue() + curFollower;
          worldService.mutatePartyMember(followerIndex, (member: any) => {
            if (!member) {
              return member;
            }
            member.playerRole = followerRole;
            return member;
          });
          res.setLoadFlags(LoadFlag.PlayerSprite);
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(res.loadResources())));
          // Update the position and gesture for the follower
          worldService.mutatePartyMember(followerIndex, (member: any) => {
            if (!member) {
              return member;
            }
            const trail = worldService.getTrail() as any;
            const followerTrail = trail && trail[3 + followerSlot];
            if (!followerTrail) {
              return member;
            }
            member.x = followerTrail.x - PAL_X(getViewportSnapshot());
            member.y = followerTrail.y - PAL_Y(getViewportSnapshot());
            member.frame = followerTrail.direction * 3;
            return member;
          });
        }
        if (j === 0) {
          worldService.setFollowerCount(0);
        }
        break;
      case 0x0099:
        log.debug('[SCRIPT] Change the map for the specified scene');
        if (sc.operand[0] == 0xFFFF) {
          var currentSceneId = getSceneIdSnapshot();
          worldService.mutateSceneEntry(currentSceneId, (entry: any) => {
            if (entry) {
              entry.mapNum = sc.operand[1];
            }
            return entry;
          });
          res.setLoadFlags(LoadFlag.Scene);
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(res.loadResources())));
        } else {
          worldService.mutateSceneEntry(sc.operand[0], (entry: any) => {
            if (entry) {
              entry.mapNum = sc.operand[1];
            }
            return entry;
          });
        }
        break;
      case 0x009A:
        log.debug('[SCRIPT] Set the state for multiple event objects');
        if (!Number.isFinite(sc.operand[0]) || !Number.isFinite(sc.operand[1])) {
          break;
        }
        var startId = Math.trunc(sc.operand[0]);
        var endId = Math.trunc(sc.operand[1]);
        if (endId < startId) {
          break;
        }
        for (var rangeId = startId; rangeId <= endId; rangeId++) {
          if (rangeId <= 0) {
            continue;
          }
          worldService.mutateEventObjectById(rangeId, (target: any) => {
            if (!target) {
              return target;
            }
            target.state = SHORT(sc.operand[2]);
            return target;
          });
        }
        break;
      case 0x009B:
        log.debug('[SCRIPT] Fade to the current scene');
        debugBgEvent('script-fade-current-scene', { speed: 2 });
        const fadeCurrentOverlay = clearFbpOverlay('fade-current-scene');
        this.surface?.backupScreen();
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(scene.makeScene())));
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(this.surface?.fadeScreen(2))));
        markBgDirty('fade-current-scene');
        restoreOverlayMode(fadeCurrentOverlay);
        break;
      case 0x009C:
        log.debug('[SCRIPT] Enemy duplicate itself');
        ret = this.BATTLE();
        w = 0;
        for (i = 0; i <= ret.maxEnemyIndex; i++) {
          if (ret.enemy[i] && ret.enemy[i].objectID !== 0) {
            w++;
          }
        }
        // Division only works with a single enemy left that still has more than 1 HP.
        // (SDLPAL checks rgEnemy[wCurEventObjectID], i.e. the slot named by operand[0], which
        // is the clone count here; the dividing enemy itself is what is meant.)
        var dividing = ret.enemy[eventObjectID];
        if (w !== 1 || !dividing || !dividing.e || dividing.e.health <= 1) {
          if (sc.operand[1] !== 0) {
            scriptEntry = sc.operand[1] - 1;
          }
          break;
        }
        w = sc.operand[0] || 1;
        x = w + 1;
        y = w;
        var dividedHealth = Math.floor((dividing.e.health + y) / x);
        for (i = 0; i < Const.MAX_ENEMIES_IN_TEAM; i++) {
          var slot = ret.enemy[i];
          if (w > 0 && slot && slot.objectID === 0) {
            w--;
            battleService.cloneEnemy(i, eventObjectID, { timeMeter: 50 });
            battleService.setEnemy(i, function(enemy: any) {
              enemy.e.health = dividedHealth;
              return enemy;
            });
          }
        }
        battleService.setEnemy(eventObjectID, function(enemy: any) {
          enemy.e.health = dividedHealth;
          return enemy;
        });
        battleService.recalculateMaxEnemyIndex();
        battleService.loadBattleSprites();
        ret = this.BATTLE();
        var divisionOrigin = ret.enemy[eventObjectID].pos;
        for (i = 0; i <= ret.maxEnemyIndex; i++) {
          if (ret.enemy[i].objectID !== 0) {
            battleService.setEnemyPosition(i, divisionOrigin);
          }
        }
        // Slide every enemy halfway back to its formation position, ten times.
        for (i = 0; i < 10; i++) {
          for (j = 0; j <= ret.maxEnemyIndex; j++) {
            var fighter = ret.enemy[j];
            x = Math.trunc((PAL_X(fighter.pos) + PAL_X(fighter.originalPos)) / 2);
            y = Math.trunc((PAL_Y(fighter.pos) + PAL_Y(fighter.originalPos)) / 2);
            battleService.setEnemyPosition(j, PAL_XY(x, y));
          }
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.delay(1, 0, true))));
        }
        battleService.updateFighters();
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.delay(1, 0, true))));
        break;
      case 0x009E:
        log.debug('[SCRIPT] Enemy summons another monster');
        ret = this.BATTLE();
        var summoner = ret.enemy[eventObjectID];
        if (!summoner || !summoner.e) {
          break;
        }
        for (i = 0; i < summoner.e.magicFrames; i++) {
          battleService.setEnemyFrame(eventObjectID, summoner.e.idleFrames + i);
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.delay(summoner.e.actWaitFrames, 0, false))));
        }
        x = 0;
        w = sc.operand[0];
        y = SHORT(sc.operand[1]) <= 0 ? 1 : SHORT(sc.operand[1]);
        if (w === 0 || w === 0xFFFF) {
          w = summoner.objectID;
        }
        for (i = 0; i <= ret.maxEnemyIndex; i++) {
          if (ret.enemy[i].objectID === 0) {
            x++;
          }
        }
        if (x < y || ret.hidingTime > 0 ||
            summoner.status[PlayerStatus.Sleep] !== 0 ||
            summoner.status[PlayerStatus.Paralyzed] !== 0 ||
            summoner.status[PlayerStatus.Confused] !== 0) {
          if (sc.operand[2] !== 0) {
            scriptEntry = sc.operand[2] - 1;
          }
          break;
        }
        for (i = 0; i <= ret.maxEnemyIndex; i++) {
          if (ret.enemy[i].objectID === 0) {
            battleService.spawnEnemy(i, w, { timeMeter: 50, colorShift: 8 });
            y--;
            if (y <= 0) {
              break;
            }
          }
        }
        battleService.backupScene();
        battleService.loadBattleSprites();
        battleService.makeScene();
        sound.play(212);
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.fadeScene())));
        // Let the summon gesture finish before the new enemies lose their highlight.
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.delay(2, 0, true))));
        for (i = 0; i <= ret.maxEnemyIndex; i++) {
          battleService.setEnemyColorShift(i, 0);
        }
        battleService.backupScene();
        battleService.makeScene();
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.fadeScene())));
        break;
      case 0x009F:
        log.debug('[SCRIPT] Enemy transforms into something else');
        ret = this.BATTLE();
        var transforming = ret.enemy[eventObjectID];
        if (!transforming || !transforming.e) {
          break;
        }
        if (ret.hidingTime <= 0 &&
            transforming.status[PlayerStatus.Sleep] === 0 &&
            transforming.status[PlayerStatus.Paralyzed] === 0 &&
            transforming.status[PlayerStatus.Confused] === 0) {
          w = transforming.e.health;
          var transformedTemplate = this.copyEnemyTemplate(this.getEnemyIdFromObject(sc.operand[0]));
          // Validate before replacing the original enemy or starting the animation.
          if (!transformedTemplate) break;
          battleService.setEnemy(eventObjectID, function(enemy: any) {
            enemy.objectID = sc.operand[0];
            enemy.e = transformedTemplate;
            enemy.e.health = w;
            enemy.currentFrame = 0;
            battleEnemyScriptRuntime.noteEnemyTransformed(frame,eventObjectID,enemy);
            battlePreBattleScriptRuntime.noteEnemyTransformed(frame,eventObjectID,enemy);
            battleEndScriptRuntime.noteEnemyTransformed(frame,eventObjectID,enemy);
            return enemy;
          });
          for (i = 0; i < 6; i++) {
            battleService.setEnemyColorShift(eventObjectID, i);
            this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.delay(1, 0, false))));
          }
          battleService.setEnemyColorShift(eventObjectID, 0);
          sound.play(47);
          battleService.backupScene();
          battleService.loadBattleSprites();
          battleService.makeScene();
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await co(battleService.fadeScene())));
        }
        break;
      case 0x00A0:
        log.debug('[SCRIPT] Quit game');
        // The Win95 ending screen is not shown in the DOS version.
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(ending.additionalCredits())));
        var gameInstance = (globalThis as any).game;
        if (gameInstance && typeof gameInstance.shutdown === 'function') {
          gameInstance.shutdown();
        }
        break;
      case 0x00A1:
        log.debug('[SCRIPT] Set the positions of all party members to the same as the first one');
        var leader = this.getPartyMember(0);
        if (leader) {
          var partyDirection = this.getPartyDirection();
          var viewport = getViewportSnapshot();
          var viewportX = PAL_X(viewport);
          var viewportY = PAL_Y(viewport);
          var leaderWorldX = leader.x + viewportX;
          var leaderWorldY = leader.y + viewportY;
          worldService.mutateTrail((trailState: any) => {
            if (!trailState) {
              return trailState;
            }
            for (var trailIndex = 0; trailIndex < Const.MAX_PLAYABLE_PLAYER_ROLES; trailIndex++) {
              var trailEntry = trailState[trailIndex];
              if (!trailEntry) {
                continue;
              }
              trailEntry.direction = partyDirection;
              trailEntry.x = leaderWorldX;
              trailEntry.y = leaderWorldY;
            }
            return trailState;
          });
          var leaderX = leader.x;
          var leaderY = leader.y;
          var maxPartyIndex = getMaxPartyMemberIndexValue();
          for (partyIndex = 1; partyIndex <= maxPartyIndex; partyIndex++) {
            worldService.mutatePartyMember(partyIndex, (member: any) => {
              if (!member) {
                return member;
              }
              member.x = leaderX;
              member.y = leaderY - 1;
              return member;
            });
          }
        }
        scene.updatePartyGestures(false);
        break;
      case 0x00A2:
        log.debug('[SCRIPT] Jump to one of the following instructions randomly');
        scriptEntry += randomLong(0, sc.operand[0] - 1);
        break;
      case 0x00A3:
        log.debug('[SCRIPT] Play CD music. Use the RIX music for fallback.');
        // No CD audio here: play the RIX fallback track, as SDLPAL does without a CD.
        music.play(sc.operand[1], true, 0);
        break;
      case 0x00A4:
        log.debug('[SCRIPT] Scroll FBP to the screen');
        if (sc.operand[0] == 0x44) {
          // 68号位图 拜月魔兽
          // 69号位图 洪水
          // HACKHACK: to make the ending picture show correctly
          this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(ending.showFBP(0x45, 0))));
        }
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(ending.scrollFBP(sc.operand[0], sc.operand[2], true))));
        this.surface?.backupScreen();
        markBgDirty('scroll-fbp');
        invalidateDialogBackup('scrollFBP');
        break;
      case 0x00A5:
        log.debug('[SCRIPT] Show FBP picture with sprite effects');
        if (sc.operand[1] != 0xFFFF) {
          ending.setEffectSprite(sc.operand[1]);
        }
        this.executionRuntime.resume(frame, (frame && (frame.status = 'waiting'), await resolveUiTask(ending.showFBP(sc.operand[0], sc.operand[2]))));
        this.surface?.backupScreen();
        markBgDirty('show-fbp-effects');
        invalidateDialogBackup('showFBP-effects');
        break;
      case 0x00A6:
        log.debug('[SCRIPT] backup screen');
        this.surface?.backupScreen();
        break;
      // TODO: Add remaining cases
      default:
        log.warn(`[SCRIPT] Invalid Instruction at ${scriptEntry}: (${sc.operation}(0x${sc.operation.toString(16)}) - ${sc.operand[0]}, ${sc.operand[1]}, ${sc.operand[2]})`);
        break;
    }

    return scriptEntry + 1;
  }

  public getPlayerAttackStrength(role: number) {
    let w = getPlayerAttackStrengthValue(role);
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      w += getEquipmentEffectScalarFromAdapter(i, 'attackStrength', role);
    }
    return w & 0xFFFF;   // WORD in SDLPAL: a negative bonus (0xFFFC = -4) wraps, it does not add 65532
  }

  public getPlayerMagicStrength(role: number) {
    let w = getPlayerMagicStrengthValue(role);
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      w += getEquipmentEffectScalarFromAdapter(i, 'magicStrength', role);
    }
    return w & 0xFFFF;   // WORD in SDLPAL: a negative bonus (0xFFFC = -4) wraps, it does not add 65532
  }

  public getPlayerDefense(role: number) {
    let w = getPlayerDefenseValue(role);
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      w += getEquipmentEffectScalarFromAdapter(i, 'defense', role);
    }
    return w & 0xFFFF;   // WORD in SDLPAL: a negative bonus (0xFFFC = -4) wraps, it does not add 65532
  }

  public getPlayerDexterity(role: number) {
    let w = getPlayerDexterityValue(role);
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      w += getEquipmentEffectScalarFromAdapter(i, 'dexterity', role);
    }
    return w & 0xFFFF;   // WORD in SDLPAL: a negative bonus (0xFFFC = -4) wraps, it does not add 65532
  }

  public getPlayerFleeRate(role: number) {
    let w = getPlayerFleeRateValue(role);
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      w += getEquipmentEffectScalarFromAdapter(i, 'fleeRate', role);
    }
    return w & 0xFFFF;   // WORD in SDLPAL: a negative bonus (0xFFFC = -4) wraps, it does not add 65532
  }

  public getPlayerPoisonResistance(role: number) {
    const roles = getPlayerRolesSnapshot() as any;
    let w = roles && roles.poisonResistance ? roles.poisonResistance[role] || 0 : 0;
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      w += getEquipmentEffectScalarFromAdapter(i, 'poisonResistance', role);
    }
    return Math.min(w & 0xFFFF, 100);   // WORD in SDLPAL: wrap first, then cap
  }

  public getPlayerElementalResistance(role: number, attr: number) {
    const base = getPlayerRolesSnapshot() as any;
    let w = base && base.elementalResistance && base.elementalResistance[attr]
      ? base.elementalResistance[attr][role] || 0
      : 0;
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      w += getEquipmentEffectElementalFromAdapter(i, attr, role);
    }
    w &= 0xFFFF;   // WORD in SDLPAL: wrap first, then cap
    if (w > 100) {
      w = 100;
    }
    return w;
  }

  public getPlayerBattleSprite(role: number) {
    const roles = getPlayerRolesSnapshot() as any;
    let w = roles && roles.spriteNumInBattle ? roles.spriteNumInBattle[role] || 0 : 0;
    // A non-zero effect replaces the sprite (it is not added).
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      const sprite = getEquipmentEffectScalarFromAdapter(i, 'spriteNumInBattle', role);
      if (sprite) {
        w = sprite;
      }
    }
    return w;
  }

  public getPlayerCooperativeMagic(role: number) {
    const roles = getPlayerRolesSnapshot() as any;
    let w = roles && roles.cooperativeMagic ? roles.cooperativeMagic[role] || 0 : 0;
    for (let i = 0; i <= Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      const effect = getEquipmentEffectValue(i);
      if (effect && effect.cooperativeMagic && effect.cooperativeMagic[role]) {
        w = effect.cooperativeMagic[role];
      }
    }
    return w;
  }

  public playerCanAttackAll(role: number) {
    let w = false;
    for (let i = 0; i < Const.MAX_PLAYER_EQUIPMENTS; ++i) {
      const effect = getEquipmentEffectValue(i);
      if (effect && effect.attackAll) {
        if (effect.attackAll[role]) {
          w = true;
          break;
        }
      }
    }
    return w;
  }

  private countEquipped(objectId: number) {
    let count = 0;
    this.forEachPartyMember((member: any) => {
      for (let j = 0; j < Const.MAX_PLAYER_EQUIPMENTS; j++) {
        if (getPlayerEquipmentFromAdapter(j, member.playerRole) === objectId) {
          count++;
        }
      }
    });
    return count;
  }

  // PAL_CountItem: inventory amount plus copies equipped by party members.
  public countItem(objectId: number) {
    if (!objectId) {
      return 0;
    }
    return this.getItemAmount(objectId) + this.countEquipped(objectId);
  }

  // PAL_GetItemAmount: inventory slots are { item, amount, amountInUse } and end at the first empty one.
  public getItemAmount(objectId: number) {
    const items = inventorySignals().items.value;
    if (!Array.isArray(items)) return 0;
    for (let i = 0; i < items.length; ++i) {
      const slot = items[i] as any;
      if (!slot || !slot.item) {
        break;
      }
      if (slot.item === objectId) {
        return slot.amount || 0;
      }
    }
    return 0;
  }

  // PAL_GetItemIndexToInventory: slot index of the item, or -1 (the search stops at the first empty slot).
  private findInventorySlot(objectId: number) {
    const items = inventorySignals().items.value;
    if (!Array.isArray(items)) return -1;
    for (let i = 0; i < items.length && i < Const.MAX_INVENTORY; ++i) {
      const slot = items[i] as any;
      const item = slot ? slot.item || 0 : 0;
      if (item === objectId) {
        return i;
      }
      if (item === 0) {
        break;
      }
    }
    return -1;
  }

  public isPlayerPoisonedByKind(role: number, poisonID: number) {
    const partyIndex = this.partyIndexOfRole(role);
    if (partyIndex < 0) {
      return false;
    }
    for (let i = 0; i < Const.MAX_POISONS; ++i) {
      const entry = this.readPoisonEntry(i, partyIndex);
      if (entry && entry.poisonID === poisonID) {
        return true;
      }
    }
    return false;
  }
}

const uiFallback: any = {
  setDialogDelayTime: (time: number) => {},
  clearDialog: (force: boolean) => Promise.resolve(),
  invalidateDialogBackup: (_reason?: string) => {},
  dialogIsPlayingRNG: () => false,
  setDialogShadow: (_offset: number) => {},
  startDialog: (pos: number, head: number, text: number, auto: boolean) => {},
  showDialogText: (text: string) => Promise.resolve(),
  endDialog: () => Promise.resolve(),
  getMsg: (id: number) => "",
  getWord: (id: number) => ""
};

// Use real UI module if it has been initialized on globalThis.
const ui: any = new Proxy(uiFallback, {
  get(target, prop) {
    const real = (globalThis as any).ui;
    if (real && typeof real[prop] !== 'undefined') {
      return real[prop];
    }
    return (target as any)[prop];
  },
  set(target, prop, value) {
    const real = (globalThis as any).ui;
    if (real && typeof real === 'object') {
      (real as any)[prop] = value;
      return true;
    }
    (target as any)[prop] = value;
    return true;
  }
});

export default new ScriptRunner();

export type { ScriptRunner };
