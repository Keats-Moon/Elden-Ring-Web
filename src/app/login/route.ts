import { redirect } from 'next/navigation';
import { buildLoginUrl, resolveOrigin } from '@/lib/steam/openid';

export const dynamic = 'force-dynamic';

/**
 * 登录入口：302 跳转到 Steam 官方授权页。
 * 用户同意后 Steam 会带着 openid.* 参数跳回 /auth/steam/return。
 */
export async function GET(req: Request) {
  const origin = resolveOrigin(req);
  redirect(buildLoginUrl(origin));
}
