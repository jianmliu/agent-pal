import {hasBattleRewardService} from './battle-reward-runtime';
import {hasBattleRewardTask,rewardRunnerIdentity,installRewardWorldBeforeTrigger} from './battle-reward-fence';
import {ownedRewardWaitScope,type RewardWaitScope} from './battle-reward-wait';
import { battleCommandRuntime } from './battle-command-runtime';
/**
 * wait-points —— 引擎声明「我在等玩家做什么」(docs/specs/agent-pal-waits.md W2)。
 *
 * 纯埋点:只往等待栈(ecs/components/wait.ts,经 WorldWriter)写,不改任何游戏逻辑。
 * 写入出错只计数、记最后一条错误,绝不抛进游戏(waitPointStats)。
 *
 * 各等待点由其模块的初始化处调用 install*(把模块对象传进来,本模块不 import js/pal/*,避开循环依赖):
 *  - installUiWaitPoints     (game.init 末尾,所有模块已初始化、标题菜单之前):对话、文字菜单、物品格、仙术格、选人、只读界面、任意键、菜单上下文
 *  - installBattleWaitPoints (同上):战斗下指令 / 选目标 / 战斗内物品与仙术菜单
 *  - installMainLoopWaitPoints(同上):可行走(control)、触发脚本与开战时撤销 control、读档清栈
 *
 * 地图上施法选目标是 inGameMagicMenu 里的内联循环,在 uigame.ts 里就地声明(光标可跟踪)。
 * 装备选人的光标是局部变量,读不到(indexTracked=false;回应时按 0 起算自己数)。
 *
 * W4 回应(respondWait):外部对栈顶等待回应(带 token、校验),等待循环在下一次恢复执行前把回应换成按键 ——
 * 列表菜单按方向键逐格移到目标再确认,网格菜单直接设光标再确认,对话 / 任意键按确认,只读界面按取消;
 * 战斗在每帧 uibattle.update 前按当前阶段设界面字段并按键(同 fight.ts 的「重复」做法)。
 * 都走原有按键处理代码,人类按键路径不变;不改任何等待循环本身。
 */
import worldService from './world-service.js';
import { Key } from './input-service.js';
import { WaitStackComponent, waitStack } from '../ecs/components/wait.js';
import type { WaitKind, WaitPayloads, WaitChoiceItem, WaitFrame, WaitResponse } from '../ecs/components/wait.js';

export const waitPointStats = { declared: 0, errors: 0, lastError: '' };

function guard<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err: any) {
    waitPointStats.errors += 1;
    waitPointStats.lastError = String(err && err.message ? err.message : err);
    return fallback;
  }
}

const stack = () => waitStack(worldService.getWorldWriter());
const frameNow = () => guard(() => Number(worldService.getFrameCount()) || 0, 0);

export function declareWait<K extends WaitKind>(kind: K, payload: WaitPayloads[K]): number {
  return guard(() => {
    const token = stack().push(kind, payload, frameNow());
    waitPointStats.declared += 1;
    return token;
  }, 0);
}

export function updateWait<K extends WaitKind>(token: number, patch: Partial<WaitPayloads[K]>): void {
  if (token) guard(() => stack().update<K>(token, patch), false);
}

export function endWait(token: number): void {
  if (token) guard(() => stack().pop(token), false);
}

export function topWait(): WaitFrame | null {
  return guard(() => stack().top(), null);
}

/**
 * 逐次驱动生成器;每次恢复执行之前调用 beforeResume(W4:把回应换成按键注入,在循环读键之前生效)。
 * 与 yield* 等价地转发 next / throw / return。
 */
function* intercept<R>(gen: Generator<any, R, any>, beforeResume: () => void): Generator<any, R, any> {
  let result = gen.next();
  try {
    while (!result.done) {
      let sent: any;
      let error: unknown;
      let threw = false;
      try {
        sent = yield result.value;
      } catch (err) {
        threw = true;
        error = err;
      }
      guard(beforeResume, undefined);
      result = threw ? gen.throw(error) : gen.next(sent);
    }
    return result.value;
  } finally {
    if (!result.done && typeof gen.return === 'function') gen.return(undefined as any);
  }
}

/** 在等待中运行 body(生成器);退出(含 return / throw)时出栈。onResume:每次恢复前(处理回应) */
export function* withWait<K extends WaitKind, R>(
  kind: K,
  payloadFn: () => WaitPayloads[K],
  body: (token: number) => Generator<any, R, any>,
  onResume?: (token: number) => void
): Generator<any, R, any> {
  const token = declareWait(kind, guard(payloadFn, {} as WaitPayloads[K]));
  try {
    if (!onResume) return yield* body(token);
    return yield* intercept(body(token), () => onResume(token));
  } finally {
    plans.delete(token);
    endWait(token);
  }
}

// ---- W4 回应 -----------------------------------------------------------------
let inputRef: any = null;          // inputService(installUiWaitPoints 时注入)
/** 回应换成的按键序列(每次恢复按一个) */
const plans = new Map<number, number[]>();

/** 按一次键:与真实按键事件对 keyPress / 最近输入时间的效果相同;不动行走方向(否则菜单关后会一直走) */
function tap(key: number) {
  if (!inputRef) return;
  inputRef.keyPress = (Number(inputRef.keyPress) || 0) | key;
  const now = Date.now();
  inputRef.lastUserInputAt = now;
  if (key & (Key.Search | Key.Menu)) inputRef.lastConfirmInputAt = now;
}

/** 取走 token 的回应(只有它是栈顶时) */
function takeIfTop(token: number): WaitResponse | null {
  const top = topWait();
  if (!top || top.token !== token || !top.response) return null;
  return guard(() => stack().takeResponse(token), null);
}

/** 列表菜单(±1 移动):方向键逐格移到目标再确认;取消 = Menu */
function listPlan(response: WaitResponse, current: number): number[] {
  if ('cancel' in response) return [Key.Menu];
  if ('choose' in response) {
    const steps = response.choose - current;
    const arrows = new Array(Math.abs(steps)).fill(steps > 0 ? Key.Down : Key.Up);
    return [...arrows, Key.Search];
  }
  return [Key.Search];
}

/** 每次恢复前:按计划按一个键;没计划时看有没有新回应 */
function runPlan(token: number, makePlan: (r: WaitResponse) => number[] | null) {
  let plan = plans.get(token);
  if (!plan) {
    const response = takeIfTop(token);
    if (!response) return;
    plan = makePlan(response) || [];
    plans.set(token, plan);
  }
  const key = plan.shift();
  if (!plan.length) plans.delete(token);
  if (key) tap(key);
}

export type RespondResult =
  | { ok: true; token: number }
  | { ok: false; reason: 'stale' | 'busy' | 'invalid' | 'unsupported'; note?: string };

/**
 * 回应栈顶等待(agent-pal / 协议用)。token 必须是当前栈顶;回应须与 kind 匹配、选项在范围内且可选。
 * 回应在等待循环下一次恢复时生效(走与按键相同的处理代码)。
 */
export function respondWait(token: number, response: WaitResponse): RespondResult {
  return guard((): RespondResult => {
    const top = topWait();
    if (!top || top.token !== token) return { ok: false, reason: 'stale', note: top ? `top is ${top.kind}#${top.token}` : 'nothing is waiting' };
    if (battleCommandRuntime.owned && (top.kind === 'battle.command' || (top.payload as any)?.context === 'battle')) return { ok: false, reason: 'unsupported', note: 'owned battle requires numeric command runtime' };
    if (top.response || plans.has(token)) return { ok: false, reason: 'busy', note: 'a response is already pending' };
    if (pendingBattle && top.token === battleWait.token) return { ok: false, reason: 'busy', note: 'the previous battle command is still being entered' };
    const bad = validate(top, response);
    if (bad) return bad;
    const r = stack().respond(token, response);
    return r.ok ? { ok: true, token } : { ok: false, reason: r.reason };
  }, { ok: false, reason: 'invalid', note: 'internal error' });
}

function validate(top: WaitFrame, response: WaitResponse): RespondResult | null {
  const no = (reason: 'invalid' | 'unsupported', note: string): RespondResult => ({ ok: false, reason, note });
  const p: any = top.payload || {};
  switch (top.kind) {
    case 'control':
      return no('unsupported', 'walking is still done with keys');
    case 'dialog':
    case 'anykey':
      return 'advance' in response ? null : no('invalid', `${top.kind} accepts { advance }`);
    case 'menu.screen':
      return 'cancel' in response ? null : no('invalid', 'a read-only screen accepts { cancel }');
    case 'menu.list':
    case 'menu.items':
    case 'menu.magic':
    case 'menu.party': {
      if ('cancel' in response) return p.cancelable === false ? no('invalid', 'this menu cannot be cancelled') : null;
      if (!('choose' in response)) return no('invalid', `${top.kind} accepts { choose } or { cancel }`);
      const items: WaitChoiceItem[] = Array.isArray(p.items) ? p.items : [];
      const i = response.choose;
      if (!Number.isInteger(i) || i < 0 || i >= items.length) return no('invalid', `choose ${i} out of range 0..${items.length - 1}`);
      if (!items[i].enabled) return no('invalid', `item ${i} (${items[i].label}) is not selectable`);
      return null;
    }
    case 'battle.command': {
      if (!('battle' in response)) return no('invalid', 'battle.command accepts { battle }');
      const { action, target } = response.battle;
      const allowed = new Set([...(p.actions || []), 'item', 'throw']);
      if (!allowed.has(action)) return no('invalid', `action ${action} not available (${[...allowed].join(', ')})`);
      if ((action === 'attack' || action === 'coop' || action === 'throw') && target != null &&
          !(p.enemies || []).some((x: any) => x.index === target && x.hp > 0)) {
        return no('invalid', `no living enemy at index ${target}`);
      }
      if (action === 'magic' && response.battle.magic == null) return no('invalid', 'magic needs { magic: id }');
      if ((action === 'item' || action === 'throw') && response.battle.item == null) return no('invalid', `${action} needs { item: id }`);
      return null;
    }
    default:
      return no('unsupported', `unknown kind ${top.kind}`);
  }
}

// ---- 文本 ------------------------------------------------------------------
const big5 = (() => {
  try { return new TextDecoder('big5'); } catch { return null; }
})();

/** ui.getWord 返回 Big5 字节数组(附加词条可能是字符串)→ Unicode */
export function wordText(word: unknown): string {
  if (typeof word === 'string') return word.trim();
  if (Array.isArray(word) || word instanceof Uint8Array) {
    try {
      return big5 ? big5.decode(new Uint8Array(word as ArrayLike<number>)).replace(/\u0000/g, '').trim() : '';
    } catch {
      return '';
    }
  }
  return '';
}

// ---- 物品 / 仙术 / 队伍载荷 --------------------------------------------------
const ITEM_FLAG = { usable: 1, equipable: 2, throwable: 4, sellable: 32 };

function purposeOf(itemFlags: number): WaitPayloads['menu.items']['purpose'] {
  if (itemFlags & ITEM_FLAG.sellable) return 'sell';
  if (itemFlags & ITEM_FLAG.throwable) return 'throw';
  if (itemFlags & ITEM_FLAG.usable) return 'use';
  if (itemFlags & ITEM_FLAG.equipable) return 'equip';
  return 'other';
}

interface UiDeps { ui: any; scriptObjects: any }

function inventoryItems(deps: UiDeps, itemmenu: any, itemFlags: number): WaitChoiceItem[] {
  const inv = (worldService.getInventory() || []) as any[];
  const n = Math.min(Number(itemmenu.numInventory) || 0, inv.length);
  const out: WaitChoiceItem[] = [];
  for (let i = 0; i < n; i++) {
    const slot = inv[i] || {};
    const flags = guard(() => Number(deps.scriptObjects.getObjectEntry(slot.item)?.item?.flags) || 0, 0);
    const left = (Number(slot.amount) || 0) - (Number(slot.amountInUse) || 0);
    out.push({ label: wordText(deps.ui.getWord(slot.item)), value: Number(slot.item) || 0, amount: Number(slot.amount) || 0, enabled: !!(flags & itemFlags) && left > 0 });
  }
  return out;
}

function magicItems(deps: UiDeps, magicmenu: any): WaitChoiceItem[] {
  const n = Number(magicmenu.magicNum) || 0;
  return ((magicmenu.magicItems || []) as any[]).slice(0, n).map((m) => ({
    label: wordText(deps.ui.getWord(m.magic)),
    value: Number(m.magic) || 0,
    amount: Number(m.MP) || 0,
    enabled: !!m.enabled
  }));
}

/** 队员选项(选人类菜单用);uigame 的内联选人循环也直接用它 */
export function partyChoiceItems(ui: any): WaitChoiceItem[] {
  return partyItems({ ui, scriptObjects: null });
}

function partyItems(deps: UiDeps): WaitChoiceItem[] {
  const members = (worldService.getParty() || []).slice(0, (Number(worldService.getMaxPartyMemberIndex()) || 0) + 1) as any[];
  return members.map((m) => {
    const role = Number(m?.playerRole) || 0;
    const v = (k: string) => Number(worldService._getPlayerRoleArrayValue(k, role, 0)) || 0;
    return { label: `${wordText(deps.ui.getWord(v('name')))} HP${v('HP')}/${v('maxHP')} MP${v('MP')}/${v('maxMP')}`, value: role, enabled: true };
  });
}

// ---- 界面等待点 --------------------------------------------------------------
const contexts: string[] = [];
let activeItemMenu = { token: 0, itemFlags: 0, index: -1 };
let activeMagicMenu = { token: 0, index: -1 };

/** 在 ui.init 末尾调用(text / itemmenu / magicmenu / uigame 已初始化) */
export function installUiWaitPoints(mods: {
  ui: any; uigame: any; itemmenu: any; magicmenu: any; inputService: any; dialogService: any; scriptObjects: any;
}) {
  const { ui, uigame, itemmenu, magicmenu, inputService, dialogService, scriptObjects } = mods;
  const deps: UiDeps = { ui, scriptObjects };
  if (ui.__waitPoints) return;
  ui.__waitPoints = true;
  inputRef = inputService;
  const payloadIndex = (token: number) => {
    const top = topWait();
    return top && top.token === token ? Number((top.payload as any).index) || 0 : 0;
  };
  const confirmPlan = () => [Key.Search];

  // 对话:dialogWaitForKey 是唯一的「等推进」循环
  const origDialogWait = ui.dialogWaitForKey;
  ui.dialogWaitForKey = function* (...args: any[]) {
    return yield* withWait('dialog', () => {
      const line = dialogService.getCurrentLine?.() || null;
      return { speaker: line?.source ?? null, text: String(line?.text ?? '') };
    }, () => origDialogWait.apply(this, args), (token) => runPlan(token, confirmPlan));
  };

  // 文字菜单:光标经 onchange 回传
  const origReadMenu = ui.readMenu;
  ui.readMenu = function* (onchange: any, list: any, defaultItem: any, labelColor: any, nocancel: any) {
    const arr: any[] = Array.isArray(list) ? list : [];
    const start = Math.min(Math.max(Number(defaultItem) || 0, 0), Math.max(0, arr.length - 1));
    return yield* withWait('menu.list', () => ({
      title: null,
      items: arr.map((it) => ({ label: wordText(ui.getWord(it.wordNum)), value: Number(it.value) || 0, enabled: it.enabled !== false })),
      index: start,
      cancelable: !nocancel,
      context: contexts[contexts.length - 1]
    }), (token) => {
      const wrapped = (value: any) => {
        const i = arr.findIndex((it) => it.value === value);
        if (i >= 0) updateWait<'menu.list'>(token, { index: i });
        return onchange ? onchange(value) : undefined;
      };
      return origReadMenu.call(this, wrapped, list, defaultItem, labelColor, nocancel);
    }, (token) => runPlan(token, (r) => listPlan(r, payloadIndex(token))));
  };

  // 物品格(地图上):Init 之后才有 numInventory;每帧 Update 时若光标变了更新载荷
  const origItemInit = itemmenu.itemSelectMenuInit;
  itemmenu.itemSelectMenuInit = function (itemFlags: any) {
    const r = origItemInit.apply(this, arguments as any);
    if (activeItemMenu.token) {
      activeItemMenu.itemFlags = Number(itemFlags) || 0;
      updateWait<'menu.items'>(activeItemMenu.token, { items: guard(() => inventoryItems(deps, itemmenu, activeItemMenu.itemFlags), []), purpose: purposeOf(activeItemMenu.itemFlags) });
    }
    return r;
  };
  const origItemUpdate = itemmenu.itemSelectMenuUpdate;
  itemmenu.itemSelectMenuUpdate = function () {
    const r = origItemUpdate.apply(this, arguments as any);
    if (activeItemMenu.token) {
      const index = guard(() => Number(worldService.getInventoryMenuIndex()) || 0, 0);
      if (index !== activeItemMenu.index) {
        activeItemMenu.index = index;
        updateWait<'menu.items'>(activeItemMenu.token, { index });
      }
    }
    return r;
  };
  const origItemSelect = itemmenu.itemSelectMenu;
  itemmenu.itemSelectMenu = function* (onchange: any, itemFlags: any) {
    const prev = activeItemMenu;
    return yield* withWait('menu.items', () => ({
      title: null, items: [], index: 0, cancelable: true, columns: 3, purpose: purposeOf(Number(itemFlags) || 0), context: contexts[contexts.length - 1]
    }), (token) => {
      activeItemMenu = { token, itemFlags: Number(itemFlags) || 0, index: -1 };
      return (function* (self: any) {
        try { return yield* origItemSelect.call(self, onchange, itemFlags); }
        finally { activeItemMenu = prev; }
      })(this);
    }, (token) => runPlan(token, (r) => {
      if ('choose' in r) { worldService.setInventoryMenuIndex(r.choose); return [Key.Search]; }
      return 'cancel' in r ? [Key.Menu] : [Key.Search];
    }));
  };

  // 仙术格(地图上):同上,光标是 magicmenu.currentItem
  const origMagicInit = magicmenu.magicSelectMenuInit;
  magicmenu.magicSelectMenuInit = function () {
    const r = origMagicInit.apply(this, arguments as any);
    if (activeMagicMenu.token) updateWait<'menu.magic'>(activeMagicMenu.token, { items: guard(() => magicItems(deps, magicmenu), []) });
    return r;
  };
  const origMagicUpdate = magicmenu.magicSelectMenuUpdate;
  magicmenu.magicSelectMenuUpdate = function () {
    const r = origMagicUpdate.apply(this, arguments as any);
    if (activeMagicMenu.token) {
      const index = Number(magicmenu.currentItem) || 0;
      if (index !== activeMagicMenu.index) {
        activeMagicMenu.index = index;
        updateWait<'menu.magic'>(activeMagicMenu.token, { index });
      }
    }
    return r;
  };
  const origMagicSelect = magicmenu.magicSelectMenu;
  magicmenu.magicSelectMenu = function* (playerRole: any, inBattle: any, defaultMagic: any) {
    const prev = activeMagicMenu;
    return yield* withWait('menu.magic', () => ({
      title: null, items: [], index: 0, cancelable: true, columns: 3, caster: Number(playerRole) || 0, context: contexts[contexts.length - 1]
    }), (token) => {
      activeMagicMenu = { token, index: -1 };
      return (function* (self: any) {
        try { return yield* origMagicSelect.call(self, playerRole, inBattle, defaultMagic); }
        finally { activeMagicMenu = prev; }
      })(this);
    }, (token) => runPlan(token, (r) => {
      if ('choose' in r) { magicmenu.currentItem = r.choose; return [Key.Search]; }
      return 'cancel' in r ? [Key.Menu] : [Key.Search];
    }));
  };

  // uigame 外层菜单:只标上下文(里面的 readMenu / itemSelectMenu 带上它)
  const CONTEXTS: Record<string, string> = {
    openingMenu: 'opening', saveSlotMenu: 'save-slot', confirmMenu: 'confirm', switchMenu: 'switch',
    battleSpeedMenu: 'battle-speed', systemMenu: 'system', inventoryMenu: 'inventory', inGameMenu: 'in-game',
    buyMenu: 'buy', sellMenu: 'sell', inGameMagicMenu: 'magic'
  };
  for (const [fn, ctx] of Object.entries(CONTEXTS)) {
    const orig = uigame[fn];
    if (typeof orig !== 'function') continue;
    uigame[fn] = function* (...args: any[]) {
      contexts.push(ctx);
      try {
        if (fn !== 'inGameMagicMenu') return yield* orig.apply(this, args);
        // 地图施法选目标是 inGameMagicMenu 里的内联循环(uigame.ts 就地声明了 menu.party / magic-target):
        // 它的每次 yield 都经过这一层,在这里处理回应
        return yield* intercept(orig.apply(this, args), () => {
          const top = topWait();
          if (top && top.kind === 'menu.party' && (top.payload as any).context === 'magic-target') {
            runPlan(top.token, (r) => listPlan(r, Number((top.payload as any).index) || 0));
          }
        });
      }
      finally { const i = contexts.lastIndexOf(ctx); if (i >= 0) contexts.splice(i, 1); }
    };
  }

  // 选人 / 选装备对象:光标是局部变量(indexTracked=false)
  // 选人:itemUseMenu 的光标是模块级变量(getItemUseMenuSelectedPlayer 可读,跨调用保留);
  // equipItemMenu 的光标是局部变量(从 0 起),读不到 —— 回应时按自己记的位置算步数
  const partyMenu = (fn: string, context: string, title: (arg: any) => string, readIndex: (() => number) | null) => {
    const orig = uigame[fn];
    if (typeof orig !== 'function') return;
    uigame[fn] = function* (...args: any[]) {
      let assumed = 0;
      return yield* withWait('menu.party', () => ({
        title: title(args[0]), items: partyItems(deps), index: readIndex ? readIndex() : 0, indexTracked: !!readIndex, cancelable: true, context
      }), () => orig.apply(this, args), (token) => {
        if (readIndex) {
          const index = readIndex();
          if (index !== payloadIndex(token)) updateWait<'menu.party'>(token, { index });
        }
        runPlan(token, (r) => {
          const plan = listPlan(r, readIndex ? readIndex() : assumed);
          if ('choose' in r && !readIndex) { assumed = r.choose; updateWait<'menu.party'>(token, { index: r.choose }); }
          return plan;
        });
      });
    };
  };
  partyMenu('itemUseMenu', 'item-use', (item) => `use ${wordText(ui.getWord(item))}`,
    typeof uigame.getItemUseMenuSelectedPlayer === 'function' ? () => Number(uigame.getItemUseMenuSelectedPlayer()) || 0 : null);
  partyMenu('equipItemMenu', 'equip', (item) => `equip ${wordText(ui.getWord(item))}`, null);

  // 只读界面
  const origStatus = uigame.playerStatus;
  if (typeof origStatus === 'function') {
    uigame.playerStatus = function* (...args: any[]) {
      return yield* withWait('menu.screen', () => ({ title: 'status', context: 'status' }), () => origStatus.apply(this, args),
        (token) => runPlan(token, () => [Key.Menu]));
    };
  }

  // 任意键:waitForKey(0) = 一直等(结局、脚本 0x004D);带超时的(战斗结算 / 经验 / 升级画面 3–5.5s)也是
  // 「按一下就继续、不按到时也继续」,同样声明 —— 否则这段时间栈是空的,看起来像在忙,agent 不知道可以跳过
  const origWaitForKey = inputService.waitForKey;
  inputService.waitForKey = function* (timeout: number, capability?:unknown) {
    const scope=ownedRewardWaitScope(capability);
    if(scope)return yield* withOwnedRewardWait(scope,timeout,()=>origWaitForKey.call(this,timeout,scope));
    return yield* withWait('anykey', () => ({ timeoutMs: Number(timeout) > 0 ? Number(timeout) : null }), () => origWaitForKey.call(this, timeout),
      (token) => runPlan(token, confirmPlan));
  };
}

// ---- 战斗 --------------------------------------------------------------------
const UI_STATE = { wait: 0, selectMove: 1, targetEnemy: 2, targetPlayer: 3, targetEnemyAll: 4, targetPlayerAll: 5 };
const MENU_STATE = { main: 0, magic: 1, useItem: 2, throwItem: 3, misc: 4, miscItem: 5 };
const UI_ACTION = { attack: 0, magic: 1, coop: 2, misc: 3 };
let battleWait = { token: 0, key: '', payload: '' };
/** 正在执行的战斗回应(跨多帧:选动作 → 子菜单 → 选目标);当前队员的指令提交后清空 */
let pendingBattle: { member: number; response: WaitResponse; steps: number } | null = null;

/** 结束当前战斗等待(阶段切换时也会调用:多帧回应的计划要保留,只有 clearPending 时才丢) */
function endBattleWait(clearPending = false) {
  if (battleWait.token) endWait(battleWait.token);
  battleWait = { token: 0, key: '', payload: '' };
  if (clearPending) pendingBattle = null;
}

/** 在 battle 初始化 uibattle 之后调用 */
export function installBattleWaitPoints(mods: { uibattle: any; battleService: any; ui: any; itemmenu: any; magicmenu: any; scriptObjects: any }) {
  const { uibattle, battleService, ui, itemmenu, magicmenu, scriptObjects } = mods;
  const deps: UiDeps = { ui, scriptObjects };
  if (uibattle.__waitPoints) return;
  uibattle.__waitPoints = true;

  const compute = (): { kind: WaitKind; key: string; payload: any } | null => {
    if (!battleService.isInBattle()) return null;
    const st = battleService.getState?.();
    const u = battleService.getUI?.() || {};
    if (!st || u.autoAttack || u.state === UI_STATE.wait || u.state == null) return null;
    const member = Number(u.curPlayerIndex) || 0;
    const party = (worldService.getParty() || []) as any[];
    const role = Number(party[member]?.playerRole) || 0;
    if (u.state === UI_STATE.selectMove && u.menuState === MENU_STATE.magic) {
      return { kind: 'menu.magic', key: `magic:${member}`, payload: { title: null, items: magicItems(deps, magicmenu), index: Number(magicmenu.currentItem) || 0, cancelable: true, columns: 3, caster: role, context: 'battle' } };
    }
    if (u.state === UI_STATE.selectMove && (u.menuState === MENU_STATE.useItem || u.menuState === MENU_STATE.throwItem)) {
      const flags = u.menuState === MENU_STATE.useItem ? ITEM_FLAG.usable : ITEM_FLAG.throwable;
      return { kind: 'menu.items', key: `items:${member}:${u.menuState}`, payload: { title: null, items: inventoryItems(deps, itemmenu, flags), index: Number(worldService.getInventoryMenuIndex()) || 0, cancelable: true, columns: 3, purpose: purposeOf(flags), context: 'battle' } };
    }
    let stage: WaitPayloads['battle.command']['stage'] = 'action';
    if (u.state === UI_STATE.targetEnemy || u.state === UI_STATE.targetEnemyAll) stage = 'target-enemy';
    else if (u.state === UI_STATE.targetPlayer || u.state === UI_STATE.targetPlayerAll) stage = 'target-player';
    else if (u.menuState === MENU_STATE.misc || u.menuState === MENU_STATE.miscItem) stage = 'misc';
    const valid = (a: number) => guard(() => !!uibattle.isActionValid(a), false);
    const actions = [
      valid(UI_ACTION.attack) && 'attack', valid(UI_ACTION.magic) && 'magic', valid(UI_ACTION.coop) && 'coop', valid(UI_ACTION.misc) && 'misc',
      'defend', 'flee', 'repeat', 'auto'
    ].filter(Boolean) as string[];
    const enemies = ((st.enemy || []) as any[])
      .map((x, index) => (x && x.objectID ? { index, name: wordText(ui.getWord(x.objectID)), hp: Number(x.e?.health) || 0 } : null))
      .filter(Boolean) as WaitPayloads['battle.command']['enemies'];
    // 敌人刚被打光、结算画面还没出来的那几帧:不算等指令
    if (!enemies.some((x) => x.hp > 0)) return null;
    return {
      kind: 'battle.command',
      key: `cmd:${member}:${stage}`,
      payload: { member, role, stage, actions, enemies, lastTarget: u.prevEnemyTarget ?? null, selectedIndex: u.selectedIndex ?? null }
    };
  };

  const sync = () => guard(() => {
    if (battleCommandRuntime.owned) { endBattleWait(true); return; }
    const want = compute();
    if (!want) { endBattleWait(); return; }
    const payloadJson = JSON.stringify(want.payload);
    if (battleWait.token && battleWait.key === want.key) {
      if (payloadJson !== battleWait.payload) {
        updateWait(battleWait.token, want.payload);
        battleWait.payload = payloadJson;
      }
      return;
    }
    endBattleWait();
    battleWait = { token: declareWait(want.kind, want.payload), key: want.key, payload: payloadJson };
  }, undefined);

  // W4:战斗回应 —— 每帧 update 前按当前界面阶段推进一步(设界面字段 + 按键,同 fight.ts 的「重复」做法)
  const applyBattle = () => guard(() => {
    if (battleCommandRuntime.owned) { endBattleWait(true); return; }
    const top = topWait();
    if (!pendingBattle && top && top.token === battleWait.token && top.response) {
      const response = stack().takeResponse(top.token);
      if (response) pendingBattle = { member: Number(battleService.getUI?.()?.curPlayerIndex) || 0, response, steps: 0 };
    }
    if (!pendingBattle) return;
    const u = battleService.getUI?.() || {};
    // 当前队员的指令已提交(界面回到等待 / 轮到下一位)或出了战斗:完成
    if (!battleService.isInBattle() || u.state === UI_STATE.wait || (Number(u.curPlayerIndex) || 0) !== pendingBattle.member || pendingBattle.steps >= 12) {
      pendingBattle = null;
      return;
    }
    pendingBattle.steps += 1;
    const r = pendingBattle.response;
    const finish = () => { pendingBattle = null; };

    // 对战斗里的物品 / 仙术菜单本身的回应
    if ('cancel' in r) { tap(Key.Menu); finish(); return; }
    if ('choose' in r) {
      if (u.menuState === MENU_STATE.magic) magicmenu.currentItem = r.choose;
      else worldService.setInventoryMenuIndex(r.choose);
      tap(Key.Search);
      finish();
      return;
    }
    if (!('battle' in r)) { finish(); return; }

    const b = r.battle;
    const inMain = u.state === UI_STATE.selectMove && u.menuState === MENU_STATE.main;
    if (inMain) {
      switch (b.action) {
        case 'attack': battleService.setUI({ selectedAction: UI_ACTION.attack, ...(b.target != null ? { prevEnemyTarget: b.target } : {}) }); tap(Key.Search); return;
        case 'magic': battleService.setUI({ selectedAction: UI_ACTION.magic }); tap(Key.Search); return;
        case 'coop': battleService.setUI({ selectedAction: UI_ACTION.coop, ...(b.target != null ? { prevEnemyTarget: b.target } : {}) }); tap(Key.Search); return;
        case 'misc': battleService.setUI({ selectedAction: UI_ACTION.misc }); tap(Key.Search); finish(); return;   // 子菜单交给后续回应
        case 'defend': tap(Key.Defend); return;
        case 'flee': tap(Key.Flee); return;
        case 'repeat': tap(Key.Repeat); return;
        case 'auto': tap(Key.Auto); finish(); return;
        case 'item': tap(Key.UseItem); return;
        case 'throw': tap(Key.ThrowItem); return;
        default: finish(); return;
      }
    }
    if (u.state === UI_STATE.selectMove && u.menuState === MENU_STATE.magic) {
      const n = Number(magicmenu.magicNum) || 0;
      const idx = ((magicmenu.magicItems || []) as any[]).slice(0, n).findIndex((m) => Number(m.magic) === Number(b.magic));
      // 没学会 / 战时不可用 / MP 不够:退出子菜单,回到选动作(不卡在菜单里)
      if (idx < 0 || !magicmenu.magicItems[idx].enabled) { tap(Key.Menu); finish(); return; }
      magicmenu.currentItem = idx;
      tap(Key.Search);
      return;
    }
    if (u.state === UI_STATE.selectMove && (u.menuState === MENU_STATE.useItem || u.menuState === MENU_STATE.throwItem)) {
      const inv = (worldService.getInventory() || []) as any[];
      const idx = inv.findIndex((x) => x && Number(x.item) === Number(b.item));
      if (idx < 0) { tap(Key.Menu); finish(); return; }
      worldService.setInventoryMenuIndex(idx);
      tap(Key.Search);
      return;
    }
    if (u.state === UI_STATE.targetEnemy || u.state === UI_STATE.targetEnemyAll) {
      if (b.target != null && u.state === UI_STATE.targetEnemy) battleService.setUI({ selectedIndex: b.target });
      tap(Key.Search);
      return;
    }
    if (u.state === UI_STATE.targetPlayer || u.state === UI_STATE.targetPlayerAll) {
      if (u.state === UI_STATE.targetPlayer) battleService.setUI({ selectedIndex: b.target ?? 0 });
      tap(Key.Search);
      return;
    }
    finish();
  }, undefined);

  const origUpdate = uibattle.update;
  uibattle.update = function* (...args: any[]) {
    applyBattle();
    try { return yield* origUpdate.apply(this, args); }
    finally { sync(); }
  };
}

// ---- 主循环 ------------------------------------------------------------------
/** 在 game 主循环开始前调用 */
export function installMainLoopWaitPoints(mods: { play: any; scriptService: any; battleService: any }) {
  const { play, scriptService, battleService } = mods;
  if (play.__waitPoints) return;
  play.__waitPoints = true;
  // 诊断:无头 / 测试读得到埋点计数与最后一条错误(同 __PAL_SCRIPT_TRACE__ 的做法)
  (globalThis as any).__PAL_WAIT_STATS__ = waitPointStats;

  // 阻塞开始(触发脚本、开战):栈顶若是 control 就撤销;栈顶是菜单等则不动(菜单里用物品也会跑脚本)
  const dropControl = () => {
    const top = topWait();
    if (top && top.kind === 'control') endWait(top.token);
  };

  const origStartFrame = play.startFrame;
  play.startFrame = function* (...args: any[]) {
    const r = yield* origStartFrame.apply(this, args);
    // 一帧走完、没有别的等待:队伍可行走
    guard(() => {
      const top = topWait();
      const scene = Number(worldService.getSceneId()) || 0;
      if (!top) {
        const vp = Number(worldService.getViewport()) || 0;
        const off = Number(worldService.getPartyOffset()) || 0;
        declareWait('control', {
          scene,
          x: (vp & 0xffff) + (off & 0xffff),
          y: ((vp >> 16) & 0xffff) + ((off >> 16) & 0xffff),
          direction: Number(worldService.getPartyDirection()) || 0
        });
      } else if (top.kind === 'control' && (top.payload as WaitPayloads['control']).scene !== scene) {
        updateWait<'control'>(top.token, { scene });
      }
    }, undefined);
    return r;
  };

  installRewardWorldBeforeTrigger(dropControl);
  const origTrigger = scriptService.runTriggerScript;
  scriptService.runTriggerScript = function (...args: any[]) {
    if(hasBattleRewardService(scriptService))throw new Error('Native battle task is opaque');
    const module=Object.getOwnPropertyDescriptor(scriptService,'module')?.value;
    const identity=module&&rewardRunnerIdentity(module);
    if(identity&&hasBattleRewardTask(identity))throw new Error('Native battle task is opaque');
    dropControl();
    return origTrigger.apply(this, args);
  };

  const origStartBattle = battleService.startBattle;
  battleService.startBattle = function (...args: any[]) {
    dropControl();
    const task = origStartBattle.apply(this, args);
    if (task && typeof task.then === 'function') task.then(() => endBattleWait(true), () => endBattleWait(true));
    return task;
  };

  // 读档 / 新游戏:旧的等待作废
  const origReload = play.reloadInNextTick;
  if (typeof origReload === 'function') {
    play.reloadInNextTick = function (...args: any[]) {
      endBattleWait(true);
      guard(() => stack().clear(), undefined);
      return origReload.apply(this, args);
    };
  }
}

/** Strict metadata bridge limited to an issued live reward page capability. */
const rewardWaitTickets=new WeakMap<object,{writer:any;entity:number;token:number}>();
const existingRewardWorld=(writer:any):number|undefined=>writer.registry?writer.registry.getEntitiesByTag('world')[0]:writer.world();
export function* withOwnedRewardWait<R>(scope:RewardWaitScope,timeout:number,body:()=>Generator<any,R,any>):Generator<any,R,any> {
 if(ownedRewardWaitScope(scope)!==scope)throw new TypeError('unowned reward wait');
 if(!scope.active)throw new Error('reward wait retired');
 const writer=worldService.getWorldWriter(),entity=existingRewardWorld(writer);
 if(entity===undefined)throw new Error('reward wait world retired');
 let token:number|null=null,gen:Generator<any,R,any>|null=null,result:IteratorResult<any,R>|null=null,failed=false,primary:unknown;
 try{
  token=waitStack(writer).push('anykey',{timeoutMs:timeout},frameNow());scope.token=token;rewardWaitTickets.set(scope,{writer,entity,token});
  gen=body();result=gen.next();
  while(!result.done){
    const control=result.value===scope.gate;
    let sent:any,error:any,threw=false;
    try{sent=yield result.value;}catch(e){error=e;threw=true;}
    if(!control&&!threw){
      if(existingRewardWorld(writer)!==entity)throw new Error('reward wait world changed');
      const state=writer.peek(entity,WaitStackComponent),frame=state?.frames[state.frames.length-1];
      if(!state||frame?.token!==token||frame.kind!=='anykey'||(frame.payload as WaitPayloads['anykey']).timeoutMs!==timeout)throw new Error('reward wait scope changed');
      if(frame.response){writer.update(entity,WaitStackComponent,(current:any)=>({...current,frames:current.frames.map((f:any)=>f.token===token?{...f,response:null}:f)}));tap(Key.Search);}
    }
    result=threw?gen.throw(error):gen.next(sent);
  }
  return result.value;
 }catch(error){failed=true;primary=error;throw error;}finally{
  let teardownFailed=false,teardown:unknown;
  const attempt=(fn:()=>void)=>{try{fn();}catch(error){if(!teardownFailed){teardownFailed=true;teardown=error;}}};
  if(token!==null)plans.delete(token);
  attempt(()=>{if(gen&&result&&!result.done)gen.return(undefined as any);});
  attempt(()=>scope.close(failed?primary:teardown,()=>failed?primary:teardown));
  attempt(()=>{if(token===null||existingRewardWorld(writer)!==entity)return;const state=writer.peek(entity,WaitStackComponent);if(state?.frames.some((f:any)=>f.token===token))writer.update(entity,WaitStackComponent,(current:any)=>({...current,frames:current.frames.filter((f:any)=>f.token!==token)}));});
  rewardWaitTickets.delete(scope);
  if(teardownFailed&&!failed)throw teardown;
 }
}
export function rewardWaitMetadata(scope:RewardWaitScope):any {
 const ticket=rewardWaitTickets.get(scope),writer=worldService.getWorldWriter();
 if(!ticket||ticket.writer!==writer||existingRewardWorld(writer)!==ticket.entity)return {writer,frame:null};
 const state=writer.peek(ticket.entity,WaitStackComponent),frame=state?.frames[state.frames.length-1];
 return {writer,frame:frame?.token===scope.token?{token:frame.token,kind:frame.kind,payload:frame.payload,since:frame.since}:null};
}
