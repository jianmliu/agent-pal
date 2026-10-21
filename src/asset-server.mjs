/**
 * asset-server — 内置静态资源服务,让 pal-tui 自给自足(不依赖 vite playground)。
 *
 * 引擎用 fetch(assetBaseUrl + name) 拉 MKF/DAT 等资料档。这里起一个本地 http 服务把
 * pal-assets 目录托管在 /pal-assets/ 下。缺文件返 404(比 vite 的 index.html 兜底干净
 * —— 0.RPG 缺失 → 404 → 引擎 loadGame 失败 → loadDefaultGame 回落)。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export async function startAssetServer(assetDir, host = '127.0.0.1') {
  if (!fs.existsSync(assetDir)) {
    throw new Error(`pal-assets 目录不存在: ${assetDir}\n用 --assets <dir> 指定(需含 SSS.MKF / MAP.MKF / GOP.MKF / PAT.MKF 等)。`);
  }
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || '').split('?')[0]);
    const m = reqPath.match(/^\/pal-assets\/(.+)$/);
    if (!m) { res.writeHead(404); res.end(); return; }
    const rel = m[1].replace(/\.\.[/\\]/g, '');                 // 防目录穿越
    let file = path.join(assetDir, rel);
    if (!fs.existsSync(file)) {
      // 大小写兜底(引擎对同一档时大写时小写)
      try {
        const dir = path.dirname(file), base = path.basename(file).toLowerCase();
        const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === base);
        if (hit) file = path.join(dir, hit);
      } catch { /* dir 不存在 → 落 404 */ }
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  return { base: `http://${host}:${addr.port}/pal-assets/`, port: addr.port, close: () => server.close() };
}
