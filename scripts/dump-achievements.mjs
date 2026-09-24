#!/usr/bin/env node
/**
 * 从真实 Steam 接口导出成就语义映射表。
 *
 * 为什么需要这个脚本：
 * Steam 的 GetSchemaForGame 只给出成就的显示名与描述，**不告诉你哪个成就对应
 * 哪个 Boss**。这层语义必须自己建立，而凭记忆手写 42 个成就的映射必然会错。
 * 所以让脚本从接口拉真实数据、按名称启发式给出分类建议，再让人工复核。
 *
 * 用法：
 *   node scripts/dump-achievements.mjs            # 用 .env.local 里的 key
 *   node scripts/dump-achievements.mjs --dry-run  # 只打印，不写文件
 *
 * 输出：src/lib/er/er-achievement-map.json
 *
 * ⚠️ 机器只能给建议。导出后请人工过一遍 category 与 bossName。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const OUTPUT_PATH = resolve(projectRoot, 'src/lib/er/er-achievement-map.json');

const APP_ID = 1245620; // 艾尔登法环
const DRY_RUN = process.argv.includes('--dry-run');

/** 从 .env.local 读 key（避免额外依赖 dotenv） */
function loadApiKey() {
  if (process.env.STEAM_API_KEY) return process.env.STEAM_API_KEY;

  const envPath = resolve(projectRoot, '.env.local');
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return null;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*STEAM_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (match) {
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  }
  return null;
}

/* ── 分类规则：与 src/lib/er/achievements.ts 的兜底逻辑保持同一套 ── */

/**
 * ⚠️ 实测教训：艾尔登法环的成就显示名**就是 Boss 名本身**（如「火焰巨人」），
 * 不含「击败」这类动词。所以这里不能用"名称含击败 → boss"来判断 ——
 * 那样会把全部 30 个 Boss 成就漏判成 other。
 *
 * 脚本的策略是：列出**非 Boss** 的成就（结局 / 收集 / 主线里程碑），
 * 其余一律视为 Boss 成就，并用显示名作为 Boss 名。
 * 这样新增 Boss 成就时会自动归入 boss，而不是被静默丢进 other。
 */

/** 结局 / 路线终点 */
const ENDING_NAMES = new Set([
  '艾尔登法环',
  '艾尔登之王',
  '星星时代',
  '癫火之王',
  '黄金树祝融',
]);

/** 主线推进与系统里程碑 */
const PROGRESSION_NAMES = new Set(['圆桌厅堂', '大卢恩', '弒神武器']);

/** 收集类 */
const COLLECTION_PATTERN = /^传说中的/;

/**
 * 不在已知非 Boss 名单里的成就默认归为什么。
 *
 * 默认 'boss' 省事，但**新版本新增一个非 Boss 成就时会被静默标成 Boss**，
 * 那是在向用户展示错误信息。加 --default-other 可改为保守模式：
 * 拿不准的一律 other，由人工在导出后分类。
 */
const DEFAULT_CATEGORY = process.argv.includes('--default-other') ? 'other' : 'boss';

function classify(displayName) {
  if (ENDING_NAMES.has(displayName)) return { category: 'ending' };
  if (COLLECTION_PATTERN.test(displayName)) return { category: 'collection' };
  if (PROGRESSION_NAMES.has(displayName)) return { category: 'progression' };
  if (DEFAULT_CATEGORY === 'other') return { category: 'other' };
  return { category: 'boss', bossName: displayName };
}

/* ── 主流程 ── */

const apiKey = loadApiKey();
if (!apiKey) {
  console.error(
    '错误：找不到 STEAM_API_KEY。\n' +
      '请先在 .env.local 里填入你的 Steam Web API Key（申请：https://steamcommunity.com/dev/apikey）。',
  );
  process.exit(1);
}

const endpoint = new URL('https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2');
endpoint.searchParams.set('key', apiKey);
endpoint.searchParams.set('appid', String(APP_ID));
endpoint.searchParams.set('l', 'schinese');
endpoint.searchParams.set('format', 'json');

console.log(`正在从 Steam 拉取 AppID ${APP_ID} 的成就定义…`);

let payload;
try {
  const res = await fetch(endpoint.toString());
  if (!res.ok) {
    console.error(`Steam 返回 HTTP ${res.status}。若是 403，请确认 API Key 有效。`);
    process.exit(1);
  }
  payload = await res.json();
} catch (err) {
  console.error(`请求 Steam 失败：${err.message}`);
  process.exit(1);
}

const achievements = payload?.game?.availableGameStats?.achievements;
if (!Array.isArray(achievements) || achievements.length === 0) {
  console.error(
    '没有拿到任何成就定义。可能原因：该 AppID 没有成就系统，或接口临时异常。',
  );
  process.exit(1);
}

console.log(`拿到 ${achievements.length} 个成就。\n`);

const map = {
  _readme: [
    '艾尔登法环成就语义映射表（由 npm run dump:achievements 生成）。',
    '键 = Steam 成就 apiName，值 = 我方语义分类 { category, bossName? }。',
    '⚠️ category 与 bossName 是脚本按名称启发式给出的**建议**，',
    '请人工复核后再依赖它。特别是 bossName 需要与游戏内正式译名对齐。',
    `生成时间：${new Date().toISOString()}`,
  ],
};

const counts = { boss: 0, ending: 0, progression: 0, collection: 0, other: 0 };

console.log('apiName'.padEnd(22), 'category'.padEnd(13), '显示名');
console.log('─'.repeat(80));

for (const a of achievements) {
  if (!a.name) continue;
  const displayName = (a.displayName ?? '').trim() || a.name;
  const semantic = classify(displayName);
  map[a.name] = semantic;
  counts[semantic.category] += 1;

  const boss = semantic.bossName ? `  → ${semantic.bossName}` : '';
  console.log(a.name.padEnd(22), semantic.category.padEnd(13), displayName + boss);
}

console.log('\n分类统计：', counts);

if (DRY_RUN) {
  console.log('\n--dry-run：未写入文件。');
} else {
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  console.log(`\n已写入 ${OUTPUT_PATH}`);
  console.log('请打开该文件人工复核 category 与 bossName。');
}
