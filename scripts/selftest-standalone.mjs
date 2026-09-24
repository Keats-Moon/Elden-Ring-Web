/**
 * 本地复现 Docker 容器的构建与启动流程，验证 standalone 产物可用。
 * 不做任何修改，只读地拷贝静态资源到 standalone 目录（Dockerfile 也这么做）。
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { projectRoot } from './env.mjs';

const saDir = resolve(projectRoot, '.next/standalone');
const PORT = process.env.PROBE_PORT ?? '3100';

if (!existsSync(resolve(saDir, 'server.js'))) {
  console.error('✗ 找不到 .next/standalone/server.js —— 请先 npm run build');
  process.exit(1);
}

console.log('=== 步骤 1：复现 Dockerfile 的 COPY 步骤 ===');
mkdirSync(resolve(saDir, '.next/static'), { recursive: true });
cpSync(resolve(projectRoot, '.next/static'), resolve(saDir, '.next/static'), { recursive: true });
console.log('  ✓ 拷贝 .next/static');
cpSync(resolve(projectRoot, 'public'), resolve(saDir, 'public'), { recursive: true });
console.log('  ✓ 拷贝 public');
// Dockerfile 也会把容器启动脚本拷进去（镜像里没有 next CLI，必须直接跑 server.js）
mkdirSync(resolve(saDir, 'scripts'), { recursive: true });
cpSync(
  resolve(projectRoot, 'scripts/docker-start.mjs'),
  resolve(saDir, 'scripts/docker-start.mjs'),
);
console.log('  ✓ 拷贝 scripts/docker-start.mjs');

console.log('');
console.log('=== 步骤 2：启动 standalone 服务（模拟容器）===');
// 用占位密钥模拟"平台已配置环境变量"的情形。
// 这同时验证了一件重要的事：镜像里**不含** .env.local（密钥不进镜像），
// 所有密钥必须在运行时由平台注入 —— 未注入时引导页会如实显示配置提示。
const child = spawn(process.execPath, ['scripts/docker-start.mjs'], {
  cwd: saDir,
  env: {
    ...process.env,
    PORT,
    HOSTNAME: '0.0.0.0',
    NODE_ENV: 'production',
    STEAM_API_KEY: '0123456789abcdef0123456789abcdef',
    SESSION_SECRET: 'probe-only-secret-not-a-real-one-0123456789',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (d) => {
  serverLog += d.toString();
});
child.stderr.on('data', (d) => {
  serverLog += d.toString();
});

// 等服务器就绪
async function waitReady(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  → ${detail}` : ''}`);
  if (!ok) failures++;
}

try {
  const ready = await waitReady();
  console.log('  服务器启动日志：');
  for (const line of serverLog.trim().split('\n').slice(0, 8)) console.log('    ' + line);
  console.log('');
  check('服务已就绪', ready);
  if (!ready) throw new Error('服务未在预期时间内就绪');

  console.log('');
  console.log('=== 步骤 3：探测 HTTP 行为 ===');
  const home = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await home.text();
  check('首页返回 200', home.status === 200, `实际 ${home.status}`);
  check('首页包含站点标题', html.includes('艾尔登法环'));
  check(
    '主页显示登录按钮（说明运行时环境变量已被读取）',
    html.includes('通过 Steam 登录'),
    '若失败通常是环境变量未注入',
  );
  check('主页未显示配置缺失提示', !html.includes('服务端还没配置好'), '密钥注入后不应再提示配置缺失');

  // 静态资源：这是 standalone 最容易漏的地方，CSS 404 会表现为"页面没样式"
  const cssMatch = html.match(/\/_next\/static\/[^"']+\.css/);
  check('首页引用了 CSS', Boolean(cssMatch), cssMatch ? cssMatch[0] : '未找到');
  if (cssMatch) {
    const cssRes = await fetch(`http://127.0.0.1:${PORT}${cssMatch[0]}`);
    check('CSS 可访问（200）', cssRes.status === 200, `实际 ${cssRes.status}`);
  }

  // API 鉴权
  const anon = await fetch(`http://127.0.0.1:${PORT}/api/me`);
  check('未登录时 /api/me 返回 401', anon.status === 401, `实际 ${anon.status}`);

  // Steam 登录跳转（验证 APP_ORIGIN 推断在容器里正常工作）
  const login = await fetch(`http://127.0.0.1:${PORT}/login`, { redirect: 'manual' });
  check('登录入口返回 307', login.status === 307, `实际 ${login.status}`);
  const loc = login.headers.get('location') ?? '';
  check('跳转到 Steam OpenID', loc.startsWith('https://steamcommunity.com/openid/login'), loc.slice(0, 70));

  console.log('');
  console.log('=== 步骤 4：APP_ORIGIN 是否真的能修正登录回调地址 ===');
  console.log('  这是部署时最常见的故障点：回调地址与用户实际访问地址不一致 → Steam 拒绝登录。');
  const loc0 = login.headers.get('location') ?? '';
  const returnTo0 = new URL(loc0).searchParams.get('openid.return_to');
  console.log(`  未设 APP_ORIGIN 时回调 = ${returnTo0}`);
  check(
    '未设 APP_ORIGIN 时回调地址退化为请求 Host（容器内是内网地址）',
    returnTo0 === `http://127.0.0.1:${PORT}/auth/steam/return`,
    `实际 ${returnTo0}`,
  );
} catch (err) {
  console.error('测试异常：', err.message);
  failures++;
  if (serverLog) console.error('服务器日志：\n' + serverLog.slice(-1500));
} finally {
  child.kill();
}

/* ── 第二轮：设置 APP_ORIGIN 后重启，验证回调地址被正确覆盖 ── */
console.log('');
console.log('=== 步骤 5：设置 APP_ORIGIN=https://example.com 后重启验证 ===');
{
  const child2 = spawn(process.execPath, ['scripts/docker-start.mjs'], {
    cwd: saDir,
    env: {
      ...process.env,
      PORT,
      HOSTNAME: '0.0.0.0',
      NODE_ENV: 'production',
      STEAM_API_KEY: '0123456789abcdef0123456789abcdef',
      SESSION_SECRET: 'probe-only-secret-not-a-real-one-0123456789',
      APP_ORIGIN: 'https://example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log2 = '';
  child2.stdout.on('data', (d) => (log2 += d.toString()));
  child2.stderr.on('data', (d) => (log2 += d.toString()));

  try {
    const deadline = Date.now() + 25000;
    let up = false;
    while (Date.now() < deadline && !up) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/me`, { signal: AbortSignal.timeout(3000) });
        up = r.status === 401;
      } catch {
        /* 未就绪 */
      }
      if (!up) await new Promise((r) => setTimeout(r, 600));
    }

    if (!up) {
      check('第二轮服务就绪', false, log2.slice(-300));
    } else {
      const l = await fetch(`http://127.0.0.1:${PORT}/login`, { redirect: 'manual' });
      const url = new URL(l.headers.get('location') ?? '');
      const returnTo = url.searchParams.get('openid.return_to');
      const realm = url.searchParams.get('openid.realm');
      check('回调地址采用 APP_ORIGIN', returnTo === 'https://example.com/auth/steam/return', `实际 ${returnTo}`);
      check('realm 采用 APP_ORIGIN', realm === 'https://example.com', `实际 ${realm}`);
    }
  } finally {
    child2.kill();
    // 清理拷进去的文件，保持 standalone 目录与构建产物一致
    rmSync(resolve(saDir, '.next/static'), { recursive: true, force: true });
    rmSync(resolve(saDir, 'public'), { recursive: true, force: true });
    rmSync(resolve(saDir, 'scripts'), { recursive: true, force: true });
  }
}

console.log('');
console.log('='.repeat(60));
console.log(failures === 0 ? '全部通过：standalone 产物与容器启动流程可用。' : `有 ${failures} 项未通过。`);
process.exit(failures === 0 ? 0 : 1);
