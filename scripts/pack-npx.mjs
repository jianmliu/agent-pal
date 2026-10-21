#!/usr/bin/env node
/**
 * 打出可发布的 npm 包(给「在自己电脑上玩」的用户:npx @jianmliu/agent-pal --assets <游戏目录>)。
 *   node scripts/pack-npx.mjs [--out DIR] [--pack]
 * 引擎、协议、资源服务等工作区包用 esbuild 打进一个文件,包里没有工作区依赖;游戏资源、攻略、标注地图都不进包。
 * 先构建引擎:pnpm run build:engine。--pack 顺便 npm pack 出 .tgz(发布由维护者自己 npm publish)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const args = process.argv.slice(2);
const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(app, 'npx-dist'));
const appPkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'bin'), { recursive: true });
await build({
  entryPoints: [path.join(app, 'bin', 'agent-pal.mjs')],
  outfile: path.join(out, 'bin', 'agent-pal.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  define: { __AGENT_PAL_PACKAGED__: 'true' },
  // 引擎里有 CommonJS 依赖(jquery、sprintf-js…):ESM 单文件里要有 require
  banner: { js: "import { createRequire as __agentPalCreateRequire } from 'node:module'; const require = __agentPalCreateRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning'
});
// esbuild 会保留入口的 #!;没有就补上
const binFile = path.join(out, 'bin', 'agent-pal.mjs');
const code = fs.readFileSync(binFile, 'utf8');
if (!code.startsWith('#!')) fs.writeFileSync(binFile, '#!/usr/bin/env node\n' + code);
fs.chmodSync(binFile, 0o755);
// pal-host 的页面(host.mjs 从自己所在目录读;打包后就是 bin/)
fs.copyFileSync(path.join(app, 'src', 'host-client.html'), path.join(out, 'bin', 'host-client.html'));

const pkg = {
  name: '@jianmliu/agent-pal',
  version: appPkg.publishVersion || '0.1.0',
  description: '让 AI agent 当玩家玩经典《仙剑奇侠传》DOS 版的 MCP 服务(游戏资源需自备)',
  type: 'module',
  bin: { 'agent-pal': 'bin/agent-pal.mjs' },
  files: ['bin', 'README.md'],
  engines: { node: '>=20' },
  keywords: ['mcp', 'agent', 'pal', '仙剑奇侠传', 'game'],
  repository: { type: 'git', url: 'https://github.com/jianmliu/pal-classic' }
};
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
fs.copyFileSync(path.join(app, 'npx-README.md'), path.join(out, 'README.md'));
const size = (fs.statSync(binFile).size / 1024 / 1024).toFixed(1);
process.stderr.write(`[pack-npx] ${pkg.name}@${pkg.version} → ${out} (bin ${size} MB)\n`);
if (args.includes('--pack')) {
  const tgz = execFileSync('npm', ['pack', '--silent'], { cwd: out }).toString().trim();
  process.stderr.write(`[pack-npx] ${path.join(out, tgz)}\n`);
}
