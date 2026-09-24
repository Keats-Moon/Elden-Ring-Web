/**
 * 会话管理：把登录用户的 SteamID64 存进 HMAC 签名的 HttpOnly Cookie。
 *
 * 设计取舍：
 *  - 不存数据库（本项目只做实时查询），因此不引入服务端 session 表。
 *  - 不加密，只签名。steamId64 本身不是秘密，签名保证用户无法伪造成别人。
 *  - 密钥优先取 SESSION_SECRET；没配则从 STEAM_API_KEY 派生并告警 —— 不静默
 *    用弱默认值，否则任何人都能自己签一个 Cookie 冒充任意用户。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'ert_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 天

interface SessionPayload {
  steamId: string;
  /** 签发时间（Unix 秒） */
  iat: number;
}

let warnedAboutSecret = false;

function getSecret(): string {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  const fallback = process.env.STEAM_API_KEY;
  if (fallback && fallback.length >= 16) {
    if (!warnedAboutSecret) {
      console.warn(
        '[session] 未设置 SESSION_SECRET，正在从 STEAM_API_KEY 派生签名密钥。' +
          '生产环境请显式设置一个独立的 SESSION_SECRET。',
      );
      warnedAboutSecret = true;
    }
    return fallback;
  }

  throw new Error(
    '缺少会话密钥：请在 .env.local 中设置 SESSION_SECRET（任意 32 位以上随机字符串）。',
  );
}

/** 会话密钥是否已配置（供首页给出可操作的配置提示，不泄露密钥本身） */
export function hasSessionSecret(): boolean {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 16) return true;
  const fallback = process.env.STEAM_API_KEY;
  return Boolean(fallback && fallback.length >= 16);
}

function sign(data: string): string {
  return createHmac('sha256', getSecret()).update(data).digest('base64url');
}

/** 生成 `<payload>.<signature>` 形式的 Cookie 值 */
export function encodeSession(steamId: string): string {
  const payload: SessionPayload = { steamId, iat: Math.floor(Date.now() / 1000) };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/** 校验并解出 SteamID64；失败返回 null */
export function decodeSession(token: string | undefined): string | null {
  if (!token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let expectedSig: string;
  try {
    expectedSig = sign(body);
  } catch {
    return null;
  }

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.steamId !== 'string' || !/^\d{17}$/.test(payload.steamId)) return null;

    const age = Math.floor(Date.now() / 1000) - payload.iat;
    if (age < 0 || age > MAX_AGE_SECONDS) return null;

    return payload.steamId;
  } catch {
    return null;
  }
}

/** 在 Route Handler 中读取当前登录用户的 SteamID64 */
export async function getSessionSteamId(): Promise<string | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

/** 写入登录 Cookie */
export async function setSessionCookie(steamId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(steamId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

/** 清除登录 Cookie */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
