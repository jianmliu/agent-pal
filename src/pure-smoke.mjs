/**
 * pure-smoke — M0b 验收(docs/specs/agent-pal.md §7),经真实的 MCP stdio 入口(bin/agent-pal.mjs)跑:
 *  1. --assist:工具面与 MVP 相同(只多一个 session_quit)—— 「--assist 下 MVP 现有行为不退化」的工具面部分
 *     (行为部分由 golden verify / bench check 覆盖)。
 *  2. --pure + modules/pure-walker:工具面只有 L0 + session_quit + 模块方法;L1 工具被拒;
 *     只用 L0 工具开新游戏推完开场,再让模块只靠 L0 走到第一次场景切换;session_quit 走 before_quit 后退出。
 *
 *   node apps/agent-pal/src/pure-smoke.mjs [--skip-if-no-assets]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, '..', 'bin', 'agent-pal.mjs');
const modulesDir = path.resolve(here, '..', 'modules');
const say = (s) => process.stderr.write(s + '\n');

const assets = [process.env.PAL_ASSET_DIR, path.resolve(here, '../pal-assets'), path.resolve(here, '../../pal-playground/public/pal-assets')].filter(Boolean);
if (!assets.some((d) => fs.existsSync(path.join(d, 'PAT.MKF')) || fs.existsSync(path.join(d, 'pat.mkf')))) {
  say('pure-smoke: PAL assets not found');
  if (process.argv.includes('--skip-if-no-assets')) { say('pure-smoke: skipped'); process.exit(0); }
  process.exit(1);
}
if (!fs.existsSync(path.resolve(here, '../node_modules/@onchainpal/game-engine/dist/index.js'))) {
  say('pure-smoke: build game-engine first (pnpm --filter @onchainpal/game-engine build)');
  process.exit(1);
}

/** 起一个 agent-pal MCP 子进程,返回 { call(method, params), tool(name, args), exited, kill }。 */
function startServer(args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-pure-'));
  const child = spawn(process.execPath, [bin, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AGENT_PAL_SAVES: path.join(tmp, 'saves.json'), AGENT_PAL_RUNS: path.join(tmp, 'runs'), AGENT_PAL_MEMORY: '' }
  });
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(String(d)));
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);              // stdout 上只许有协议帧:解析不了就是被污染了,直接炸
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    }
  });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = async (name, args = {}) => {
    const r = await call('tools/call', { name, arguments: args });
    return { text: r.content.map((c) => c.text || '').join('\n'), isError: !!r.isError };
  };
  return { call, tool, exited, kill: () => child.kill(), stderr: () => stderr.join(''), tmp };
}

const modeOf = (text) => [...text.matchAll(/"op":"SMSG_MODE","mode":"(\w+)"/g)].pop()?.[1] ?? null;

// ---- 1. --assist:工具面 = MVP + session_quit -----------------------------------------
{
  const s = startServer(['--assist']);
  await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pure-smoke', version: '0' } });
  const names = (await s.call('tools/list', {})).tools.map((t) => t.name);
  const MVP = ['observe', 'screenshot', 'walk_to', 'step', 'interact', 'search', 'advance', 'choose', 'use_item', 'equip', 'save', 'load', 'guide', 'atlas', 'panorama', 'map', 'cast', 'grind', 'list_saves', 'battle', 'press', 'wait'];
  assert.deepEqual(names, [...MVP, 'session_quit'], 'assist tool surface must equal the MVP (plus session_quit)');
  say('✓ --assist: tool surface = MVP (18) + session_quit');
  s.kill();
  await s.exited;
}

// ---- 2. --pure + pure-walker -----------------------------------------------------------
const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pal-pure-data-')), 'pal-data');   // nav 要 data dump:启动时自动导到这里
const s = startServer(['--pure', '--seed', '1', '--modules', modulesDir, '--data', dataDir]);
const t0 = Date.now();
try {
  const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pure-smoke', version: '0' } });
  assert.match(init.instructions, /--pure/);
  const names = (await s.call('tools/list', {})).tools.map((t) => t.name);
  for (const l0 of ['observe', 'step', 'search', 'advance', 'choose', 'battle', 'use_item', 'press', 'wait', 'save', 'load', 'list_saves', 'run_code', 'module_reload', 'session_quit', 'pure-walker__leave_scene', 'pure-walker__model', 'nav__walk_to', 'nav__interact', 'nav__use_item', 'nav__view']) {
    assert.ok(names.includes(l0), `pure tool surface is missing ${l0}`);
  }
  for (const l1 of ['walk_to', 'interact', 'screenshot', 'guide', 'atlas', 'map', 'panorama']) assert.ok(!names.includes(l1), `L1 tool ${l1} leaked into --pure`);
  say(`✓ --pure: ${names.length} tools, no L1 (${names.join(' ')})`);

  const refused = await s.tool('walk_to', { x: 1, y: 1 });
  assert.ok(refused.isError && /not available in --pure/.test(refused.text));
  say('✓ --pure: L1 tools are refused');

  let obs = await s.tool('observe');
  assert.equal(modeOf(obs.text), 'menu', 'title screen should be a menu');
  assert.match(obs.text, /新的故事/);
  const badMove = await s.tool('step', { direction: 'up' });
  assert.match(badMove.text, /^REJECT wrong_mode/);
  say('✓ title: SMSG_CHOICE 新的故事 / 舊的回憶; MOVE in a menu → REJECT wrong_mode');

  const chose = await s.tool('choose', { index: 0 });
  assert.match(chose.text, /^ACK/);
  assert.match(chose.text, /SMSG_SCENE_ENTER/);
  for (let i = 0; i < 10; i++) {
    const m = modeOf((await s.tool('observe')).text);
    if (m === 'control') break;
    if (m === 'dialog') await s.tool('advance', { max: 200 });
    else await s.tool('wait', { ms: 1000 });
  }
  obs = await s.tool('observe');
  assert.equal(modeOf(obs.text), 'control', 'should have walking control after the opening');
  const scene0 = Number(obs.text.match(/"op":"SMSG_SCENE_ENTER","scene":(\d+)/)[1]);
  say(`✓ new game via L0 only: control in scene ${scene0}`);

  // 官方 L1 模块 nav:只靠 L0 + data dump 复现 MVP 的 interact / walk_to(同 bench 参考解开头那几步)
  const talk = JSON.parse((await s.tool('nav__interact', { id: 9 })).text);
  assert.equal(talk.ok, true, `nav interact failed: ${talk.note}`);
  assert.match(talk.note, /mode now dialog/);
  await s.tool('advance', { max: 200 });
  const map = (await s.tool('nav__view')).text;
  assert.match(map, /@/);
  assert.match(map, /id=9 /);
  const out = JSON.parse((await s.tool('nav__walk_to', { x: 60, y: 52 })).text);
  assert.equal(out.ok, true, `nav walk_to failed: ${out.note}`);
  assert.match(out.note, /entered a new area/, 'walking to the doorway should leave the inn');
  obs = await s.tool('observe');
  const scene1 = Number(obs.text.match(/"op":"SMSG_SCENE_ENTER","scene":(\d+)/)[1]);
  assert.notEqual(scene1, scene0);
  say(`✓ nav (L1 as a module): interact 9 → dialog; view shows the map; walk_to (60,52) → scene ${scene0} → ${scene1}`);
  const scene0b = scene1;

  const walked = await s.tool('pure-walker__leave_scene', { maxMoves: 1500 });
  const r = JSON.parse(walked.text);
  say(`  pure-walker: ${walked.text.replace(/\s+/g, ' ')}`);
  assert.equal(r.ok, true, `pure-walker did not leave scene ${scene0b}: ${r.note}`);
  assert.notEqual(r.to, scene0b);
  obs = await s.tool('observe');
  assert.match(obs.text, new RegExp(`"op":"SMSG_SCENE_ENTER","scene":${r.to}\\b`), 'session state must agree with the module');
  say(`✓ pure-walker left scene ${r.from} → ${r.to} with L0 only (${r.moves} moves, ${r.bumps} bumps)`);

  // 第二段:不许走回来时的门,要在没有障碍数据的情况下撞墙学路(确定性种子下结果固定)
  const leg2 = JSON.parse((await s.tool('pure-walker__leave_scene', { maxMoves: 1500 })).text);
  say(`  pure-walker leg 2: ${JSON.stringify(leg2)}`);
  assert.equal(leg2.ok, true, `second leg failed: ${leg2.note}`);
  assert.ok(r.bumps + leg2.bumps > 0, 'the walker should have had to learn walls from REJECT blocked');
  say(`✓ leg 2: ${leg2.from} → ${leg2.to}; walls learned from REJECT blocked: ${r.bumps + leg2.bumps}`);

  // 运行时自写代码 (run_code) + 动态注册工具 + 热加载模块 (module_reload)
  const rc1 = JSON.parse((await s.tool('run_code', {
    code: `
      global.visited = (global.visited || []).concat(pal.world.scene);
      pal.registerTool('custom_where', { description: 'report current scene from run_code' }, async () => ({
        scene: pal.world.scene, visited: global.visited
      }));
      return { scene: pal.world.scene, mode: pal.world.mode };
    `
  })).text);
  assert.equal(rc1.ok, true, `run_code failed: ${rc1.error}`);
  assert.equal(rc1.result.scene, leg2.to);
  const customOut = JSON.parse((await s.tool('custom_where')).text);
  assert.deepEqual(customOut, { scene: leg2.to, visited: [leg2.to] });
  const dynModDir = path.join(s.tmp, 'dyn-probe');
  fs.mkdirSync(dynModDir, { recursive: true });
  const sdkPath = path.resolve(here, 'module-sdk.mjs');
  fs.writeFileSync(path.join(dynModDir, 'module.yaml'), `api_version: 1\ndescription: hot-loaded probe\nrun:\n  command: node index.mjs\nrpc:\n  ping: ping\npackets:\n  SMSG_SCENE_ENTER: onScene\n`);
  fs.writeFileSync(path.join(dynModDir, 'index.mjs'), `import { startModule } from ${JSON.stringify(sdkPath)};\nlet scene = null;\nawait startModule({ onScene: (m) => { scene = m.scene; }, ping: () => ({ ok: true, scene }) });\n`);
  const reloaded = JSON.parse((await s.tool('module_reload', { dir: dynModDir })).text);
  assert.deepEqual(reloaded.added, ['dyn-probe']);
  const probeOut = JSON.parse((await s.tool('dyn-probe__ping')).text);
  assert.deepEqual(probeOut, { ok: true, scene: leg2.to });
  say(`✓ run_code & module_reload: live world state (scene ${leg2.to}), custom tool registered, dyn-probe hot-loaded & hydrated`);

  // runs/ 日志:模块发的指令按普通工具调用记(via=pure-walker),from-run 能重放
  const runDir = path.join(s.tmp, 'runs');
  const log = fs.readdirSync(runDir).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(runDir, f), 'utf8')).join('');
  const calls = log.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === 'call');
  assert.ok(calls.some((c) => c.via === 'pure-walker' && c.name === 'step'), 'module moves should be logged as step calls');
  say(`✓ runs/ log: ${calls.length} replayable calls (${calls.filter((c) => c.via).length} from the module)`);

  await s.tool('session_quit');
  const code = await Promise.race([s.exited, new Promise((res) => setTimeout(() => res('timeout'), 10000))]);
  assert.equal(code, 0, 'session_quit should exit 0');
  assert.match(s.stderr(), /pure-walker: bye/, 'before_quit hook should have run');
  say('✓ session_quit: before_quit ran, exit 0');
  say(`\nPURE SMOKE PASSED ✅ (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} catch (err) {
  say(String(err?.stack || err));
  say('--- agent-pal stderr (tail) ---\n' + s.stderr().split('\n').slice(-40).join('\n'));
  s.kill();
  process.exit(1);
}
