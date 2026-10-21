import {validateGeneratedDialogCursor,generatedDialogWait,type GeneratedDialogCursor,type GeneratedDialogWait} from './script-generated-dialog-cursor';
import {validateEndingAnimationCursor,type EndingAnimationCursor} from './script-ending-animation-cursor';
import {validateEndingScrollCursor,type EndingScrollCursor} from './script-ending-scroll-cursor';
import {validateEndingClockDescriptor,type EndingClockDescriptor} from './ending-clock-reference-leases';
import {validateEndingShowCursor,type EndingShowCursor} from './script-ending-show-cursor';
import {validateScreenFadeSource,type ScreenFadeSource} from './script-screen-fade-cursor';
import {validateRngCursor,type RngCursor} from './script-rng-cursor';
import {validateSceneFadeCursor,type SceneFadeCursor} from './script-scene-fade-cursor';
import {validateComposeCursor,composeOwnerMatches,type ComposeCursor} from './script-compose-cursor';
import {validateTimedFadeArgs,validateTimedFadeCursor,validateFadeOpcodeCursor,type TimedFadeArgs,type TimedFadeCursor,type FadeOpcodeCursor} from './script-timed-fade-cursor';
import {validatePaletteCursor,type PaletteCursor} from './script-palette-cursor';
import {validateRedrawCursor,type RedrawCursor} from './script-redraw-cursor';
import {validatePartyMotionCursor,type PartyMotionCursor} from './script-party-motion-cursor';
import {sameJsonValue} from './script-json-value';
import {validateNpcMotionCursor,type NpcMotionCursor} from './script-npc-motion-cursor';
import {validateShopCursor,shopMenu,type ShopCursor,type ShopMenuWait} from './script-shop-cursor';
import {validateDialogContext,type DialogContext,type DialogAction,type DialogTimeWait} from './script-dialog-progress';
import {validateInputWait,type ScriptInputWait} from './script-input-wait';
import {validateEquipmentCursor,validatePartyEquipmentCursor,type EquipmentCursor,type EquipmentPending,type PartyEquipmentCursor} from './script-equipment-cursor';
import {validatePoisonCursor,type PoisonCursor,type PoisonPending} from './script-poison-cursor';
import {validateWorldUpdateCursor,type FrameWaitCursor,type WorldUpdateCursor,type WorldCompositionSelection} from './world-update-cursor';
interface ChildReturnBase {
  opcodePC:number; nextPC:number; childEntry:number; childEventId:number;
}
export interface GeneratedDialogComposeReturn {kind:'generated-dialog-compose-fade';opcodePC:number;nextPC:number;ownerKind:'trigger'|'auto';site:'preclear'|'generated';poll:number;frameIndex:number;phase:'compose';args:TimedFadeArgs}
export interface TeleportChildReturn extends ChildReturnBase {kind:'teleport-child';operation:0x38;operands:number[];selectedScene:number;effectiveEventId:number;returnPolicy:'discard'}
export type ScriptParentReturn = TeleportChildReturn | GeneratedDialogComposeReturn | {kind:'ending-animation-fade';opcodePC:number;nextPC:number;frameIndex:number;girlPos:number;args:TimedFadeArgs} | {kind:'ending-scroll-fade';opcodePC:number;nextPC:number;frameIndex:number;args:TimedFadeArgs} | {kind:'rng-fade';opcodePC:number;nextPC:number;args:TimedFadeArgs} | {kind:'world-compose-fade';opcodePC:number;nextPC:number;args:TimedFadeArgs;selection:WorldCompositionSelection} | {kind:'compose-fade';opcodePC:number;nextPC:number;args:TimedFadeArgs} | {kind:'fade';opcodePC:number;nextPC:number;args:TimedFadeArgs;needFade:boolean} | {kind:'equipment-item'} & EquipmentPending | {kind:'party-equipment';opcodePC:number;nextPC:number} | ChildReturnBase & (
  {kind?:never} |
  {kind:'auto-tail'} |
  ({kind:'poison'} & PoisonPending) |
  {kind:'world-update';childKind:'trigger'|'auto';field:'scriptOnEnter'|'triggerScript'|'autoScript';sceneId:number;eventId:number;nextPhase:WorldUpdateCursor['phase']}
);
/** Serializable VM state only; the caller restores matching world and script data separately. */
interface CheckpointFrameBase {
  currentPC:number;continuationPC:number;eventId:number;loopSafetyCounter:number;
  parentReturn:null|ScriptParentReturn;
  generatedDialog?:GeneratedDialogCursor;
  generatedNativeEnd?:{sourcePC:number;sourceEventId:number;sourceKind:'trigger'|'auto'};
  dialogAction?:DialogAction;
  compose?:ComposeCursor;
  sceneFade?:SceneFadeCursor;
  endingAnimation?:EndingAnimationCursor;
  endingScroll?:EndingScrollCursor;
  endingShow?:EndingShowCursor;
  screenFade?:ScreenFadeSource;
  rng?:RngCursor;
  redraw?:RedrawCursor;
  palette?:PaletteCursor;
  timedFade?:TimedFadeCursor;
  fadeArgs?:TimedFadeArgs;
  fadeSource?:FadeOpcodeCursor;
  shopCursor?:ShopCursor;
  motion?:PartyMotionCursor;
  npcMotion?:NpcMotionCursor;
}
/** A helper is an execution context, never a script instruction. */
export type DelayCheckpointFrame = CheckpointFrameBase & (
  {kind:'fade';fadeArgs:TimedFadeArgs;timedFade:TimedFadeCursor;equipmentCursor?:never;frameWait?:never;poisonCursor?:never;partyEquipmentCursor?:never} |
  {kind:'equipment';equipmentCursor:EquipmentCursor;frameWait?:never;poisonCursor?:never;partyEquipmentCursor?:never} |
  {kind:'trigger'|'auto';equipmentCursor?:never;frameWait?:FrameWaitCursor;poisonCursor?:PoisonCursor;partyEquipmentCursor?:PartyEquipmentCursor}
);
export interface DelayWaitDescriptor {
  opcodePC:number; nextPC:number; requestedMs:number; remainingMs:number;
}
export type ScriptWaitDescriptor = GeneratedDialogWait | ({kind:'ending-animation';frameIndex:number} & DelayWaitDescriptor) | ({kind:'ending-scroll';frameIndex:number} & DelayWaitDescriptor) | ({kind:'ending-show';step:number} & DelayWaitDescriptor) | ({kind:'screen-fade';substep:number} & DelayWaitDescriptor) | ({kind:'rng'} & RngCursor) | ({kind:'scene-fade'} & SceneFadeCursor) | ({kind:'timed-fade'} & TimedFadeCursor) | ({kind:'palette'} & PaletteCursor) | ({kind:'redraw'} & RedrawCursor) | ({kind:'party-motion'} & PartyMotionCursor) | ({kind:'npc-motion'} & NpcMotionCursor) | ({kind:'frame'} & FrameWaitCursor) | ({kind:'delay'} & DelayWaitDescriptor) | ScriptInputWait | DialogTimeWait | ShopMenuWait;
interface CheckpointBase {
  clock?:EndingClockDescriptor;
  id:string; revision:number;
  registers:{scriptSuccess:boolean;curEquipPart:number};
  frames:DelayCheckpointFrame[];
  dialog?:DialogContext;
}
export type ScriptDelayCheckpoint = CheckpointBase & (
  {version:1;delay:DelayWaitDescriptor;wait?:never} |
  {version:2;wait:ScriptWaitDescriptor;delay?:never}
);
export type ScriptExecutionOutcome = {status:'completed';nextEntry:number;dialog?:DialogContext} | {status:'suspended';checkpoint:ScriptDelayCheckpoint} | {status:'unsupported';reason:string};
const integer = (v:unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const validInstruction = (sc:any): boolean => !!sc && integer(sc.operation) && sc.operation <= 0xffff && !!sc.operand && sc.operand.length >= 3 && Array.from(sc.operand).every(v => integer(v) && v <= 0xffff);
export function validateDelayCheckpoint(value: unknown, read: (pc:number)=>any, readObject?: (itemId:number)=>any): string | null {
  const c = value as ScriptDelayCheckpoint;
  if (!c || (c.version !== 1 && c.version !== 2) || typeof c.id !== 'string' || !c.id || !integer(c.revision) || c.revision === Number.MAX_SAFE_INTEGER) return 'Invalid checkpoint identity or version';
  if(c.clock!==undefined && !validateEndingClockDescriptor(c.clock))return 'Invalid ending clock descriptor';
  if (!c.registers || typeof c.registers.scriptSuccess !== 'boolean' || !Number.isInteger(c.registers.curEquipPart) || c.registers.curEquipPart < -1 || c.registers.curEquipPart > 6) return 'Invalid checkpoint registers';
  if(c.dialog && (c.version!==2 || !validateDialogContext(c.dialog)))return 'Invalid dialog context';
  if (!Array.isArray(c.frames) || !c.frames.length || Object.keys(c.frames).length!==c.frames.length) return 'Invalid checkpoint frames';
  for(let i=0;i<c.frames.length-1;i++)if(['generated-dialog-compose-fade','ending-animation-fade','ending-scroll-fade','rng-fade','fade','compose-fade','world-compose-fade'].includes(c.frames[i]?.parentReturn?.kind as string) && c.frames[i+1]?.kind!=='fade')return 'Invalid fade helper child kind';
  for (let i=0;i<c.frames.length;i++) {
    const f=c.frames[i];
    if(!f) return 'Invalid checkpoint frame';
    if(f.kind==='fade') {
      if(c.version!==2 || i!==c.frames.length-1 || f.currentPC!==0 || f.continuationPC!==0 || f.eventId!==0 || f.loopSafetyCounter!==0 || !validateTimedFadeArgs(f.fadeArgs) || !validateTimedFadeCursor(f.timedFade,f.fadeArgs) || f.parentReturn!==null)return 'Invalid fade helper frame';
    } else if(f.kind==='equipment') {
      if(c.version!==2 || f.currentPC!==0 || f.continuationPC!==0 || f.eventId!==0 || f.loopSafetyCounter!==0 || f.frameWait || f.poisonCursor || f.partyEquipmentCursor || !validateEquipmentCursor(f.equipmentCursor) || !f.equipmentCursor.pending) return 'Invalid equipment helper frame';
    } else if ((f.kind !== 'trigger' && f.kind !== 'auto') || f.equipmentCursor || ![f.currentPC,f.continuationPC,f.eventId,f.loopSafetyCounter].every(integer) || f.eventId > 0xffff || f.loopSafetyCounter > 1000 || !validInstruction(read(f.currentPC)) || (f.continuationPC !== 0 && !(f.dialogAction?.phase==='terminal' && f.dialogAction.operation===1 && f.continuationPC===f.currentPC+1) && !validInstruction(read(f.continuationPC)))) return 'Invalid checkpoint frame';
  }
  // All frame-owned state is validated before any wait-specific early return.
  for(const [i,f] of c.frames.entries())if(f.compose!==undefined) {
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !f.compose || !validateComposeCursor(f.compose,read(f.currentPC),f.currentPC) || !composeOwnerMatches(f) || i===c.frames.length-1 || f.parentReturn?.kind!==(f.compose.source==='generated-dialog-poll'?'generated-dialog-compose-fade':f.compose.source.startsWith('world-')?'world-compose-fade':'compose-fade') || f.kind==='auto'&&f.continuationPC!==f.currentPC)return 'Invalid composition cursor';
  }

  for(const [index,f] of c.frames.entries()) {
    if(['generatedDialog','endingAnimation','endingScroll','endingShow','screenFade','rng','sceneFade','compose','timedFade','fadeSource','palette','redraw','motion','npcMotion','frameWait','poisonCursor','partyEquipmentCursor','equipmentCursor','shopCursor','dialogAction'].some(key=>(f as any)[key]!==undefined && (!(f as any)[key] || typeof (f as any)[key]!=='object' || Array.isArray((f as any)[key]))))return 'Invalid present frame cursor';
    const active=[f.generatedDialog,f.endingAnimation,f.endingScroll,f.endingShow,f.screenFade,f.rng,f.sceneFade,f.compose,f.timedFade,f.fadeSource,f.palette,f.redraw,f.motion,f.npcMotion,f.frameWait,f.poisonCursor,f.partyEquipmentCursor,f.equipmentCursor,f.shopCursor,f.dialogAction].filter(x=>x!==undefined);
    const boundClear=f.dialogAction?.phase==='clear' && (f.fadeSource?.phase==='clear' && f.dialogAction.operation===f.fadeSource.operation || f.redraw?.phase==='clear' && f.dialogAction.operation===5 || f.palette?.phase==='clear' && f.dialogAction.operation===f.palette.operation);
    if(active.length>(boundClear || f.compose && composeOwnerMatches(f)?2:1) || (index===c.frames.length-1 && active.length && c.dialog?.cursor))return f.npcMotion!==undefined?'Invalid NPC motion cursor: simultaneous active cursors':'Simultaneous active frame cursors';
    if(f.motion!==undefined) {
      const m=f.motion,wait=c.version===2?c.wait:null;
      if(c.version!==2 || f.kind==='equipment' || !validatePartyMotionCursor(m,read(f.currentPC),f.currentPC,f.eventId) || (f.kind==='auto' && f.continuationPC!==f.currentPC))return 'Invalid party motion cursor';
      if(index===c.frames.length-1 ? !wait || wait.kind!=='party-motion' || m.phase!=='sleep' || Object.keys(m).some(k=>!sameJsonValue((wait as any)[k],(m as any)[k])) : f.compose ? !composeOwnerMatches(f) : m.phase!=='world' || f.parentReturn?.kind!=='world-update')return 'Invalid party motion ownership';
    }
  }
  for(const [i,f] of c.frames.entries()) {
    if(f.kind==='fade') {
      if(f.generatedDialog || f.endingAnimation || f.endingScroll || f.endingShow || f.screenFade || f.rng || f.sceneFade || f.compose || f.fadeSource || f.palette || f.redraw || f.motion || f.npcMotion || f.frameWait || f.poisonCursor || f.partyEquipmentCursor || f.equipmentCursor || f.shopCursor || f.dialogAction || c.dialog?.cursor || c.version!==2 || c.wait?.kind!=='timed-fade' || !sameJsonValue(c.wait,{kind:'timed-fade',...f.timedFade}))return 'Invalid fade helper ownership';
    } else if(f.timedFade!==undefined || f.fadeArgs!==undefined)return 'Timed fade requires a helper frame';
    if(f.fadeSource!==undefined) {
      if(c.version!==2 || (f.kind!=='trigger' && f.kind!=='auto') || !validateFadeOpcodeCursor(f.fadeSource,read(f.currentPC),f.currentPC) || (f.kind==='auto' && f.continuationPC!==f.currentPC))return 'Invalid fade source';
      if(f.fadeSource.phase==='clear' ? i!==c.frames.length-1 || !f.dialogAction || c.wait?.kind!=='input' || c.wait.action!=='dialog' || c.wait.phase!=='clear' : i===c.frames.length-1 || f.parentReturn?.kind!=='fade')return 'Invalid fade source ownership';
    }
  }
  for(const f of c.frames)if(f.generatedNativeEnd!==undefined) {
    const n=f.generatedNativeEnd;
    if(f.kind!=='trigger'||!n||Object.keys(n).length!==3||!Object.keys(n).every(k=>['sourcePC','sourceEventId','sourceKind'].includes(k))||!integer(n.sourcePC)||!integer(n.sourceEventId)||n.sourceEventId>65535||!['trigger','auto'].includes(n.sourceKind)||read(n.sourcePC)?.operation!==0x34)return 'Invalid generated native terminal ownership';
  }
  for(const [i,f] of c.frames.entries())if(f.generatedDialog!==undefined) {
    const q=f.generatedDialog;
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !validateGeneratedDialogCursor(q,read(f.currentPC),f.currentPC,f.kind,f.eventId) || q.lease.owner!==c.id || f.kind==='auto'&&f.continuationPC!==f.currentPC || f.dialogAction)return 'Invalid generated dialog source';
    if(i===c.frames.length-1 ? q.phase!=='poll-sleep'||!sameJsonValue(c.wait,generatedDialogWait(q)) : q.phase!=='compose'||!f.compose||!composeOwnerMatches(f)||f.parentReturn?.kind!=='generated-dialog-compose-fade')return 'Invalid generated dialog ownership';
  }
  if(c.version===2&&c.wait?.kind==='generated-dialog'&&!c.frames[c.frames.length-1].generatedDialog)return 'Missing generated dialog source';
  for(const [i,f] of c.frames.entries())if(f.endingAnimation!==undefined) {
    const q=f.endingAnimation,w=c.version===2?c.wait:null;
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !validateEndingAnimationCursor(q,read(f.currentPC),f.currentPC) || f.kind==='auto'&&f.continuationPC!==f.currentPC || f.dialogAction)return 'Invalid ending animation source';
    if(i===c.frames.length-1 ? q.phase!=='sleep'||!sameJsonValue(w,{kind:'ending-animation',opcodePC:q.opcodePC,nextPC:q.nextPC,frameIndex:q.frameIndex,requestedMs:q.requestedMs,remainingMs:q.remainingMs}) : q.phase!=='fade'||f.parentReturn?.kind!=='ending-animation-fade')return 'Invalid ending animation ownership';
  }
  if(c.version===2&&c.wait?.kind==='ending-animation'&&!c.frames[c.frames.length-1].endingAnimation)return 'Missing ending animation source';
  for(const [i,f] of c.frames.entries())if(f.endingScroll!==undefined) {
    const q=f.endingScroll,w=c.version===2?c.wait:null;
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !validateEndingScrollCursor(q,read(f.currentPC),f.currentPC) || f.kind==='auto'&&f.continuationPC!==f.currentPC || f.dialogAction)return 'Invalid ending scroll source';
    if(i===c.frames.length-1 ? q.phase!=='sleep'||!sameJsonValue(w,{kind:'ending-scroll',opcodePC:q.opcodePC,nextPC:q.nextPC,frameIndex:q.frameIndex,requestedMs:q.requestedMs,remainingMs:q.remainingMs}) : q.phase!=='fade'||f.parentReturn?.kind!=='ending-scroll-fade')return 'Invalid ending scroll ownership';
  }
  if(c.version===2&&c.wait?.kind==='ending-scroll'&&!c.frames[c.frames.length-1].endingScroll)return 'Missing ending scroll source';
  for(const [i,f] of c.frames.entries())if(f.endingShow!==undefined) {
    const q=f.endingShow,w=c.version===2?c.wait:null;
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !validateEndingShowCursor(q,read(f.currentPC),f.currentPC) || f.kind==='auto'&&f.continuationPC!==f.currentPC || f.dialogAction)return 'Invalid ending show source';
    if(i!==c.frames.length-1 || !sameJsonValue(w,{kind:'ending-show',opcodePC:q.opcodePC,nextPC:q.nextPC,step:q.step,requestedMs:q.requestedMs,remainingMs:q.remainingMs}))return 'Invalid ending show ownership';
  }
  if(c.version===2&&c.wait?.kind==='ending-show'&&!c.frames[c.frames.length-1].endingShow)return 'Missing ending show source';
  for(const [i,f] of c.frames.entries())if(f.screenFade!==undefined) {
    const q=f.screenFade,p=q?.screen,w=c.version===2?c.wait:null;
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !validateScreenFadeSource(q,read(f.currentPC),f.currentPC) || f.kind==='auto'&&f.continuationPC!==f.currentPC || f.dialogAction)return 'Invalid screen fade source';
    if(i===c.frames.length-1 ? q.phase!=='screen'||!p||!sameJsonValue(w,{kind:'screen-fade',opcodePC:q.opcodePC,nextPC:q.nextPC,substep:p.substep,requestedMs:p.requestedMs,remainingMs:p.remainingMs}) : q.phase!=='compose'||!f.compose||!composeOwnerMatches(f))return 'Invalid screen fade ownership';
  }
  if(c.version===2&&c.wait?.kind==='screen-fade'&&!c.frames[c.frames.length-1].screenFade)return 'Missing screen fade source';
  for(const [i,f] of c.frames.entries())if(f.rng!==undefined) {
    const q=f.rng,w=c.version===2?c.wait:null;
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !validateRngCursor(q,read(f.currentPC),f.currentPC) || f.kind==='auto'&&f.continuationPC!==f.currentPC || f.dialogAction)return 'Invalid RNG source';
    if(i===c.frames.length-1 ? q.phase!=='sleep'||w?.kind!=='rng'||!sameJsonValue(w,{kind:'rng',...q}) : q.phase!=='fade'||f.parentReturn?.kind!=='rng-fade')return 'Invalid RNG ownership';
  }
  if(c.version===2&&c.wait?.kind==='rng'&&!c.frames[c.frames.length-1].rng)return 'Missing RNG source';
  for(const [i,f] of c.frames.entries())if(f.sceneFade!==undefined) {
    const q=f.sceneFade,w=c.version===2?c.wait:null;
    if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || !validateSceneFadeCursor(q,read(f.currentPC),f.currentPC,read) || (f.kind==='auto'&&f.continuationPC!==f.currentPC))return 'Invalid scene fade source';
    if(f.dialogAction || (i===c.frames.length-1 ? q.phase!=='sleep' || w?.kind!=='scene-fade' || !sameJsonValue(w,{kind:'scene-fade',...q}) : f.compose ? !composeOwnerMatches(f) : q.phase!=='world' || f.parentReturn?.kind!=='world-update'))return 'Invalid scene fade ownership';
  }
  if(c.version===2 && c.wait?.kind==='scene-fade'&&!c.frames[c.frames.length-1].sceneFade)return 'Missing scene fade source';
  if(c.version===2 && c.wait?.kind==='timed-fade' && c.frames[c.frames.length-1].kind!=='fade')return 'Missing fade helper';
  for(const [i,f] of c.frames.entries())if(f.palette!==undefined) {
    const p=f.palette,w=c.version===2?c.wait:null;
    if(c.version!==2 || f.kind==='equipment' || !validatePaletteCursor(p,read(f.currentPC),f.currentPC) || (f.kind==='auto' && f.continuationPC!==f.currentPC))return 'Invalid palette cursor';
    if(i===c.frames.length-1 ? p.phase==='clear' ? !f.dialogAction || !w || w.kind!=='input' || w.action!=='dialog' || w.phase!=='clear' : p.phase!=='sleep' || f.dialogAction || !w || w.kind!=='palette' || !sameJsonValue(w,{kind:'palette',...p}) : f.compose ? !composeOwnerMatches(f) : p.phase!=='world' || f.parentReturn?.kind!=='world-update')return 'Invalid palette ownership';
  }
  if(c.version===2 && c.wait?.kind==='palette' && !c.frames[c.frames.length-1].palette)return 'Missing palette cursor';
  for(const [i,f] of c.frames.entries())if(f.redraw!==undefined) {
    const w=c.version===2?c.wait:null,r=f.redraw;
    if(c.version!==2 || (i!==c.frames.length-1 && !f.compose) || f.kind!=='trigger' || !validateRedrawCursor(r,read(f.currentPC),f.currentPC) || c.dialog?.cursor)return 'Invalid redraw cursor';
    if(f.compose){if(!composeOwnerMatches(f))return 'Invalid redraw composition';continue;}
    if(r.phase==='clear' ? !f.dialogAction || !w || w.kind!=='input' || w.action!=='dialog' || w.phase!=='clear' : r.phase!=='sleep' || f.dialogAction || !w || w.kind!=='redraw' || !sameJsonValue(w,{kind:'redraw',...r}))return 'Invalid redraw condition';
  }
  if(c.version===2 && c.wait?.kind==='redraw' && !c.frames[c.frames.length-1].redraw)return 'Missing redraw cursor';
  if(c.version===2 && c.wait?.kind==='party-motion' && !c.frames[c.frames.length-1].motion)return 'Missing party motion cursor';

  for(const [i,f] of c.frames.entries())if(f.npcMotion!==undefined) {
    const w=c.version===2?c.wait:null;
    if(f.compose){if(!validateNpcMotionCursor(f.npcMotion,read(f.currentPC),f.currentPC,f.eventId)||!composeOwnerMatches(f))return 'Invalid NPC composition';continue;}
    if(c.version!==2 || i!==c.frames.length-1 || f.kind==='equipment' || f.frameWait || f.poisonCursor || f.partyEquipmentCursor || f.equipmentCursor || f.shopCursor || f.dialogAction || c.dialog?.cursor || !w || w.kind!=='npc-motion' || f.npcMotion.phase!=='sleep' || !validateNpcMotionCursor(f.npcMotion,read(f.currentPC),f.currentPC,f.eventId) || Object.keys(f.npcMotion).some(key=>!sameJsonValue((w as any)[key],(f.npcMotion as any)[key])))return 'Invalid NPC motion cursor';
  }
  if(c.version===2 && c.wait?.kind==='npc-motion' && !c.frames[c.frames.length-1].npcMotion)return 'Missing NPC motion cursor';

  for(const [i,f] of c.frames.entries())if(f.shopCursor!==undefined) {
    const wait=c.version===2?c.wait:null;
    if(f.compose){if(!validateShopCursor(f.shopCursor,read(f.currentPC),f.currentPC)||!composeOwnerMatches(f))return 'Invalid shop composition';continue;}
    if(c.version!==2 || i!==c.frames.length-1 || f.kind==='equipment' || f.frameWait || f.poisonCursor || f.partyEquipmentCursor || f.equipmentCursor || f.dialogAction || c.dialog?.cursor || !wait || (wait.kind!=='menu' && !(wait.kind==='input' && wait.action==='shop')) || f.shopCursor.phase==='initial' || !validateShopCursor(f.shopCursor,read(f.currentPC),f.currentPC))return 'Invalid shop cursor';
  }
  for (let i=0;i<c.frames.length;i++) {
    const f=c.frames[i];
    if (i === c.frames.length-1) { if (f.parentReturn !== null) return 'Invalid leaf return'; }
    else {
      const p=f.parentReturn, child=c.frames[i+1], sc=f.kind==='equipment' ? null : read(f.currentPC);
      if(p?.kind==='ending-animation-fade') {
        const q=f.endingAnimation;
        if(c.version!==2 || !q || q.phase!=='fade' || child.kind!=='fade' || !sameJsonValue(p,{kind:'ending-animation-fade',opcodePC:q.opcodePC,nextPC:q.nextPC,frameIndex:q.frameIndex,girlPos:q.girlPos,args:q.args}) || !sameJsonValue(q.args,child.fadeArgs))return 'Invalid ending animation fade return';
        continue;
      }
      if(p?.kind==='ending-scroll-fade') {
        const q=f.endingScroll;
        if(c.version!==2 || !q || q.phase!=='fade' || child.kind!=='fade' || !sameJsonValue(p,{kind:'ending-scroll-fade',opcodePC:q.opcodePC,nextPC:q.nextPC,frameIndex:q.frameIndex,args:q.args}) || !sameJsonValue(q.args,child.fadeArgs))return 'Invalid ending scroll fade return';
        continue;
      }
      if(p?.kind==='rng-fade') {
        const q=f.rng;
        if(c.version!==2 || !q || q.phase!=='fade' || child.kind!=='fade' || !sameJsonValue(p,{kind:'rng-fade',opcodePC:q.opcodePC,nextPC:q.nextPC,args:q.args}) || !sameJsonValue(q.args,child.fadeArgs))return 'Invalid RNG fade return';
        continue;
      }
      if(p?.kind==='world-compose-fade') {
        const source=f.compose,u=f.frameWait?.worldUpdate;
        if(c.version!==2 || !source || !source.source.startsWith('world-') || !composeOwnerMatches(f) || !u || !validateWorldUpdateCursor(u,read) || child.kind!=='fade' || !sameJsonValue(p,{kind:'world-compose-fade',opcodePC:source.opcodePC,nextPC:source.opcodePC+1,args:source.args,selection:u.composition}) || !sameJsonValue(p.args,child.fadeArgs))return 'Invalid World composition fade return';
        continue;
      }
      if(p?.kind==='generated-dialog-compose-fade') {
        const source=f.compose,q=f.generatedDialog;
        if(c.version!==2 || !source || source.source!=='generated-dialog-poll' || !q || !composeOwnerMatches(f) || child.kind!=='fade' || !sameJsonValue(p,{kind:'generated-dialog-compose-fade',opcodePC:q.opcodePC,nextPC:q.opcodePC,ownerKind:q.ownerKind,site:q.site,poll:q.poll,frameIndex:i,phase:'compose',args:source.args}) || !sameJsonValue(p.args,child.fadeArgs))return 'Invalid generated dialog composition fade return';
        continue;
      }
      if(p?.kind==='compose-fade') {
        const source=f.compose;
        if(c.version!==2 || !source || (f.kind!=='trigger'&&f.kind!=='auto') || child.kind!=='fade' || !sameJsonValue(p,{kind:'compose-fade',opcodePC:source.opcodePC,nextPC:source.opcodePC+1,args:source.args}) || !sameJsonValue(p.args,child.fadeArgs))return 'Invalid composition fade return';
        continue;
      }
      if(p?.kind==='fade') {
        const source=f.fadeSource;
        if(c.version!==2 || (f.kind!=='trigger' && f.kind!=='auto') || !source || source.phase!=='child' || child.kind!=='fade' || !sameJsonValue(p,{kind:'fade',opcodePC:source.opcodePC,nextPC:source.nextPC,args:source.args,needFade:source.needFade}) || !sameJsonValue(p.args,child.fadeArgs))return 'Invalid fade return link';
        continue;
      }
      if(f.kind==='fade' || child.kind==='fade')return 'Missing fade return link';
      if(p?.kind==='equipment-item') {
        const pending=f.equipmentCursor?.pending;
        if(f.kind!=='equipment' || !pending || child.kind!=='trigger' || child.eventId!==pending.role || ['itemId','scriptEntry','role','part'].some(key=>(p as any)[key]!==(pending as any)[key]) || !validInstruction(read(p.scriptEntry)) || (!readObject || !readObject(p.itemId)?.item))return 'Invalid equipment item return link';
        continue;
      }
      if(p?.kind==='party-equipment') {
        if(f.kind==='equipment' || c.version!==2 || child.kind!=='equipment' || f.frameWait || f.poisonCursor || !validatePartyEquipmentCursor(f.partyEquipmentCursor,sc,f.currentPC) || p.opcodePC!==f.currentPC || p.nextPC!==f.currentPC+1 || (f.kind==='auto' && f.continuationPC!==f.currentPC))return 'Invalid party equipment return link';
        continue;
      }
      if(f.kind==='equipment' || child.kind==='equipment')return 'Missing equipment return link';
      if(p?.kind==='poison') {
        const cursor=f.poisonCursor,pending=cursor?.pending;
        if(c.version!==2 || !cursor || !validatePoisonCursor(cursor,sc,f.currentPC,f.eventId) || f.frameWait || !pending || child.kind!=='trigger' || p.opcodePC!==f.currentPC || p.nextPC!==f.currentPC+1 || p.childEventId!==child.eventId || ['target','partyIndex','slot','childEntry','childEventId'].some(key=>(p as any)[key] !== (pending as any)[key]) || !validInstruction(read(p.childEntry)) || (f.kind==='auto' && f.continuationPC!==f.currentPC)) return 'Invalid poison return link';
        continue;
      }
      if (p?.kind === 'auto-tail') {
        const target=sc?.operation===3 ? sc.operand?.[0] : sc?.operation===6 ? sc.operand?.[1] : undefined;
        if (c.version!==2 || f.kind!=='auto' || f.frameWait || child.kind!=='auto' || ![p.opcodePC,p.nextPC,p.childEntry,p.childEventId].every(integer) || p.opcodePC!==f.currentPC || p.nextPC!==f.currentPC+1 || f.continuationPC!==f.currentPC || target===undefined || (sc.operation===6 && target===0) || p.childEntry!==target || child.currentPC!==p.childEntry || p.childEventId!==f.eventId || child.eventId!==f.eventId) return 'Invalid auto-tail return link';
        continue;
      }
      if(p?.kind==='teleport-child') {
        if(c.version!==2 || (f.kind!=='trigger'&&f.kind!=='auto') || child.kind!=='trigger' || Object.keys(p).length!==10 || p.operation!==0x38 || sc?.operation!==0x38 || p.opcodePC!==f.currentPC || p.nextPC!==f.currentPC+1 || !sameJsonValue(p.operands,Array.from(sc.operand)) || !integer(p.selectedScene) || !integer(p.childEntry) || p.childEntry===0 || !validInstruction(read(p.childEntry)) || p.childEventId!==0xffff || !integer(p.effectiveEventId) || p.effectiveEventId>0xffff || child.eventId!==p.effectiveEventId || p.returnPolicy!=='discard' || f.kind==='auto'&&f.continuationPC!==f.currentPC)return 'Invalid teleport child return';
        continue;
      }
      if (p?.kind === 'world-update') {
        const w=f.frameWait?.worldUpdate || f.motion?.worldUpdate || f.palette?.worldUpdate || f.sceneFade?.worldUpdate;
        if (!w?.pendingReturn || (!f.motion && !f.palette && !f.sceneFade && sc?.operation!==9) || p.opcodePC!==f.currentPC || p.nextPC!==f.currentPC+1 || p.childKind!==child.kind || (p.childKind==='auto' && child.currentPC!==p.childEntry) || p.childKind!==w.pendingReturn.kind || p.childEventId!==child.eventId || ((w.pendingReturn.field!=='scriptOnEnter' || w.pendingReturn.eventId!==0xffff) && p.childEventId!==w.pendingReturn.eventId) || p.childEntry!==w.pendingReturn.entry || p.field!==w.pendingReturn.field || p.eventId!==w.pendingReturn.eventId || p.sceneId!==w.sceneId || p.nextPhase!==w.phase) return 'Invalid world-update return link';
        continue;
      }
      if (!p || !Object.values(p).every(integer) || p.opcodePC !== f.currentPC || p.nextPC !== f.currentPC+1 || sc?.operation !== 4 || p.childEntry !== sc.operand?.[0] || child.kind !== 'trigger' || p.childEventId !== child.eventId || (sc.operand[1] !== 0xffff && p.childEventId !== (sc.operand[1] || f.eventId))) return 'Invalid parent return link';
    }
  }
  for(const f of c.frames) if(f.partyEquipmentCursor && f.parentReturn?.kind!=='party-equipment')return 'Invalid party equipment cursor';
  for(const f of c.frames) if(f.equipmentCursor && f.parentReturn?.kind!=='equipment-item')return 'Invalid equipment cursor';
  for(const f of c.frames) if(f.poisonCursor && (c.version!==2 || f.parentReturn?.kind!=='poison')) return 'Invalid poison cursor';
  for (const [index,f] of c.frames.entries()) if (f.frameWait) {
    const w=f.frameWait, sc=read(w.opcodePC);
    if (f.kind!=='trigger' || w.opcodePC!==f.currentPC || w.nextPC!==w.opcodePC+1 || sc?.operation!==9 || w.frameCount!==(sc.operand[0]||1) || w.trigger!==!!sc.operand[1] || w.gestures!==!!sc.operand[2] || !integer(w.frameIndex) || w.frameIndex>=w.frameCount || !['clear','gestures','world','compose','screen','sleep'].includes(w.phase) || !Number.isFinite(w.remainingMs) || w.remainingMs<0 || w.remainingMs>16) return 'Invalid frame cursor';
  }
  for(const [index,f] of c.frames.entries()) {
    const w=f.frameWait || f.motion || f.palette || f.sceneFade;if(!w)continue;
    const u=w.worldUpdate;
    if(u!==undefined && !u)return 'Invalid present world cursor';
    if(u?.composition && (!f.frameWait?.trigger || !f.compose || !composeOwnerMatches(f) || f.parentReturn?.kind!=='world-compose-fade'))return 'Invalid World composition owner';
    if(u?.pendingReturn && u.pendingReturn.field!=='autoScript' && !f.frameWait?.trigger)return 'World trigger child does not match owner trigger policy';
    if(u && !validateWorldUpdateCursor(u,read))return 'Invalid world cursor';
    if(u && (w.phase!=='world' || index===c.frames.length-1))return 'Invalid pending world return';
    if (index<c.frames.length-1 && !f.compose && (!u || f.parentReturn?.kind!=='world-update')) return 'Missing world return';
  }
  const leaf=c.frames[c.frames.length-1];
  if(leaf.kind==='equipment')return 'Equipment helper cannot be a wait leaf';
  for(const [index,f] of c.frames.entries())if(f.dialogAction) {
    const a=f.dialogAction,sc=read(f.currentPC);
    // Opcode 5 owns overlay clearance before this dialog subcondition.
    if([0x4f,0x80,0x8c].includes(a.operation) && (!f.palette || f.palette.phase!=='clear'))return 'Missing palette clear cursor';
    if([0x4e,0x50,0x51].includes(a.operation) && (!f.fadeSource || f.fadeSource.phase!=='clear'))return 'Missing fade clear source';
    if((a.operation===0x96&&f.endingAnimation!==undefined)||(a.operation===0xa4&&f.endingScroll!==undefined)||([0x76,0xa5].includes(a.operation)&&f.endingShow!==undefined)||([0x73,0x9b].includes(a.operation)&&f.screenFade!==undefined)||(a.operation===0x93 && f.sceneFade!==undefined)||(a.operation===0x37&&f.rng!==undefined))return 'Scene fade assets cannot precede dialog acknowledgement';
    if(a.operation===5 && (!f.redraw || f.redraw.phase!=='clear'))return 'Missing redraw clear cursor';
    if(index!==c.frames.length-1 || f.frameWait || f.poisonCursor || f.partyEquipmentCursor || c.version!==2 || !c.dialog || f.kind!=='trigger' || a.opcodePC!==f.currentPC || !sc || a.operation!==sc.operation || !Array.isArray(a.operands) || JSON.stringify(a.operands)!==JSON.stringify(Array.from(sc.operand)) || a.continuationPC!==f.continuationPC || typeof a.ended!=='boolean' || !['clear','terminal'].includes(a.phase) || (a.phase==='terminal' ? !a.ended || ![0,1,2].includes(a.operation) || (a.operation===1 && a.continuationPC!==a.opcodePC+1) || (a.operation===2 && a.continuationPC!==sc.operand[0]) : a.ended || [0,1,2,3,4,6,7,8,10,0xffff].includes(a.operation)))return 'Invalid dialog action';
  }
  if(c.version===2 && (c.wait?.kind==='dialog-time' || (c.wait?.kind==='input' && c.wait.action==='dialog'))) {
    const w=c.wait,t=c.dialog?.cursor,a=leaf.dialogAction,sc=read(leaf.currentPC);
    if(!c.dialog || leaf.frameWait || leaf.kind!=='trigger' || w.opcodePC!==leaf.currentPC || w.nextPC!==leaf.currentPC || leaf.poisonCursor || leaf.partyEquipmentCursor)return 'Invalid dialog wait';
    if(w.kind==='dialog-time') {
      if(a || !t || sc.operation!==0xffff || t.opcodePC!==w.opcodePC || t.phase!==w.phase || !['glyph','inline','window'].includes(w.phase) || !Number.isFinite(w.requestedMs) || w.requestedMs<0 || !Number.isFinite(w.remainingMs) || w.remainingMs<0 || w.remainingMs>w.requestedMs)return 'Invalid dialog timing';
      if(w.phase==='window') {
        if(c.dialog.mode!=='classic' || c.dialog.position!==3 || w.requestedMs!==1500 || w.prompt?.kind!=='advance' || !sameJsonValue(w.prompt.options,[{label:'Continue',value:true}]))return 'Invalid classic window deadline';
      } else if(w.prompt!==undefined)return 'Invalid dialog timer prompt';
      if(w.phase==='glyph' && (c.dialog.skip || w.requestedMs!==c.dialog.speed*8))return 'Invalid glyph timing';
    } else {
      if(JSON.stringify(w.operands)!==JSON.stringify(Array.from(sc.operand)) || w.prompt?.kind!=='advance' || !sameJsonValue(w.prompt.options,[{label:'Continue',value:true}]))return 'Invalid dialog input';
      if(w.phase==='page'||w.phase==='window') {if(a || !t || sc.operation!==0xffff || t.phase!==w.phase || t.opcodePC!==w.opcodePC || (w.phase==='window' && (c.dialog.mode!=='suppressed' || c.dialog.position!==3)))return 'Invalid dialog page';}
      else if(!a || a.phase!==w.phase || t || (w.phase==='clear' && c.dialog.line<=0))return 'Invalid dialog closure';
    }
    return null;
  }
  if(c.dialog?.cursor || leaf.dialogAction)return 'Missing dialog condition';
  if(c.version===2&&c.wait?.kind==='generated-dialog')return leaf.generatedDialog&&sameJsonValue(c.wait,generatedDialogWait(leaf.generatedDialog))?null:'Invalid generated dialog wait';
  if(leaf.shopCursor) {
    const q=leaf.shopCursor,w=c.version===2?c.wait:null;
    if(q.phase==='select') {if(!sameJsonValue(w,shopMenu(q)))return 'Invalid shop menu correspondence';}
    else if(!w || w.kind!=='input' || w.action!=='shop' || w.opcodePC!==q.opcodePC || w.nextPC!==q.nextPC || JSON.stringify(w.operands)!==JSON.stringify(q.operands) || !sameJsonValue(w.prompt,{kind:'confirm',noPC:q.opcodePC,options:[{label:'No',value:false},{label:'Yes',value:true}]}))return 'Invalid shop confirmation';
    return null;
  }
  if(c.version===2 && (c.wait?.kind==='menu' || (c.wait?.kind==='input' && c.wait.action==='shop')))return 'Missing shop cursor';

  if (c.version===2 && c.wait?.kind==='input') {
    if(leaf.kind==='fade' || leaf.frameWait || leaf.poisonCursor || leaf.partyEquipmentCursor || !validateInputWait(c.wait,read(leaf.currentPC),leaf.kind,leaf.currentPC,read))return 'Invalid input wait';
    return null;
  }
  if(c.version===2 && (c.wait?.kind==='ending-animation'||c.wait?.kind==='ending-scroll'||c.wait?.kind==='screen-fade'||c.wait?.kind==='ending-show'))return null;
  if(c.version===2 && c.wait?.kind==='rng')return null;
  if(c.version===2 && c.wait?.kind==='timed-fade')return null;
  if(c.version===2 && c.wait?.kind==='palette')return null;
  if(c.version===2 && c.wait?.kind==='scene-fade')return null;
  if(c.version===2 && c.wait?.kind==='redraw')return null;
  if(c.version===2 && (c.wait?.kind==='npc-motion' || c.wait?.kind==='party-motion'))return null;
  if (c.version===2 && c.wait?.kind==='frame') {
    const w=c.wait;
    if (!leaf.frameWait || ['opcodePC','nextPC','frameCount','trigger','gestures','frameIndex','phase','remainingMs'].some(key=>(w as any)[key] !== (leaf.frameWait as any)[key]) || !!w.worldUpdate || w.phase!=='sleep' || w.remainingMs<0 || w.remainingMs>16) return 'Invalid frame wait';
    return null;
  }
  if (c.version===1 && c.frames.some(f=>f.motion || f.frameWait || f.poisonCursor || f.parentReturn?.kind==='world-update')) return 'Version1 cannot contain frame cursors';
  if (c.version===2 && c.wait?.kind!=='delay') return 'Invalid wait kind';
  const d=c.version===2 ? c.wait as ({kind:'delay'} & DelayWaitDescriptor) : c.delay;
  if (!d || ![d.opcodePC,d.nextPC,d.requestedMs].every(integer) || typeof d.remainingMs !== 'number' || !Number.isFinite(d.remainingMs) || d.remainingMs < 0 || d.opcodePC !== leaf.currentPC || d.nextPC !== d.opcodePC+1 || d.remainingMs > d.requestedMs) return 'Invalid delay descriptor';
  const sc=read(d.opcodePC);
  if (sc?.operation !== 0x85 || !integer(sc.operand?.[0]) || d.requestedMs !== sc.operand[0]*80) return 'Delay does not match script data';
  return null;
}
/** Normalize the wait discriminator without changing the legacy wire record. */
export function normalizeCheckpointWait(c:ScriptDelayCheckpoint):ScriptWaitDescriptor {
  return c.version===1 ? {kind:'delay',...c.delay} : c.wait;
}
export function copyDelayCheckpoint(c:ScriptDelayCheckpoint): ScriptDelayCheckpoint { return JSON.parse(JSON.stringify(c)); }
export class ManualExecutionSignal { constructor(public readonly outcome: ScriptExecutionOutcome) {} }
/** A known identity accepts exactly its published revision; consumption closes it until a successor is published. */
export class CheckpointRevisionRegistry {
  private expected = new Map<string, number | null>();
  public publish(id:string, revision:number): void { this.expected.set(id,revision); }
  public consume(id:string, revision:number): boolean {
    if (this.expected.has(id) && this.expected.get(id) !== revision) return false;
    this.expected.set(id,null);
    return true;
  }
}
