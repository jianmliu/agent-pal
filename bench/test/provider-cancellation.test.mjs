import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createProvider, postJson } from '../providers.mjs';

const turn = { system: 'SYS', history: [{ role: 'user', text: 'hello' }], tools: [] };
const cases = [
  { kind: 'openai', env: 'BENCH_OPENAI_BASE_URL', suffix: '/v1', path: '/v1/chat/completions', response: (usage, finish) => ({ choices: [{ message: { content: 'ok' }, ...(finish ? { finish_reason: finish } : {}) }], ...(usage ? { usage } : {}) }), zero: { prompt_tokens: 0, completion_tokens: 0 }, usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0 }, finish: 'stop' },
  { kind: 'ollama', env: 'BENCH_OLLAMA_BASE_URL', suffix: '/v1', path: '/v1/chat/completions', response: (usage, finish) => ({ choices: [{ message: { content: 'ok' }, ...(finish ? { finish_reason: finish } : {}) }], ...(usage ? { usage } : {}) }), zero: { prompt_tokens: 0, completion_tokens: 0 }, usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0 }, finish: 'stop' },
  { kind: 'anthropic', env: 'BENCH_ANTHROPIC_BASE_URL', suffix: '', path: '/v1/messages', response: (usage, finish) => ({ content: [{ type: 'text', text: 'ok' }], ...(usage ? { usage } : {}), ...(finish ? { stop_reason: finish } : {}) }), zero: { input_tokens: 0, output_tokens: 0 }, usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }, finish: 'end_turn' },
  { kind: 'gemini', env: 'BENCH_GEMINI_BASE_URL', suffix: '', path: '/v1beta/models/test-model:generateContent', response: (usage, finish) => ({ candidates: [{ content: { parts: [{ text: 'ok' }] }, ...(finish ? { finishReason: finish } : {}) }], ...(usage ? { usageMetadata: usage } : {}) }), zero: { promptTokenCount: 0, candidatesTokenCount: 0 }, usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0 }, finish: 'STOP' },
];

async function stub(handler, run) {
  const timers = new Set();
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    handler(req, res, JSON.parse(raw), (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function withEnv(values, run) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await run(); }
  finally { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

async function bounded(promise, ms = 500) {
  const timer = new AbortController();
  try {
    return await Promise.race([promise, sleep(ms, undefined, { signal: timer.signal }).then(() => { throw new Error('cancellation did not settle promptly'); })]);
  } finally { timer.abort(); }
}

for (const c of cases) {
  test(`${c.kind}: abort cancels a hanging HTTP request without retry`, async () => {
    let requests = 0;
    const controller = new AbortController();
    await stub((_req, res, _body, later) => {
      requests++;
      later(() => controller.abort(), 20);
      // The fallback keeps a broken implementation finite while still exceeding the assertion budget.
      later(() => res.end(JSON.stringify(c.response())), 800);
    }, async base => withEnv({ [c.env]: base + c.suffix, OPENAI_API_KEY: 'test-only', ANTHROPIC_API_KEY: 'test-only', GEMINI_API_KEY: 'test-only' }, async () => {
      const pending = createProvider(`${c.kind}:test-model`).turn({ ...turn, signal: controller.signal });
      pending.catch(() => {});
      await assert.rejects(bounded(pending), { name: 'AbortError' });
      await sleep(40);
      assert.equal(requests, 1);
    }));
  });

  test(`${c.kind}: ordinary calls preserve payload and usage, with missing versus zero evidence`, async () => {
    let requests = 0;
    await stub((req, res, body) => {
      assert.equal(req.url, c.path);
      assert.equal(body.max_tokens ?? body.generationConfig?.maxOutputTokens, 4096);
      if (c.kind === 'openai' || c.kind === 'ollama') {
        assert.deepEqual(body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hello' }]);
        assert.equal(body.tools, undefined);
      }
      const index = requests++;
      const usage = index === 1 ? c.zero : index === 2 ? Object.fromEntries(Object.keys(c.zero).map(key => [key, '0'])) : undefined;
      res.end(JSON.stringify(c.response(usage, index === 1 ? c.finish : index === 2 ? 123 : undefined)));
    }, async base => withEnv({ [c.env]: base + c.suffix, OPENAI_API_KEY: 'test-only', ANTHROPIC_API_KEY: 'test-only', GEMINI_API_KEY: 'test-only' }, async () => {
      const provider = createProvider(`${c.kind}:test-model`);
      const missing = await provider.turn(turn);
      const zero = await provider.turn(turn);
      for (const result of [missing, zero]) {
        assert.equal(result.text, 'ok');
        assert.deepEqual(result.calls, []);
        assert.deepEqual(result.usage, c.usage);
      }
      assert.deepEqual(missing.usageReported, { tokensIn: false, tokensOut: false });
      assert.equal(missing.finishReason, null);
      assert.deepEqual(zero.usageReported, { tokensIn: true, tokensOut: true });
      assert.equal(zero.finishReason, c.finish);
      const malformed = await provider.turn(turn);
      assert.deepEqual(malformed.usageReported, { tokensIn: false, tokensOut: false });
      assert.equal(malformed.finishReason, null);
      assert.equal(requests, 3);
    }));
  });
}

test('postJson: abort interrupts retry backoff and makes no later request', async () => {
  const controller = new AbortController();
  let requests = 0;
  await stub((_req, res, _body, later) => {
    requests++;
    res.writeHead(requests === 1 ? 500 : 200);
    res.end(JSON.stringify({ ok: true }));
    if (requests === 1) later(() => controller.abort(), 30);
  }, async base => {
    const pending = postJson(base, {}, {}, { retries: 3, baseDelayMs: 300, signal: controller.signal });
    pending.catch(() => {});
    await assert.rejects(bounded(pending, 180), { name: 'AbortError' });
    await sleep(350);
    assert.equal(requests, 1);
  });
});

test('postJson: no signal retains normal retry and successful JSON behavior', async () => {
  let requests = 0;
  await stub((_req, res) => {
    res.writeHead(++requests < 3 ? 500 : 200);
    res.end(JSON.stringify({ ok: true }));
  }, async base => {
    assert.deepEqual(await postJson(base, {}, {}, { retries: 3, baseDelayMs: 10 }), { ok: true });
    assert.equal(requests, 3);
  });
});

for (const [kind, invalidUsage, validUsage, field, invalidTotal, validTotal] of [
  ['anthropic', { input_tokens: 10, cache_read_input_tokens: '5', output_tokens: 2 }, { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 3, output_tokens: 2 }, 'tokensIn', '1050', 18],
  ['gemini', { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: '5' }, { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 5 }, 'tokensOut', '25', 7],
]) {
  test(`${kind}: malformed summed usage is unreported while valid sums are reported`, async () => {
    const c = cases.find(entry => entry.kind === kind);
    let requests = 0;
    await stub((_req, res) => {
      res.end(JSON.stringify(c.response(requests++ === 0 ? invalidUsage : validUsage)));
    }, async base => withEnv({ [c.env]: base + c.suffix, ANTHROPIC_API_KEY: 'test-only', GEMINI_API_KEY: 'test-only' }, async () => {
      const provider = createProvider(`${kind}:test-model`);
      const invalid = await provider.turn(turn);
      assert.equal(invalid.usage[field], invalidTotal, 'legacy usage values remain compatible');
      assert.equal(invalid.usageReported[field], false);
      const valid = await provider.turn(turn);
      assert.equal(valid.usage[field], validTotal);
      assert.deepEqual(valid.usageReported, { tokensIn: true, tokensOut: true });
    }));
  });
}
