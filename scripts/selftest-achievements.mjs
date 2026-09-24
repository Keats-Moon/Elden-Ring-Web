#!/usr/bin/env node
/**
 * 成就分类管线自测。
 *
 * 直接 import 应用里的真实模块（Node 24 可剥离 TS 类型），而不是在这里
 * 复刻一套规则 —— 复刻件只能证明"我以为的规则"，证明不了实际跑的代码。
 *
 * 覆盖：映射表结构完整性、分类结果、Boss 记录提炼与排序。
 *
 * 用法：node scripts/selftest-achievements.mjs
 */

import { classifyAchievement, extractBossRecords } from '../src/lib/er/achievements.ts';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

console.log('成就分类管线自测\n');

/* ── 1. 真实 Steam 返回的 42 个成就（apiName + 显示名，实测导出的原文） ── */
const REAL = [
  ['ACH00', '艾尔登法环', 'ending'],
  ['ACH01', '艾尔登之王', 'ending'],
  ['ACH02', '星星时代', 'ending'],
  ['ACH03', '癫火之王', 'ending'],
  ['ACH04', '“碎片君王”葛瑞克', 'boss'],
  ['ACH05', '“碎片君王”拉塔恩', 'boss'],
  ['ACH06', '“碎片君王”蒙葛特', 'boss'],
  ['ACH07', '“碎片君王”拉卡德', 'boss'],
  ['ACH08', '“碎片君王”玛莲妮亚', 'boss'],
  ['ACH09', '“碎片君王”蒙格', 'boss'],
  ['ACH10', '“黑剑”玛利喀斯', 'boss'],
  ['ACH11', '战士荷莱·露', 'boss'],
  ['ACH12', '“龙王”普拉顿桑克斯', 'boss'],
  ['ACH13', '弒神武器', 'collection'],
  ['ACH14', '传说中的武器', 'collection'],
  ['ACH15', '传说中的骨灰', 'collection'],
  ['ACH16', '传说中的魔法、祷告', 'collection'],
  ['ACH17', '传说中的护符', 'collection'],
  ['ACH18', '“满月女王”蕾娜菈', 'boss'],
  ['ACH19', '“死龙”弗尔桑克斯', 'boss'],
  ['ACH20', '神皮双人组', 'boss'],
  ['ACH21', '火焰巨人', 'boss'],
  ['ACH22', '诺克史黛拉的龙人士兵', 'boss'],
  ['ACH23', '祖灵之王', 'boss'],
  ['ACH24', '英雄石像鬼', 'boss'],
  ['ACH25', '“恶兆妖鬼”玛尔基特', 'boss'],
  ['ACH26', '拉达冈的红狼', 'boss'],
  ['ACH27', '神皮贵族', 'boss'],
  ['ACH28', '“熔岩土龙”马卡尔', 'boss'],
  ['ACH29', '“初始之王”葛孚雷', 'boss'],
  ['ACH30', '“恶兆之子”蒙格', 'boss'],
  ['ACH31', '仿身泪滴', 'boss'],
  ['ACH32', '“圣树骑士”罗蕾塔', 'boss'],
  ['ACH33', '“黑暗弃子”艾丝缇', 'boss'],
  ['ACH34', '狮子混种', 'boss'],
  ['ACH35', '禁卫骑士罗蕾塔', 'boss'],
  ['ACH36', '“铁棘”艾隆梅尔', 'boss'],
  ['ACH37', '祖灵', 'boss'],
  ['ACH38', '老将尼奥', 'boss'],
  ['ACH39', '圆桌厅堂', 'progression'],
  ['ACH40', '大卢恩', 'progression'],
  ['ACH41', '黄金树祝融', 'ending'],
];

console.log('[1] 全部 42 个真实成就的分类');
{
  let wrong = 0;
  for (const [api, name, expected] of REAL) {
    const got = classifyAchievement(api, name);
    if (got.category !== expected) {
      wrong++;
      console.log(`       ✗ ${api} ${name}: 期望 ${expected}，实际 ${got.category}`);
    }
  }
  check(`42 个成就分类全部正确`, wrong === 0, `${wrong} 个错误`);
}

console.log('\n[2] Boss 成就必须带 bossName，且等于成就显示名');
{
  const bossRows = REAL.filter(([, , c]) => c === 'boss');
  let bad = 0;
  for (const [api, name] of bossRows) {
    const got = classifyAchievement(api, name);
    if (!got.bossName) {
      bad++;
      console.log(`       ✗ ${api} ${name}: 缺少 bossName`);
    } else if (got.bossName !== name) {
      // 真实数据里成就名就是 Boss 名，不应该被任何正则"清洗"掉内容
      bad++;
      console.log(`       ✗ ${api}: bossName 被改写成了「${got.bossName}」`);
    }
  }
  check(`${bossRows.length} 个 Boss 成就的 bossName 正确`, bad === 0, `${bad} 个错误`);
}

console.log('\n[3] 回归防护：不带动词的 Boss 名不能被漏判');
{
  // 这是最初启发式的致命伤：真实成就名不含「击败」，靠关键词会全部判成 other
  for (const name of ['火焰巨人', '祖灵', '狮子混种', '老将尼奥']) {
    const api = REAL.find(([, n]) => n === name)?.[0];
    const got = classifyAchievement(api, name);
    check(`「${name}」判为 boss`, got.category === 'boss', `实际 ${got.category}`);
  }
}

console.log('\n[4] Boss 记录提炼与排序');
{
  // 构造一个"解锁了 3 个 Boss、其中 2 个有时间戳"的进度对象
  const achievements = REAL.map(([apiName, displayName]) => {
    const semantic = classifyAchievement(apiName, displayName);
    const achieved = ['ACH04', 'ACH21', 'ACH38'].includes(apiName);
    const unlockTime = apiName === 'ACH04' ? 1700000000 : apiName === 'ACH21' ? 1710000000 : 0;
    return {
      apiName,
      displayName,
      description: '',
      hidden: true,
      globalPercent: 0,
      icon: '',
      iconGray: '',
      category: semantic.category,
      bossName: semantic.bossName,
      achieved,
      unlockTime,
    };
  });

  const progress = { total: achievements.length, unlocked: 3, percent: 7.1, achievements, source: 'steam' };
  const bosses = extractBossRecords(progress);

  check('提炼出 30 个 Boss', bosses.length === 30, `实际 ${bosses.length}`);
  check('已击败的排在最前', bosses[0].defeated && bosses[1].defeated && bosses[2].defeated);
  check('已击败的按时间倒序', bosses[0].defeatedAt > bosses[1].defeatedAt, `${bosses[0].defeatedAt} vs ${bosses[1].defeatedAt}`);
  check('已解锁的计数为 3', bosses.filter((b) => b.defeated).length === 3);
  check('未击败的排在后面', bosses.slice(3).every((b) => !b.defeated));
  check('每条都标记为成就系统追踪', bosses.every((b) => b.trackedByAchievement));
}

console.log('\n[5] 未知成就的兜底行为');
{
  // 兜底必须保守：不确定的一律 other，绝不能瞎猜成 Boss
  const unknown = classifyAchievement('ACH99', '某个将来新增的成就');
  check('未知成就判为 other（不瞎猜）', unknown.category === 'other', `实际 ${unknown.category}`);
  check('未知成就没有 bossName', !unknown.bossName);
}

console.log('\n[6] 语言无关性：分类结果不能依赖显示名的语言');
{
  // Steam 的 l 参数决定显示名语言。不带 l 时返回英文名（实测），
  // 而映射表按中文名建立 —— 若分类依赖显示名，换语言就会全线退化。
  // 这里用同一批 apiName 配上英文显示名，结果必须不变。
  const EN = {
    ACH00: 'Elden Ring',
    ACH01: 'Age of the Stars',
    ACH02: 'Lord of Frenzied Flame',
    ACH04: 'Shardbearer Godrick',
    ACH15: 'Legendary Armaments',
    ACH21: 'Fire Giant',
    ACH37: 'Ancestor Spirit',
    ACH39: 'Roundtable Hold',
  };

  let changed = 0;
  for (const [api, enName] of Object.entries(EN)) {
    const zhName = REAL.find(([a]) => a === api)?.[1] ?? '';
    const zh = classifyAchievement(api, zhName);
    const en = classifyAchievement(api, enName);
    if (zh.category !== en.category) {
      changed++;
      console.log(`       ✗ ${api}: 中文判 ${zh.category}，英文判 ${en.category}`);
    }
  }
  check('中英文显示名下分类结果一致', changed === 0, `${changed} 处不一致`);
}

console.log('\n[7] 英文显示名也必须带出中文 Boss 名');
{
  // bossName 由映射表提供（中文），不应被英文 displayName 覆盖
  const got = classifyAchievement('ACH21', 'Fire Giant');
  check('ACH21 判为 boss', got.category === 'boss', `实际 ${got.category}`);
  check('bossName 仍为中文「火焰巨人」', got.bossName === '火焰巨人', `实际「${got.bossName}」`);
}

console.log('\n' + '─'.repeat(60));
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
