/**
 * Steam OpenID 2.0 登录。
 *
 * 流程：
 *  1. 用户点击登录 → 302 到 Steam 的 openid/login
 *  2. 用户在 Steam 官方页面授权 → Steam 302 回我们的 return_to，附带
 *     openid.* 参数（含 openid.sig 签名）
 *  3. 我们把收到的参数原样 POST 回 Steam 的 openid/login 做
 *     mode=check_authentication 校验
 *  4. 校验通过 → 从 openid.claimed_id 里取 SteamID64
 *
 * 关键安全点：第 3 步必须做真校验（签名 + 回源），否则任何人伪造一个
 * claimed_id 就能冒充别的用户。另外 return_to / realm 必须和回调地址
 * 完全一致，否则 Steam 会拒绝。
 */

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';

/** 用请求头推断本站 origin，避免把回调地址写死 */
export function resolveOrigin(req: Request): string {
  const configured = process.env.APP_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');

  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    return `${forwardedProto ?? 'http'}://${forwardedHost}`;
  }

  const host = req.headers.get('host') ?? 'localhost:3000';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export function callbackUrl(origin: string): string {
  return `${origin}/auth/steam/return`;
}

/** 构造跳转到 Steam 授权页的 URL */
export function buildLoginUrl(origin: string): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': callbackUrl(origin),
    'openid.realm': origin,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

export type VerifyResult =
  | { ok: true; steamId: string }
  | { ok: false; reason: string };

const STEAM_ID_PATTERN = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/**
 * 校验 Steam 回调。
 * 传入完整回调 URL（把 openid.* 查询参数原样取出）。
 */
export async function verifyCallback(requestUrl: string): Promise<VerifyResult> {
  const url = new URL(requestUrl);
  const search = url.searchParams;

  if (search.get('openid.mode') !== 'id_res') {
    return { ok: false, reason: `openid.mode 不是 id_res（收到 ${search.get('openid.mode')}）` };
  }

  const claimedId = search.get('openid.claimed_id') ?? '';
  const match = STEAM_ID_PATTERN.exec(claimedId);
  if (!match) {
    return { ok: false, reason: 'openid.claimed_id 不是合法的 Steam 身份地址' };
  }
  const steamId = match[1];

  // 把所有 openid.* 参数收集起来，改成 check_authentication 回传给 Steam。
  const verifyBody = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key.startsWith('openid.')) verifyBody.append(key, value);
  }
  verifyBody.set('openid.mode', 'check_authentication');

  let text: string;
  try {
    const res = await fetch(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyBody.toString(),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, reason: `Steam 校验接口返回 HTTP ${res.status}` };
    }
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: `无法连接 Steam 校验接口：${(err as Error).message}` };
  }

  // Steam 用 KV 文本行回复，例如 "ns:...\nis_valid:true\n"
  const valid = /^is_valid\s*:\s*true$/im.test(text);
  if (!valid) {
    return { ok: false, reason: 'Steam 拒绝了该登录凭据（is_valid:false）' };
  }

  return { ok: true, steamId };
}
