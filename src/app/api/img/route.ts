import { NextResponse } from 'next/server';
import { ensureProxyDispatcher } from '@/lib/net/proxy';

export const dynamic = 'force-dynamic';

/**
 * Steam 社区图片代理。
 *
 * 为什么需要：Steam 的头像/成就图标在浏览器直连时可能遇到跨域或防盗链，
 * 走同源代理最稳。
 *
 * 安全：**只允许** Steam 官方图片域名，否则本站就变成了一个开放代理
 * （可被用来探测内网 / 洗流量）。
 */
const ALLOWED_HOSTS = new Set([
  'avatars.steamstatic.com',
  'avatars.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'community.cloudflare.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'shared.cloudflare.steamstatic.com',
]);

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

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
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
