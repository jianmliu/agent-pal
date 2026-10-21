/** Agent-PAL 线协议 v0 的类型 —— 实现见 index.mjs,设计见 docs/specs/agent-pal.md §4。 */

export declare const PROTOCOL_VERSION: 0;
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Mode = 'control' | 'dialog' | 'menu' | 'battle' | 'busy' | 'crashed';
/** item = 对队员用物品,throw = 向敌人投掷物品(都带 item);combo = 合擊;siege 未实现 */
export type BattleActionType = 'attack' | 'magic' | 'item' | 'throw' | 'defend' | 'flee' | 'combo' | 'siege' | 'auto' | 'repeat';
export type Key = 'Up' | 'Down' | 'Left' | 'Right' | 'Search' | 'Menu' | 'UseItem' | 'ThrowItem' | 'Force' | 'Status' | 'Auto' | 'Defend' | 'Flee' | 'Repeat' | 'PageUp' | 'PageDown';
export type RejectReason = 'invalid' | 'wrong_mode' | 'cutscene' | 'blocked' | 'not_found' | 'unsupported' | 'failed';
export type Layer = 'pure' | 'assist';

export declare const DIRECTIONS: readonly Direction[];
export declare const MOVE_MAX_STEPS: 4;
export declare const BATTLE_ACTIONS: readonly BattleActionType[];
export declare const KEYS: readonly Key[];
export declare const MODES: readonly Mode[];
export declare const REJECT_REASONS: readonly RejectReason[];

type Seq = { seq?: number };
type IdOrName = number | string;

// ---- 客户端 → sim ----
export type ClientMsg = Seq & (
  | { op: 'CMSG_MOVE'; dir: Direction; steps?: number }
  | { op: 'CMSG_INTERACT' }
  | { op: 'CMSG_DIALOG_ADVANCE' }
  | { op: 'CMSG_CHOICE'; index: number }
  | { op: 'CMSG_MENU_USE_ITEM'; item: IdOrName; target?: number }
  | { op: 'CMSG_MENU_EQUIP'; item: IdOrName; target?: number }
  | { op: 'CMSG_MENU_MAGIC'; magic: IdOrName; target?: number }
  | { op: 'CMSG_SHOP_BUY'; item: IdOrName; amount?: number }
  | { op: 'CMSG_SHOP_SELL'; item: IdOrName; amount?: number }
  | { op: 'CMSG_SHOP_CLOSE' }
  | { op: 'CMSG_BATTLE_ACTION'; type: BattleActionType; member?: number; target?: number; magic?: IdOrName; item?: IdOrName }
  | { op: 'CMSG_SAVE'; slot: number; note?: string }
  | { op: 'CMSG_LOAD'; slot: number }
  | { op: 'CMSG_TICK'; n?: number }
  | { op: 'CMSG_KEY'; key: Key; ms?: number }
  | { op: 'CMSG_WAIT'; ms?: number }
);

// ---- sim → 客户端 ----
export interface ObjectInfo { id: number; gx: number; gy: number; kind: 'npc' | 'search-spot' | 'touch-trigger' | 'scenery'; triggerMode: number; blocking: boolean }
export interface PlayerInfo { gx: number; gy: number; facing: Direction | null }
export interface Member { roleId: number; name: string; level: number; hp: number; maxHp: number; mp: number; maxMp: number; status?: string[] }
export interface Item { id: number; name: string; amount: number }
export interface ChoiceItem { label: string; enabled: boolean; amount?: number; price?: number }
export interface Enemy { index: number; name: string; hp: number; maxHp: number | null }

export type ServerMsg =
  | { op: 'SMSG_HELLO'; version: number; mode: 'realtime' | 'lockstep'; layer: Layer; slot?: number | null; seed?: number | null }
  | { op: 'SMSG_CLOCK'; tick: number; vt?: number | null }
  | { op: 'SMSG_MODE'; mode: Mode; note?: string }
  | { op: 'SMSG_SCENE_ENTER'; scene: number; map: number | null; player: PlayerInfo; objects: ObjectInfo[] }
  | ({ op: 'SMSG_PLAYER_UPDATE' } & PlayerInfo)
  | { op: 'SMSG_OBJECT_UPDATE'; id: number; removed?: true; gx?: number; gy?: number; kind?: ObjectInfo['kind']; triggerMode?: number; blocking?: boolean }
  | { op: 'SMSG_PARTY_UPDATE'; members: Member[] }
  | { op: 'SMSG_INVENTORY_UPDATE'; items: Item[]; cash: number }
  | { op: 'SMSG_DIALOG'; speaker: string | null; text: string; waiting?: boolean }
  | { op: 'SMSG_CHOICE'; kind: string; title: string | null; items: ChoiceItem[]; index: number; depth?: number }
  | { op: 'SMSG_SHOP_OPEN'; items: ChoiceItem[] }
  | { op: 'SMSG_BATTLE_START'; enemies: Enemy[]; boss?: boolean; battle?: number }
  /** battle / prompt(引擎有战斗指令组件时才带):战斗实例编号与当前开放的提示身份(没有开放的提示为 null);回应凭 prompt 这份身份 */
  | { op: 'SMSG_BATTLE_STATE'; enemies: Enemy[]; party: Member[]; turn: { kind: 'command'; member: number } | { kind: 'auto' } | { kind: 'acting' }; battle?: number; prompt?: { context: string; battle: number; revision: number; member: number; role: number } | null }
  | { op: 'SMSG_BATTLE_PROMPT'; member: number; battle?: number; revision?: number }
  /** battle(START / EVENT / PROMPT / END 都带,引擎原生事件才有):战斗实例编号,每次开战加一,用来分清连打的几场。kind 'hp':{ side: 'enemy', index, name, from, to } | { side: 'party', roleId, name, from, to };'enemy_gone':{ index, name, killed }(killed = 被打倒;否则是逃跑) */
  | { op: 'SMSG_BATTLE_EVENT'; kind: 'hp' | 'enemy_gone' | string; [k: string]: unknown }
  | { op: 'SMSG_BATTLE_END'; result: 'won' | 'lost' | 'fled' | 'terminated' | string; cashDelta?: number; levelUps?: { name: string; from: number; to: number }[]; exp?: number; battle?: number; /** result 'error':战斗被引擎异常打断(不是胜负),error 是异常信息 */ error?: string }
  | { op: 'SMSG_FX'; kind: string }
  | { op: 'SMSG_CUTSCENE_BEGIN' }
  | { op: 'SMSG_CUTSCENE_END' }
  | { op: 'SMSG_ACK'; seq: number | null; note?: string }
  | { op: 'SMSG_REJECT'; seq: number | null; reason: RejectReason; note?: string }
  | { op: 'SMSG_GAME_OVER'; note?: string }
  | { op: 'SMSG_ENDING' };

export declare const CMSG: Readonly<Record<ClientMsg['op'], number>>;
export declare const SMSG: Readonly<Record<ServerMsg['op'], number>>;

export declare function opName(op: string | number): ClientMsg['op'] | ServerMsg['op'] | null;
export declare function opNumber(op: string | number): number | null;
export declare function isClientOp(op: string | number): boolean;
export declare function isServerOp(op: string | number): boolean;

export declare function parseClientMsg(input: unknown): { ok: true; msg: ClientMsg } | { ok: false; error: string; seq: number | null };
export declare function parseServerMsg(input: unknown): { ok: true; msg: ServerMsg } | { ok: false; error: string };
export declare function serialize(msg: ClientMsg | ServerMsg): string;
export declare function ack(seq: number | null | undefined, note?: string): Extract<ServerMsg, { op: 'SMSG_ACK' }>;
export declare function reject(seq: number | null | undefined, reason: RejectReason, note?: string): Extract<ServerMsg, { op: 'SMSG_REJECT' }>;
export declare function describe(): { version: number; client: Record<string, unknown>; server: Record<string, unknown> };
