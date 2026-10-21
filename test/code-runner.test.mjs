/**
 * code-runner 单元测试:验证 `--pure` 模式下的运行时自写代码 (run_code)、
 * L0 协议世界模型更新、跨调用 global 持久化、动态 MCP 工具注册、packet 监听与超时中断防护。
 */
import assert from 'node:assert/strict';
import { createCodeRunner } from '../src/code-runner.mjs';

let n = 0;
const t = async (name, fn) => { await fn(); n++; process.stdout.write(`  ✓ ${name}\n`); };

const sent = [];
let toolsChanged = 0;
const fakeL0 = {
  async send(cmsg, meta) {
    sent.push({ cmsg, via: meta?.via });
    return {
      reply: { op: 'SMSG_ACK', seq: cmsg.seq, note: 'moved 1' },
      events: [
        { op: 'SMSG_PLAYER_UPDATE', gx: 11, gy: 22, facing: cmsg.dir || 'down' },
        { op: 'SMSG_MODE', mode: 'control' }
      ]
    };
  },
  clock: () => ({ tick: 42, vt: 1.5 }),
  helloSnapshot: () => [
    { op: 'SMSG_HELLO', version: 1, mode: 'lockstep', layer: 'pure', seed: 1 },
    { op: 'SMSG_SCENE_ENTER', scene: 7, map: 3, player: { gx: 10, gy: 20, facing: 'down' }, objects: [{ id: 9, gx: 12, gy: 20, kind: 'npc', blocking: true }] },
    { op: 'SMSG_PARTY_UPDATE', members: [{ roleId: 0, name: '李逍遙', level: 1, hp: 150, maxHp: 150, mp: 100, maxMp: 100 }] },
    { op: 'SMSG_INVENTORY_UPDATE', items: [{ id: 101, name: '止血草', amount: 3 }], cash: 500 },
    { op: 'SMSG_MODE', mode: 'control' }
  ]
};

const fakeModules = {
  names: () => ['mock-mod'],
  invoke: async (method, params) => ({ method, params, ok: true }),
  reload: async (opts) => ({ added: [opts?.dir || 'reloaded'], reloaded: [], removed: [] })
};

const runner = createCodeRunner({
  getSession: async () => ({ l0: fakeL0, run: (fn) => fn() }),
  getModules: async () => fakeModules,
  onToolsChanged: () => { toolsChanged++; }
});

await runner.deliver(fakeL0.helloSnapshot());

await t('1. SMSG 快照构建 pal.world + 执行内联代码发 L0 指令 + global 持久化', async () => {
  const res = await runner.runCode({
    code: `
      global.stepsTaken = (global.stepsTaken || 0) + 1;
      global.stepAndReport = async (dir) => {
        const { reply } = await pal.step(dir, 1);
        return {
          note: reply.note,
          pos: { gx: pal.world.gx, gy: pal.world.gy, facing: pal.world.facing },
          scene: pal.world.scene,
          cash: pal.world.cash,
          npcCount: pal.world.objectList.length
        };
      };
      console.log('scene is', pal.world.scene);
      return await global.stepAndReport('right');
    `
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.result, {
    note: 'moved 1',
    pos: { gx: 11, gy: 22, facing: 'right' },
    scene: 7,
    cash: 500,
    npcCount: 1
  });
  assert.deepEqual(res.logs, ['scene is 7']);
  assert.equal(sent.at(-1).via, 'run_code');
});

await t('2. 跨 run_code 调用复用 global 函数 + 动态注册自定义 MCP 工具 (pal.registerTool)', async () => {
  const res = await runner.runCode({
    code: `
      pal.registerTool('custom_ping', {
        description: 'custom tool registered at runtime',
        inputSchema: { type: 'object', properties: { msg: { type: 'string' } } }
      }, async ({ msg }) => ({
        pong: msg,
        stepsTaken: global.stepsTaken,
        modOut: await pal.invoke('mock-mod.hello', { x: 1 })
      }));
      return global.stepsTaken;
    `
  });
  assert.equal(res.ok, true);
  assert.equal(res.result, 1);
  assert.equal(toolsChanged, 1);
  assert.ok(runner.hasTool('custom_ping'));
  const toolOut = await runner.callTool('custom_ping', { msg: 'argon' });
  assert.deepEqual(JSON.parse(toolOut.content[0].text), {
    pong: 'argon',
    stepsTaken: 1,
    modOut: { method: 'mock-mod.hello', params: { x: 1 }, ok: true }
  });
});

await t('3. 持久 packet 监听器 (pal.on / pal.off) 跨调用接收 SMSG 事件', async () => {
  await runner.runCode({
    code: `
      global.dialogs = [];
      global.unsub = pal.on('SMSG_DIALOG', (ev) => { global.dialogs.push(ev.text); });
    `
  });
  await runner.deliver([{ op: 'SMSG_DIALOG', speaker: '嬸嬸', text: '逍遙起床啦!' }]);
  const res = await runner.runCode({
    code: `
      global.unsub();
      return global.dialogs;
    `
  });
  assert.deepEqual(res.result, ['嬸嬸: 逍遙起床啦!'.replace('嬸嬸: ', '')]);
  await runner.deliver([{ op: 'SMSG_DIALOG', speaker: null, text: 'after unsub' }]);
  const resAfter = await runner.runCode({ code: `return global.dialogs;` });
  assert.equal(resAfter.result.length, 1);
});

await t('4. 超时与残留循环防护 (RunCodeAbortedError): 超时后后台循环不再发出任何 L0 指令', async () => {
  const res = await runner.runCode({
    timeoutMs: 30,
    code: `
      while (true) {
        await pal.sleep(15);
        await pal.step('up', 1);
      }
    `
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /timed out/);
  const sentCountAtTimeout = sent.length;
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(sent.length, sentCountAtTimeout, 'aborted run_code must not keep sending L0 messages in background');
});

await t('5. pal.readData / pal.ensureDataDump: 按需读取静态表并拦截越界路径', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-data-'));
  fs.writeFileSync(path.join(tmpData, 'manifest.json'), JSON.stringify({ version: 1, counts: { scenes: 1 } }));
  fs.writeFileSync(path.join(tmpData, 'scenes.json'), JSON.stringify([{ id: 7, name: '客栈' }]));
  process.env.AGENT_PAL_DATA_DIR = tmpData;

  const r1 = await runner.runCode({
    code: `
      const scenes = await pal.readData('scenes.json');
      return { dir: pal.dataDir, first: scenes[0] };
    `
  });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.result, { dir: tmpData, first: { id: 7, name: '客栈' } });

  const r2 = await runner.runCode({
    code: `return await pal.readData('../outside.json');`
  });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /stay inside dataDir/);
});

await t('6. runner.abortActive: 真人按键接管时立即中止正在运行的 run_code 脚本', async () => {
  const p = runner.runCode({
    code: `
      await pal.step('down');
      await new Promise((r) => setTimeout(r, 30));
      await pal.step('down');
      return 'should not reach';
    `
  });
  await new Promise((r) => setTimeout(r, 10));
  const aborted = runner.abortActive('human player took over in browser');
  assert.equal(aborted, 1);
  const res = await p;
  assert.equal(res.ok, false);
  assert.match(res.error, /human player took over in browser/);
});

process.stdout.write(`\nCODE-RUNNER TESTS PASSED ✅ (${n})\n`);
process.exit(0);
