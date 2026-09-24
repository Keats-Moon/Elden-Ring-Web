import type { PlayerSummary } from '@/types/er';
import { formatPlaytime, formatUnix } from '@/lib/format';
import ProgressRing from './ProgressRing';

/**
 * 玩家卡：头像、昵称、时长、成就进度环。
 * 数据来自 Steam 官方 API（GetPlayerSummaries + GetOwnedGames）。
 */
export default function PlayerCard({
  player,
  ownsGame,
  libraryWarning,
  playtimeForever,
  lastPlayed,
  achievementPercent,
  achievementLabel,
}: {
  player: PlayerSummary;
  ownsGame: boolean;
  libraryWarning?: string;
  playtimeForever?: number;
  lastPlayed?: number;
  achievementPercent: number;
  achievementLabel: string;
}) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {player.avatarFull ? (
          // 走本站代理，避免 Steam CDN 的跨域/防盗链问题
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/img?url=${encodeURIComponent(player.avatarFull)}`}
            alt={`${player.personaName} 的头像`}
            width={80}
            height={80}
            className="h-20 w-20 shrink-0 rounded-lg border border-neutral-700 object-cover"
          />
        ) : (
          <div className="h-20 w-20 shrink-0 rounded-lg border border-neutral-700 bg-neutral-800" />
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold text-neutral-100">{player.personaName}</h2>
          <div className="mt-1 text-sm text-neutral-400">
            SteamID64 <span className="font-mono text-neutral-300">{player.steamId}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-neutral-300">
            <span>
              艾尔登法环总时长{' '}
              <span className="font-semibold text-amber-300">{formatPlaytime(playtimeForever)}</span>
            </span>
            <span>最后运行：{formatUnix(lastPlayed)}</span>
          </div>

          {libraryWarning ? (
            <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
              读取游戏库失败：{libraryWarning}
            </p>
          ) : !ownsGame ? (
            <p className="mt-3 rounded-md border border-neutral-700 bg-neutral-800/40 px-3 py-2 text-xs leading-relaxed text-neutral-400">
              这个账号的游戏库里没有艾尔登法环。可能是还没购买／游玩过。
              （游戏库本身读取成功，因此这不是隐私设置问题。）
            </p>
          ) : null}
        </div>

        <div className="shrink-0 self-center">
          <ProgressRing percent={achievementPercent} label={achievementLabel} sublabel="成就完成度" />
        </div>
      </div>
    </section>
  );
}
