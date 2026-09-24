import { NextResponse } from 'next/server';
import {
  SteamApiError,
  getOwnedGame,
  getPlayerSummary,
  hasApiKey,
} from '@/lib/steam/api';
import { getSessionSteamId } from '@/lib/steam/session';
import { ELDEN_RING_APPID } from '@/types/er';
import type { MeResponse } from '@/types/er';

export const dynamic = 'force-dynamic';

/** 当前登录用户的 Steam 摘要 + 是否拥有艾尔登法环 */
export async function GET() {
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

  try {
    const player = await getPlayerSummary(steamId);

    // 游戏库读取失败不要静默吞掉：那会把"档案私密"伪装成"你没有这个游戏"，
    // 用户完全不知道该去改隐私设置。这里把原因带出去由 UI 展示。
    let game = null;
    let libraryWarning: string | undefined;
    try {
      game = await getOwnedGame(steamId, ELDEN_RING_APPID);
    } catch (err) {
      libraryWarning =
        err instanceof SteamApiError
          ? err.message
          : `读取游戏库失败：${(err as Error).message}`;
    }

    const body: MeResponse = {
      player,
      game,
      ownsGame: game !== null,
      ...(libraryWarning ? { libraryWarning } : {}),
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof SteamApiError) {
      const status = err.code === 'RATE_LIMITED' ? 429 : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
