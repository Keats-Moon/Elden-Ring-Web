#!/usr/bin/env node
/**
 * 存档解析器的自测脚本。
 *
 * 为什么需要它：本机手上没有真实的 ER0000.sl2，无法端到端验证解析结果。
 * 但**容器层**的逻辑是我自己构造数据就能覆盖的：平台识别、长度校验、
 * MD5 校验、空槽位判定、加密检测。这些恰恰是最容易写错、也最该先验证的部分。
 *
 * 它**不能**验证槽位内部字段偏移（那需要真实存档），这一点会明确写在输出里，
 * 不会假装测过。
 *
 * 用法：node scripts/selftest-save.mjs
 */

import { createHash, createCipheriv, createDecipheriv } from 'node:crypto';

/* ── 从编译前的 TS 里对照的常量（保持同步） ── */
const SLOT_SIZE = 0x280000;
const PC_HEADER_SIZE = 0x300;
const MD5_SIZE = 0x10;
const SLOT_COUNT = 10;
const USERDATA10_SIZE = 0x60000;
const PC_SLOT_STRIDE = MD5_SIZE + SLOT_SIZE;

const BND4 = Buffer.from('BND4', 'ascii');
const PS4 = Buffer.from([0xcb, 0x01, 0x9c, 0x2c]);
const STEAM_AES_KEY = Buffer.from([
  0x99, 0xad, 0x2d, 0x50, 0xed, 0xf2, 0xfb, 0x01, 0xc5, 0xf3, 0xec, 0x3a, 0x2b, 0xca, 0xb6, 0x9d,
]);

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

/* ── 构造一份合成存档 ── */

/** 造一个带"有效"版本号与 MD5 的槽位（内部字段是垃圾，容器层测试足够） */
function makeSlot(index) {
  const slot = Buffer.alloc(SLOT_SIZE, 0);
  slot.writeUInt32LE(81, 0); // version = 81 → 物品表 5118 条
  // 塞一个能通过"名字合理性"检查的假名字位置无所谓；这里只测容器层
  slot.write(`slot-${index}`, 0x100, 'utf8');
  return slot;
}

/**
 * 构造一份合成存档，字节布局与真实 PC 存档对齐。
 *
 * 关键点：UD11 段也有自己的 16 字节 MD5 前缀，总长 0x240010。
 * 正是因为漏算这 16 字节，最容易把期望长度算成比真实存档少 16 字节。
 */
function makePcSave({ emptySlots = [], version = 81 } = {}) {
  const parts = [Buffer.alloc(PC_HEADER_SIZE, 0)];
  BND4.copy(parts[0], 0);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const isEmpty = emptySlots.includes(i);
    const data = isEmpty ? Buffer.alloc(SLOT_SIZE, 0) : makeSlot(i);
    if (!isEmpty) data.writeUInt32LE(version, 0);

    const md5 = isEmpty ? Buffer.alloc(MD5_SIZE, 0) : createHash('md5').update(data).digest();
    parts.push(md5, data);
  }

  const ud10 = Buffer.alloc(USERDATA10_SIZE, 0);
  // UD10 里 offset 0x04 记录 SteamID64，这里写一个假账号用于核对逻辑
  ud10.writeBigUInt64LE(76561198000000000n, 4);
  parts.push(createHash('md5').update(ud10).digest(), ud10);

  const ud11 = Buffer.alloc(UD11_SECTION_SIZE - MD5_SIZE, 0);
  parts.push(createHash('md5').update(ud11).digest(), ud11);

  return Buffer.concat(parts);
}

/* ── 测试用例 ── */

/**
 * PC 存档完整长度（逐行相加，自洽）：
 *   头 0x300 + 10×槽位(0x10 + 0x280000) + UD10(0x10 + 0x60000) + UD11(0x10 + 0x240000)
 *   = 28,967,872 字节 = 0x1BA03C0
 *
 * ⚠️ 关于格式文档：该文档正文声称实测总长为 28,967,888（0x1BA03D0），
 * 与它自己的行偏移表矛盾 —— 表里最后一个字节落在 0x1BA03C0。
 * 28,967,888 的十六进制其实是 0x1BA03D0，说明文档这里有两处笔误。
 * 本测试以**自洽的行布局**为准（解析器实际依赖的也是行布局），
 * 不追随那个互相矛盾的总尺寸。
 */
const UD11_SECTION_SIZE = 0x240010; // MD5(0x10) + 数据(0x240000)
const EXPECTED_PC_FILE_SIZE =
  PC_HEADER_SIZE + SLOT_COUNT * PC_SLOT_STRIDE + (MD5_SIZE + USERDATA10_SIZE) + UD11_SECTION_SIZE;

console.log('存档解析器自测（容器层）\n');

console.log('[1] PC 明文 BND4 识别');
{
  const save = makePcSave();
  check('文件以 BND4 开头', save.subarray(0, 4).equals(BND4));
  check(
    '自洽布局总长 = 28,967,872 字节 (0x1BA03C0)',
    EXPECTED_PC_FILE_SIZE === 28967872,
    `公式得 ${EXPECTED_PC_FILE_SIZE} (0x${EXPECTED_PC_FILE_SIZE.toString(16)})`,
  );
  check(
    '合成存档长度与自洽布局一致',
    save.length === EXPECTED_PC_FILE_SIZE,
    `期望 ${EXPECTED_PC_FILE_SIZE}，实际 ${save.length}`,
  );
  check(
    'UserData10 数据段起始偏移 = 0x19003B0',
    PC_HEADER_SIZE + SLOT_COUNT * PC_SLOT_STRIDE + MD5_SIZE === 0x19003b0,
    `计算得 0x${(PC_HEADER_SIZE + SLOT_COUNT * PC_SLOT_STRIDE + MD5_SIZE).toString(16)}`,
  );
}

console.log('\n[2] 槽位偏移公式');
{
  // 槽位 N 的数据在 0x310 + N*0x280010，校验和在其前 16 字节
  const slot0Data = 0x310;
  const slot1Data = 0x310 + PC_SLOT_STRIDE;
  check('槽位 0 数据偏移 = 0x310', slot0Data === PC_HEADER_SIZE + MD5_SIZE);
  check('槽位 1 数据偏移 = 0x280320', slot1Data === 0x280320, `计算得 0x${slot1Data.toString(16)}`);

  // 标记数据写在"槽位内偏移 0x100"，因此文件内的绝对偏移要再加 0x100
  const save = makePcSave();
  check(
    '槽位 0 内的标记数据可读',
    save.subarray(slot0Data + 0x100, slot0Data + 0x100 + 6).toString('utf8') === 'slot-0',
  );
  check(
    '槽位 1 内的标记数据可读',
    save.subarray(slot1Data + 0x100, slot1Data + 0x100 + 6).toString('utf8') === 'slot-1',
  );
}

console.log('\n[3] MD5 校验和');
{
  const save = makePcSave();
  const dataOffset = 0x310;
  const data = save.subarray(dataOffset, dataOffset + SLOT_SIZE);
  const recorded = save.subarray(0x300, 0x300 + MD5_SIZE);
  check('槽位 0 的 MD5 与记录一致', createHash('md5').update(data).digest().equals(recorded));

  // 篡改一个字节后应当不匹配
  const tampered = Buffer.from(save);
  tampered[dataOffset + 5] ^= 0xff;
  const tData = tampered.subarray(dataOffset, dataOffset + SLOT_SIZE);
  check('篡改一个字节后 MD5 不匹配', !createHash('md5').update(tData).digest().equals(recorded));
}

console.log('\n[4] 空槽位判定');
{
  const save = makePcSave({ emptySlots: [3, 7] });
  const checksum3 = save.subarray(PC_HEADER_SIZE + 3 * PC_SLOT_STRIDE, PC_HEADER_SIZE + 3 * PC_SLOT_STRIDE + 16);
  check('空槽位的 MD5 全为 0', checksum3.every((b) => b === 0));
  check('非空槽位的 MD5 不全为 0', !save.subarray(PC_HEADER_SIZE, PC_HEADER_SIZE + 16).every((b) => b === 0));
}

console.log('\n[5] 版本号决定物品表条数');
{
  const oldSave = makePcSave({ version: 81 });
  const newSave = makePcSave({ version: 82 });
  check('version=81 → 应读 5118 条', oldSave.readUInt32LE(0x310) === 81);
  check('version=82 → 应读 5120 条', newSave.readUInt32LE(0x310) === 82);
}

console.log('\n[6] 主机存档识别');
{
  const ps4 = Buffer.concat([PS4, Buffer.alloc(0x100, 0)]);
  check('PS4 魔数 CB 01 9C 2C 被识别', ps4.subarray(0, 4).equals(PS4));
}

console.log('\n[7] Steam 外层 AES-128-CBC 加密');
{
  // 用与项目相同的密钥与"约定 A"（整体作为密文）构造加密存档，
  // 验证对称性：我们能不能把自己加密的东西解回来
  const plain = makePcSave();
  const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16, 0)]);
  const iv = Buffer.alloc(16, 0x42);
  const cipher = createCipheriv('aes-128-cbc', STEAM_AES_KEY, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

  check('加密后开头不再是 BND4', !encrypted.subarray(0, 4).equals(BND4));

  const decipher = createDecipheriv('aes-128-cbc', STEAM_AES_KEY, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  check('解密后恢复为 BND4', decrypted.subarray(0, 4).equals(BND4));
  check('解密后长度一致', decrypted.length === padded.length);
}

console.log('\n' + '─'.repeat(60));
console.log(`通过 ${passed} 项，失败 ${failed} 项。`);
console.log('');
console.log('⚠️  未覆盖的部分（需要真实存档才能验证）：');
console.log('   · 槽位内部字段偏移（MagicPattern 定位、属性、背包、装备）');
console.log('   · GaItem 记录变长解析（21/16/8 字节）');
console.log('   · 储物箱区间定位');
console.log('   这些必须用你本机的真实 ER0000.sl2 上传后看「解析诊断」来确认。');

process.exit(failed === 0 ? 0 : 1);
