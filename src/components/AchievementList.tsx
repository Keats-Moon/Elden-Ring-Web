'use client';

import { useMemo, useState } from 'react';
import type { AchievementCategory, AchievementView } from '@/types/er';
import { formatPercent, formatUnix, proxiedImageUrl } from '@/lib/format';

const CATEGORY_TABS: { key: AchievementCategory | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'boss', label: '追忆 Boss' },
  { key: 'ending', label: '结局' },
  { key: 'progression', label: '主线推进' },
  { key: 'collection', label: '收集类' },
  { key: 'other', label: '其他' },
];

/**
 * 成就清单。
 *
 * 隐藏成就的处理：Steam 在未解锁时不会返回描述（防剧透），
 * 这里在未解锁 + hidden 的情况下把描述替换成提示语，而不是显示空白。
 */
export default function AchievementList({ achievements }: { achievements: AchievementView[] }) {
  const [category, setCategory] = useState<AchievementCategory | 'all'>('all');
  const [onlyUnlocked, setOnlyUnlocked] = useState(false);

  const filtered = useMemo(() => {
    return achievements.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (onlyUnlocked && !a.achieved) return false;
      return true;
    });
  }, [achievements, category, onlyUnlocked]);

  const counts = useMemo(() => {
    const map = new Map<string, { total: number; unlocked: number }>();
    for (const a of achievements) {
      const entry = map.get(a.category) ?? { total: 0, unlocked: 0 };
      entry.total += 1;
      if (a.achieved) entry.unlocked += 1;
      map.set(a.category, entry);
    }
    return map;
  }, [achievements]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORY_TABS.map((tab) => {
          const stat = tab.key === 'all' ? null : counts.get(tab.key);
          const active = category === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setCategory(tab.key)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                  : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
              }`}
            >
              {tab.label}
              {stat ? (
                <span className="ml-1.5 tabular-nums opacity-70">
                  {stat.unlocked}/{stat.total}
                </span>
              ) : null}
            </button>
          );
        })}

        <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={onlyUnlocked}
            onChange={(e) => setOnlyUnlocked(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-400"
          />
          只看已解锁
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-center text-sm text-neutral-500">
          这个筛选条件下没有成就。
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a) => (
            <AchievementCard key={a.apiName} achievement={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AchievementCard({ achievement }: { achievement: AchievementView }) {
  const { achieved, hidden, description, displayName, globalPercent, icon, iconGray } = achievement;

  const iconUrl = proxiedImageUrl(achieved ? icon : iconGray || icon);
  // 未解锁的隐藏成就：Steam 不给描述（防剧透），不要把空描述当"没有描述"
  const descText = hidden && !achieved ? '隐藏成就 —— 解锁后才会揭示内容。' : description || '（Steam 未提供描述）';

  return (
    <li
      className={`flex gap-3 rounded-lg border p-3 transition ${
        achieved
          ? 'border-amber-500/30 bg-amber-500/[0.06]'
          : 'border-neutral-800 bg-neutral-900/40'
      }`}
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          width={48}
          height={48}
          className={`h-12 w-12 shrink-0 rounded object-cover ${achieved ? '' : 'opacity-40 grayscale'}`}
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded bg-neutral-800" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h4
            className={`min-w-0 flex-1 text-sm font-medium leading-snug ${
              achieved ? 'text-amber-200' : 'text-neutral-300'
            }`}
          >
            {displayName}
          </h4>
          {achieved ? (
            <span className="shrink-0 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              已解锁
            </span>
          ) : (
            <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
              未解锁
            </span>
          )}
        </div>

        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-neutral-500">{descText}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <span title="全世界的 Steam 玩家中有多少比例解锁了这个成就">
            全球 {formatPercent(globalPercent)} 玩家已解锁
          </span>
          {achieved ? <span>解锁于 {formatUnix(achievement.unlockTime)}</span> : null}
        </div>
      </div>
    </li>
  );
}
