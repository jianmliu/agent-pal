#!/usr/bin/env node
/**
 * mcp-episode — 外部 agent 通道(spec §7.2):把一局 episode 包成 MCP 服务,给 claude -p 等客户端玩。
 * 判分、预算、日志与内置循环同一套(episode.mjs);token / 成本由 runner 从客户端自己的输出里取。
 *
 *   BENCH_EPISODE='{"taskId":…,"seed":…,"tier":"B","logFile":…,"resultFile":…}' node mcp-episode.mjs [--http]
 *
 * --http(bench run 用):先开机到起点,再在 127.0.0.1 随机端口起 MCP Streamable HTTP(只回 JSON,不开 SSE),
 *   stdout 打一行 {"url","intro"} —— runner 把提示 + 开局观察作为第一条用户消息交给客户端,
 *   与内置循环逐字相同,也不靠客户端是否转述 MCP instructions。
 * 默认 stdio:任意 MCP 客户端可直接挂;开局观察放进 initialize 的 instructions。
 *
 * 一局结束(成功 / 预算 / 卡死…)后结果写到 resultFile,工具再调只会得到「已结束」;
 * stdio 模式随后退出,HTTP 模式等 runner 收尾(SIGTERM)。
 */
import readline from 'node:readline';
import http from 'node:http';
import fs from 'node:fs';
import { createEpisode, toolContent } from './episode.mjs';
import { loadTask } from './task.mjs';
import { systemPrompt, firstMessage } from './prompt.mjs';

const job = JSON.parse(process.env.BENCH_EPISODE);
const httpMode = process.argv.includes('--http');
const task = loadTask(job.taskId);
let episodeP = null;
const getEpisode = () => (episodeP ??= createEpisode({ task, seed: job.seed, tier: job.tier, logFile: job.logFile, meta: job.meta || {} }));
let finished = false;
async function finish(reason) {
  if (finished || !episodeP) return;
  finished = true;
  const ep = await episodeP;
  fs.writeFileSync(job.resultFile, JSON.stringify(ep.finish(reason)));
}

/** 处理一条 JSON-RPC 消息;通知返回 null。 */
async function handle(msg) {
  const { id, method, params } = msg;
  const isReq = id !== undefined && id !== null;
  const ok = (result) => (isReq ? { jsonrpc: '2.0', id, result } : null);
  try {
    if (method === 'initialize') {
      const ep = await getEpisode();
      return ok({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'palbench', version: '0.1.0' },
        ...(httpMode ? {} : { instructions: `${systemPrompt(job.tier)}\n\n${firstMessage(task, ep.intro)}` })
      });
    }
    if (method?.startsWith('notifications/')) return null;
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: (await getEpisode()).tools });
    if (method === 'tools/call') {
      const ep = await getEpisode();
      const r = await ep.call(params?.name, params?.arguments || {});
      if (r.done) await finish();
      return ok({ content: toolContent(r), isError: r.isError });
    }
    return isReq ? { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } } : null;
  } catch (err) {
    return ok({ content: [{ type: 'text', text: 'error: ' + (err?.message || err) }], isError: true });
  }
}

// 引擎全局状态:所有消息串行处理
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

// 不用 setTimeout:确定性模式下引擎把计时器接到虚拟时钟上,没人推进就永远不触发
const shutdown = (reason) => { finish(reason).finally(() => process.exit(0)); };
process.removeAllListeners('SIGINT');
process.removeAllListeners('SIGTERM');
process.on('SIGINT', () => shutdown('agent-stopped'));   // runner:客户端自己结束了
process.on('SIGTERM', () => shutdown('wall-timeout'));   // runner:墙钟到点

if (httpMode) {
  const ep = await getEpisode();
  if (process.env.BENCH_REPLAY_PREFIX && fs.existsSync(process.env.BENCH_REPLAY_PREFIX)) {
    const lines = fs.readFileSync(process.env.BENCH_REPLAY_PREFIX, 'utf8').trim().split('\n').filter(Boolean);
    let lastR = null;
    for (const line of lines) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.type === 'call') lastR = await ep.call(row.name, row.args || {});
    }
    if (lastR) {
      const obsText = toolContent(lastR).map((c) => c.text || '').join('\n');
      const nCalls = lines.filter((l) => l.includes('"type":"call"')).length;
      const note = process.env.BENCH_REPLAY_NOTE || `已完成前 ${nCalls} 步`;
      ep.intro = `[状态续接:${note}]\n${obsText}`;
    }
  }
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const msgs = Array.isArray(msg) ? msg : [msg];
      const out = (await Promise.all(msgs.map((m) => serial(() => handle(m))))).filter(Boolean);
      if (!out.length) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(msg) ? out : out[0]));
    });
  });
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/mcp`, intro: ep.intro }) + '\n');
  });
} else {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    serial(() => handle(msg)).then((r) => { if (r) process.stdout.write(JSON.stringify(r) + '\n'); });
  });
  rl.on('close', () => shutdown('agent-stopped'));
}
