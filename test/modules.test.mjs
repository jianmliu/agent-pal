/**
 * 模块系统单元测试:yaml-lite、清单校验与依赖排序,以及真实子进程 + Unix socket 上的
 * rpc 调用 / packet 投递顺序 / InvokeModule / before_quit。会话用假的 L0,不需要游戏资产。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlLite } from '../src/yaml-lite.mjs';
import { readManifest, discoverModules, loadModules, mcpToolName, rpcNameFromTool } from '../src/modules.mjs';
import { createCodeRunner } from '../src/code-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sdk = path.resolve(here, '..', 'src', 'module-sdk.mjs');
let n = 0;
const t = async (name, fn) => { await fn(); n++; process.stdout.write(`  ✓ ${name}\n`); };

await t('yaml-lite:spec §5.2 的样例', () => {
  const y = parseYamlLite(`
api_version: 1
enabled: true
description: 网格寻路 + 走到目标格   # 注释
requires: [world-model]
run:
  command: node --experimental-strip-types index.ts
rpc:
  goto: goto          # 暴露为 my-walker.goto
packets:
  SMSG_SCENE_ENTER: onSceneEnter
lifecycle:
  before_quit: beforeQuit
tags:
  - a
  - "b # not a comment"
`);
  assert.deepEqual(y, {
    api_version: 1, enabled: true, description: '网格寻路 + 走到目标格', requires: ['world-model'],
    run: { command: 'node --experimental-strip-types index.ts' },
    rpc: { goto: 'goto' }, packets: { SMSG_SCENE_ENTER: 'onSceneEnter' }, lifecycle: { before_quit: 'beforeQuit' },
    tags: ['a', 'b # not a comment']
  });
});

await t('yaml-lite:不支持的语法直接报错', () => {
  assert.throws(() => parseYamlLite('a: |\n  multi'), /not supported/);
  assert.throws(() => parseYamlLite('a: 1\n    b: 2'), /indentation/);
  assert.throws(() => parseYamlLite('\ta: 1'), /tabs/);
});

// ---- 临时模块目录 --------------------------------------------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-mods-'));
const quitMark = path.join(root, 'quit.txt');
const mkModule = (name, yaml, js) => {
  const d = path.join(root, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'module.yaml'), yaml);
  if (js) fs.writeFileSync(path.join(d, 'index.mjs'), js);
  return d;
};

mkModule('world-model', `api_version: 1
description: counts packets
run:
  command: node index.mjs
rpc:
  seen: seen
packets:
  "*": onAny
`, `import { startModule } from ${JSON.stringify(sdk)};
const got = [];
await startModule({ onAny: (m) => { got.push(m.op); }, seen: () => got });
`);

mkModule('walker', `api_version: 1
description: talks to the session
requires: [world-model]
run:
  command: node index.mjs
rpc:
  go: go
  ask: ask
packets:
  SMSG_PLAYER_UPDATE: onPlayer
lifecycle:
  before_quit: bye
`, `import { startModule } from ${JSON.stringify(sdk)};
import fs from 'node:fs';
let player = null;
const s = await startModule({
  onPlayer: async (m) => { await new Promise((r) => setTimeout(r, 20)); player = m; },   // 慢处理:回复必须等它
  go: async ({ dir }) => { const r = await s.send({ op: 'CMSG_MOVE', dir, seq: 5 }); return { reply: r.reply, player, clock: await s.clock() }; },
  ask: () => s.invoke('world-model.seen'),
  bye: () => fs.writeFileSync(${JSON.stringify(quitMark)}, 'bye')
});
`);

mkModule('disabled-one', `api_version: 1
enabled: false
run:
  command: node nowhere.mjs
`);

await t('清单:requires 拓扑排序,禁用的跳过', () => {
  assert.deepEqual(discoverModules([root]).map((m) => m.name), ['world-model', 'walker']);
});

await t('清单:错误给出模块名与原因', () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-bad-'));
  const mk = (name, yaml) => { fs.mkdirSync(path.join(bad, name)); fs.writeFileSync(path.join(bad, name, 'module.yaml'), yaml); return path.join(bad, name); };
  assert.throws(() => readManifest(mk('v2', 'api_version: 2\nrun:\n  command: x')), /v2: api_version must be 1/);
  assert.throws(() => readManifest(mk('norun', 'api_version: 1')), /run.command is required/);
  assert.throws(() => readManifest(mk('badop', 'api_version: 1\nrun:\n  command: x\npackets:\n  SMSG_NOPE: f')), /unknown server op SMSG_NOPE/);
  assert.throws(() => readManifest(mk('Bad_Name', 'api_version: 1\nrun:\n  command: x')), /lowercase/);
  const deps = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-deps-'));
  fs.mkdirSync(path.join(deps, 'a'));
  fs.writeFileSync(path.join(deps, 'a', 'module.yaml'), 'api_version: 1\nrequires: [ghost]\nrun:\n  command: x');
  assert.throws(() => discoverModules([deps]), /requires ghost/);
});

await t('MCP 工具名 ↔ rpc 名', () => {
  assert.equal(mcpToolName('pure-walker.leave_scene'), 'pure-walker__leave_scene');
  assert.equal(rpcNameFromTool('pure-walker__leave_scene'), 'pure-walker.leave_scene');
  assert.equal(rpcNameFromTool('observe'), null);
});

// ---- 真实子进程 ----------------------------------------------------------------------
const sent = [];
let ran = 0;
let changedCount = 0;
const fakeL0 = {
  async send(cmsg, meta) {
    sent.push({ cmsg, via: meta?.via });
    return { reply: { op: 'SMSG_ACK', seq: cmsg.seq, note: 'moved 1' }, events: [{ op: 'SMSG_PLAYER_UPDATE', gx: 1, gy: 2, facing: cmsg.dir }, { op: 'SMSG_MODE', mode: 'control' }] };
  },
  clock: () => ({ tick: 42, vt: 1.5 }),
  helloSnapshot: () => [{ op: 'SMSG_HELLO', version: 1, layer: 'pure' }, { op: 'SMSG_SCENE_ENTER', scene: 7, gx: 10, gy: 20, facing: 'down', objects: [] }]
};
const loader = await loadModules([root], {
  log: () => {},
  session: async () => ({ l0: fakeL0, run: (fn) => { ran++; return fn(); } }),
  getHello: async () => fakeL0.helloSnapshot(),
  onChanged: () => { changedCount++; }
});

await t('加载:两个模块,模块方法注册成 MCP 工具', () => {
  assert.deepEqual(loader.names(), ['world-model', 'walker']);
  assert.deepEqual(loader.tools().map((x) => x.name), ['world-model__seen', 'walker__go', 'walker__ask']);
});

await t('SendMessage:经会话串行队列;回复前 packet 已投完(慢处理也等);GetClock', async () => {
  const r = await loader.invoke('walker.go', { dir: 'left' });
  assert.deepEqual(r.reply, { op: 'SMSG_ACK', seq: 5, note: 'moved 1' });
  assert.deepEqual(r.player, { op: 'SMSG_PLAYER_UPDATE', gx: 1, gy: 2, facing: 'left' }, 'packet handler must finish before SendMessage returns');
  assert.deepEqual(r.clock, { tick: 42, vt: 1.5 });
  assert.deepEqual(sent, [{ cmsg: { op: 'CMSG_MOVE', dir: 'left', seq: 5 }, via: 'walker' }]);
  assert.equal(ran, 1);
});

await t('packet 订阅:"*" 按顺序收到全部(含 ACK);外部 deliver 也到', async () => {
  await loader.deliver([{ op: 'SMSG_DIALOG', speaker: null, text: 'hi' }]);
  const seen = await loader.invoke('world-model.seen');
  assert.deepEqual(seen, ['SMSG_ACK', 'SMSG_PLAYER_UPDATE', 'SMSG_MODE', 'SMSG_DIALOG']);
});

await t('InvokeModule:模块调另一个模块', async () => {
  const seen = await loader.invoke('walker.ask');
  assert.ok(Array.isArray(seen) && seen.includes('SMSG_DIALOG'));
});

await t('调不存在的方法 / 模块报错', async () => {
  await assert.rejects(() => loader.invoke('walker.nope'), /no method nope/);
  await assert.rejects(() => loader.invoke('ghost.go'), /no module named ghost/);
});

await t('热加载(reload):动态挂载新模块目录 + 自动补发 HELLO 快照 + 改代码自动检测热重载', async () => {
  const extraRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-extra-'));
  const scoutDir = path.join(extraRoot, 'scout');
  fs.mkdirSync(scoutDir, { recursive: true });
  fs.writeFileSync(path.join(scoutDir, 'module.yaml'), `api_version: 1
description: runtime hot-loaded module
run:
  command: node index.mjs
rpc:
  status: status
packets:
  SMSG_SCENE_ENTER: onScene
`);
  fs.writeFileSync(path.join(scoutDir, 'index.mjs'), `import { startModule } from ${JSON.stringify(sdk)};
let scene = null;
await startModule({
  onScene: (m) => { scene = m.scene; },
  status: () => ({ v: 1, scene })
});
`);
  // 1) 直接挂载单个模块目录 scoutDir
  const r1 = await loader.reload({ dir: scoutDir });
  assert.deepEqual(r1.added, ['scout']);
  assert.ok(loader.names().includes('scout'));
  assert.ok(loader.tools().some((x) => x.name === 'scout__status'));
  assert.equal(changedCount, 1);
  // 热加载模块应当收到 getHello() 补发的 SMSG_SCENE_ENTER (scene=7)
  const st1 = await loader.invoke('scout.status');
  assert.deepEqual(st1, { v: 1, scene: 7 });

  // 2) 修改 scout/index.mjs 后不传 name 调用 reload(),指纹对比自动重启被改动的模块,不动其它模块
  fs.writeFileSync(path.join(scoutDir, 'index.mjs'), `import { startModule } from ${JSON.stringify(sdk)};
let scene = null;
await startModule({
  onScene: (m) => { scene = m.scene; },
  status: () => ({ v: 2, scene })
});
`);
  const r2 = await loader.reload({});
  assert.deepEqual(r2.reloaded, ['scout']);
  const st2 = await loader.invoke('scout.status');
  assert.deepEqual(st2, { v: 2, scene: 7 });
  // world-model 没被重启,之前的 seen 记录还在
  const seen = await loader.invoke('world-model.seen');
  assert.ok(seen.includes('SMSG_DIALOG'));
});

await t('run_code(CodeRunner):内联脚本执行 L0、跨调用 global 持久化、动态注册 MCP 工具与超时中断', async () => {
  let toolsChanged = 0;
  const runner = createCodeRunner({
    getSession: async () => ({ l0: fakeL0, run: (fn) => fn() }),
    getModules: async () => loader,
    onEvents: async (evs) => { await loader.deliver(evs); },
    onToolsChanged: () => { toolsChanged++; }
  });
  await runner.deliver(fakeL0.helloSnapshot());

  // 1) 执行代码访问 pal.world、调 L0 step、并在 global 上挂辅助函数与状态
  const res1 = await runner.runCode({
    code: `
      global.stepsTaken = (global.stepsTaken || 0) + 1;
      global.stepAndReport = async (dir) => {
        const { reply } = await pal.step(dir, 1);
        return { note: reply.note, pos: { gx: pal.world.gx, gy: pal.world.gy, facing: pal.world.facing }, scene: pal.world.scene };
      };
      console.log('scene is', pal.world.scene);
      return await global.stepAndReport('right');
    `
  });
  assert.equal(res1.ok, true);
  assert.deepEqual(res1.result, { note: 'moved 1', pos: { gx: 1, gy: 2, facing: 'right' }, scene: 7 });
  assert.deepEqual(res1.logs, ['scene is 7']);
  assert.equal(sent.at(-1).via, 'run_code');

  // 2) 第二次调用复用 global 上的函数 + 动态注册 MCP 工具 + 调已加载模块
  const res2 = await runner.runCode({
    code: `
      pal.registerTool('custom_ping', {
        description: 'custom tool registered at runtime',
        inputSchema: { type: 'object', properties: { msg: { type: 'string' } } }
      }, async ({ msg }) => ({ pong: msg, stepsTaken: global.stepsTaken, modStatus: await pal.invoke('scout.status') }));
      return global.stepsTaken;
    `
  });
  assert.equal(res2.ok, true);
  assert.equal(res2.result, 1);
  assert.equal(toolsChanged, 1);
  assert.ok(runner.hasTool('custom_ping'));
  const toolOut = await runner.callTool('custom_ping', { msg: 'hello' });
  assert.deepEqual(JSON.parse(toolOut.content[0].text), { pong: 'hello', stepsTaken: 1, modStatus: { v: 2, scene: 7 } });

  // 3) 超时保护:死循环调 pal.step 在 timeoutMs 后被 RunCodeAbortedError 终止,不会遗留后台僵尸循环
  const res3 = await runner.runCode({
    timeoutMs: 30,
    code: `
      while (true) {
        await new Promise((r) => setTimeout(r, 15));
        await pal.step('up', 1);
      }
    `
  });
  assert.equal(res3.ok, false);
  assert.match(res3.error, /timed out/);
  const sentAfterTimeout = sent.length;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, sentAfterTimeout, 'aborted run_code must not keep sending L0 messages in background');
});

await t('quit:before_quit 被调用,子进程结束', async () => {
  await loader.quit();
  assert.equal(fs.readFileSync(quitMark, 'utf8'), 'bye');
});

process.stdout.write(`\nMODULE TESTS PASSED ✅ (${n})\n`);
process.exit(0);
