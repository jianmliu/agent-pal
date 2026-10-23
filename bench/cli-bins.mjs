/**
 * cli-bins —— 外部 agent CLI(claude / codex / agy)的可执行文件路径。runner.mjs 与 quiz.mjs 共用。
 *
 * 查找顺序(第一个存在的为准):
 *   1. 环境变量 BENCH_CLAUDE_BIN / BENCH_CODEX_BIN / BENCH_AGY_BIN(显式指定,不检查是否存在)
 *   2. ~/.local/bin/<名字>(官方安装脚本的默认位置;按当前用户的家目录,不写死某个人的路径)
 *   3. 已知的应用内置位置(macOS ChatGPT.app 自带的 codex)
 *   4. 裸名字,交给 PATH
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUNDLED = {
  codex: ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex']
};

export function resolveCliBin(name, { env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  const override = env[`BENCH_${name.toUpperCase()}_BIN`];
  if (override) return override;
  const candidates = [...(home ? [path.join(home, '.local', 'bin', name)] : []), ...(BUNDLED[name] || [])];
  return candidates.find((p) => exists(p)) || name;
}

export const CLAUDE_BIN = resolveCliBin('claude');
export const CODEX_BIN = resolveCliBin('codex');
export const AGY_BIN = resolveCliBin('agy');
