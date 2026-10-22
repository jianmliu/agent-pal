/**
 * agent — 把无头引擎包成「玩家工具面」:观测 + 高层动作,每个动作都自动推进到下一个决策点。
 *
 * 设计要点(针对旧 dev-autopilot 效果差的根因):
 *  - 决策点驱动,不是 tick 轮询:动作返回时游戏一定停在 control / dialog / menu / battle 之一。
 *  - 寻路交给工具(A* + 引擎自己的 checkObstacle),LLM 只说「去哪」。
 *  - 坐标换成旋转网格:仙剑是斜 45° 等距地图,一步 = (±16px, ±8px)。令 a=x/16, b=y/8,
 *      gx = (a+b)/2, gy = (b-a)/2 + 64      (+64 只为让 gy 非负)
 *    则 上/下/左/右 方向键 = gy-1 / gy+1 / gx-1 / gx+1,四连通,ASCII 图上直接对得上。
 *    (合法站位恒有 a+b 为偶数:x=32tx+16h, y=16ty+8h。)
 */
import path from 'node:path';
import { resolveBattleChoice } from './battle-choice.mjs';
import { summarizeItemEffects } from './item-effects.mjs';
import { budgetWaitUntil as baseWaitUntil, budgetSleep as sleep, checkBudget, runWithDeadline, BudgetExpired } from './action-budget.mjs';

// 战斗回合追踪(见 battle):等待期间每次轮询顺手记一次血量。只读状态、不加定时器,锁步时序不变
let pollHook = null;
const waitUntil = (pred, ...rest) => baseWaitUntil(() => { if (pollHook) pollHook(); return pred(); }, ...rest);
import { createMemory } from './memory.mjs';
import { loadAtlas } from './atlas.mjs';
import { createRoutePlanner } from './route.mjs';

// 有符号 16 位,同 SDLPAL 的 (SHORT) —— 过场里镜头平移时 partyOffset 会是负数,取无符号就算出 (2115,-1965) 这种坐标
const PAL_X = (v) => (v << 16) >> 16;
const PAL_Y = (v) => v >> 16;
const PAL_XY = (x, y) => (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0;

// Direction 枚举:South=0 West=1 North=2 East=3
const DIRS = {
  up:    { dir: 2, key: 'Up',    dgx: 0,  dgy: -1 },
  down:  { dir: 0, key: 'Down',  dgx: 0,  dgy: 1 },
  left:  { dir: 1, key: 'Left',  dgx: -1, dgy: 0 },
  right: { dir: 3, key: 'Right', dgx: 1,  dgy: 0 }
};
const DIR_NAME = { 0: 'down', 1: 'left', 2: 'up', 3: 'right' };

const GY_OFF = 64;

const big5dec = (() => { try { return new TextDecoder('big5'); } catch { return null; } })();

export function toGrid(x, y) {
  const a = Math.round(x / 16), b = Math.round(y / 8);
  return { gx: Math.floor((a + b) / 2), gy: Math.floor((b - a) / 2) + GY_OFF };
}
export function fromGrid(gx, gy) {
  const g = gy - GY_OFF;
  return { x: (gx - g) * 16, y: (gx + g) * 8 };
}

// 存档备注的时间戳用真实时钟:锁步模式下全局 Date 会被换成虚拟时钟(模块加载时还没换)
const RealDate = Date, realNow = Date.now.bind(Date);

export function createAgent(e, opts = {}) {
  const { probes, dialogService, sceneService, worldService, inputService, Key, ui } = e;
  const onLog = opts.onLog || (() => {});
  const dialogHistory = () => e.dialogLog || dialogService.getHistory?.() || [];   // 全量日志优先(引擎 history 只留 20 条)
  const seenLines = new WeakSet();
  // 地图记忆:默认与存档同目录(AGENT_PAL_MEMORY 可覆盖)
  // 全图攻略索引(本地,atlas-build 产出):地图号 → 地名 + 标注图
  const atlas = opts.atlas !== undefined ? opts.atlas : loadAtlas();
  const mapOf = (scene) => { try { return worldService.getSceneEntry(scene)?.mapNum ?? null; } catch { return null; } };
  const sceneName = (scene) => (atlas && scene != null ? atlas.forMap(mapOf(scene))?.name || null : null);
  // memoryFile: null = 不落盘(测试用);未传才走环境变量/默认路径
  const memoryFile = 'memoryFile' in opts ? opts.memoryFile : (process.env.AGENT_PAL_MEMORY ?? (e.savesFile ? path.join(path.dirname(e.savesFile), 'memory.json') : null));
  const memory = createMemory(memoryFile, { sceneName });
  /**
   * 提示档位(AGENT_PAL_HINTS / opts.hints):
   *  - full(默认):读脚本得来的「答案」也告诉 AI —— 开关会打开哪扇门、哪件道具对谁用 / 该放哪、NPC 会查你带没带什么
   *  - standard:只给真人玩家也看得到的信息,上面这些靠 AI 自己摸索(bench 默认用它,考查摸索能力)
   */
  const hintsLevel = opts.hints ?? process.env.AGENT_PAL_HINTS ?? 'full';
  if (hintsLevel !== 'full' && hintsLevel !== 'standard') throw new Error(`hints must be "full" or "standard", got "${hintsLevel}"`);
  const fullHints = hintsLevel === 'full';
  let lastScene = null;
  const visitedScenes = new Set();

  // ---- 基础读数 ------------------------------------------------------------
  const word = (n) => {
    try {
      const w = ui.getWord(n);
      if (typeof w === 'string') return w.replace(/ +$/, '').trim();
      if (w && big5dec) return big5dec.decode(new Uint8Array(w)).replace(/ +$/, '').trim();
    } catch { /* */ }
    return '';
  };

  function playerPos() {
    const vp = worldService.getViewport();
    const off = worldService.getPartyOffset ? worldService.getPartyOffset() : PAL_XY(160, 112);
    const x = PAL_X(vp) + PAL_X(off), y = PAL_Y(vp) + PAL_Y(off);
    return { x, y, ...toGrid(x, y) };
  }
  /** 把现在站的这格记进「走过的路」。只在自己走路 / 观察时记,过场里镜头平移不算 */
  function markVisited() {
    try { const sc = worldService.getSceneId(); if (sc > 0) { const p = playerPos(); memory.recordCell(sc, p.gx, p.gy); } } catch { /* */ }
  }

  /**
   * 障碍判定的结果在「一段同步计算」里记住:期间引擎不会前进,同一格问多少次答案都一样。
   * 寻路每个结点要问四邻、练级挑怪要对每只怪寻两次路,同一格被反复问 —— 实时模式下一次挑怪曾堵住事件循环 0.6 秒。
   */
  let obstacleMemo = null;
  const withObstacleMemo = (fn) => {
    if (obstacleMemo) return fn();
    obstacleMemo = new Map();
    try { return fn(); } finally { obstacleMemo = null; }
  };
  function blockedAt(gx, gy, withObjects = true) {
    if (!obstacleMemo) return blockedAtNow(gx, gy, withObjects);
    const k = (gx * 4096 + gy) * 2 + (withObjects ? 1 : 0);
    let v = obstacleMemo.get(k);
    if (v === undefined) { v = blockedAtNow(gx, gy, withObjects); obstacleMemo.set(k, v); }
    return v;
  }
  function blockedAtNow(gx, gy, withObjects) {
    const { x, y } = fromGrid(gx, gy);
    if (x < 0 || y < 0 || x >= 2048 || y >= 2048) return true;
    // 用引擎走路时的同一个判断(带范围):视口滚不出地图,所以地图左 / 上边一圈(约 5 / 7 个图块)
    // 主角走不进去,但不带范围的 checkObstacle 当它可走 —— 寻路会规划出贴边的路,一走就「blocked repeatedly」
    try {
      const at = PAL_XY(x, y);
      return !!(sceneService.checkObstacleWithRange ? sceneService.checkObstacleWithRange(at, withObjects, 0) : sceneService.checkObstacle(at, withObjects, 0));
    } catch { return true; }
  }

  /** 地图空白格(两层都无图块)= 场景外的虚空,画成空格,省得 agent 以为能走。 */
  function voidAt(gx, gy) {
    const { x, y } = fromGrid(gx, gy);
    if (x < 0 || y < 0) return true;
    let map = null;
    try { map = sceneService.getMap(); } catch { /* */ }
    if (!map || typeof map.getTile !== 'function') return false;
    const h = (x % 32) ? 1 : 0, tx = Math.floor(x / 32), ty = Math.floor((y - 8 * h) / 16);
    if (tx < 0 || ty < 0 || tx >= 64 || ty >= 128) return true;
    // 虚空 = 两层都没有可画的图块。不能用「图块值为 0」判断:0 是图集里第 0 帧,是正经地面
    // (余杭村 27% 的格子图块值为 0,含主路;之前因此把路当墙,walk_to 报无路而 step 能走过去)。
    if (typeof map.getTileBitmap !== 'function') return !map.getTile(ty, tx, h);
    return !map.getTileBitmap(tx, ty, h, 0) && !map.getTileBitmap(tx, ty, h, 1);
  }

  /**
   * 静态出口分析:顺着触发脚本找换场景(0x0059)和设定主角位置(0x0046),
   * 不用走过去就知道这个门/触发器通到哪(同 voxel-lab export-scene-data 的场景链接分析)。
   */
  /**
   * 静态脚本扫描(跟着 GOTO 走,遇 0000/0001 停):
   *  - 换场景 0x0059 / 设主角位置 0x0046 → 出口去向(同 voxel-lab 场景链接分析)
   *  - 开战 0x0007(操作数 0 = 敌方队伍号)→ 这是会打起来的对象
   *  - 追人 0x004C → 会追主角的怪
   *  - 载人 0x0044(主角站在物体上一起移动)/ 0x007A·0x007B(主角自己走过去)→ 摆渡落点(仙灵岛荷叶)
   * 不用走过去/碰上去就知道一个物体是门、是怪、是摆渡还是普通 NPC。
   */
  const scanCache = new Map();
  function scanScript(script) {
    if (!script) return null;
    if (scanCache.has(script)) return scanCache.get(script);
    // trail:这一趟里主角依次被放到 / 走到的点(0x0046 / 0x0044 / 0x007A / 0x007B)。末点才是真正落脚处 ——
    // 同场景传送常是「0x007A 走上去 → 0x0046 放到对面 → 0x007A 走开几格」,0x0046 那格往往就是回程传送点
    const r = { scene: null, pos: null, shift: null, teams: [], chases: false, rides: false, moveTo: null, parkAt: null, sets: [], needs: [], trail: [] };
    const seen = new Set();
    let tripDone = false;
    const addShift = (o) => { r.shift = { dx: (r.shift?.dx || 0) + (o[0] << 16 >> 16), dy: (r.shift?.dy || 0) + (o[1] << 16 >> 16) }; };
    const shiftsIn = (addr) => {
      for (let i = 0; i < 200 && addr; i++, addr++) {
        const sc = worldService.getScriptEntry(addr);
        if (!sc || sc.operation === 0x0000 || sc.operation === 0x0001) return;
        if (sc.operation === 0x006E) addShift(sc.operand || []);
      }
    };
    const walk = (addr, depth) => {
      for (let i = 0; i < 200 && addr && !seen.has(addr); i++) {
        seen.add(addr);
        const sc = worldService.getScriptEntry(addr);
        if (!sc) return;
        const op = sc.operation, o = sc.operand || [];
        if (op === 0xFFFF && !tripDone) r.talks = true;   // 显示对白:这是剧情触发,不是单纯的楼梯 / 传送
        if (op === 0x0059 && o[0] > 0 && r.scene == null) r.scene = o[0];
        else if (op === 0x0046) {
          const px = { x: o[0] * 32 + o[2] * 16, y: o[1] * 16 + o[2] * 8 };
          if (r.pos == null) { r.posPx = px; r.pos = toGrid(px.x, px.y); }
          if (!tripDone) r.trail.push(toGrid(px.x, px.y));
        }
        // 0x006E 把主角(视口)平移若干像素:神殿 / 祭坛的楼梯就是一串这样的小步,合起来 = 上下一层
        else if (op === 0x006E && !tripDone) addShift(o);
        // 0x0004 调子脚本:神殿的门先 0x0046 设好位置,再调一段楼梯位移。子脚本里只累加位移,别的不算(免得改了别的物体的分类)
        else if (op === 0x0004 && o[0] > 0 && !tripDone) shiftsIn(o[0]);
        else if (op === 0x0007 && !r.teams.includes(o[0])) r.teams.push(o[0]);
        else if (op === 0x004C) r.chases = true;
        // 0x0058「背包里某物品少于 N 个就跳走」:这个物体要你带着东西来(酒剑仙要蜡烛檀香符纸酒,老婆婆要 36 只傀儡虫)
        else if (op === 0x0058 && !tripDone && o[0] > 0 && (o[1] << 16 >> 16) > 0 && !r.needs.some((x) => x.item === o[0])) r.needs.push({ item: o[0], amount: o[1] << 16 >> 16 });
        // 0x0049 设某个物体的状态(0 = 消失,1 = 可穿过,2 = 挡路):机关 / 开关就是这样开门、撤障碍的。只算这一趟
        else if (op === 0x0049 && !tripDone && o[0] > 0 && o[0] !== 0xFFFF && !r.sets.some((x) => x.id === o[0])) r.sets.push({ id: o[0], state: o[1] });
        else if ((op === 0x0044 || op === 0x007A || op === 0x007B) && !tripDone) {
          const at = toGrid(o[0] * 32 + o[2] * 16, o[1] * 16 + o[2] * 8);   // 同 0x0046 的坐标约定
          if (op === 0x0044) { r.rides = true; r.parkAt = at; }   // 最后一段载人 = 荷叶停靠处
          r.moveTo = at;                                          // 最后一段 = 主角落点
          r.trail.push(at);
        }
        // 0x0002 在引擎里是「本次停下,下次从 o[0] 起」:对出口/开战照旧顺着看(下一次触发会跑到),
        // 但载人只算这一趟 —— 荷叶回程脚本末尾 0x0002 指回去程,顺下去会把落点覆盖成去程终点
        else if (op === 0x0002 && o[0] > 0 && depth < 4) { tripDone = true; walk(o[0], depth + 1); return; }
        else if (op === 0x0000 || op === 0x0001) return;
        addr++;
      }
    };
    walk(script, 0);
    scanCache.set(script, r);
    return r;
  }
  function exitTarget(script) {
    const r = scanScript(script);
    // 设了位置又平移(神殿的门 = 0x0046 + 调楼梯位移)→ 落点 = 位置 + 位移
    // 否则落点是这一趟最后一个放置 / 走位点(传送后 0x007A 走开几格;scene 192 的迷宫全是这样)
    const pos = r?.posPx && r.shift ? toGrid(r.posPx.x + r.shift.dx, r.posPx.y + r.shift.dy) : (r?.pos ? (r.trail.at(-1) ?? r.pos) : null);
    if (r && (r.scene != null || pos)) return { scene: r.scene ?? worldService.getSceneId(), gx: pos?.gx ?? null, gy: pos?.gy ?? null };
    // 只平移、不换场景也不设坐标、不开战 = 楼梯 / 暗道:落点 = 触发时站的格 + 位移(objects() 按触发格先算一个)
    if (r?.shift && (r.shift.dx || r.shift.dy) && !r.teams.length) return { scene: worldService.getSceneId(), gx: null, gy: null, shift: r.shift };
    return null;
  }
  /** 敌方队伍号 → 敌人名字(队伍表每队最多 5 个敌人对象号,空位为 0 / 0xFFFF)。 */
  function teamNames(team) {
    try {
      const entry = e.services.adapterManifest?.battleState?.module?.getEnemyTeamEntry?.(team);
      const ids = Array.from(entry?.enemy || []).filter((x) => x && x !== 0xFFFF);
      return ids.map((id) => word(id) || `enemy${id}`);
    } catch { return []; }
  }

  /**
   * 敌人等级远高于队伍时的提醒(full 档)。连跑第 33–37 轮:南诏地底信道的瘟神 Lv52,队伍 Lv27–37,
   * AI 只看得到名字和血量,一试再试团灭十几次 —— 而出口的路线根本不经过它。
   */
  const DANGER_GAP = 10;
  function enemyLevel(id) {
    try { return Number(e.services.adapterManifest?.gameData?.module?.getEnemyEntry?.(e.scriptObjects.getObjectEntry(id)?.enemy?.enemyID)?.level) || 0; } catch { return 0; }
  }
  function dangerOf(ids) {
    if (!fullHints) return '';
    const lv = party().map((r) => r.level || 0);
    if (!lv.length) return '';
    let top = 0, who = 0;
    for (const id of ids) { const l = enemyLevel(id); if (l > top) { top = l; who = id; } }
    if (top < Math.max(...lv) + DANGER_GAP) return '';
    const lo = Math.min(...lv), hi = Math.max(...lv);
    return `${word(who) || 'enemy'} is Lv${top}, far above your party (Lv${lo === hi ? hi : `${lo}–${hi}`})`;
  }
  /** 地图 / 全景 / 路线说明里挂在怪后面的一句 */
  const dangerTag = (o) => { const d = o?.battle ? teamDanger(o.battle.team) : ''; return d ? ` — DANGER: ${d}${o.battle.chaseRange ? `; it chases you within ${o.battle.chaseRange} cells` : ''} (walk_to says whether a route can stay clear of it)` : ''; };
  function teamDanger(team) {
    try {
      const entry = e.services.adapterManifest?.battleState?.module?.getEnemyTeamEntry?.(team);
      return dangerOf(Array.from(entry?.enemy || []).filter((x) => x && x !== 0xFFFF));
    } catch { return ''; }
  }

  /**
   * 自动脚本里的追击范围(0x004C 的操作数 0,默认 8)。追人的怪常写成「0x004C;0x0003 跳回自己」,而物体的脚本指针
   * 停在那条 0x0003 上 —— scanScript 不跟无条件跳转(跟了会改别的物体的分类),这里只为找 0x004C 单独跟一下。
   */
  function chaseRangeOf(addr) {
    const seen = new Set();
    for (let i = 0; i < 40 && addr && !seen.has(addr); i++) {
      seen.add(addr);
      const sc = worldService.getScriptEntry(addr);
      if (!sc) return 0;
      const op = sc.operation, o = sc.operand || [];
      if (op === 0x004C) return o[0] || 8;
      if (op === 0x0003 || op === 0x0002) { addr = o[0]; continue; }
      if (op === 0x0000 || op === 0x0001) return 0;
      addr++;
    }
    return 0;
  }

  function objects() {
    const uses = fullHints ? itemHintsHere() : { face: new Map(), place: [] };
    let list = [];
    try { list = worldService.getEventObjectsInCurrentScene() || []; } catch { /* */ }
    const out = [];
    for (const entry of list) {
      const s = entry && entry.state;
      if (!s || s.state <= 0 || s.vanishTime) continue;
      const g = toGrid(s.x, s.y);
      const touch = s.triggerMode >= 4;
      const kind = s.spriteNum ? 'npc' : (touch ? 'touch-trigger' : (s.triggerMode > 0 ? 'search-spot' : 'scenery'));
      // 没精灵、不触发的「隐形墙」(state ≥ 2)也要留着:引擎按它挡路(锁妖塔书中仙身前那格就是),
      // 寻路「忽略会走动的 NPC」时不能把它也忽略掉。observe 里画成 #,不进物体图例。
      const wall = kind === 'scenery' && !s.autoScript && s.state >= 2;
      if (kind === 'scenery' && !s.autoScript && !wall) continue;
      const id = entry.id ?? entry.index + 1;
      const o = { id, gx: g.gx, gy: g.gy, kind, triggerMode: s.triggerMode, blocking: s.state >= 2 };
      if (wall) o.wall = true;
      // 挡路、不触发、没自动脚本 = 不会走开的东西(乱葬岗石门两扇里带精灵的那扇):寻路「忽略会走动的 NPC」时也得当墙
      else if (o.blocking && !s.autoScript && !s.triggerMode) o.fixed = true;
      if (uses.face.has(id)) o.useItem = uses.face.get(id);
      if (fullHints && s.triggerMode > 0) { try { const nd = scanScript(s.triggerScript)?.needs; if (nd?.length) o.needs = nd; } catch { /* */ } }
      if (kind === 'touch-trigger' || kind === 'search-spot') { try { o.dest = exitTarget(s.triggerScript); } catch { /* */ } }
      if (o.dest?.shift) Object.assign(o.dest, shiftedCell(o, o.dest.shift));
      // 挪了位置还放对白 / 改别的物体 / 开战 = 剧情触发(如李大娘把你拽回去),寻路不能当楼梯走
      if (o.dest) { try { const t = scanScript(s.triggerScript); if (t && (t.talks || t.teams.length || t.sets.some((x) => x.id !== id))) o.story = true; } catch { /* */ } }
      if (touch) {
        // 摆渡(荷叶):踩上去被载到别处。触发脚本每趟会换成回程那段,所以落点随当前脚本变
        const trig = scanScript(s.triggerScript);
        if (trig?.rides && trig.moveTo && !trig.teams.length && trig.scene == null) {
          o.kind = 'ferry';
          o.dest = { scene: worldService.getSceneId(), gx: trig.moveTo.gx, gy: trig.moveTo.gy };
          o.parkAt = trig.parkAt;
          out.push(o);
          continue;
        }
      }
      // 开关 / 机关:踩上去(或调查)就改别的物体的状态、又不打仗 —— 例如乱葬岗石门前的骷髅机关。
      // 说话的 NPC(带精灵、非触碰)不算,免得把剧情对白当成开关
      if (fullHints && (touch || kind === 'search-spot')) {
        try {
          const trig = scanScript(s.triggerScript);
          const others = (trig?.sets || []).filter((x) => x.id !== id);
          if (others.length && !trig.teams.length && trig.scene == null && !trig.pos) {
            o.rawKind = kind;
            o.kind = 'switch';
            o.how = touch ? 'step on it' : 'search it (interact)';
            o.effects = others.map((x) => switchEffect(x, list));
            out.push(o);
            continue;
          }
        } catch { /* */ }
      }
      if (kind === 'npc') {
        // 怪物 = 触发脚本里会开战;追人的看自动脚本
        try {
          const trig = scanScript(s.triggerScript), auto = scanScript(s.autoScript);
          const teams = [...(trig?.teams || []), ...(auto?.teams || [])];
          if (teams.length) {
            o.kind = touch ? 'enemy' : 'npc';
            o.battle = { team: teams[0], names: teamNames(teams[0]), onTalk: !touch, chases: !!(trig?.chases || auto?.chases), chaseRange: fullHints ? chaseRangeOf(s.autoScript) : 0 };
          }
        } catch { /* */ }
      }
      out.push(o);
    }
    return out;
  }

  // 跨场景绕路(route.mjs):本场景走不到时,经别的出口 / 楼梯绕过去;full 档还会先踩开关开门
  const router = createRoutePlanner({
    worldService, sceneService, scanScript, sceneName, switchesEnabled: fullHints,
    // 与 objects() 的开关判定一致:踩上去(或调查无精灵的调查点)改别的物体的状态、不打仗不换场景
    isSwitch: (s, id, trig) => (s.triggerMode >= 4 || (s.triggerMode > 0 && !s.spriteNum)) && trig.sets.some((x) => x.id !== id) && !trig.teams.length && trig.scene == null && !trig.pos
  });

  /** 开关作用到某个物体上:按目标当前状态 → 新状态说人话 */
  function switchEffect(x, list) {
    const en = list.find((en2) => (en2.id ?? en2.index + 1) === x.id);
    const st = en?.state;
    const at = st ? toGrid(st.x, st.y) : null;
    const where = at ? `(${at.gx},${at.gy})` : `object ${x.id}`;
    const now = st?.state ?? 0;
    let what;
    if (now >= 2 && x.state < 2) what = `opens / clears the obstacle at ${where}`;
    else if (now <= 0 && x.state > 0) what = `makes something appear at ${where}`;
    else if (now < 2 && x.state >= 2) what = `blocks ${where}`;
    else if (now > 0 && x.state <= 0) what = `removes the object at ${where}`;
    else what = `changes object ${x.id} at ${where}`;
    return { id: x.id, state: x.state, gx: at?.gx ?? null, gy: at?.gy ?? null, what };
  }
  const describeSwitch = (o) => {
    // 一扇门常是相邻的两个物体:同一种效果、彼此相邻的合并成一句(写成 (118,125)-(118,126))
    const groups = [];
    for (const ef of o.effects || []) {
      const verb = ef.what.replace(/ at .*$/, '').replace(/ object \d+$/, '');
      const g = groups.find((x) => x.verb === verb && ef.gx != null && x.cells.some((c) => Math.max(Math.abs(c.gx - ef.gx), Math.abs(c.gy - ef.gy)) <= 1));
      if (g) g.cells.push(ef); else groups.push({ verb, cells: [ef] });
    }
    const parts = groups.map((g) => {
      const cs = g.cells.filter((c) => c.gx != null).sort((p, q) => p.gx - q.gx || p.gy - q.gy);
      if (!cs.length) return g.cells[0].what;
      const span = cs.length > 1 ? `(${cs[0].gx},${cs[0].gy})-(${cs[cs.length - 1].gx},${cs[cs.length - 1].gy})` : `(${cs[0].gx},${cs[0].gy})`;
      return `${g.verb} at ${span}`;
    });
    return `SWITCH — ${o.how}: ${parts.join('; ')}`;
  };

  /**
   * 道具机关(静态读物品的使用脚本):
   *  - 0x0081「不面朝某物体就跳下一个」:站在那个物体跟前、面朝它用(桂花酒→醉道士、石钥匙→石门、五灵珠→祭坛)
   *  - 0x0084「把用掉的物品放成场景里的物体」:在那个物体所属的场景里,面朝一块空地用(捕兽夹、芦苇漂)
   * 只看物体号属于哪个场景,不用走过去试。
   */
  let sceneRanges = null;
  function sceneOfObject(id) {
    if (!sceneRanges) {
      sceneRanges = [];
      for (let sc = 1; sc <= 300; sc++) {
        try { const r = worldService.getSceneEventObjectRange(sc); if (r.end > r.start) sceneRanges.push([sc, r.start, r.end]); } catch { break; }
      }
    }
    const hit = sceneRanges.find(([, a, b]) => id - 1 >= a && id - 1 < b);
    return hit ? hit[0] : null;
  }
  const itemUseCache = new Map();
  function itemUses(itemId) {
    if (itemUseCache.has(itemId)) return itemUseCache.get(itemId);
    let addr = 0;
    try { addr = e.scriptObjects.getObjectEntry(itemId)?.item?.scriptOnUse || 0; } catch { /* */ }
    const out = [];
    for (let hop = 0; hop < 40 && addr; hop++) {
      const sc = worldService.getScriptEntry(addr);
      if (!sc) break;
      const op = sc.operation, o = sc.operand || [];
      if (op === 0x0081 || op === 0x0084) {
        if (!out.some((x) => x.id === o[0])) out.push({ id: o[0], how: op === 0x0081 ? 'face' : 'place', scene: sceneOfObject(o[0]) });
        addr = o[2]; continue;
      }
      if (op === 0x0002 && o[0]) { addr = o[0]; continue; }
      if (op === 0x0000 || op === 0x0001) break;
      addr++;   // 前置的无关指令(如桂花酒脚本开头的 0x0005)跳过
    }
    itemUseCache.set(itemId, out);
    return out;
  }
  /** 物品能不能「遁出本场景」:使用脚本(含 0x0081 不面朝目标时跳去的分支)里有 0x0038。土灵珠不在祭坛前用就是引路蜂 */
  const escapeCache = new Map();
  function itemEscapes(itemId) {
    if (escapeCache.has(itemId)) return escapeCache.get(itemId);
    let start = 0;
    try { start = e.scriptObjects.getObjectEntry(itemId)?.item?.scriptOnUse || 0; } catch { /* */ }
    let found = false;
    const seen = new Set(), todo = [start];
    while (todo.length && !found) {
      let addr = todo.pop();
      for (let i = 0; i < 80 && addr && !seen.has(addr); i++, addr++) {
        seen.add(addr);
        const sc = worldService.getScriptEntry(addr);
        if (!sc) break;
        const op = sc.operation, o = sc.operand || [];
        if (op === 0x0038) { found = true; break; }
        if ((op === 0x0081 || op === 0x0084) && o[2]) todo.push(o[2]);
        if ((op === 0x0002 || op === 0x0003) && o[0]) { todo.push(o[0]); break; }
        if (op === 0x0000 || op === 0x0001) break;
      }
    }
    escapeCache.set(itemId, found);
    return found;
  }
  /** 本场景能不能遁出、遁到哪(场景的 scriptOnTeleport;剧情会改它,比如打完赤鬼王才能遁出血池) */
  function escapeDest() {
    let addr = 0;
    try { addr = worldService.getSceneEntry(worldService.getSceneId())?.scriptOnTeleport || 0; } catch { /* */ }
    if (!addr) return null;
    for (let i = 0; i < 40 && addr; i++, addr++) {
      const sc = worldService.getScriptEntry(addr);
      if (!sc) break;
      if (sc.operation === 0x0059 && sc.operand[0] > 0) return { scene: sc.operand[0] };
      if (sc.operation === 0x0000) break;
    }
    return { scene: null };
  }

  function invCounts() {
    const m = new Map();
    try { for (const it of worldService.getInventory() || []) if (it && it.item && it.amount > 0) m.set(it.item, (m.get(it.item) || 0) + it.amount); } catch { /* */ }
    return m;
  }
  /** 背包里的东西在本场景能用在哪:face = 物体号 → 物品名;place = 可以放下的物品名 */
  function itemHintsHere() {
    const face = new Map(), place = [];
    const scene = worldService.getSceneId();
    for (const item of invCounts().keys()) {
      for (const u of itemUses(item)) {
        if (u.scene !== scene) continue;
        const nm = word(item) || `item${item}`;
        if (u.how === 'face') face.set(u.id, [...(face.get(u.id) || []), nm]);
        else if (!place.includes(nm)) place.push(nm);
      }
    }
    return { face, place };
  }
  /** 物体上的道具提示:背包里有东西能对它用 / 它要你带着什么来 */
  function describeItemHints(o) {
    const parts = [];
    if (o.useItem?.length) parts.push(`USE ITEM: stand next to it, face it and use ${o.useItem.map((n) => `「${n}」`).join(' or ')} from your bag (use_item with facing=${o.id})`);
    if (o.needs?.length) {
      const have = invCounts();
      parts.push(`interacting checks whether you carry ${o.needs.map((x) => `${word(x.item) || 'item' + x.item}×${x.amount} (you have ${have.get(x.item) || 0})`).join(', ')}`);
    }
    return parts.length ? ` — ${parts.join('; ')}` : '';
  }
  function placeHintLine() {
    if (!fullHints) return null;
    const { place } = itemHintsHere();
    const lines = [];
    if (place.length) lines.push(`items you can set down in this scene: ${place.map((n) => `「${n}」`).join('、')} — stand facing a free walkable tile and use_item it`);
    // 遁出:场景允许遁出、背包里有能遁出的物品
    const dest = escapeDest();
    if (dest) {
      const items = [...invCounts().keys()].filter(itemEscapes).map((it) => word(it) || `item${it}`);
      if (items.length) {
        const sn = dest.scene != null ? sceneName(dest.scene) : null;
        lines.push(`you can leave this area with ${items.map((n) => `「${n}」`).join(' or ')}: use_item it anywhere here and the party is teleported out${dest.scene != null ? ` (to scene ${dest.scene}${sn ? ` ${sn}` : ''})` : ''}`);
      }
    }
    return lines.length ? lines.join('\n') : null;
  }

  function party() {
    const out = [];
    let members = [];
    try { members = worldService.getParty() || []; } catch { /* */ }
    const n = Math.max(0, (worldService.getMaxPartyMemberIndex?.() ?? members.length - 1) + 1);
    for (let i = 0; i < Math.min(n, members.length); i++) {
      const role = members[i]?.playerRole;
      if (typeof role !== 'number') continue;
      const f = (k) => worldService._getPlayerRoleArrayValue(k, role, null);
      out.push({ role, name: word(f('name')) || `role${role}`, level: f('level'), hp: f('HP'), maxHp: f('maxHP'), mp: f('MP'), maxMp: f('maxMP') });
    }
    return out;
  }
  /** 全部可操作角色的名字(含不在队里的:月如死后、灵儿入队前也是「自己人」,她们说的话不是被调查物体在说)。 */
  function heroNames() {
    const names = new Set();
    for (let role = 0; role < 6; role++) {
      try { const n = word(worldService._getPlayerRoleArrayValue('name', role, null)); if (n) names.add(n); } catch { /* */ }
    }
    return names;
  }

  function inventory() {
    try {
      return (worldService.getInventory() || []).filter((it) => it && it.item && it.amount > 0)
        .map((it) => ({ name: word(it.item) || `item${it.item}`, amount: it.amount }));
    } catch { return []; }
  }

  /**
   * 模式(W3):读引擎声明的等待栈栈顶。
   *   control → control;dialog → dialog;menu.* → menu;battle.command → battle;
   *   anykey 带超时(战斗结算 / 升级画面,到时自动继续)→ busy,settle 会等它过去;
   *   anykey 无超时(结局、脚本 0x004D)→ anykey,advance 按一下;栈空 = 引擎在跑脚本/动画 → busy。
   * 旧的启发式(legacyMode)并行算一份做对照,不一致的记进 stats().waitMismatch 与 run log。
   */
  function waitTop() {
    // W4 引擎侧(#42)提供 services.waits.top();没有时直接读 WorldWriter 上的等待栈
    const svc = e.services?.waits;
    if (svc?.top) { try { return svc.top() || null; } catch { /* 退回直接读 */ } }
    const frames = e.waitFrames?.();
    if (!frames) return undefined;                       // 引擎没有等待栈:退回旧判断
    return frames.length ? frames[frames.length - 1] : null;
  }
  function waitMode(top) {
    if (!top) return 'busy';
    const k = top.kind;
    if (k === 'control') return 'control';
    if (k === 'dialog') return 'dialog';
    if (k === 'battle.command') return 'battle';
    if (k === 'anykey') return top.payload?.timeoutMs != null ? 'busy' : 'anykey';
    if (k.startsWith('menu.')) return 'menu';
    return 'busy';
  }
  /**
   * W4:直接回应引擎的等待(services.waits.respond),不再注入按键、逐格挪光标。
   * 回应在等待循环下一次恢复时生效,之后栈顶 token 变化 —— 等到 token 变了才算送达。
   * AGENT_PAL_KEYS=1 退回按键注入(A/B 对照用);引擎没有回应接口时也退回按键。
   */
  const KEYS_MODE = process.env.AGENT_PAL_KEYS === '1';
  const waitsSvc = () => (!KEYS_MODE && e.services?.waits?.respond ? e.services.waits : null);
  async function respondTop(response, timeoutMs = 30000) {
    const svc = waitsSvc();
    const t = svc?.top();
    if (!t) return { ok: false, reason: 'nothing-waiting', note: 'nothing is waiting for a response' };
    const r = svc.respond(t.token, response);
    if (!r.ok) return r;
    if (e.deterministic) await waitUntil(() => svc.top()?.token !== t.token, timeoutMs, 20);
    else await waitResponded(svc, t.token, timeoutMs);
    return { ok: true, token: t.token, kind: t.kind };
  }
  /**
   * 实时模式下等一次回应生效。有些菜单回应之后并不关 —— 地图施法选目标、给队员用物品、装备,MP / 物品还够就留在
   * 原界面可以接着用(同原版),等待的 token 不变;只等「token 变了」就要白等到超时:实测放一次回复术卡 31 秒。
   * 所以另认一种结束:回应已被引擎取走,且画面静止了 QUIET 毫秒(动作演完,又在等按键了)。
   * 确定性模式不走这里:虚拟时钟下那 30 秒不花真实时间,改了会动 golden 轨迹里的时间戳。
   */
  async function waitResponded(svc, token, timeoutMs) {
    const QUIET = 300;
    const t0 = Date.now();
    let frames = probes.frames, shot = null, quietSince = Date.now();
    const changed = () => {
      if (probes.frames === frames) return false;
      frames = probes.frames;
      const buf = probes.surface?.byteBuffer;
      if (!buf) return true;
      const same = shot && shot.length === buf.length && shot.every((v, i) => v === buf[i]);   // 有的菜单每帧重画同一屏
      if (!same) shot = Uint8Array.from(buf);
      return !same;
    };
    changed();
    while (Date.now() - t0 < timeoutMs) {
      const top = svc.top();
      if (!top || top.token !== token) return;
      if (changed() || top.response) quietSince = Date.now();
      else if (Date.now() - quietSince >= QUIET) return;
      await sleep(20);
    }
  }
  /** 退出当前菜单:引擎声明了可取消的菜单就回应 { cancel },否则(或回应被拒)按 Menu */
  async function cancelMenu(ms = 100) {
    const t = waitsSvc()?.top();
    if (t && t.kind.startsWith('menu.') && t.payload?.cancelable !== false) {
      const r = await respondTop({ cancel: true }, 3000);
      if (r.ok) return;
    }
    await tap('Menu', ms);
  }
  /** 跳过「按任意键继续」(战斗结算 / 经验 / 升级画面):引擎声明了 anykey / dialog 就回应 { advance },否则按 Search */
  async function advanceOrKey(ms = 300) {
    const t = waitsSvc()?.top();
    if (t && (t.kind === 'anykey' || t.kind === 'dialog')) {
      const r = await respondTop({ advance: true }, ms * 10);
      if (r.ok) return;
    }
    await tap('Search', ms);
  }

  // 应急开关:AGENT_PAL_LEGACY_MODE=1 退回旧判断(对照仍记录)
  const LEGACY_MODE = process.env.AGENT_PAL_LEGACY_MODE === '1';
  const waitMismatch = { total: 0, byPair: {} };
  let lastMismatch = null;
  function mode() {
    if (probes.crash) return 'crashed';
    const top = waitTop();
    if (e.services.battleCommandRuntime?.owned) {
      const child = waitMode(top);
      if (top?.kind === 'anykey' || ['dialog', 'menu', 'anykey'].includes(child)) return child;
      const owner = e.commandWait?.();
      if (owner?.kind === 'battle.command' || owner?.kind === 'battle.auto-mode' || e.battleExecutionContext?.()) return 'battle';
    }
    const legacy = legacyMode();
    if (top === undefined || LEGACY_MODE) return legacy;
    let m = waitMode(top);
    // 战斗里的物品 / 仙术子菜单:引擎声明成 menu.items / menu.magic,但不走 itemSelectMenu / magicSelectMenu,
    // agent 截获不到(probes.menu 为空),choose 用不了 —— 报 battle,由 battle() 先退出子菜单
    if (m === 'menu' && !probes.menu && top?.payload?.context === 'battle') m = 'battle';
    // 对照:旧判断在 busy/battle 抖动期间本来就不准,只记「双方都在等玩家」却不一致的情况
    const pair = `${legacy}->${m}`;
    if (legacy !== m && legacy !== 'busy' && m !== 'busy' && pair !== lastMismatch) {
      waitMismatch.total++;
      waitMismatch.byPair[pair] = (waitMismatch.byPair[pair] || 0) + 1;
      onLog({ type: 'wait-mismatch', legacy, wait: m, kind: top?.kind, token: top?.token });
    }
    lastMismatch = legacy !== m ? pair : null;
    return m;
  }
  function legacyMode() {
    if (probes.crash) return 'crashed';
    if (probes.menu) return 'menu';                      // 先于 battle:战斗里开的物品菜单也算 menu
    const st = dialogService.getStatus?.() || {};
    // 剧情战会在战斗中弹对白(战斗标志仍在):等按键的对白优先报 dialog,否则 advance 被拒、看起来像卡在 battle
    if (worldService.isInBattle()) return st.active && st.awaitingInput ? 'dialog' : 'battle';
    if (st.active && st.awaitingInput) return 'dialog';
    if (Date.now() - probes.heartbeatAt < 250 && !st.active) return 'control';
    return 'busy';
  }

  /** 收集自上次以来的新对白行(按说话人合并)。 */
  function drainDialog() {
    const hist = dialogHistory();
    const lines = [];
    for (const h of hist) {
      if (!h || seenLines.has(h)) continue;
      seenLines.add(h);
      const t = cleanText(h.text);
      if (!t) continue;                                   // 只有控制码(换头像表情 $02、停顿 ~40)的行
      const sp = h.source ? cleanText(h.source) : '';
      if (sp && t === sp) continue;                       // 说话人名行
      lines.push(sp ? `${sp}：${t}` : t);
    }
    if (lines.length) onLog({ type: 'dialog', lines });
    if (lines.some((l) => /勝敗乃兵家常事|胜败乃兵家常事/.test(l))) {
      let slot = null;
      try { slot = worldService.getCurrentSaveSlot?.(); } catch { /* */ }
      // 系统提示单独放,不混进对白
      pendingNotes.push(`you were defeated — the game reloads your last save${slot ? ` (slot ${slot})` : ''}; with no save it restarts from the beginning${fullHints ? '. Before fighting again, review the loss: which enemy did the damage, which of your decisions was wrong, and what you will change (tactics, heal/buff earlier, equip better gear, level up first, or avoid that enemy) — do not just retry the same way' : ''}`);
    }
    return lines;
  }
  const pendingNotes = [];
  /** 对白里引擎的控制码:$NN 换头像表情,~NN 停顿帧数(行尾);去掉后只剩空白就当空行 */
  function cleanText(s) {
    return String(s || '').replace(/\$\d{2}/g, '').replace(/~\d+\s*$/g, '').trim();
  }

  function trackScene() {
    const s = worldService.getSceneId();
    if (s !== lastScene) {
      if (lastScene != null) onLog({ type: 'scene', from: lastScene, to: s });
      lastScene = s;
      visitedScenes.add(s);
    }
    return s;
  }

  /** W4:限时画面(战斗胜利 / 经验 / 升级)直接回应跳过,不干等 3–5 秒;同玩家按键跳过。每个 token 只回应一次 */
  let skippedToken = null;
  function skipTimed() {
    const svc = waitsSvc(), top = svc?.top();
    if (top && top.kind === 'anykey' && top.payload?.timeoutMs != null && top.token !== skippedToken) {
      skippedToken = top.token;
      svc.respond(top.token, { advance: true });
    }
  }
  // ---- 决策点:推进到 control / dialog / menu / battle 且稳定 ------------------
  async function settle(timeoutMs = 20000) {
    const t0 = Date.now();
    const declared = waitTop() !== undefined && !LEGACY_MODE;
    let prev = null, since = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const m = mode();
      if (m === 'crashed') return m;
      skipTimed();
      if (m !== prev) { prev = m; since = Date.now(); }
      const stableFor = Date.now() - since;
      // dialog 打字机效果期间 awaitingInput 会抖,要求稳定 250ms;control 要求连续心跳 300ms
      if (m === 'menu' && stableFor >= 150) return m;
      if (m === 'dialog' && stableFor >= 250) return m;
      if (m === 'anykey' && stableFor >= 150) return m;
      // 等待栈声明的 control 本身就是「主循环空闲、没有别的在等」,抖动比心跳判断小,稳定窗口可以短些
      if (m === 'control' && stableFor >= (declared ? 200 : 300)) return m;
      if (m === 'battle' && stableFor >= 800) return m;
      await sleep(30);
    }
    return mode();
  }

  // ---- 观测 ----------------------------------------------------------------
  function asciiMap(radiusX = 18, radiusY = 11, full = false) {
    const p = playerPos();
    const objs = objects();
    const marks = new Map();
    const legend = [];
    const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    objs.sort((a, b) => (Math.abs(a.gx - p.gx) + Math.abs(a.gy - p.gy)) - (Math.abs(b.gx - p.gx) + Math.abs(b.gy - p.gy)));
    let hidden = 0;
    const walls = new Set(objs.filter((o) => o.wall).map((o) => `${o.gx},${o.gy}`));
    objs.forEach((o, i) => {
      if (o.wall || Math.abs(o.gx - p.gx) > radiusX || Math.abs(o.gy - p.gy) > radiusY) return;
      if (!full && legend.length >= MAX_LEGEND) { hidden++; return; }   // 按距离排过序,只列最近的
      const ch = LET[legend.length] || '*';
      if (!marks.has(`${o.gx},${o.gy}`)) marks.set(`${o.gx},${o.gy}`, ch);
      legend.push({ ch, ...o });
    });
    const rows = [];
    const sceneNow = worldService.getSceneId(), trail = fullHints;
    for (let gy = p.gy - radiusY; gy <= p.gy + radiusY; gy++) {
      let row = '';
      for (let gx = p.gx - radiusX; gx <= p.gx + radiusX; gx++) {
        if (gx === p.gx && gy === p.gy) { row += '@'; continue; }
        const mk = marks.get(`${gx},${gy}`);
        if (mk) { row += mk; continue; }
        row += voidAt(gx, gy) ? ' ' : (blockedAt(gx, gy, false) || walls.has(`${gx},${gy}`) ? '#' : (trail && memory.wasAt(sceneNow, gx, gy) ? ':' : '.'));
      }
      rows.push(row);
    }
    return { rows, legend, hidden, origin: { gx: p.gx - radiusX, gy: p.gy - radiusY } };
  }

  function describeDest(d) {
    const here = d.scene === worldService.getSceneId();
    const at = d.gx != null ? ` (${d.gx},${d.gy})` : '';
    const near = d.gx != null ? memory.npcsNear(d.scene, d.gx, d.gy) : [];
    const dn = here ? null : sceneName(d.scene);
    return `→ ${here ? 'elsewhere in this scene' : `scene ${d.scene}${dn ? ` (${dn})` : ''}`}${at}${d.shift ? ' (stairs: walking into it moves you there; walk_to uses it)' : ''}${near.length ? ` near ${near.join('、')}` : ''}`;
  }

  /**
   * 本场景的全部出口与物体(不限 observe 的小地图范围),按类别分组、按离自己的距离排序。
   * marks:给 panorama 图上的标记用的字母,与图例一一对应。
   */
  const DIR_KINDS = [['exits', (o) => o.kind === 'touch-trigger' && o.dest], ['ferries', (o) => o.kind === 'ferry'],
    ['enemies', (o) => o.kind === 'enemy'], ['people & objects', (o) => o.kind === 'npc'], ['search spots', (o) => o.kind === 'search-spot'],
    ['switches', (o) => o.kind === 'switch'], ['other triggers', (o) => o.kind === 'touch-trigger' && !o.dest]];
  /**
   * 从当前位置走得到哪些物体:按 walk_to 最宽的规则(怪可以穿过去打、会走动的 NPC 不算墙、楼梯 / 摆渡照走)
   * 洪水填充一次,物体旁边(门 / 触发器按触发范围)有走得到的格就算到得了。搜不完(超预算)返回 null = 不下结论。
   */
  function reachability(p) {
    const ex = findPath(p, { gx: -9999, gy: -9999 }, { softEnemies: true, noObjects: true, explore: true, maxNodes: 200000 });
    if (!ex?.complete) return null;
    return (o) => {
      if ((o.kind === 'npc' || o.kind === 'scenery') && !o.triggerMode) return null;   // 摆设(火把之类)不判
      const r = (o.kind === 'touch-trigger' || o.kind === 'ferry' || o.kind === 'enemy' ? Math.max(0, o.triggerMode - 4) : 0) + 1 + (o.kind === 'enemy' ? 1 : 0);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (ex.reached.has(ex.key(o.gx + dx, o.gy + dy))) return true;
      return false;
    };
  }

  function sceneDirectory() {
    const p = playerPos(), scene = worldService.getSceneId();
    const canReach = reachability(p);
    const been = memory.visitedScenes();
    const objs = objects().map((o) => ({ ...o, dist: Math.abs(o.gx - p.gx) + Math.abs(o.gy - p.gy), reachable: canReach ? canReach(o) : null }));
    const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const groups = [];
    let n = 0;
    for (const [title, pick] of DIR_KINDS) {
      const list = objs.filter(pick).sort((x, y) => x.dist - y.dist);
      if (!list.length) continue;
      const lines = list.map((o) => {
        const mark = n < LET.length ? LET[n] : String(n - LET.length + 1);
        n++;
        o.mark = mark;
        let extra = '';
        if (o.kind === 'ferry') extra = ` — carries you to (${o.dest.gx},${o.dest.gy})`;
        else if (o.kind === 'switch') extra = ` — ${describeSwitch(o)}`;
        else if (o.dest) {
          const seen = memory.exit(scene, o.id);
          extra = ' ' + (seen ? `${memory.describeExit(seen)} (walked)` : describeDest(o.dest));
          // 没走过的出口说清楚;通向从没去过的场景再多说一句(full 档)
          if (fullHints && !seen && o.dest.scene !== scene) extra += been.has(o.dest.scene) ? ' (not walked yet; you have been to that scene another way)' : ' (not walked yet — leads somewhere you have NEVER been)';
        }
        if (o.battle) extra += ` — ${o.battle.onTalk ? 'talking to it starts' : 'HOSTILE, touching it starts'} a battle (${o.battle.names.join('、') || 'team ' + o.battle.team})${dangerTag(o)}`;
        extra += describeItemHints(o);
        if (o.reachable === false) extra += ' — NOT reachable from where you are (another part of this scene: get there through another exit)';
        const name = memory.npcName(scene, o.id);
        return `  ${mark} id=${o.id} at (${o.gx},${o.gy})${name ? ` 「${name}」` : ''}${o.blocking ? ' solid' : ''}${extra}`;
      });
      groups.push({ title, lines });
    }
    let text = groups.length
      ? groups.map((g) => `${g.title}:\n${g.lines.join('\n')}`).join('\n')
      : '(no exits or objects found in this scene)';
    const ex = objs.filter((o) => DIR_KINDS[0][1](o));
    if (ex.some((o) => o.reachable === false)) {
      text = `this scene is split into separate parts: from (${p.gx},${p.gy}) you can reach ${ex.filter((o) => o.reachable !== false).length} of its ${ex.length} exits; entries marked NOT reachable are in another part.\n` + text;
    }
    const ph = placeHintLine();
    if (ph) text += `\n${ph}`;
    if (fullHints) { const fr = frontierText(scene, been); if (fr) text += `\n${fr}`; }
    return { text, objects: objs, player: p, scene };
  }

  /**
   * 还没探索的方向:沿「去过的场景」往外找,列出最近的几处通向从没去过的场景的出口,并说明要经过哪些场景。
   * 死路(除了来路没有别的去处)直接说。连跑第 55–56 轮:场景 289 只有一个出口回 287,AI 不知道是死路,
   * 把满图的怪当成「挡路的」打了两轮多;287 的另一个出口(→ 285)才是往前的路。
   */
  function frontierText(scene, been) {
    const outOf = (sc) => router.sceneExits(sc).filter((x) => x.to.scene !== sc);
    const here = outOf(scene);
    const lines = [];
    const dests = [...new Set(here.map((x) => x.to.scene))];
    if (dests.length === 1 && been.has(dests[0])) lines.push(`this scene is a DEAD END: its only way out leads back to scene ${dests[0]}${sceneName(dests[0]) ? ` (${sceneName(dests[0])})` : ''} — nothing here is on the way to anywhere else`);
    // 按场景数做广度优先,只穿过去过的场景
    const prev = new Map([[scene, null]]), queue = [scene], found = [];
    while (queue.length && found.length < 4 && prev.size < 60) {
      const sc = queue.shift();
      for (const x of (sc === scene ? here : outOf(sc))) {
        const to = x.to.scene;
        if (!been.has(to) && to !== scene) {
          if (!found.some((f) => f.sc === sc && f.to === to)) found.push({ sc, to, x });
        } else if (!prev.has(to)) { prev.set(to, sc); queue.push(to); }
      }
    }
    if (!found.length) return lines.join('\n');
    const nm = (sc) => `scene ${sc}${sceneName(sc) ? ` (${sceneName(sc)})` : ''}`;
    const via = (sc) => { const chain = []; for (let c = sc; c != null && c !== scene; c = prev.get(c)) chain.unshift(c); return chain; };
    lines.push('unexplored (exits that lead somewhere you have never been, nearest first):');
    for (const f of found.slice(0, 4)) {
      const chain = via(f.sc);
      lines.push(`  ${f.sc === scene ? 'here' : `in ${nm(f.sc)}`}: exit id=${f.x.id} at (${f.x.gx},${f.x.gy}) → ${nm(f.to)}${chain.length ? ` — get there via ${chain.map((c) => `scene ${c}`).join(' → ')}` : ''}`);
    }
    return lines.join('\n');
  }

  /** 走一步发生跳变时,记下是哪个触碰触发器把我们送走的(按步入格所在的触发范围)。 */
  function recordJump(objs0, scene0, from, dirName) {
    const d = DIRS[dirName];
    const cell = { gx: from.gx + (d?.dgx || 0), gy: from.gy + (d?.dgy || 0) };
    let best = null, bestDist = Infinity;
    for (const o of objs0) {
      if (o.kind !== 'touch-trigger') continue;
      const dist = Math.max(Math.abs(o.gx - cell.gx), Math.abs(o.gy - cell.gy));
      if (dist <= Math.max(1, o.triggerMode - 4) && dist < bestDist) { best = o; bestDist = dist; }
    }
    const to = playerPos();
    // 认不出触发器、也没换场景 = 多半是被 NPC/剧情推开,不是出口
    if (!best && worldService.getSceneId() === scene0) return;
    memory.recordExit({ scene: scene0, triggerId: best ? best.id : null, at: best ? { gx: best.gx, gy: best.gy } : cell, to: { scene: worldService.getSceneId(), gx: to.gx, gy: to.gy } });
  }

  /**
   * 菜单对照(W3):截获(probes.menu,choose 按它动作)与引擎声明的菜单载荷比一比。
   * W4 之前 choose 仍靠截获,所以显示以截获为准;不一致记进 waitMismatch,W4 换成载荷时据此排查。
   */
  const PAYLOAD_KIND = { items: 'menu.items', magic: 'menu.magic', party: 'menu.party', screen: 'menu.screen' };
  let lastMenuCheck = null;
  function checkMenuPayload(menu) {
    const top = waitTop();
    if (!top || !menu) return;
    const want = PAYLOAD_KIND[menu.kind] || 'menu.list';
    const pl = top.payload || {};
    const why = top.kind !== want ? `kind ${top.kind} vs ${want}`
      : want !== 'menu.screen' && (pl.items?.length ?? 0) !== menu.items.length ? `items ${pl.items?.length} vs ${menu.items.length}`
        : want !== 'menu.screen' && pl.indexTracked !== false && !menu.selfTracked && pl.index !== menu.index ? `index ${pl.index} vs ${menu.index}`
          : null;
    const sig = `${top.token}|${why}`;
    if (!why || sig === lastMenuCheck) return;
    lastMenuCheck = sig;
    waitMismatch.total++;
    waitMismatch.byPair[`menu:${why.split(' ')[0]}`] = (waitMismatch.byPair[`menu:${why.split(' ')[0]}`] || 0) + 1;
    onLog({ type: 'wait-mismatch', menu: menu.kind, wait: top.kind, why, token: top.token });
  }
  function menuLines(m) {
    const menu = probes.menu;
    if (m !== 'menu' || !menu) return [];
    checkMenuPayload(menu);
    const head = menu.title
      || (menu.kind === 'items' ? 'item menu (choose an index; disabled = cannot be used here)'
        : menu.kind === 'party' ? 'choose a party member'
          : 'menu');
    const out = ['', `${head} — ${menu.kind === 'screen' ? 'press Menu to close' : 'use choose'}:`];
    const cur = menu.index;
    menu.items.forEach((it, i) => out.push(`  [${i}] ${it.label}${it.amount > 1 ? ' ×' + it.amount : ''}${it.price != null ? `  ${it.price}文` : ''}${it.enabled ? '' : ' (disabled)'}${i === cur ? '  <- cursor' : ''}`));
    if (probes.menuStack.length > 1) out.push(`  (nested ${probes.menuStack.length} deep; press Menu to back out)`);
    return out;
  }

  // observe 精简:物品栏只在变化时完整列出(后期 100+ 种,每次全列会吃光上下文);物体图例只列最近的
  const MAX_ITEMS_SHOWN = 40, MAX_LEGEND = 20;
  let lastInvSig = null, lastMapSig = null;
  function observe({ full = false } = {}) {
    const m = mode();
    const scene = trackScene();
    const p = playerPos();
    if (m === 'control') markVisited();
    const newLines = drainDialog();
    const out = [];
    out.push(`mode: ${m}`);
    if (m === 'crashed') {
      out.push(`the game engine crashed and cannot continue: ${probes.crash.message}`);
      out.push('nothing you press will help. Stop here and report this error (it is an engine bug); your saves are kept.');
      return out.join('\n');
    }
    if (scene == null) return out.concat(menuLines(m)).join('\n');   // 标题画面:还没有世界
    const sn = sceneName(scene);
    out.push(`scene: ${scene}${sn ? ` (${sn})` : ''}   player: (${p.gx},${p.gy}) facing ${DIR_NAME[worldService.getPartyDirection()] || '?'}`);
    const pt = party();
    if (pt.length) out.push('party: ' + pt.map((r) => `${r.name} Lv${r.level} HP${r.hp}/${r.maxHp} MP${r.mp}/${r.maxMp}`).join(' | '));
    out.push(`cash: ${worldService.getCash?.() ?? '?'}`);
    const inv = inventory();
    if (inv.length) {
      const labels = inv.map((it) => it.amount > 1 ? `${it.name}×${it.amount}` : it.name);
      const sig = labels.join('、');
      if (full || sig !== lastInvSig) {
        const shown = full ? labels : labels.slice(0, MAX_ITEMS_SHOWN);
        out.push(`items${lastInvSig != null && sig !== lastInvSig ? ' (changed)' : ''}: ` + shown.join('、') + (shown.length < labels.length ? `… (+${labels.length - shown.length} more; observe with full=true)` : ''));
      } else {
        out.push(`items: ${inv.length} kinds (unchanged; observe with full=true to list them)`);
      }
      lastInvSig = sig;
    }
    if (newLines.length) {
      out.push('', 'new text since last observation:');
      for (const l of newLines) out.push('  ' + l);
    }
    if (pendingNotes.length) out.push('', ...pendingNotes.splice(0).map((n) => `note: ${n}`));
    if (m === 'dialog') {
      const cur = dialogService.getCurrentLine?.();
      const t = cur && cleanText(cur.text), sp = cur?.source ? cleanText(cur.source) : '';
      if (t) out.push('', `dialog box (waiting for advance): ${sp ? sp + '：' : ''}${t}`);
    }
    if (m === 'anykey') out.push('', 'the game is waiting for a key press (a full-screen picture or text); call advance to continue');
    out.push(...menuLines(m));
    if (m === 'battle') out.push(...battleLines());
    if (m === 'control' || m === 'busy') {
      const mp = asciiMap(18, 11, full);
      // 原地连续动作(对话、调查、使用物品)时地图和物体都没变,不必每次重发 ~900 字的 ASCII 图
      const mapSig = `${scene}|${p.gx},${p.gy}|${mp.rows.join('/')}|${mp.legend.map((o) => `${o.id}@${o.gx},${o.gy}`).join(';')}`;
      if (!full && mapSig === lastMapSig) {
        out.push('', `local map: unchanged since the last observation (same position, nothing moved; observe with full=true to see it again)`);
        return out.join('\n');
      }
      lastMapSig = mapSig;
      out.push('', `local map (rotated grid; up/down/left/right = arrow keys; top-left = (${mp.origin.gx},${mp.origin.gy}); @ you, # blocked, . walkable${fullHints ? ', : walkable and already walked' : ''}, blank = off-map):`);
      for (const r of mp.rows) out.push('  |' + r.replace(/\s+$/, ''));
      if (mp.legend.length) {
        out.push('objects:');
        const scene = worldService.getSceneId();
        for (const o of mp.legend) {
          let extra = '';
          if (o.battle) {
            const who = o.battle.names.length ? o.battle.names.join('、') : `enemy team ${o.battle.team}`;
            extra += o.battle.onTalk
              ? ` — talking to it leads to a battle (${who})`
              : ` — HOSTILE: touching it starts a battle (${who})${o.battle.chases ? '; it chases you' : ''}${dangerTag(o)}`;
          }
          if (o.kind === 'npc') {
            memory.recordNpc(scene, o.id, { gx: o.gx, gy: o.gy });
            const name = memory.npcName(scene, o.id);
            if (name) extra = ` 「${name}」` + extra;
          }
          const seen = memory.exit(scene, o.id);
          if (seen) extra += ` ${memory.describeExit(seen)} (walked)`;
          else if (o.kind === 'ferry') extra += ` — stepping on it carries you to (${o.dest.gx},${o.dest.gy}); walk_to plans these rides for you`;
          else if (o.kind === 'switch') extra += ` — ${describeSwitch(o)}`;
          else if (o.dest) extra += ` ${describeDest(o.dest)}`;
          extra += describeItemHints(o);
          out.push(`  ${o.ch} id=${o.id} ${o.kind} at (${o.gx},${o.gy})${o.blocking ? ' solid' : ''}${extra}`);
        }
        if (mp.hidden) out.push(`  (+${mp.hidden} farther objects not listed; observe with full=true)`);
        const ph = placeHintLine();
        if (ph) out.push(ph);
      }
      // 屏幕外但已知的出口:地图记忆里有,legend 里没有的
      const shown = new Set(mp.legend.map((o) => o.id));
      const offscreen = memory.exitsIn(scene).filter((x) => !shown.has(x.triggerId));
      if (offscreen.length) {
        out.push('known exits elsewhere in this scene:');
        for (const x of offscreen) out.push(`  ${x.triggerId != null ? `id=${x.triggerId} ` : ''}at (${x.at.gx},${x.at.gy}) ${memory.describeExit(x)}`);
      } else if (!mp.legend.some((o) => (o.kind === 'touch-trigger' && o.dest) || o.kind === 'ferry')) {
        // 视野里一个出口都没有(扬州城外的大片野地):别让人盲走,告诉它 map 能列出全场景
        out.push('no exit in view — the map tool lists every exit in this scene (and where it leads)');
      }
    }
    return out.join('\n');
  }

  // ---- 按键 ----------------------------------------------------------------
  async function tap(keyName, ms = 90) {
    checkBudget();
    const k = Key[keyName];
    if (!k) throw new Error(`unknown key ${keyName}`);
    inputService.simulateKeyPress(k, ms);
    await sleep(ms + 40);
  }

  /** 走一步:按住方向键直到坐标变化(或超时),立即松开。返回是否移动。 */
  async function stepOnce(dirName) {
    checkBudget();
    const d = DIRS[dirName];
    const before = playerPos();
    const k = Key[d.key];
    // 手动按住/松开(pressKey/releaseKey 在 TS 里是 private,JS 可调):simulateKeyPress
    // 自带的定时松开会误伤下一步的按住,所以不用它。
    inputService._simulating = true;
    try { inputService.pressKey(k); } finally { inputService._simulating = false; }
    inputService.lastSimulatedAt = Date.now();
    let moved;
    try {
      moved = await waitUntil(() => { const p = playerPos(); return p.x !== before.x || p.y !== before.y; }, 400, 3);
    } finally {
      // input-service 对每次按键至少保持 MIN_KEY_HOLD_MS(防菜单漏键,#171),对走路来说会多走好几格。
      // 把按下时间清零 → 视为已按够久,立即松开。
      if (inputService._pressedAt) inputService._pressedAt[k] = 0;
      inputService.releaseKey(k);
    }
    await sleep(20);
    if (moved && mode() === 'control') markVisited();
    return moved;
  }

  // ---- A* -----------------------------------------------------------------
  // 二叉堆 + 封顶节点数:A* 是同步的,跑太久会卡住引擎主循环(心跳停 → 误判 busy)。
  /**
   * 触碰触发器的作用范围:引擎判定 |dx|+2|dy| < (mode-TouchNear)*32+16(像素);换到旋转网格恰好是
   * Chebyshev 距离 ≤ mode-4。寻路要绕开「非目标」触发器的范围,否则会被半路拽进别的房间/剧情。
   */
  /** 格 + 像素位移(0x006E 楼梯)→ 落点格 */
  function shiftedCell(c, shift) {
    const { x, y } = fromGrid(c.gx, c.gy);
    return toGrid(x + shift.dx, y + shift.dy);
  }

  /**
   * 同场景跳跃:踩进触发范围就被挪到本场景另一处(楼梯 0x006E、本场景内的 0x0046 传送)。
   * 寻路把它当单向边用(同荷叶摆渡),而不是当要绕开的触发范围 —— 否则上下楼永远「不连通」。
   */
  function isJump(o) {
    return o.kind === 'touch-trigger' && o.dest && !o.story && o.dest.scene === worldService.getSceneId() && o.dest.gx != null;
  }

  function touchZones(goal, from = null) {
    const zones = [];
    for (const o of objects()) {
      if (o.kind !== 'touch-trigger' && o.kind !== 'enemy') continue;
      if (isJump(o)) continue;   // 楼梯 / 本场景传送:寻路当边用(findPath 的 jumps)
      // 怪会走动,范围再放宽一格
      const r = Math.max(0, o.triggerMode - 4) + (o.kind === 'enemy' ? 1 : 0);
      if (Math.max(Math.abs(goal.gx - o.gx), Math.abs(goal.gy - o.gy)) <= r) continue;   // 目标就在它范围里 = 想去的就是它
      // 已经站在它范围里(怪走过来了、刚打完仗)= 绕不绕都已经在里面,先得走出来;当墙会把起点四周全封死
      if (from && Math.max(Math.abs(from.gx - o.gx), Math.abs(from.gy - o.gy)) <= r) continue;
      zones.push({ id: o.id, gx: o.gx, gy: o.gy, r, enemy: o.kind === 'enemy' });
    }
    return zones;
  }

  /**
   * 寻路。opt:noObjects 忽略会走动的物体(隐形墙仍挡);noZones 不绕触发范围;noVoid 虚空可走;
   * softEnemies:怪的触碰范围(和怪所在格)不再是墙,只是很贵 —— 怪堵在走廊里时,唯一的路就是从它身边/身上过去
   * (碰上就开战,打完接着走)。返回的方向数组带 .monsters = 途经的怪(按 id)。
   */
  function findPath(from, to, opt = {}) { return withObstacleMemo(() => findPathNow(from, to, opt)); }
  function findPathNow(from, to, opt = {}) {
    const maxNodes = opt.maxNodes ?? 30000;   // 整张地图 64×128×2 格;堆实现,搜满也只是几毫秒级
    const key = (x, y) => x * 4096 + y;
    const zones = opt.noZones ? [] : touchZones(to, from);
    const hardZones = opt.softEnemies ? zones.filter((z) => !z.enemy) : zones;
    const softZones = opt.softEnemies ? zones.filter((z) => z.enemy) : [];
    const within = (z, x, y) => Math.max(Math.abs(x - z.gx), Math.abs(y - z.gy)) <= z.r;
    const inZone = (x, y) => hardZones.some((z) => within(z, x, y));
    const SOFT_COST = 4;    // 每走一格怪的范围(穿过一只约 5 格):绕二十来格以内就绕,再远不如打一架 —— 怪会追,绕远路多半也躲不掉
    const softCost = (x, y) => softZones.reduce((c, z) => c + (within(z, x, y) ? SOFT_COST : 0), 0);
    const objs = objects();
    // 远超队伍等级、又会追人的怪(瘟神 Lv52):它的「追击范围」也尽量绕开 —— 只躲触碰范围的话,
    // 路线贴着它 3 格过,半秒就被扑上。很贵但不是墙:实在没别的路才穿过去(path.danger 记下来,walk_to 如实说)。
    const DANGER_COST = 10;
    const dangerZones = (!fullHints || opt.noZones) ? [] : objs.filter((o) => o.kind === 'enemy' && o.battle?.chaseRange && teamDanger(o.battle.team))
      .map((o) => ({ id: o.id, gx: o.gx, gy: o.gy, r: o.battle.chaseRange + 1 }));
    const dangerCost = (x, y) => dangerZones.reduce((c, z) => c + (within(z, x, y) ? DANGER_COST : 0), 0);
    // 怪所在格:引擎按实心物体挡路,软模式下可「走上去」(实际是碰上开战)
    const enemyCells = new Set(opt.softEnemies ? objs.filter((o) => o.kind === 'enemy').map((o) => key(o.gx, o.gy)) : []);
    // 隐形墙不会走动:noObjects 也照样当墙
    // 隐形墙、关着的石门这类不会走动的:noObjects 也照样当墙(否则会规划穿过关着的门)
    const walls = new Set(objs.filter((o) => o.wall || o.fixed).map((o) => key(o.gx, o.gy)));
    const blocked = (x, y, k) => opt.noObjects ? (blockedAt(x, y, false) || walls.has(k))
      : (blockedAt(x, y, true) && !(enemyCells.has(k) && !blockedAt(x, y, false)));
    // 虚空(两层无图块)按墙算,免得规划出走出地图的路;但门/出口常在地图边缘、压在虚空上,
    // 所以触碰触发器附近(范围 +2)的虚空仍可走。
    const doors = objs.filter((o) => o.kind === 'touch-trigger').map((o) => ({ gx: o.gx, gy: o.gy, r: Math.max(0, o.triggerMode - 4) + 2 }));
    const badVoid = (x, y) => !opt.noVoid && voidAt(x, y) && !doors.some((d) => Math.max(Math.abs(x - d.gx), Math.abs(y - d.gy)) <= d.r);
    const goal = key(to.gx, to.gy);
    // 摆渡 = 单向边:踩上荷叶格 → 落到对岸。荷叶格本身不当落脚点(踩上就被载走)
    const ferries = new Map();
    // 乘过去后荷叶停在落点旁(最后一段 0x0044 的位置),踩那格会被载回去 —— 所以停靠格不能当路走
    const parked = new Set();
    if (!opt.noFerries) for (const o of objs) if (o.kind === 'ferry' && o.dest) { ferries.set(key(o.gx, o.gy), o); if (o.parkAt) parked.add(key(o.parkAt.gx, o.parkAt.gy)); }
    // 目标就在某个楼梯 / 传送的范围里 = 想去的就是它(走进去被送走,同普通触发器):这个不当边用
    const jumps = opt.noJumps ? [] : objs.filter(isJump).map((o) => ({ o, r: Math.max(0, o.triggerMode - 4) }))
      .filter((j) => Math.max(Math.abs(to.gx - j.o.gx), Math.abs(to.gy - j.o.gy)) > j.r);
    const jumpAt = (x, y) => jumps.find((j) => Math.max(Math.abs(x - j.o.gx), Math.abs(y - j.o.gy)) <= j.r);
    const heap = [];
    const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (x, y) => Math.abs(x - to.gx) + Math.abs(y - to.gy);
    const start = key(from.gx, from.gy);
    const touched = new Set();
    const came = new Map([[start, null]]);
    const gScore = new Map([[start, 0]]);
    push({ gx: from.gx, gy: from.gy, g: 0, f: h(from.gx, from.gy) });
    let n = 0;
    while (heap.length && n++ < maxNodes) {
      const cur = pop();
      const ck = key(cur.gx, cur.gy);
      if (cur.g > (gScore.get(ck) ?? Infinity)) continue;
      if (ck === goal) {
        const path = [];
        path.ferries = new Map();   // 步序号 → 这一步踩上的摆渡
        let k = ck;
        const rev = [];
        while (came.get(k)) { const [dir, prevK, ferry] = came.get(k); rev.push([dir, ferry]); k = prevK; }
        rev.reverse().forEach(([dir, ferry], i) => { path.push(dir); if (ferry) path.ferries.set(i, ferry); });
        path.monsters = [];
        path.danger = [];
        if (dangerZones.length) {
          let c = { gx: from.gx, gy: from.gy };
          for (const [i, dir] of path.entries()) {
            const f = path.ferries.get(i);
            c = f ? { gx: f.dest.gx, gy: f.dest.gy } : { gx: c.gx + DIRS[dir].dgx, gy: c.gy + DIRS[dir].dgy };
            for (const z of dangerZones) if (within(z, c.gx, c.gy) && !path.danger.includes(z.id)) path.danger.push(z.id);
          }
        }
        if (softZones.length) {
          let c = { gx: from.gx, gy: from.gy };
          for (const [i, dir] of path.entries()) {
            const f = path.ferries.get(i);
            c = f ? { gx: f.dest.gx, gy: f.dest.gy } : { gx: c.gx + DIRS[dir].dgx, gy: c.gy + DIRS[dir].dgy };
            for (const z of softZones) if (within(z, c.gx, c.gy) && !path.monsters.includes(z.id)) path.monsters.push(z.id);
          }
        }
        return path;
      }
      for (const [name, d] of Object.entries(DIRS)) {
        const nx = cur.gx + d.dgx, ny = cur.gy + d.dgy, nk = key(nx, ny);
        // 楼梯:走进它的触发范围(这一格本身要能走)→ 被挪到落点;相对位移的落点随踩进的格变
        const jump = nk !== goal ? jumpAt(nx, ny) : null;
        if (jump) {
          if (blocked(nx, ny, nk) || badVoid(nx, ny)) continue;
          const land = jump.o.dest.shift ? shiftedCell({ gx: nx, gy: ny }, jump.o.dest.shift) : { gx: jump.o.dest.gx, gy: jump.o.dest.gy };
          const lk = key(land.gx, land.gy);
          const g = cur.g + 2;
          if (lk === ck || g >= (gScore.get(lk) ?? Infinity)) continue;
          gScore.set(lk, g);
          came.set(lk, [name, ck, { id: jump.o.id, gx: jump.o.gx, gy: jump.o.gy, dest: land, jump: true }]);
          push({ gx: land.gx, gy: land.gy, g, f: g + h(land.gx, land.gy) });
          continue;
        }
        const ferry = ferries.get(nk);
        if (ferry && nk !== goal) {
          const fk = key(ferry.dest.gx, ferry.dest.gy);
          const g = cur.g + 2;   // 乘一趟约等于走两格:比绕远路便宜,但不鼓励来回乘
          if (g >= (gScore.get(fk) ?? Infinity)) continue;
          gScore.set(fk, g);
          came.set(fk, [name, ck, ferry]);
          push({ gx: ferry.dest.gx, gy: ferry.dest.gy, g, f: g + h(ferry.dest.gx, ferry.dest.gy) });
          continue;
        }
        // explore:能走进、但会被触发的格(门 / 触发器的范围)算「够得着」,只是不从那里接着走
        if (opt.explore && !blocked(nx, ny, nk) && !badVoid(nx, ny) && inZone(nx, ny)) touched.add(nk);
        // 终点允许是「只被物体占着」的格(触发器、门口),否则必须完全可走
        if (nk === goal ? (blockedAt(nx, ny, false) || walls.has(nk) || badVoid(nx, ny)) : (blocked(nx, ny, nk) || badVoid(nx, ny) || inZone(nx, ny) || parked.has(nk))) continue;
        const g = cur.g + 1 + (softZones.length ? softCost(nx, ny) : 0) + (dangerZones.length ? dangerCost(nx, ny) : 0);
        if (g >= (gScore.get(nk) ?? Infinity)) continue;
        gScore.set(nk, g);
        came.set(nk, [name, ck]);
        push({ gx: nx, gy: ny, g, f: g + h(nx, ny) });
      }
    }
    lastPathFail = heap.length ? 'limit' : 'disconnected';   // 堆没空 = 预算用完;空了 = 真的不连通
    if (!heap.length) lastReach = gScore;                     // 搜遍了:够得着的格子都在这里,报「最近能到哪」用
    // explore:不找终点,要的是「从这里走得到的所有格」(map 用它标出走不到的出口 / 物体)
    if (opt.explore) return { reached: new Set([...came.keys(), ...touched]), complete: !heap.length, key };
    return null;
  }
  let lastPathFail = null, lastReach = null;
  /** 从 from 出发(怪可穿过)搜遍可达区,取离 (gx,gy) 最近的格:切比雪夫距离优先,再比曼哈顿 */
  function closestReachable(from, gx, gy) {
    lastReach = null;
    findPath(from, { gx, gy }, { softEnemies: true });
    if (lastPathFail !== 'disconnected' || !lastReach) return null;
    let best = null;
    for (const k of lastReach.keys()) {
      const x = Math.floor((k + 2048) / 4096), y = k - x * 4096;
      const c = Math.max(Math.abs(x - gx), Math.abs(y - gy)), m = Math.abs(x - gx) + Math.abs(y - gy);
      if (!best || c < best.c || (c === best.c && m < best.m)) best = { gx: x, gy: y, c, m };
    }
    return best;
  }

  // ---- 动作 ----------------------------------------------------------------
  const notControl = (verb) => `cannot ${verb}: mode is ${mode()} (need control)`;

  /**
   * 停在门/触发器范围内时,触发要晚一两帧才发生(#18 之后帧节奏变了):稍等再看是否被传送走,
   * 免得报「arrived」而人其实已经进了别的场景。没事发生返回 null。
   */
  async function afterStop(gx, gy, steps, verb = 'arrived at') {
    const scene0 = worldService.getSceneId();
    const objsAt = objects();
    const moved = () => mode() !== 'control' || worldService.getSceneId() !== scene0 || playerPos().gx !== gx || playerPos().gy !== gy;
    await waitUntil(moved, 400, 20);
    if (!moved()) return null;
    const m = await settle();
    const q = playerPos();
    if (worldService.getSceneId() !== scene0 || Math.abs(q.gx - gx) + Math.abs(q.gy - gy) > 1) {
      recordJump(objsAt, scene0, { gx, gy }, null);
      return { ok: true, note: `entered a new area after ${steps} steps (scene ${worldService.getSceneId()}, now at (${q.gx},${q.gy})) — re-observe before moving on` };
    }
    if (m !== 'control') return { ok: false, note: `${verb} (${gx},${gy}) in ${steps} steps, then something triggered; mode now ${m}` };
    return null;
  }

  /** 「怪 id=… (名字)」,给 walk_to 的说明用 */
  function describeMonsters(ids) {
    const objs = objects();
    const MAX = 3;
    return ids.slice(0, MAX).map((id) => {
      const o = objs.find((x) => x.id === id);
      const who = o?.battle?.names?.length ? ` (${o.battle.names.join('、')}${o ? dangerTag(o).replace(' — ', '; ') : ''})` : '';
      return `id=${id}${o ? ` at (${o.gx},${o.gy})` : ''}${who}`;
    }).join(', ') + (ids.length > MAX ? ` and ${ids.length - MAX} more` : '');
  }

  async function walkTo(gx, gy) {
    if (mode() !== 'control') return { ok: false, note: notControl('walk') };
    let replans = 0, steps = 0;
    const rides = [];
    const passed = [];   // 软寻路途经的怪(碰上会开战)
    const nearDanger = [];   // 路线不得不穿过其追击范围的强怪
    const dangerNote = () => (nearDanger.length ? `; WARNING: no route stays out of the chase range of ${nearDanger.slice(0, 4).map((id) => { const o = objects().find((x) => x.id === id); return o ? `${(o.battle?.names || []).join('、') || 'monster'} at (${o.gx},${o.gy})` : `id=${id}`; }).join(', ')}${nearDanger.length > 4 ? ` and ${nearDanger.length - 4} more` : ''} — it will come after you, so going around is not possible: you need to be able to beat it (level up, better gear) or accept the fight` : '');
    const rideNote = () => (rides.length ? ` (${rides.join('; ')})` : '') + (passed.length ? ` (route went past monster ${describeMonsters(passed)})` : '') + dangerNote();
    while (replans < 4) {
      const p = playerPos();
      if (p.gx === gx && p.gy === gy) {
        if (steps > 0) { const t = await afterStop(gx, gy, steps); if (t) return t; }
        return { ok: true, note: `arrived at (${gx},${gy}) in ${steps} steps${rideNote()}` };
      }
      let path = findPath(p, { gx, gy });
      // 鸡、小孩之类会走动的 NPC 是「实心」的,当静态墙会把路堵死(余杭村井边就是一圈)。
      // 绕不过去就当它们可穿:真撞上时 stepOnce 失败 → 重新规划,通常它们已经走开了。
      if (!path) path = findPath(p, { gx, gy }, { noObjects: true });
      // 怪的触碰范围默认当墙绕开;怪堵在走廊里(锁妖塔满地都是)就只能从它身边过去 —— 撞上开战,打完再走
      if (!path) path = findPath(p, { gx, gy }, { softEnemies: true }) || findPath(p, { gx, gy }, { softEnemies: true, noObjects: true });
      let target = { gx, gy };
      if (!path) {
        // 目标格本身不可站(墙上的门/触发器常见):退而求其次,走到离它最近的可站格
        const near = [];
        // 目标是出口这类触碰触发:先找它触发范围里能站的格 —— 门格本身常压在走不到的地方,
        // 离门最近的格未必在触发范围里,站过去也不会触发
        const trig = objects().find((o) => o.gx === gx && o.gy === gy && o.triggerMode >= 4);
        const tr = trig ? Math.max(0, trig.triggerMode - 4) : 0;
        for (let dx = -tr; dx <= tr; dx++) for (let dy = -tr; dy <= tr; dy++) {
          if ((dx || dy) && !blockedAt(gx + dx, gy + dy, true)) near.push({ gx: gx + dx, gy: gy + dy });
        }
        near.sort((u, v) => (Math.abs(u.gx - gx) + Math.abs(u.gy - gy)) - (Math.abs(v.gx - gx) + Math.abs(v.gy - gy)));
        for (let r = 1; r <= 3 && !near.length; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) + Math.abs(dy) !== r) continue;
            if (!blockedAt(gx + dx, gy + dy, true)) near.push({ gx: gx + dx, gy: gy + dy });
          }
        }
        for (const c of near) { path = findPath(p, c); if (path) { target = c; break; } }
        if (!path) for (const c of near) { path = findPath(p, c, { softEnemies: true }); if (path) { target = c; break; } }
        if (!path) {
          // 怪已经按「可穿过」算过了:剩下的要么是墙,要么只能穿过别的出口(= 另一片区域)
          const why = lastPathFail === 'limit'
            ? 'the search hit its limit (very long or winding route) — walk to an intermediate point first'
            : 'it is not connected to where you are (walls, or the way is through another exit/area)';
          let route = null;
          if (lastPathFail !== 'limit') { try { route = router.plan({ scene: worldService.getSceneId(), gx: p.gx, gy: p.gy }, gx, gy); } catch { /* */ } }
          if (route) return { ok: false, route: route.steps, note: `no direct path from (${p.gx},${p.gy}) to (${gx},${gy}) inside this area — but ${route.text}\n(follow it one step at a time: walk_to each exit / switch — or the cell given after it, which is inside its trigger range — then walk_to the target)` };
          // 目标在墙后(台子上的 boss、关着的屋子)时,告诉它最近能站到哪 —— 远程触发的东西往往站那儿就够了
          const near0 = lastPathFail === 'disconnected' ? closestReachable(p, gx, gy) : null;
          const closest = near0 && (near0.gx !== p.gx || near0.gy !== p.gy) ? `; the closest you can get from here is (${near0.gx},${near0.gy}), ${near0.c} cell(s) from the target` : '';
          return { ok: false, closest: near0 ? { x: near0.gx, y: near0.gy } : undefined, note: `no path from (${p.gx},${p.gy}) to (${gx},${gy}) or any walkable cell near it: ${why}${closest}` };
        }
        if (p.gx === target.gx && p.gy === target.gy) {
          // 已经贴着目标(如紧挨铜门出口):门格本身是墙,但往它那边迈一步就会触发 —— 照 step 那样走一步
          const dir = Object.keys(DIRS).find((n) => p.gx + DIRS[n].dgx === gx && p.gy + DIRS[n].dgy === gy);
          if (!dir) return { ok: false, note: `(${gx},${gy}) is not walkable; already at nearest cell (${p.gx},${p.gy})` };
          const scene0 = worldService.getSceneId();
          const r = await step(dir, 1);
          const q = playerPos();
          if (worldService.getSceneId() !== scene0 || Math.abs(q.gx - p.gx) + Math.abs(q.gy - p.gy) > 1) {
            return { ok: true, note: `stepped ${dir} onto (${gx},${gy}) and entered a new area after ${steps + 1} steps (scene ${worldService.getSceneId()}, now at (${q.gx},${q.gy})) — re-observe before moving on` };
          }
          if (mode() !== 'control') return { ok: false, note: `stepped ${dir} toward (${gx},${gy}): ${r.note}; mode now ${mode()}` };
          if (q.gx === gx && q.gy === gy) { steps++; continue; }
          const door = objects().some((o) => (o.kind === 'touch-trigger' || o.kind === 'ferry') && o.gx === gx && o.gy === gy);
          if (door) { const t = await afterStop(p.gx, p.gy, steps, 'pressed toward it at'); if (t) return t; }
          return { ok: false, note: `(${gx},${gy}) is not walkable; already at nearest cell (${p.gx},${p.gy}) and stepping ${dir} into it did nothing` };
        }
      }
      for (const id of path.monsters || []) if (!passed.includes(id)) passed.push(id);
      for (const id of path.danger || []) if (!nearDanger.includes(id)) nearDanger.push(id);
      let interrupted = false, rode = null;
      const scene0 = worldService.getSceneId();
      for (const [i, dir] of path.entries()) {
        if (typeof e.isHumanTakeover === 'function' && e.isHumanTakeover()) {
          return { ok: false, note: `stopped after ${steps} steps (human player took over in browser)` };
        }
        const q0 = playerPos();
        const objs0 = objects();
        const ok = await stepOnce(dir);
        const ferry = path.ferries?.get(i);
        if (ferry && ok) {
          // 计划内的摆渡:等载完(期间是 busy),落地后从落点重新规划剩下的路
          await settle();
          const q = playerPos();
          if (mode() === 'control' && worldService.getSceneId() === scene0) { steps++; rode = { ferry, at: q }; rides.push(ferry.jump ? `took the stairs/passage id=${ferry.id} at (${ferry.gx},${ferry.gy}) to (${q.gx},${q.gy})` : `rode ${ferry.id} from (${ferry.gx},${ferry.gy}) to (${q.gx},${q.gy})`); break; }
          interrupted = true; break;
        }
        if (mode() !== 'control') {
          // 踩上门:换场景要几帧,期间等待栈是空的(busy)。先等稳定,再看是不是被传送走了
          await settle();
          const q1 = playerPos();
          if (ok && (worldService.getSceneId() !== scene0 || Math.abs(q1.gx - q0.gx) + Math.abs(q1.gy - q0.gy) > 1)) {
            steps++;
            recordJump(objs0, scene0, q0, dir);
            return { ok: true, note: `entered a new area after ${steps} steps (scene ${worldService.getSceneId()}, now at (${q1.gx},${q1.gy})) — re-observe before moving on` };
          }
          if (ok) steps++;
          interrupted = true; break;
        }
        if (!ok) break;
        steps++;
        const q1 = playerPos();
        if (worldService.getSceneId() !== scene0 || Math.abs(q1.gx - q0.gx) + Math.abs(q1.gy - q0.gy) > 1) {
          await settle();
          recordJump(objs0, scene0, q0, dir);
          return { ok: true, note: `entered a new area after ${steps} steps (scene ${worldService.getSceneId()}, now at (${q1.gx},${q1.gy})) — re-observe before moving on` };
        }
      }
      if (rode && !interrupted && rides.length <= 16) continue;   // 乘完摆渡 / 走完楼梯不算一次重规划(封顶,防来回跳)
      if (interrupted || mode() !== 'control') {
        const m = await settle();
        const why = m === 'battle' && passed.length ? `; the only route passes monster ${describeMonsters(passed)}, so battles on the way are expected — finish the battle, then walk_to again` : '';
        // 走到的地方正好站着一只远超队伍等级的怪(瘟神):当场说清楚,别等它自己翻 observe
        const danger = m === 'battle' ? dangerOf((battleState()?.enemy || []).filter((x) => x && x.objectID).map((x) => x.objectID)) : '';
        return { ok: false, note: `interrupted after ${steps} steps (something triggered; mode now ${m}${why})${danger ? ` — DANGER: ${danger}` : ''}${dangerNote()}` };
      }
      const q = playerPos();
      if (q.gx === target.gx && q.gy === target.gy && (target.gx !== gx || target.gy !== gy)) {
        // 目标是门这类不可站的格:停在旁边时门的触发同样晚一两帧
        const door = objects().some((o) => (o.kind === 'touch-trigger' || o.kind === 'ferry') && o.gx === gx && o.gy === gy);
        if (steps > 0 && door) { const t = await afterStop(q.gx, q.gy, steps, 'stopped next to it at'); if (t) return t; }
        return { ok: true, note: `(${gx},${gy}) itself is not walkable; stopped at nearest cell (${q.gx},${q.gy}) after ${steps} steps${rideNote()}` };
      }
      replans++;
    }
    const p = playerPos();
    // 指出是谁挡路:紧挨着的实心物体(多半是站在窄口里的 NPC,如修围篱的林木匠)
    const scene = worldService.getSceneId();
    const blocker = objects().filter((o) => o.blocking && Math.max(Math.abs(o.gx - p.gx), Math.abs(o.gy - p.gy)) <= 1)
      .sort((a, b) => (Math.abs(a.gx - gx) + Math.abs(a.gy - gy)) - (Math.abs(b.gx - gx) + Math.abs(b.gy - gy)))[0];
    const who = blocker?.wall ? `; blocked by an invisible wall (object id=${blocker.id} at (${blocker.gx},${blocker.gy})) — this way is closed for now`
      : blocker ? `; blocked by object id=${blocker.id}${memory.npcName(scene, blocker.id) ? ` 「${memory.npcName(scene, blocker.id)}」` : ''} at (${blocker.gx},${blocker.gy}) — it is not moving; try talking to it or find another way` : '';
    return { ok: p.gx === gx && p.gy === gy, note: `stopped at (${p.gx},${p.gy}) after ${steps} steps (blocked repeatedly${who})` };
  }

  async function step(dirName, n = 1) {
    if (!DIRS[dirName]) return { ok: false, note: `bad direction ${dirName}` };
    if (mode() !== 'control') return { ok: false, note: notControl('step') };
    let moved = 0;
    const scene0 = worldService.getSceneId();
    for (let i = 0; i < n; i++) {
      if (typeof e.isHumanTakeover === 'function' && e.isHumanTakeover()) {
        return { ok: moved > 0, note: `moved ${moved}, then stopped (human player took over in browser)` };
      }
      const q0 = playerPos();
      const objs0 = objects();
      const ok = await stepOnce(dirName);
      const q1 = playerPos();
      if (ok && (worldService.getSceneId() !== scene0 || Math.abs(q1.gx - q0.gx) + Math.abs(q1.gy - q0.gy) > 1)) {
        await settle();
        recordJump(objs0, scene0, q0, dirName);
        return { ok: true, note: `moved ${moved + 1}, entered a new area (scene ${worldService.getSceneId()})` };
      }
      if (mode() !== 'control') {
        await settle();
        const q2 = playerPos();
        if (ok && (worldService.getSceneId() !== scene0 || Math.abs(q2.gx - q0.gx) + Math.abs(q2.gy - q0.gy) > 1)) {
          recordJump(objs0, scene0, q0, dirName);
          return { ok: true, note: `moved ${moved + 1}, entered a new area (scene ${worldService.getSceneId()})` };
        }
        return { ok: true, note: `moved ${moved + (ok ? 1 : 0)} then something triggered` };
      }
      if (!ok) return { ok: moved > 0, note: `moved ${moved}, then blocked` };
      moved++;
    }
    // 停在门/触碰触发器上:触发晚一两帧才发生(同 walk_to 的 afterStop),稍等再看是否被传送走
    const p = playerPos();
    const onTrigger = moved > 0 && objects().some((o) => (o.kind === 'touch-trigger' || o.kind === 'ferry')
      && Math.max(Math.abs(o.gx - p.gx), Math.abs(o.gy - p.gy)) <= Math.max(0, o.triggerMode - 4));
    if (onTrigger) {
      const objs0 = objects();
      const jumped = () => mode() !== 'control' || worldService.getSceneId() !== scene0 || playerPos().gx !== p.gx || playerPos().gy !== p.gy;
      await waitUntil(jumped, 400, 20);
      if (jumped()) {
        await settle();
        const q = playerPos();
        if (worldService.getSceneId() !== scene0 || Math.abs(q.gx - p.gx) + Math.abs(q.gy - p.gy) > 1) {
          recordJump(objs0, scene0, p, null);
          return { ok: true, note: `moved ${moved}, entered a new area (scene ${worldService.getSceneId()})` };
        }
        if (mode() !== 'control') return { ok: true, note: `moved ${moved} then something triggered` };
      }
    }
    return { ok: true, note: `moved ${moved}` };
  }

  function face(dirName) {
    worldService.setPartyDirection(DIRS[dirName].dir);
    try { worldService.updatePartyGestures?.(false); } catch { /* */ }
  }

  async function search() {
    if (mode() !== 'control') return { ok: false, note: notControl('search') };
    await tap('Search', 90);
    const m = await settle();
    return { ok: true, note: `searched; mode now ${m}` };
  }

  /** 走到目标物体旁边并面朝它按「搜索」(对话/调查)。 */
  /** 走到物体旁边并面朝它(不按键)。返回 { ok, note, dir }。 */
  async function approach(id) {
    if (mode() !== 'control') return { ok: false, note: notControl('approach') };
    const o = objects().find((x) => x.id === id);
    if (!o) return { ok: false, note: `object ${id} not found in this scene` };
    const p = playerPos();
    // 「搜索」够得着的距离:引擎从主角脚下沿朝向查 6·mode−4 个点,直线上是 1 / 3 / 4 格(mode 1 / 2 / 3)。
    // 先只试紧挨着的四格(同以前);都站不上(书中仙身前那格是隐形墙)再隔着一两格搜。
    const reach = o.triggerMode >= 3 ? 4 : o.triggerMode === 2 ? 3 : 1;
    const sides = (k) => Object.entries(DIRS)
      .map(([name, d]) => ({ name, k, gx: o.gx - k * d.dgx, gy: o.gy - k * d.dgy }))   // 站在这格、面朝 name 就对着物体
      .filter((c) => (c.gx === p.gx && c.gy === p.gy) || !blockedAt(c.gx, c.gy, true))
      .sort((a, b) => (Math.abs(a.gx - p.gx) + Math.abs(a.gy - p.gy)) - (Math.abs(b.gx - p.gx) + Math.abs(b.gy - p.gy)));
    const cands = sides(1);
    for (let k = 2; k <= reach; k++) cands.push(...sides(k));
    // 已经站在够得着的格上:紧挨着,或者中间那格挡路、过不去(比如隔着栏杆正对船夫)—— 原地转身就搜,
    // 别先走开去试别的格。中间那格能站时照旧先走过去贴着搜(隔着搜并不总灵)
    const here = cands.findIndex((c) => c.gx === p.gx && c.gy === p.gy
      && (c.k === 1 || blockedAt(c.gx + DIRS[c.name].dgx, c.gy + DIRS[c.name].dgy, true)));
    if (here > 0) cands.unshift(...cands.splice(here, 1));
    for (const c of cands) {
      // 用「现在」的位置判断要不要走:前面试过的格子没走到时人已经离开出发点了
      const cur = playerPos();
      if (!(c.gx === cur.gx && c.gy === cur.gy)) {
        const r = await walkTo(c.gx, c.gy);
        if (mode() !== 'control') return { ok: false, note: r.note };
        const q = playerPos();
        if (q.gx !== c.gx || q.gy !== c.gy) continue;
      }
      face(c.name);
      await sleep(60);
      const far = c.k > 1 ? ` from ${c.k} cells away (the cell next to it is blocked; searching reaches across)` : '';
      return { ok: true, note: `facing ${c.name} toward object ${id}${far}`, dir: c.name, far };
    }
    return { ok: false, note: `no reachable side of object ${id}` };
  }

  /** 走到目标物体旁边并面朝它按「搜索」(对话/调查)。 */
  // 记名字:interact 后的这段对白里第一个不是主角的说话人。对白常由主角先开口(「去去去！」),
  // 对方的名字要到 advance 之后才出现,所以挂一个「待认领」的谈话,interact/advance 后都试一次。
  let pendingTalk = null;
  function learnName() {
    const t = pendingTalk;
    if (!t) return;
    try {
      // 队友(不止领队)的台词不算:调查古董商尸体时开口的是林月如,不能把尸体记成「林月如」
      const heroes = heroNames();
      const fresh = dialogHistory().filter((h) => !t.before.has(h));   // 历史有上限会滚动,按引用判新
      const speaker = fresh.map((h) => h && h.source && String(h.source).trim()).find((src) => src && !heroes.has(src));
      if (speaker) { memory.recordNpc(t.scene, t.id, { name: speaker }); pendingTalk = null; }
    } catch { /* */ }
  }

  async function interact(id) {
    pendingTalk = { scene: worldService.getSceneId(), id, before: new Set(dialogHistory()) };
    const r = await approach(id);
    // 走近途中就进了对白 = 别人(常是靠近即触发的 NPC)先开口,分不清是谁 → 不认领
    if (!r.ok) { pendingTalk = null; return r; }
    await tap('Search', 90);
    const m = await settle();
    learnName();
    return { ok: true, note: `faced ${r.dir} toward object ${id}${r.far || ''} and searched; mode now ${m}` };
  }

  /** 连续推进对白,直到不再是 dialog(或到上限)。 */
  async function advance(max = 40) {
    try { return await advanceInner(max); } finally { learnName(); if (mode() !== 'dialog') pendingTalk = null; }
  }
  async function advanceInner(max) {
    let n = 0;
    while (n < max) {
      if (typeof e.isHumanTakeover === 'function' && e.isHumanTakeover()) break;
      const m = mode();
      if (m !== 'dialog' && m !== 'anykey') break;
      const paceMs = typeof e.storyPaceMs === 'function' ? e.storyPaceMs() : 0;
      if (paceMs > 0) {
        await sleep(paceMs);
        if (typeof e.isHumanTakeover === 'function' && e.isHumanTakeover()) break;
      }
      const top = waitsSvc()?.top();
      if (top && (top.kind === 'dialog' || top.kind === 'anykey')) {
        const r = await respondTop({ advance: true }, 5000);
        if (!r.ok) await tap('Search', 80);           // 回应被拒(过期等):退回按键
      } else {
        await tap('Search', 80);
      }
      n++;
      await settle();
    }
    return { ok: n > 0, note: `advanced ${n} time(s); mode now ${mode()}` };
  }

  async function choose(index) {
    const top = waitsSvc()?.top();
    if (mode() === 'menu' && top && top.kind.startsWith('menu.')) return chooseByRespond(index, top);
    if (mode() !== 'menu' || !probes.menu) return { ok: false, note: `no menu open (mode ${mode()})` };
    const menu = probes.menu;
    if (menu.kind === 'screen') return { ok: false, note: 'this is a read-only screen; press Menu to close it' };
    const items = menu.items;
    if (index < 0 || index >= items.length) return { ok: false, note: `index out of range 0..${items.length - 1}` };
    if (!items[index].enabled) return { ok: false, note: `[${index}] ${items[index].label} is disabled here` };
    if (menu.setIndex) {
      menu.setIndex(index);                                  // 物品格:光标直接写
      await sleep(80);
    } else if (menu.selfTracked) {
      while (menu.index !== index) {                         // 选人:光标读不到,自己数
        const dir = index > menu.index ? 'Down' : 'Up';
        await tap(dir, 70);
        menu.index += dir === 'Down' ? 1 : -1;
      }
    } else {
      for (let guard = 0; guard < 30 && probes.menu === menu && menu.index !== index; guard++) {
        const before = menu.index;
        await tap(index > menu.index ? 'Down' : 'Up', 70);
        if (menu.index === before) await tap(index > menu.index ? 'Right' : 'Left', 70);   // 横排菜单
      }
    }
    if (probes.menu === menu && menu.index !== index) return { ok: false, note: `could not move cursor to ${index} (at ${menu.index})` };
    const label = items[index]?.label;
    await tap('Search', 90);
    if (menu.transient) menu.pop?.();               // 内联选人循环没有出口钩子,选完自己出栈
    const m = await settle();
    return { ok: true, note: `chose [${index}] ${label}; mode now ${m}` };
  }

  /** W4:按菜单载荷校验,回应 { choose: i }。显示用的标签仍取截获(observe 列的就是它),没有截获时取载荷。 */
  async function chooseByRespond(index, top) {
    if (top.kind === 'menu.screen') return { ok: false, note: 'this is a read-only screen; press Menu to close it' };
    const items = top.payload?.items || [];
    if (index < 0 || index >= items.length) return { ok: false, note: `index out of range 0..${items.length - 1}` };
    const menu = probes.menu;
    const label = (menu && menu.items?.length === items.length ? menu.items[index]?.label : null) ?? items[index].label;
    if (!items[index].enabled) return { ok: false, note: `[${index}] ${label} is disabled here` };
    const r = await respondTop({ choose: index });
    if (!r.ok) return { ok: false, note: `could not choose [${index}] ${label}: ${r.note || r.reason}` };
    if (menu?.transient) menu.pop?.();               // 内联选人循环没有出口钩子,选完自己出栈
    const m = await settle();
    return { ok: true, note: `chose [${index}] ${label}; mode now ${m}` };
  }

  /** 打开「使用物品」菜单 → 选物品 → (需要时)选对象。物品名按包含匹配。 */
  /** 当前场景各物体的触发脚本/状态快照 —— 物品脚本常常只是悄悄改 NPC 的触发脚本(0x25)。 */
  function objectScripts() {
    const m = new Map();
    for (const en of worldService.getEventObjectsInCurrentScene() || []) {
      const st = en && en.state;
      // 不比 state:会动画的物体(荷叶、水面)state 来回变,之前因此误报「改了 244、245… 的反应」;
      // 也不比 autoScript:走动的 NPC 每帧推进自动脚本指针。物品脚本改的是触发脚本(0x0025)或触发方式(0x0081)
      if (st) m.set(en.id ?? en.index + 1, `${st.triggerScript}/${st.triggerMode}`);
    }
    return m;
  }

  /**
   * 物品对谁有效:顺着使用脚本里串起来的「不面朝某物体就跳下一个」(0x0081)收集目标物体号,
   * 只留当前场景里的。例:破天鎚只对仙灵岛的 6 座石像(238–243)有效,桂花酒只对醉道士(63)。
   */
  function itemIdByName(name) {
    for (const slot of worldService.getInventory() || []) {
      if (slot && slot.item && (word(slot.item) === name || word(slot.item).includes(name))) return slot.item;
    }
    return 0;
  }
  function itemTargets(name) {
    const ids = itemUses(itemIdByName(name)).filter((u) => u.how === 'face').map((u) => u.id);
    const here = new Map(objects().map((o) => [o.id, o]));
    const scene = worldService.getSceneId();
    return ids.filter((x) => here.has(x)).map((x) => {
      const o = here.get(x); const nm = memory.npcName(scene, x);
      return { id: x, gx: o.gx, gy: o.gy, label: `id=${x}${nm ? ` 「${nm}」` : ''} at (${o.gx},${o.gy})` };
    });
  }
  /** 本场景用不上时,这件物品该去哪儿用(其他场景的面朝目标 / 放置场景) */
  function itemElsewhere(name) {
    const scene = worldService.getSceneId();
    const uses = itemUses(itemIdByName(name));
    const place = uses.filter((u) => u.how === 'place');
    if (place.some((u) => u.scene === scene)) return `${name} is set down on the ground: stand facing a free walkable tile (not a wall or object) and use it`;
    const where = (sc) => { const nm = sceneName(sc); return `scene ${sc}${nm ? ` (${nm})` : ''}`; };
    const parts = [];
    const faceScenes = [...new Set(uses.filter((u) => u.how === 'face' && u.scene !== scene && u.scene != null).map((u) => u.scene))];
    if (faceScenes.length) parts.push(`it works on objects in ${faceScenes.map(where).join(', ')} (stand in front of the object and face it)`);
    const placeScenes = [...new Set(place.map((u) => u.scene).filter((x) => x != null))];
    if (placeScenes.length) parts.push(`it is meant to be set down in ${placeScenes.map(where).join(', ')} (face a free tile there and use it)`);
    return parts.length ? `${name} has no use in this scene — ${parts.join('; ')}` : null;
  }

  async function useItem(name, target = 0, facing = null) {
    if (mode() !== 'control') return { ok: false, note: notControl('use an item') };
    const targets = itemTargets(name);
    if (facing != null && targets.length && !targets.some((t) => t.id === facing)) {
      return { ok: false, note: `${name} has no effect on object ${facing}. It only works when you stand next to and face one of: ${targets.map((t) => t.label).join(', ')}` };
    }
    if (facing != null) {
      const r = await approach(facing);
      if (!r.ok) return { ok: false, note: `could not get in front of object ${facing}: ${r.note}` };
    }
    const before = objectScripts();
    const invBefore = inventory().map((it) => `${it.name}×${it.amount}`).join();
    const scene0 = worldService.getSceneId();
    const r = await useItemInner(name, target);
    if (!r.ok) return r;
    // 物品把队伍传走了(土灵珠 / 引路蜂在迷宫里遁出):如实说去了哪,别再说「这里没用」
    const scene1 = worldService.getSceneId();
    if (scene1 !== scene0) {
      const sn = sceneName(scene1);
      const p1 = playerPos();
      return { ok: true, note: `${r.note}; it teleported the party out — you are now in scene ${scene1}${sn ? ` (${sn})` : ''} at (${p1.gx},${p1.gy})` };
    }
    const after = objectScripts();
    const changed = [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id));
    const consumed = invBefore !== inventory().map((it) => `${it.name}×${it.amount}`).join();
    const notes = [r.note];
    if (changed.length) notes.push(`this changed how object(s) ${changed.join(', ')} react — try interacting with them now`);
    else if (!consumed && mode() === 'control') {
      notes.push(facing != null && targets.some((t) => t.id === facing)
        ? `no further effect on object ${facing} — it may already have taken effect; try interact(${facing})`
        : targets.length
        ? `no effect here — ${name} only works when you stand next to and face one of: ${targets.map((t) => t.label).join(', ')} (pass facing=<id>; some are only reachable via other paths/teleports)`
        : (fullHints && itemElsewhere(name)) || 'no visible effect (items meant for someone usually only work while standing in front of them, facing them)');
    } else if (fullHints && !consumed && mode() === 'dialog' && !targets.length) {
      // 用错地方时游戏只弹一句「这里不能用」:顺带说该去哪儿用
      const where = itemElsewhere(name);
      if (where) notes.push(where);
    }
    return { ok: true, note: notes.join('; ') };
  }

  async function useItemInner(name, target) {
    await tap('UseItem', 100);
    if ((await settle()) !== 'menu' || probes.menu?.kind !== 'items') return { ok: false, note: `item menu did not open (mode ${mode()})` };
    const items = probes.menu.items;
    const idx = items.findIndex((it) => it.label === name);
    const i = idx >= 0 ? idx : items.findIndex((it) => it.label.includes(name) || name.includes(it.label));
    if (i < 0 || !items[i].enabled) {
      await cancelMenu(100); await settle();
      const eqFlags = i >= 0 ? e.scriptObjects.getObjectEntry(items[i].value)?.item?.flags || 0 : 0;
      if (eqFlags & ITEM_EQUIPABLE) return { ok: false, note: `${items[i].label} is equipment, not a usable item — wear it with equip(item="${items[i].label}", member=<party index or name>)` };
      const usable = items.filter((it) => it.enabled).map((it) => it.label).join('、') || 'none';
      return { ok: false, note: i < 0 ? `no item matching "${name}"; usable now: ${usable}` : `${items[i].label} cannot be used here; usable now: ${usable}` };
    }
    const r = await choose(i);
    if (mode() === 'menu' && probes.menu?.kind === 'party') {
      const r2 = await choose(Math.min(target, probes.menu.items.length - 1));
      // 用完会回到选人菜单(可连用),退出到地图
      while (mode() === 'menu') { await cancelMenu(100); await settle(3000); }
      return { ok: r2.ok, note: `${r.note}; ${r2.note}` };
    }
    while (mode() === 'menu') { await cancelMenu(100); await settle(3000); }
    return r;
  }

  // ---- 装备 ------------------------------------------------------------------
  // 第 30 轮:包里有霓虹羽衣、精鐵戰甲,灵儿还穿丝衣 —— use_item 说「不能用」,AI 找不到装备入口。
  // 引擎的装备键是 ThrowItem:物品格选装备 → 选人(装完停在选人界面)→ 退出。
  const EQUIP_SLOT_NAMES = ['head', 'cloak', 'body', 'weapon', 'feet', 'accessory'];
  const EQUIP_FIRST_ROLE = 64;   // ItemFlag.EquipableByPlayerRole_First(按角色号左移)
  function wearing(role) {
    const eq = worldService.getPlayerRoles?.()?.equipment || [];
    return EQUIP_SLOT_NAMES.map((slot, k) => [slot, eq[k]?.[role] || 0]);
  }
  async function equip(name, member = 0) {
    if (mode() !== 'control') return { ok: false, note: notControl('equip') };
    const pt = party();
    const idx = typeof member === 'number' ? member : pt.findIndex((r) => r.name === member || r.name.includes(member) || String(member).includes(r.name));
    const who = pt[idx];
    if (!who) return { ok: false, note: `no party member ${JSON.stringify(member)}; party: ${pt.map((r, k) => `[${k}] ${r.name}`).join(' ')}` };
    const id = itemIdByName(name);
    if (!id) return { ok: false, note: `no item matching "${name}" in the bag` };
    const flags = e.scriptObjects.getObjectEntry(id)?.item?.flags || 0;
    const label = word(id);
    if (!(flags & ITEM_EQUIPABLE)) return { ok: false, note: `${label} is not equipment (use_item uses items)` };
    const canWear = pt.filter((r) => flags & (EQUIP_FIRST_ROLE << r.role)).map((r) => r.name);
    if (!(flags & (EQUIP_FIRST_ROLE << who.role))) return { ok: false, note: `${who.name} cannot wear ${label}; it fits: ${canWear.join('、') || 'nobody in the party'}` };
    const before = wearing(who.role);
    await tap('ThrowItem', 100);
    if ((await settle()) !== 'menu' || probes.menu?.kind !== 'items') return { ok: false, note: `equip menu did not open (mode ${mode()})` };
    const items = probes.menu.items;
    const i = items.findIndex((it) => it.value === id);
    let r = i < 0 ? { ok: false, note: `${label} is not in the equip menu` } : await choose(i);
    if (r.ok && mode() === 'menu' && probes.menu?.kind === 'party') r = await choose(idx);
    while (mode() === 'menu') { await cancelMenu(100); await settle(3000); }
    if (!r.ok) return r;
    const changed = wearing(who.role).filter(([slot, v], k) => v !== before[k][1])
      .map(([slot, v], k) => `${slot}: ${word(before[EQUIP_SLOT_NAMES.indexOf(slot)][1]) || 'nothing'} → ${word(v) || 'nothing'}`);
    return { ok: true, note: changed.length ? `${who.name} now wears ${label} (${changed.join('; ')}); the old piece went back to the bag` : `${label} on ${who.name}: nothing changed` };
  }

  // ---- 存读档 ----------------------------------------------------------------
  // 存档走引擎自己的 game.saveGame(落盘 localStorage);旁挂一条 meta 供 list_saves 显示。
  const META = (slot) => `AGENT-PAL-META-${slot}`;
  function save(slot, note = '') {
    if (mode() !== 'control') return { ok: false, note: notControl('save') };
    // 同系统菜单「存档」:记为当前存档栏 —— 战败脚本(0x004E)读的就是它,否则会读回 1 号
    try { worldService.setCurrentSaveSlot(slot); } catch { /* */ }
    const ok = !!e.game.saveGame(slot);
    memory.flush();   // 走过的格子是攒一批才落盘的:存档(含会话结束时的自动存档)时一并写下
    if (ok) {
      const p = playerPos();
      e.storage.setItem(META(slot), JSON.stringify({ slot, note, scene: worldService.getSceneId(), pos: [p.gx, p.gy], party: party().map((r) => `${r.name} Lv${r.level}`).join(' '), cash: worldService.getCash?.(), at: new RealDate(realNow()).toISOString() }));
    }
    return { ok, note: ok ? `saved to slot ${slot}${note ? ` (${note})` : ''}` : 'save failed' };
  }
  /**
   * 自动存档(会话被超时杀掉 / 定时兜底):同 save,但不改「当前存档栏」——
   * 战败脚本(0x004E)读回的仍是 agent 自己最后存的那一格,不会被自动档带进坏局面。
   */
  function autosave(slot, why) {
    if (mode() !== 'control') return { ok: false, note: `autosave skipped: mode is ${mode()}` };
    let cur = null;
    try { cur = worldService.getCurrentSaveSlot(); } catch { /* */ }
    const r = save(slot, `autosave (${why})`);
    try { if (cur != null) worldService.setCurrentSaveSlot(cur); } catch { /* */ }
    return r;
  }
  function listSaves() {
    const out = [];
    for (const k of e.storage.keys()) {
      const m = k.match(/^PAL-SAVE-(\d+)$/);
      if (!m) continue;
      let meta = null;
      try { meta = JSON.parse(e.storage.getItem(META(m[1])) || 'null'); } catch { /* */ }
      out.push(meta ? `slot ${m[1]}: scene ${meta.scene} at (${meta.pos}) ${meta.party} cash ${meta.cash} — ${meta.note || ''} [${meta.at}]` : `slot ${m[1]}`);
    }
    return { ok: true, note: out.length ? '\n' + out.sort().join('\n') : 'no saves yet' };
  }
  async function load(slot) {
    if (!e.storage.getItem(`PAL-SAVE-${slot}`)) return { ok: false, note: `slot ${slot} is empty` };
    if (mode() !== 'control') return { ok: false, note: notControl('load') + ' (at the title screen choose 舊的回憶 instead)' };
    const done = new Promise((resolve, reject) => { probes.pendingLoad = { slot, resolve, reject }; });
    let loaded;
    try { loaded = await Promise.race([done, sleep(20000).then(() => 'timeout')]); }
    catch (err) { return { ok: false, note: `load failed: ${err?.message || err}` }; }
    if (loaded === 'timeout') return { ok: false, note: 'load timed out' };
    seenAll();
    const m = await settle();
    return { ok: true, note: `loaded slot ${slot}; mode now ${m}` };
  }
  /** 读档后旧对白历史不算「新」。 */
  function seenAll() { for (const h of dialogHistory()) if (h) seenLines.add(h); }

  async function press(keyName, ms = 100) {
    const top = probes.menu;
    await tap(keyName, ms);
    if (keyName === 'Menu' && top?.transient) top.pop?.();   // 取消内联选人
    const m = await settle(8000);
    return { ok: true, note: `pressed ${keyName}; mode now ${m}` };
  }

  // ---- 战斗 ----------------------------------------------------------------
  // 决策点 = 战斗 UI 进入 SelectMove(轮到某个队员下指令),不再固定等待。
  // 选目标:普攻进入选敌时读 prevEnemyTarget 作初始光标,预置它再按确认(同物品格直接写光标的做法)。
  // 自动战斗是开关:按一次持续自动,再按 Search/Menu 取消。
  const battleSvc = e.services.battle;
  const UI_SELECT_MOVE = 1, UI_SELECT_ENEMY = 2;
  const RESULT_NAME = { 3: 'won', 1: 'lost', 0xFFFF: 'fled', 0: 'terminated by script' };
  const STATUS_NAME = ['confused', 'paralyzed', 'asleep', 'silenced', 'puppet', 'bravery', 'protect', 'haste', 'dual-attack'];
  let battleCtx = null;   // 本场战斗开始时的快照:敌人初始血量(引擎不填 maxHealth)、银两、等级

  function battleState() { try { return battleSvc.getState() || null; } catch { return null; } }
  function battleUI() { return battleState()?.UI || {}; }
  function autoOn() { return e.services.battleCommandRuntime?.owned ? e.commandWait?.()?.kind === 'battle.auto-mode' : !!battleUI().autoAttack; }
  function myTurn() {
    if (e.services.battleCommandRuntime?.owned) { const wait = e.commandWait?.(); return wait?.kind === 'battle.command' && wait.state === 'waiting'; }
    if (!worldService.isInBattle() || autoOn()) return false;
    return battleUI().state === UI_SELECT_MOVE;
  }
  function enemies() {
    const st = battleState();
    if (!st || !Array.isArray(st.enemy)) return [];
    return st.enemy.map((x, i) => (x && x.objectID ? { index: i, name: word(x.objectID) || `enemy${x.objectID}`, hp: x.e?.health ?? 0 } : null))
      .filter(Boolean);
  }
  /** 敌人全倒了却还在战斗里 = 停在战果 / 掉落物品的提示上等按键(auto 不会替你按,以前会一直报 still fighting)。 */
  function battleWonPending() {
    if (!worldService.isInBattle() || myTurn()) return false;
    const foes = enemies();
    return foes.length ? foes.every((f) => f.hp <= 0) : !!battleCtx;
  }
  async function dismissBattleEnd() {
    // 每按一次都重新判断:战斗若还要继续(回合末脚本召唤增援 / 分身、下一波),按键就成了队员的指令
    for (let i = 0; i < 10 && battleWonPending(); i++) await advanceOrKey(300);
  }
  function ensureBattleCtx() {
    if (battleCtx || !worldService.isInBattle()) return;
    const maxHp = new Map(enemies().map((x) => [x.index, x.hp]));
    // 等级按角色号记:中途有人入队(锁妖塔灵儿排到第 0 位)按下标比就会报「趙靈兒 Lv85→96」
    battleCtx = { maxHp, cash: worldService.getCash?.() ?? 0, levels: new Map(party().map((r) => [r.role, r.level])) };
  }
  /**
   * 战斗快照只在 battle() 打完时由 battleSummary 用掉;战斗若在别处结束(剧情对白里收场、走路途中打完),
   * 快照会留到下一场,银两 / 等级就和很久以前比(京城树林一仗报「cash +18007」,实为 +155)。不在战斗里就丢掉。
   */
  function dropStaleBattleCtx() {
    if (battleCtx && !worldService.isInBattle()) battleCtx = null;
  }
  function statusOf(roleId) {
    let row = [];
    try { row = worldService.getPlayerStatusMatrix?.()?.[roleId] || []; } catch { /* */ }
    return STATUS_NAME.filter((_, i) => (row[i] || 0) > 0);
  }
  /**
   * 仙术除 MP 外还要什么:使用脚本里的 0x0020(扣物品,不够就跳走)= 要某件物品(萬蠱蝕天 / 三屍咒要「蠱」,酒神要酒);
   * 0x001E(扣钱,不够就跳走)= 花钱的招(乾坤一擲)。连跑第 41–46 轮:背包没蠱,自动练级仍每回合选萬蠱蝕天,
   * 游戏只回一句「道具不足無法使用」,白白空过回合。
   */
  const spellNeedCache = new Map();
  function spellNeeds(id) {
    if (spellNeedCache.has(id)) return spellNeedCache.get(id);
    const need = { item: 0, amount: 0, cash: false };
    let addr = e.scriptObjects.getObjectEntry(id)?.magic?.scriptOnUse || 0;
    for (let k = 0; k < 12 && addr; k++, addr++) {
      const sc = worldService.getScriptEntry(addr);
      if (!sc || sc.operation === 0x0000) break;
      const o = sc.operand || [];
      if (sc.operation === 0x0020 && o[0] > 0 && o[2] > 0 && !need.item) { need.item = o[0]; need.amount = o[1] || 1; }
      else if (sc.operation === 0x001E && o[1] > 0) need.cash = true;
    }
    spellNeedCache.set(id, need);
    return need;
  }
  const itemCount = (id) => (worldService.getInventory() || []).reduce((n, x) => n + (x && x.item === id ? (x.amount || 0) : 0), 0);
  /** 缺什么(够了返回 ''):「needs 蠱 ×1 (you have 0)」 */
  function spellLack(id) {
    const need = spellNeeds(id);
    if (need.item && itemCount(need.item) < need.amount) return `needs ${word(need.item) || 'item ' + need.item} ×${need.amount} from the bag (you have ${itemCount(need.item)})`;
    if (need.cash && (worldService.getCash?.() ?? 0) <= 0) return 'needs cash (you have none)';
    return '';
  }
  /** 某角色学会的仙术:名字、耗 MP、战时可用。按名字匹配(包含即可)。 */
  const MAGIC_USABLE_IN_BATTLE = 2, ITEM_USABLE = 1, ITEM_EQUIPABLE = 2, ITEM_THROWABLE = 4;
  function spellsOf(role) {
    const gda = e.services.adapterManifest?.gameData?.module;
    const out = [];
    for (const id of worldService._getPlayerMagicSlots?.(role) || []) {
      if (!id) continue;
      const m = e.scriptObjects.getObjectEntry(id)?.magic;
      if (!m) continue;
      const me = gda?.getMagicEntry?.(m.magicNumber || 0);
      const mp = me?.costMP ?? null;
      // flags:8 = 对敌方,16 = 不必选对象(全体)
      out.push({ id, name: word(id) || `magic${id}`, mp, inBattle: !!(m.flags & MAGIC_USABLE_IN_BATTLE),
        toEnemy: !!(m.flags & 8), all: !!(m.flags & 16), field: !!(m.flags & 1) });
    }
    return out;
  }
  /** Read effects without running item scripts or hiding conditional harm. */
  function itemLabel(id) {
    return summarizeItemEffects(e.scriptObjects.getObjectEntry(id)?.item, {
      getScript: at => worldService.getScriptEntry(at), word,
      getMagic: magicId => {
        const magic=e.scriptObjects.getObjectEntry(magicId)?.magic;
        const entry=e.services.adapterManifest?.gameData?.module?.getMagicEntry?.(magic?.magicNumber || 0);
        return entry ? {baseDamage:entry.baseDamage,all:!!(magic?.flags & 16)} : null;
      }
    }).label;
  }

  function battleItems() {
    return (worldService.getInventory() || []).filter((it) => it && it.item && it.amount > 0).map((it) => {
      const flags = e.scriptObjects.getObjectEntry(it.item)?.item?.flags || 0;
      return { id: it.item, name: word(it.item) || `item${it.item}`, amount: it.amount, use: !!(flags & ITEM_USABLE), throw: !!(flags & ITEM_THROWABLE) };
    }).filter((it) => it.use || it.throw);
  }
  const byName = (list, name) => list.find((x) => x.name === name) || list.find((x) => x.name.includes(name) || name.includes(x.name));

  function battleLines() {
    ensureBattleCtx();
    const out = [];
    const foes = enemies();
    out.push('', 'enemies ([target index] name HP):');
    for (const f of foes) {
      const max = battleCtx?.maxHp.get(f.index);
      out.push(`  [${f.index}] ${f.name} HP${f.hp}${max ? '/' + max : ''}${f.hp <= 0 ? ' (down)' : ''}`);
    }
    if (!foes.length) out.push('  (none left)');
    const danger = dangerOf((battleState()?.enemy || []).filter((x) => x && x.objectID && (x.e?.health ?? 0) > 0).map((x) => x.objectID));
    if (danger) out.push(`  DANGER: ${danger} — you will very likely be wiped out as you are; flee (battle flee, or an escape spell), then get stronger or check with walk_to whether a route can stay clear of it`);
    const members = worldService.getParty?.() || [];
    const pt = party();
    out.push('party in battle:');
    pt.forEach((r, i) => {
      const st = statusOf(members[i]?.playerRole);
      out.push(`  [${i}] ${r.name} HP${r.hp}/${r.maxHp} MP${r.mp}/${r.maxMp}${r.hp <= 0 ? ' (down)' : ''}${st.length ? ' ' + st.join(',') : ''}`);
    });
    const ui = battleUI();
    if (autoOn()) out.push('turn: auto-attack is ON (every member attacks automatically)');
    else if (e.services.battleCommandRuntime?.owned ? myTurn() : ui.state === UI_SELECT_MOVE) {
      const who = e.services.battleCommandRuntime?.owned ? e.commandWait?.()?.payload?.prompt?.member : ui.curPlayerIndex;
      out.push(`turn: waiting for ${pt[who]?.name || 'party member ' + who}'s command`);
      const ownedPrompt = e.services.battleCommandRuntime?.owned ? e.commandWait?.()?.payload?.prompt : null;
      const role = ownedPrompt?.role ?? members[ui.curPlayerIndex]?.playerRole;
      const sp = role != null ? spellsOf(role).filter((x) => x.inBattle) : [];
      if (sp.length) out.push(`  spells (battle action=magic, name=…): ${sp.map((x) => { const need = fullHints ? spellNeeds(x.id) : null; const tag = need?.item ? ` (uses ${word(need.item)}, ${itemCount(need.item)} left)` : need?.cash ? ' (spends cash)' : ''; return `${x.name}${x.mp != null ? ` MP${x.mp}` : ''}${tag}`; }).join('、')}`);
      const its = battleItems();
      if (its.length) {
        out.push('  items (action=item to use / throw to throw, name=<exact item name>; all available items and effects):');
        for (const it of its) {
          const flags = e.scriptObjects.getObjectEntry(it.id)?.item?.flags || 0;
          const consumption = it.use ? `; use ${flags & 8 ? 'consumes 1' : 'does not consume the item'}` : '';
          out.push(`    ${it.name}×${it.amount} (${itemLabel(it.id)}${consumption}${it.throw ? '; throw consumes 1' : ''})`);
        }
      }
    } else out.push('turn: actions are playing out');
    return out;
  }
  /** 上一次出战果时战斗事件日志读到哪了 */
  let summarySeq = 0;
  /** 战斗刚结束:结果码 + 银两/等级变化。 */
  function battleSummary() {
    const code = battleState()?.battleResult;
    // 0 / 1000 / 1001 = 战斗被剧情脚本结束(或状态已复位),不是输赢
    // 战斗循环抛了异常被引擎吞掉、记成 Terminated:如实说,别报成「被剧情脚本结束」(那样剧情照走,看不出跳过了一场战斗)
    // 按事件日志查(自上次战果以来的 end 事件):紧接着又开一场时,lastBattleError 已被新的一场清掉
    const crashed = (() => {
      try {
        if (typeof battleSvc.battleEventsSince !== 'function') return battleSvc.lastBattleError || null;
        const ends = battleSvc.battleEventsSince(summarySeq).filter((ev) => ev.type === 'end');
        summarySeq = battleSvc.lastBattleEventSeq;
        const bad = ends.find((ev) => ev.error);
        return bad ? { message: bad.error } : null;
      } catch { return null; }
    })();
    const name = crashed ? `ABORTED BY AN ENGINE ERROR (${String(crashed.message).slice(0, 120)}) — the story continues as if the battle had ended; this is an engine bug, not a real result`
      : RESULT_NAME[code] ?? ([0, 1000, 1001].includes(code) ? 'ended by a story script' : 'result ' + code);
    const parts = [`battle over: ${name}`];
    if (battleCtx) {
      const dc = (worldService.getCash?.() ?? 0) - battleCtx.cash;
      if (dc) parts.push(`cash ${dc > 0 ? '+' : ''}${dc}`);
      for (const r of party()) {
        const was = battleCtx.levels.get(r.role);
        if (was != null && r.level > was) parts.push(`${r.name} Lv${was}→${r.level}`);
      }
    }
    battleCtx = null;
    return parts.join(', ');
  }
  /** 下一个该下指令的人(第 30 轮:只说 your turn again,AI 按队伍顺序猜,约 40 次把阿奴的炎殺咒报给逍遥)。 */
  function nextActor() {
    const i = e.services.battleCommandRuntime?.owned ? e.commandWait?.()?.payload?.prompt?.member : battleUI().curPlayerIndex ?? 0;
    const role = (worldService.getParty?.() || [])[i]?.playerRole;
    const sp = role != null ? spellsOf(role).filter((x) => x.inBattle).map((x) => x.name) : [];
    return `now ${party()[i]?.name || 'party member ' + i}'s command${sp.length ? ` (spells: ${sp.join('、')})` : ''}`;
  }
  async function afterBattleCommand(label) {
    if (worldService.isInBattle()) {
      const m = await settle(1500);
      // 最后一击后还在播结算画面(isInBattle 仍为真),等的这一会儿里战斗结束了:照样给出战果,不然看起来像没打完
      if (!worldService.isInBattle()) return { ok: true, note: `${label}; ${battleSummary()}; mode now ${m}` };
      return { ok: true, note: `${label}; ${myTurn() ? `your turn again — ${nextActor()}` : 'mode now ' + m}` };
    }
    const summary = battleSummary();
    const m = await settle(20000);
    // 打完立刻又被怪碰上:这是一场新的战斗,不是上一场没结束
    const next = m === 'battle' ? ' — a NEW battle started right away (another enemy touched you); call battle again' : '';
    return { ok: true, note: `${label}; ${summary}; mode now ${m}${next}` };
  }

  /**
   * 本回合变化:一个回合里双方按速度先后行动,只看回合结束后的血量会误判(复活后又被打倒 →
   * 看起来「还魂香没用」;先回血又被一刀带走 → 看起来「血量晚一回合」)。battle() 期间每次轮询记下
   * 各单位血量的变化过程,结果里附一行「HP changes: 李逍遙 0→36→0; 黑蜘蛛精 1992→1800」。
   */
  function hpTracker() {
    const seq = new Map();      // key → { name, vals: [] }
    const sample = () => {
      try {
        for (const f of enemies()) {
          const k = 'e' + f.index, cur = seq.get(k) || { name: f.name, vals: [] };
          if (cur.vals[cur.vals.length - 1] !== f.hp) cur.vals.push(f.hp);
          seq.set(k, cur);
        }
        for (const r of party()) {
          const k = 'p' + r.role, cur = seq.get(k) || { name: r.name, vals: [] };
          if (cur.vals[cur.vals.length - 1] !== r.hp) cur.vals.push(r.hp);
          seq.set(k, cur);
        }
      } catch { /* */ }
    };
    sample();
    return {
      sample,
      text() {
        sample();
        const parts = [];
        for (const { name, vals } of seq.values()) {
          if (vals.length < 2) continue;
          const v = vals.length > 5 ? [vals[0], '…', vals[vals.length - 1]] : vals;   // 自动战斗打了好几回合:只写首尾
          parts.push(`${name} ${v.join('→')}`);
        }
        return parts.join('; ');
      }
    };
  }

  async function battle(action = 'attack', target = null, name = null, referenceID = null, expectedMember = null) {
    checkBudget();
    if (e.services.battleCommandRuntime?.owned) return battleOwned(action, target, name, referenceID, expectedMember);
    if (mode() !== 'battle') return battleInner(action, target, name);
    const t = hpTracker();
    pollHook = t.sample;
    let r;
    try { r = await battleInner(action, target, name); } finally { pollHook = null; }
    const ch = t.text();
    if (r && r.ok && ch) r = { ...r, note: `${r.note} | HP changes: ${ch}` };
    return r;
  }

  // The captured native wait is the only owned command boundary. Resolve and
  // stage synchronously; only the resumed parent can accept-close and commit.
  async function battleOwned(action, target, name, referenceID, expectedMember) {
    if (!['auto', 'repeat', 'attack', 'defend', 'flee', 'magic', 'coop', 'item', 'throw'].includes(action)) return { ok: false, reason: 'invalid', note: `bad battle action ${action}` };
    if (['magic', 'item', 'throw'].includes(action)) {
      if (referenceID != null && (!Number.isInteger(referenceID) || referenceID <= 0)) return { ok: false, reason: 'invalid', note: 'reference ID must be a positive integer' };
      if (referenceID == null && (typeof name !== 'string' || !name)) return { ok: false, reason: 'invalid', note: `${action} needs name=` };
    }
    // Unused and all-target fields retain Phase A canonicalization. A mode
    // anchor cannot authorize a future actor's spells, MP or attack-all ability.
    if (target != null && !Number.isInteger(target) && !['auto', 'defend', 'flee', 'repeat'].includes(action)) {
      let mayApplyToAll = true;
      if (action === 'attack') {
        const effects = e.services.state.getGlobal('equipmentEffect');
        mayApplyToAll = worldService.getParty().slice(0, worldService._partyView().maxIndex + 1).some(member =>
          Array.from({ length: globalThis.Const.MAX_PLAYER_EQUIPMENTS }, (_, part) => part).some(part => effects?.[part]?.attackAll?.[member.playerRole]));
      } else if (referenceID != null && ['magic', 'item', 'throw'].includes(action)) {
        const object = e.scriptObjects.getObjectEntry(referenceID);
        mayApplyToAll = !!((action === 'magic' ? object?.magic?.flags : object?.item?.flags) & 16);
      }
      if (!mayApplyToAll) return { ok: false, reason: 'invalid', note: 'target must be an integer' };
    }
    let observation = e.commandWait?.();
    const progressing = e.battleExecutionContext?.();
    if (!observation && ((action === 'flee' && (progressing?.flee || progressing?.fleeAttempt)) || (action === 'repeat' && progressing?.repeat))) {
      ensureBattleCtx();
      const reached = await waitUntil(() => (skipTimed(), !worldService.isInBattle() || !!e.commandWait?.()), action === 'flee' ? 60000 : 30000, 30);
      if (!reached) return { ok: false, reason: 'busy', note: `native ${action} round has not reached its next parent boundary or battle end` };
      return afterBattleCommand(`watched native ${action} round`);
    }
    if (action === 'auto') {
      if (!['battle.command', 'battle.auto-mode'].includes(observation?.kind)) return { ok: false, reason: 'wrong_mode', note: 'no owned battle decision is open' };
      if (observation.state !== 'waiting') return { ok: false, reason: 'busy', note: 'a battle decision is already staged' };
      if (observation.kind === 'battle.command') {
        const result = e.submitAutoMode(observation, true);
        if (!result.ok) return result;
      }
      ensureBattleCtx(); // accepted stage/watch, before native progress can award rewards
      const reached = await waitUntil(() => (skipTimed(), !worldService.isInBattle() || e.commandWait?.()?.kind === 'battle.auto-mode'), 30000, 30);
      if (!reached) return { ok: false, reason: 'busy', note: 'auto mode has not reached its next parent boundary' };
      await sleep(300);
      return afterBattleCommand('watched automatic battle');
    }
    if (observation?.kind === 'battle.auto-mode') {
      if (observation.state !== 'waiting') return { ok: false, reason: 'busy', note: 'a mode decision is already staged' };
      const result = e.submitAutoMode(observation, false);
      if (!result.ok) return result;
      const reached = await waitUntil(() => (skipTimed(), !worldService.isInBattle() || e.commandWait?.()?.kind === 'battle.command'), 30000, 30);
      if (!reached) return { ok: false, reason: 'busy', note: 'manual takeover has not reached a fresh command boundary' };
      if (!worldService.isInBattle()) return afterBattleCommand('battle ended during manual takeover');
      observation = e.commandWait?.();
    }
    if (observation?.kind !== 'battle.command') return { ok: false, reason: 'wrong_mode', note: 'no owned battle command wait is open' };
    if (observation.state === 'staged') return { ok: false, reason: 'busy', note: 'the owned command wait already has a staged choice' };
    if (observation.state !== 'waiting') return { ok: false, reason: 'invalid', note: 'the owned command wait is incompatible' };
    const prompt = observation.payload?.prompt;
    if (!prompt || prompt.role !== worldService.getParty?.()?.[prompt.member]?.playerRole) return { ok: false, reason: 'stale', note: 'the owned battle actor changed' };
    if (expectedMember != null && expectedMember !== prompt.member) return { ok: false, reason: 'invalid', note: 'member does not match the fresh current owned actor; manual mode is ready for a corrected request' };
    const resolved = resolveBattleChoice({ action, target, name, referenceID, prompt }, {
      types: globalThis.BattleActionType, flags: globalThis.ItemFlag,
      spells: spellsOf(prompt.role), items: battleItems(), enemies: enemies(),
      roles: battleSvc.getPlayerRoles(), equipment: e.services.state.getGlobal('equipmentEffect'),
      maxEquipments: globalThis.Const.MAX_PLAYER_EQUIPMENTS,
      object: id => e.scriptObjects.getObjectEntry(id),
      mp: worldService._getPlayerRoleArrayValue('MP', prompt.role, 0), spellLack,
    });
    if (!resolved.ok) return resolved;
    ensureBattleCtx();
    if (action === 'coop' && globalThis.uibattle) {
      Object.defineProperty(globalThis.uibattle, 'battleStateCache', {
        get: () => battleSvc.getState?.() || globalThis.Global?.battle,
        set: () => {},
        configurable: true,
      });
    }
    const result = e.submitCommand(observation, resolved.choice);
    if (!result.ok) return { ...result, note: result.note || `the game refused the owned command (${result.reason})` };
    const sameWait = () => { const current = e.commandWait?.(); return current?.kind === observation.kind && current?.revision === observation.revision; };
    if (!(await waitUntil(() => !sameWait(), 2000, 20))) return { ok: false, reason: 'busy', note: 'the owned command is still staged' };
    const reachedBoundary = await waitUntil(() => (skipTimed(), !worldService.isInBattle() || e.commandWait?.()?.kind === 'battle.command' || (action === 'repeat' && e.commandWait?.()?.kind === 'battle.auto-mode')), action === 'flee' ? 60000 : 30000, 30);
    if (!reachedBoundary) return { ok: false, reason: 'busy', note: 'the command was accepted; the next owned command boundary or battle end has not arrived' };
    return afterBattleCommand(`${party()[prompt.member]?.name || 'member ' + prompt.member}: ${action}${name ? ' ' + name : ''}`);
  }

  async function battleInner(action = 'attack', target = null, name = null) {
    if (mode() !== 'battle') {
      // 并行发出的后几条指令到达时已经团灭:说清楚是打输了,不是「没成」
      const pt = party();
      const wiped = pt.length && pt.every((r) => (r.hp || 0) <= 0);
      return { ok: false, note: wiped ? `not in battle — the battle is over: lost (the whole party is down); advance and the game reloads the last save (mode ${mode()})` : `not in battle (mode ${mode()})` };
    }
    if (!['auto', 'attack', 'defend', 'flee', 'repeat', 'magic', 'item', 'throw', 'coop'].includes(action)) return { ok: false, note: `bad battle action ${action}` };
    if (['magic', 'item', 'throw'].includes(action) && !name) return { ok: false, note: `${action} needs name= (the ${action === 'magic' ? 'spell' : 'item'} name, see observe)` };
    ensureBattleCtx();

    if (action !== 'auto' && battleWonPending()) {
      // 先等它自己结束(战果动画);还停着才是在等按键
      await waitUntil(() => !worldService.isInBattle(), 3000, 50);
      if (battleWonPending()) await dismissBattleEnd();
      if (!worldService.isInBattle()) return afterBattleCommand('the battle was already won (dismissed the result message)');
    }

    if (action === 'auto') {
      // 开自动仍按键:回应 { battle: auto } 要等到下一帧才生效、并阻塞到等待被消费,开自动那一刻晚了几帧,
      // 自动战斗的结果因此不同(golden 5 个场景分叉、bench 两题过不了)。等执行层把战斗等待做成检查点再换
      if (!autoOn()) await tap('Auto', 100);
      await waitUntil(() => (skipTimed(), !worldService.isInBattle()), 30000, 50);
      if (battleWonPending()) await dismissBattleEnd();   // 只处理真卡住的:等满了还停在战果 / 掉落提示上
      if (worldService.isInBattle()) return { ok: true, note: 'auto-battle is ON and still fighting; call battle(auto) again to keep watching, or any other action to take back control' };
      return afterBattleCommand('auto-battle');
    }

    if (autoOn()) {                                      // 取回手动控制(同 SDLPAL:Menu 键关掉自动攻击)
      await tap('Menu', 100);
      await waitUntil(() => !autoOn(), 2000, 30);
    }
    if (action === 'flee' && battleState()?.flee) {      // 已在逃跑中:继续等结果
      await waitUntil(() => !worldService.isInBattle() || myTurn(), 60000, 30);
      if (worldService.isInBattle() && !myTurn()) return { ok: true, note: 'still trying to flee; call battle(flee) again to keep waiting' };
      return afterBattleCommand('flee');
    }
    if (!(await waitUntil(myTurn, 15000, 30))) {
      if (!worldService.isInBattle()) return afterBattleCommand('battle ended before your command');
      return { ok: false, note: 'no party member is waiting for a command yet; try again or observe' };
    }

    // 停在战斗子菜单(仙术 / 物品 / 其他)里:先按 Menu 退回主菜单,否则下面的按键会被子菜单吃掉或选中里面的东西
    // (主菜单上按 Menu 是退回上一个队员,所以只在 menuState 非 0 时按)
    for (let i = 0; i < 3 && myTurn() && (battleUI().menuState || 0) !== 0; i++) {
      await cancelMenu(100);
      await waitUntil(() => (battleUI().menuState || 0) === 0, 1000, 20);
    }

    const who = battleUI().curPlayerIndex;
    let label = `${party()[who]?.name || 'member ' + who}: ${action}`;
    if (['magic', 'item', 'throw'].includes(action)) return battleMagicOrItem(action, target, name, who, label);
    const btop = waitsSvc()?.top();
    const viaRespond = btop?.kind === 'battle.command' && btop.payload?.stage === 'action' && (btop.payload.actions || []).includes(action);
    if (viaRespond) {
      const cmd = { action };
      if ((action === 'attack' || action === 'coop') && target != null) {
        const foe = (btop.payload.enemies || []).find((x) => x.index === target);
        if (!foe || foe.hp <= 0) return { ok: false, note: `no living enemy at index ${target} (see observe)` };
        cmd.target = target;
        label += ` → [${target}] ${foe.name}`;
      }
      const r = await respondTop({ battle: cmd });
      if (!r.ok && r.reason !== 'busy') return { ok: false, note: `${label}: the game refused the command (${r.note || r.reason})` };
    } else if (action === 'coop') {
      // 合擊只走引擎声明的指令(没有对应的单键);不在可用动作里 = 现在放不了
      return { ok: false, note: `${label}: the joint attack (合擊) is not available right now — the current member and at least one other must be healthy (not low on HP, no bad status)` };
    } else if (action === 'attack') {
      if (target != null) {
        const foe = enemies().find((x) => x.index === target);
        if (!foe || foe.hp <= 0) return { ok: false, note: `no living enemy at index ${target} (see observe)` };
        battleSvc.setUI({ prevEnemyTarget: target });
        label += ` → [${target}] ${foe.name}`;
      }
      battleSvc.setUI({ selectedAction: 0 });            // 光标放回攻击(从子菜单退出来时还停在仙术 / 其他上)
      await tap('Search', 100);                          // 主菜单 → 进入选敌;敌人只剩一个时直接提交
      await waitUntil(() => battleUI().state !== UI_SELECT_MOVE, 1500, 20);
      if (battleUI().state === UI_SELECT_ENEMY) {
        if (target != null) battleSvc.setUI({ selectedIndex: target });
        await tap('Search', 100);
      }
    } else {
      await tap({ defend: 'Defend', flee: 'Flee', repeat: 'Repeat' }[action], 100);
    }

    // 下一个决策点:指令被接受(轮到下一个队员 / 开始行动),然后再次轮到我方或战斗结束
    await waitUntil(() => !myTurn() || battleUI().curPlayerIndex !== who, 2000, 20);
    // Native Flee covers one round; failed attempts return to a fresh manual prompt.
    await waitUntil(() => (skipTimed(), !worldService.isInBattle() || myTurn()), action === 'flee' ? 60000 : 30000, 30);
    if (action === 'flee' && worldService.isInBattle() && !myTurn()) {
      return { ok: true, note: `${label}; still trying to flee (the game retries every round); call battle(flee) again to keep waiting` };
    }
    return afterBattleCommand(label);
  }

  /** 仙术 / 物品 / 投掷:只走 W4 回应(引擎负责子菜单、选目标);target = 敌人下标或队员下标(看法术 / 物品作用对象)。 */
  async function battleMagicOrItem(action, target, name, who, label) {
    const svc = waitsSvc(), top = svc?.top();
    if (!top || top.kind !== 'battle.command' || top.payload?.stage !== 'action') return { ok: false, note: 'the game is not waiting for a command right now; observe and try again' };
    const role = (worldService.getParty?.() || [])[who]?.playerRole;
    const cmd = { action };
    if (action === 'magic') {
      if (!(top.payload.actions || []).includes('magic')) return { ok: false, note: `${label}: magic is not available right now (sealed or no spells)` };
      const sp = spellsOf(role);
      const m = byName(sp, name);
      if (!m) {
        // 记混了是谁的法术:直接说是谁的、现在轮到谁
        const members = worldService.getParty?.() || [], pt = party();
        const owner = members.map((mb, i) => ({ i, sp: byName(spellsOf(mb?.playerRole ?? -1), name) })).find((x) => x.i !== who && x.sp);
        const mine = sp.map((x) => x.name).join('、') || 'none';
        if (owner) return { ok: false, note: `${label}: ${owner.sp.name} is ${pt[owner.i]?.name}'s spell, but it is ${pt[who]?.name}'s turn now — ${pt[who]?.name} knows: ${mine}` };
        return { ok: false, note: `${label}: no spell matching "${name}"; ${pt[who]?.name} knows: ${mine}` };
      }
      if (m.mp != null && m.mp > (party()[who]?.mp ?? 0)) return { ok: false, note: `${label}: ${m.name} needs ${m.mp} MP, ${party()[who]?.name} has ${party()[who]?.mp}` };
      { const lack = spellLack(m.id); if (lack) return { ok: false, note: `${label}: ${m.name} ${lack} — casting it now would only waste the turn` }; }
      if (!m.inBattle) return { ok: false, note: `${label}: ${m.name} cannot be used in battle` };
      cmd.magic = m.id; label += ` ${m.name}`;
    } else {
      const its = battleItems();
      const it = byName(its, name);
      if (!it) return { ok: false, note: `${label}: no ${action === 'throw' ? 'throwable' : 'usable'} item matching "${name}" in the bag` };
      if (action === 'item' && !it.use) return { ok: false, note: `${label}: ${it.name} cannot be used, only thrown (action=throw)` };
      if (action === 'throw' && !it.throw) return { ok: false, note: `${label}: ${it.name} cannot be thrown` };
      cmd.item = it.id; label += ` ${it.name}`;
    }
    if (target != null) {
      // 目标先查一遍:投掷要活着的敌人下标,用物品要队员下标(引擎对无效目标只会默默退回选动作)
      if (action === 'throw' && !enemies().some((x) => x.index === target && x.hp > 0)) return { ok: false, note: `${label}: no living enemy at index ${target} to throw at (see observe)` };
      if (action === 'item' && !(target >= 0 && target < party().length)) return { ok: false, note: `${label}: target ${target} is not a party member index (0..${party().length - 1})` };
      cmd.target = target; label += ` → [${target}]`;
    }
    const r = await respondTop({ battle: cmd });
    if (!r.ok && r.reason !== 'busy') return { ok: false, note: `${label}: the game refused the command (${r.note || r.reason})` };
    await waitUntil(() => !myTurn() || battleUI().curPlayerIndex !== who, 2000, 20);
    // 引擎在 MP 不够 / 当前不可用时会退回选动作:同一个人又在等指令 = 没放出去
    if (worldService.isInBattle() && myTurn() && battleUI().curPlayerIndex === who) {
      const why = action === 'magic' ? 'the spell cannot be used right now (sealed, or no valid target)'
        : action === 'throw' ? 'the item was not thrown (the game did not accept the target)' : 'the item was not used (it may have no effect on that member right now)';
      return { ok: false, note: `${label}: ${why}; still ${party()[who]?.name}'s turn` };
    }
    await waitUntil(() => (skipTimed(), !worldService.isInBattle() || myTurn()), 30000, 30);
    return afterBattleCommand(label);
  }

  /**
   * 练级宏:在当前场景反复找最弱的一组怪、逐回合打(先回血、再群攻、否则集火血最少的),直到队里最低等级到 targetLevel(或打满 maxBattles / 用完 budgetS 真实秒)。
   * 不经模型逐场下指令 —— 锁步模式下一场仗约百分之几秒。每场前检查血量:低于 70% 用回复药,倒下的用复活药;没药就停,不带伤硬打下一场。
   * 停下的原因都写进结果:到级、场数 / 时间用完、打输(游戏读档)、触发剧情、没药了、场景里没有会刷新的怪。
   */
  /**
   * 按脚本指令认物品 / 仙术的作用(比按名字可靠):0x001B 加减 HP、0x001D 加减 HP 和 MP、0x001C 加减 MP、0x0022 复活。
   * 只认数值为正的(回复),伤人的脚本不算。物品看使用脚本,仙术看成功脚本(使用脚本为 0 时)。
   */
  const effectCache = new Map();
  function scriptEffects(addr) {
    if (!addr) return { heal: false, mp: false, revive: false };
    if (effectCache.has(addr)) return effectCache.get(addr);
    const r = { heal: false, mp: false, revive: false };
    for (let a2 = addr, k = 0; a2 && k < 16; a2++, k++) {
      const sc = worldService.getScriptEntry(a2);
      if (!sc || sc.operation === 0 || sc.operation === 1) break;
      const v = ((sc.operand?.[1] ?? 0) << 16) >> 16;     // SHORT
      if ((sc.operation === 0x001B || sc.operation === 0x001D) && v > 0) r.heal = true;
      if ((sc.operation === 0x001C || sc.operation === 0x001D) && v > 0) r.mp = true;
      if (sc.operation === 0x0022) r.revive = true;
    }
    effectCache.set(addr, r);
    return r;
  }
  const itemEffects = (id) => { const o = e.scriptObjects.getObjectEntry(id); return scriptEffects(o?.item?.scriptOnUse || o?.magic?.scriptOnSuccess || 0); };
  const spellEffects = (id) => { const m = e.scriptObjects.getObjectEntry(id)?.magic; return scriptEffects(m?.scriptOnUse || m?.scriptOnSuccess || 0); };
  /** 背包里能回血 / 复活的物品(各按数量多的排前,先用便宜量大的) */
  const bagFor = (kind) => inventory().map((it) => ({ ...it, id: (worldService.getInventory() || []).find((x) => x && x.amount > 0 && word(x.item) === it.name)?.item }))
    .filter((it) => it.id && itemEffects(it.id)[kind] && (kind !== 'heal' || !itemEffects(it.id).revive)).sort((a, b) => b.amount - a.amount);
  /** 一支敌方队伍的强度:Σ 血量 ×(等级 + 1)×(一回合动两次就 ×2);用来挑最弱的怪练级 */
  const teamPowerCache = new Map();
  function teamPower(team) {
    if (teamPowerCache.has(team)) return teamPowerCache.get(team);
    let sum = 0;
    try {
      const entry = e.services.adapterManifest?.battleState?.module?.getEnemyTeamEntry?.(team);
      const gda = e.services.adapterManifest?.gameData?.module;
      for (const id of Array.from(entry?.enemy || []).filter((x) => x && x !== 0xFFFF)) {
        const en = gda?.getEnemyEntry?.(e.scriptObjects.getObjectEntry(id)?.enemy?.enemyID);
        sum += (Number(en?.health) || 1) * ((Number(en?.level) || 0) + 1) * (en?.dualMove ? 2 : 1);
      }
    } catch { /* */ }
    teamPowerCache.set(team, sum || 1);
    return sum || 1;
  }
  /** 一支敌方队伍打赢能拿多少经验(Σ 敌人 exp):prefer='exp' 时按它挑 */
  const teamExpCache = new Map();
  function teamExp(team) {
    if (teamExpCache.has(team)) return teamExpCache.get(team);
    let sum = 0;
    try {
      const entry = e.services.adapterManifest?.battleState?.module?.getEnemyTeamEntry?.(team);
      const gda = e.services.adapterManifest?.gameData?.module;
      for (const id of Array.from(entry?.enemy || []).filter((x) => x && x !== 0xFFFF)) {
        sum += Number(gda?.getEnemyEntry?.(e.scriptObjects.getObjectEntry(id)?.enemy?.enemyID)?.exp) || 0;
      }
    } catch { /* */ }
    teamExpCache.set(team, sum);
    return sum;
  }
  /** 回复类仙术(按名字;法术数据里回血是脚本做的,看不出来) */
  const isHealSpell = (sp) => spellEffects(sp.id).heal && !sp.toEnemy;
  const isReviveSpell = (sp) => spellEffects(sp.id).revive;
  /**
   * grind 的一回合:先救人(血量 < 45% 且会回复法术、MP 够),再群攻(敌人 ≥ 2、留够一次回复的 MP),否则普攻血最少的敌人。
   */
  async function grindTurn(spellUse) {
    const ui = battleUI(), who = ui.curPlayerIndex;
    const members = worldService.getParty?.() || [];
    const role = members[who]?.playerRole;
    const pt = party();
    const mp = pt[who]?.mp ?? 0;
    // 缺材料的招放不出来(空过回合);花钱的招(乾坤一擲)不替玩家花
    const spells = role != null ? spellsOf(role).filter((x) => x.inBattle && x.mp != null && x.mp <= mp && !spellLack(x.id) && !spellNeeds(x.id).cash) : [];
    const heals = spells.filter(isHealSpell);
    // 有人倒下且会复活术:先复活
    const cast = async (sp, target) => { const r = await battle('magic', target, sp.name); if (r.ok) spellUse[sp.name] = (spellUse[sp.name] || 0) + 1; return r; };
    const down = pt.findIndex((r) => (r.hp ?? 1) <= 0);
    const rev = spells.find(isReviveSpell);
    if (down >= 0 && rev) {
      const r = await cast(rev, down);
      if (r.ok) return r;
    }
    const hurt = pt.map((r, i) => ({ i, f: r.maxHp ? r.hp / r.maxHp : 1, hp: r.hp })).filter((x) => x.hp > 0 && x.f < 0.45).sort((a, b) => a.f - b.f);
    if (hurt.length && heals.length) {
      const sp = hurt.length > 1 ? (heals.find((x) => x.all) || heals[0]) : (heals.find((x) => !x.all) || heals[0]);
      const r = await cast(sp, hurt[0].i);
      if (r.ok) return r;
    }
    const foes = enemies().filter((x) => x.hp > 0);
    const reserve = heals.length ? Math.min(...heals.map((x) => x.mp)) : 0;
    const aoe = spells.filter((x) => x.toEnemy && x.all && mp - x.mp >= reserve).sort((a, b) => b.mp - a.mp)[0];
    if (aoe && foes.length >= 2) {
      const r = await cast(aoe, null);
      if (r.ok) return r;
    }
    const weakest = foes.sort((a, b) => a.hp - b.hp)[0];
    return battle('attack', weakest ? weakest.index : null);
  }

  /**
   * 在地图上施法(W4 回应):打开仙术菜单 → 选施法者 → 选仙术 → 选目标 → 退出菜单。成功返回 null,否则返回原因。
   */
  async function fieldCast(casterIdx, spellId, targetIdx) {
    const svc = waitsSvc();
    if (!svc || mode() !== 'control') return 'cannot cast now';
    const top = () => svc.top();
    await tap('Force', 100); await settle(3000);
    if (top()?.kind === 'menu.list') { await respondTop({ choose: casterIdx }); await settle(3000); }
    if (top()?.kind !== 'menu.magic') { await backOut(); return 'the magic menu did not open'; }
    const idx = (top().payload.items || []).findIndex((x) => x.value === spellId && x.enabled);
    if (idx < 0) { await backOut(); return 'that spell is not castable here (MP?)'; }
    await respondTop({ choose: idx }); await settle(3000);
    if (top()?.kind === 'menu.party') { await respondTop({ choose: targetIdx }); await settle(3000); }
    await backOut();
    return null;
    async function backOut() {
      for (let k = 0; k < 6 && top() && top().kind.startsWith('menu.'); k++) { await respondTop({ cancel: true }); await settle(2000); }
      probes.menuStack = probes.menuStack.filter((m) => !m.transient);
    }
  }

  /**
   * cast 工具:在地图上施放仙术(回复、解毒等)。caster / target 可填队员下标或名字;
   * 不填 caster = 会这个仙术且 MP 够的第一个人;不填 target = 血量比例最低的队员。
   */
  async function cast(spellName, caster = null, target = null) {
    if (mode() !== 'control') return { ok: false, note: notControl('cast a spell') + ' (in battle use battle with action=magic)' };
    const members = worldService.getParty?.() || [];
    const pt = party();
    const who = (v) => (v == null ? null : typeof v === 'number' ? v : pt.findIndex((r) => r.name === v || r.name.includes(String(v))));
    const known = pt.map((r, i) => ({ i, sp: byName(spellsOf(members[i]?.playerRole ?? -1), String(spellName)) }));
    let c = who(caster);
    if (c == null) c = known.find((k) => k.sp && k.sp.field && k.sp.mp <= (pt[k.i].mp ?? 0) && pt[k.i].hp > 0)?.i ?? known.find((k) => k.sp)?.i ?? -1;
    if (c < 0 || c >= pt.length) return { ok: false, note: `nobody in the party knows "${spellName}"; spells: ${pt.map((r, i) => `${r.name}: ${spellsOf(members[i]?.playerRole ?? -1).map((x) => `${x.name}${x.field ? '' : '(battle only)'}`).join('、') || '-'}`).join(' | ')}` };
    const sp = byName(spellsOf(members[c]?.playerRole ?? -1), String(spellName));
    if (!sp) return { ok: false, note: `${pt[c].name} does not know "${spellName}"` };
    if (!sp.field) return { ok: false, note: `${sp.name} can only be cast in battle` };
    if (sp.mp != null && sp.mp > (pt[c].mp ?? 0)) return { ok: false, note: `${pt[c].name} has MP ${pt[c].mp}, ${sp.name} needs ${sp.mp}` };
    let t = who(target);
    if (t == null) t = pt.map((r, i) => ({ i, f: r.maxHp ? r.hp / r.maxHp : 1 })).sort((a, b) => a.f - b.f)[0].i;
    // 怪贴在身边时开菜单施法,怪会碰上来开战(第 21 轮白丢了一回合):先说清楚,让它走开或者直接打
    const p0 = playerPos();
    const close = objects().filter((o) => o.kind === 'enemy' && Math.max(Math.abs(o.gx - p0.gx), Math.abs(o.gy - p0.gy)) <= Math.max(0, (o.triggerMode || 4) - 4) + 2);
    if (close.length) {
      return { ok: false, note: `a monster is right next to you (${close.map((o) => `id=${o.id} at (${o.gx},${o.gy})${o.battle?.names?.length ? ` ${o.battle.names.join('、')}` : ''}`).join('; ')}) — casting now would likely pull you into a battle; walk a few steps away first, or fight it` };
    }
    const before = party();
    const err = await fieldCast(c, sp.id, t);
    if (err) return { ok: false, note: `${pt[c].name} could not cast ${sp.name}: ${err}` };
    const after = party();
    const diff = after.map((r, i) => (r.hp !== before[i].hp || r.mp !== before[i].mp ? `${r.name} HP${before[i].hp}→${r.hp} MP${before[i].mp}→${r.mp}` : null)).filter(Boolean).join(', ');
    return { ok: true, note: `${pt[c].name} cast ${sp.name}${sp.all ? '' : ` on ${pt[t]?.name}`}: ${diff || 'no visible change'}; mode now ${mode()}` };
  }

  const grindAvoid = new Map();                       // 场景 → 打不过的怪群
  async function grind(targetLevel = 99, maxBattles = 50, budgetS = 120, prefer = 'safe') {
    // Leave headroom below the MCP client's 120-second timeout.
    if (!Number.isFinite(budgetS) || budgetS <= 0) return { ok: false, note: 'budget_s must be positive and finite' };
    const seconds = Math.min(budgetS, 110);
    return runWithDeadline(seconds * 1000, () => grindWithinBudget(targetLevel, maxBattles, seconds, prefer));
  }
  async function grindWithinBudget(targetLevel, maxBattles, budgetS, prefer) {
    if (mode() !== 'control') return { ok: false, note: notControl('grind') };
    const t0 = realNow(), scene0 = worldService.getSceneId();
    const lv = () => Math.min(...party().map((r) => r.level || 0));
    const startLevels = party().map((r) => `${r.name} Lv${r.level}`).join(' ');
    const used = {}, spellUse = {};
    // 一场就打掉 40% 以上血的怪群(按敌人名字组合):之后绕开;按场景记住,跨多次 grind 调用
    const avoid = grindAvoid.get(scene0) || new Set();
    grindAvoid.set(scene0, avoid);
    const sig = (names) => [...names].sort().join('+');
    let battles = 0, wins = 0, why = null, lastTeam = null;
    const hpFrac = () => { const pt = party(); return pt.reduce((s, r) => s + (r.hp || 0), 0) / Math.max(1, pt.reduce((s, r) => s + (r.maxHp || 0), 0)); };
    const bag = () => inventory();
    const heal = async () => {
      const pt = party();
      for (let i = 0; i < pt.length; i++) {
        checkBudget();
        if (mode() !== 'control') return null;        // 回血时被怪撞上了:交给下面的战斗逻辑
        const r = party()[i];
        if (r.hp > 0 && r.hp >= r.maxHp * 0.7) continue;
        // 先用仙术(地图上可施放的回复术,谁 MP 够谁放),再用药
        if (r.hp > 0) {
          const members = worldService.getParty?.() || [];
          let castDone = false;
          for (let c = 0; c < pt.length && !castDone; c++) {
            const role = members[c]?.playerRole;
            if (role == null || !(pt[c].hp > 0)) continue;
            const sp = spellsOf(role).filter((x) => x.field && isHealSpell(x) && x.mp != null && x.mp <= pt[c].mp)[0];
            if (!sp) continue;
            const err = await fieldCast(c, sp.id, i);
            if (!err) { castDone = true; spellUse[sp.name + '(map)'] = (spellUse[sp.name + '(map)'] || 0) + 1; }
          }
          if (castDone) { i--; continue; }            // 再看一遍这个人够不够
        }
        // 倒下的:先找会复活术、MP 够、自己没倒的队员施法
        if (r.hp <= 0) {
          const members = worldService.getParty?.() || [];
          let revived = false;
          for (let c = 0; c < pt.length && !revived; c++) {
            if (c === i || !(party()[c].hp > 0)) continue;
            const sp = spellsOf(members[c]?.playerRole ?? -1).find((x) => x.field && isReviveSpell(x) && x.mp != null && x.mp <= party()[c].mp);
            if (!sp) continue;
            if (!(await fieldCast(c, sp.id, i))) { revived = true; spellUse[sp.name + '(map)'] = (spellUse[sp.name + '(map)'] || 0) + 1; }
          }
          if (revived) { i--; continue; }
        }
        const have = bagFor(r.hp <= 0 ? 'revive' : 'heal')[0]?.name;
        if (!have) return `${r.name} is ${r.hp <= 0 ? 'down' : `low (HP ${r.hp}/${r.maxHp})`} and there is no ${r.hp <= 0 ? 'revive' : 'healing'} item left`;
        if (mode() !== 'control') return null;
        const u = await useItem(have, i);
        if (mode() !== 'control') await settle();
        if (mode() === 'battle') return null;
        if (!u.ok) return `could not use ${have} on ${r.name}: ${u.note}`;
        used[have] = (used[have] || 0) + 1;
      }
      return null;
    };
    try {
      while (!why) {
        checkBudget();
        if (typeof e.isHumanTakeover === 'function' && e.isHumanTakeover()) { why = 'human player took over in browser'; break; }
        if (lv() >= targetLevel) { why = `reached Lv${targetLevel}`; break; }
        if (battles >= maxBattles) { why = `fought ${maxBattles} battles (max_battles)`; break; }
        if (realNow() - t0 > budgetS * 1000) { why = `time budget (${budgetS}s) used up`; break; }
        const h = await heal();
        if (h) { why = h; break; }
        // 找怪;都被打掉了就等它们刷新(PAL 的怪消失一段时间后会再出现)
        let foes = objects().filter((o) => o.kind === 'enemy');
        for (let k = 0; !foes.length && k < 40 && realNow() - t0 <= budgetS * 1000; k++) {
          await sleep(500);
          if (mode() !== 'control') break;
          foes = objects().filter((o) => o.kind === 'enemy');
        }
        if (mode() === 'battle') foes = [{}];
        if (!foes.length) { why = 'no monsters here (none visible, none respawned after waiting)'; break; }
        if (mode() === 'control') {
          // 先挑最弱的一组(血量和最小,差不多强时挑近的):怪群强弱悬殊,撞最近的容易撞上打不过的
          const p = playerPos();
          const dist = (o) => Math.abs(o.gx - p.gx) + Math.abs(o.gy - p.gy);
          const power = (o) => (o.battle ? teamPower(o.battle.team) : 1);
          // 只挑「不穿过别的怪的触碰范围就走得到」的(否则半路撞上别的、更强的一组)
          // 走得到 = 严格寻路有路;或者无视触碰范围有路,且路上经过的怪群都不比目标强、也不在回避名单里
          //(顺路撞上一组更弱的没关系,撞上强的才要命)
          const zoneOf = (o) => Math.max(0, (o.triggerMode || 4) - 4) + 1;
          const crossed = (path, target) => {
            let x = p.gx, y = p.gy; const hit = new Set();
            for (const dir of path) {
              x += DIRS[dir].dgx; y += DIRS[dir].dgy;
              for (const f of foes) if (f !== target && Math.max(Math.abs(f.gx - x), Math.abs(f.gy - y)) <= zoneOf(f)) hit.add(f);
            }
            return [...hit];
          };
          const reachable = (o) => {
            if (findPath(p, { gx: o.gx, gy: o.gy })) return true;
            const loose = findPath(p, { gx: o.gx, gy: o.gy }, { noZones: true });
            if (!loose) return false;
            return crossed(loose, o).every((f) => !(f.battle && avoid.has(sig(f.battle.names))) && power(f) <= power(o) * 1.25);
          };
          const ok = withObstacleMemo(() => foes.filter((o) => !(o.battle && avoid.has(sig(o.battle.names))) && reachable(o)));
          if (!ok.length) { why = avoid.size ? `every monster group I can reach is too strong for now (avoided: ${[...avoid].join(' / ')})` : 'no monster group reachable without passing others'; break; }
          let pick;
          if (prefer === 'exp') {
            // 后期迷宫里最弱的怪经验太少(锁妖塔练一级要十几场):挑走得到、没被标成打不过的里经验最多的一组。
            // 安全网照旧:血量掉到一半就逃,一场掉四成以上的怪群记进回避名单
            const xp = (o) => (o.battle ? teamExp(o.battle.team) : 0);
            const best = Math.max(...ok.map(xp));
            pick = ok.filter((o) => xp(o) >= best * 0.8).sort((x, y) => dist(x) - dist(y))[0];
          } else {
            const weakest = Math.min(...ok.map(power));
            pick = ok.filter((o) => power(o) <= weakest * 1.25).sort((x, y) => dist(x) - dist(y))[0];
          }
          // 严格路径走不通时按宽松路径一步步走(walk_to 的兜底可能绕进更强的怪)
          const strict = findPath(p, { gx: pick.gx, gy: pick.gy });
          if (strict) await walkTo(pick.gx, pick.gy);
          else {
            const loose = findPath(p, { gx: pick.gx, gy: pick.gy }, { noZones: true }) || [];
            for (const dir of loose) { if (mode() !== 'control') break; await stepOnce(dir); }
            if (mode() === 'control') await settle();
          }
        }
        let m = mode();
        if (m === 'busy') m = await settle();           // 过场 / 动画:等它稳定再判断
        if (m === 'control') {
          if (worldService.getSceneId() !== scene0) { why = `left the scene (now scene ${worldService.getSceneId()})`; break; }
          continue;                                     // 没撞上(怪走开了),再找
        }
        if (m !== 'battle') { why = `something else happened (mode ${m}) — a story event?`; break; }
        // 逐回合打:总血量掉到 50% 以下就逃跑并记下这组怪(打不过就跑,下次绕开)
        let r, fled = false;
        const hp0 = hpFrac();
        lastTeam = sig(enemies().map((x) => x.name));    // 实际遇上的那组(按敌人名字)
        const known = avoid.has(lastTeam);              // 撞上的是已知打不过的那组:开局就跑
        // 按「还在战斗里」循环,不按 mode === 'battle':回合中途会弹战斗内对白(队友倒下、怒火燃烧……),
        // 以前一见 dialog 就当打完了,报成「剧情事件」停下,其实仗还没打完(第 24 轮逃离芒刺鬼 / 土蛟龙)
        const inFightDialog = () => worldService.isInBattle() && ['dialog', 'anykey'].includes(mode());
        for (let k = 0; k < 60 && worldService.isInBattle(); k++) {
          checkBudget();
          if (inFightDialog()) { await advance(1); continue; }
          if (mode() !== 'battle') { await settle(3000); if (mode() !== 'battle' && !inFightDialog()) break; continue; }
          if (known || hpFrac() < 0.5) {
            fled = true;
            for (let f = 0; f < 12 && worldService.isInBattle(); f++) {
              checkBudget();
              if (inFightDialog()) { await advance(1); continue; }
              if (mode() !== 'battle') { await settle(3000); continue; }
              r = await battle('flee');
            }
            break;
          }
          r = await grindTurn(spellUse);
        }
        battles++;
        onLog({ type: 'grind-battle', n: battles, foes: lastTeam, fled, hpBefore: +hp0.toFixed(2), hpAfter: +hpFrac().toFixed(2), note: (r?.note || '').slice(0, 160) });
        if (lastTeam != null && (fled || hp0 - hpFrac() > 0.4)) avoid.add(lastTeam);
        const note = r?.note || '';
        if (/battle over: lost/.test(note)) { why = 'lost a battle (the game reloads the last save)'; break; }
        if (!fled && !worldService.isInBattle() && worldService.getSceneId() === scene0) wins++;   // 结果文字不一定带 "battle over: won"(W4 路径),没逃、没输就算赢
        if (mode() !== 'control') {
          let m2 = await settle();
          // 战利品提示(獲得 / 得到 …)直接推过去;别的对白当作剧情,停下交给模型
          for (let k = 0; k < 6 && m2 === 'dialog'; k++) {
            const cur = dialogService.getCurrentLine?.();
            const text = cleanText(cur?.text || '');
            if (!/^(獲得|得到|获得)/.test(text)) break;
            await advance(1);
            m2 = await settle();
          }
          // 刚打完又被别的怪撞上(连续遇敌):不是剧情,接着打下一场
          if (m2 === 'battle') continue;
          // 打输了:全队倒下,游戏弹「勝敗乃兵家常事也 / 大俠請重新來過吧」再读档 —— 不是剧情(以前报成 story event,第 24 轮)
          if (m2 !== 'control') {
            const line = cleanText(dialogService.getCurrentLine?.()?.text || '');
            const wiped = party().every((r) => (r.hp || 0) <= 0);
            if (/勝敗乃兵家常事|重新來過|胜败乃兵家常事|重新来过/.test(line) || wiped) { why = 'lost a battle (the game reloads the last save)'; break; }
            why = `after a battle the game is in mode ${m2} — a story event?`; break;
          }
        }
      }
    } catch (error) {
      if (!(error instanceof BudgetExpired)) throw error;
      why = `time budget (${budgetS}s) used up; mode now ${mode()} — observe before continuing; accepted actions may still be resolving`;
    }
    const endLevels = party().map((r) => `${r.name} Lv${r.level} HP${r.hp}/${r.maxHp}`).join(' | ');
    const items = Object.entries(used).map(([n, c]) => `${n}×${c}`).join('、');
    const casts = Object.entries(spellUse).map(([n, c]) => `${n}×${c}`).join('、');
    const av = avoid.size ? `; avoided ${[...avoid].join(' / ')} (they hit too hard)` : '';
    return { ok: battles > 0 || /reached/.test(why), note: `grind stopped: ${why}. ${battles} battles (${wins} won) in ${((realNow() - t0) / 1000).toFixed(0)}s; ${startLevels} → ${endLevels}${items ? `; used ${items}` : ''}${casts ? `; cast ${casts}` : ''}${av}` };
  }

  async function wait(ms = 1000) {
    await sleep(Math.min(Math.max(ms, 0), 15000));
    const m = await settle(5000);
    return { ok: true, note: `waited; mode now ${m}` };
  }

  // 非战斗动作前后都清一次过期的战斗快照(见 dropStaleBattleCtx);battle() 自己在结算时用掉快照
  const outOfBattle = (fn) => async (...args) => { dropStaleBattleCtx(); try { return await fn(...args); } finally { dropStaleBattleCtx(); } };
  return {
    hintsLevel,
    observe: (...args) => { dropStaleBattleCtx(); return observe(...args); }, settle, mode, playerPos, objects,
    walkTo: outOfBattle(walkTo), step: outOfBattle(step), search: outOfBattle(search), interact: outOfBattle(interact),
    advance: outOfBattle(advance), choose: outOfBattle(choose), press: outOfBattle(press), battle, wait: outOfBattle(wait),
    grind, cast: outOfBattle(cast), useItem: outOfBattle(useItem), equip: outOfBattle(equip), save, autosave, load, listSaves, findPath,
    /** 诊断:分别关掉各项约束,看哪一项把路堵死。 */
    debugPath(gx, gy) {
      const p = playerPos(), to = { gx, gy };
      const t = (o) => { const r = findPath(p, to, o); return r ? r.length : null; };
      return { from: [p.gx, p.gy], all: t({}), bigBudget: t({ maxNodes: 60000 }), noVoid: t({ maxNodes: 60000, noVoid: true }), noZones: t({ maxNodes: 60000, noZones: true }), noObjects: t({ maxNodes: 60000, noObjects: true }), none: t({ maxNodes: 60000, noVoid: true, noZones: true, noObjects: true }) };
    },
    mapMemory: () => {
      const d = sceneDirectory(), sn = sceneName(d.scene);
      return { ok: true, note: `\nthis scene ${d.scene}${sn ? ` (${sn})` : ''} — everything in it, nearest first (you are at (${d.player.gx},${d.player.gy}); walk_to any of these coordinates):\n${d.text}\n\nwhat you remember from earlier:\n` + memory.describe() };
    },
    sceneDirectory,
    /**
     * 观战页小地图读这两个(只读,形状与 host 约定):
     *  visitedCells(scene) → [[gx, gy], ...] 旋转网格(同 walk_to),没有记录时 []
     *  exitUsage(scene)    → [{ id, gx, gy, to, count }] 该场景通往别处的出口;to = 目标场景号,count = 走过几次(0 = 没走过)
     */
    visitedCells: (scene = worldService.getSceneId()) => memory.visitedCells(scene).map((c) => [c.gx, c.gy]),
    exitUsage: (scene = worldService.getSceneId()) => router.sceneExits(scene).filter((x) => x.to.scene !== scene)
      .map((x) => ({ id: x.id, gx: x.gx, gy: x.gy, to: x.to.scene, count: memory.exit(scene, x.id)?.count || 0 })),
    voidAt,
    /** atlas 工具:当前场景(或指定地名)的标注全图。 */
    atlasFor(place) {
      if (!atlas) return { error: 'No map atlas configured (set AGENT_PAL_ATLAS_INDEX; build it with atlas-build).' };
      const scene = worldService.getSceneId();
      const entry = place ? atlas.byName(place) : atlas.forMap(mapOf(scene));
      if (!entry) return { error: `${place ? `No atlas image for "${place}".` : `No atlas image for scene ${scene}.`} Known places: ${atlas.names().join('、')}` };
      return { entry, image: atlas.imageBase64(entry) };
    },
    stats: () => ({ scene: worldService.getSceneId(), visitedScenes: [...visitedScenes] }),
    /** W3 对照:等待栈与旧判断/菜单截获不一致的次数 */
    waitStats: () => ({ ...waitMismatch, byPair: { ...waitMismatch.byPair } }),
    /** 当前等待(栈顶)—— kind / token / payload;引擎没有等待栈时为 undefined */
    currentWait: () => { const t = waitTop(); return t ? { kind: t.kind, token: t.token, payload: t.payload } : t; }
  };
}
