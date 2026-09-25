import { NextResponse } from 'next/server';
import { ensureProxyDispatcher } from '@/lib/net/proxy';

export const dynamic = 'force-dynamic';

/**
 * Steam 图片代理。
 *
 * 为什么需要：Steam 的头像/成就图标在浏览器直连时可能遇到跨域或防盗链，
 * 走同源代理最稳。
 *
 * 安全：**只允许** Steam 官方 CDN 域，否则本站就变成了一个开放代理
 * （可被用来探测内网 / 洗流量）。
 *
 * ⚠️ 实测教训：最初这里逐个子域列举，结果漏了成就图标实际所在的
 * `cdn.cloudflare.steamstatic.com`，导致成就图标全部 403。
 * 改为按**域后缀**校验：`steamstatic.com` 是 Valve 自有 CDN 域，
 * 其所有子域都归 Valve 控制，按后缀放行既安全又不会漏。
 */
const ALLOWED_CDN_SUFFIXES = ['.steamstatic.com'];

function isAllowedHost(hostname: string): boolean {
  // 用带点的后缀比较，避免 evil-steamstatic.com 这类域名被误放行
  return ALLOWED_CDN_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'url 不是合法地址' }, { status: 400 });
  }

  if (target.protocol !== 'https:' || !isAllowedHost(target.hostname)) {
    return NextResponse.json(
      { error: `只允许代理 Steam 官方图片域名，收到：${target.hostname}` },
      { status: 403 },
    );
  }

  try {
    // Steam 图片 CDN 与 API 走同一条出站链路，同样需要代理支持
    await ensureProxyDispatcher();

    const upstream = await fetch(target.toString(), {
      cache: 'no-store',
      headers: { 'User-Agent': 'elden-ring-tracker/0.1 (Steam image proxy)' },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `上游返回 HTTP ${upstream.status}` },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: '上游返回的不是图片' }, { status: 502 });
    }

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // 头像/图标基本不变，缓存一天
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `拉取图片失败：${(err as Error).message}` },
      { status: 502 },
    );
  }
}
