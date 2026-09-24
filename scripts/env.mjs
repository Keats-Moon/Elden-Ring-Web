/**
 * 极简 .env.local 解析（供 scripts/ 下的脚本使用，避免引入 dotenv 依赖）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, '..');

/**
 * 读取 .env.local，返回键值对象。
 * 文件不存在时返回空对象（而不是抛错）—— 调用方通常有更友好的提示。
 */
export function parseEnvLocal() {
  let text;
  try {
    text = readFileSync(resolve(projectRoot, '.env.local'), 'utf8');
  } catch {
    return {};
  }

  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value;
  }
  return env;
}
