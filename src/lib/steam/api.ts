/**
 * Steam Web API 封装。
 *
 * 只使用官方公开的只读接口（全部为 GET）：
 *   - ISteamUser/GetPlayerSummaries/v2     玩家昵称 / 头像
 *   - ISteamUser/GetOwnedGames/v1          拥有哪些游戏、时长
 *   - ISteamUserStats/GetSchemaForGame/v2  某游戏全部成就的定义（名称/描述/图标/全局完成率）
 *   - ISteamUserStats/GetPlayerAchievements/v1  某玩家每个成就的解锁状态与时间
 *
 * API Key 只在此模块从服务端环境变量读取，绝不发往浏览器。
 */

import { ensureProxyDispatcher } from '@/lib/net/proxy';
import { ELDEN_RING_APPID } from '@/types/er';
import type { AchievementDef, OwnedGameInfo, PlayerSummary } from '@/types/er';

const API_BASE = 'https://api.steampowered.com';

/** 缓存时长：成就定义几乎不变，玩家成就也不会秒级变化 */
const SCHEMA_TTL_MS = 60 * 60 * 1000; // 1 小时
const PLAYER_TTL_MS = 15 * 60 * 1000; // 15 分钟
const SUMMARY_TTL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * Steam 未公布速率限制，实测约每分钟 100 次会 429，这里做退避重试。
 *
 * 取值依据（实测）：本机到 api.steampowered.com 的连通性会间歇性抽风，
 * 曾出现「连续 2 次连接超时、第 3 次成功」。fetch 默认 10 秒超时对跨境连接也偏短，
 * 所以这里放宽到 20 秒并给到 4 次重试 —— 重试次数太少会把网络抖动
 * 误报成"数据读取失败"，而这恰恰是最容易误导用户的失败模式。
 */
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 700;
const REQUEST_TIMEOUT_MS = 20_000;

export type SteamErrorCode =
  | 'NO_API_KEY'
  | 'NOT_FOUND'
  | 'PRIVATE_PROFILE'
  | 'GAME_NOT_OWNED'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE';

export class SteamApiError extends Error {
  readonly code: SteamErrorCode;
  readonly httpStatus?: number;

  constructor(code: SteamErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'SteamApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function getApiKey(): string {
  const key = process.env.STEAM_API_KEY;
  if (!key) {
    throw new SteamApiError(
      'NO_API_KEY',
      '服务端缺少 STEAM_API_KEY。请在 .env.local 中填入你的 Steam Web API Key 后重启服务。',
    );
  }
  return key;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.STEAM_API_KEY);
}

/* ------------------------------------------------------------------ *
 * 内存缓存
 * ------------------------------------------------------------------ */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** 定期清理过期项，避免长跑进程内存缓慢增长 */
if (typeof setInterval === 'function') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now > entry.expiresAt) cache.delete(key);
    }
  }, 10 * 60 * 1000);
  // 不要因为这个定时器阻止进程退出
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
}

/* ------------------------------------------------------------------ *
 * 低层请求
 * ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface RawResponse {
  [key: string]: unknown;
}

async function steamGet(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<RawResponse> {
  const key = getApiKey();
  const search = new URLSearchParams({ key, format: 'json' });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const url = `${API_BASE}/${path}?${search.toString()}`;

  // 必须在发请求前把代理装好：undici 不会在运行时读取代理环境变量，
  // 而 Next 载入 .env.local 的时机又晚于 undici 初始化。
  await ensureProxyDispatcher();

  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        const reason =
          (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message;
        throw new SteamApiError(
          'HTTP_ERROR',
          `无法连接 Steam API（重试 ${MAX_RETRIES} 次后仍失败）：${reason}`,
        );
      }
      continue;
    }

    lastStatus = res.status;

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new SteamApiError(
          'RATE_LIMITED',
          'Steam API 请求过于频繁（HTTP 429），请稍后再试。',
          429,
        );
      }
      continue;
    }

    if (!res.ok) {
      throw new SteamApiError('HTTP_ERROR', `Steam API 返回 HTTP ${res.status}`, res.status);
    }

    const text = await res.text();
    if (!text.trim()) {
      throw new SteamApiError('BAD_RESPONSE', 'Steam API 返回了空响应');
    }

    try {
      return JSON.parse(text) as RawResponse;
    } catch {
      throw new SteamApiError('BAD_RESPONSE', 'Steam API 返回的不是合法 JSON');
    }
  }

  throw new SteamApiError('HTTP_ERROR', `Steam API 重试耗尽（最后状态码 ${lastStatus}）`, lastStatus);
}

/* ------------------------------------------------------------------ *
 * 玩家摘要
 * ------------------------------------------------------------------ */

interface RawPlayer {
  steamid?: string;
  personaname?: string;
  profileurl?: string;
  avatar?: string;
  avatarmedium?: string;
  avatarfull?: string;
  personastate?: number;
  communityvisibilitystate?: number;
}

export async function getPlayerSummaries(steamIds: string[]): Promise<PlayerSummary[]> {
  if (steamIds.length === 0) return [];
  const ids = steamIds.slice(0, 100).join(',');

  const cacheKey = `summary:${ids}`;
  const cached = cacheGet<PlayerSummary[]>(cacheKey);
  if (cached) return cached;

  const json = await steamGet('ISteamUser/GetPlayerSummaries/v2', { steamids: ids });
  const players = (json.response as { players?: RawPlayer[] } | undefined)?.players ?? [];

  const result: PlayerSummary[] = players.map((p) => ({
    steamId: p.steamid ?? '',
    personaName: p.personaname ?? '(未知昵称)',
    profileUrl: p.profileurl ?? '',
    avatar: p.avatar ?? '',
    avatarMedium: p.avatarmedium ?? '',
    avatarFull: p.avatarfull ?? '',
    personaState: p.personastate ?? 0,
    visibility: p.communityvisibilitystate ?? 1,
  }));

  cacheSet(cacheKey, result, SUMMARY_TTL_MS);
  return result;
}

export async function getPlayerSummary(steamId: string): Promise<PlayerSummary> {
  const list = await getPlayerSummaries([steamId]);
  const found = list.find((p) => p.steamId === steamId) ?? list[0];
  if (!found || !found.steamId) {
    throw new SteamApiError('NOT_FOUND', `Steam 上找不到该账号（${steamId}）`);
  }
  return found;
}

/** 公开档案：CommunityVisibilityState === 3 */
export function isProfilePublic(player: PlayerSummary): boolean {
  return player.visibility === 3;
}

/* ------------------------------------------------------------------ *
 * 游戏库
 * ------------------------------------------------------------------ */

interface RawOwnedGame {
  appid?: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
}

export async function getOwnedGame(
  steamId: string,
  appId: number = ELDEN_RING_APPID,
): Promise<OwnedGameInfo | null> {
  const cacheKey = `owned:${steamId}:${appId}`;
  const cached = cacheGet<OwnedGameInfo | null>(cacheKey);
  if (cached !== undefined) return cached;

  // ⚠️ 实测：appids_filter 参数**不生效** —— 传单个 AppID 仍然会返回整个游戏库
  // （实测某账号返回 76 个游戏）。所以这里必须自己过滤，不能指望服务端筛。
  const json = await steamGet('IPlayerService/GetOwnedGames/v1', {
    steamid: steamId,
    include_appinfo: 1,
    include_played_free_games: 1,
  });

  const response = json.response as { games?: RawOwnedGame[] } | undefined;
  // 档案私密或未公开游戏详情时，response 里通常连 games 字段都没有
  if (!response || !Array.isArray(response.games)) {
    throw new SteamApiError(
      'PRIVATE_PROFILE',
      '读取不到游戏库。请把 Steam 个人资料的「游戏详情」设为公开。',
    );
  }

  const game = response.games.find((g) => g.appid === appId);
  const result: OwnedGameInfo | null = game
    ? {
        appId: game.appid ?? appId,
        name: game.name,
        playtimeForeverMinutes: game.playtime_forever ?? 0,
        playtimeTwoWeeksMinutes: game.playtime_2weeks ?? 0,
        lastPlayed: game.rtime_last_played || undefined,
      }
    : null;

  cacheSet(cacheKey, result, PLAYER_TTL_MS);
  return result;
}

/* ------------------------------------------------------------------ *
 * 成就定义（Schema）
 * ------------------------------------------------------------------ */

interface RawSchemaAchievement {
  name?: string;
  defaultvalue?: number;
  displayName?: string;
  hidden?: number;
  description?: string;
  icon?: string;
  icongray?: string;
}

interface RawGameSchema {
  gameName?: string;
  availableGameStats?: {
    achievements?: RawSchemaAchievement[];
    stats?: unknown[];
  };
}

interface RawGlobalPercent {
  name?: string;
  /**
   * ⚠️ 实测：Steam 这个接口返回的 percent 是**字符串**（如 "36.2"），不是数字。
   * 按数字声明会让 `percent.toFixed()` 在运行时炸掉 —— 这个坑真的踩过。
   */
  percent?: number | string;
}

/** 把 Steam 可能返回的字符串/数字统一成 0–100 的数值，异常值一律归 0 */
function normalizePercent(value: number | string | undefined): number {
  if (value === undefined) return 0;
  const num = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  return Number(Math.min(100, Math.max(0, num)).toFixed(1));
}

/**
 * 取某游戏全部成就的定义。顺带拉一次全局完成率用于对比。
 * 这里返回的是**未经语义分类**的原始定义，分类在 lib/er/achievements.ts 做。
 */
export async function getGameSchema(
  appId: number = ELDEN_RING_APPID,
): Promise<{ gameName: string; definitions: Omit<AchievementDef, 'category'>[] }> {
  const cacheKey = `schema:${appId}`;
  const cached = cacheGet<{ gameName: string; definitions: Omit<AchievementDef, 'category'>[] }>(
    cacheKey,
  );
  if (cached) return cached;

  // l=schinese 必须带上：不带时 Steam 返回英文成就名，
  // 而映射表是按中文名建立的，会让界面中英混杂（实测踩过）。
  const json = await steamGet('ISteamUserStats/GetSchemaForGame/v2', {
    appid: appId,
    l: 'schinese',
  });
  const game = json.game as RawGameSchema | undefined;
  const rawAch = game?.availableGameStats?.achievements;

  if (!game || !Array.isArray(rawAch)) {
    throw new SteamApiError(
      'BAD_RESPONSE',
      `Steam 没有返回 AppID ${appId} 的成就定义（该游戏可能没有成就系统）。`,
    );
  }

  // 全局完成率是另一个接口，失败不影响主流程
  const globalPercents = new Map<string, number>();
  try {
    const gp = await steamGet('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2', {
      gameid: appId,
    });
    const list =
      (gp.achievementpercentages as { achievements?: RawGlobalPercent[] } | undefined)
        ?.achievements ?? [];
    for (const item of list) {
      if (item.name) globalPercents.set(item.name, normalizePercent(item.percent));
    }
  } catch {
    // 忽略：UI 会显示 completionRate 为 0
  }

  const definitions = rawAch
    .filter((a): a is RawSchemaAchievement & { name: string } => Boolean(a.name))
    .map((a) => ({
      apiName: a.name,
      displayName: a.displayName?.trim() || a.name,
      description: a.description?.trim() || '',
      hidden: a.hidden === 1,
      globalPercent: normalizePercent(globalPercents.get(a.name)),
      icon: a.icon ?? '',
      iconGray: a.icongray ?? '',
    }));

  const result = { gameName: game.gameName ?? '', definitions };
  cacheSet(cacheKey, result, SCHEMA_TTL_MS);
  return result;
}

/* ------------------------------------------------------------------ *
 * 玩家成就
 * ------------------------------------------------------------------ */

export interface RawPlayerAchievement {
  apiName: string;
  achieved: boolean;
  unlockTime: number;
}

export async function getPlayerAchievements(
  steamId: string,
  appId: number = ELDEN_RING_APPID,
  force = false,
): Promise<RawPlayerAchievement[]> {
  const cacheKey = `ach:${steamId}:${appId}`;
  if (!force) {
    const cached = cacheGet<RawPlayerAchievement[]>(cacheKey);
    if (cached) return cached;
  }

  const json = await steamGet('ISteamUserStats/GetPlayerAchievements/v1', {
    steamid: steamId,
    appid: appId,
    l: 'schinese',
  });

  const response = json.playerstats as
    | {
        success?: boolean;
        error?: string;
        achievements?: {
          apiname?: string;
          achieved?: number;
          unlocktime?: number;
        }[];
      }
    | undefined;

  if (!response && json.playerstats === undefined) {
    throw new SteamApiError('PRIVATE_PROFILE', 'Steam 没有返回该玩家的成就数据。');
  }

  if (response?.success === false) {
    const msg = response.error ?? '未知错误';
    if (/profile.*not.*public|not public/i.test(msg)) {
      throw new SteamApiError(
        'PRIVATE_PROFILE',
        '该玩家的游戏详情不是公开的，无法读取成就。请到 Steam 隐私设置里把「游戏详情」改为公开。',
      );
    }
    if (/no stats|does not have|not own/i.test(msg)) {
      throw new SteamApiError('GAME_NOT_OWNED', `该账号没有艾尔登法环的成就记录（${msg}）。`);
    }
    throw new SteamApiError('BAD_RESPONSE', `Steam 返回错误：${msg}`);
  }

  const list = response?.achievements ?? [];
  const result: RawPlayerAchievement[] = list
    .filter((a): a is { apiname: string; achieved?: number; unlocktime?: number } =>
      Boolean(a.apiname),
    )
    .map((a) => ({
      apiName: a.apiname,
      achieved: a.achieved === 1,
      unlockTime: a.unlocktime ?? 0,
    }));

  cacheSet(cacheKey, result, PLAYER_TTL_MS);
  return result;
}
