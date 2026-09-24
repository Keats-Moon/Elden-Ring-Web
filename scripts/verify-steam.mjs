#!/usr/bin/env node
/**
 * 用真实 Steam 数据端到端验证本项目的数据管线。
 *
 * 覆盖：
 *   1. API Key 是否有效（GetPlayerSummaries）
 *   2. 成就定义是否拿得到，并打印全部成就显示名（用于人工核对 Boss 分类）
 *   3. 全局完成率接口是否可用
 *   4. 对一个**公开档案**的真实账号，跑通 GetPlayerAchievements，
 *      并调用本站 /api/achievements 与官方结果逐项比对
 *
 * 用法：node scripts/verify-steam.mjs [可选: 一个公开档案的 SteamID64]
 * 需要能访问外网，且 .env.local 已配置 STEAM_API_KEY。
 */

import { createHmac } from 'node:crypto';
import { parseEnvLocal } from './env.mjs';

const APP_ID = 1245620;
const LOCAL_BASE = 'http://localhost:3000';

/** Valve 官方的示例公共账号，档案公开，适合用来验证读取链路 */
const DEFAULT_PROBE_STEAMID = '76561197960287930';

const env = parseEnvLocal();
const KEY = env.STEAM_API_KEY;
const SECRET = env.SESSION_SECRET;

if (!KEY) {
  console.error('错误：.env.local 里没有 STEAM_API_KEY。');
  process.exit(1);
}

/**
 * 注意：代理必须由包装器（scripts/run-with-env.mjs）在**启动前**注入环境，
 * 本脚本内再设置 process.env 是无效的 —— 实测过，见 run-with-env.mjs 的注释。
 * 这里只做一次可见性检查，配置缺失时给出提示。
 */
if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY) {
  console.log(
    '提示：未检测到代理。若本机直连 Steam 不稳，请改用 `npm run verify:steam`（会经包装器注入代理）。\n',
  );
}

/**
 * 带重试的 Steam 请求。
 *
 * 本机到 api.steampowered.com 的连通性实测会间歇性超时（同一命令时而 HTTP 200、
 * 时而 UND_ERR_CONNECT_TIMEOUT），因此验证脚本必须自己重试，否则会把网络抖动
 * 误报成"Key 无效" —— 那是最容易得出错误结论的失败模式。
 */
async function steam(path, params, { retries = 4 } = {}) {
  const url = new URL(`https://api.steampowered.com/${path}`);
  url.searchParams.set('key', KEY);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));

  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = 700 * 2 ** (attempt - 1);
      console.log(`     （第 ${attempt} 次重试，等待 ${wait}ms）`);
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 保留 null，由调用方按文本报告 */
      }
      return { status: res.status, text, json };
    } catch (err) {
      lastErr = err.cause?.code ?? err.message;
      console.log(`     尝试 ${attempt + 1} 失败：${lastErr}`);
    }
  }
  throw new Error(`连接 api.steampowered.com 失败（重试 ${retries} 次后仍失败）：${lastErr}`);
}

/** 与服务端 session.ts 相同的签名算法，用来伪造一个合法会话 Cookie */
function sessionCookie(steamId) {
  const payload = { steamId, iat: Math.floor(Date.now() / 1000) };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `ert_session=${body}.${sig}`;
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  → ${detail}` : ''}`);
  if (!ok) failures++;
}

const probeId = process.argv[2] ?? DEFAULT_PROBE_STEAMID;

console.log('真实 Steam 数据端到端验证');
console.log('='.repeat(70));

/* ── 1. Key 有效性 ── */
console.log('\n[1] API Key 是否有效（GetPlayerSummaries）');
const probe = await steam('ISteamUser/GetPlayerSummaries/v2', { steamids: probeId });
const players = probe.json?.response?.players ?? [];
check('HTTP 200', probe.status === 200, `实际 ${probe.status}`);
check('返回了玩家数据', players.length > 0, probe.text.slice(0, 200));
if (players[0]) {
  console.log(
    `     探测账号：${players[0].personaname} | steamid=${players[0].steamid} | 档案可见性=${players[0].communityvisibilitystate}（3=公开）`,
  );
}
if (probe.status !== 200 || players.length === 0) {
  console.error('\nKey 无效或接口异常，后续验证无法进行。');
  process.exit(1);
}

/* ── 2. 成就定义 ── */
console.log('\n[2] 成就定义（GetSchemaForGame，艾尔登法环）');
const schema = await steam('ISteamUserStats/GetSchemaForGame/v2', { appid: APP_ID, l: 'schinese' });
const achDefs = schema.json?.game?.availableGameStats?.achievements ?? [];
check('HTTP 200', schema.status === 200, `实际 ${schema.status}`);
check('拿到成就定义', achDefs.length > 0, `实际 ${achDefs.length} 条`);
console.log(`     游戏名：${schema.json?.game?.gameName ?? '(无)'}`);
console.log(`     成就总数：${achDefs.length}`);

console.log('\n     全部成就显示名（请人工核对 Boss 分类是否合理）：');
achDefs.forEach((a, i) => {
  const hidden = a.hidden === 1 ? ' [隐藏]' : '';
  console.log(`       ${String(i + 1).padStart(2)}. ${a.displayName || a.name}${hidden}`);
});

/* ── 3. 全局完成率 ── */
console.log('\n[3] 全局完成率（GetGlobalAchievementPercentagesForApp）');
const gp = await steam('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2', { gameid: APP_ID });
const gpList = gp.json?.achievementpercentages?.achievements ?? [];
check('HTTP 200', gp.status === 200, `实际 ${gp.status}`);
check('拿到完成率数据', gpList.length > 0, `实际 ${gpList.length} 条`);

/* ── 4. 玩家成就：官方结果 vs 本站 API ── */
console.log(`\n[4] 玩家成就读取（探测账号 ${probeId}）`);
const pa = await steam('ISteamUserStats/GetPlayerAchievements/v1', {
  steamid: probeId,
  appid: APP_ID,
  l: 'schinese',
});
console.log(`     官方接口 HTTP ${pa.status}`);
const official = pa.json?.playerstats;
if (official?.success === false) {
  console.log(`     官方返回 success=false，error="${official.error}"`);
  console.log('     （该账号可能没玩过本作或未公开游戏详情 —— 这不代表本站有问题）');
} else {
  const list = official?.achievements ?? [];
  const unlocked = list.filter((a) => a.achieved === 1).length;
  check('官方返回成就列表', list.length > 0, `${list.length} 条`);
  console.log(`     官方：${list.length} 条记录，已解锁 ${unlocked} 个`);

  // 与本站 API 比对
  const res = await fetch(`${LOCAL_BASE}/api/achievements`, {
    headers: { cookie: sessionCookie(probeId) },
  });
  console.log(`     本站 /api/achievements HTTP ${res.status}`);
  const body = await res.json();

  if (res.ok) {
    const mine = body.progress;
    check('本站成就总数与官方一致', mine.total === list.length, `本站 ${mine.total} vs 官方 ${list.length}`);
    check('本站已解锁数与官方一致', mine.unlocked === unlocked, `本站 ${mine.unlocked} vs 官方 ${unlocked}`);
    check('Boss 记录已提炼出来', Array.isArray(body.bosses) && body.bosses.length > 0, `${body.bosses?.length ?? 0} 条`);

    console.log('\n     双方逐项比对（只列不一致的）:');
    const officialMap = new Map(list.map((a) => [a.apiname, a]));
    let mismatches = 0;
    for (const a of mine.achievements) {
      const o = officialMap.get(a.apiName);
      if (!o) {
        console.log(`       ! 官方缺失 ${a.apiName}`);
        mismatches++;
        continue;
      }
      const oAch = o.achieved === 1;
      const oTime = o.unlocktime ?? 0;
      if (oAch !== a.achieved || oTime !== a.unlockTime) {
        console.log(`       ! ${a.displayName}: 本站(${a.achieved},${a.unlockTime}) vs 官方(${oAch},${oTime})`);
        mismatches++;
      }
    }
    check('逐项解锁状态与时间戳完全一致', mismatches === 0, `${mismatches} 处不一致`);

    if (body.bosses?.length) {
      console.log('\n     本站提炼出的 Boss 记录:');
      for (const b of body.bosses) {
        console.log(`       ${b.defeated ? '✓' : '·'} ${b.name}  （成就「${b.achievementName}」）`);
      }
    }
  } else {
    console.log('     本站返回错误:', JSON.stringify(body).slice(0, 300));
    check('本站 API 可用', false, `HTTP ${res.status}`);
  }
}

/* ── 5. /api/me ── */
console.log('\n[5] 本站 /api/me');
const meRes = await fetch(`${LOCAL_BASE}/api/me`, { headers: { cookie: sessionCookie(probeId) } });
console.log(`     HTTP ${meRes.status}`);
const meBody = await meRes.json();
if (meRes.ok) {
  console.log(`     玩家：${meBody.player.personaName}`);
  console.log(`     拥有艾尔登法环：${meBody.ownsGame}`);
  console.log(`     总时长：${meBody.game?.playtimeForeverMinutes ?? 0} 分钟`);
  check('返回了玩家摘要', Boolean(meBody.player?.steamId));
} else {
  console.log('     ', JSON.stringify(meBody).slice(0, 300));
  check('/api/me 可用', false, `HTTP ${meRes.status}`);
}

console.log('\n' + '='.repeat(70));
console.log(failures === 0 ? '全部通过。' : `有 ${failures} 项未通过。`);
process.exit(failures === 0 ? 0 : 1);
