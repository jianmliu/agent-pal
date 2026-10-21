/**
 * rpc — 换行分隔的 JSON-RPC 2.0 对端(Unix socket 上的模块协议,§5.2)。两边对称:都能 call / notify,
 * 也都能处理对方发来的请求。会话和模块(module-sdk)共用这一份。
 */
export function rpcPeer(socket, handlers = {}) {
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  const write = (o) => { if (!socket.destroyed) socket.write(JSON.stringify(o) + '\n'); };

  async function onMessage(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (typeof m.method === 'string') {
      const h = handlers[m.method];
      const isRequest = m.id !== undefined && m.id !== null;
      if (!isRequest) { if (h) Promise.resolve().then(() => h(m.params)).catch(() => {}); return; }
      if (!h) return write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
      try {
        const result = await h(m.params);
        write({ jsonrpc: '2.0', id: m.id, result: result === undefined ? null : result });
      } catch (err) {
        write({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: String(err?.message || err) } });
      }
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
    else p.resolve(m.result);
  }

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onMessage(line);
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    for (const p of pending.values()) p.reject(new Error('connection closed'));
    pending.clear();
  });

  return {
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ jsonrpc: '2.0', id, method, params });
      });
    },
    notify(method, params) { write({ jsonrpc: '2.0', method, params }); },
    close() { socket.end(); },
    get closed() { return socket.destroyed; }
  };
}
