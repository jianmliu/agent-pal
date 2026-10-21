#!/usr/bin/env node
/**
 * 把 AI 的「想法」转给 pal-host 直播(观战页侧栏的主体)。
 *
 * MCP 服务端只收得到工具调用,看不到模型在两次调用之间写的话;跑 AI 的一端看得到。
 * 本脚本读 Claude Code 的 stream-json 输出,取出 assistant 消息里的文字块,POST 到 host 的 /live/thought。
 * 原始输出原样转到 stdout(当 tee 用,日志照记)。
 *
 *   claude -p "$(cat apps/agent-pal/play-prompt.txt)" --mcp-config live.json --strict-mcp-config \
 *     --allowedTools "mcp__pal__*" --output-format stream-json --verbose \
 *     | node apps/agent-pal/scripts/live-narrate.mjs --port 8090 > run.jsonl
 *
 *   --port N   pal-host 端口(默认 8090)
 *   --text     stdin 每行就是一段想法(给别的驱动用),不解析 stream-json
 *   --quiet    不转发原始输出
 */
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const port = Number(flag('--port', 8090));
const plain = argv.includes('--text'), quiet = argv.includes('--quiet');
const url = `http://127.0.0.1:${port}/live/thought`;

/** stream-json 的一行 → 这一轮模型写的文字(没有就空串) */
export function textOf(line) {
  let m; try { m = JSON.parse(line); } catch { return ''; }
  if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) return '';
  return m.message.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text.trim()).filter(Boolean).join('\n\n');
}

let warned = false;
async function post(text) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (err) {
    if (!warned) { process.stderr.write(`[live-narrate] ${url}: ${err.message}(pal-host 没开 --host?之后的失败不再提示)\n`); warned = true; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let queue = Promise.resolve();                      // 按顺序发,不乱序
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!quiet) process.stdout.write(line + '\n');
    const text = plain ? line.trim() : textOf(line);
    if (text) queue = queue.then(() => post(text));
  });
  rl.on('close', () => { queue.then(() => process.exit(0)); });
}
