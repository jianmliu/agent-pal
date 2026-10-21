import type { RLEImage } from './rle';

export type UiGenerator<T = unknown> = Generator<unknown, T, unknown>;

export type UiDialogBuffer =
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | number[]
  | string;

export interface UiDialogTextOptions {
  skipInjected?: boolean;
  onlyInjected?: boolean;
}

export type UiSignal<T> = {
  value: T;
  subscribe: (listener: (value: T) => void) => () => void;
};

export type StatusMatrixRow = number[] | { uint8Array?: Uint8Array } | Record<string, unknown> | null;
export type StatusMatrix = StatusMatrixRow[];

export type BattleSprite = {
  getFrame: (index: number) => RLEImage;
};

export type BattlePlayerAction = {
  ActionType?: number;
  actionID?: number;
};

export type BattlePlayerState = {
  state?: number;
  timeMeter: number;
  action?: BattlePlayerAction | null;
};

export type BattleEnemyState = {
  objectID: number;
  pos: number;
  currentFrame: number;
  sprite: BattleSprite;
};

export type BattleStateSnapshot = {
  player: BattlePlayerState[];
  enemy: BattleEnemyState[];
  phase: number;
  enemyCleared: boolean;
  maxEnemyIndex: number;
  [key: string]: unknown;
};
export type BattleStateMutationEvent = {
  type?: string;
  state?: Record<string, unknown> | null;
  previous?: Record<string, unknown> | null;
  path?: Array<string | number | symbol>;
  value?: unknown;
  deleted?: boolean;
};

export interface UiMenuItem {
  value: number;
  wordNum: number;
  enabled: boolean;
  pos: number;
}

export interface UiMenuItemConstructor {
  new (value: number, wordNum: number, enabled: boolean, pos: number): UiMenuItem;
  (value: number, wordNum: number, enabled: boolean, pos: number): void;
  size?: number;
}

export interface UiBox {
  x: number;
  y: number;
  w: number;
  h: number;
  pos: number;
  save: () => void;
  free: () => void;
}

export interface UiBoxConstructor {
  new (x: number, y: number, w: number, h: number): UiBox;
  (x: number, y: number, w: number, h: number): void;
}

export interface UiObjectDesc {
  id: number;
  desc: UiDialogBuffer;
}

export interface UiObjectDescConstructor {
  new (id: number, desc: UiDialogBuffer): UiObjectDesc;
  (id: number, desc: UiDialogBuffer): void;
}

export interface UiMKF {
  name?: string | null;
  readChunk: (index: number) => Uint8Array;
  decompressChunk: (index: number) => Uint8Array;
  getChunkCount: () => number;
}

export interface UiResourceService {
  loadMKF: (...names: string[]) => Promise<UiMKF | UiMKF[]>;
  getMKF: (name: string) => UiMKF;
  loadObjectDesc: (filename: string) => Promise<UiObjectDesc[]>;
}

export interface UiSprite {
  frames: RLEImage[];
  getFrame: (index: number) => RLEImage;
}

export type UiRect = { x: number; y: number; w: number; h: number };

export interface UiSurface {
  byteBuffer: Uint8Array;
  panoramaHandler?: unknown;
  updateScreen: (rect?: UiRect) => void;
  blitRLE: (frame: RLEImage, pos: number, buf?: Uint8Array, nodebug?: boolean) => void;
  blitRLEMonoColor: (frame: RLEImage, pos: number, color?: number, colorShift?: number, buf?: Uint8Array, nodebug?: boolean) => void;
  blitRLEWithColorShift: (frame: RLEImage, pos: number, shift?: number, buf?: Uint8Array, nodebug?: boolean) => void;
  blitFBP: (buffer: Uint8Array, src: UiRect, dest: UiRect, buf?: Uint8Array) => void;
  backupScreen: () => void;
  putRect: (src: Uint8Array & { width?: number; height?: number }, x: number, y: number) => void;
  getRect: (x: number, y: number, w: number, h: number) => Uint8Array & { width?: number; height?: number };
}

export interface ItemMenuModule {
  numInventory: number;
  itemFlags: number;
  noDesc: boolean;
  init: (surface: UiSurface, ui: UiModule) => UiGenerator<void>;
  itemSelectMenuUpdate: () => number;
  itemSelectMenuInit: (itemFlags: number) => void;
  itemSelectMenu: (onChange: ((itemId: number) => void) | null, itemFlags: number) => UiGenerator<number>;
}

export interface MagicMenuItem {
  magic: number;
  MP: number;
  enabled: boolean;
  reset: (magic?: number, mp?: number, enabled?: boolean) => MagicMenuItem;
}

export interface MagicMenuModule {
  playerMP: number;
  currentItem: number;
  magicNum: number;
  magicItems: MagicMenuItem[];
  init: (surface: UiSurface, ui: UiModule) => UiGenerator<void>;
  magicSelectMenuUpdate: () => number;
  magicSelectMenuInit: (playerRole: number, inBattle: boolean, defaultMagic: number) => void;
  magicSelectMenu: (playerRole: number, inBattle: boolean, defaultMagic: number) => UiGenerator<number>;
}

export interface UIGameModule {
  init: (surface: UiSurface, ui: UiModule) => UiGenerator<void>;
  resetOpeningMenuBackground: () => void;
  drawOpeningMenuBackground: () => UiGenerator<void>;
  openingMenu: () => UiGenerator<number>;
  saveSlotMenu: (defaultSlot: number) => UiGenerator<number>;
  confirmMenu: () => UiGenerator<boolean>;
  switchMenu: (enabled: boolean) => UiGenerator<boolean>;
  battleSpeedMenu: () => UiGenerator<number | boolean>;
  showCash: (cash: number) => UiBox;
  systemMenu: () => UiGenerator<boolean | number>;
  inGameMagicMenu: () => UiGenerator<number>;
  inventoryMenu: () => UiGenerator<number>;
  inGameMenu: () => UiGenerator<number>;
  playerStatus: () => UiGenerator<void>;
  itemUseMenu: (itemToUse: number) => UiGenerator<number>;
  getItemUseMenuSelectedPlayer: () => number;
  buyMenu: (storeNum: number) => UiGenerator<number>;
  sellMenu: () => UiGenerator<number>;
  equipItemMenu: (item: number) => UiGenerator<number>;
  systemMenu_onItemChange: (currentItem: number) => void;
  inGameMenu_onItemChange: (currentItem: number) => void;
  buyMenu_onItemChange: (currentItem: number) => void;
  sellMenu_onItemChange: (currentItem: number) => void;
}

export interface UIBattleModule {
  init: (surface: UiSurface, battle: BattleRuntime, ui: UiModule) => UiGenerator<void>;
  dispose?: () => void;
  update: (policyKey?: number) => UiGenerator<void>;
  isActionValid: (actionType: number) => boolean;
  pickAutoMagic: (playerRole: number, randomRange: number) => number;
  useItem: () => void;
  throwItem: () => void;
  miscMenuUpdate: () => number;
  miscItemSubMenuUpdate: () => number;
  playerInfoBox: (pos: number, playerRole: number, timeMeter: number, timeMeterColor: number, update: boolean) => void;
  playerReady: (playerIndex: number) => void;
  drawMiscMenu: (currentItem: number, confirmed: boolean) => void;
  showText: (text: UiDialogBuffer, duration: number) => void;
  showNum: (num: number, pos: number, color: number) => void;
  frame: number;
  curMiscMenuItem: number;
  curSubMenuItem: number;
  _pendingStateMutation: BattleStateMutationEvent | null;
  lastStateMutation: BattleStateMutationEvent | null;
  battleServiceSubscription: ((event: BattleStateMutationEvent) => void) | null;
  autoBattleFlagSignal: UiSignal<boolean>;
  statusSlice: { player: UiSignal<StatusMatrix>; poison: UiSignal<StatusMatrix> };
  poisonStatusSignal: UiSignal<StatusMatrix>;
  battleStateUnsubscribe: (() => void) | null;
  battleStateCache: BattleStateSnapshot | null;
  ui: UiModule;
  itemmenu: ItemMenuModule;
  magicmenu: MagicMenuModule;
  surface: UiSurface;
  battle: BattleRuntime;
  TIMEMETER_COLOR_DEFAULT: number;
  TIMEMETER_COLOR_SLOW: number;
  TIMEMETER_COLOR_HASTE: number;
}

export interface UiModule {
  getNativeTextSnapshot: () => import('./text').NativeTextSnapshot;
  getNativeTextRuntimeBinding: () => import('./text').NativeTextRuntimeBinding;
  prepareGeneratedDialog: (raw:number[],ownedRead?:(site:string,index:number|null,value:any)=>void) => UiGenerator<import('./text').NativeGeneratedDialogPrefix>;
  finishGeneratedDialog: (prefix:import('./text').NativeGeneratedDialogPrefix) => UiGenerator<void>;
  prepareGeneratedDialogClear: () => import('./text').NativeGeneratedDialogWait|null;
  finishGeneratedDialogClear: () => void;
  beginGeneratedDialogWait: () => import('./text').NativeGeneratedDialogWait;
  rotateGeneratedDialogWaitPalette: (wait:import('./text').NativeGeneratedDialogWait) => void;
  checkGeneratedDialogInput: (wait:import('./text').NativeGeneratedDialogWait,acknowledged?:boolean) => boolean;
  finishGeneratedDialogWait: (wait:import('./text').NativeGeneratedDialogWait) => void;
  init: (surface: UiSurface, services?: unknown) => UiGenerator<void>;
  data?: UiMKF | null;
  sprite: UiSprite;
  surface: UiSurface;
  destDict: Record<string, unknown>;
  numFrames: Record<string | number, unknown[]>;
  services?: { resource?: UiResourceService; panorama?: unknown } | null;
  itemmenu?: ItemMenuModule;
  magicmenu?: MagicMenuModule;
  uigame?: UIGameModule;
  uibattle?: UIBattleModule;
  MenuItem: UiMenuItemConstructor;
  Box: UiBoxConstructor;
  ObjectDesc: UiObjectDescConstructor;
  createBox: (pos: number, rows: number, cols: number, style: number, saveScreen: boolean, shadowOffset?: number,ownedRead?:(site:string,index:number|null,value:any)=>void) => UiBox;
  createSingleLineBox: (pos: number, len: number, saveScreen: boolean, shadowOffset?: number,ownedRead?:(site:string,index:number|null,value:any)=>void) => UiBox;
  blitRLEShadow: (rle: unknown, pos: number) => void;
  drawNumber: (num: number, len: number, pos: number, color: number, align: number,ownedRead?:(site:string,index:number|null,value:any)=>void) => void;
  drawText: (text: UiDialogBuffer, pos: number, color: number, shadow: boolean, update: boolean,ownedRead?:(site:string,index:number|null,value:any)=>void) => void;
  drawItemText: (item: UiMenuItem, color: number, shadow: boolean, update: boolean,ownedRead?:(site:string,index:number|null,value:any)=>void) => void;
  loadObjectDesc: (filename: string) => UiGenerator<unknown>;
  getObjectDesc: (list: UiObjectDesc[] | unknown, id: number) => UiObjectDesc | null;
  readMenu: (
    onChange: ((currentItem: number) => void) | null,
    list: UiMenuItem[],
    defaultItem: number,
    labelColor: number,
    noCancel?: boolean
  ) => UiGenerator<number>;
  getWord: (wordNum: number) => Uint8Array | number[];
  getMsg: (msgNum: number) => Uint8Array | number[];
  setDialogDelayTime: (delay: number) => void;
  startDialog: (location: number, color: number, charFaceNum: number, playingRNG: boolean, xOff?: number, yOff?: number) => void;
  showDialogText: (buf: UiDialogBuffer, options?: UiDialogTextOptions) => UiGenerator<void>;
  clearDialog: (waitForKey: boolean) => UiGenerator<void>;
  invalidateDialogBackup: (reason?: string) => void;
  endDialog: () => UiGenerator<void>;
  dialogIsPlayingRNG: () => boolean;
  isInDialog: () => boolean;
  dialogWaitForKey: () => UiGenerator<void>;
  CHUNKNUM_SPRITEUI: number;
  MENUITEM_VALUE_CANCELLED: number;
  MENUITEM_COLOR: number;
  MENUITEM_COLOR_SELECTED: number;
  MENUITEM_COLOR_SELECTED_INACTIVE: number;
  MENUITEM_COLOR_SELECTED_FIRST: number;
  MENUITEM_COLOR_SELECTED_TOTALNUM: number;
  MENUITEM_COLOR_INACTIVE: number;
  MENUITEM_COLOR_CONFIRMED: number;
  MAX_PLAYER_EQUIPMENTS: number;
  MENUITEM_COLOR_EQUIPPEDITEM: number;
  DESCTEXT_COLOR: number;
  MAINMENU_BACKGROUND_FBPNUM: number;
  RIX_NUM_OPENINGMENU: number;
  MAINMENU_LABEL_NEWGAME: number;
  MAINMENU_LABEL_LOADGAME: number;
  LOADMENU_LABEL_SLOT_FIRST: number;
  CONFIRMMENU_LABEL_NO: number;
  CONFIRMMENU_LABEL_YES: number;
  CASH_LABEL: number;
  SWITCHMENU_LABEL_DISABLE: number;
  SWITCHMENU_LABEL_ENABLE: number;
  GAMEMENU_LABEL_STATUS: number;
  GAMEMENU_LABEL_MAGIC: number;
  GAMEMENU_LABEL_INVENTORY: number;
  GAMEMENU_LABEL_SYSTEM: number;
  SYSMENU_LABEL_SAVE: number;
  SYSMENU_LABEL_LOAD: number;
  SYSMENU_LABEL_MUSIC: number;
  SYSMENU_LABEL_SOUND: number;
  SYSMENU_LABEL_QUIT: number;
  SYSMENU_LABEL_BATTLEMODE: number;
  BATTLESPEEDMENU_LABEL_1: number;
  BATTLESPEEDMENU_LABEL_2: number;
  BATTLESPEEDMENU_LABEL_3: number;
  BATTLESPEEDMENU_LABEL_4: number;
  BATTLESPEEDMENU_LABEL_5: number;
  INVMENU_LABEL_USE: number;
  INVMENU_LABEL_EQUIP: number;
  STATUS_BACKGROUND_FBPNUM: number;
  STATUS_LABEL_EXP: number;
  STATUS_LABEL_LEVEL: number;
  STATUS_LABEL_HP: number;
  STATUS_LABEL_MP: number;
  STATUS_LABEL_ATTACKPOWER: number;
  STATUS_LABEL_MAGICPOWER: number;
  STATUS_LABEL_RESISTANCE: number;
  STATUS_LABEL_DEXTERITY: number;
  STATUS_LABEL_FLEERATE: number;
  STATUS_COLOR_EQUIPMENT: number;
  BUYMENU_LABEL_CURRENT: number;
  SELLMENU_LABEL_PRICE: number;
  EQUIPMENU_BACKGROUND_FBPNUM: number;
  ITEMUSEMENU_COLOR_STATLABEL: number;
  BATTLEWIN_GETEXP_LABEL: number;
  BATTLEWIN_BEATENEMY_LABEL: number;
  BATTLEWIN_DOLLAR_LABEL: number;
  BATTLEWIN_LEVELUP_LABEL: number;
  BATTLEWIN_ADDMAGIC_LABEL: number;
  BATTLEWIN_LEVELUP_LABEL_COLOR: number;
  SPRITENUM_CURSOR: number;
  SPRITENUM_CURSOR_YELLOW: number;
  SPRITENUM_ITEMBOX: number;
  SPRITENUM_SLASH: number;
  SPRITENUM_PLAYERINFOBOX: number;
  SPRITENUM_PLAYERFACE_FIRST: number;
  SPRITENUM_ARROW: number;
  BATTLE_LABEL_ESCAPEFAIL: number;
  TIMEMETER_COLOR_DEFAULT?: number;
}

export type PalRuntimeGlobal = typeof globalThis & {
  log?: typeof log;
  PAL_XY?: typeof PAL_XY;
  PAL_X?: typeof PAL_X;
  PAL_Y?: typeof PAL_Y;
  NumColor?: typeof NumColor;
  NumAlign?: typeof NumAlign;
  Files?: typeof Files;
  RECT?: typeof RECT;
  hrtime?: typeof hrtime;
  sleepByFrame?: typeof sleepByFrame;
  sleep?: typeof sleep;
  timestamp?: () => number;
  BattleFrameTime?: number;
  BattleUIState?: unknown;
  BattleMenuState?: unknown;
  BattleUIAction?: unknown;
  BattleResult?: unknown;
  FighterState?: unknown;
  BattleActionType?: unknown;
  BattlePhase?: unknown;
  itemmenu?: ItemMenuModule;
  magicmenu?: MagicMenuModule;
  uigame?: UIGameModule;
  uibattle?: UIBattleModule;
  ui?: UiModule;
  game?: unknown;
  scene?: unknown;
  text?: unknown;
  debugUtils?: unknown;
  battle?: BattleRuntime;
  services?: unknown;
};

export interface BattleRuntime {
  playerCheckReady: () => void;
  selectAutoTarget: () => number;
  isPlayerHealthy: (playerRole: number) => boolean;
  commitAction: (force: boolean) => void;
  playerPos: Array<Array<[number, number]>>;
}

export const globalRef = globalThis as PalRuntimeGlobal;
