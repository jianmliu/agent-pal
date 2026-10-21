/**
 * game-engine 的 dist 构建 —— esbuild 多入口 + code-splitting 打包成 ESM。
 *
 * 为什么 splitting + 多入口:消费者(pal-tui)要 patch `Surface.prototype` 并用
 * `inputService` 单例,这要求 surface.ts / input-service.ts 在 dist 里仍是「同一个
 * 被共享的模块」。splitting 把它们抽成公共 chunk,index 入口与 surface/input 入口
 * 共享之 → 单例不破。单文件 bundle 会把它们闭包内联,patch 不到,故不可。
 *
 * 工作区 @onchainpal/* 无 dist → 经根 tsconfig.base 的 paths 解析到各自 src 一并打包;
 * 真·npm 依赖里只把原生移动端(@capacitor/*)externalize(node 跑不到那些分支)。
 *
 *   node build.mjs        # → dist/{index,js/pal/surface,services/input-service}.js + chunks
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: {
    'index': 'src/index.ts',
    'js/pal/surface': 'src/js/pal/surface.ts',
    'services/input-service': 'src/services/input-service.ts',
    'services/dialog-service': 'src/services/dialog-service.ts',
    'js/pal/ui': 'src/js/pal/ui.ts',
    'js/pal/palette': 'src/js/pal/palette.ts',
    'services/world-service': 'src/services/world-service.ts',
    'services/scene-service': 'src/services/scene-service.ts',
    'js/pal/panorama-renderer': 'src/js/pal/panorama-renderer.ts',
    // agent-pal(外部 agent 当玩家)用:主循环探针 + 全量 service 单例 + 语义动作网关
    'js/pal/play': 'src/js/pal/play.ts',
    // pal-host(远程屏幕,docs/specs/pal-companion.md):截音乐 / 音效事件、把 VOC 音效转 WAV 给浏览器
    'js/pal/sound': 'src/js/pal/sound.ts',
    'js/pal/music': 'src/js/pal/music.ts',
    'services/voc': 'src/services/voc.ts',
    'services/resource-service': 'src/services/resource-service.ts',
    'services/execution-scheduler': 'src/services/execution-scheduler.ts',
    'services/battle-command-execution': 'src/services/battle-command-execution.ts',
    'services/index': 'src/services/index.ts',
    'ai/ai-gateway': 'src/ai/ai-gateway.ts',
    'services/script-object-adapter': 'src/services/script-object-adapter.ts'
  },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  tsconfig: '../../tsconfig.base.json',
  // ESM 里补 require(部分依赖用 CommonJS interop);同 pal-server 的 bundle banner。
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  external: ['@capacitor/*'],
  logLevel: 'info',
  logLimit: 30
});

console.log('[game-engine] dist 构建完成');
