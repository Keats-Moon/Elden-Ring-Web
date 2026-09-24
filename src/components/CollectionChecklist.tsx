'use client';

import { useMemo, useState } from 'react';
import type { SaveCharacter } from '@/types/er';
import { formatItemId } from '@/lib/format';

const CATEGORY_ORDER = ['weapon', 'armor', 'talisman', 'ash_of_war', 'goods', 'unknown'] as const;

const CATEGORY_LABEL: Record<string, string> = {
  weapon: '武器',
  armor: '防具',
  talisman: '护符',
  ash_of_war: '战灰',
  goods: '道具',
  unknown: '未分类',
};

/**
 * 收集清单：展示某个角色的背包 + 储物箱内容。
 *
 * 物品名称说明：Steam 与本项目都不提供"物品 ID → 名称"的授权映射表，
 * 因此未命中名称表时**如实显示物品 ID**（社区通用格式 0xXXXXXXXX），
 * 而不是编一个假名字。UI 里点击可复制 ID，便于对照社区资料自查。
 */
export default function CollectionChecklist({ character }: { character: SaveCharacter }) {
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of character.inventory) {
      map.set(item.category, (map.get(item.category) ?? 0) + 1);
    }
    return map;
  }, [character]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return character.inventory
      .filter((item) => (category === 'all' ? true : item.category === category))
      .filter((item) => {
        if (!q) return true;
        const name = item.name.toLowerCase();
        const hex = formatItemId(item.itemId).toLowerCase();
        return name.includes(q) || hex.includes(q) || String(item.itemId).includes(q);
      })
      .sort((a, b) => b.quantity - a.quantity || a.itemId - b.itemId);
  }, [character, category, query]);

  const totalDistinct = character.inventory.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCategory('all')}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            category === 'all'
              ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
          }`}
        >
          全部
          <span className="ml-1.5 tabular-nums opacity-70">{totalDistinct}</span>
        </button>

        {CATEGORY_ORDER.filter((c) => (byCategory.get(c) ?? 0) > 0).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              category === c
                ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
            }`}
          >
            {CATEGORY_LABEL[c] ?? c}
            <span className="ml-1.5 tabular-nums opacity-70">{byCategory.get(c) ?? 0}</span>
          </button>
        ))}

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索名称或物品 ID…"
          className="ml-auto w-48 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-amber-400/60 focus:outline-none"
        />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-center text-sm text-neutral-500">
          没有匹配的物品。如果整份清单都是空的，说明这个槽位的背包偏移与当前游戏版本不一致。
        </p>
      ) : (
        <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-neutral-800">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-neutral-900 text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">物品</th>
                <th className="px-3 py-2 font-medium">类别</th>
                <th className="px-3 py-2 text-right font-medium">数量</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.itemId} className="border-t border-neutral-800/70 hover:bg-neutral-800/30">
                  <td className="px-3 py-2">
                    <div className="text-neutral-200">
                      {item.name || (
                        <span className="font-mono text-amber-300/90">{formatItemId(item.itemId)}</span>
                      )}
                    </div>
                    {item.name ? (
                      <div className="font-mono text-[10px] text-neutral-600">
                        {formatItemId(item.itemId)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">
                    {CATEGORY_LABEL[item.category] ?? item.category}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                    {item.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-neutral-500">
        共 {rows.length} 条（该角色合计 {totalDistinct} 种物品）。未显示名称的条目表示本项目的
        名称映射表尚未收录该 ID —— 这是数据来源问题，不是解析失败。
      </p>
    </div>
  );
}
