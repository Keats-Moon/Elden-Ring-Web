#!/usr/bin/env node
/**
 * 带代理配置启动 Next（开发 / 生产通用）。
 *
 * 为什么需要这个包装器（实测踩的坑，逐条都有证据）：
 *
 *  1. Node 的 fetch 基于 undici，而 undici 只在**模块加载那一刻**读取
 *     `NODE_USE_ENV_PROXY`。Next 把 .env.local 载入 process.env 发生在那之后，
 *     所以把 `NODE_USE_ENV_PROXY=1` 写进 .env.local 完全不生效。
 *
 *  2. 反过来，`NODE_OPTIONS` 是**可继承**的环境变量，Node 在启动时就会读取它，
 *     能覆盖 Next 自己 fork 出来的进程树 —— 这正是我们需要的机制。
 *
 *  3. 直接把 `--use-env-proxy` 写在 `node` 命令行上是**不够的**：实测服务器进程里
 *     `process.execArgv` 为空，标志没传到真正干活的进程，请求照样直连超时。
 *
 * 这个脚本负责：读 .env.local → 组装 NODE_OPTIONS 与代理变量 → 启动 Next。
 * 本机地址一律加入 NO_PROXY，避免把访问自身 localhost 的请求也塞进代理。
 *
 * 用法：
 *   node scripts/dev-with-proxy.mjs          # 开发模式（默认）
 *   node scripts/dev-with-proxy.mjs start    # 生产模式
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseEnvLocal, projectRoot } from './env.mjs';

const mode = process.argv[2] ?? 'dev';
if (!['dev', 'build', 'start'].includes(mode)) {
  console.error(`不支持的模式：${mode}（可选 dev / build / start）`);
  process.exit(2);
}

const env = parseEnvLocal();
const childEnv = { ...process.env };

// .env.local 里的值注入子进程；已有真实环境变量优先（部署平台可能直接提供）
for (const name of ['STEAM_API_KEY', 'SESSION_SECRET', 'APP_ORIGIN', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
  if (env[name] && !childEnv[name]) childEnv[name] = env[name];
}

const proxy = childEnv.HTTPS_PROXY ?? childEnv.https_proxy ?? childEnv.HTTP_PROXY ?? childEnv.http_proxy;

if (proxy) {
  // 本机地址必须绕过代理，否则连自己的 localhost:3000 都会被劫持，
  // 拿回代理的错误页而不是本站响应（实测过这个现象）。
  const LOOPBACK = 'localhost,127.0.0.1,::1';
  const existing = childEnv.NO_PROXY ?? childEnv.no_proxy ?? '';
  const merged = existing.includes('127.0.0.1') ? existing : [existing, LOOPBACK].filter(Boolean).join(',');
  childEnv.NO_PROXY = merged;
  childEnv.no_proxy = merged;

  // NODE_OPTIONS 可继承，是让代理对 Next 的整个进程树生效的唯一可靠方式
  const flag = '--use-env-proxy';
  const nodeOptions = childEnv.NODE_OPTIONS ?? '';
  childEnv.NODE_OPTIONS = nodeOptions.includes(flag) ? nodeOptions : `${nodeOptions} ${flag}`.trim();

  console.log(`[dev-with-proxy] 代理：${proxy}`);
  console.log(`[dev-with-proxy] NO_PROXY：${merged}`);
  console.log(`[dev-with-proxy] NODE_OPTIONS：${childEnv.NODE_OPTIONS}`);
} else {
  console.log('[dev-with-proxy] 未配置代理，直连启动。');
}

const nextBin = resolve(projectRoot, 'node_modules/next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, mode], {
  cwd: projectRoot,
  env: childEnv,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[dev-with-proxy] 子进程被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error(`[dev-with-proxy] 无法启动 Next：${err.message}`);
  process.exit(1);
});
