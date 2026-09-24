import { NextResponse } from 'next/server';
import { buildAchievementProgress, extractBossRecords } from '@/lib/er/achievements';
import { SteamApiError, getPlayerSummary, hasApiKey, isProfilePublic } from '@/lib/steam/api';
import { getSessionSteamId } from '@/lib/steam/session';
import type { AchievementsResponse } from '@/types/er';

export const dynamic = 'force-dynamic';

/**
 * 当前登录用户的艾尔登法环成就进度 + Boss 击杀记录。
 * 加 ?refresh=1 可绕过服务端缓存强制重新拉取。
 */
export async function GET(req: Request) {
  // 先判身份再判配置：未登录一律 401，
  // 不要让未鉴权的请求探测出服务端配置是否完整。
  const steamId = await getSessionSteamId();
  if (!steamId) {
    return NextResponse.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error:
          '服务端还没有配置 STEAM_API_KEY。请按 README 申请一个 Steam Web API Key 并填入 .env.local，然后重启服务。',
        code: 'NO_API_KEY',
      },
      { status: 500 },
    );
  }

  const force = new URL(req.url).searchParams.get('refresh') === '1';

  try {
    const player = await getPlayerSummary(steamId);

    // 档案私密时，成就接口会失败；这里给出可操作的提示而不是干巴巴的报错
    if (!isProfilePublic(player)) {
      return NextResponse.json(
        {
          error:
            '你的 Steam「游戏详情」不是公开的，Steam 不允许第三方读取成就数据。请到 Steam → 个人资料 → 隐私设置，把「游戏详情」改为公开后重试。',
          code: 'PRIVATE_PROFILE',
        },
        { status: 403 },
      );
    }

    const progress = await buildAchievementProgress(steamId, force);

    const body: AchievementsResponse = {
      progress,
      bosses: extractBossRecords(progress),
    };

    if (progress.total === 0) {
      body.warning = 'Steam 没有返回任何成就定义，可能是接口临时异常或该账号没有游玩记录。';
    }

    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof SteamApiError) {
      const status = err.code === 'RATE_LIMITED' ? 429 : err.code === 'PRIVATE_PROFILE' ? 403 : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
