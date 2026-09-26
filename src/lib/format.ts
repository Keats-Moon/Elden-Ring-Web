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
 * 允许代理的 Steam 图片域名。
 *
 * ⚠️ 这份清单是用**真实数据核对**出来的，不是凭印象写的。同一个问题踩了两次：
 *
 *   1. 最初只列了头像的域 + `community.cloudflare.steamstatic.com`，
 *      漏了成就图标域 —— 图标被静默丢弃，界面不报错、只是没图。
 *   2. 第二次想当然改成"`steamstatic.com` 后缀匹配" —— **依然是错的**：
 *      实测 Steam 成就图标托管在 **`steamcdn-a.akamaihd.net`**，
 *      跟 `steamstatic.com` 毫无关系。
 *
 * 结论：改为**明确列举**，每一项都经过实测。要新增域名必须先用真实 URL 验证，
 * 不要再靠推测。
 */
const ALLOWED_STEAM_IMAGE_HOSTS = new Set([
  // 成就图标（实测：GetSchemaForGame 返回的 icon / icongray 就在这里）
  'steamcdn-a.akamaihd.net',
  // 头像与社区图片
  'avatars.steamstatic.com',
  'avatars.cloudflare.steamstatic.com',
  'community.cloudflare.steamstatic.com',
  'cdn.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'shared.cloudflare.steamstatic.com',
]);

function isAllowedSteamImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_STEAM_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Steam 图片走本站代理，避免直连 Steam CDN 的跨域与防盗链问题。
 * 只允许 Steam 官方图片域，防止被当成开放代理滥用（SSRF 防护）。
 */
export function proxiedImageUrl(original: string | undefined): string {
  if (!original) return '';
  if (!isAllowedSteamImage(original)) return '';
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
