/**
 * 等待点埋点的单元测试(docs/specs/agent-pal-waits.md W2,services/wait-points.ts)。
 * 不起引擎、不要资产:用真的 worldService / WorldWriter / 等待栈,引擎模块换成最小的假对象。
 * W2 的「零分叉」与逐步对照要资产(golden:verify),这里守住埋点自身的不变量:
 *  - withWait 在正常返回、抛错、被提前 return 时都出栈;嵌套时 token 单调递增
 *  - updateWait 只改同 token 的帧;写入出错只计数、不抛进游戏
 *  - 界面等待点:对话 / 文字菜单(光标跟踪 + 外层上下文)/ 任意键(超时)
 *  - 主循环:帧末栈空时声明 control、触发脚本 / 开战撤销 control(栈顶是菜单时不动)、读档清栈
 *  - 战斗:下指令 / 选目标 / 战斗内仙术菜单,同一阶段只更新载荷,换阶段换 token,自动战斗与战斗结束撤销
 *  - W4 回应(respondWait):stale / busy / invalid / unsupported 的校验;各类等待把回应换成同一套按键
 *    (列表菜单逐格移动再确认、网格菜单直接设光标、对话 / 任意键确认、只读界面取消、读不到光标的选人自己记位置);
 *    战斗回应每帧推进一步(动作 → 目标),仙术不可用时退回,战斗结束丢掉未完成的回应
 *
 * Run: pnpm --filter @onchainpal/game-engine test:wait-points
 */
import assert from 'node:assert/strict';
import worldService from '../services/world-service';
import { waitStack, WaitStackComponent } from '../ecs/components/wait';
import { Key } from '../services/input-service';
import {
  withWait, declareWait, updateWait, endWait, topWait, waitPointStats, respondWait,
  installUiWaitPoints, installMainLoopWaitPoints, installBattleWaitPoints
} from '../services/wait-points';

const stack = () => waitStack(worldService.getWorldWriter());
const depth = () => stack().depth();
/** 整个栈(top() 只给栈顶) */
const framesOf = (): any[] => {
  const w = worldService.getWorldWriter();
  return w.getOrCreate(w.world(), WaitStackComponent).frames;
};
const kinds = () => framesOf().map((f) => f.kind);
const reset = () => stack().clear();

/** 把生成器跑完;每次 yield 时调 onYield(用来在等待中途检查栈) */
function run<T>(gen: Generator<any, T, any>, onYield?: (i: number) => void): T {
  let i = 0;
  let r = gen.next();
  while (!r.done) { onYield?.(i++); r = gen.next(); }
  return r.value;
}
function* pause(n = 1) { for (let i = 0; i < n; i++) yield; }

// ---- ① withWait / declare / update / end --------------------------------------
function withWaitPopsOnEveryExit() {
  reset();
  const ret = run(withWait('anykey', () => ({ timeoutMs: null }), function* () {
    assert.equal(topWait()?.kind, 'anykey');
    yield* pause();
    return 42;
  }));
  assert.equal(ret, 42, 'the body result passes through');
  assert.equal(depth(), 0, 'popped after a normal return');

  assert.throws(() => run(withWait('dialog', () => ({ speaker: null, text: 'x' }), function* () {
    yield* pause();
    throw new Error('boom');
  })), /boom/);
  assert.equal(depth(), 0, 'popped after the body throws');

  const g = withWait('menu.screen', () => ({ title: 'status' }), function* () { yield* pause(5); return 1; });
  g.next();
  assert.equal(depth(), 1);
  g.return(undefined as any);
  assert.equal(depth(), 0, 'popped when the caller abandons the generator (.return())');
  console.log('  ✓ withWait pops on return / throw / early .return()');
}

function nestingAndTokens() {
  reset();
  const seen: number[] = [];
  run(withWait('menu.list', () => ({ title: null, items: [], index: 0, cancelable: true }), function* (outer) {
    seen.push(outer);
    yield* withWait('menu.party', () => ({ title: null, items: [], index: 0, cancelable: true }), function* (inner) {
      seen.push(inner);
      assert.deepEqual(kinds(), ['menu.list', 'menu.party']);
      yield* pause();
    });
    assert.equal(topWait()?.token, outer, 'the outer frame is on top again after the inner one ends');
    yield* withWait('dialog', () => ({ speaker: null, text: '' }), function* (third) { seen.push(third); yield* pause(); });
  }));
  assert.ok(seen[0] < seen[1] && seen[1] < seen[2], `tokens increase: ${seen}`);
  assert.equal(depth(), 0);
  const after = declareWait('anykey', { timeoutMs: null });
  assert.ok(after > seen[2], 'tokens keep increasing after frames are popped');
  reset();
  assert.ok(declareWait('anykey', { timeoutMs: null }) > after, 'clear() does not reset the token counter');
  reset();
  console.log('  ✓ nesting keeps the stack in call order; tokens are monotonic across pop / clear');
}

function updateOnlyTouchesItsToken() {
  reset();
  const a = declareWait('menu.list', { title: null, items: [], index: 0, cancelable: true });
  const b = declareWait('menu.list', { title: null, items: [], index: 0, cancelable: true });
  updateWait<'menu.list'>(a, { index: 3 });
  const [fa, fb] = framesOf();
  assert.equal(fa.payload.index, 3);
  assert.equal(fb.payload.index, 0, 'the other frame is untouched');
  const errors = waitPointStats.errors;
  updateWait(9999, { index: 1 } as any);   // 不在栈里:静默忽略
  updateWait(0, { index: 1 } as any);      // token 0 = 声明失败时的返回值:不做任何事
  endWait(0);
  assert.equal(waitPointStats.errors, errors, 'unknown / zero tokens are not errors');
  endWait(b);
  endWait(a);
  assert.equal(depth(), 0);
  console.log('  ✓ updateWait only changes its own frame; unknown / zero tokens are ignored');
}

function errorsAreCountedNotThrown() {
  reset();
  const before = waitPointStats.errors;
  // 载荷函数抛错:照样进入等待(空载荷),body 照跑
  const r = run(withWait('dialog', () => { throw new Error('payload broke'); }, function* () { yield* pause(); return 'ran'; }));
  assert.equal(r, 'ran');
  assert.equal(waitPointStats.errors, before + 1);
  assert.match(waitPointStats.lastError, /payload broke/);
  // 写入层抛错:声明返回 0,body 照跑,出栈是空操作
  const orig = worldService.getWorldWriter;
  (worldService as any).getWorldWriter = () => { throw new Error('writer down'); };
  try {
    let token = -1;
    const r2 = run(withWait('anykey', () => ({ timeoutMs: null }), function* (t) { token = t; yield* pause(); return 'still ran'; }));
    assert.equal(r2, 'still ran');
    assert.equal(token, 0, 'a failed declaration yields token 0');
    assert.equal(topWait(), null, 'topWait falls back to null');
  } finally {
    (worldService as any).getWorldWriter = orig;
  }
  assert.ok(waitPointStats.errors >= before + 3);
  assert.match(waitPointStats.lastError, /writer down/);
  assert.equal(depth(), 0);
  console.log('  ✓ payload / writer failures are counted in waitPointStats, never thrown into the game');
}

// ---- ② 界面等待点 -----------------------------------------------------------------
function uiWaitPoints() {
  reset();
  const ui: any = {
    getWord: (n: number) => `w${n}`,
    *dialogWaitForKey() { yield* pause(2); return 'dialog-done'; },
    *readMenu(onchange: any, list: any[], defaultItem: number) {
      yield;
      onchange && onchange(list[2].value);     // 光标移到第 3 项
      yield;
      return list[defaultItem].value;
    }
  };
  const uigame: any = {
    *systemMenu() { return yield* ui.readMenu(null, [{ wordNum: 1, value: 10 }, { wordNum: 2, value: 20, enabled: false }, { wordNum: 3, value: 30 }], 1, 0, false); }
  };
  const inputService: any = { *waitForKey(timeout: number) { yield* pause(); return timeout; } };
  const dialogService: any = { getCurrentLine: () => ({ source: '李逍遙', text: '嬸嬸!' }) };
  installUiWaitPoints({ ui, uigame, itemmenu: {}, magicmenu: {}, inputService, dialogService, scriptObjects: null });
  installUiWaitPoints({ ui, uigame, itemmenu: {}, magicmenu: {}, inputService, dialogService, scriptObjects: null });   // 装两次不叠加

  const r = run(ui.dialogWaitForKey(), () => {
    assert.deepEqual(kinds(), ['dialog'], 'installing twice must not wrap twice');
    assert.deepEqual(topWait()!.payload, { speaker: '李逍遙', text: '嬸嬸!' });
  });
  assert.equal(r, 'dialog-done');
  assert.equal(depth(), 0);

  const seen: any[] = [];
  const v = run(uigame.systemMenu(), () => seen.push({ ...(topWait()!.payload as any) }));
  assert.equal(v, 20);
  assert.equal(seen[0].context, 'system', 'the outer uigame menu labels the context');
  assert.equal(seen[0].index, 1, 'starts at the default item');
  assert.deepEqual(seen[0].items.map((it: any) => [it.label, it.value, it.enabled]), [['w1', 10, true], ['w2', 20, false], ['w3', 30, true]]);
  assert.equal(seen[0].cancelable, true);
  assert.equal(seen[1].index, 2, 'onchange moves the tracked cursor');
  assert.equal(depth(), 0);

  run(inputService.waitForKey(3000), () => assert.deepEqual(topWait()!.payload, { timeoutMs: 3000 }));
  run(inputService.waitForKey(0), () => assert.deepEqual(topWait()!.payload, { timeoutMs: null }));
  assert.equal(depth(), 0);
  console.log('  ✓ ui: dialog payload, menu.list items / cursor / context, anykey timeout; install is idempotent');
}

// ---- ③ 主循环 ---------------------------------------------------------------------
function mainLoopWaitPoints() {
  reset();
  worldService.setSceneId(3);
  worldService.setViewport(((100 << 16) | 200) >>> 0);
  worldService.setPartyOffset(((8 << 16) | 16) >>> 0);
  worldService.setPartyDirection(2);
  const calls: string[] = [];
  const play: any = { *startFrame() { yield; }, reloadInNextTick: () => calls.push('reload') };
  const scriptService: any = { runTriggerScript: () => { calls.push('trigger'); return 0; } };
  let finishBattle: () => void = () => {};
  const battleService: any = { startBattle: () => new Promise<void>((res) => { finishBattle = res; }) };
  installMainLoopWaitPoints({ play, scriptService, battleService });

  run(play.startFrame());
  assert.deepEqual(kinds(), ['control']);
  const ctl = topWait()!;
  assert.deepEqual(ctl.payload, { scene: 3, x: 216, y: 108, direction: 2 });
  run(play.startFrame());
  assert.equal(topWait()!.token, ctl.token, 'walking frames keep the same control token');
  worldService.setSceneId(4);
  run(play.startFrame());
  assert.equal(topWait()!.token, ctl.token);
  assert.equal((topWait()!.payload as any).scene, 4, 'a scene change updates the control payload');

  scriptService.runTriggerScript(1, 2);
  assert.deepEqual(calls, ['trigger']);
  assert.equal(depth(), 0, 'a trigger script drops control');
  run(play.startFrame());
  assert.ok(topWait()!.token > ctl.token, 'control is declared again (new token) once the frame ends idle');

  // 菜单里用物品也会跑脚本:栈顶不是 control 时不动
  const menu = declareWait('menu.items', { title: null, items: [], index: 0, cancelable: true, columns: 3, purpose: 'use' });
  scriptService.runTriggerScript(5, 6);
  assert.deepEqual(kinds(), ['control', 'menu.items'], 'a script run from a menu leaves the stack alone');
  run(play.startFrame());
  assert.equal(depth(), 2, 'no control is declared while something else is waiting');
  endWait(menu);

  battleService.startBattle(1, false);
  assert.equal(depth(), 0, 'starting a battle drops control');
  finishBattle();

  run(play.startFrame());
  declareWait('dialog', { speaker: null, text: '' });
  play.reloadInNextTick(1);
  assert.deepEqual(calls, ['trigger', 'trigger', 'reload']);
  assert.equal(depth(), 0, 'load / new game clears the stack');
  console.log('  ✓ main loop: control on idle frames (same token while walking), dropped by scripts / battles, cleared on load');
}

// ---- ④ 战斗 -----------------------------------------------------------------------
async function battleWaitPoints() {
  reset();
  let inBattle = true;
  const st = { enemy: [{ objectID: 0x18e, e: { health: 50 } }, null, { objectID: 0x18f, e: { health: 0 } }] };
  const u: any = { state: 1, menuState: 0, curPlayerIndex: 0, autoAttack: false, prevEnemyTarget: 2, selectedIndex: 0 };
  const battleService: any = { isInBattle: () => inBattle, getState: () => st, getUI: () => u };
  const uibattle: any = { *update() { yield; }, isActionValid: (a: number) => a !== 2 };
  const magicmenu: any = { magicNum: 1, magicItems: [{ magic: 0x127, MP: 10, enabled: true }], currentItem: 0 };
  const ui: any = { getWord: (n: number) => `w${n}` };
  installBattleWaitPoints({ uibattle, battleService, ui, itemmenu: {}, magicmenu, scriptObjects: null });

  run(uibattle.update());
  const cmd = topWait()!;
  assert.equal(cmd.kind, 'battle.command');
  const p = cmd.payload as any;
  assert.equal(p.stage, 'action');
  assert.deepEqual(p.actions, ['attack', 'magic', 'misc', 'defend', 'flee', 'repeat', 'auto'], 'invalid actions (coop here) are left out');
  assert.deepEqual(p.enemies, [{ index: 0, name: 'w398', hp: 50 }, { index: 2, name: 'w399', hp: 0 }]);
  assert.equal(p.lastTarget, 2);

  u.selectedIndex = 1;
  run(uibattle.update());
  assert.equal(topWait()!.token, cmd.token, 'same stage: payload updated in place');
  assert.equal((topWait()!.payload as any).selectedIndex, 1);

  u.state = 2;   // 选敌人
  run(uibattle.update());
  assert.ok(topWait()!.token > cmd.token, 'a new stage is a new wait');
  assert.equal((topWait()!.payload as any).stage, 'target-enemy');
  assert.equal(depth(), 1, 'the previous battle wait was ended, not stacked');

  u.state = 1; u.menuState = 1;   // 战斗里的仙术菜单
  run(uibattle.update());
  assert.equal(topWait()!.kind, 'menu.magic');
  assert.equal((topWait()!.payload as any).context, 'battle');
  assert.deepEqual((topWait()!.payload as any).items, [{ label: 'w295', value: 0x127, amount: 10, enabled: true }]);

  u.menuState = 0; u.autoAttack = true;
  run(uibattle.update());
  assert.equal(depth(), 0, 'auto-battle declares nothing');

  u.autoAttack = false; u.state = 0;   // 等待(动画中)
  run(uibattle.update());
  assert.equal(depth(), 0, 'nothing is declared while actions play out');

  u.state = 1;
  run(uibattle.update());
  assert.equal(depth(), 1);
  // 战斗结束:startBattle 的任务落定时撤销
  let done: () => void = () => {};
  const play: any = { *startFrame() { yield; } };
  const battleSvc2: any = { startBattle: () => new Promise<void>((res) => { done = res; }) };
  installMainLoopWaitPoints({ play, scriptService: { runTriggerScript() {} }, battleService: battleSvc2 });
  battleSvc2.startBattle();
  inBattle = false;
  done();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(depth(), 0, 'the battle wait is ended when startBattle settles');
  console.log('  ✓ battle: command / target / in-battle magic menu; same stage updates in place, new stage = new token; auto & battle end clear it');
}

// ---- ⑤ W4 回应 -------------------------------------------------------------------
const KEY_NAMES = new Map<number, string>([[Key.Search, 'Search'], [Key.Menu, 'Menu'], [Key.Up, 'Up'], [Key.Down, 'Down'],
  [Key.Defend, 'Defend'], [Key.Flee, 'Flee'], [Key.UseItem, 'UseItem']]);

/** 假的输入服务 + 列表菜单:每次恢复时读一次 keyPress(同真实的 readMenu 循环),Up / Down 移光标,确认返回值、取消返回 -1 */
function fakeUi() {
  const inp: any = { keyPress: 0, *waitForKey() { for (let i = 0; i < 5; i++) { yield; if (inp.keyPress & Key.Search) { inp.keyPress = 0; return 'pressed'; } } return 'timeout'; } };
  const pressed: string[] = [];
  const read = () => { const k = Number(inp.keyPress) || 0; inp.keyPress = 0; if (k) pressed.push(KEY_NAMES.get(k) || String(k)); return k; };
  const listLoop = function* (n: number, start: number, onMove?: (i: number) => void) {
    let i = start;
    for (let guard = 0; guard < 20; guard++) {
      yield;
      const k = read();
      if (k & Key.Down) { i = Math.min(n - 1, i + 1); onMove?.(i); }
      else if (k & Key.Up) { i = Math.max(0, i - 1); onMove?.(i); }
      else if (k & Key.Search) return i;
      else if (k & Key.Menu) return -1;
    }
    return 'stuck';
  };
  const ui: any = {
    getWord: (n: number) => `w${n}`,
    *dialogWaitForKey() { for (let g = 0; g < 5; g++) { yield; if (read() & Key.Search) return 'advanced'; } return 'stuck'; },
    *readMenu(onchange: any, list: any[], defaultItem: number) {
      const i = yield* listLoop(list.length, defaultItem, (j) => onchange && onchange(list[j].value));
      return typeof i === 'number' && i >= 0 ? list[i].value : i;
    }
  };
  const itemmenu: any = { numInventory: 0, itemSelectMenuInit() {}, itemSelectMenuUpdate() {},
    *itemSelectMenu() { for (let g = 0; g < 5; g++) { yield; const k = read(); if (k & Key.Search) return worldService.getInventoryMenuIndex(); if (k & Key.Menu) return -1; } return 'stuck'; } };
  const magicmenu: any = { magicNum: 0, magicItems: [], currentItem: 0, magicSelectMenuInit() {}, magicSelectMenuUpdate() {},
    *magicSelectMenu() { for (let g = 0; g < 5; g++) { yield; const k = read(); if (k & Key.Search) return magicmenu.currentItem; if (k & Key.Menu) return -1; } return 'stuck'; } };
  let itemUseCursor = 1;    // itemUseMenu 的光标可读(模块级),equipItemMenu 的读不到(局部,从 0 起)
  const uigame: any = {
    *playerStatus() { for (let g = 0; g < 5; g++) { yield; if (read() & Key.Menu) return 'closed'; } return 'stuck'; },
    *equipItemMenu() { return yield* listLoop(3, 0); },
    *itemUseMenu() { return yield* listLoop(3, itemUseCursor, (j) => { itemUseCursor = j; }); },
    getItemUseMenuSelectedPlayer: () => itemUseCursor
  };
  installUiWaitPoints({ ui, uigame, itemmenu, magicmenu, inputService: inp, dialogService: { getCurrentLine: () => null }, scriptObjects: null });
  return { ui, uigame, itemmenu, magicmenu, inp, pressed };
}

/** 进到等待里,第一次 yield 时回应,再把生成器跑完 */
function respondAndRun<T>(gen: Generator<any, T, any>, makeResponse: (token: number) => any): { value: T; result: any } {
  let result: any = null;
  const value = run(gen, (i) => { if (i === 0) result = respondWait(topWait()!.token, makeResponse(topWait()!.token)); });
  return { value, result };
}

function respondValidation() {
  reset();
  assert.deepEqual(respondWait(1, { advance: true }), { ok: false, reason: 'stale', note: 'nothing is waiting' });
  const ctl = declareWait('control', { scene: 1, x: 0, y: 0, direction: 0 });
  assert.equal((respondWait(ctl, { advance: true }) as any).reason, 'unsupported', 'walking is not answered through waits');
  const dlg = declareWait('dialog', { speaker: null, text: '' });
  assert.equal((respondWait(ctl, { advance: true }) as any).reason, 'stale', 'only the top of the stack can be answered');
  assert.equal((respondWait(dlg, { choose: 0 }) as any).reason, 'invalid');
  assert.deepEqual(respondWait(dlg, { advance: true }), { ok: true, token: dlg });
  assert.equal((respondWait(dlg, { advance: true }) as any).reason, 'busy', 'a second response before the first is consumed');
  endWait(dlg);

  const scr = declareWait('menu.screen', { title: 'status' });
  assert.equal((respondWait(scr, { advance: true }) as any).reason, 'invalid', 'a read-only screen only accepts cancel');
  assert.equal(respondWait(scr, { cancel: true }).ok, true);
  endWait(scr);

  const items = [{ label: 'a', enabled: true }, { label: 'b', enabled: false }, { label: 'c', enabled: true }];
  const menu = declareWait('menu.list', { title: null, items, index: 0, cancelable: false });
  for (const [r, why] of [[{ choose: 3 }, 'out of range'], [{ choose: -1 }, 'out of range'], [{ choose: 1.5 }, 'out of range'],
    [{ choose: 1 }, 'not selectable'], [{ cancel: true }, 'cannot be cancelled'], [{ advance: true }, 'accepts']] as const) {
    const res = respondWait(menu, r as any) as any;
    assert.equal(res.reason, 'invalid', JSON.stringify(r));
    assert.match(res.note, new RegExp(why));
  }
  assert.equal(respondWait(menu, { choose: 2 }).ok, true);
  endWait(menu);

  const cmd = declareWait('battle.command', { member: 0, role: 0, stage: 'action', actions: ['attack', 'magic', 'defend'],
    enemies: [{ index: 0, name: 'x', hp: 5 }, { index: 1, name: 'y', hp: 0 }], lastTarget: null, selectedIndex: null });
  const bad = (b: any, note: RegExp) => { const res = respondWait(cmd, { battle: b }) as any; assert.equal(res.reason, 'invalid'); assert.match(res.note, note); };
  bad({ action: 'coop' }, /not available/);
  bad({ action: 'attack', target: 1 }, /no living enemy/);
  bad({ action: 'attack', target: 7 }, /no living enemy/);
  bad({ action: 'magic' }, /needs \{ magic/);
  bad({ action: 'item' }, /needs \{ item/);
  assert.equal((respondWait(cmd, { advance: true }) as any).reason, 'invalid');
  assert.equal(respondWait(cmd, { battle: { action: 'attack', target: 0 } }).ok, true);
  reset();
  console.log('  ✓ respond: stale (not on top / nothing waiting), unsupported (control), invalid per kind, busy');
}

function respondUi() {
  reset();
  const f = fakeUi();
  const list = [{ wordNum: 1, value: 10 }, { wordNum: 2, value: 20 }, { wordNum: 3, value: 30 }, { wordNum: 4, value: 40 }];

  let r = respondAndRun(f.ui.readMenu(null, list, 0, 0, false), () => ({ choose: 2 }));
  assert.equal(r.result.ok, true);
  assert.equal(r.value, 30);
  assert.deepEqual(f.pressed.splice(0), ['Down', 'Down', 'Search'], 'list menu: arrow keys one cell at a time, then confirm');
  r = respondAndRun(f.ui.readMenu(null, list, 3, 0, false), () => ({ choose: 1 }));
  assert.equal(r.value, 20);
  assert.deepEqual(f.pressed.splice(0), ['Up', 'Up', 'Search'], 'moves up from the current cursor');
  r = respondAndRun(f.ui.readMenu(null, list, 1, 0, false), () => ({ cancel: true }));
  assert.equal(r.value, -1);
  assert.deepEqual(f.pressed.splice(0), ['Menu']);

  assert.equal(respondAndRun(f.ui.dialogWaitForKey(), () => ({ advance: true })).value, 'advanced');
  assert.equal(respondAndRun(f.inp.waitForKey(3000), () => ({ advance: true })).value, 'pressed');
  assert.equal(respondAndRun(f.uigame.playerStatus(), () => ({ cancel: true })).value, 'closed');
  assert.deepEqual(f.pressed.splice(0), ['Search', 'Menu'], 'dialog confirms, read-only screen cancels');

  // 网格菜单:直接设光标再确认
  r = respondAndRun(f.itemmenu.itemSelectMenu(null, 1), (t) => { updateWait<'menu.items'>(t, { items: [0, 1, 2, 3, 4].map((i) => ({ label: `i${i}`, enabled: true })) }); return { choose: 4 }; });
  assert.equal(r.value, 4, 'item grid: cursor set directly');
  f.magicmenu.currentItem = 0;
  r = respondAndRun(f.magicmenu.magicSelectMenu(0, false, 0), (t) => { updateWait<'menu.magic'>(t, { items: [0, 1, 2].map((i) => ({ label: `m${i}`, enabled: true })) }); return { choose: 2 }; });
  assert.equal(r.value, 2, 'magic grid: cursor set directly');
  assert.deepEqual(f.pressed.splice(0), ['Search', 'Search'], 'one confirm each, no arrow keys');

  // 选人:装备对象的光标读不到 —— 从 0 起自己数,并把记下的位置写回载荷
  let idxAfter = -1;
  const gen = f.uigame.equipItemMenu(0x3d);
  const v = run(gen, (i) => {
    if (i === 0) assert.equal(respondWait(topWait()!.token, { choose: 2 }).ok, true);
    if (i === 1) idxAfter = (topWait()!.payload as any).index;
  });
  assert.equal(v, 2);
  assert.equal(idxAfter, 2, 'the assumed cursor is written back to the payload');
  assert.deepEqual(f.pressed.splice(0), ['Down', 'Down', 'Search'], 'equip: counted from 0');
  assert.equal(framesOf().length, 0);
  // 用物品选人:光标可读(上次停在 1),从那里算步数
  r = respondAndRun(f.uigame.itemUseMenu(0x3d), () => ({ choose: 0 }));
  assert.equal(r.value, 0);
  assert.deepEqual(f.pressed.splice(0), ['Up', 'Search'], 'item-use: starts from the readable cursor (1), one step up');
  console.log('  ✓ respond (ui): list menus walk the cursor, grids set it, dialog / anykey confirm, screens cancel, untracked party cursor counted');
}

async function respondBattle() {
  reset();
  const f = fakeUi();   // 装好 inputService(按键注入的去处)
  const u: any = { state: 1, menuState: 0, curPlayerIndex: 0, autoAttack: false, prevEnemyTarget: null, selectedIndex: 0, selectedAction: null };
  const st = { enemy: [{ objectID: 0x18e, e: { health: 50 } }, { objectID: 0x18f, e: { health: 30 } }] };
  const setCalls: any[] = [];
  let inBattle = true;
  const battleService: any = { isInBattle: () => inBattle, getState: () => st, getUI: () => u, setUI: (p: any) => { setCalls.push(p); Object.assign(u, p); } };
  // 假的战斗界面:每帧读一次键,按界面阶段推进(主菜单确认 → 选敌人 → 提交)
  const uibattle: any = {
    isActionValid: () => true,
    *update() {
      yield;
      const k = Number(f.inp.keyPress) || 0;
      f.inp.keyPress = 0;
      if (k) f.pressed.push(KEY_NAMES.get(k) || String(k));
      if (u.state === 1 && u.menuState === 0 && (k & Key.Search)) {
        if (u.selectedAction === 1) u.menuState = 1; else u.state = 2;
      } else if (u.state === 1 && u.menuState === 1) {
        if (k & Key.Menu) u.menuState = 0; else if (k & Key.Search) u.state = 0;
      } else if (u.state === 2 && (k & Key.Search)) u.state = 0;   // 指令提交:回到等待
    }
  };
  const magicmenu = f.magicmenu;
  magicmenu.magicNum = 1; magicmenu.magicItems = [{ magic: 0x127, MP: 10, enabled: false }];
  installBattleWaitPoints({ uibattle, battleService, ui: f.ui, itemmenu: f.itemmenu, magicmenu, scriptObjects: null });
  const frame = () => run(uibattle.update());

  frame();
  const cmd = topWait()!;
  assert.equal(cmd.kind, 'battle.command');
  assert.equal(respondWait(cmd.token, { battle: { action: 'attack', target: 1 } }).ok, true);
  frame();
  assert.deepEqual(setCalls.splice(0), [{ selectedAction: 0, prevEnemyTarget: 1 }], 'frame 1: pick the attack action, remember the target');
  assert.equal(u.state, 2);
  assert.equal(topWait()!.kind, 'battle.command');
  assert.equal((respondWait(topWait()!.token, { battle: { action: 'defend' } }) as any).reason, 'busy', 'the attack is still being entered');
  frame();
  assert.deepEqual(setCalls.splice(0), [{ selectedIndex: 1 }], 'frame 2: aim at the requested enemy');
  assert.equal(u.state, 0, 'the command was submitted');
  assert.deepEqual(f.pressed.splice(0), ['Search', 'Search']);
  frame();
  assert.equal(depth(), 0, 'nothing is declared while the action plays out');

  // 仙术不可用:进了子菜单就退出来,回到选动作,不卡在菜单里
  u.state = 1; u.menuState = 0; u.selectedAction = null;
  frame();
  assert.equal(respondWait(topWait()!.token, { battle: { action: 'magic', magic: 0x127 } }).ok, true);
  frame();   // 主菜单:选「仙术」
  assert.equal(u.menuState, 1);
  frame();   // 仙术菜单:不可用 → 取消
  assert.equal(u.menuState, 0);
  assert.deepEqual(f.pressed.splice(0), ['Search', 'Menu']);
  frame();
  assert.equal(topWait()!.kind, 'battle.command', 'back to choosing an action');
  assert.equal((topWait()!.payload as any).stage, 'action');
  assert.equal(respondWait(topWait()!.token, { battle: { action: 'defend' } }).ok, true, 'and a new response is accepted');
  frame();   // 防御键按下去了,但假界面不推进:回应还在执行中
  assert.deepEqual(f.pressed.splice(0), ['Defend']);
  assert.equal((respondWait(topWait()!.token, { battle: { action: 'flee' } }) as any).reason, 'busy');

  // 战斗结束:未完成的回应丢掉,下一场不会接着执行
  let done: () => void = () => {};
  const play: any = { *startFrame() { yield; } };
  const bs2: any = { startBattle: () => new Promise<void>((res) => { done = res; }) };
  installMainLoopWaitPoints({ play, scriptService: { runTriggerScript() {} }, battleService: bs2 });
  bs2.startBattle();
  inBattle = false;
  done();
  await new Promise((r) => setTimeout(r, 0));
  inBattle = true;
  frame();
  assert.deepEqual(f.pressed.splice(0), [], 'the pending defend from the previous battle is not replayed');
  assert.equal(topWait()!.kind, 'battle.command');
  reset();
  console.log('  ✓ respond (battle): one step per frame (action → target), busy while entering, unusable magic backs out, battle end drops pending');
}

async function main() {
  withWaitPopsOnEveryExit();
  nestingAndTokens();
  updateOnlyTouchesItsToken();
  errorsAreCountedNotThrown();
  uiWaitPoints();
  mainLoopWaitPoints();
  await battleWaitPoints();
  respondValidation();
  respondUi();
  await respondBattle();
  console.log('wait-points smoke: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
