/**
 * Headless smoke for PalServerClient — runs the real client (global WebSocket,
 * Node ≥22) against a 30-line mock PAL server: hello → welcome → dialog
 * perception → say/npcState dispatch → fatal error stops reconnect →
 * reconnect-with-backoff after a server restart.
 * Run: pnpm --filter @onchainpal/game-engine test:ws-client
 */
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { WebSocketServer } from 'ws';
import {
  PAL_PROTOCOL_VERSION, parseClientMsg, serialize, type ServerMsg
} from '@onchainpal/shared';
import { PalServerClient } from '../ai/pal-server-client';

function mockServer(port: number, opts: { rejectAuth?: boolean } = {}) {
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/pal' });
  const sends: ServerMsg[] = [
    { type: 'welcome', v: PAL_PROTOCOL_VERSION, playerId: 'player:测试', npcs: [{ id: 'npc:azhu', name: '阿珠', room: 'scene:4', balanceGcc: 0.01, pal: { sceneId: 4, eventId: 88 } }] }
  ];
  wss.on('connection', (ws) => {
    ws.on('message', (d) => {
      const m = parseClientMsg(String(d));
      if (!m) return;
      if (m.type === 'hello') {
        if (opts.rejectAuth) { ws.send(serialize({ type: 'error', code: 'auth', message: 'nope', fatal: true })); ws.close(); return; }
        ws.send(serialize(sends[0]));
      }
      if (m.type === 'perception' && m.kind === 'dialog') {
        if (m.npcId === 'npc:碧玄子') {
          // menu NPC: first dialog opens the menu; '1' steps it with a result
          if (m.text === '1') {
            ws.send(serialize({ type: 'menuResult', npcId: m.npcId, output: ['全表如下…'], exit: false }));
          } else {
            ws.send(serialize({ type: 'menu', npcId: m.npcId, npcName: '碧玄子', title: '定价问询', body: ['行情'], actions: [{ key: '1', label: '看全表' }] }));
          }
          return;
        }
        ws.send(serialize({ type: 'say', npcId: m.npcId!, text: `回应:${m.text}`, addressing: '客人' }));
        ws.send(serialize({ type: 'npcState', npcId: m.npcId!, affinity: 4, dAffinity: 4, balanceGcc: 0.0097, costGcc: 0.0003 }));
      }
    });
  });
  return new Promise<{ close: () => Promise<void> }>((resolve) => {
    httpServer.listen(port, () => resolve({
      close: () => new Promise((res) => { for (const c of wss.clients) c.terminate(); wss.close(() => httpServer.close(() => res())); })
    }));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for condition');
    await wait(25);
  }
}

async function main() {
  const PORT = 4533;

  // --- happy path: hello → welcome → perception → say + npcState -------------
  let srv = await mockServer(PORT);
  const got: string[] = [];
  let welcomeNpcs = 0, sayText = '', stateAffinity = 0, statuses: string[] = [];
  let menuTitle = '', menuResultLine = '';
  const client = new PalServerClient({
    url: `ws://127.0.0.1:${PORT}/pal`,
    playerId: 'player:测试',
    backoffMinMs: 100, backoffMaxMs: 400,
    onWelcome: (w) => { welcomeNpcs = w.npcs.length; got.push('welcome'); },
    onSay: (s) => { sayText = s.text; got.push('say'); },
    onNpcState: (s) => { stateAffinity = s.affinity ?? 0; got.push('npcState'); },
    onMenu: (m) => { menuTitle = m.title; got.push('menu'); },
    onMenuResult: (m) => { menuResultLine = m.output[0] ?? ''; got.push('menuResult'); },
    onStatus: (s) => statuses.push(s)
  });
  client.connect();
  await until(() => welcomeNpcs === 1);
  assert.ok(client.isOpen, 'client open after welcome');

  client.sendPerception({ kind: 'dialog', npcId: 'npc:azhu', text: '你好' });
  await until(() => got.includes('say') && got.includes('npcState'));
  assert.equal(sayText, '回应:你好', 'say dispatched');
  assert.equal(stateAffinity, 4, 'npcState dispatched');

  // menu NPC: menu + menuResult frames dispatch to their handlers
  client.sendPerception({ kind: 'dialog', npcId: 'npc:碧玄子', text: '你好' });
  await until(() => got.includes('menu'));
  assert.equal(menuTitle, '定价问询', 'menu dispatched');
  client.sendPerception({ kind: 'dialog', npcId: 'npc:碧玄子', text: '1' });
  await until(() => got.includes('menuResult'));
  assert.equal(menuResultLine, '全表如下…', 'menuResult dispatched');

  // --- reconnect: server dies → backoff → server returns → welcome again ------
  await srv.close();
  await until(() => statuses.includes('closed'));
  welcomeNpcs = 0;
  srv = await mockServer(PORT);
  await until(() => welcomeNpcs === 1, 8000);   // re-hello on reconnect
  assert.ok(true, 'reconnected and re-welcomed after server restart');
  client.close();
  await srv.close();

  // --- fatal error stops reconnecting ----------------------------------------
  const srv2 = await mockServer(PORT, { rejectAuth: true });
  let fatalCode = '';
  const statuses2: string[] = [];
  const client2 = new PalServerClient({
    url: `ws://127.0.0.1:${PORT}/pal`, playerId: 'player:测试',
    backoffMinMs: 50, backoffMaxMs: 100,
    onError: (e) => { fatalCode = e.code; },
    onStatus: (s) => statuses2.push(s)
  });
  client2.connect();
  await until(() => fatalCode === 'auth');
  await wait(400); // several backoff windows
  assert.ok(!statuses2.slice(statuses2.indexOf('stopped') + 1).includes('connecting'), 'no reconnect after fatal error');
  client2.close();
  await srv2.close();

  console.log('✓ hello→welcome / perception→say+npcState / menu+menuResult dispatch / reconnect+re-hello after restart / fatal error stops retry');
  console.log('\nPAL-SERVER-CLIENT SMOKE PASSED ✅');
}

main().catch((err) => { console.error('PAL-SERVER-CLIENT SMOKE FAILED ❌', err); process.exit(1); });
