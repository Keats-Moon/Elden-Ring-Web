import { NextResponse } from 'next/server';
import { verifyCallback } from '@/lib/steam/openid';
import { setSessionCookie } from '@/lib/steam/session';

export const dynamic = 'force-dynamic';

/**
 * Steam OpenID 回调。
 *
 * 安全要点：必须调用 verifyCallback 回源校验签名。仅从 URL 里读
 * openid.claimed_id 就当作已登录是典型漏洞 —— 那样任何人构造一个链接
 * 就能以别人的身份进入本站。
 */
export async function GET(req: Request) {
  const result = await verifyCallback(req.url);

  if (!result.ok) {
    const url = new URL('/', req.url);
    url.searchParams.set('error', 'login_failed');
    url.searchParams.set('detail', result.reason);
    return NextResponse.redirect(url);
  }

  await setSessionCookie(result.steamId);

  const url = new URL('/', req.url);
  url.searchParams.set('welcome', '1');
  return NextResponse.redirect(url);
}
