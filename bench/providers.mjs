/**
 * providers — 内置循环的模型适配器(docs/specs/agent-pal-bench.md §7.1)。
 *
 * 统一接口:provider.turn({ system, history, tools }) → { text, calls: [{ id, name, args }], usage: { tokensIn, tokensOut, cacheRead?, cacheWrite? } }
 * (tokensIn = 全部输入 token,含缓存读写;cacheRead / cacheWrite 是其中命中 / 写入缓存的部分)
 * history 里 user / tool 条目可带 image: { mimeType, data(base64) }(A 像素档的画面),各适配器按自家格式附上。
 * history 是中性格式,由适配器各自渲染:
 *   { role: 'user', text, image? } | { role: 'assistant', text, calls } | { role: 'tool', id, name, text, image? }
 *
 * 模型名写作 <provider>:<model>:
 *   ollama:qwen2.5:3b              本地 Ollama(OpenAI 兼容,http://localhost:11434/v1),免钥
 *   openai:<model>                 OpenAI 兼容:BENCH_OPENAI_BASE_URL(默认 https://api.openai.com/v1)+ OPENAI_API_KEY
 *   anthropic:<model>[?context=server]  Anthropic Messages API:ANTHROPIC_API_KEY;BENCH_ANTHROPIC_BASE_URL 可覆盖地址
 *                                  (?context=server:上下文规则由服务端执行、思考块随轮回传,见 anthropic() 的说明)
 *                                  (刻意不读 ANTHROPIC_BASE_URL —— Claude Code 会话里那个是它自己的端点)
 *   gemini:<model>                 Google Gemini API(generateContent):GEMINI_API_KEY;BENCH_GEMINI_BASE_URL 可覆盖地址
 *   replay:<task-id>               不调模型:按参考解逐步出招(验证循环 / 判分链路用,零成本)
 *
 * 价格:prices.json 只放已知价;没有的 cost 记 null,不编数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 退避用 node:timers/promises 而不是全局 setTimeout:种子局把全局计时器换成了虚拟时钟(src/clock.mjs),
// provider 调用又不经 e.drive(),用全局 setTimeout 的话退避永远不触发,一局要挂到墙钟到点被杀。
import { setTimeout as sleep } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRICES = JSON.parse(fs.readFileSync(path.join(here, 'prices.json'), 'utf8'));
/** 每轮输出上限,所有 provider 一致(支持 BENCH_MAX_OUTPUT_TOKENS 覆盖;默认 4096 防止推理模型单轮死循环耗尽墙钟)。 */
const MAX_OUTPUT_TOKENS = Number(process.env.BENCH_MAX_OUTPUT_TOKENS) || 4096;
// Keep usage totals compatible, but distinguish measured counts from absent/malformed values.
const reportedTokens = (value) => Number.isFinite(value) && value >= 0;
const reportedSum = (primary, total, ...optional) => reportedTokens(primary) && reportedTokens(total) && optional.every(value => value === undefined || reportedTokens(value));
const finishReason = (value) => typeof value === 'string' ? value : null;

// 设了这些地址覆盖,请求就发到了别处(代理 / 兼容服务),计费未必等于官方标价 —— 价格记 null,不套官方价
const BASE_URL_OVERRIDE = { openai: 'BENCH_OPENAI_BASE_URL', anthropic: 'BENCH_ANTHROPIC_BASE_URL', gemini: 'BENCH_GEMINI_BASE_URL' };

/**
 * $/Mtok → 一轮的花费;未知价(或地址被覆盖)返回 null。
 * usage.tokensIn 是全部输入(含缓存读写);cacheRead / cacheWrite 按价目表的缓存价算,没登记缓存价的按输入价(上限)。
 */
export function costOf(model, { tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0 }, env = process.env) {
  if (env[BASE_URL_OVERRIDE[model.split(':')[0]]]) return null;
  const key = model.split('?')[0];                      // ?context=server 等选项不影响价格
  const p = PRICES[key] ?? PRICES[key.split(':')[0] + ':*'];
  if (!p) return null;
  const uncached = Math.max(0, tokensIn - cacheRead - cacheWrite);
  return (uncached * p.in + cacheRead * (p.cacheRead ?? p.in) + cacheWrite * (p.cacheWrite ?? p.in) + tokensOut * p.out) / 1e6;
}

export async function postJson(url, body, headers, { retries = 3, baseDelayMs = 2000, signal } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      signal?.throwIfAborted();
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
      const text = await r.text();
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`), { retry: true });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 500)}`);
      return JSON.parse(text);
    } catch (err) {
      signal?.throwIfAborted();
      lastErr = err;
      if (!err.retry && !/fetch failed|ECONNRESET|ETIMEDOUT/.test(String(err))) break;
      if (i < retries) await sleep(baseDelayMs * 2 ** i, undefined, { signal });
    }
  }
  throw lastErr;
}

/** OpenAI Chat Completions(含 Ollama 等兼容端点)。 */
function openaiCompatible({ model, baseUrl, apiKey }) {
  const toMessages = (system, history) => {
    const out = [{ role: 'system', content: system }];
    const dataUrl = (img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
    // tool 消息只能是文字:同一轮工具结果的画面(A 像素档)攒起来,紧跟在这些 tool 消息后面以一条 user 消息附上
    let pending = [];
    const flush = () => {
      if (pending.length) out.push({ role: 'user', content: [{ type: 'text', text: 'Screenshots returned by the tool calls above:' }, ...pending.map(dataUrl)] });
      pending = [];
    };
    for (const h of history) {
      if (h.role !== 'tool') flush();
      if (h.role === 'user') out.push({ role: 'user', content: h.image ? [{ type: 'text', text: h.text }, dataUrl(h.image)] : h.text });
      else if (h.role === 'assistant') out.push({
        role: 'assistant', content: h.text || '',   // Ollama 拒收 null
        ...(h.calls?.length ? { tool_calls: h.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {})
      });
      else if (h.role === 'tool') {
        out.push({ role: 'tool', tool_call_id: h.id, content: h.text });
        if (h.image) pending.push(h.image);
      }
    }
    flush();
    return out;
  };
  return {
    async turn({ system, history, tools, signal }) {
      const body = {
        model,
        messages: toMessages(system, history),
        // 没有工具(闭卷测验)就不带 tools / tool_choice:空数组配 tool_choice 会被部分端点拒绝
        ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })), tool_choice: 'auto' } : {}),
        max_tokens: MAX_OUTPUT_TOKENS        // 小模型会陷入复读死循环(实测 qwen2.5:3b 一轮生成 14k+ token 不停)
      };
      const j = await postJson(`${baseUrl}/chat/completions`, body, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, { signal });
      const msg = j.choices?.[0]?.message || {};
      const calls = (msg.tool_calls || []).map((c, i) => {
        let args = {};
        try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}); } catch { args = { __unparsable: c.function?.arguments }; }
        return { id: c.id || `call_${Date.now()}_${i}`, name: c.function?.name, args };
      });
      // prompt_tokens 已含缓存命中(OpenAI 自动缓存,命中按缓存价)
      return { text: msg.content || '', calls, usageReported: { tokensIn: reportedTokens(j.usage?.prompt_tokens), tokensOut: reportedTokens(j.usage?.completion_tokens) }, finishReason: finishReason(j.choices?.[0]?.finish_reason), usage: { tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0, cacheRead: j.usage?.prompt_tokens_details?.cached_tokens ?? 0 } };
    }
  };
}

/**
 * Anthropic Messages API。
 * 提示缓存:两个显式断点 —— 系统提示(连同其前的工具定义,每轮不变)和最后一条已省略的工具结果
 * (compact 换成占位后不再变;每轮往后挪约 2 个位置,在 20 个位置的回看范围内,能读到上一轮写的缓存)。
 * 不在末尾打断点:末尾那几条全文每轮都会被省略规则改写,写了也读不到,白付 1.25 倍写入费。
 *
 * 默认(anthropic:<model>):上下文由循环在客户端截断,回传时只带文字与工具调用 —— 思考块不回传。
 * 新模型(Opus 5.5、Sonnet 5.5、Fable 5.1 等)思考常开,而思考块绑定它之前的历史:客户端截断会改写历史,
 * 回传思考块会让它失效(新账号直接 400),所以只能丢。
 * anthropic:<model>?context=server:同一条规则改由服务端 context editing(clear_tool_uses)执行 ——
 * 服务端清理不算改历史,历史原样(append-only)回传、思考块随轮保留。此模式只有系统提示一个缓存断点
 * (服务端每轮清掉一条,缓存从清理处往后失效,与客户端截断相同)。模型串带 ?context=server,成绩单列、不与默认混比。
 */
const anthropicImage = (img) => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });

function anthropic({ model, baseUrl, apiKey, serverContext = false }) {
  const toMessages = (history) => {
    const out = [];
    let stable = null;                                   // 最后一条已省略的工具结果块
    const push = (role, block) => {
      const last = out[out.length - 1];
      if (last && last.role === role) last.content.push(block); else out.push({ role, content: [block] });
      return block;
    };
    for (const h of history) {
      if (h.role === 'user') {
        push('user', { type: 'text', text: h.text });
        if (h.image) push('user', anthropicImage(h.image));
      } else if (h.role === 'assistant') {
        if (serverContext && h.raw) { for (const b of h.raw) push('assistant', b); continue; }   // 原样回传(含思考块)
        if (h.text) push('assistant', { type: 'text', text: h.text });
        for (const c of h.calls || []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
      } else if (h.role === 'tool') {
        const b = push('user', { type: 'tool_result', tool_use_id: h.id, content: h.image ? [{ type: 'text', text: h.text }, anthropicImage(h.image)] : h.text });
        if (h.elided) stable = b;
      }
    }
    if (stable) stable.cache_control = { type: 'ephemeral' };
    return out;
  };
  return {
    ownsContext: serverContext,
    async turn({ system, history, tools, keep = 6, signal }) {
      const body = {
        model, max_tokens: MAX_OUTPUT_TOKENS,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: toMessages(history),
        ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {})
      };
      const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      if (serverContext) {
        // 同一条上下文规则(只留最近 keep 条工具结果全文),由服务端执行 —— 不算改历史,思考块不会失效
        body.context_management = { edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'tool_uses', value: keep }, keep: { type: 'tool_uses', value: keep } }] };
        headers['anthropic-beta'] = 'context-management-2025-06-27';
      }
      const j = await postJson(`${baseUrl}/v1/messages`, body, headers, { signal });
      const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = (j.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
      // input_tokens 只是未命中缓存的部分;全部输入 = 它 + 缓存读 + 缓存写
      const u = j.usage || {};
      const cacheRead = u.cache_read_input_tokens ?? 0, cacheWrite = u.cache_creation_input_tokens ?? 0;
      const usage = { tokensIn: (u.input_tokens ?? 0) + cacheRead + cacheWrite, tokensOut: u.output_tokens ?? 0, cacheRead, cacheWrite };
      // 服务端管上下文时,整轮内容块(思考 / 文字 / 工具调用)下一轮原样回传
      return { text, calls, usage, usageReported: { tokensIn: reportedSum(u.input_tokens, usage.tokensIn, u.cache_read_input_tokens, u.cache_creation_input_tokens), tokensOut: reportedTokens(u.output_tokens) }, finishReason: finishReason(j.stop_reason), ...(serverContext ? { raw: j.content || [] } : {}) };
    }
  };
}

// Gemini 的函数参数只认 OpenAPI 子集:additionalProperties、default 等会被 400 拒收,递归只留它认识的字段
const GEMINI_SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum', 'nullable', 'format', 'minItems', 'maxItems']);
export function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(k)) continue;
    if (k === 'type' && Array.isArray(v)) {
      // Gemini 的 type 只能是单个类型:联合类型收成 string(最宽,数字也能写成字符串),含 null 就标 nullable
      const types = v.filter((t) => t !== 'null');
      out.type = types.includes('string') || !types.length ? 'string' : types[0];
      if (types.length !== v.length) out.nullable = true;
    } else if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, geminiSchema(sub)]));
    else if (k === 'items') out[k] = geminiSchema(v);
    else out[k] = v;
  }
  return out;
}

/** 没有参数的工具不带 parameters:Gemini 拒收 properties 为空的 OBJECT。 */
export function geminiDeclaration(t) {
  const params = geminiSchema(t.inputSchema || {});
  const empty = params.type === 'object' && !Object.keys(params.properties || {}).length;
  return { name: t.name, description: t.description, ...(empty ? {} : { parameters: params }) };
}

/**
 * Google Gemini API(v1beta generateContent)。
 * 角色只有 user / model;工具结果是 user 回合里的 functionResponse(必须是对象,文本放在 content 里)。
 * 思考型模型会在 functionCall 上带 thoughtSignature,下一轮必须原样带回,否则请求被拒 —— 存在 call 上随历史回传。
 * usage:思考 token(thoughtsTokenCount)按输出计费,算进 tokensOut;隐式缓存命中(cachedContentTokenCount)记 cacheRead。
 */
function gemini({ model, baseUrl, apiKey }) {
  const toContents = (history) => {
    const out = [];
    const push = (role, part) => {
      const last = out[out.length - 1];
      if (last && last.role === role) last.parts.push(part); else out.push({ role, parts: [part] });
    };
    const inline = (img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } });
    for (const h of history) {
      if (h.role === 'user') {
        push('user', { text: h.text });
        if (h.image) push('user', inline(h.image));
      } else if (h.role === 'assistant') {
        if (h.text) push('model', { text: h.text });
        for (const c of h.calls || []) {
          push('model', { functionCall: { ...(c.native ? { id: c.id } : {}), name: c.name, args: c.args ?? {} }, ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}) });
        }
      } else if (h.role === 'tool') {
        push('user', { functionResponse: { ...(h.native ? { id: h.id } : {}), name: h.name, response: { content: h.text } } });
        if (h.image) push('user', inline(h.image));      // 画面(A 像素档)紧跟在对应的工具结果后面
      }
    }
    return out;
  };
  return {
    async turn({ system, history, tools, signal }) {
      // 只有 Gemini 自己给了 id 的调用才回传 id(自造的 id 它不认)
      const nativeIds = new Set(history.filter((h) => h.role === 'assistant').flatMap((h) => (h.calls || []).filter((c) => c.native).map((c) => c.id)));
      const hist = history.map((h) => (h.role === 'tool' && nativeIds.has(h.id) ? { ...h, native: true } : h));
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: toContents(hist),
        ...(tools.length ? { tools: [{ functionDeclarations: tools.map(geminiDeclaration) }] } : {}),
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }
      };
      const j = await postJson(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, body, { 'x-goog-api-key': apiKey }, { signal });
      const cand = j.candidates?.[0];
      if (!cand) throw new Error(`gemini: no candidate${j.promptFeedback?.blockReason ? ` (prompt blocked: ${j.promptFeedback.blockReason})` : ''}`);
      const parts = cand.content?.parts || [];
      const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('\n');
      const calls = parts.filter((p) => p.functionCall).map((p, i) => ({
        id: p.functionCall.id || `gemini_${Date.now()}_${i}`, native: !!p.functionCall.id,
        name: p.functionCall.name, args: p.functionCall.args || {},
        ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {})
      }));
      const u = j.usageMetadata || {};
      const usage = { tokensIn: u.promptTokenCount ?? 0, tokensOut: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: u.cachedContentTokenCount ?? 0 };
      return { text, calls, usageReported: { tokensIn: reportedTokens(u.promptTokenCount), tokensOut: reportedSum(u.candidatesTokenCount, usage.tokensOut, u.thoughtsTokenCount) }, finishReason: finishReason(cand.finishReason), usage };
    }
  };
}

/** 按参考解出招:验证「循环 → 环境 → 判分」整条链路,不调任何模型。 */
function replay({ reference, seed }) {
  if (!reference) throw new Error('replay reference not found; use replay:auto to replay each task reference');
  const steps = reference.bySeed ? reference.bySeed[String(seed)] : reference.steps;
  if (!steps) throw new Error(`reference has no steps for seed ${seed}`);
  let i = 0;
  return {
    async turn() {
      if (i >= steps.length) return { text: 'reference exhausted', calls: [], usage: { tokensIn: 0, tokensOut: 0 } };
      const [name, args = {}] = steps[i];
      return { text: '', calls: [{ id: `ref_${i++}`, name, args }], usage: { tokensIn: 0, tokensOut: 0 } };
    }
  };
}

export function createProvider(spec, ctx = {}) {
  const i = spec.indexOf(':');
  if (i < 0) throw new Error(`model must be <provider>:<model>, got "${spec}"`);
  const kind = spec.slice(0, i), model = spec.slice(i + 1);
  if (kind === 'ollama') return openaiCompatible({ model, baseUrl: process.env.BENCH_OLLAMA_BASE_URL || 'http://localhost:11434/v1' });
  if (kind === 'openai') {
    if (!process.env.OPENAI_API_KEY && !process.env.BENCH_OPENAI_BASE_URL) throw new Error('openai: set OPENAI_API_KEY (and optionally BENCH_OPENAI_BASE_URL)');
    return openaiCompatible({ model, baseUrl: process.env.BENCH_OPENAI_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY });
  }
  if (kind === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('anthropic: set ANTHROPIC_API_KEY');
    const [name, query = ''] = model.split('?');
    const opts = new URLSearchParams(query);
    for (const k of opts.keys()) if (k !== 'context') throw new Error(`anthropic: unknown option "${k}" (only ?context=server)`);
    const context = opts.get('context') ?? 'client';
    if (!['client', 'server'].includes(context)) throw new Error(`anthropic: context must be client or server, got "${context}"`);
    return anthropic({ model: name, baseUrl: process.env.BENCH_ANTHROPIC_BASE_URL || 'https://api.anthropic.com', apiKey: process.env.ANTHROPIC_API_KEY, serverContext: context === 'server' });
  }
  if (kind === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('gemini: set GEMINI_API_KEY');
    return gemini({ model, baseUrl: process.env.BENCH_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com', apiKey: process.env.GEMINI_API_KEY });
  }
  if (kind === 'replay') return replay(ctx);
  throw new Error(`unknown provider "${kind}" (ollama / openai / anthropic / gemini / replay; claude-cli runs as an external agent)`);
}
