import {resolveExecutionConfig} from './execution-config.mjs';
/**
 * engine — 无头启动经典仙剑引擎,并装上 agent 需要的探针。
 *
 * 复用 pal-tui 的 dom-shim / asset-server。探针:
 *  - 主循环心跳:包 play.startFrame,每帧 +1。剧情脚本/对白/菜单运行时主循环卡在
 *    某个 yield 里,心跳停;心跳在走 = 玩家有行走控制权。这是判断「轮到我了」的根信号。
 *  - 菜单截获:包 ui.readMenu(同 pal-tui),拿到选项原文 + 当前光标。
 *  - 帧缓冲:覆盖 Surface.updateScreen,留住最后一帧 byteBuffer + palette(截图用)。
 *  - 对白日志:订阅 dialogService 的 history 增量,收进无上限的 dialogLog。引擎的 history 只留最近 20 条,
 *    一次 advance 连推多屏过场(开场苗人那段就有 20+ 行)时最早的行会在被读到之前滚掉。
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { startAssetServer } from './asset-server.mjs';
import { installVirtualClock, installLocalAssetFetch } from './clock.mjs';
import { PACKAGED, userHome } from './paths.mjs';

const big5dec = (() => { try { return new TextDecoder('big5'); } catch { return null; } })();
function decodeWord(w) {
  if (typeof w === 'string') return w.replace(/ +$/, '').trim();
  if (Array.isArray(w) || w instanceof Uint8Array) {
    try { return (big5dec ? big5dec.decode(new Uint8Array(w)) : '').replace(/ +$/, '').trim(); } catch { return ''; }
  }
  return '';
}

function defaultAssetsDir() {
  // 打包版:资源只能由用户指定(不随包分发)
  if (PACKAGED) {
    const d = process.env.PAL_ASSET_DIR;
    if (!d || !(fs.existsSync(path.join(d, 'PAT.MKF')) || fs.existsSync(path.join(d, 'pat.mkf')))) {
      throw new Error(`找不到仙剑游戏资源${d ? `(${d} 里没有 PAT.MKF)` : ''}。用 --assets <目录> 或环境变量 PAL_ASSET_DIR 指向你自己的《仙剑奇侠传》DOS 版游戏目录(里面有 PAT.MKF、MAP.MKF、SSS.MKF 等文件)。`);
    }
    return d;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PAL_ASSET_DIR,
    path.resolve(here, '../pal-assets'),
    path.resolve(here, '../../pal-playground/public/pal-assets'),
    path.resolve(here, '../../pal-playground/dist/pal-assets')
  ].filter(Boolean);
  return candidates.find((d) => fs.existsSync(path.join(d, 'PAT.MKF')) || fs.existsSync(path.join(d, 'pat.mkf'))) || candidates[0];
}

/**
 * 启动引擎。console 必须先静音:MCP 走 stdout,引擎的 console.log 会污染协议流。
 *
 * 传 seed(或 AGENT_PAL_SEED)= 确定性模式:虚拟时钟 + 读盘 fetch + 引擎随机数设种(见 clock.mjs)。
 * 此后所有推进游戏的调用都要包在返回值的 drive() 里;非确定性模式下 drive 是恒等。
 * @param {{assets?: string, log?: (s: string) => void, seed?: number, savesFile?: string, commandProfile?: 'legacy' | 'owned-command', battleScriptProfile?: 'legacy' | 'owned-parent', battleExecutionProfile?: 'legacy' | 'round-boundary', battlePoisonScriptProfile?: 'legacy' | 'owned-cursor', battleEnemyScriptProfile?: 'legacy' | 'owned-cursor', battlePreBattleScriptProfile?: 'legacy' | 'owned-cursor', battleEndScriptProfile?: 'legacy' | 'owned-cursor', battleRewardProfile?: 'legacy' | 'owned-cursor'}} opts
 */
export async function bootEngine(opts = {}) {
  const profile = opts.commandProfile ?? 'legacy';
  if (profile !== 'legacy' && profile !== 'owned-command') throw new TypeError('unknown battle command profile');
  const scriptProfile = opts.battleScriptProfile ?? 'legacy';
  if (scriptProfile !== 'legacy' && scriptProfile !== 'owned-parent') throw new TypeError('unknown battle script profile');
  const executionProfile = opts.battleExecutionProfile ?? 'legacy';
  if (executionProfile !== 'legacy' && executionProfile !== 'round-boundary') throw new TypeError('unknown battle execution profile');
  if (executionProfile === 'round-boundary' && (profile !== 'owned-command' || scriptProfile !== 'owned-parent')) throw new TypeError('round-boundary requires owned-command and owned-parent');
  const poisonProfile = opts.battlePoisonScriptProfile ?? 'legacy';
  if (poisonProfile !== 'legacy' && poisonProfile !== 'owned-cursor') throw new TypeError('unknown battle poison script profile');
  if (poisonProfile === 'owned-cursor' && (executionProfile !== 'round-boundary' || profile !== 'owned-command' || scriptProfile !== 'owned-parent')) throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
  const enemyProfile = opts.battleEnemyScriptProfile ?? 'legacy';
  if (enemyProfile !== 'legacy' && enemyProfile !== 'owned-cursor') throw new TypeError('unknown battle enemy script profile');
  if (enemyProfile === 'owned-cursor' && (executionProfile !== 'round-boundary' || profile !== 'owned-command' || scriptProfile !== 'owned-parent')) throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
  const preBattleProfile = opts.battlePreBattleScriptProfile ?? 'legacy';
  if (preBattleProfile !== 'legacy' && preBattleProfile !== 'owned-cursor') throw new TypeError('unknown battle prebattle script profile');
  if (preBattleProfile === 'owned-cursor' && (executionProfile !== 'round-boundary' || profile !== 'owned-command' || scriptProfile !== 'owned-parent')) throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
  const endProfile = opts.battleEndScriptProfile ?? 'legacy';
  if (endProfile !== 'legacy' && endProfile !== 'owned-cursor') throw new TypeError('unknown battle end script profile');
  if (endProfile === 'owned-cursor' && (executionProfile !== 'round-boundary' || profile !== 'owned-command' || scriptProfile !== 'owned-parent')) throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
  const rewardProfile = opts.battleRewardProfile ?? 'legacy';
  if (rewardProfile !== 'legacy' && rewardProfile !== 'owned-cursor') throw new TypeError('unknown battle reward profile');
  if (rewardProfile === 'owned-cursor' && (executionProfile !== 'round-boundary' || profile !== 'owned-command' || scriptProfile !== 'owned-parent')) throw new TypeError('owned-cursor requires round-boundary, owned-command and owned-parent');
  const execution = resolveExecutionConfig(opts);
  const seed = execution.seed;
  const clock = execution.virtualClock ? installVirtualClock({presentationPace:execution.presentationPace}) : null;
  opts = {...opts, speed: execution.speed, advancePolicy:execution.advancePolicy, presentationPace:execution.presentationPace};
  return clock ? clock.drive(bootInner(opts, clock, seed, preBattleProfile, endProfile, rewardProfile)) : bootInner(opts, null, seed, preBattleProfile, endProfile, rewardProfile);
}

async function bootInner(opts, clock, seed, preBattleProfile, endProfile, rewardProfile) {
  // 动态 import 是真实 I/O:确定性模式下期间冻结虚拟时间
  // 传入 () => import('字面量'):打包工具(esbuild)只认字面量的动态 import,变量路径会让引擎漏打进 npx 包
  const load = (imp) => (clock ? clock.hold(imp()) : imp());
  const log = opts.log || ((s) => process.stderr.write(s + '\n'));
  const noop = () => {};
  if (process.env.AGENT_PAL_TRACE === '1') {
    const toErr = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
    console.log = console.info = console.debug = console.warn = console.error = toErr;
  } else {
    console.log = console.info = console.debug = console.warn = console.error = noop;
  }

  const assetsDir = opts.assets ? path.resolve(opts.assets) : defaultAssetsDir();
  const asset = await startAssetServer(assetsDir);
  process.env.PAL_ASSET_BASE = asset.base;
  log(`[agent-pal] 资源服务 ${asset.base} ← ${assetsDir}`);

  await load(() => import('./dom-shim.mjs'));
  if (clock) installLocalAssetFetch(asset.base, assetsDir);
  // dom-shim 的 localStorage 是空壳 → 存档写了就丢。必须在 storage-service 构造前换成落盘版。
  const savesFile = opts.savesFile || process.env.AGENT_PAL_SAVES
    || (PACKAGED ? path.join(userHome(), 'saves.json') : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'saves', 'saves.json'));
  fs.mkdirSync(path.dirname(savesFile), { recursive: true });
  globalThis.window.localStorage = fileStorage(savesFile);

  const probes = {
    frames: 0, heartbeat: 0, heartbeatAt: 0, surface: null,
    menuStack: [], get menu() { return this.menuStack[this.menuStack.length - 1] || null; },
    pendingLoad: null,
    ctx: []                      // 菜单所处场景(buy / magic …),给通用菜单加注解用
  };
  const withCtx = (ctx) => { probes.ctx.push(ctx); return () => { const i = probes.ctx.lastIndexOf(ctx); if (i >= 0) probes.ctx.splice(i, 1); }; };
  // 菜单可嵌套(系统菜单 → 物品 → 选人),用栈;wrap() 保证生成器结束(含 return/throw)时出栈。
  const pushMenu = (menu) => { probes.menuStack.push(menu); return () => { const i = probes.menuStack.lastIndexOf(menu); if (i >= 0) probes.menuStack.splice(i, 1); }; };

  // 先按引擎入口的自然顺序求值所有模块:js/pal/* 之间有循环 import,若先单独 import itemmenu,
  // play 会在 itemmenu 尚未初始化时求值,拿到 undefined(UseItem 直接崩主循环)。
  const engine = await load(() => import('@onchainpal/game-engine'));

  // 游戏倍速(只在实时模式,即没有 seed 时)。1 = 原版速度;场景和战斗可以分开调:
  //   scene  —— 场景帧(主循环、脚本里的队伍走位 / 等帧 / 镜头移动):走路、怪的追击、按帧计的计时。原版 10 帧/秒
  //   battle —— 战斗帧和其余所有延时(对白、过场延时、淡入淡出、菜单轮询)。原版战斗 25 帧/秒,这里 1× ≈ 24
  // 'fast' = 引擎自己的旧节奏(场景约原版 4 倍、战斗约 1.7 倍,不是均匀倍速)。
  // 引擎默认 GameSpeed = 2、主循环每帧约 21ms —— 场景逻辑实测 40 帧/秒,是原版的 4 倍:怪的追击、逃跑后的保护期
  // (vanishTime 15 帧,原版 1.5 秒,这里 0.4 秒)、队伍走速全都快 4 倍;直播里 AI 逃出战斗两三秒内必被同一只怪拖回去。
  // 只改一帧对应多少真实时间,每帧逻辑不变。确定性模式不动(锁步按帧数走,改帧时长会动 golden 里的虚拟时间)。
  // 来源:opts.speed > AGENT_PAL_SPEED(--speed;"2" 或 "scene=2,battle=1")> 1;运行中用返回对象的 setSpeed 调。
  const oneSpeed = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Math.min(8, Math.max(0.25, Number(v))));
  /** 解析成 'fast' | { scene, battle } | null(不合法)。只给了一项的对象,另一项沿用 base */
  const parseSpeed = (v, base) => {
    if (v === 'fast') return 'fast';
    if (typeof v === 'string' && v.includes('=')) v = Object.fromEntries(v.split(',').map((kv) => kv.split('=').map((x) => x.trim())));
    if (v && typeof v === 'object') {
      const cur = base && base !== 'fast' ? base : { scene: 1, battle: 1 };
      if (v.scene === undefined && v.battle === undefined) return null;
      const scene = v.scene === undefined ? cur.scene : oneSpeed(v.scene), battle = v.battle === undefined ? cur.battle : oneSpeed(v.battle);
      return scene == null || battle == null ? null : { scene, battle };
    }
    const n = oneSpeed(v);
    return n == null ? null : { scene: n, battle: n };
  };
  const applySpeed = (v) => {
    if (v === 'fast') { globalThis.GameSpeed = 2; globalThis.SceneFrameTime = 0; return; }
    globalThis.GameSpeed = v.battle;                               // 战斗帧 = FrameTime / battle;各种延时 = 原值 / battle
    globalThis.SceneFrameTime = 100 * v.battle / v.scene;          // 场景帧 = SceneFrameTime / GameSpeed = 100ms / scene
  };
  let speed = parseSpeed(opts.speed) ?? { scene: 1, battle: 1 };
  applySpeed(speed);

  // 逃跑保护期(只在实时模式):逃出战斗后,怪要过多久才能再缠上来。原版是 15 个场景帧(1× 下 1.5 秒,旧节奏约 0.4 秒)。
  // AI 每一步要想 2–4 秒:直播日志里 61 次逃跑成功,有 54 次(89%)还没来得及动就被同一只怪拖回战斗。
  // 这是难度开关,不是速度:按真实秒数设(opts.fleeGrace / AGENT_PAL_FLEE_GRACE / --flee-grace),换算成帧数;调倍速时跟着重算。
  // 不设 = 原版规则。确定性模式不适用。
  const parseGrace = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Math.min(60, Number(v)));
  const sceneFps = () => (speed === 'fast' ? 40 : 10 * speed.scene);          // 旧节奏实测约 40 帧/秒
  let fleeGrace = clock ? null : (parseGrace(opts.fleeGrace) ?? parseGrace(process.env.AGENT_PAL_FLEE_GRACE));
  const applyGrace = () => { globalThis.NullifyFrames = fleeGrace == null ? undefined : Math.max(15, Math.round(fleeGrace * sceneFps())); };
  if (!clock) applyGrace();

  const Surface = (await load(() => import('@onchainpal/game-engine/js/pal/surface'))).default;
  // 震屏:浏览器在 present 时按「剩余次数」的奇偶把整屏上 / 下错 shakeLevel 行再减一(surface.ts VIDEO_UpdateScreen);
  // 这里先算出这一帧的偏移(正 = 内容上移)再减,交给 onFrame(远程屏幕要用,录像不用)
  Surface.prototype.updateScreen = function () {
    const shake = Surface.shakeTime > 0 ? ((Surface.shakeTime & 1) ? (Surface.shakeLevel | 0) : -(Surface.shakeLevel | 0)) : 0;
    Surface.consumeShakeFrame?.(); probes.frames++; probes.surface = this; probes.onFrame?.(this, shake);
  };

  const services = await load(() => import('@onchainpal/game-engine/services/index'));
  const dialogService = (await load(() => import('@onchainpal/game-engine/services/dialog-service'))).default;
  const sceneService = (await load(() => import('@onchainpal/game-engine/services/scene-service'))).default;
  const worldService = (await load(() => import('@onchainpal/game-engine/services/world-service'))).default;
  const inputMod = await load(() => import('@onchainpal/game-engine/services/input-service'));
  const commandRuntime = (services.default || services).battleCommandRuntime;
  commandRuntime.install(opts.commandProfile ?? 'legacy', { battle: (services.default || services).battle, world: worldService, party: (services.default || services).adapters.partyTrail, global: () => globalThis.Global, enums: () => globalThis });
  const battleScripts = (services.default || services).battleScriptExecution;
  battleScripts.install(opts.battleScriptProfile ?? 'legacy', { battle: (services.default || services).battle, world: worldService, global: () => globalThis.Global });
  const battleLoop = (services.default || services).battleLoopRuntime;
  battleLoop.install(opts.battleExecutionProfile ?? 'legacy', { battle: (services.default || services).battle, world: worldService, scripts: battleScripts, commands: commandRuntime, party: (services.default || services).adapters.partyTrail, global: () => globalThis.Global, preBattle: () => (services.default || services).battle.getState()?.battleResult === globalThis.BattleResult.PreBattle, ongoing: () => (services.default || services).battle.getState()?.battleResult === globalThis.BattleResult.OnGoing });
  const battlePoison = (services.default || services).battlePoisonRuntime;
  battlePoison.install(opts.battlePoisonScriptProfile ?? 'legacy', {scripts:battleScripts, loop:battleLoop, world:worldService});
  const battleEnemyScript = (services.default || services).battleEnemyScriptRuntime;
  battleEnemyScript.install(opts.battleEnemyScriptProfile ?? 'legacy', {scripts:battleScripts, loop:battleLoop, world:worldService});
  const battleEndScript = (services.default || services).battleEndScriptRuntime;
  battleEndScript.install(endProfile, {scripts:battleScripts, loop:battleLoop, world:worldService});
  const battleRewards=(services.default||services).battleRewardRuntime;
  battleRewards.install(rewardProfile,{scripts:battleScripts,loop:battleLoop,world:worldService});
  const battlePreBattleScript = (services.default || services).battlePreBattleScriptRuntime;
  battlePreBattleScript.install(preBattleProfile, {scripts:battleScripts, loop:battleLoop, world:worldService});
  const gateway = (await load(() => import('@onchainpal/game-engine/ai/ai-gateway'))).default;

  // 对白全量日志(按引用增量收):agent 的 observe 与 bench 判分都读这里,不读滚动的 20 条窗口
  const dialogLog = [];
  const logged = new WeakSet();
  dialogService.signals.history.subscribe((arr) => {
    for (const h of arr || []) if (h && typeof h === 'object' && !logged.has(h)) { logged.add(h); dialogLog.push(h); }
  });
  const scriptObjects = (await load(() => import('@onchainpal/game-engine/services/script-object-adapter'))).default;

  const ui = (await load(() => import('@onchainpal/game-engine/js/pal/ui'))).default;
  const word = (n) => decodeWord(ui.getWord(n));
  const itemData = (id) => { try { return scriptObjects.getObjectEntry(id)?.item || null; } catch { return null; } };
  installListMenuCapture(ui, pushMenu, {
    // 商店「买」用的就是 readMenu,值 = 物品号:补价格、买不起的标灰
    decorate(menu) {
      // 只注解「商品列表」本身:购买确认(是/否)也嵌在 buyMenu 里,同样走 readMenu
      const ctx = probes.ctx[probes.ctx.length - 1];
      if (ctx?.name !== 'buy') return;
      if (!menu.items.length || !menu.items.every((it) => ctx.items.has(it.value))) return;
      menu.title = `shop — buy (cash ${worldService.getCash?.()}); after choosing an item a 是/否 confirm menu appears`;
      for (const it of menu.items) {
        const price = itemData(it.value)?.price || 0;
        it.price = price;
        if (price > (worldService.getCash?.() || 0)) it.enabled = false;
      }
    }
  });

  const play = (await load(() => import('@onchainpal/game-engine/js/pal/play'))).default;
  const origStartFrame = play.startFrame;
  // 主循环心跳 + 读档挂点:读档(initGameData)必须在游戏协程里 yield,外部调不了;
  // 所以排队到下一帧开头,由主循环自己执行(同系统菜单「读取进度」的路径)。
  play.startFrame = function* (...args) {
    probes.heartbeat++;
    probes.heartbeatAt = Date.now();
    const job = probes.pendingLoad;
    if (job) {
      probes.pendingLoad = null;
      try { job.resolve(yield globalThis.game.initGameData(job.slot)); } catch (e) { job.reject(e); }
      return;
    }
    const run = probes.pendingRun;
    if (run) {
      probes.pendingRun = null;
      try { run.resolve(yield run.make()); } catch (e) { run.reject(e); }
      return;
    }
    try {
      return yield* origStartFrame.apply(this, args);
    } catch (err) {
      // 主循环里抛出的异常会让 game 协程整个退出,之后再也不会有帧 —— 记下来,让观测显示 crashed
      // 而不是永远 busy(之前铁匠铺 ui.buyMenu 不存在就是这样卡死的)。
      if (commandRuntime.isCancellation(err)) throw err;
      probes.crash = { message: String(err && err.message ? err.message : err), at: Date.now() };
      throw err;
    }
  };

  if (seed != null) {
    (services.default || services).random.setSeed(seed);
    log(`[agent-pal] seed=${seed}, clock=${clock ? "virtual" : "realtime"}`);
  }
  log('[agent-pal] 起灶生火…');
  // engine.start() 在新游戏流程里会一直跑主循环,不能 await 到底 —— 只等它进入可观测状态。
  const started = engine.start();
  started.catch((e) => log('[agent-pal] engine crashed: ' + (e && e.stack ? e.stack : e)));
  await Promise.race([started, waitUntil(() => probes.frames > 0, 60000)]);
  log(`[agent-pal] 开市了 — ${probes.frames} 帧`);

  // itemmenu / uigame / game 不单独做 dist 入口(多入口会打乱 js/pal/* 循环 import 的求值顺序,
  // play 里拿到 undefined)。它们在引擎初始化时把自己挂到 global 上,这里等到了再包。
  await waitUntil(() => globalThis.itemmenu && globalThis.uigame, 60000);
  installItemMenuCapture(globalThis.itemmenu, pushMenu, { worldService, scriptObjects, word });
  installPartyMenuCapture(globalThis.uigame, pushMenu, { worldService, word });
  await waitUntil(() => globalThis.magicmenu, 10000);
  installUigameScreens(globalThis.uigame, pushMenu, withCtx, () => { probes.menuStack = probes.menuStack.filter((m) => !m.transient); }, { worldService, scriptObjects, word, itemData, storeItems: (n) => (services.default || services).adapterManifest.gameData.module.getStoreEntry(n)?.items });
  installMagicMenuCapture(globalThis.magicmenu, pushMenu, { worldService, scriptObjects, word });

  return {
    commandWait: () => commandRuntime.commandWait(),
    battleExecutionContext: () => commandRuntime.executionContext(),
    submitAutoMode: (wait, on) => commandRuntime.submitAutoMode(wait, on),
    submitCommand: (wait, choice) => commandRuntime.submitCommand(wait, choice),
    cancelCommand: (wait) => commandRuntime.cancelCommand(wait),
    probes,
    ui,
    play,
    get game() { return globalThis.game; },
    word,
    services: services.default || services,
    dialogService,
    dialogLog,
    sceneService,
    worldService,
    scriptObjects,
    inputService: inputMod.default,
    Key: inputMod.Key,
    Direction: inputMod.Direction,
    gateway,
    storage: globalThis.window.localStorage,
    deterministic: !!clock && seed !== null,
    virtualClock: !!clock,
    advancePolicy: opts.advancePolicy,
    presentationPace: opts.presentationPace,
    /** 当前倍速:{ scene, battle }(1 = 原版速度)或 'fast'(引擎旧节奏;独立于时钟配置) */
    get speed() { return speed === 'fast' ? 'fast' : { ...speed }; },
    /** 这个值能不能设(合法的倍速) */
    validSpeed: (v) => parseSpeed(v, speed) != null,
    /** 运行中调倍速:数字(两项一起)、{ scene?, battle? }(只调给了的)、'fast';各项 0.25–8。虚拟／实时模式均可设置。返回调完的值 */
    setSpeed(v) {
      const next = parseSpeed(v, speed);
      if (next != null) { speed = next; applySpeed(next); applyGrace(); }
      return speed === 'fast' ? 'fast' : { ...speed };
    },
    /** 逃跑保护期(真实秒数);null = 原版规则(15 个场景帧) */
    get fleeGrace() { return fleeGrace; },
    /** 运行中调逃跑保护期:秒数(上限 60),或 null / 0 / 'off' 恢复原版规则。虚拟／实时模式均可设置。返回调完的值 */
    setFleeGrace(v) {
      if (clock) return fleeGrace;
      if (v == null || v === 0 || v === '0' || v === 'off') fleeGrace = null;
      else { const g = parseGrace(v); if (g != null) fleeGrace = g; }
      applyGrace();
      return fleeGrace;
    },
    seed,
    clock,
    /** 推进游戏直到 promise 落定(确定性模式);非确定性模式下原样返回。 */
    drive: clock ? clock.drive : (p) => p,
    savesFile,
    /**
     * 引擎声明的等待栈(docs/specs/agent-pal-waits.md,W2 起各等待点写入)。只读;栈顶 = 当前在等的。
     * 读不到(旧引擎)返回 null,调用方退回旧的启发式判断。
     */
    waitFrames() {
      try {
        const w = worldService.getWorldWriter?.();
        if (!w) return null;
        return w.get(w.world(), { name: 'WaitStack' })?.frames || [];
      } catch { return null; }
    },
    /** 测试/调试用:在游戏协程里跑一段引擎生成器(如 uigame.buyMenu(1)),等它结束。不阻塞调用方的观测。 */
    runInGame(make) { return new Promise((resolve, reject) => { probes.pendingRun = { make, resolve, reject }; }); },
    requestBattlePause: () => battleLoop.requestBattlePause(),
    battleLoopObservation: () => battleLoop.observe(),
    resumeBattlePause: observation => battleLoop.resume(observation),
    cancelBattlePauseRequest: request => battleLoop.cancelRequest(request),
    requestBattlePoisonPause: () => battlePoison.requestBattlePoisonPause(),
    battlePoisonObservation: () => battlePoison.observe(),
    resumeBattlePoisonPause: observation => battlePoison.resume(observation),
    cancelBattlePoisonPauseRequest: request => battlePoison.cancelRequest(request),
    battleScriptObservation: () => battleScripts.observe(),
    requestBattleEnemyScriptPause: () => battleEnemyScript.requestBattleEnemyScriptPause(),
    battleEnemyScriptObservation: () => battleEnemyScript.observe(),
    resumeBattleEnemyScriptPause: observation => battleEnemyScript.resume(observation),
    cancelBattleEnemyScriptPauseRequest: request => battleEnemyScript.cancelRequest(request),
    requestBattleRewardPause: () => battleRewards.requestBattleRewardPause(),
    battleRewardObservation: () => battleRewards.observe(),
    resumeBattleRewardPause: observation => battleRewards.resume(observation),
    cancelBattleRewardPauseRequest: request => battleRewards.cancelRequest(request),
    requestBattleEndScriptPause: () => battleEndScript.requestBattleEndScriptPause(),
    battleEndScriptObservation: () => battleEndScript.observe(),
    resumeBattleEndScriptPause: observation => battleEndScript.resume(observation),
    cancelBattleEndScriptPauseRequest: request => battleEndScript.cancelRequest(request),
    requestBattlePreBattleScriptPause: () => battlePreBattleScript.requestBattlePreBattleScriptPause(),
    battlePreBattleScriptObservation: () => battlePreBattleScript.observe(),
    resumeBattlePreBattleScriptPause: observation => battlePreBattleScript.resume(observation),
    cancelBattlePreBattleScriptPauseRequest: request => battlePreBattleScript.cancelRequest(request),
    close: () => { battleRewards.dispose(); battleEndScript.dispose(); battlePreBattleScript.dispose(); battleEnemyScript.dispose(); battlePoison.dispose(); battleLoop.dispose(); battleScripts.dispose(); commandRuntime.dispose(); try { asset.close(); } catch { /* */ } }
  };
}

/** 落盘的 localStorage(同步读写一个 JSON 文件)。只给存档用,量很小。 */
function fileStorage(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 新文件 */ }
  const flush = () => fs.writeFileSync(file, JSON.stringify(data));
  return {
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); flush(); },
    removeItem: (k) => { delete data[k]; flush(); },
    clear: () => { data = {}; flush(); },
    keys: () => Object.keys(data)
  };
}

/** ui.readMenu:竖排/横排文字菜单(标题、系统菜单、存档栏、是/否……)。光标经 onchange 回传。 */
function installListMenuCapture(ui, pushMenu, hooks = {}) {
  if (!ui || typeof ui.readMenu !== 'function' || ui.__agentWrapped) return;
  const orig = ui.readMenu;
  ui.__agentWrapped = true;
  ui.readMenu = function* (onchange, list, defaultItem, labelColor, nocancel) {
    const arr = Array.isArray(list) ? list : [];
    const items = arr.map((it) => ({ label: decodeWord(ui.getWord(it.wordNum)) || String(it.value), value: it.value, enabled: it.enabled !== false }));
    const menu = { kind: 'list', items, index: Math.min(Math.max(defaultItem || 0, 0), Math.max(0, items.length - 1)), nocancel: !!nocancel };
    try { hooks.decorate?.(menu); } catch { /* 注解失败不影响菜单 */ }
    const idxOf = (v) => { const i = arr.findIndex((it) => it.value === v); return i >= 0 ? i : menu.index; };
    const wrapped = (value) => { menu.index = idxOf(value); return onchange ? onchange(value) : undefined; };
    const pop = pushMenu(menu);
    try { return yield* orig.call(ui, wrapped, list, defaultItem, labelColor, nocancel); }
    finally { pop(); }
  };
}

/**
 * itemmenu.itemSelectMenu:3 列物品格。光标就是 worldService 的 inventoryMenuIndex,可直接读写
 * (比模拟方向键可靠)。可选与否 = 物品 flags 命中本次菜单的 itemFlags 且有余量(同引擎判定)。
 */
function installItemMenuCapture(itemmenu, pushMenu, { worldService, scriptObjects, word }) {
  if (!itemmenu || typeof itemmenu.itemSelectMenu !== 'function' || itemmenu.__agentWrapped) return;
  const orig = itemmenu.itemSelectMenu;
  itemmenu.__agentWrapped = true;
  itemmenu.itemSelectMenu = function* (onchange, itemFlags) {
    const menu = {
      kind: 'items',
      columns: 3,
      title: itemFlags & SELLABLE ? 'shop — sell (price shown is what you get); a 是/否 confirm follows' : undefined,
      get items() {
        const inv = worldService.getInventory() || [];
        const n = Math.min(itemmenu.numInventory || 0, inv.length);
        const out = [];
        for (let i = 0; i < n; i++) {
          const slot = inv[i] || {};
          let flags = 0;
          try { flags = scriptObjects.getObjectEntry(slot.item)?.item?.flags || 0; } catch { /* */ }
          const left = (slot.amount || 0) - (slot.amountInUse || 0);
          const entry = { label: word(slot.item) || `item${slot.item}`, value: slot.item, amount: slot.amount || 0, enabled: !!(flags & itemFlags) && left > 0 };
          if (itemFlags & SELLABLE) { try { entry.price = Math.floor((scriptObjects.getObjectEntry(slot.item)?.item?.price || 0) / 2); } catch { /* */ } }
          out.push(entry);
        }
        return out;
      },
      get index() { return worldService.getInventoryMenuIndex(); },
      setIndex(i) { worldService.setInventoryMenuIndex(i); }
    };
    const pop = pushMenu(menu);
    try { return yield* orig.call(this, onchange, itemFlags); }
    finally { pop(); }
  };
}

/**
 * uigame.itemUseMenu:选「对谁使用」。光标只能靠方向键移动,自己记;起点同 SDLPAL 记住上次所选角色
 * (static sSelectedPlayer),从 getItemUseMenuSelectedPlayer 读,越界时引擎会回到 0。
 */
function installPartyMenuCapture(uigame, pushMenu, { worldService, word }) {
  if (!uigame || typeof uigame.itemUseMenu !== 'function' || uigame.__agentWrapped) return;
  const orig = uigame.itemUseMenu;
  uigame.__agentWrapped = true;
  uigame.itemUseMenu = function* (itemToUse) {
    const party = (worldService.getParty() || []).slice(0, (worldService.getMaxPartyMemberIndex?.() ?? 0) + 1);
    const items = party.map((m) => {
      const role = m?.playerRole;
      const name = word(worldService._getPlayerRoleArrayValue('name', role, 0)) || `role${role}`;
      return { label: `${name} HP${worldService._getPlayerRoleArrayValue('HP', role, 0)}/${worldService._getPlayerRoleArrayValue('maxHP', role, 0)}`, value: role, enabled: true };
    });
    let start = 0;
    try { start = uigame.getItemUseMenuSelectedPlayer?.() || 0; } catch { /* */ }
    if (start < 0 || start >= items.length) start = 0;
    const menu = { kind: 'party', items, index: start, selfTracked: true, title: `use ${word(itemToUse)} on whom?` };
    const pop = pushMenu(menu);
    try { return yield* orig.call(this, itemToUse); }
    finally { pop(); }
  };
}

const SELLABLE = 32;            // ItemFlag.Sellable
const EQUIP_FIRST = 64;         // ItemFlag.EquipableByPlayerRole_First(按角色号左移)
const EQUIP_SLOTS = ['head', 'cloak', 'body', 'weapon', 'feet', 'accessory'];   // PAL 装备位顺序
const MAGIC_APPLY_TO_ALL = 16;  // MagicFlag.ApplyToAll

function partyRoles(worldService) {
  return (worldService.getParty() || []).slice(0, (worldService.getMaxPartyMemberIndex?.() ?? 0) + 1).map((m) => m?.playerRole);
}
function roleName(worldService, word, role) {
  return word(worldService._getPlayerRoleArrayValue('name', role, 0)) || `role${role}`;
}

/**
 * uigame 里自绘的界面:
 *  - buyMenu:内部是 readMenu(已截获),这里只标上下文 'buy' 让它补价格。
 *  - equipItemMenu:选「谁装备」;光标是局部变量,从 0 自己数;装完停在原界面,按 Menu 退出。
 *  - inGameMagicMenu:标上下文 'magic',选完仙术后由 installMagicMenuCapture 推「选目标」。
 *  - playerStatus:只读状态页,截成无选项的屏,提示按 Menu 关。
 */
function installUigameScreens(uigame, pushMenu, withCtx, clearTransient, { worldService, word, itemData, storeItems }) {
  if (!uigame || uigame.__agentScreens) return;
  uigame.__agentScreens = true;

  const origBuy = uigame.buyMenu;
  uigame.buyMenu = function* (...args) {
    let items = [];
    try { items = Array.from(storeItems(args[0]) || []).filter(Boolean); } catch { /* */ }
    const done = withCtx({ name: 'buy', items: new Set(items) });
    try { return yield* origBuy.apply(this, args); } finally { done(); }
  };

  const origEquip = uigame.equipItemMenu;
  uigame.equipItemMenu = function* (item) {
    const flags = itemData(item)?.flags || 0;
    const roles = () => worldService.getPlayerRoles?.() || {};
    const menu = {
      kind: 'party',
      selfTracked: true,
      index: 0,
      stayOpen: true,
      title: `equip ${word(item)} on whom? (stays open after equipping — press Menu to leave)`,
      get items() {
        const eq = roles().equipment || [];
        return partyRoles(worldService).map((role) => {
          const wearing = EQUIP_SLOTS.map((slot, i) => { const id = eq[i]?.[role]; return id ? `${slot}:${word(id)}` : null; }).filter(Boolean).join(' ');
          return { label: `${roleName(worldService, word, role)} [${wearing || 'nothing equipped'}]`, value: role, enabled: !!(flags & (EQUIP_FIRST << (role || 0))) };
        });
      }
    };
    const pop = pushMenu(menu);
    try { return yield* origEquip.call(this, item); } finally { pop(); }
  };

  const origMagic = uigame.inGameMagicMenu;
  uigame.inGameMagicMenu = function* (...args) {
    const done = withCtx({ name: 'magic' });
    try { return yield* origMagic.apply(this, args); } finally { done(); clearTransient(); }
  };

  const origStatus = uigame.playerStatus;
  uigame.playerStatus = function* (...args) {
    const menu = { kind: 'screen', items: [], index: 0, title: 'status screen (read-only; Up/Down switch member, press Menu to close)' };
    const pop = pushMenu(menu);
    try { return yield* origStatus.apply(this, args); } finally { pop(); }
  };
}

/**
 * magicmenu.magicSelectMenu:3 列仙术格,magicItems[0..magicNum) = {magic, MP, enabled};
 * 光标 currentItem 可直接写。地图上(ctx=magic)选中需要对象的仙术后,inGameMagicMenu 里有一段
 * 内联的选人循环(没有函数可包),这里预先推一个自数光标的 party 菜单,choose 后自动出栈。
 */
function installMagicMenuCapture(magicmenu, pushMenu, { worldService, scriptObjects, word }) {
  if (!magicmenu || typeof magicmenu.magicSelectMenu !== 'function' || magicmenu.__agentWrapped) return;
  const orig = magicmenu.magicSelectMenu;
  magicmenu.__agentWrapped = true;
  magicmenu.magicSelectMenu = function* (playerRole, inBattle, defaultMagic) {
    const menu = {
      kind: 'magic',
      columns: 3,
      title: `magic of ${roleName(worldService, word, playerRole)} (MP ${worldService._getPlayerRoleArrayValue('MP', playerRole, 0)}); disabled = not enough MP or not usable here`,
      get items() {
        const n = magicmenu.magicNum || 0;
        return (magicmenu.magicItems || []).slice(0, n).map((m) => ({ label: `${word(m.magic) || 'magic' + m.magic} (MP ${m.MP})`, value: m.magic, enabled: !!m.enabled }));
      },
      get index() { return magicmenu.currentItem; },
      setIndex(i) { magicmenu.currentItem = i; }
    };
    const pop = pushMenu(menu);
    let picked;
    try { picked = yield* orig.call(this, playerRole, inBattle, defaultMagic); } finally { pop(); }
    if (picked && !inBattle) {
      let flags = 0;
      try { flags = scriptObjects.getObjectEntry(picked)?.magic?.flags || 0; } catch { /* */ }
      if (!(flags & MAGIC_APPLY_TO_ALL)) {
        const roles = partyRoles(worldService);
        const target = {
          kind: 'party', selfTracked: true, index: 0, transient: true,
          title: `cast ${word(picked)} on whom?`,
          items: roles.map((role) => ({ label: `${roleName(worldService, word, role)} HP${worldService._getPlayerRoleArrayValue('HP', role, 0)}/${worldService._getPlayerRoleArrayValue('maxHP', role, 0)}`, value: role, enabled: true }))
        };
        target.pop = pushMenu(target);       // choose 按完确认/取消后调 pop;inGameMagicMenu 结束时兜底清掉
      }
    }
    return picked;
  };
}

export function waitUntil(pred, timeoutMs = 10000, everyMs = 30) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = !!pred(); } catch { /* */ }
      if (ok) return resolve(true);
      if (Date.now() - t0 >= timeoutMs) return resolve(false);
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
