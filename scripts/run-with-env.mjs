#!/usr/bin/env node
/**
 * 需要代理时，以正确的环境启动另一个脚本。
 *
 * 为什么需要这个包装器（实测结论）：
 *   代理环境变量必须在 **Node 启动前**就存在。
 *   `--use-env-proxy` 与 undici 都在启动阶段固化代理配置，
 *   脚本运行后再去改 process.env 完全无效 —— 实测同一目标：
 *     shell 里预设 HTTPS_PROXY + --use-env-proxy  → HTTP 200
 *     脚本内运行时设 process.env.HTTPS_PROXY      → UND_ERR_CONNECT_TIMEOUT
 *   而 `npm run dev` 之所以能通，是因为 Next 会自己加载 .env.local。
 *   裸 node 跑的脚本没这个待遇，所以需要本包装器先把配置读出来。
 *
 * 用法：node scripts/run-with-env.mjs <脚本路径> [参数...]
 * 由 package.json 的 verify:steam 脚本调用。
 */

import { spawn } from 'node:child_process';
import { parseEnvLocal, projectRoot } from './env.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法：node scripts/run-with-env.mjs <脚本路径> [参数...]');
  process.exit(2);
}

const env = parseEnvLocal();
const childEnv = { ...process.env };

// 把 .env.local 里的值注入子进程环境。已有的真实环境变量优先（部署平台可能直接提供）。
const PASSTHROUGH = [
  'STEAM_API_KEY',
  'SESSION_SECRET',
  'APP_ORIGIN',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
];
for (const name of PASSTHROUGH) {
  if (env[name] && !childEnv[name]) childEnv[name] = env[name];
}

const proxy = childEnv.HTTPS_PROXY ?? childEnv.https_proxy ?? childEnv.HTTP_PROXY ?? childEnv.http_proxy;
if (proxy) {
  console.log(`[run-with-env] 使用代理：${proxy}`);
} else {
  console.log('[run-with-env] 未配置代理，将直连。');
}

// 必须让本机地址绕过代理。否则连自己的 localhost:3000 都会被塞进代理，
// 拿回代理的错误页而不是本站响应 —— 实测踩过：表现为本 API 返回 401，
// 响应体却是 {"status":"failed","retcode":1401,"wording":"unauthorized"}。
const LOOPBACK = 'localhost,127.0.0.1,::1';
if (!childEnv.NO_PROXY && !childEnv.no_proxy) {
  childEnv.NO_PROXY = LOOPBACK;
} else {
  const existing = childEnv.NO_PROXY ?? childEnv.no_proxy;
  if (!existing.includes('127.0.0.1')) {
    childEnv.NO_PROXY = `${existing},${LOOPBACK}`;
  }
}

// 子进程继承 --use-env-proxy，使其在启动阶段就绑定代理配置
const child = spawn(process.execPath, ['--use-env-proxy', ...args], {
  cwd: projectRoot,
  env: childEnv,
  stdio: 'inherit', // 直接把输出接到当前终端，便于查看进度
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-with-env] 子进程被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error(`[run-with-env] 无法启动子进程：${err.message}`);
  process.exit(1);
});
