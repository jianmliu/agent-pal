const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_ENDPOINT = 'http://localhost:11434/api/generate';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_EMBED_ENDPOINT = 'http://localhost:11434/api/embeddings';

type RunQwenOptions = {
  prompt: string;
  model?: string;
  endpoint?: string;
  options?: Record<string, unknown>;
};

type RunEmbeddingOptions = {
  text: string;
  model?: string;
  endpoint?: string;
  signal?: AbortSignal;
};

function getFetchImpl() {
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new Error('[qwen-client] fetch is not available in this environment');
}

export async function runQwen({
  prompt,
  model = DEFAULT_MODEL,
  endpoint = DEFAULT_ENDPOINT,
  options = {}
}: RunQwenOptions) {
  if (!prompt || typeof prompt !== 'string') {
    throw new TypeError('[qwen-client] prompt must be a non-empty string');
  }
  const fetchImpl = getFetchImpl();
  const body = {
    model,
    prompt,
    stream: false,
    options
  };
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`[qwen-client] request failed ${response.status}: ${text}`);
    }
    const payload = await response.json();
    if (!payload || typeof payload.response !== 'string') {
      throw new Error('[qwen-client] unexpected response format');
    }
    return payload.response.trim();
  } catch (err) {
    throw err;
  }
}

export async function runEmbedding({
  text,
  model = DEFAULT_EMBED_MODEL,
  endpoint = DEFAULT_EMBED_ENDPOINT,
  signal
}: RunEmbeddingOptions) {
  if (!text || typeof text !== 'string') {
    throw new TypeError('[qwen-client] embedding text must be a non-empty string');
  }
  const fetchImpl = getFetchImpl();
  const body = {
    model,
    prompt: text
  };
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    const textResp = await response.text().catch(() => response.statusText);
    throw new Error(`[qwen-client] embedding request failed ${response.status}: ${textResp}`);
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.embedding)) {
    throw new Error('[qwen-client] embedding response missing vector');
  }
  return payload.embedding as number[];
}

export default {
  runQwen,
  runEmbedding
};
