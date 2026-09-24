/**
 * 成就语义层：把 Steam 返回的扁平成就列表，映射成"Boss 击杀 / 结局 /
 * 主线推进 / 收集"这些能直接展示的语义。
 *
 * 为什么要有单独的映射表（er-achievement-map.json）：
 * Steam 的 GetSchemaForGame 只给出成就的显示名和描述，**不告诉你哪个成就对应
 * 哪个 Boss**。这层语义必须自己建立。映射表由 scripts/dump-achievements.mjs
 * 从真实 Steam 接口导出，避免我凭记忆写错。
 *
 * 匹配策略（按优先级）：
 *   1. 显式映射表命中 apiName → 使用表里的 category / bossName
 *   2. 名称启发式：含"击败"类关键词 → boss；含"结局" → ending
 *   3. 兜底：other
 */

import { getGameSchema, getPlayerAchievements } from '@/lib/steam/api';
import { ELDEN_RING_APPID } from '@/types/er';
import type {
  AchievementCategory,
  AchievementProgress,
  AchievementView,
  BossRecord,
} from '@/types/er';

import achievementMap from './er-achievement-map.json';

interface MapEntry {
  category: AchievementCategory;
  bossName?: string;
}

/**
 * 映射表由脚本生成，文件里除了 apiName 项还带一个 `_readme` 说明字段，
 * 因此这里需要一次显式断言：只把"看起来像映射项"的键当映射用。
 */
const ACHIEVEMENT_MAP = achievementMap as unknown as Record<string, MapEntry>;

/**
 * 结局 / 路线终点。
 *
 * ⚠️ 实测教训（来自真实 Steam 数据）：艾尔登法环的成就显示名**就是 Boss 名本身**
 * （如「火焰巨人」「“碎片君王”葛瑞克」），**不含「击败」这类动词**。
 * 因此最初"靠关键词判断是不是 Boss"的启发式会把 30 个 Boss 成就全部漏判成 other。
 * 结论：Boss 判定必须依赖显式映射表，不能依赖名称模式。
 */
const ENDING_NAMES = new Set([
  '艾尔登法环', // 达成任一结局
  '艾尔登之王',
  '星星时代',
  '癫火之王',
  '黄金树祝融',
]);

/** 收集类：传说武器 / 骨灰 / 魔法祷告 / 护符 */
const COLLECTION_PATTERN = /^传说中的/;

/** 主线推进与系统里程碑：这几项既不是 Boss 也不是收集 */
const PROGRESSION_NAMES = new Set(['圆桌厅堂', '大卢恩', '弒神武器']);

/**
 * 判断一个成就的语义分类。
 *
 * 优先级：显式映射表 → 名称兜底。
 * 映射表已完整覆盖本作的 42 个成就，兜底逻辑只用于"表被换掉 / 新版本新增成就"
 * 的情形，因此它宁可保守（判成 other）也不要瞎判成 Boss。
 */
export function classifyAchievement(apiName: string, displayName: string): MapEntry {
  const explicit = ACHIEVEMENT_MAP[apiName];
  // 生成的文件里带有 `_readme` 之类的非映射字段，必须校验形状再用，
  // 否则将来某次生成格式变化会静默产出错误的分类。
  if (explicit && typeof explicit === 'object' && typeof explicit.category === 'string') {
    return explicit;
  }

  return classifyByNameFallback(displayName);
}

/** 兜底分类：只根据名称判断，不猜测 Boss 名 */
function classifyByNameFallback(displayName: string): MapEntry {
  if (ENDING_NAMES.has(displayName)) return { category: 'ending' };
  if (COLLECTION_PATTERN.test(displayName)) return { category: 'collection' };
  if (PROGRESSION_NAMES.has(displayName)) return { category: 'progression' };
  return { category: 'other' };
}

/**
 * 拉取并合并「成就定义 + 该玩家的解锁状态」。
 *
 * @param steamId 目标玩家
 * @param force   绕过服务端缓存（用于用户手动刷新）
 */
export async function buildAchievementProgress(
  steamId: string,
  force = false,
  appId: number = ELDEN_RING_APPID,
): Promise<AchievementProgress> {
  // 两个接口互不依赖，并发请求以降低延迟
  const [schema, playerAch] = await Promise.all([
    getGameSchema(appId),
    getPlayerAchievements(steamId, appId, force),
  ]);

  const achievedByApiName = new Map(playerAch.map((a) => [a.apiName, a]));

  const achievements: AchievementView[] = schema.definitions.map((def) => {
    const semantic = classifyAchievement(def.apiName, def.displayName);
    const player = achievedByApiName.get(def.apiName);
    return {
      ...def,
      category: semantic.category,
      bossName: semantic.bossName,
      achieved: player?.achieved ?? false,
      unlockTime: player?.unlockTime ?? 0,
    };
  });

  // 只统计 Steam 定义里存在的成就；反向多出来的忽略（版本差异）
  const total = achievements.length;
  const unlocked = achievements.filter((a) => a.achieved).length;

  return {
    total,
    unlocked,
    percent: total === 0 ? 0 : Number(((unlocked / total) * 100).toFixed(1)),
    achievements,
    source: 'steam',
  };
}

/**
 * 从成就里提炼 Boss 击杀记录。
 *
 * 重要：**只有被做成成就的 Boss 才在这里出现**。艾尔登法环大量非追忆 Boss
 * （如大树守卫、蒙格温王朝的蒙格等）根本没有成就，因此本列表不是完整 Boss 清单。
 * UI 必须如实说明这一点，不能让人误以为"没列出来 = 没打过"。
 */
export function extractBossRecords(progress: AchievementProgress): BossRecord[] {
  return progress.achievements
    .filter((a) => a.category === 'boss' && a.bossName)
    .map((a) => ({
      name: a.bossName as string,
      defeated: a.achieved,
      defeatedAt: a.unlockTime,
      achievementName: a.displayName,
      trackedByAchievement: true,
    }))
    .sort((a, b) => {
      // 已击败的按时间倒序在前，未击败的排后面
      if (a.defeated !== b.defeated) return a.defeated ? -1 : 1;
      if (a.defeated && b.defeated) return b.defeatedAt - a.defeatedAt;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
}

/** 供 UI 分组展示用的顺序与中文标题 */
export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  boss: '追忆 Boss 讨伐',
  ending: '结局',
  progression: '主线推进',
  collection: '收集类',
  other: '其他',
};

export const CATEGORY_ORDER: AchievementCategory[] = [
  'boss',
  'ending',
  'progression',
  'collection',
  'other',
];
