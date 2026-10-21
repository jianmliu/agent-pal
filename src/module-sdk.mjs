/**
 * module-sdk — 写 agent-pal 模块用的最小 Node 库(§5.2)。模块可以用任何语言写,只要会在 Unix socket 上
 * 说换行分隔的 JSON-RPC 2.0;这只是 TS/Node 模板的那一半。
 *
 *   import { startModule } from '<agent-pal>/src/module-sdk.mjs';
 *   const session = await startModule({
 *     goto: async ({ x, y }) => { ... await session.send({ op: 'CMSG_MOVE', dir: 'up' }) ... },   // rpc 方法
 *     onSceneEnter: (msg) => { ... }                                                             // packet 处理
 *   });
 *
 * handlers 的键 = module.yaml 里 rpc / packets / lifecycle 映射到的函数名。
 */
import net from 'node:net';
import fs from 'node:fs';
import { rpcPeer } from './rpc.mjs';

/**
 * 在 AGENT_PAL_MODULE_SOCKET 上监听(会话来调 handlers),并连上 AGENT_PAL_SESSION_SOCKET(调会话 API)。
 * @returns {Promise<{ send: (cmsg: object) => Promise<{reply: object, events: object[]}>, clock: () => Promise<{tick: number, vt: number|null}>, invoke: (method: string, params?: object) => Promise<any>, name: string }>}
 */
export async function startModule(handlers = {}) {
  const moduleSock = process.env.AGENT_PAL_MODULE_SOCKET;
  const sessionSock = process.env.AGENT_PAL_SESSION_SOCKET;
  if (!moduleSock || !sessionSock) throw new Error('not started by agent-pal: AGENT_PAL_MODULE_SOCKET / AGENT_PAL_SESSION_SOCKET are missing');

  const session = await new Promise((resolve, reject) => {
    const s = net.connect(sessionSock);
    s.once('connect', () => resolve(rpcPeer(s, {})));
    s.once('error', reject);
    s.on('close', () => process.exit(0));            // 会话关了(agent-pal 退出)就跟着退,别留孤儿进程
  });

  try { fs.unlinkSync(moduleSock); } catch { /* 不存在 */ }
  const server = net.createServer((sock) => rpcPeer(sock, handlers));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(moduleSock, resolve); });

  return {
    name: process.env.AGENT_PAL_MODULE_NAME,
    send: (cmsg) => session.call('SendMessage', cmsg),
    clock: () => session.call('GetClock', {}),
    invoke: (method, params = {}) => session.call('InvokeModule', { method, params })
  };
}
