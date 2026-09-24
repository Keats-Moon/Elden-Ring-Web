'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AchievementsResponse, MeResponse } from '@/types/er';
import AchievementList from './AchievementList';
import BossList from './BossList';
import PlayerCard from './PlayerCard';
import SaveUploader from './SaveUploader';
import SourceBadge from './SourceBadge';

type Tab = 'achievements' | 'bosses' | 'save';

const TABS: { key: Tab; label: string }[] = [
  { key: 'achievements', label: '成就清单' },
  { key: 'bosses', label: 'Boss 与结局' },
  { key: 'save', label: '存档收集清单' },
];

interface ApiError {
  error: string;
  code?: string;
}

interface LoadedData {
  me: MeResponse | null;
  meError: string | null;
  achievements: AchievementsResponse | null;
  achError: string | null;
}

/**
 * 纯数据获取函数（不含任何 setState）。
 *
 * 之所以独立出来：在 effect 里同步调用 setState 会触发级联渲染，
 * React 的 lint 规则会直接报错。这里只负责"取回数据"，
 * 由调用方在 await 之后统一写入状态。
 */
async function fetchAll(force: boolean): Promise<LoadedData> {
  const [meRes, achRes] = await Promise.allSettled([
    fetch('/api/me', { cache: 'no-store' }).then(async (r) => ({
      ok: r.ok,
      body: (await r.json()) as unknown,
    })),
    fetch(`/api/achievements${force ? '?refresh=1' : ''}`, { cache: 'no-store' }).then(async (r) => ({
      ok: r.ok,
      body: (await r.json()) as unknown,
    })),
  ]);

  const result: LoadedData = { me: null, meError: null, achievements: null, achError: null };

  if (meRes.status === 'fulfilled') {
    if (meRes.value.ok) result.me = meRes.value.body as MeResponse;
    else result.meError = (meRes.value.body as ApiError).error ?? '读取玩家信息失败';
  } else {
    result.meError = `读取玩家信息失败：${String(meRes.reason)}`;
  }

  if (achRes.status === 'fulfilled') {
    if (achRes.value.ok) result.achievements = achRes.value.body as AchievementsResponse;
    else result.achError = (achRes.value.body as ApiError).error ?? '读取成就失败';
  } else {
    result.achError = `读取成就失败：${String(achRes.reason)}`;
  }

  return result;
}

/**
 * 已登录后的主面板。
 * 数据全部通过本站的服务端 API 获取 —— Steam API Key 从不进入浏览器。
 */
export default function Dashboard({ steamId }: { steamId: string }) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('achievements');

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 手动刷新（点击按钮触发，不在 effect 里，可以安全地同步置位）
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const next = await fetchAll(true);
    if (!alive.current) return;
    setData(next);
    setRefreshing(false);
  }, []);

  // 首次加载：setState 只出现在 await 之后的异步回调里，
  // 不在 effect 体内同步调用（否则会触发级联渲染，React lint 会报错）。
  useEffect(() => {
    void (async () => {
      const next = await fetchAll(false);
      if (!alive.current) return;
      setData(next);
    })();
  }, []);

  const loading = data === null;
  const progress = data?.achievements?.progress;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-amber-400/70">
            Elden Ring Tracker
          </p>
          <h1 className="text-xl font-semibold text-neutral-100">我的艾尔登法环数据</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={refreshing || loading}
            onClick={() => void refresh()}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-50"
          >
            {refreshing ? '刷新中…' : '刷新数据'}
          </button>
          <a
            href="/logout"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
          >
            退出登录
          </a>
        </div>
      </header>

      {data?.me ? (
        <PlayerCard
          player={data.me.player}
          ownsGame={data.me.ownsGame}
          libraryWarning={data.me.libraryWarning}
          playtimeForever={data.me.game?.playtimeForeverMinutes}
          lastPlayed={data.me.game?.lastPlayed}
          achievementPercent={progress?.percent ?? 0}
          achievementLabel={progress ? `${progress.unlocked}/${progress.total}` : '—'}
        />
      ) : data?.meError ? (
        <ErrorBox title="读取玩家信息失败" message={data.meError} onRetry={() => void refresh()} />
      ) : (
        <SkeletonBlock lines={2} />
      )}

      {data?.achError ? (
        <ErrorBox title="读取成就失败" message={data.achError} onRetry={() => void refresh()} />
      ) : null}

      <nav className="flex flex-wrap gap-2 border-b border-neutral-800 pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              tab === t.key
                ? 'bg-amber-400/15 text-amber-200'
                : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <SkeletonBlock lines={6} />
      ) : (
        <>
          {tab === 'achievements' ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <SourceBadge source="steam" />
                {progress ? (
                  <span className="text-xs text-neutral-400">
                    共 {progress.total} 个成就，已解锁{' '}
                    <span className="font-semibold text-amber-300">{progress.unlocked}</span> 个
                  </span>
                ) : null}
              </div>
              {data?.achievements?.warning ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {data.achievements.warning}
                </p>
              ) : null}
              {progress ? <AchievementList achievements={progress.achievements} /> : null}
            </section>
          ) : null}

          {tab === 'bosses' ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <SourceBadge source="steam" />
              </div>
              {data?.achievements ? <BossList bosses={data.achievements.bosses} /> : null}
            </section>
          ) : null}

          {tab === 'save' ? <SaveUploader /> : null}
        </>
      )}

      <footer className="border-t border-neutral-800 pt-6 text-[11px] leading-relaxed text-neutral-600">
        <p>
          本站使用 Steam 官方 Web API 读取公开的成就与游戏库数据；存档功能仅在服务端内存中只读解析，不写磁盘、不入库。
        </p>
        <p className="mt-1">
          当前登录账号 <span className="font-mono">{steamId}</span>。与艾尔登法环相关的商标与内容归 FromSoftware /
          万代南梦宫所有，本站为非官方工具。
        </p>
      </footer>
    </main>
  );
}

function ErrorBox({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4">
      <div className="text-sm font-medium text-rose-300">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-rose-200/90">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-rose-400/50 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-500/20"
        >
          重试
        </button>
      ) : null}
    </div>
  );
}

function SkeletonBlock({ lines }: { lines: number }) {
  return (
    <div className="animate-pulse space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-neutral-800" style={{ width: `${90 - i * 8}%` }} />
      ))}
    </div>
  );
}
