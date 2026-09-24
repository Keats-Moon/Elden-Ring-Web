/**
 * 存档解析的统一入口。
 *
 * 用法：parseSave(buffer, expectedSteamId?) → SaveParseResult
 *
 * 安全与隐私约定（重要）：
 *  - 全程**内存中**只读解析，原始字节不写磁盘、不入库，解析函数返回后即被回收。
 *  - 绝不修改用户存档，因此不存在损坏存档或触发 EAC 反作弊的风险。
 *  - 解析结果只回传给请求者本人（路由层已校验登录会话）。
 */

import {
  PC_HEADER_SIZE,
  SLOT_COUNT,
  SLOT_SIZE,
  isSlotEmpty,
  openContainer,
  pcSlotDataOffset,
  pcSlotMd5Offset,
  readBnd4Header,
  verifySlotChecksum,
} from './bnd4';
import { type RawCharacter, categoryFromItemId, parseSlot } from './parse';
import type { SaveCharacter, SaveParseError, SaveParseResult } from '@/types/er';

/** 把一段字节转成 "偏移  hex  |ascii|" 的多行文本，便于人工核对结构 */
function hexDump(buffer: Buffer, offset: number, length: number): string {
  const lines: string[] = [];
  for (let i = 0; i < length; i += 16) {
    const start = offset + i;
    if (start >= buffer.length) break;
    const chunk = buffer.subarray(start, Math.min(start + 16, buffer.length));
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...chunk].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`      0x${start.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  return lines.join('\n');
}

/** 物品大类 → 中文标签 */
export const CATEGORY_LABEL_ZH: Record<string, string> = {
  weapon: '武器',
  armor: '防具',
  talisman: '护符',
  goods: '道具',
  ash_of_war: '战灰',
  unknown: '未分类',
};

/**
 * 装备区 22 个 item_id 槽位的语义名称。
 * 顺序依据 .sl2 装备区布局：10 武器 / 4 防具 / 5 护符 / 快速与袋位。
 */
const EQUIP_SLOT_NAMES: string[] = [
  '右手武器 1',
  '右手武器 2',
  '右手武器 3',
  '左手武器 1',
  '左手武器 2',
  '左手武器 3',
  '箭 / 弩矢 1',
  '箭 / 弩矢 2',
  '箭 / 弩矢 3',
  '箭 / 弩矢 4',
  '头部',
  '身体',
  '手部',
  '腿部',
  '护符 1',
  '护符 2',
  '护符 3',
  '护符 4',
  '快速道具 1',
  '快速道具 2',
  '快速道具 3',
  '快速道具 4',
];

/** 供路由层做请求体大小限制时参考：完整 PC 存档约 28.9 MB */
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * UserData10：全局数据里记录着账号 SteamID
 * ------------------------------------------------------------------ */

/**
 * 从 UserData10 里读存档归属的 SteamID64（PC 布局：偏移 0x04 起 8 字节）。
 * 用于提醒用户"你上传的是别人的存档"，而不是硬性拒绝。
 */
function readUd10SteamId(buffer: Buffer): string {
  // UD10 数据段起点 = 头 + 10 个槽位 + 该段的 MD5(16)
  const ud10Offset = PC_HEADER_SIZE + SLOT_COUNT * (SLOT_SIZE + 16) + 16;
  if (ud10Offset + 12 > buffer.length) return '';

  const value = buffer.readBigUInt64LE(ud10Offset + 4);
  if (value === 0n || value === 0xffffffffffffffffn) return '';
  return value.toString();
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export function parseSave(raw: Buffer, expectedSteamId?: string): SaveParseResult | SaveParseError {
  const container = openContainer(raw);
  if (!container.ok) {
    return {
      ok: false,
      error: container.error,
      stage: container.stage,
      diagnostics: container.diagnostics,
    };
  }

  const { buffer, diagnostics } = container.info;

  const minSize = PC_HEADER_SIZE + SLOT_COUNT * (SLOT_SIZE + 16);
  if (buffer.length < minSize) {
    return {
      ok: false,
      error: `存档长度不足：至少需要 ${minSize} 字节，实际 ${buffer.length} 字节。文件可能被截断。`,
      stage: 'container',
      diagnostics,
    };
  }

  const characters: SaveCharacter[] = [];
  let checksumsValid = true;
  let anyChecksumChecked = false;

  // ── 先用 BND4 入口表核对"槽位在 0x310 + N×0x280010"这个假设 ──
  // 整个解析都建立在这个假设上，而它来自格式文档，值得用容器自带的入口表交叉验证。
  const bnd4 = readBnd4Header(buffer);
  diagnostics.push(...bnd4.diagnostics);
  if (bnd4.ok && bnd4.entries.length > 0) {
    // 入口的 offset 指向"MD5 + 槽位数据"这一整块的起点，即校验和所在处；
    // 槽位数据本身在它 +0x10 处。
    const firstSlotBlock = pcSlotMd5Offset(0);
    const entry0 = bnd4.entries[0];
    const matches = entry0.offset === firstSlotBlock;

    diagnostics.push(
      `BND4 入口 0「${entry0.name || '(无名)'}」offset=0x${entry0.offset.toString(16)} ` +
        `size=0x${entry0.size.toString(16)}；本地布局假设的槽位块起点 = 0x${firstSlotBlock.toString(16)}。`,
    );

    if (matches) {
      diagnostics.push('✓ 容器入口表与本地布局假设一致。');
    } else {
      diagnostics.push(
        '✗ 容器入口表与本地布局假设**不一致** —— 槽位数据可能不在预期位置，' +
          '下方解析结果不可信。入口表前 4 项：' +
          bnd4.entries
            .slice(0, 4)
            .map((e) => `#${e.index}「${e.name || '无名'}」@0x${e.offset.toString(16)}+0x${e.size.toString(16)}`)
            .join('  '),
      );
    }
  } else if (bnd4.ok) {
    diagnostics.push('BND4 入口表读到了但没有任何有效入口。');
  }

  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    if (isSlotEmpty(buffer, slotIndex)) continue;

    const dataOffset = pcSlotDataOffset(slotIndex);
    const slotBytes = buffer.subarray(dataOffset, dataOffset + SLOT_SIZE);

    // 校验和：只做提示，不作为拒绝理由（用户手动改过的存档校验和可能已失效）
    const valid = verifySlotChecksum(buffer, slotIndex);
    anyChecksumChecked = true;
    if (!valid) checksumsValid = false;

    const parsed = parseSlot(slotBytes, slotIndex);
    if (!parsed.ok) {
      diagnostics.push(`槽位 ${slotIndex} 解析失败：${parsed.error}`);
      // 槽位解析失败时把开头的原始字节打出来 —— 这是判断"整块数据是否错位"
      // 最直接的证据：真实槽位开头应该是合理的小版本号，而不是随机字节。
      diagnostics.push(`[槽位${slotIndex}] 数据起始处原始字节（0x${dataOffset.toString(16)}）：`);
      diagnostics.push(hexDump(buffer, dataOffset, 96));
      continue;
    }

    diagnostics.push(...parsed.character.diagnostics.map((d) => `[槽位${slotIndex}] ${d}`));
    if (!valid) diagnostics.push(`[槽位${slotIndex}] MD5 校验和不匹配（存档可能被外部工具修改过）。`);

    characters.push(toSaveCharacter(parsed.character));
  }

  if (characters.length === 0) {
    return {
      ok: false,
      error:
        '容器解析成功，但没能在任何槽位里定位到角色数据。' +
        '这通常意味着槽位内部的字段偏移与当前游戏版本不符（不是你的文件有问题）。' +
        '请展开下方「解析诊断」——里面包含 BND4 入口表的真实偏移与槽位起始字节，' +
        '足以判断偏移差在哪。',
      stage: 'slots',
      diagnostics,
    };
  }

  const saveSteamId = readUd10SteamId(buffer);

  if (expectedSteamId && saveSteamId && saveSteamId !== expectedSteamId) {
    diagnostics.push(
      `注意：这份存档记录的账号是 ${saveSteamId}，与当前登录账号 ${expectedSteamId} 不一致 —— ` +
        '你展示的是别人的存档数据。',
    );
  }

  if (anyChecksumChecked && !checksumsValid) {
    diagnostics.push('存在校验和不匹配的槽位，解析结果可能有偏差，请留意下面的"存档归属核对"。');
  }

  return {
    ok: true,
    source: 'save',
    steamId: saveSteamId,
    slotCount: characters.length,
    characters,
    checksumsValid,
    diagnostics,
  };
}

/* ------------------------------------------------------------------ *
 * 内部结构 → 对外结构
 * ------------------------------------------------------------------ */

function toSaveCharacter(raw: RawCharacter): SaveCharacter {
  // 背包里同一件物品可能在多个索引出现（不同强化等级分开存），
  // 按 itemId 聚合数量，得到玩家真正关心的"收集到了什么、有多少"。
  const aggregated = new Map<number, { name: string; quantity: number; category: string }>();

  for (const entry of raw.inventory) {
    const existing = aggregated.get(entry.itemId);
    if (existing) {
      existing.quantity += entry.quantity;
    } else {
      aggregated.set(entry.itemId, {
        // 名称映射表是可插拔的（见 items/ 目录说明）；未命中时先显示物品 ID，
        // 不编造名字，也不隐藏数据。
        name: '',
        quantity: entry.quantity,
        category: categoryFromItemId(entry.itemId),
      });
    }
  }

  const equipped = raw.equippedItemIds
    .map((itemId, index) => ({ itemId, index }))
    .filter(({ itemId }) => itemId !== 0 && itemId !== 0xffffffff)
    .map(({ itemId, index }) => ({
      slot: EQUIP_SLOT_NAMES[index] ?? `槽位 ${index}`,
      itemId,
      name: '',
    }));

  return {
    slot: raw.slotIndex,
    name: raw.name,
    level: raw.level,
    runes: raw.runes,
    version: raw.version,
    playtimeSeconds: 0, // 时长以 Steam 官方数据为准，存档里不可靠
    stats: raw.stats,
    equipped,
    inventory: [...aggregated.entries()].map(([itemId, info]) => ({
      itemId,
      name: info.name,
      quantity: info.quantity,
      category: info.category,
    })),
    afterAnchorSupported: raw.afterAnchorSupported,
  };
}
