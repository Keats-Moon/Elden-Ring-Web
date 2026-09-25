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
 * 允许代理的 Steam CDN 根域。
 *
 * `steamstatic.com` 是 Valve 自有的 CDN 域，其全部子域都归 Valve 控制，
 * 因此按**域后缀**放行既安全又不用逐一列举 —— 而逐一列举正是之前的 bug：
 * 白名单里只有 `community.cloudflare.steamstatic.com`，
 * 却漏了成就图标实际所在的 `cdn.cloudflare.steamstatic.com`，
 * 导致图标被静默丢弃（proxiedImageUrl 返回空字符串，图标不渲染）。
 */
const ALLOWED_CDN_SUFFIXES = ['.steamstatic.com'];

function isAllowedSteamCdn(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    host = parsed.hostname;
  } catch {
    return false;
  }
  // 注意用带点的后缀比较，避免 evil-steamstatic.com 这类域名被误放行
  return ALLOWED_CDN_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/**
 * Steam 社区图片走本站代理，避免直连 Steam CDN 的跨域与防盗链问题。
 * 只允许 Steam 官方 CDN 域，防止被当成开放代理滥用（SSRF 防护）。
 */
export function proxiedImageUrl(original: string | undefined): string {
  if (!original) return '';
  if (!isAllowedSteamCdn(original)) return '';
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
