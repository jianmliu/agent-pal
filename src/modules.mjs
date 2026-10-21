/**
 * modules — 模块加载器(docs/specs/agent-pal.md §5.2)。
 *
 * <module_dir>/<name>/module.yaml(或 module.json)声明 run.command / rpc / packets / lifecycle / requires。
 * 每个模块一个子进程,两条 Unix socket 上说换行分隔的 JSON-RPC 2.0(rpc.mjs):
 *   AGENT_PAL_MODULE_SOCKET   模块监听:会话调它的 rpc 方法、给它投递 packets、调 lifecycle 钩子
 *   AGENT_PAL_SESSION_SOCKET  会话监听:模块调 SendMessage(CMSG) / GetClock() / InvokeModule(name.method, args)
 * 模块拿不到 GetWorldState:世界模型只能靠订阅 SMSG 自己建(§5.2)。
 *
 * 投递顺序:一批事件按发生顺序逐条投递,每条等模块处理完(request,不是 notification),
 * 发起指令的一方等这批投完才拿到回复 —— 所以模块下一步决策时,世界模型一定已经更新。
 * 不设全局投递队列:packet 处理函数里再发指令(重入)也不会死锁,只是嵌套那批会先投完。
 *
 * 注意:加载必须在 bootEngine() 之前完成 —— 确定性模式会接管全局 setTimeout(虚拟时钟),
 * 等模块 socket 就绪的轮询用的是真实计时器。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { SMSG } from '@onchainpal/agent-pal-protocol';
import { parseYamlLite } from './yaml-lite.mjs';
import { rpcPeer } from './rpc.mjs';

const NAME_RE = /^[a-z][a-z0-9-]{0,30}$/;
const METHOD_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;
const SESSION_ID = `s${process.pid}-${Date.now().toString(36)}`;

/** MCP 工具名只允许 [A-Za-z0-9_-]:模块方法 my-walker.goto 在 MCP 里叫 my-walker__goto(HTTP / InvokeModule 仍用点号)。 */
export const mcpToolName = (rpcName) => rpcName.replace('.', '__');
export const rpcNameFromTool = (tool) => (tool.includes('__') ? tool.replace('__', '.') : null);

/** 读并校验一个模块目录的清单。 */
export function readManifest(dir) {
  const name = path.basename(dir);
  let raw;
  if (fs.existsSync(path.join(dir, 'module.yaml'))) raw = parseYamlLite(fs.readFileSync(path.join(dir, 'module.yaml'), 'utf8'));
  else if (fs.existsSync(path.join(dir, 'module.json'))) raw = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
  else return null;
  const bad = (msg) => { throw new Error(`module ${name}: ${msg}`); };
  if (!NAME_RE.test(name)) bad('directory name must be lowercase letters, digits and dashes');
  if (raw.api_version !== 1) bad(`api_version must be 1 (got ${JSON.stringify(raw.api_version)})`);
  if (!raw.run || typeof raw.run.command !== 'string' || !raw.run.command.trim()) bad('run.command is required');
  const map = (k) => {
    const v = raw[k] ?? {};
    if (typeof v !== 'object' || Array.isArray(v)) bad(`${k} must be a mapping`);
    for (const [key, handler] of Object.entries(v)) if (typeof handler !== 'string' || !METHOD_RE.test(handler)) bad(`${k}.${key}: handler must be a function name`);
    return v;
  };
  const rpc = map('rpc');
  for (const m of Object.keys(rpc)) if (!METHOD_RE.test(m)) bad(`rpc method "${m}" must be [A-Za-z][A-Za-z0-9_]*`);
  const packets = map('packets');
  for (const op of Object.keys(packets)) if (op !== '*' && !(op in SMSG)) bad(`packets: unknown server op ${op}`);
  const lifecycle = map('lifecycle');
  const requires = raw.requires ?? [];
  if (!Array.isArray(requires)) bad('requires must be a list');
  let schema = {};
  if (fs.existsSync(path.join(dir, 'schema.json'))) schema = JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8'));
  return {
    name, dir,
    enabled: raw.enabled !== false,
    description: typeof raw.description === 'string' ? raw.description : '',
    command: raw.run.command,
    rpc, packets, lifecycle,
    requires: requires.map(String),
    needsData: raw.data === true,      // 要读 data dump(§5.3);加载器把目录放进 AGENT_PAL_DATA_DIR
    schema
  };
}

/** 扫描若干模块根目录(或直接指向含 module.yaml 的单个模块目录),返回启用的清单(按 requires 拓扑排序;缺依赖 / 环直接报错)。 */
export function discoverModules(roots) {
  const found = new Map();
  const addManifest = (dir) => {
    const m = readManifest(dir);
    if (!m || !m.enabled) return false;
    const prev = found.get(m.name);
    if (prev && path.resolve(prev.dir) !== path.resolve(dir)) throw new Error(`module ${m.name} is defined twice`);
    found.set(m.name, m);
    return true;
  };
  for (const root of roots) {
    if (!fs.existsSync(root)) throw new Error(`module directory not found: ${root}`);
    if (fs.existsSync(path.join(root, 'module.yaml')) || fs.existsSync(path.join(root, 'module.json'))) {
      addManifest(root);
      continue;
    }
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      addManifest(path.join(root, ent.name));
    }
  }
  const order = [];
  const state = new Map();
  const visit = (m, chain) => {
    if (state.get(m.name) === 'done') return;
    if (state.get(m.name) === 'visiting') throw new Error(`module dependency cycle: ${[...chain, m.name].join(' → ')}`);
    state.set(m.name, 'visiting');
    for (const dep of m.requires) {
      const d = found.get(dep);
      if (!d) throw new Error(`module ${m.name} requires ${dep}, which is not installed or disabled`);
      visit(d, [...chain, m.name]);
    }
    state.set(m.name, 'done');
    order.push(m);
  };
  for (const m of [...found.values()].sort((x, y) => x.name.localeCompare(y.name))) visit(m, []);
  return order;
}

/** 计算模块目录的文件指纹(文件名 + 大小 + mtimeMs),用于 reload 时检测代码或清单是否改动。 */
function dirFingerprint(dir, depth = 0) {
  const parts = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (depth < 2) parts.push(`${ent.name}/(${dirFingerprint(full, depth + 1)})`);
    } else if (ent.isFile()) {
      try {
        const st = fs.statSync(full);
        parts.push(`${ent.name}:${st.size}:${st.mtimeMs}`);
      } catch { /* */ }
    }
  }
  return parts.join('|');
}

// 优先取真实 setTimeout:确定性模式会把 globalThis.setTimeout 换成只在指令执行期间走的虚拟时钟
const capturedSetTimeout = globalThis.__agentPalRealSetTimeout || globalThis.setTimeout;
const realSleep = (ms) => new Promise((r) => (globalThis.__agentPalRealSetTimeout || capturedSetTimeout)(r, ms));

async function connectWhenReady(sockPath, child, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`exited with code ${child.exitCode} before listening`);
    if (fs.existsSync(sockPath)) {
      try {
        return await new Promise((resolve, reject) => {
          const s = net.connect(sockPath);
          s.once('connect', () => resolve(s));
          s.once('error', reject);
        });
      } catch { /* 还没 listen,再等 */ }
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`did not listen on its socket within ${timeoutMs} ms`);
    await realSleep(50);
  }
}

/**
 * 启动并管理模块(支持运行中热加载 / 热重载 reload)。
 * @param {string[]} roots 模块根目录(可为空,之后通过 reload({ dir }) 动态挂载)
 * @param {object} opts
 * @param {(s:string)=>void} [opts.log]
 * @param {() => Promise<{l0: object, run: (fn: () => Promise<any>) => Promise<any>}>} opts.session
 *        取会话(按需启动引擎);run 把一次推进游戏的操作排进会话的串行队列
 * @param {() => Promise<object[]|null>} [opts.getHello] 热加载模块时取当前时刻的 SMSG_HELLO + fullState 快照
 * @param {() => Promise<void>} [opts.ensureDataDump] 当热加载的模块声明 data: true 时按需生成 data dump
 * @param {(events: object[]) => Promise<void>|void} [opts.onEvents] 模块 SendMessage 产生 SMSG 时的额外回调(同步给 codeRunner)
 * @param {() => void} [opts.onChanged] 模块增删或重载后的通知钩子(用于发 notifications/tools/list_changed)
 */
export async function loadModules(roots = [], opts = {}) {
  const log = opts.log || ((s) => process.stderr.write(s + '\n'));
  const rootsList = [...new Set(roots.map((d) => path.resolve(d)))];
  const manifests = rootsList.length ? discoverModules(rootsList) : [];
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-'));
  const loaded = [];
  const byName = new Map();
  let nextSockId = 0;

  async function sendFromModule(name, cmsg) {
    const { l0, run } = await opts.session();
    const r = await run(() => l0.send(cmsg, { via: name }));
    const evs = [r.reply, ...r.events];
    await deliver(evs);
    if (opts.onEvents) await opts.onEvents(evs);
    return r;
  }

  async function invoke(rpcName, params = {}) {
    const [mod, method] = String(rpcName).split('.');
    const m = byName.get(mod);
    if (!m) throw new Error(`no module named ${mod}`);
    const handler = m.manifest.rpc[method];
    if (!handler) throw new Error(`module ${mod} has no method ${method}`);
    return m.peer.call(handler, params);
  }

  /** 按顺序把一批 SMSG 投给特定模块集(默认全部已加载模块),等它们处理完。 */
  async function deliver(events, targets = loaded) {
    for (const ev of events) {
      for (const m of targets) {
        const handler = m.manifest.packets[ev.op] || m.manifest.packets['*'];
        if (!handler || m.peer.closed) continue;
        try { await m.peer.call(handler, ev); } catch (err) { log(`[agent-pal] module ${m.manifest.name}: ${handler}(${ev.op}) failed: ${err.message}`); }
      }
    }
  }

  async function startOne(man) {
    const id = nextSockId++;
    const moduleSock = path.join(sockDir, `${id}.m.sock`);
    const sessionSock = path.join(sockDir, `${id}.s.sock`);
    const server = net.createServer((sock) => {
      rpcPeer(sock, {
        SendMessage: (cmsg) => sendFromModule(man.name, cmsg),
        GetClock: async () => (await opts.session()).l0.clock(),
        InvokeModule: (p) => invoke(p?.method, p?.params)
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(sessionSock, resolve); });
    const child = spawn(man.command, {
      cwd: man.dir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],      // 模块的 stdout 绝不能进我们的 stdout(那是 MCP 协议流)
      env: {
        ...process.env,
        AGENT_PAL_MODULE_SOCKET: moduleSock,
        AGENT_PAL_SESSION_SOCKET: sessionSock,
        AGENT_PAL_MODULE_NAME: man.name,
        AGENT_PAL_SESSION_ID: SESSION_ID,
        AGENT_PAL_SAVE_SLOT: process.env.AGENT_PAL_SAVE_SLOT || '',
        AGENT_PAL_DATA_DIR: process.env.AGENT_PAL_DATA_DIR || ''
      }
    });
    const prefix = (stream) => stream.on('data', (d) => { for (const l of String(d).split('\n')) if (l.trim()) log(`[${man.name}] ${l}`); });
    prefix(child.stdout);
    prefix(child.stderr);
    let sock;
    try { sock = await connectWhenReady(moduleSock, child, 15000); }
    catch (err) { child.kill(); server.close(); throw new Error(`module ${man.name} ${err.message}`); }
    const peer = rpcPeer(sock, {});
    const m = { manifest: man, child, server, peer, fingerprint: dirFingerprint(man.dir) };
    log(`[agent-pal] module ${man.name} loaded (${Object.keys(man.rpc).length} method(s), packets: ${Object.keys(man.packets).join(' ') || 'none'})`);
    return m;
  }

  async function stopOne(m) {
    const h = m.manifest.lifecycle.before_quit;
    if (h && !m.peer.closed) {
      try { await Promise.race([m.peer.call(h, {}), realSleep(5000)]); } catch (err) { log(`[agent-pal] module ${m.manifest.name}: ${h} failed: ${err.message}`); }
    }
    m.peer.close();
    m.child.kill();
    m.server.close();
  }

  for (const man of manifests) {
    const m = await startOne(man);
    loaded.push(m);
    byName.set(man.name, m);
  }

  const api = {
    get count() { return loaded.length; },
    roots: () => [...rootsList],
    names: () => loaded.map((m) => m.manifest.name),
    has: (name) => byName.has(name),
    /** 模块方法 → MCP 工具定义。 */
    tools() {
      const out = [];
      for (const { manifest: man } of loaded) {
        for (const method of Object.keys(man.rpc)) {
          const s = man.schema?.[method] || {};
          out.push({
            name: mcpToolName(`${man.name}.${method}`),
            description: `[module ${man.name}] ${s.description || man.description || method}`,
            inputSchema: s.input || { type: 'object', properties: {}, additionalProperties: true }
          });
        }
      }
      return out;
    },
    invoke,
    deliver,
    /**
     * 运行中热加载 / 热重载模块:
     *  - dir: 新增一个模块根目录,或直接指向某个含 module.yaml 的模块目录
     *  - name: 指定只重载某一个模块(若它尚未加载则加载它)
     *  - all: 为 true 时强制重启全部模块;默认只启动新增模块 + 重启文件改动过或已退出的模块
     * 新启动/重启的模块会立即收到当前时刻的 SMSG_HELLO + fullState 快照,建立起最新世界模型。
     */
    async reload({ dir, name, all = false } = {}) {
      let targetDir = null;
      if (dir) {
        const abs = path.resolve(dir);
        if (!fs.existsSync(abs)) throw new Error(`module directory not found: ${abs}`);
        if (!rootsList.includes(abs)) rootsList.push(abs);
        if (fs.existsSync(path.join(abs, 'module.yaml')) || fs.existsSync(path.join(abs, 'module.json'))) targetDir = abs;
      }
      const nextManifests = rootsList.length ? discoverModules(rootsList) : [];
      if (name && !nextManifests.some((m) => m.name === name) && !byName.has(name)) {
        throw new Error(`no module named ${name} found in [${rootsList.join(', ')}]`);
      }
      if (nextManifests.some((m) => m.needsData) && !process.env.AGENT_PAL_DATA_DIR && opts.ensureDataDump) {
        await opts.ensureDataDump();
      }
      const nextSet = new Set(nextManifests.map((m) => m.name));
      const added = [], reloaded = [], removed = [], hydrated = [];

      // 1. 停止已被删除或 disabled 的模块(按逆拓扑序)
      for (const m of [...loaded].reverse()) {
        const mName = m.manifest.name;
        if (!nextSet.has(mName) && (!name || name === mName)) {
          await stopOne(m);
          byName.delete(mName);
          removed.push(mName);
        }
      }

      // 2. 启动新模块 / 重启改动或指定的模块
      for (const man of nextManifests) {
        const existing = byName.get(man.name);
        if (!existing) {
          const fresh = await startOne(man);
          byName.set(man.name, fresh);
          added.push(man.name);
          hydrated.push(fresh);
          continue;
        }
        const fp = dirFingerprint(man.dir);
        const changed = fp !== existing.fingerprint || existing.child.exitCode != null;
        const explicit = all || name === man.name || (targetDir && path.resolve(man.dir) === targetDir);
        if (explicit || (!name && changed)) {
          await stopOne(existing);
          const fresh = await startOne(man);
          byName.set(man.name, fresh);
          reloaded.push(man.name);
          hydrated.push(fresh);
        }
      }

      // 3. 按新的拓扑序重排 loaded
      loaded.length = 0;
      for (const man of nextManifests) {
        const m = byName.get(man.name);
        if (m) loaded.push(m);
      }

      // 4. 给新启动 / 重启的模块投递当前时刻的 SMSG_HELLO + fullState 快照
      if (hydrated.length && opts.getHello) {
        const helloEvents = await opts.getHello();
        if (helloEvents?.length) await deliver(helloEvents, hydrated);
      }
      if ((added.length || reloaded.length || removed.length) && opts.onChanged) {
        try { opts.onChanged(); } catch { /* */ }
      }
      return { added, reloaded, removed, active: api.names(), tools: api.tools().map((t) => t.name) };
    },
    /** session.quit:先调各模块的 before_quit(倒序:被依赖的最后退),再结束子进程。 */
    async quit() {
      for (const m of [...loaded].reverse()) await stopOne(m);
      loaded.length = 0;
      byName.clear();
      try { fs.rmSync(sockDir, { recursive: true, force: true }); } catch { /* */ }
    }
  };
  return api;
}
