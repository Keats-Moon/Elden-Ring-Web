/**
 * `.sl2` 存档的外层容器解析。
 *
 * 艾尔登法环 PC 存档有两种落盘形态：
 *   1. 明文 BND4 —— 文件开头就是 ASCII "BND4"
 *   2. AES-128-CBC 包裹 —— 部分 Windows Steam 环境会加密后落盘
 *
 * 主机存档（PS4/PS5）开头是 CB 01 9C 2C，内部结构相同但外层不同，
 * 而且主机存档无法从主机导出，因此本项目只做识别 + 明确报错。
 *
 * ⚠️ 本项目**只读**。绝不实现写回 —— 写回存档存在损坏存档与触发
 * EAC 反作弊的风险，收益远小于代价。
 */

import { createDecipheriv, createHash } from 'node:crypto';

export const SLOT_SIZE = 0x280000; // 2,621,440
export const PC_HEADER_SIZE = 0x300; // 768
export const PS_HEADER_SIZE = 0x70; // 112
export const MD5_SIZE = 0x10; // 16
export const SLOT_COUNT = 10;
export const USERDATA10_SIZE = 0x60000; // 393,216

/** 单条 PC 槽位记录总长 = MD5(16) + 数据(0x280000) */
export const PC_SLOT_STRIDE = MD5_SIZE + SLOT_SIZE;

const BND4_MAGIC = Buffer.from('BND4', 'ascii');
const PS4_MAGIC = Buffer.from([0xcb, 0x01, 0x9c, 0x2c]);

/**
 * Steam 外层加密的 AES-128 密钥。
 * 来源：社区对 .sl2 格式的公开分析（见 docs 中的格式文档）。
 * 这**不是**游戏本体密钥，仅用于解开 Steam 落盘这一层。
 */
const STEAM_AES_KEY = Buffer.from([
  0x99, 0xad, 0x2d, 0x50, 0xed, 0xf2, 0xfb, 0x01, 0xc5, 0xf3, 0xec, 0x3a, 0x2b, 0xca, 0xb6, 0x9d,
]);

export interface ContainerInfo {
  /** 明文槽位数据之后的整体布局 */
  platform: 'pc' | 'ps4';
  /** 是否解开过外层加密 */
  wasEncrypted: boolean;
  /** 解开后的完整明文 BND4 缓冲区 */
  buffer: Buffer;
  diagnostics: string[];
}

export type ContainerResult =
  | { ok: true; info: ContainerInfo }
  | { ok: false; error: string; stage: string; diagnostics: string[] };

/** AES-128-CBC 解密（无 padding，长度必须是 16 的倍数） */
function aesCbcDecrypt(data: Buffer, iv: Buffer): Buffer | null {
  if (data.length % 16 !== 0) return null;
  try {
    const decipher = createDecipheriv('aes-128-cbc', STEAM_AES_KEY, iv);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    return null;
  }
}

/**
 * 尝试解开外层加密。
 *
 * 两种常见约定都试一遍（都以 BND4 magic 作为成功判据）：
 *   A. IV = 文件开头 16 字节，密文 = 其余全部
 *   B. IV = 文件开头 16 字节，密文 = 从第 16 字节开始的剩余部分
 * 任一种解出 "BND4" 开头的明文即认为成功。
 */
function tryDecrypt(raw: Buffer, diagnostics: string[]): Buffer | null {
  if (raw.length <= 32) return null;

  const iv = raw.subarray(0, 16);

  // 约定 A：整体作为密文（IV 另取，密文为全部字节）
  const whole = aesCbcDecrypt(raw, iv);
  if (whole && whole.subarray(0, 4).equals(BND4_MAGIC)) {
    diagnostics.push('外层加密已解开（约定 A：整体 CBC 解密）。');
    return whole;
  }

  // 约定 B：跳过前 16 字节的 IV 头
  const tail = aesCbcDecrypt(raw.subarray(16), iv);
  if (tail && tail.subarray(0, 4).equals(BND4_MAGIC)) {
    diagnostics.push('外层加密已解开（约定 B：跳过 IV 头解密）。');
    return tail;
  }

  return null;
}

/**
 * 解析容器层：识别平台、必要时解密，返回明文缓冲区。
 */
export function openContainer(raw: Buffer): ContainerResult {
  const diagnostics: string[] = [];

  if (raw.length < PC_HEADER_SIZE) {
    return {
      ok: false,
      error: `文件太小（${raw.length} 字节），不像是一个完整的 ER0000.sl2 存档。`,
      stage: 'container',
      diagnostics,
    };
  }

  const head = raw.subarray(0, 4);

  // 明文 BND4
  if (head.equals(BND4_MAGIC)) {
    diagnostics.push('检测到明文 BND4 容器（PC）。');
    return { ok: true, info: { platform: 'pc', wasEncrypted: false, buffer: raw, diagnostics } };
  }

  // 主机的存档
  if (head.equals(PS4_MAGIC)) {
    return {
      ok: false,
      error:
        '这是一份 PS4/PS5 主机存档。主机存档无法从主机导出，其外层格式也与 PC 不同，本项目不支持解析。' +
        'PC 版用户请上传 %APPDATA%\\EldenRing\\<你的SteamID64>\\ER0000.sl2。',
      stage: 'container',
      diagnostics: [...diagnostics, '检测到 PS4 魔数 CB 01 9C 2C。'],
    };
  }

  // 可能是 Steam 外层加密
  const decrypted = tryDecrypt(raw, diagnostics);
  if (decrypted) {
    return {
      ok: true,
      info: { platform: 'pc', wasEncrypted: true, buffer: decrypted, diagnostics },
    };
  }

  return {
    ok: false,
    error:
      '无法识别这个文件。它既不是明文 BND4 存档，也不是本项目能解开的 Steam 加密存档。' +
      '请确认上传的是 ER0000.sl2 本体（不是 .co2、也不是压缩包）。',
    stage: 'container',
    diagnostics: [
      ...diagnostics,
      `开头 4 字节：${head.toString('hex')}`,
      '尝试过：明文 BND4 判定、两种 AES-128-CBC 外层解密约定。',
    ],
  };
}

/**
 * 完整 PC 存档的真实大小。
 *
 * 实测核对（真实文件 28,967,888 = 0x1BA03D0）：
 *   头 0x300 + 10×块(0x10 MD5 + 0x280000) + UD10 块 0x60010 + UD11 块 0x240010
 *
 * ⚠️ 这里曾经被我算错过：当时按 UD10=0x60000、UD11=0x240000 推出 28,967,872，
 * 并据此断言"格式文档算错了"。真实文件证明**文档是对的、我错了** ——
 * BND4 入口表给出的块大小确实含它自己的 16 字节 MD5。
 */
export function expectedFullSize(): number {
  return PC_HEADER_SIZE + SLOT_COUNT * PC_SLOT_STRIDE + 0x60010 + 0x240010;
}

/** UserData10 块（含 MD5）的起始偏移；其数据在 +0x10 处 */
export function userData10BlockOffset(): number {
  return PC_HEADER_SIZE + SLOT_COUNT * PC_SLOT_STRIDE;
}

/** UserData10 数据段的结束位置（= UserData11 块开始处） */
export function userData10End(): number {
  return userData10BlockOffset() + 0x60010;
}

/** 计算某槽位数据在文件中的偏移（PC 布局） */
export function pcSlotDataOffset(slotIndex: number): number {
  return PC_HEADER_SIZE + MD5_SIZE + slotIndex * PC_SLOT_STRIDE;
}

/** 计算某槽位 MD5 校验和所在偏移（PC 布局） */
export function pcSlotMd5Offset(slotIndex: number): number {
  return PC_HEADER_SIZE + slotIndex * PC_SLOT_STRIDE;
}

/** 提取槽位的 MD5 校验和（16 字节） */
export function readSlotChecksum(buffer: Buffer, slotIndex: number): Buffer {
  const offset = pcSlotMd5Offset(slotIndex);
  return buffer.subarray(offset, offset + MD5_SIZE);
}

/** 校验某槽位数据的 MD5 是否与文件内记录的校验和一致 */
export function verifySlotChecksum(buffer: Buffer, slotIndex: number): boolean {
  const dataOffset = pcSlotDataOffset(slotIndex);
  const data = buffer.subarray(dataOffset, dataOffset + SLOT_SIZE);
  if (data.length !== SLOT_SIZE) return false;

  const actual = createHash('md5').update(data).digest();
  const recorded = readSlotChecksum(buffer, slotIndex);
  return actual.equals(recorded);
}

/** 槽位是否为空（version == 0 或校验和全 0） */
export function isSlotEmpty(buffer: Buffer, slotIndex: number): boolean {
  const checksum = readSlotChecksum(buffer, slotIndex);
  if (checksum.length === MD5_SIZE && checksum.every((b) => b === 0)) return true;

  const dataOffset = pcSlotDataOffset(slotIndex);
  if (dataOffset + 4 > buffer.length) return true;
  return buffer.readUInt32LE(dataOffset) === 0;
}

/* ------------------------------------------------------------------ *
 * BND4 入口表
 * ------------------------------------------------------------------ */

export interface Bnd4Entry {
  index: number;
  /** 数据在文件中的绝对偏移 */
  offset: number;
  size: number;
  /** UTF-16LE 名字，如 "USERDATA000" */
  name: string;
}

export interface Bnd4Header {
  ok: boolean;
  /** 入口数量 */
  entryCount?: number;
  /** 入口表在文件中的位置 */
  tableOffset?: number;
  entries: Bnd4Entry[];
  diagnostics: string[];
}

/** 从固定长度字段里读 UTF-16LE 名字并裁掉结尾的 0 */
function readFixedUtf16(buffer: Buffer, offset: number, sizeBytes: number): string {
  if (offset < 0 || offset + sizeBytes > buffer.length) return '';
  let end = sizeBytes;
  for (let i = 0; i + 1 < sizeBytes; i += 2) {
    if (buffer.readUInt16LE(offset + i) === 0) {
      end = i;
      break;
    }
  }
  return buffer.subarray(offset, offset + end).toString('utf16le').trim();
}

/**
 * 解析 BND4 入口表。
 *
 * 为什么需要这个：整个存档解析都建立在"槽位 N 的数据在 0x310 + N×0x280010"
 * 这个假设上。BND4 是带入口表的容器，表里明确写着每个块的真实偏移，
 * 用它来**证实或推翻**那个假设。
 *
 * ⚠️ 实测修正（两次都猜错过，最终以真实文件为准）：
 *   入口步长 = 0x50（不是 0x24）
 *   size  在 +0x08（u32）
 *   offset 在 +0x10（u32，不是 +0x08 或 +0x20）
 *   名字指针在 +0x14（u32，指向文件内该偏移处的 UTF-16LE 字符串）
 *
 * 真实文件核对结果（艾尔登法环 PC 存档）：
 *   入口 0: size=0x280010, offset=0x300    → 块 [0x300, 0x280310) 即 MD5 + 槽位数据
 *   入口 1: size=0x280010, offset=0x280310 → 块 [0x280310, 0x500320)
 *   …逐块连续，末块结束偏移 == 文件大小（0x1BA03D0），完全自洽。
 *   入口名形如 USER_DATA000 / USER_DATA005 / USER_DATA010。
 */
const BND4_ENTRY_STRIDE = 0x50;
const BND4_ENTRY_SIZE_AT = 0x08;
const BND4_ENTRY_OFFSET_AT = 0x10;
const BND4_ENTRY_NAME_AT = 0x14;

export function readBnd4Header(buffer: Buffer): Bnd4Header {
  const diagnostics: string[] = [];
  const empty: Bnd4Header = { ok: false, entries: [], diagnostics };

  if (buffer.length < 0x80) {
    diagnostics.push('文件太小，读不出 BND4 头。');
    return empty;
  }
  if (!buffer.subarray(0, 4).equals(BND4_MAGIC)) {
    diagnostics.push('开头不是 BND4。');
    return empty;
  }

  const entryCount = buffer.readUInt32LE(0x0c);
  const tableOffset = buffer.readUInt32LE(0x10);

  diagnostics.push(`BND4: entryCount=${entryCount}, tableOffset=0x${tableOffset.toString(16)}`);

  if (entryCount <= 0 || entryCount > 1024) {
    diagnostics.push(`entryCount=${entryCount} 不合理，放弃解析入口表。`);
    return { ok: false, entryCount, tableOffset, entries: [], diagnostics };
  }
  if (tableOffset < 0x40 || tableOffset + entryCount * BND4_ENTRY_STRIDE > buffer.length) {
    diagnostics.push(`tableOffset=0x${tableOffset.toString(16)} 越界，放弃解析入口表。`);
    return { ok: false, entryCount, tableOffset, entries: [], diagnostics };
  }

  const entries: Bnd4Entry[] = [];
  let skippedTail = 0;

  for (let i = 0; i < entryCount; i++) {
    const base = tableOffset + i * BND4_ENTRY_STRIDE;
    const size = buffer.readUInt32LE(base + BND4_ENTRY_SIZE_AT);
    const offset = buffer.readUInt32LE(base + BND4_ENTRY_OFFSET_AT);
    const nameOffset = buffer.readUInt32LE(base + BND4_ENTRY_NAME_AT);

    // 入口表里并非每一条都是"数据块"：实测 12 条中有 9 条是块描述，
    // 尾部若干条是容器内部结构（其 offset 字段不是文件偏移）。
    // 这类条目静默跳过即可，不必刷警告 —— 它们不影响槽位定位。
    if (offset > buffer.length || size === 0) {
      skippedTail++;
      continue;
    }

    entries.push({
      index: i,
      offset,
      size,
      name:
        nameOffset > 0 && nameOffset < buffer.length
          ? readFixedUtf16(buffer, nameOffset, 64)
          : '',
    });
  }

  if (skippedTail > 0) {
    diagnostics.push(`入口表 ${entryCount} 条中，${entries.length} 条是数据块描述，${skippedTail} 条为容器内部结构（已跳过）。`);
  }

  return { ok: true, entryCount, tableOffset, entries, diagnostics };
}
