import Dashboard from '@/components/Dashboard';
import Landing from '@/components/Landing';
import { hasApiKey } from '@/lib/steam/api';
import { getSessionSteamId, hasSessionSecret } from '@/lib/steam/session';

// 本页依赖登录 Cookie 与环境变量，必须每次请求都重新判定，不能静态化
export const dynamic = 'force-dynamic';

/**
 * 首页。
 * 服务端只做一件事：判断"是否已登录 + 服务端配置是否完整"，
 * 然后决定渲染引导页还是主面板。真正的数据获取在客户端组件里走本站 API，
 * 这样 Steam API Key 永远留在服务端。
 */
export default async function Home(props: PageProps<'/'>) {
  const searchParams = await props.searchParams;
  const steamId = await getSessionSteamId();

  const errorDetail = typeof searchParams.detail === 'string' ? searchParams.detail : undefined;

  if (!steamId) {
    return (
      <Landing hasApiKey={hasApiKey()} hasSecret={hasSessionSecret()} errorDetail={errorDetail} />
    );
  }

  return <Dashboard steamId={steamId} />;
}
