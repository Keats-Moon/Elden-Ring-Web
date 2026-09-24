import type { BossRecord } from '@/types/er';
import { formatUnix } from '@/lib/format';

/**
 * Boss 击杀记录。
 *
 * ⚠️ 必须如实告知用户：**这个列表只包含被做成成就的 Boss**。
 * 艾尔登法环有大量 Boss（大树守卫、蒙格温王朝的蒙格、各地洞窟 Boss 等）
 * 根本没有 Steam 成就，所以"不在列表里" ≠ "没打过"。不说明这点会误导用户。
 */
export default function BossList({ bosses }: { bosses: BossRecord[] }) {
  const defeated = bosses.filter((b) => b.defeated).length;

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-xs leading-relaxed text-neutral-400">
        这里只列出<strong className="text-neutral-200">被 Steam 成就系统追踪</strong>的 Boss
        （主要是追忆 Boss 与关键节点）。游戏里有大量 Boss 没有对应成就，
        因此<strong className="text-neutral-200">不在此列表中不代表没有击败</strong>。
        要获得完整击杀与收集情况，需要叠加存档解析。
      </p>

      <div className="text-sm text-neutral-400">
        成就追踪的 Boss：<span className="font-semibold text-amber-300">{defeated}</span> / {bosses.length} 已击败
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {bosses.map((boss) => (
          <li
            key={boss.achievementName}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
              boss.defeated
                ? 'border-amber-500/30 bg-amber-500/[0.06]'
                : 'border-neutral-800 bg-neutral-900/40'
            }`}
          >
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                boss.defeated
                  ? 'bg-amber-400/20 text-amber-300'
                  : 'bg-neutral-800 text-neutral-600'
              }`}
            >
              {boss.defeated ? '✓' : '·'}
            </span>

            <div className="min-w-0 flex-1">
              <div
                className={`truncate text-sm font-medium ${
                  boss.defeated ? 'text-amber-200' : 'text-neutral-400'
                }`}
              >
                {boss.name}
              </div>
              <div className="truncate text-[11px] text-neutral-500">
                成就「{boss.achievementName}」
              </div>
            </div>

            <div className="shrink-0 text-right text-[11px] text-neutral-500">
              {boss.defeated ? formatUnix(boss.defeatedAt) : '未击败'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
