#!/usr/bin/env node
/**
 * 用真实存档直接跑应用的解析器（不经 HTTP）。
 *
 * 这样能在一次运行里看到完整结果与全部诊断，定位问题比来回贴网页快得多。
 * 只读，不修改存档。
 *
 * 用法：node --import ./scripts/ts-alias-loader.mjs scripts/parse-save.mjs <存档路径>
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from './env.mjs';

const { parseSave } = await import('../src/lib/er/save/index.ts');

const path = resolve(projectRoot, process.argv[2] ?? 'ER0000.sl2');
if (!existsSync(path)) {
  console.error(`找不到文件：${path}`);
  process.exit(1);
}

const raw = readFileSync(path);
console.log(`读取：${path}（${raw.length} 字节）`);
console.log('='.repeat(78));

const result = parseSave(raw);

console.log('');
console.log('── 解析诊断 ──');
for (const d of result.diagnostics) {
  console.log('  ' + d);
}

if (!result.ok) {
  console.log('');
  console.log('✗ 解析失败');
  console.log('  阶段 :', result.stage);
  console.log('  原因 :', result.error);
  process.exit(1);
}

console.log('');
console.log('── 结果 ──');
console.log(`  校验和有效 : ${result.checksumsValid}`);
console.log(`  存档账号   : ${result.steamId || '(未读到)'}`);
console.log(`  角色数     : ${result.slotCount}`);
console.log('');

for (const c of result.characters) {
  console.log(`  ▸ 槽位 ${c.slot}「${c.name}」 Lv${c.level}  卢恩 ${c.runes}  格式版本 ${c.version}`);
  console.log(
    `    属性 生命力${c.stats.vigor} 集中力${c.stats.mind} 耐力${c.stats.endurance} 力气${c.stats.strength} ` +
      `灵巧${c.stats.dexterity} 智力${c.stats.intelligence} 信仰${c.stats.faith} 感应${c.stats.arcane}`,
  );

  if (!c.afterAnchorSupported) {
    console.log(
      `    背包/装备：该格式版本（${c.version}）超出已验证范围，按设计不解解析（不是"没有物品"）`,
    );
  } else {
    console.log(`    装备 ${c.equipped.length} 件 | 收集 ${c.inventory.length} 种`);
    const byCat = new Map();
    for (const it of c.inventory) byCat.set(it.category, (byCat.get(it.category) ?? 0) + 1);
    if (byCat.size > 0) {
      console.log('    分类:', [...byCat.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
    }
  }
  console.log('');
}

console.log('='.repeat(78));
