/** 前端共用的小工具 */

/** Unix 秒 → 本地日期时间；0 / 空值返回占位符 */
export function formatUnix(seconds: number | undefined): string {
  if (!seconds) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 分钟 → "123 小时 45 分钟" */
export function formatPlaytime(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} 分钟`;
  return `${hours} 小时 ${mins} 分钟`;
}

/**
 * Steam 社区图片走本站代理，避免直连 Steam CDN 的跨域与防盗链问题。
 * 只允许 Steam 官方域名，防止被当成开放代理滥用（SSRF 防护）。
 */
export function proxiedImageUrl(original: string | undefined): string {
  if (!original) return '';
  const allowed =
    original.startsWith('https://avatars.steamstatic.com/') ||
    original.startsWith('https://avatars.cloudflare.steamstatic.com/') ||
    original.startsWith('https://cdn.akamai.steamstatic.com/steamcommunity/public/images/') ||
    original.startsWith('https://community.cloudflare.steamstatic.com/');
  if (!allowed) return '';
  return `/api/img?url=${encodeURIComponent(original)}`;
}

/** 百分比的展示格式 */
export function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

/** 物品 ID 展示：社区习惯用 8 位十六进制 */
export function formatItemId(itemId: number): string {
  return `0x${itemId.toString(16).padStart(8, '0').toUpperCase()}`;
}
