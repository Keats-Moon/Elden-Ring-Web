#!/usr/bin/env node
/**
 * 容器启动脚本（standalone 产物专用）。
 *
 * 为什么不用 `npm start`：Docker 镜像里装的是 Next 的 **standalone** 产物
 * （`.next/standalone/server.js`），它不含 `next` CLI，根本执行不了 `next start`。
 * 正确做法是直接 `node server.js`。
 *
 * 为什么需要这个脚本而不是直接写 CMD：代理场景下必须在**进程启动前**注入
 * `--use-env-proxy`（undici 只在启动时读代理设置），但又不能无条件加这个参数 ——
 * 那样在没有代理的环境里会因缺少代理配置而出问题。这里做条件判断。
 *
 * 未配置代理时（境外 VPS / Render 等直连 Steam 的环境）行为与直接
 * `node server.js` 完全一致。
 */

import { spawn } from 'node:child_process';

const proxy =
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy;

// 本机地址必须绕过代理，否则健康检查访问自己的 127.0.0.1:3000 也会被塞进代理
const LOOPBACK = '127.0.0.1,localhost,::1';
if (proxy) {
  const existing = process.env.NO_PROXY ?? process.env.no_proxy ?? '';
  const merged = existing.includes('127.0.0.1') ? existing : [existing, LOOPBACK].filter(Boolean).join(',');
  process.env.NO_PROXY = merged;
  process.env.no_proxy = merged;
  console.log(`[docker-start] 检测到代理 ${proxy}，将以 --use-env-proxy 启动`);
  console.log(`[docker-start] NO_PROXY=${merged}`);
} else {
  console.log('[docker-start] 未配置代理，直连启动（境外主机通常如此）');
}

// standalone 产物的入口
const args = proxy ? ['--use-env-proxy', 'server.js'] : ['server.js'];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[docker-start] 进程被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error(`[docker-start] 无法启动：${err.message}`);
  process.exit(1);
});
