#!/usr/bin/env node
/**
 * 直接分析一个 ER0000.sl2 存档文件的结构（本地、离线、只读）。
 *
 * 相比在网页上传，这个脚本能一次性把容器与槽位的原始结构全打出来，
 * 便于快速判断字段偏移差在哪里。它**不修改文件**，也不会把内容发到任何地方。
 *
 * 用法：
 *   node scripts/analyze-save.mjs <存档路径>
 *   node scripts/analyze-save.mjs            # 默认找 ./ER0000.sl2
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { projectRoot } from './env.mjs';

const SLOT_SIZE = 0x280000;
const PC_HEADER_SIZE = 0x300;
const MD5_SIZE = 0x10;
const SLOT_COUNT = 10;
const PC_SLOT_STRIDE = MD5_SIZE + SLOT_SIZE;

const path = resolve(projectRoot, process.argv[2] ?? 'ER0000.sl2');
if (!existsSync(path)) {
  console.error(`找不到文件：${path}`);
  console.error('用法：node scripts/analyze-save.mjs <存档路径>');
  process.exit(1);
}

const raw = readFileSync(path);
console.log('存档结构分析（只读）');
console.log('='.repeat(74));
console.log('文件      :', path);
console.log('大小      :', raw.length, '字节', `(0x${raw.length.toString(16)})`);
console.log('开头 4 字节:', raw.subarray(0, 4).toString('hex'), `"${raw.subarray(0, 4).toString('ascii')}"`);
console.log('');

function hexDump(buffer, offset, length) {
  for (let i = 0; i < length; i += 16) {
    const start = offset + i;
    if (start >= buffer.length) break;
    const chunk = buffer.subarray(start, Math.min(start + 16, buffer.length));
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...chunk].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    console.log(`  0x${start.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
}

/* ── 1. BND4 入口表 ── */
console.log('[1] BND4 头与入口表');
console.log(`  magic        : ${raw.subarray(0, 4).toString('ascii')}`);
const entryCount = raw.readUInt32LE(0x0c);
const tableOffset = raw.readUInt32LE(0x10);
console.log(`  entryCount   : ${entryCount} (0x${entryCount.toString(16)})`);
console.log(`  tableOffset  : 0x${tableOffset.toString(16)}`);

// 实测布局：入口 0x50 字节，size 在 +0x08，offset 在 +0x10，名字指针在 +0x14
const ENTRY_STRIDE = 0x50;
if (entryCount > 0 && entryCount <= 1024 && tableOffset >= 0x40 && tableOffset + entryCount * ENTRY_STRIDE <= raw.length) {
  console.log('');
  console.log('  idx  名字             偏移        大小');
  console.log('  ' + '-'.repeat(62));
  const offsets = [];
  let skipped = 0;
  for (let i = 0; i < entryCount; i++) {
    const base = tableOffset + i * ENTRY_STRIDE;
    const size = raw.readUInt32LE(base + 0x08);
    const offset = raw.readUInt32LE(base + 0x10);
    const nameOffset = raw.readUInt32LE(base + 0x14);
    let name = '';
    if (nameOffset > 0 && nameOffset + 2 < raw.length) {
      let end = 64;
      for (let j = 0; j + 1 < 64; j += 2) {
        if (raw.readUInt16LE(nameOffset + j) === 0) { end = j; break; }
      }
      name = raw.subarray(nameOffset, nameOffset + end).toString('utf16le');
    }
    // 只有名字形如 USER_DATAxxx、或尺寸是已知块大小的条目才是真正的数据块。
    // 实测 12 条入口里只有 5 条符合，其余是容器内部结构 —— 它们的 offset
    // 字段其实不是文件偏移，误当成数据块会得出"槽位偏移假设不成立"的错误结论。
    const knownSize = size === 0x280010 || size === 0x60010 || size === 0x240010;
    const looksLikeSlot = /^USER_DATA\d+/.test(name);
    if (offset > raw.length || size === 0 || (!knownSize && !looksLikeSlot)) {
      skipped++;
      continue;
    }
    offsets.push(offset);
    console.log(
      `  ${String(i).padStart(3)}  ${(name || '(无名)').padEnd(16)} 0x${offset.toString(16).padStart(8, '0')}  ${size}`,
    );
  }
  if (skipped > 0) {
    console.log(`  （另有 ${skipped} 条为容器内部结构，已跳过）`);
  }

  console.log('');
  console.log('  ── 与"槽位数据在 0x310 + N×0x280010"这个假设对比 ──');
  console.log('  注意：入口的 offset 指向的是**包含 16 字节 MD5 的块起点**，');
  console.log('        槽位数据本身在该偏移 +0x10 处，因此应比对 offset+0x10。');
  const stride = MD5_SIZE + SLOT_SIZE;
  const dataOffsetOfSlot = (n) => PC_HEADER_SIZE + MD5_SIZE + n * stride;
  console.log(`  假设：槽位 N 数据 @0x${dataOffsetOfSlot(0).toString(16)} + N×0x${stride.toString(16)}`);

  // 每个"数据块"条目的 MD5 起点应正好等于某个槽位块的起点
  const slotIndices = [];
  let allAligned = true;
  for (const blockStart of offsets) {
    const rel = blockStart - PC_HEADER_SIZE;
    if (rel % stride !== 0) {
      allAligned = false;
      console.log(`  ✗ 块起点 0x${blockStart.toString(16)} 未对齐到槽位边界`);
      continue;
    }
    slotIndices.push(rel / stride);
  }

  if (allAligned && slotIndices.length > 0) {
    console.log(
      `  ✓ ${slotIndices.length} 个数据块全部对齐到槽位边界，对应槽位 ${slotIndices.join(', ')}`,
    );
    console.log(
      `    首个块 0x${offsets[0].toString(16)} + 0x10 = 数据 @0x${dataOffsetOfSlot(slotIndices[0]).toString(16)}，与假设一致`,
    );
  }
} else {
  console.log('  入口表不合理，跳过。');
}

/* ── 2. 槽位起始字节 ── */
console.log('');
console.log('[2] 各槽位起始字节（前 64 字节）');
for (let i = 0; i < SLOT_COUNT; i++) {
  const md5Off = PC_HEADER_SIZE + i * PC_SLOT_STRIDE;
  const dataOff = md5Off + MD5_SIZE;
  if (dataOff + 64 > raw.length) break;

  const checksum = raw.subarray(md5Off, md5Off + MD5_SIZE);
  const data = raw.subarray(dataOff, dataOff + SLOT_SIZE);
  const recordedMd5Ok = createHash('md5').update(data).digest().equals(checksum);
  const version = raw.readUInt32LE(dataOff);

  console.log('');
  console.log(`  槽位 ${i}: 数据@0x${dataOff.toString(16)}  version=${version}  MD5匹配=${recordedMd5Ok ? '是' : '否'}`);
  if (version !== 0 && i < 3) hexDump(raw, dataOff, 64);
}

/* ── 3. MagicPattern 候选 ── */
console.log('');
console.log('[3] MagicPattern 候选位置（每槽位前 0x20000 字节内）');
const MAGIC = Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
for (let i = 0; i < Math.min(SLOT_COUNT, 3); i++) {
  const dataOff = PC_HEADER_SIZE + i * PC_SLOT_STRIDE + MD5_SIZE;
  const slot = raw.subarray(dataOff, dataOff + SLOT_SIZE);
  if (slot.length < SLOT_SIZE) break;

  const hits = [];
  for (let p = 0x20; p + 64 <= Math.min(slot.length, 0x20000); p++) {
    if (!slot.subarray(p, p + 16).equals(MAGIC)) continue;
    let ok = true;
    for (let r = 1; r < 4; r++) {
      if (!slot.subarray(p + r * 16, p + r * 16 + 16).equals(MAGIC)) { ok = false; break; }
    }
    if (ok) hits.push(p);
  }
  console.log(`  槽位 ${i}: 4×重复匹配 ${hits.length} 处 ${hits.length ? '→ ' + hits.map((h) => '0x' + h.toString(16)).join(', ') : ''}`);

  if (hits.length > 0) {
    const m = hits[0];
    // 按文档的负偏移读属性，看是否落在合理区间
    const rel = {
      vigor: -379, mind: -375, endurance: -371, strength: -367,
      dexterity: -363, intelligence: -359, faith: -355, arcane: -351,
      level: -335, runes: -331,
    };
    const vals = {};
    for (const [k, off] of Object.entries(rel)) {
      const at = m + off;
      vals[k] = at >= 0 && at + 4 <= slot.length ? slot.readInt32LE(at) : null;
    }
    console.log(`     以 0x${m.toString(16)} 为锚点按文档负偏移读取：`);
    console.log('     ', JSON.stringify(vals));
    const stats = ['vigor','mind','endurance','strength','dexterity','intelligence','faith','arcane'].map((k) => vals[k]);
    const statsOk = stats.every((v) => typeof v === 'number' && v >= 1 && v <= 99);
    console.log(`     属性是否全部落在 1–99：${statsOk ? '✓ 是（锚点很可能是对的）' : '✗ 否（锚点或偏移不对）'}`);
    if (!statsOk) {
      console.log('     锚点附近 0x40 字节：');
      hexDump(slot, Math.max(0, m - 0x20), 0x60);
    }
  }
}

/* ── 4. 名字扫描 ── */
console.log('');
console.log('[4] 槽位 0 前 0x2000 字节里的 UTF-16LE 可读字符串（可能是角色名）');
{
  const dataOff = PC_HEADER_SIZE + MD5_SIZE;
  const slot = raw.subarray(dataOff, dataOff + SLOT_SIZE);
  const found = [];
  let cur = '';
  let curStart = 0;
  for (let p = 0; p + 1 < Math.min(slot.length, 0x2000); p += 2) {
    const code = slot.readUInt16LE(p);
    const printable =
      (code >= 0x20 && code < 0x7f) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff);
    if (printable) {
      if (!cur) curStart = p;
      cur += String.fromCharCode(code);
    } else {
      if (cur.length >= 2) found.push(`0x${curStart.toString(16)}=${cur}`);
      cur = '';
    }
  }
  if (cur.length >= 2) found.push(`0x${curStart.toString(16)}=${cur}`);
  console.log(found.length ? '  ' + found.slice(0, 25).join('  ') : '  （没找到可读字符串）');
}

console.log('');
console.log('='.repeat(74));
console.log('分析完成。本脚本只读，未修改任何文件。');
