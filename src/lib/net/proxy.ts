/**
 * 服务端出站代理支持与诊断。
 *
 * ── 背景（实测踩到的坑）────────────────────────────────────────
 * Node 的 fetch 基于 undici，而 undici **只在模块加载那一刻**读取
 * `NODE_USE_ENV_PROXY`，Next 把 `.env.local` 载入 process.env 发生在那之后 ——
 * 所以把 `NODE_USE_ENV_PROXY=1` 写进 `.env.local` 完全不生效。
 *
 * 本机实测（反向验证，故意把代理指向一个不存在的端口）：
 *   正确代理 + --use-env-proxy  → HTTP 200
 *   错误端口 + --use-env-proxy  → ECONNREFUSED（证明代理确实被使用）
 *   错误端口 + 不用该标志       → HTTP 200（证明不用标志时代理被完全忽略）
 *
 * 结论：**必须让 Node 在进程启动时就带上 `--use-env-proxy`**。
 * 本项目已把它写进 package.json 的 dev / start 脚本，开箱即用。
 *
 * ── 为什么不在这里用 undici 的 ProxyAgent ────────────────────
 * 试过。Turbopack 判定 `import('undici')` 对浏览器包可达，于是把整个 undici 的
 * CJS 依赖图拉进浏览器构建并全线解析失败。这条路在 Next 里走不通，已放弃。
 *
 * 这个模块因此只负责一件事：**在代理配置存在但未生效时，把原因明确说出来**，
 * 而不是让用户看到一堆莫名其妙的连接超时。
 */

/** 读取配置的代理地址（HTTPS 优先） */
function resolveProxyUrl(): string | null {
  const raw =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    '';
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 代理地址里的凭据不该出现在日志里 */
function redact(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '(无法解析)';
  }
}

/**
 * 判断代理是否真的已经生效。
 *
 * 只认这两个来源，**故意不看 `NODE_USE_ENV_PROXY`**：
 * 那个变量常被写进 .env.local，而它恰恰是无效的（undici 读它的时机早于
 * Next 载入 .env.local）。把它算作"已启用"会让这里误报成功，
 * 掩盖真正的问题 —— 这个误报本项目实际发生过。
 */
function proxyFlagActive(): boolean {
  if (process.execArgv.includes('--use-env-proxy')) return true;
  return (process.env.NODE_OPTIONS ?? '').includes('--use-env-proxy');
}

let warned = false;

/**
 * 检查代理配置是否真的会生效；不生效时给出明确、可操作的告警。
 * 可以安全地重复调用（只会告警一次）。
 */
export function ensureProxyDispatcher(): void {
  if (warned) return;

  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) return; // 没配代理，直连即可，不打扰

  warned = true;

  if (proxyFlagActive()) {
    console.log(`[net/proxy] 出站代理已启用：${redact(proxyUrl)}`);
    return;
  }

  // 配了代理但没生效 —— 这正是本项目曾经踩过的坑，必须说清楚
  console.warn(
    [
      '',
      '─'.repeat(72),
      `[net/proxy] 检测到代理配置 ${redact(proxyUrl)}，但 Node 未启用代理支持，`,
      '           服务端所有 Steam 请求都会直连并可能超时失败。',
      '',
      '  原因：undici 只在模块加载时读取该设置，写入 .env.local 为时已晚。',
      '  解决：用 npm 脚本启动（dev / start 已内置 --use-env-proxy），',
      '        或自行在启动前于进程环境中设置 NODE_USE_ENV_PROXY=1。',
      '─'.repeat(72),
      '',
    ].join('\n'),
  );
}

/** 当前是否检测到代理配置（供诊断展示） */
export function hasProxyConfigured(): boolean {
  return resolveProxyUrl() !== null;
}
