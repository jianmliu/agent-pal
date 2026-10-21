/**
 * 打包版(npx / npm 安装,scripts/pack-npx.mjs 打出的单文件)与仓库内运行的区别只在默认路径:
 * 打包版没有仓库目录可写,存档 / 运行日志 / 地图记忆默认放到用户目录(AGENT_PAL_HOME,默认 ~/.agent-pal),
 * 游戏资源必须由用户用 --assets 或 PAL_ASSET_DIR 指定(资源不随包分发)。
 */
import os from 'node:os';
import path from 'node:path';

/* global __AGENT_PAL_PACKAGED__ */
// 打包时 esbuild 把这个标识符替换成 true;仓库内运行时它不存在
export const PACKAGED = typeof __AGENT_PAL_PACKAGED__ !== 'undefined' && __AGENT_PAL_PACKAGED__ === true;
export const userHome = () => process.env.AGENT_PAL_HOME || path.join(os.homedir(), '.agent-pal');
