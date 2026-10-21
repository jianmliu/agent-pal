import {toggleDialogColor,dialogControlNumber,dialogGlyphWidth} from '../../services/dialog-text-grammar';
import utils from './utils';
import MKF from './mkf';
import RLE from './rle';
import font, {readFontRuntimeBinding} from './font';
import Sprite from './sprite';
import Palette from './palette';
import input from './input';
import resourceService from '../../services/resource-service.js';
import worldService from '../../services/world-service.js';
import dialogService from '../../services/dialog-service.js';
import {registerNativeTextCapability} from '../../services/native-text-capabilities';
import {
  getPaletteIdValue as getPaletteIdSnapshot,
  isNightPaletteEnabled
} from '../../services/environment-adapter.js';
import { getBattleStateSnapshot } from '../../services/battle-state-adapter.js';

type AnyRecord = Record<string, any>;

type SurfaceLike = {
  width: number;
  height: number;
  pitch: number;
  updateScreen: (rect?: any) => void;
  backupScreen: () => void;
  restoreScreen: () => void;
  getRect?: (x: number, y: number, w: number, h: number) => Uint8Array;
  putRect?: (src: Uint8Array, x: number, y: number) => void;
  setPalette: (palette: any) => void;
  setPixel: (x: number, y: number, color: number) => void;
  blitRLE: (frame: any, pos: any, buffer?: any) => void;
  blitRLEWithColorShift?: (frame: any, pos: any, shift: number, buffer?: any) => void;
};

declare const log: any;
declare const global: any;
declare const BinaryReader: any;
declare const RECT: any;
declare const PAL_X: any;
declare const PAL_Y: any;
declare const PAL_XY: any;
declare const DialogPosition: any;
declare const PAL_CLASSIC: any;
declare const BattleResult: any;
declare const Key: any;
declare const Const: any;
declare const PlayerStatus: any;
declare const sleep: any;

log.trace('text module load');

var AdditionalWords = [
  0xBE, 0xD4, 0xB0, 0xAB, 0xB3, 0x74, 0xAB, 0xD7, 0x00, 0x00, 0x00, // Battle Speed
  0xA4, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 1
  0xA4, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 2
  0xA4, 0x54, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 3
  0xA5, 0x7C, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 4
  0xA4, 0xAD, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00  // 5
];
/*
typedef struct tagTEXTLIB
{
 LPBYTE          lpWordBuf;
 LPBYTE          lpMsgBuf;
 LPDWORD         lpMsgOffset;

 int             nWords;
 int             nMsgs;

 int             nCurrentDialogLine;
 BYTE            bCurrentFontColor;
 PAL_POS         posIcon;
 PAL_POS         dialogTitlePos;
 PAL_POS         dialogTextPos;
 BYTE            bDialogPosition;
 BYTE            bIcon;
 int             iDelayTime;
 BOOL            fUserSkip;
 BOOL            fPlayingRNG;

 BYTE            bufDialogIcons[282];
} TEXTLIB, *LPTEXTLIB;
*/

/**
 * text
 * @module
 */
const text: AnyRecord = {
  updatedInBattle: false
};

const dialogDecoder = (() => {
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

function toUint8Array(buf: any): Uint8Array {
  if (!buf) {
    return new Uint8Array();
  }
  if (buf instanceof Uint8Array) {
    return buf;
  }
  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (Array.isArray(buf)) {
    return Uint8Array.from(buf);
  }
  return new Uint8Array();
}

function decodeDialogBuffer(buf: any): string {
  const view = toUint8Array(buf);
  if (view.length === 0) {
    return '';
  }
  if (dialogDecoder) {
    try {
      return dialogDecoder.decode(view).replace(/\u0000+$/, '').trim();
    } catch (err) {
      // fall through to manual decode
    }
  }
  let result = '';
  for (let i = 0; i < view.length; i++) {
    const code = view[i];
    if (code === 0) {
      break;
    }
    result += String.fromCharCode(code);
  }
  return result.trim();
}

function collapseDialogSpaces(buf: Uint8Array): Uint8Array {
  if (!buf || buf.length === 0) {
    return buf;
  }
  const out: number[] = [];
  let prevSpace = false;
  let changed = false;
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === 0) {
      out.push(0);
      if (i + 1 < buf.length) {
        changed = true;
      }
      break;
    }
    if (ch === 0x20) {
      if (prevSpace) {
        changed = true;
        continue;
      }
      prevSpace = true;
      out.push(ch);
      continue;
    }
    prevSpace = false;
    if (ch & 0x80) {
      out.push(ch);
      if (i + 1 < buf.length) {
        out.push(buf[i + 1]);
      } else {
        changed = true;
      }
      i += 1;
      continue;
    }
    out.push(ch);
  }
  if (!changed && out.length === buf.length) {
    return buf;
  }
  return Uint8Array.from(out);
}

function shouldSuppressLegacyDialog(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const win = window as any;
  if (win && win.PAL_OVERLAY_ACTIVE === 'panorama') {
    return true;
  }
  const panorama = win && win.PAL_PANORAMA;
  if (panorama && typeof panorama.getMode === 'function') {
    return panorama.getMode() === 'panorama';
  }
  return false;
}

function stripSpeakerPrefix(buf: Uint8Array, speakerName: string | null): Uint8Array {
  if (!speakerName) {
    return buf;
  }
  const normalizedName = speakerName.trim();
  if (!normalizedName) {
    return buf;
  }
  const visibleBytes: number[] = [];
  let i = 0;
  while (i < buf.length) {
    const byte = buf[i];
    if (byte === 0) {
      break;
    }
    if (byte === 0x2d || byte === 0x27 || byte === 0x22 || byte === 0x29 || byte === 0x28) {
      i += 1;
      continue;
    }
    if (byte === 0x24 || byte === 0x7e) {
      i += 3;
      continue;
    }
    if (byte === 0x5c) {
      i += 1;
      if (i >= buf.length) {
        break;
      }
    }

    const isAsciiColon = byte === 0x3a;
    const isWideColon = byte === 0xa1 && buf[i + 1] === 0x47;
    if (isAsciiColon || isWideColon) {
      const prefix = decodeDialogBuffer(Uint8Array.from(visibleBytes));
      if (prefix && prefix.trim() === normalizedName) {
        let offset = isAsciiColon ? i + 1 : i + 2;
        while (offset < buf.length && buf[offset] === 0x20) {
          offset += 1;
        }
        return buf.subarray(offset);
      }
      if (isWideColon) {
        visibleBytes.push(byte, buf[i + 1]);
        i += 2;
        continue;
      }
      visibleBytes.push(byte);
      i += 1;
      continue;
    }

    if (byte & 0x80) {
      visibleBytes.push(byte);
      if (i + 1 < buf.length) {
        visibleBytes.push(buf[i + 1]);
      }
      i += 2;
      continue;
    }
    visibleBytes.push(byte);
    i += 1;
  }
  return buf;
}

let surface: SurfaceLike = null as unknown as SurfaceLike;
var WORD_LENGTH = 10;
var FontColor = {
  DEFAULT:  0x4F,
  YELLOW:   0x2D,
  RED:      0x1A,
  RED_ALT:  0x17,
  CYAN:     0x8D,
  CYAN_ALT: 0x8C
};
let ui: AnyRecord = {} as AnyRecord;

function trim(buf: any) {
  var head = 0, tail = 0, space = ' '.charCodeAt(0);
  while (head < buf.length && buf[head] == 0 || buf[head] == space) {
    head++;
  }
  tail = head;
  while (tail < buf.length && buf[tail] != 0 && buf[tail] != space) {
    tail++;
  }
  return buf.slice(head, tail);
}
let textLib: AnyRecord = {};
let textGeneration = 0;

/** Detached state from the actual native singleton, never an owned-VM default. */
export interface NativeTextSnapshot {
  generation:number;mode:'classic'|'suppressed';awaitingInput:boolean;updatedInBattle:boolean;
  position:number;color:number;delayTime:number;icon:number;posIcon:number;line:number;
  titlePos:number;textPos:number;skip:boolean;playingRNG:boolean;face:number;
  speaker:string|null;faces:Record<string,string>;faceBackup:number[]|null;
  faceRect:Record<string,number>|null;faceLeftBoundary:number|null;hasDialogBackup:boolean;shadow:number;
}
/** Live identities are lease-local only and must never be serialized into a DTO. */
export interface NativeTextRuntimeBinding {
  readonly presentation:Omit<NativeTextSnapshot,'mode'|'awaitingInput'>;readonly wordCache:Readonly<Record<number,unknown>>;
  readonly generation:number;readonly surface:SurfaceLike;readonly ui:AnyRecord;
  readonly text:AnyRecord;readonly decoder:unknown;readonly bytes:typeof toUint8Array;
  readonly decode:typeof decodeDialogBuffer;readonly wordBuffer:Uint8Array;
  readonly messageBuffer:Uint8Array;readonly offsets:Uint32Array;
  readonly dialogIcons:unknown;readonly dialogIconsBuffer:Uint8Array;
  readonly faceBackup:unknown;readonly faceRect:unknown;readonly faces:unknown;
  readonly font:ReturnType<typeof font.getRuntimeBinding>;
  readonly resources:readonly unknown[];readonly methods:Readonly<Record<string,unknown>>;
}
const nativeMapForEach=Map.prototype.forEach,nativeApply=Reflect.apply;
function nativeFacesSnapshot():Record<string,string> {
  const faces:Record<string,string>={};
  if(textLib.faceSpeakers)nativeApply(nativeMapForEach,textLib.faceSpeakers,[(value:any,key:any)=>{if((typeof key==='number'||typeof key==='string')&&typeof value==='string')faces[String(key)]=value;else faces.invalid='invalid';}]);
  return faces;
}
const nativeTextDescriptor=Object.getOwnPropertyDescriptor,nativeTextDescriptors=Object.getOwnPropertyDescriptors;
const nativeBackupLength=nativeTextDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length')!.get!;
function nativeTextData(value:object,key:string):any {
  const field=nativeTextDescriptor(value,key);if(!field)return undefined;
  if(!('value'in field))throw new Error('Native text snapshot requires a data field: '+key);
  return field.value;
}
function nativeBackupSnapshot(value:any):number[]|null {
  if(!value)return null;
  const length=nativeApply(nativeBackupLength,value,[]),out:number[]=[];
  for(let i=0;i<length;i++)out.push(value[i]);
  return out;
}
function nativeRectSnapshot(value:any):AnyRecord|null {
  if(!value)return null;
  const out:AnyRecord={};
  for(const [key,field]of Object.entries(nativeTextDescriptors(value))){if(!('value'in field))throw new Error('Native text rectangle requires data fields');out[key]=field.value;}
  return out;
}
function readNativeTextPresentation():Omit<NativeTextSnapshot,'mode'|'awaitingInput'> {
  return {generation:textGeneration,updatedInBattle:!!nativeTextData(text,'updatedInBattle'),
    position:textLib.dialogPosition,color:textLib.currentFontColor,delayTime:textLib.delayTime,
    icon:textLib.icon,posIcon:textLib.posIcon,line:textLib.currentDialogLine,
    titlePos:textLib.dialogTitlePos,textPos:textLib.dialogTextPos,skip:!!textLib.userSkip,
    playingRNG:!!textLib.playingRNG,face:textLib.currentDialogFace??0,
    speaker:textLib.currentSpeakerName??null,faces:nativeFacesSnapshot(),
    faceBackup:nativeBackupSnapshot(textLib.dialogFaceBackup),
    faceRect:nativeRectSnapshot(textLib.dialogFaceRect),
    faceLeftBoundary:textLib.dialogFaceLeftBoundary??null,hasDialogBackup:!!textLib.hasDialogBackup,
    shadow:textLib.dialogShadow
  };
}

/** Runtime-only renderer completion handle; never an opaque coroutine. */
export interface NativeGeneratedDialogPrefix {
  readonly generation:number;readonly mode:'classic'|'suppressed';readonly raw:number[];
  readonly box:any;readonly rect:{x:number;y:number;w:number;h:number}|null;
}
let generatedShowRequest:{raw:number[];ownedRead?:(site:string,index:number|null,value:any)=>void;prefix:NativeGeneratedDialogPrefix|null;started:boolean}|null=null;
const generatedPrefixes = new WeakMap<NativeGeneratedDialogPrefix,{surface:SurfaceLike;ui:AnyRecord;phase:'free'|'update'|'end'|'done'}>();
export interface NativeGeneratedDialogWait {
  readonly generation:number;readonly startedAt:number;readonly suppressLegacy:boolean;
  readonly allowLegacyPalette:boolean;readonly nightPalette:boolean;
  readonly paletteEntry:any;readonly palette:any;readonly position:number;
}
const generatedWaits = new WeakMap<NativeGeneratedDialogWait,{surface:SurfaceLike;ui:AnyRecord;finished:boolean}>();
function generatedPrefix(raw:number[],box:any=null,rect:NativeGeneratedDialogPrefix['rect']=null):NativeGeneratedDialogPrefix {
  const prefix:NativeGeneratedDialogPrefix={generation:textGeneration,mode:shouldSuppressLegacyDialog()?'suppressed':'classic',raw,box,rect};
  generatedPrefixes.set(prefix,{surface,ui,phase:box?'free':'end'});return prefix;
}

text.init = function*(surf: SurfaceLike, _ui: AnyRecord): Generator<unknown, void, unknown> {
  log.debug('[UI] init text');
  ui = _ui;
  global.text = text;
  surface = surf;
  yield font.init(surf);
  const list = (yield resourceService.loadFiles('m.msg', 'word.dat')) as ArrayLike<ArrayBuffer | Uint8Array>;
  const msgBuf = toUint8Array(list[0] as any);
  const wordBuf = toUint8Array(list[1] as any);
  // Each word has 10 bytes
  var wordCount = ~~((wordBuf.length + (WORD_LENGTH - 1)) / WORD_LENGTH);
  textLib = {
    msgBuf: msgBuf,
    wordBuf: wordBuf,
    wordCount: wordCount,
    wordCache: {},
    msgCache: {}/*,
    words: new Array(wordCount)*/
  };
  yield resourceService.loadMKF('SSS', 'DATA', 'RGM');
  // Read the message offsets. The message offsets are in SSS.MKF #3
  const SSS = text.SSS = resourceService.getMKF('SSS') as unknown as MKF;
  const DATA = text.DATA = resourceService.getMKF('DATA') as unknown as MKF;
  const RGM = text.RGM = resourceService.getMKF('RGM') as unknown as MKF;
  var chunkSSS = SSS.readChunk(3);
  var msgOffset = textLib.msgOffset = new Uint32Array(chunkSSS.buffer, chunkSSS.byteOffset, chunkSSS.byteLength / 4);
  var msgCount = textLib.msgCount = msgOffset.length - 1;
  // Read the messages.
  textLib.currentFontColor = FontColor.DEFAULT;
  textLib.icon = 0;
  textLib.posIcon = 0;
  textLib.currentDialogLine = 0;
  textLib.delayTime = 3;
  textLib.dialogTitlePos = PAL_XY(12, 8);
  textLib.dialogTextPos = PAL_XY(44, 26);
  textLib.dialogPosition = DialogPosition.Upper;
  textLib.userSkip = false;
  textLib.currentSpeakerName = null;
  textLib.dialogFaceBackup = null;
  textLib.dialogFaceRect = null;
  textLib.dialogFaceLeftBoundary = null;
  textLib.hasDialogBackup = false;
  textLib.dialogShadow = 0;

  textLib.dialogIconsBuf = DATA.readChunk(12);
  textLib.dialogIcons = new Sprite(textLib.dialogIconsBuf);
  textGeneration++;

  ui.getWord = function(wordNum: number) {
    var buf = [],
        cache = textLib.wordCache;
    if (wordNum in cache) {
      return cache[wordNum];
    }
    if (wordNum >= Const.PAL_ADDITIONAL_WORD_FIRST) {
      return AdditionalWords[wordNum - Const.PAL_ADDITIONAL_WORD_FIRST];
    }
    if (wordNum >= textLib.wordCount) {
      return [];
    }

    for (var i=0,offset=wordNum*WORD_LENGTH; i<WORD_LENGTH; ++i) {
      var b = textLib.wordBuf[i+offset];
      buf.push(b);
    }
    buf = trim(buf);

    return (cache[wordNum] = buf);
  };

  ui.getMsg = function(msgNum: number) {
    var cache = textLib.msgCache;
    if (msgNum in cache) {
      return cache[msgNum];
    }
    if (msgNum > textLib.msgCount) {
      return [];
    }
    var offset = textLib.msgOffset[msgNum],
        size = textLib.msgOffset[msgNum + 1] - offset;
    var buf = new Uint8Array(size);
    for (var i=0; i<size; ++i) {
      var b = textLib.msgBuf[offset + i];
      buf[i] = b;
    }

    return (cache[msgNum] = buf);
  };

  /**
   * Draw text on the screen.
   * @param  {Uint8Array} buf
   * @param  {POS} pos
   * @param  {Color} color
   * @param  {Boolean} shadow
   * @param  {Boolean} update
   */
  const toBytes = (payload: any): Uint8Array | null => {
    if (!payload) return null;
    if (payload instanceof Uint8Array) return payload;
    if (ArrayBuffer.isView(payload)) {
      return new Uint8Array(payload.buffer, payload.byteOffset || 0, payload.byteLength || 0);
    }
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
    if (typeof payload === 'string') {
      // Fallback: encode as ASCII.
      const arr = new Uint8Array(payload.length);
      for (let i = 0; i < payload.length; i++) arr[i] = payload.charCodeAt(i) & 0xff;
      return arr;
    }
    if (Array.isArray(payload)) {
      return Uint8Array.from(payload.map((v) => v & 0xff));
    }
    return null;
  };
  // Read-only bridge: the owned VM uses the exact native byte/publication codec
  // without importing this module into the runner's bootstrap cycle.
  ui.getDialogCodec = () => ({
    bytes: toUint8Array,
    decode: decodeDialogBuffer,
    publish: (bytes: Uint8Array, speaker: string | null, title: boolean) => {
      const published = collapseDialogSpaces(title ? bytes : stripSpeakerPrefix(bytes, speaker));
      const value = decodeDialogBuffer(published);
      return title ? value.replace(/[：:]+\s*$/u, '').trim() : value;
    }
  });
  ui.getDialogPresentationMode = () => shouldSuppressLegacyDialog() ? 'suppressed' : 'classic';
  // These bridges deliberately do not invoke getWord/getMsg/readChunk or any
  // rendering function. Codec getters allocate wrappers, so bind their actual
  // decoder/bytes functions and generation instead of wrapper identity.
  ui.getNativeTextSnapshot = (): NativeTextSnapshot => ({...readNativeTextPresentation(),mode:shouldSuppressLegacyDialog()?'suppressed':'classic',awaitingInput:!!dialogService.getStatus().awaitingInput});
  ui.getNativeTextRuntimeBinding = (): NativeTextRuntimeBinding => ({
    presentation:readNativeTextPresentation(),wordCache:textLib.wordCache,
    generation:textGeneration,surface,ui,text,decoder:dialogDecoder,bytes:toUint8Array,decode:decodeDialogBuffer,
    wordBuffer:textLib.wordBuf,messageBuffer:textLib.msgBuf,offsets:textLib.msgOffset,
    dialogIcons:textLib.dialogIcons,dialogIconsBuffer:textLib.dialogIconsBuf,
    faceBackup:textLib.dialogFaceBackup,faceRect:textLib.dialogFaceRect,faces:textLib.faceSpeakers,
    font:readFontRuntimeBinding(),resources:[nativeTextData(text,'SSS'),nativeTextData(text,'DATA'),nativeTextData(text,'RGM'),resourceService],
    methods:Object.fromEntries(['getWord','getMsg','drawText','drawNumber','startDialog','setDialogShadow','showDialogText','dialogWaitForKey','clearDialog','endDialog','createSingleLineBox','blitRLEShadow','Box','getDialogCodec','getDialogPresentationMode','getNativeTextSnapshot','getNativeTextRuntimeBinding','prepareGeneratedDialog','finishGeneratedDialog','beginGeneratedDialogWait','rotateGeneratedDialogWaitPalette','checkGeneratedDialogInput','finishGeneratedDialogWait','prepareGeneratedDialogClear','finishGeneratedDialogClear'].flatMap(name=>{const d=Object.getOwnPropertyDescriptor(ui,name);return [[name,d?.value],[name+':get',d?.get],[name+':set',d?.set]];}))
  });
  registerNativeTextCapability(ui,textGeneration,ui.getNativeTextRuntimeBinding);
  let warnNonBinaryCount = 0;

  ui.drawText = function(buf: any, pos: number, color: number, shadow: boolean, update: boolean,ownedRead?:(site:string,index:number|null,value:any)=>void) {
    const bytes = toBytes(buf);
    if (!bytes) {
      if (warnNonBinaryCount < 3) {
        log.warn('[TEXT] drawText received non-binary payload');
        warnNonBinaryCount += 1;
      }
      return;
    }
    var rect = {
      x: PAL_X(pos), y: PAL_Y(pos)
    };
    log.trace('[TEXT] drawText(%d, %d, %d)', bytes.length, rect.x, rect.y);
    var urect = {
      x: rect.x, y: rect.y,
      h: 16, w: 0
    };
    var reader = new BinaryReader(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength || bytes.length, true);
    reader.littleEndian = true;
    for (var i=0,len=bytes.length; i<len; ) {
      // Draw the character
      var val = bytes[i];
      if (val & 0x80) {
        // BIG-5 Chinese Character
        const chBig = reader.getWORD(i); //(bytes[i] | (bytes[i+1]<<8));
        if (shadow) {
          font.drawChar(chBig, PAL_XY(rect.x + 1, rect.y + 1), 0,ownedRead?binding=>ownedRead('font',null,binding):undefined);
          font.drawChar(chBig, PAL_XY(rect.x + 1, rect.y), 0,ownedRead?binding=>ownedRead('font',null,binding):undefined);
        }
        font.drawChar(chBig, PAL_XY(rect.x, rect.y), color,ownedRead?binding=>ownedRead('font',null,binding):undefined);
        i += 2;
        rect.x += 16;
        urect.w += 16;
      } else {
        // ASCII character
        const chAscii = bytes[i];
        if (shadow) {
          font.drawASCIIChar(chAscii, PAL_XY(rect.x + 1, rect.y + 1), 0,ownedRead?binding=>ownedRead('font',null,binding):undefined);
          font.drawASCIIChar(chAscii, PAL_XY(rect.x + 1, rect.y), 0,ownedRead?binding=>ownedRead('font',null,binding):undefined);
        }
        font.drawASCIIChar(chAscii, PAL_XY(rect.x, rect.y), color,ownedRead?binding=>ownedRead('font',null,binding):undefined);
        i++;
        rect.x += 8;
        urect.w += 8;
      }
    }

    // Update the screen area
    if (update && urect.w > 0) {
      //VIDEO_UpdateScreen(&urect);
      surface.updateScreen(urect);
    }
  };
  /**
   * Set the delay time for dialog.
   * @param {int} delay
   */
  ui.setDialogDelayTime = function(delay: number) {
    textLib.delayTime = delay;
  };

  /**
   * Start a new dialog.
   * @param  {DialogPosition} location
   * @param  {FontColor} color
   * @param  {int} charFaceNum
   * @param  {Boolean} playingRNG
   * @return {Promise}
   */
  /**
   * g_TextLib.iDialogShadow: shadow offset of the center window box. SDLPAL
   * keeps it 0 and only sets 5 around the "collect enemies into items" dialog
   * (script 0x0034).
   * @param  {int} offset
   */
  ui.setDialogShadow = function(offset: number) {
    textLib.dialogShadow = offset || 0;
  };

  // xOff / yOff shift the title and text like PAL_StartDialogWithOffset (0x0034 uses 0, -10).
  ui.startDialog = function(location: number, color: number, charFaceNum: number, playingRNG: boolean, xOff = 0, yOff = 0) {
    log.trace('[TEXT] startDialog(%d, %d, %d, %d)', location, color, charFaceNum, playingRNG);
    var rect = RECT(0, 0, 0, 0);
    const suppressLegacy = shouldSuppressLegacyDialog();

    if (worldService.isInBattle() && !text.updatedInBattle) {
      // Update the screen in battle, or the graphics may seem messed up
      surface.updateScreen(null);
      text.updatedInBattle = true;
    }

    textLib.icon = 0;
    textLib.posIcon = 0;
    textLib.currentDialogLine = 0;
    textLib.dialogTitlePos = PAL_XY(12, 8);
    // 每次 startDialog 是一个新的发言回合。说话人只在首行是「名字：」时才会被读到,
    // 之前不在这里重置 → 没有名字行的回合(或旁白)沿用上一个说话人。
    // 头像号和角色一一对应:见过「名字：」就记下 头像 → 名字,下次同头像直接用;
    // 没头像/没见过 → 置空,宁可不标也不标错。
    textLib.currentDialogFace = charFaceNum || 0;
    textLib.currentSpeakerName = (charFaceNum && textLib.faceSpeakers && textLib.faceSpeakers.get(charFaceNum)) || null;
    textLib.userSkip = false;

    // SDLPAL PAL_StartDialog does not restore the screen: whatever was drawn
    // stays until the script redraws (0x0005 / 0x008E) or the next frame.
    textLib.hasDialogBackup = false;
    textLib.dialogFaceBackup = null;
    textLib.dialogFaceRect = null;

    if (color != 0) {
      textLib.currentFontColor = color;
    }

    // SDLPAL PAL_StartDialog only latches fPlayingRNG when a face is shown too,
    // and never clears it here (only PAL_EndDialog does).
    if (playingRNG && charFaceNum) {
      if (!suppressLegacy && surface && typeof surface.backupScreen === 'function') {
        surface.backupScreen();
        textLib.hasDialogBackup = true;
      }
      textLib.playingRNG = true;
    }

    switch (location) {
      case DialogPosition.Upper:
        if (!suppressLegacy && charFaceNum > 0) {
          // Display the character face at the upper part of the screen
          var buf = RLE(text.RGM.readChunk(charFaceNum));
          if (buf) {
            rect.w = buf.width;
            rect.h = buf.height;
            rect.x = 48 - ~~(rect.w / 2);
            rect.y = 55 - ~~(rect.h / 2);

            if (rect.x < 0) {
               rect.x = 0;
            }
            if (rect.y < 0) {
               rect.y = 0;
            }

            // Clear previous face if it exists and wasn't already cleared
            // This prevents face overlap when dialogFaceBackup contains old face pixels
            if (textLib.dialogFaceBackup && textLib.dialogFaceRect &&
                surface && typeof surface.putRect === 'function') {
              const prevRect = textLib.dialogFaceRect;
              // Only restore if the old face position differs from new position
              if (prevRect.x !== rect.x || prevRect.y !== rect.y ||
                  prevRect.w !== rect.w || prevRect.h !== rect.h) {
                surface.putRect(textLib.dialogFaceBackup, prevRect.x, prevRect.y);
              }
            }

            if (surface && typeof surface.getRect === 'function') {
              textLib.dialogFaceRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
              textLib.dialogFaceBackup = surface.getRect(rect.x, rect.y, rect.w, rect.h);
            }
            surface.blitRLE(buf, PAL_XY(rect.x, rect.y));
            surface.updateScreen(rect);
            // For upper position, face is on the left, no right boundary needed
            textLib.dialogFaceLeftBoundary = null;
          } else {
            textLib.dialogFaceLeftBoundary = null;
          }
        } else {
          textLib.dialogFaceLeftBoundary = null;
        }
        textLib.dialogTitlePos = PAL_XY(charFaceNum > 0 ? 80 : 12, 8);
        textLib.dialogTextPos = PAL_XY(charFaceNum > 0 ? 96 : 44, 26);
        break;
      case DialogPosition.Center:
        textLib.dialogTextPos = PAL_XY(80, 40);
        break;
      case DialogPosition.Lower:
        if (!suppressLegacy && charFaceNum > 0) {
          // Display the character face at the lower part of the screen
          var buf = RLE(text.RGM.readChunk(charFaceNum));
          if (buf) {
            rect.x = 270 - ~~(buf.width / 2);
            rect.y = 144 - ~~(buf.height / 2);
            rect.w = buf.width;
            rect.h = buf.height;

            // Clear previous face if it exists and wasn't already cleared
            // This prevents face overlap when dialogFaceBackup contains old face pixels
            if (textLib.dialogFaceBackup && textLib.dialogFaceRect &&
                surface && typeof surface.putRect === 'function') {
              const prevRect = textLib.dialogFaceRect;
              // Only restore if the old face position differs from new position
              if (prevRect.x !== rect.x || prevRect.y !== rect.y ||
                  prevRect.w !== rect.w || prevRect.h !== rect.h) {
                surface.putRect(textLib.dialogFaceBackup, prevRect.x, prevRect.y);
              }
            }

            if (surface && typeof surface.getRect === 'function') {
              textLib.dialogFaceRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
              textLib.dialogFaceBackup = surface.getRect(rect.x, rect.y, rect.w, rect.h);
            }
            surface.blitRLE(buf, PAL_XY(rect.x, rect.y));
            surface.updateScreen(rect);
            // Store face left boundary for text wrapping (add 8px padding)
            textLib.dialogFaceLeftBoundary = rect.x - 8;
          } else {
            textLib.dialogFaceLeftBoundary = null;
          }
        } else {
          textLib.dialogFaceLeftBoundary = null;
        }
        textLib.dialogTitlePos = PAL_XY(charFaceNum > 0 ? 4 : 12, 108);
        textLib.dialogTextPos = PAL_XY(charFaceNum > 0 ? 20 : 44, 126);
        break;
      case DialogPosition.CenterWindow:
        textLib.dialogTextPos = PAL_XY(160, 40);
        break;
    }

    if (xOff || yOff) {
      textLib.dialogTitlePos = PAL_XY(PAL_X(textLib.dialogTitlePos) + xOff, PAL_Y(textLib.dialogTitlePos) + yOff);
      textLib.dialogTextPos = PAL_XY(PAL_X(textLib.dialogTextPos) + xOff, PAL_Y(textLib.dialogTextPos) + yOff);
    }

    textLib.dialogPosition = location;
  };

  /**
   * 对话框等待按键（快速跳过）
   * @return {Promise}
   */
  // maxSeconds > 0 closes the wait on its own after that long
  // (PAL_DialogWaitForKeyWithMaximumSeconds; the center window uses 1.4).
  function beginNativeDialogWait():NativeGeneratedDialogWait {
    log.trace('[TEXT] dialogWaitForKey');
    dialogService.setAwaitingInput(true, { position: textLib.dialogPosition });
    const suppressLegacy = shouldSuppressLegacyDialog();
    // get the current palette
    var nightPalette = false;
    var paletteEntry = null;
    var palette = null;
    if (!suppressLegacy) {
      var paletteId = getPaletteIdSnapshot();
      nightPalette = isNightPaletteEnabled();
      paletteEntry = Palette.get(paletteId);
      palette = utils.arrClone(nightPalette ? paletteEntry.night : paletteEntry.day);
    }
    var isCenter = (textLib.dialogPosition !== DialogPosition.CenterWindow &&
                    textLib.dialogPosition !== DialogPosition.Center);

    //surface.setPalette(palette);

    const allowLegacyPalette = !suppressLegacy &&
      textLib.dialogPosition !== DialogPosition.CenterWindow &&
      textLib.dialogPosition !== DialogPosition.Center;

    if (allowLegacyPalette) {
      // show the icon
      var p = textLib.dialogIcons.frames[textLib.icon];
      var rect = RECT(
        PAL_X(textLib.posIcon),
        PAL_Y(textLib.posIcon),
        p.width,
        p.height
      );
      if (p) {
        surface.blitRLE(p, textLib.posIcon);
        surface.updateScreen(null);
      }
    }

    // SDLPAL PAL_DialogWaitForKeyWithMaximumSeconds: clear the key state, then
    // any key press continues (or the optional time limit expires).
    const waitStartedAt = Date.now();
    generatedWaitRequest?.onAnchor?.();
    input.clear();
    return {generation:textGeneration,startedAt:waitStartedAt,suppressLegacy,allowLegacyPalette,nightPalette,paletteEntry,palette,position:textLib.dialogPosition};
  }
  function rotateNativeDialogWait(wait:NativeGeneratedDialogWait):void {
    if(wait.allowLegacyPalette&&wait.palette){
      var t=wait.palette[0xF9];
      for(var i=0xF9;i<0xFE;i++)wait.palette[i]=wait.palette[i+1];
      wait.palette[0xFE]=t;surface.setPalette(wait.palette);
    }
  }
  function checkNativeDialogInput(wait:NativeGeneratedDialogWait):boolean {
    if(input.keyPress===0)return false;
    const allowSimulated=(input as any).allowSimulatedConfirm===true ||
      (typeof globalThis!=='undefined'&&(globalThis as any).PAL_ALLOW_SIMULATED_DIALOG===true);
    if(!allowSimulated){
      if(typeof (input as any).isSimulatedInputActive==='function'&&(input as any).isSimulatedInputActive(250)){input.clear();return false;}
      const lastUserInputAt=Number.isFinite((input as any).lastUserInputAt)?(input as any).lastUserInputAt:0;
      if(!lastUserInputAt||lastUserInputAt<wait.startedAt){input.clear();return false;}
    }
    return true;
  }
  function finishNativeDialogWait(wait:NativeGeneratedDialogWait):void {
    if(wait.allowLegacyPalette&&wait.paletteEntry)surface.setPalette(wait.nightPalette?wait.paletteEntry.night:wait.paletteEntry.day);
    input.clear();textLib.userSkip=false;
    dialogService.setAwaitingInput(false,{position:textLib.dialogPosition});
  }
  function requireGeneratedWait(wait:NativeGeneratedDialogWait){
    const state=generatedWaits.get(wait);
    if(!state||state.finished||state.surface!==surface||state.ui!==ui||wait.generation!==textGeneration)throw new Error('Generated dialog wait binding changed');
    return state;
  }
  let generatedWaitRequest:{maximum:number;wait:NativeGeneratedDialogWait|null;onAnchor?:()=>void}|null=null;
  function runGeneratedDialogWait(maximum:number,onAnchor?:()=>void):NativeGeneratedDialogWait {
    if(generatedWaitRequest)throw new Error('Generated public wait cannot be reentered');
    const request={maximum,onAnchor,wait:null as NativeGeneratedDialogWait|null};generatedWaitRequest=request;
    try {
      const step=ui.dialogWaitForKey(maximum).next();
      if(!step.done||!request.wait)throw new Error('Generated public wait prefix changed');
      const wait=request.wait;generatedWaits.set(wait,{surface,ui,finished:false});return wait;
    }finally{generatedWaitRequest=null;}
  }
  ui.beginGeneratedDialogWait=(onAnchor?:()=>void):NativeGeneratedDialogWait=>runGeneratedDialogWait(1.4,onAnchor);
  ui.rotateGeneratedDialogWaitPalette=(wait:NativeGeneratedDialogWait)=>{requireGeneratedWait(wait);rotateNativeDialogWait(wait);};
  ui.checkGeneratedDialogInput=(wait:NativeGeneratedDialogWait,acknowledged=false)=>{requireGeneratedWait(wait);const allowed=(input as any).allowSimulatedConfirm===true||(globalThis as any).PAL_ALLOW_SIMULATED_DIALOG===true;return acknowledged&&allowed?true:checkNativeDialogInput(wait);};
  ui.finishGeneratedDialogWait=(wait:NativeGeneratedDialogWait)=>{const state=requireGeneratedWait(wait);finishNativeDialogWait(wait);state.finished=true;};

  ui.dialogWaitForKey = function*(maxSeconds = 0): Generator<unknown, void, unknown> {
    if(generatedWaitRequest){if(generatedWaitRequest.wait||generatedWaitRequest.maximum!==maxSeconds)throw new Error('Generated public wait arguments changed');generatedWaitRequest.wait=beginNativeDialogWait();return;}
    const wait=beginNativeDialogWait();
    const suppressLegacy=wait.suppressLegacy,waitStartedAt=wait.startedAt;

    while (true) {
      // IMPORTANT: Continue rendering scene during dialog wait (like xianjian's Timer)
      // Only do this in panorama mode where dialog is on HTML overlay,
      // so scene rendering won't overwrite the canvas dialog
      if (suppressLegacy) {
        const scene = global.scene;
        if (scene && typeof scene.makeScene === 'function') {
          try {
            scene.updatePartyGestures(false, { preserveFrames: true });
            yield* scene.makeScene();
            surface?.updateScreen(null);
          } catch (err) {
            // Ignore rendering errors during dialog wait
          }
        }
      }

      yield sleep(100);
      if (maxSeconds > 0 && Date.now() - waitStartedAt > maxSeconds * 1000) {
        break;
      }
      rotateNativeDialogWait(wait);
      if(checkNativeDialogInput(wait))break;
    }

    finishNativeDialogWait(wait);
  };

  /**
   * Show one line of the dialog text.
   * @param  {Uint8Array} buf
   * @return {Promise}
   */
/**
 * SDLPAL TEXT_DisplayText(..., isDialog=TRUE) used by the center window:
 * control codes are interpreted, digits use the yellow number sprites, the
 * text has no shadow, no per-character delay, and '"' does not change color.
 */
function drawCenterWindowText(buf: Uint8Array, x: number, y: number,ownedRead?:(site:string,index:number|null,value:any)=>void) {
  var len = buf.length;
  var offset = 0;
  while (offset < len) {
    var ch = buf[offset];
    switch (ch) {
      case 0x2D: // '-'
        textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.CYAN);
        offset++;
        break;
      case 0x27: // single quote
        textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.RED);
        offset++;
        break;
      case 0x40: // '@'
        textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.RED_ALT);
        offset++;
        break;
      case 0x22: // double quote: no color change in dialog mode
        offset++;
        break;
      case 0x24: // '$'
        textLib.delayTime = ~~(dialogControlNumber(buf, offset) * 10 / 7);
        offset += 3;
        break;
      case 0x7E: // '~'
        textLib.currentDialogLine = -1;
        textLib.userSkip = false;
        return;
      case 0x29: // ')'
        textLib.icon = 1;
        offset++;
        break;
      case 0x28: // '('
        textLib.icon = 2;
        offset++;
        break;
      case 0x5C: // backslash escape: draw the next character as is
        offset++;
        if (offset >= len) {
          return;
        }
        ch = buf[offset];
        // pass through
      default:
        var color = (textLib.currentFontColor == FontColor.DEFAULT) ? 0 : textLib.currentFontColor;
        if (ch & 0x80) {
          ui.drawText([buf[offset], buf[offset + 1]], PAL_XY(x, y), color, false, false,ownedRead);
          offset += 2;
          x += 16;
        } else {
          if (ch >= 0x30 && ch <= 0x39) {
            ui.drawNumber(ch - 0x30, 1, PAL_XY(x, y + 4), global.NumColor.Yellow, global.NumAlign.Left,ownedRead);
          } else {
            ui.drawText([ch], PAL_XY(x, y), color, false, false,ownedRead);
          }
          offset++;
          x += 8;
        }
    }
  }
}

function* renderDialogBuffer(buf: any,generatedRaw?:number[],ownedRead?:(site:string,index:number|null,value:any)=>void): Generator<unknown, NativeGeneratedDialogPrefix|void, unknown> {
  buf = toUint8Array(buf);
  // C strings end at the first NUL (wcslen in SDLPAL).
  const nulAt = buf.indexOf(0);
  if (nulAt >= 0) {
    buf = buf.subarray(0, nulAt);
  }
  var len = buf.length;
  log.trace('[TEXT] showDialogText (%d)', len);
  const renderStartedAt = Date.now();

  input.clear();
  textLib.icon = 0;
  var speakerCandidate = null;
  var decodedText = decodeDialogBuffer(buf);
  var publishText = decodedText;
  var isSpeakerLine = false;
  if (textLib.currentDialogLine === 0 &&
      textLib.dialogPosition !== DialogPosition.Center &&
      textLib.dialogPosition !== DialogPosition.CenterWindow &&
      len >= 2) {
    var lastByte = buf[len - 1];
    var prevByte = buf[len - 2];
    var hasColon = (lastByte === 0x47 && prevByte === 0xA1) || lastByte === 0x3A;
    if (hasColon) {
      var sliceLength = len - (lastByte === 0x3A ? 1 : 2);
      if (sliceLength > 0) {
        var slice = buf.subarray(0, sliceLength);
        var decodedSpeaker = decodeDialogBuffer(slice).trim();
        if (decodedSpeaker) {
          speakerCandidate = decodedSpeaker;
          textLib.currentSpeakerName = decodedSpeaker;
          isSpeakerLine = true;
          if (textLib.currentDialogFace) {
            if (!textLib.faceSpeakers) textLib.faceSpeakers = new Map();
            textLib.faceSpeakers.set(textLib.currentDialogFace, decodedSpeaker);
          }
        }
      }
    }
  }
  var speakerSource = textLib.currentSpeakerName || speakerCandidate || null;
  // The speaker-prefix strip and space collapse only shape the published text;
  // the screen gets the raw line exactly like SDLPAL.
  var publishBuf = buf;
  if (!isSpeakerLine && speakerSource) {
    const stripped = stripSpeakerPrefix(publishBuf, speakerSource);
    if (stripped !== publishBuf) {
      publishBuf = stripped;
      publishText = decodeDialogBuffer(publishBuf);
    }
  }
  const normalizedBuf = collapseDialogSpaces(publishBuf);
  if (normalizedBuf !== publishBuf) {
    publishBuf = normalizedBuf;
    publishText = decodeDialogBuffer(publishBuf);
  }
  var normalizedContent = publishText ? publishText.replace(/[：:]+\s*$/u, '').trim() : '';
  if (isSpeakerLine) {
    publishText = normalizedContent;
  }
  if (!isSpeakerLine || normalizedContent.length > 0) {
    dialogService.publishLine({
      text: publishText,
      position: textLib.dialogPosition,
      line: textLib.currentDialogLine,
      source: speakerSource
    });
  }
  const suppressLegacy = shouldSuppressLegacyDialog();

    if (worldService.isInBattle() && !text.updatedInBattle) {
      // Update the screen in battle, or the graphics may seem messed up
      //VIDEO_UpdateScreen(NULL);
      surface.updateScreen(null);
      text.updatedInBattle = true;
    }

    if (suppressLegacy) {
      if (textLib.currentDialogLine > 3) {
        // The rest dialogs should be shown in the next page.
        yield ui.dialogWaitForKey();
        textLib.currentDialogLine = 0;
      }
      if (textLib.dialogPosition === DialogPosition.CenterWindow) {
        if(generatedRaw)return generatedPrefix(generatedRaw);
        yield ui.dialogWaitForKey();
        yield ui.endDialog();
        return;
      }
      if (isSpeakerLine) {
        return;
      }
      var x = PAL_X(textLib.dialogTextPos);
      var y = PAL_Y(textLib.dialogTextPos) + textLib.currentDialogLine * 18;
      var offset = 0;
      while (offset < len && buf[offset] !== '\0') {
        var ch = buf[offset];
        switch (ch) {
          case '-'.charCodeAt(0):
            // Set the font color to Cyan
            textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.CYAN);
            offset++;
            break;
          case '\''.charCodeAt(0):
            // Set the font color to Red
            textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.RED);
            offset++;
            break;
          case '@'.charCodeAt(0):
            // Set the font color to the alternative red
            textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.RED_ALT);
            offset++;
            break;
          case '"'.charCodeAt(0):
            // Set the font color to Yellow
            textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.YELLOW);
            offset++;
            break;
          case '$'.charCodeAt(0):
            // Set the delay time of text-displaying
            var num = String.fromCharCode(buf[offset + 1]) + String.fromCharCode(buf[offset + 2]);
            textLib.delayTime = ~~(dialogControlNumber(buf, offset) * 10 / 7);
            offset += 3;
            break;
          case '~'.charCodeAt(0):
            // Delay for a period and quit
            var delayNum = String.fromCharCode(buf[offset + 1]) + String.fromCharCode(buf[offset + 2]);
            yield sleep(dialogControlNumber(buf, offset) * 80 / 7);
            textLib.currentDialogLine = 0;
            textLib.userSkip = false;
            return;
          case ')'.charCodeAt(0):
            // Set the waiting icon
            textLib.icon = 1;
            offset++;
            break;
          case '('.charCodeAt(0):
            // Set the waiting icon
            textLib.icon = 2;
            offset++;
            break;
          case '\\'.charCodeAt(0): // escape: draw the next character as is
            offset++;
            ch = buf[offset];
            // pass through
          default:
            if (ch & 0x80) {
              offset += 2;
              x += 16;
            } else {
              offset++;
              x += 8;
            }
            if (!textLib.userSkip) {
              input.clear();
              yield sleep(textLib.delayTime * 8);
              if (input.keyPress & (Key.Search | Key.Menu)) {
                if (typeof (input as any).isSimulatedInputActive === 'function' &&
                  (input as any).isSimulatedInputActive(250)) {
                  input.clear();
                } else {
                  const lastConfirmInputAt = Number.isFinite((input as any).lastConfirmInputAt)
                    ? (input as any).lastConfirmInputAt
                    : 0;
                  if (lastConfirmInputAt && lastConfirmInputAt >= renderStartedAt) {
                    // User pressed a key to skip the dialog
                    textLib.userSkip = true;
                  }
                }
              }
            }
          }
      }
      textLib.posIcon = PAL_XY(x, y);
      textLib.currentDialogLine++;
      return;
    }

    if (textLib.currentDialogLine > 3) {
      // The rest dialogs should be shown in the next page.
      yield ui.dialogWaitForKey();
      textLib.currentDialogLine = 0;
      //VIDEO_RestoreScreen();
      //VIDEO_UpdateScreen(NULL);
      surface.restoreScreen();
      surface.updateScreen(null);
    }
    var x = PAL_X(textLib.dialogTextPos);
    var y = PAL_Y(textLib.dialogTextPos) + textLib.currentDialogLine * 18;

    if (textLib.dialogPosition == DialogPosition.CenterWindow) {
      // The text should be shown in a small window at the center of the screen

      // IMPORTANT: In panorama mode, skip canvas rendering to avoid brief flash of dialog box
      if (shouldSuppressLegacyDialog()) {
        yield ui.dialogWaitForKey();
        yield ui.endDialog();
        return;
      }

      if (PAL_CLASSIC) {
        var battleState = getBattleStateSnapshot();
        if (worldService.isInBattle() && battleState && battleState.battleResult == BattleResult.OnGoing) {
          // uibattle.showText(buf, 1400);
        }
      }

      // Create the window box
      var pos = PAL_XY(PAL_X(textLib.dialogTextPos) - len * 4, PAL_Y(textLib.dialogTextPos));
      // SDLPAL passes fSaveScreen=FALSE ("follow behavior of original version"):
      // the box is not erased afterwards, the next redraw covers it.
      var box = ui.createSingleLineBox(pos, ~~((len + 1) / 2), false, textLib.dialogShadow || 0,ownedRead);
      var rect = new RECT(
        PAL_X(pos),
        PAL_Y(pos),
        surface.width - PAL_X(pos) * 2 + 32,
        64
      );

      // Show the text on the screen
      drawCenterWindowText(buf, PAL_X(pos) + 8 + ((len & 1) << 2), PAL_Y(pos) + 10,ownedRead);
      surface.updateScreen(rect);

      if(generatedRaw)return generatedPrefix(generatedRaw,box,rect);

      yield ui.dialogWaitForKey(1.4);

      // Delete the box
      box.free();
      //VIDEO_UpdateScreen(&rect);
      surface.updateScreen(rect);

      //PAL_EndDialog();
      yield ui.endDialog();
    } else {
      if (textLib.currentDialogLine == 0 &&
          textLib.dialogPosition != DialogPosition.Center &&
          ((buf[len - 1] == 0x47 && buf[len - 2] == 0xA1) || buf[len - 1] == 0x3A)) {
        // name of character (SDLPAL backs up only at the first text line, so
        // the name survives a page flip)
        //PAL_DrawText(lpszText, g_TextLib.posDialogTitle, FONT_COLOR_CYAN_ALT, TRUE, TRUE);
        ui.drawText(buf, textLib.dialogTitlePos, FontColor.CYAN_ALT, true, true);
      } else {
        // normal texts
        var texts = [];
        if (!textLib.playingRNG && textLib.currentDialogLine == 0 && !textLib.hasDialogBackup) {
          // Save the screen before we show the first line of dialog
          surface.backupScreen();
          textLib.hasDialogBackup = true;
        }
        var offset = 0;
        while (offset < len && buf[offset] !== '\0') {
          var ch = buf[offset];
          switch (ch) {
            case '-'.charCodeAt(0):
              // Set the font color to Cyan
              textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.CYAN);
              offset++;
              break;
            case '\''.charCodeAt(0):
              // Set the font color to Red
              textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.RED);
              offset++;
              break;
            case '@'.charCodeAt(0):
              // Set the font color to the alternative red
              textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.RED_ALT);
              offset++;
              break;
            case '"'.charCodeAt(0):
              // Set the font color to Yellow
              textLib.currentFontColor = toggleDialogColor(textLib.currentFontColor, FontColor.YELLOW);
              offset++;
              break;
            case '$'.charCodeAt(0):
              // Set the delay time of text-displaying
              //g_TextLib.iDelayTime = atoi(lpszText + 1) * 10 / 7;
              var num = String.fromCharCode(buf[offset + 1]) + String.fromCharCode(buf[offset + 2]);
              textLib.delayTime = ~~(dialogControlNumber(buf, offset) * 10 / 7);
              offset += 3;
              break;
            case '~'.charCodeAt(0):
              // Delay for a period and quit
              //UTIL_Delay(atoi(lpszText + 1) * 80 / 7);
              var num = String.fromCharCode(buf[offset + 1]) + String.fromCharCode(buf[offset + 2]);
              yield sleep(dialogControlNumber(buf, offset) * 80 / 7);
              textLib.currentDialogLine = 0;
              textLib.userSkip = false;
              return; // don't go further
            case ')'.charCodeAt(0):
              // Set the waiting icon
              textLib.icon = 1;
              offset++;
              break;
            case '('.charCodeAt(0):
              // Set the waiting icon
              textLib.icon = 2;
              offset++;
              break;
            case '\\'.charCodeAt(0): // escape: draw the next character as is
              offset++;
              ch = buf[offset];
              // pass through
            default:
              if (ch & 0x80) {
                texts = [buf[offset], buf[offset + 1],];
                offset += 2;
              } else {
                texts = [buf[offset]];
                offset++;
              }
              const charWidth = dialogGlyphWidth(texts[0]);
              ui.drawText(texts, PAL_XY(x, y), textLib.currentFontColor, true, true);
              x += charWidth;
              if (!textLib.userSkip) {
                input.clear();
                yield sleep(textLib.delayTime * 8);
                if (input.keyPress & (Key.Search | Key.Menu)) {
                  if (typeof (input as any).isSimulatedInputActive === 'function' &&
                    (input as any).isSimulatedInputActive(250)) {
                    input.clear();
                  } else {
                    const lastConfirmInputAt = Number.isFinite((input as any).lastConfirmInputAt)
                      ? (input as any).lastConfirmInputAt
                      : 0;
                    if (lastConfirmInputAt && lastConfirmInputAt >= renderStartedAt) {
                      // User pressed a key to skip the dialog
                      textLib.userSkip = true;
                    }
                  }
                }
              }
            }
        }
        textLib.posIcon = PAL_XY(x, y);
        textLib.currentDialogLine++;
      }
    }
  };

  ui.showDialogText = function*(buf: any, options: AnyRecord = {}): Generator<unknown, void, unknown> {
    const generated=generatedShowRequest;
    if(generated){if(generated.raw!==buf||generated.started)throw new Error('Generated publication cannot adopt a different or repeated source');generated.started=true;}
    var scriptMetadata = dialogService.consumePendingMetadata();
    var injectionContext = scriptMetadata && typeof scriptMetadata === 'object'
      ? {
        eventObjectId: Number.isFinite(scriptMetadata.eventObjectId) ? scriptMetadata.eventObjectId : null,
        sceneId: Number.isFinite(scriptMetadata.sceneId) ? scriptMetadata.sceneId : null
      }
      : {
        eventObjectId: null,
        sceneId: null
      };
    var currentBuffer = buf;
    var consumedInjectedLine = false;
    if (!options.skipInjected) {
      while (true) {
        var injected = dialogService.consumeInjectedLine(currentBuffer, injectionContext);
        if (!injected || !(injected.buffer instanceof Uint8Array)) {
          break;
        }
        var previousPosition = textLib.dialogPosition;
        if (Number.isFinite(injected.position)) {
          textLib.dialogPosition = injected.position;
        }
        if (injected.metadata) {
          dialogService.setPendingLineMetadata(injected.metadata);
        }
        yield* renderDialogBuffer(injected.buffer);
        if (Number.isFinite(injected.position)) {
          textLib.dialogPosition = previousPosition;
        }
        if (injected.skipOriginal) {
          currentBuffer = null;
          consumedInjectedLine = true;
          break;
        }
        consumedInjectedLine = true;
      }
    }
    if (currentBuffer && (!consumedInjectedLine || !options.onlyInjected)) {
      if (scriptMetadata) {
        dialogService.setPendingLineMetadata(scriptMetadata);
      }
      if(generated){const prefix=yield* renderDialogBuffer(currentBuffer,generated.raw,generated.ownedRead);generated.prefix=prefix||null;}
      else yield* renderDialogBuffer(currentBuffer);
    }
  };

  // The owned 0034 runner executes the real shared publication/render prefix
  // once, then owns the native wait state explicitly. Only fresh CenterWindow
  // lines qualify; this adapter does not broaden FFFF or injection support.
  ui.prepareGeneratedDialog = function*(raw:number[],ownedRead?:(site:string,index:number|null,value:any)=>void):Generator<unknown,NativeGeneratedDialogPrefix,unknown> {
    if(textLib.dialogPosition!==DialogPosition.CenterWindow || textLib.currentDialogLine!==0 || !Array.isArray(raw))throw new Error('Generated dialog requires fresh native CenterWindow');
    if(dialogService.hasInjectedLine(line=>!Number.isFinite(line.expiresAt as number)||line.expiresAt!>Date.now()))throw new Error('Generated dialog does not own injected lines');
    if(generatedShowRequest)throw new Error('Generated publication is already active');
    const request={raw,ownedRead,prefix:null as NativeGeneratedDialogPrefix|null,started:false};generatedShowRequest=request;
    try{yield ui.showDialogText(raw);}finally{generatedShowRequest=null;}
    if(!request.prefix)throw new Error('Generated dialog renderer did not reach window wait');
    return request.prefix;
  };
  ui.finishGeneratedDialog = function*(prefix:NativeGeneratedDialogPrefix):Generator<unknown,void,unknown> {
    const state=generatedPrefixes.get(prefix);
    if(!state||state.surface!==surface||state.ui!==ui||prefix.generation!==textGeneration)throw new Error('Generated dialog renderer binding changed');
    if(state.phase==='free'){prefix.box.free();state.phase='update';}
    if(state.phase==='update'){surface.updateScreen(prefix.rect);state.phase='end';}
    if(state.phase==='end'){yield ui.endDialog();state.phase='done';}
  };

  /**
   * Clear the state of the dialog.
   * @param  {Boolean} waitForKey
   * @return {Promise}
   */
  let generatedClearRequest:{started:boolean;wait:NativeGeneratedDialogWait|null;onAnchor?:()=>void}|null=null;
  ui.clearDialog = function*(waitForKey: boolean): Generator<unknown, void, unknown> {
    log.trace('[TEXT] clearDialog('+!!(waitForKey)+')')
    if(generatedClearRequest){if(generatedClearRequest.started||waitForKey!==true)throw new Error('Generated public clear arguments changed');generatedClearRequest.started=true;generatedClearRequest.wait=textLib.currentDialogLine>0?runGeneratedDialogWait(0,generatedClearRequest.onAnchor):null;return;}

    if (textLib.currentDialogLine> 0 && waitForKey) {
      yield ui.dialogWaitForKey();
    }

    finishNativeDialogClear();
  };

  function finishNativeDialogClear() {
    // SDLPAL PAL_ClearDialog only resets the dialog state; it never restores
    // the screen (scripts do that explicitly with 0x0005 / 0x008E).
    textLib.dialogFaceBackup = null;
    textLib.dialogFaceRect = null;
    textLib.hasDialogBackup = false;

    textLib.currentDialogLine = 0;

    if (textLib.dialogPosition === DialogPosition.Center) {
      textLib.dialogTitlePos = PAL_XY(12, 8);
      textLib.dialogTextPos = PAL_XY(44, 26);
      textLib.currentFontColor = FontColor.DEFAULT;
      textLib.dialogPosition = DialogPosition.Upper;
    }
    dialogService.setAwaitingInput(false);
  }
  ui.prepareGeneratedDialogClear=(onAnchor?:()=>void)=>{
    if(generatedClearRequest)throw new Error('Generated public clear cannot be reentered');
    const request={started:false,onAnchor,wait:null as NativeGeneratedDialogWait|null};generatedClearRequest=request;
    try{const step=ui.clearDialog(true).next();if(!step.done||!request.started)throw new Error('Generated public clear prefix changed');return request.wait;}
    finally{generatedClearRequest=null;}
  };
  ui.finishGeneratedDialogClear=()=>finishNativeDialogClear();

  ui.invalidateDialogBackup = function(reason?: string) {
    log.trace('[TEXT] invalidateDialogBackup', reason || '');
    textLib.hasDialogBackup = false;
    textLib.dialogFaceBackup = null;
    textLib.dialogFaceRect = null;
  };

  /**
   * Ends a dialog.
   * @return {Promise}
   */
  ui.endDialog = function*(): Generator<unknown, void, unknown> {
    log.trace('[TEXT] endDialog');
    yield ui.clearDialog(true);
    textLib.dialogTitlePos = PAL_XY(12, 8);
    textLib.dialogTextPos = PAL_XY(44, 26);
    textLib.currentFontColor = FontColor.DEFAULT;
    textLib.dialogPosition = DialogPosition.Upper;
    textLib.userSkip = false;
    textLib.currentSpeakerName = null;
    textLib.playingRNG = false;
    dialogService.clearDialog('endDialog');
  };

  /**
   * Check if there are dialog texts on the screen.
   * @return {Boolean} true if there are dialog texts on the screen, false if not.
   */
  ui.isInDialog = function(): boolean {
    return (textLib.currentDialogLine !== 0);
  };

  /**
   * Check if the script used the RNG playing parameter when displaying texts.
   * @return {Boolean} true if the script used the RNG playing parameter, false if not.
   */
  ui.dialogIsPlayingRNG = function(): boolean {
    return textLib.playingRNG;
  };
};

export default text;
