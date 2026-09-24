'use client';

import { useRef, useState } from 'react';
import type { SaveCharacter, SaveParseError, SaveParseResult } from '@/types/er';
import { formatItemId } from '@/lib/format';
import CollectionChecklist from './CollectionChecklist';
import SourceBadge from './SourceBadge';

type Status =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'ok'; result: SaveParseResult }
  | { kind: 'error'; error: SaveParseError };

/**
 * 存档上传与展示。
 *
 * 隐私与安全说明（界面上也如实告知用户）：
 *  - 文件只在服务端内存里解析，不写磁盘、不入库，不保留任何副本。
 *  - 只读解析，绝不修改存档，因此不会损坏存档、也不会触发反作弊。
 *  - 结果只回传给当前登录用户自己。
 */
export default function SaveUploader() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [activeSlot, setActiveSlot] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStatus({ kind: 'uploading' });

    const form = new FormData();
    form.append('save', file);

    try {
      const res = await fetch('/api/save', { method: 'POST', body: form });
      const payload = (await res.json()) as SaveParseResult | SaveParseError;

      if (!res.ok || payload.ok === false) {
        setStatus({ kind: 'error', error: payload as SaveParseError });
        return;
      }

      setActiveSlot(0);
      setStatus({ kind: 'ok', result: payload });
    } catch (err) {
      setStatus({
        kind: 'error',
        error: {
          ok: false,
          error: `上传失败：${(err as Error).message}`,
          stage: 'network',
          diagnostics: [],
        },
      });
    }
  }

  const uploading = status.kind === 'uploading';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".sl2,.co2,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-amber-400/50 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? '解析中…' : '选择 ER0000.sl2 文件'}
          </button>

          {status.kind === 'ok' ? (
            <button
              type="button"
              onClick={() => {
                setStatus({ kind: 'idle' });
                if (inputRef.current) inputRef.current.value = '';
              }}
              className="rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
            >
              清除已解析的数据
            </button>
          ) : null}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          存档位置：<code className="text-neutral-400">%APPDATA%\EldenRing\&lt;你的SteamID64&gt;\ER0000.sl2</code>
          <br />
          这是<strong className="text-neutral-300">只读</strong>解析：文件只在服务器内存中处理，不写磁盘、不入库；
          绝不修改你的存档，因此不会损坏存档也不会触发反作弊。主机版（PS5 / Xbox）存档无法导出，不支持。
        </p>
      </div>

      {status.kind === 'error' ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4">
          <div className="text-sm font-medium text-rose-300">解析失败（阶段：{status.error.stage}）</div>
          <p className="mt-1 text-xs leading-relaxed text-rose-200/90">{status.error.error}</p>
          {status.error.diagnostics.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-rose-300/80">诊断信息</summary>
              <ul className="mt-2 space-y-1 text-[11px] text-rose-200/70">
                {status.error.diagnostics.map((d, i) => (
                  <li key={i} className="font-mono">
                    {d}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {status.kind === 'ok' ? <ParsedSave result={status.result} activeSlot={activeSlot} onSelect={setActiveSlot} /> : null}
    </div>
  );
}

function ParsedSave({
  result,
  activeSlot,
  onSelect,
}: {
  result: SaveParseResult;
  activeSlot: number;
  onSelect: (slot: number) => void;
}) {
  const character = result.characters[activeSlot] ?? result.characters[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SourceBadge source="save" />
        <span className="text-xs text-neutral-400">
          解析出 {result.slotCount} 个角色
          {result.steamId ? (
            <>
              ，存档归属账号 <span className="font-mono text-neutral-300">{result.steamId}</span>
            </>
          ) : null}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            result.checksumsValid
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
        >
          {result.checksumsValid ? 'MD5 校验通过' : 'MD5 校验不匹配'}
        </span>
      </div>

      {/* 角色切换 */}
      <div className="flex flex-wrap gap-2">
        {result.characters.map((c, index) => (
          <button
            key={c.slot}
            type="button"
            onClick={() => onSelect(index)}
            className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
              index === activeSlot
                ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
            }`}
          >
            <div className="font-medium">{c.name}</div>
            <div className="text-[10px] opacity-70">
              槽位 {c.slot} · Lv {c.level}
            </div>
          </button>
        ))}
      </div>

      {character ? <CharacterPanel character={character} /> : null}

      {result.diagnostics.length > 0 ? (
        <details className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <summary className="cursor-pointer text-xs text-neutral-400">
            解析诊断（{result.diagnostics.length} 条）—— 偏移是否可信看这里
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-neutral-500">
            {result.diagnostics.map((d, i) => (
              <li key={i} className="font-mono">
                {d}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const STAT_LABELS: { key: keyof SaveCharacter['stats']; label: string }[] = [
  { key: 'vigor', label: '生命力' },
  { key: 'mind', label: '集中力' },
  { key: 'endurance', label: '耐力' },
  { key: 'strength', label: '力气' },
  { key: 'dexterity', label: '灵巧' },
  { key: 'intelligence', label: '智力' },
  { key: 'faith', label: '信仰' },
  { key: 'arcane', label: '感应' },
];

function CharacterPanel({ character }: { character: SaveCharacter }) {
  return (
    <div className="space-y-4">
      {!character.afterAnchorSupported ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="text-sm font-medium text-amber-200">
            这份存档的格式版本（{character.version}）超出已验证范围
          </div>
          <p className="mt-2 text-xs leading-relaxed text-amber-200/90">
            存档里<span className="font-medium">锚点之前</span>的字段——角色名、等级、卢恩、八项属性——
            已经用真实存档逐项验证，可以放心使用（见下方）。
            但<span className="font-medium">背包与装备</span>位于锚点之后，依赖固定偏移推算；
            该区域在较新版本中结构已变化，本项目尚未验证。
            <strong className="font-medium">因此这里不显示物品清单，而不是说这个角色没有物品。</strong>
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-amber-300/80">为什么做不到，以及缺什么</summary>
            <p className="mt-2 text-[11px] leading-relaxed text-amber-200/70">
              锚点之后的解析链是「物品表 → 背包 → 储物箱 → 装备区」。其中物品表是
              <strong>变长记录</strong>（武器 21 字节、防具 16 字节、其余 8 字节），
              一旦第一条读错，后面整条链全部错位。新版本中该表的结构与社区文档记载的不一致。
              要补上这一块，需要一份针对该版本、已验证正确的字段偏移资料。
            </p>
          </details>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <h4 className="mb-3 text-sm font-medium text-neutral-200">角色属性</h4>
          <div className="mb-3 flex items-baseline gap-4">
            <span className="text-2xl font-semibold tabular-nums text-amber-300">
              Lv {character.level}
            </span>
            <span className="text-xs text-neutral-400">
              持有卢恩{' '}
              <span className="tabular-nums text-neutral-300">
                {character.runes.toLocaleString('zh-CN')}
              </span>
            </span>
            <span className="ml-auto text-[11px] text-neutral-500">
              槽位版本 {character.version}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {STAT_LABELS.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between border-b border-neutral-800/60 py-1"
              >
                <dt className="text-neutral-400">{label}</dt>
                <dd className="tabular-nums text-neutral-200">{character.stats[key] ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <h4 className="mb-3 text-sm font-medium text-neutral-200">
            {character.afterAnchorSupported ? '当前装备' : '当前装备（暂不支持）'}
          </h4>
          {!character.afterAnchorSupported ? (
            <p className="text-xs leading-relaxed text-neutral-500">
              该存档版本的装备区偏移尚未验证，因此不展示。这不是「没有装备」。
            </p>
          ) : character.equipped.length === 0 ? (
            <p className="text-xs text-neutral-500">未读取到装备信息。</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {character.equipped.map((eq) => (
                <li key={`${eq.slot}-${eq.itemId}`} className="flex items-center justify-between gap-3">
                  <span className="shrink-0 text-neutral-400">{eq.slot}</span>
                  <span className="truncate font-mono text-amber-300/90">
                    {eq.name || formatItemId(eq.itemId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <h4 className="mb-3 text-sm font-medium text-neutral-200">
          {character.afterAnchorSupported ? '收集清单' : '收集清单（暂不支持）'}
        </h4>
        {character.afterAnchorSupported ? (
          <CollectionChecklist character={character} />
        ) : (
          <p className="text-xs leading-relaxed text-neutral-500">
            背包区包含易失准的变长结构，在当前存档版本上未经证实，故不展示 ——
            <span className="text-neutral-400">这并不表示该角色没有收集到物品</span>。
            角色的等级、属性与名称已正确解析，见上方。
          </p>
        )}
      </section>
    </div>
  );
}
