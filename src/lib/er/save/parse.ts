/**
 * 单个角色槽位（0x280000 字节）的内部结构解析。
 *
 * 全部偏移来自社区对 .sl2 的公开二进制分析。核心设计原则：
 *  **每一步都做边界与合理性校验**，解析不确定的地方宁可少给数据 + 记诊断，
 *  也不猜一个值糊弄 UI。偏移错一格会级联污染后面所有数据，所以宁可保守。
 *
 * 关键锚点：槽位里有一段 64 字节的 "MagicPattern"，它同时是 PlayerGameData
 * 的起始位置。所有属性字段都是以它为原点、用**负偏移**读出来的。
 */

import { SLOT_SIZE } from './bnd4';

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 槽位里作为锚点的 MagicPattern：4 次重复 [0x00, 0xFFFFFFFF, 12×0x00] */
const MAGIC_PATTERN = Buffer.from([
  0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** 物品区（GaItems）起始偏移 */
const GAITEMS_START = 0x20;

/**
 * 我们**经过真实存档验证**的最高槽位版本。
 *
 * 真实存档实测版本为 252 / 260。锚点**之前**的字段（属性、等级、角色名）用负偏移
 * 读取，已逐项验证正确；而锚点**之后**的结构（物品表 → 背包 → 装备区）依赖
 * 固定偏移推算，其中物品表是**变长记录**，一旦第一条读歪，后面整条链全部失准 ——
 * 实测在 version 260 上正是这种情况。
 *
 * 因此按版本门控：高于此值时只交付锚点之前的字段，不输出可疑的物品数据。
 */
const VERIFIED_MAX_VERSION = 81;

/** 物品表条目数：槽位 version ≤ 81 为 5118，否则 5120 */
const GAITEM_COUNT_OLD = 0x13fe; // 5118
const GAITEM_COUNT_NEW = 0x1400; // 5120

/** 空/无效句柄 */
const HANDLE_INVALID = 0xffffffff;

/** 句柄高 4 位决定记录长度 */
const RECORD_SIZE_WEAPON = 21;
const RECORD_SIZE_ARMOR = 16;
const RECORD_SIZE_DEFAULT = 8;

/** 装备区的 item_id 槽位数：22 个 u32（10 武器 + 4 防具 + 5 护符 + 快速/袋位） */
const EQUIP_SLOT_COUNT = 22;

/** 背包容量 */
const HELD_COMMON_CAPACITY = 0xa80; // 2688
const HELD_KEY_CAPACITY = 0x180; // 384
const STORAGE_COMMON_CAPACITY = 0x780; // 1920
const STORAGE_KEY_CAPACITY = 0x80; // 128
const INV_RECORD_SIZE = 12; // handle(4) + qty(4) + index(4)
const INV_EQUIP_RESERVED_MAX = 432;

/**
 * 相对 MagicOffset 的动态偏移链（逐段累加）。
 * 名字与顺序严格对照 .sl2 格式文档，任何一步写错都会级联污染后面全部数据。
 */
const DYN_SP_EFFECT = 0xd0;
const DYN_EQUIP_INDEX = DYN_SP_EFFECT + 0x58;
const DYN_ACTIVE_EQUIP = DYN_EQUIP_INDEX + 0x1c;
const DYN_EQUIP_ID = DYN_ACTIVE_EQUIP + 0x58; // 装备区的 item_id 数组
const DYN_ACTIVE_EQUIP_GA = DYN_EQUIP_ID + 0x58;
const DYN_INVENTORY_HELD = DYN_ACTIVE_EQUIP_GA + 0x9010; // 背包（含 key 物品）

/** 背包段总长：common/key 两组，每组 = count(4) + 容量×12 */
const HELD_SECTION_BYTES =
  4 +
  HELD_COMMON_CAPACITY * INV_RECORD_SIZE +
  4 +
  HELD_KEY_CAPACITY * INV_RECORD_SIZE +
  8; // 末尾 NextEquipIndex + NextAcquisitionSortId 两个计数器

/** 属性字段相对 MagicOffset 的负偏移（已用真实存档验证） */
const OFF_VIGOR = -379;
const OFF_MIND = -375;
const OFF_ENDURANCE = -371;
const OFF_STRENGTH = -367;
const OFF_DEXTERITY = -363;
const OFF_INTELLIGENCE = -359;
const OFF_FAITH = -355;
const OFF_ARCANE = -351;
const OFF_LEVEL = -335;
const OFF_RUNES = -331;

/**
 * 角色名候选偏移。
 *
 * ⚠️ 实测修正：格式文档写的是 -283，但真实存档里名字在 **-286**（差 3 字节）。
 * 用 -283 读会得到 `\x00\x00K\x00e...` 这种错位内容，被名字合理性校验判为乱码，
 * 进而导致**整个槽位被丢弃** —— 哪怕属性、等级、时长其实都读对了。
 * 这个 bug 真实发生过，症状是"找不到任何有效角色槽位"。
 *
 * 因此这里按候选顺序逐个尝试，取第一个能读出合法名字的偏移。
 */
const NAME_OFFSET_CANDIDATES = [-286, -283, -288, -280];
const OFF_NAME_BYTES = 32; // 16 × UTF-16

/** 槽位内记录的 SteamID64 位于槽位末尾 8 字节 */
const OFF_STEAM_ID = SLOT_SIZE - 8;

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 安全的有符号 32 位读取 */
function i32(buf: Buffer, offset: number): number {
  return buf.readInt32LE(offset);
}

function u32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

/** 判断区间是否完全落在缓冲区里 */
function inBounds(buf: Buffer, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= buf.length;
}

/** 物品大类 */
export type ItemCategory =
  | 'weapon'
  | 'armor'
  | 'talisman'
  | 'goods'
  | 'ash_of_war'
  | 'unknown';

/** 由 item_id 高位前缀判断大类（注意：与句柄前缀是两套独立体系） */
export function categoryFromItemId(itemId: number): ItemCategory {
  const prefix = itemId & 0xf0000000;
  switch (prefix) {
    case 0x00000000:
      return 'weapon';
    case 0x10000000:
      return 'armor';
    case 0x20000000:
      return 'talisman';
    case 0x40000000:
      return 'goods';
    case 0x60000000:
      return 'ash_of_war';
    default:
      return 'unknown';
  }
}

/** 由句柄高 4 位判断 GaItem 记录长度 */
function recordSizeForHandle(handle: number): number {
  const type = handle & 0xf0000000;
  if (type === 0x80000000) return RECORD_SIZE_WEAPON;
  if (type === 0x90000000) return RECORD_SIZE_ARMOR;
  return RECORD_SIZE_DEFAULT;
}

/* ------------------------------------------------------------------ *
 * 解析结果
 * ------------------------------------------------------------------ */

export interface RawGaItem {
  handle: number;
  itemId: number;
  category: ItemCategory;
}

export interface RawInventoryEntry {
  handle: number;
  itemId: number;
  quantity: number;
  index: number;
  category: ItemCategory;
  /** true = 存放在篝火储物箱（木箱）里 */
  inStorage: boolean;
}

export interface RawCharacter {
  slotIndex: number;
  version: number;
  name: string;
  level: number;
  runes: number;
  stats: {
    vigor: number;
    mind: number;
    endurance: number;
    strength: number;
    dexterity: number;
    intelligence: number;
    faith: number;
    arcane: number;
  };
  /** 槽位内记录的 SteamID（用于与原登录账号核对） */
  slotSteamId: string;
  /** 背包 + 储物箱里的所有物品（仅低版本可解析，否则为空） */
  inventory: RawInventoryEntry[];
  /** 已装备物品的 item_id（仅低版本可解析，否则为空） */
  equippedItemIds: number[];
  /** 物品表：句柄 → item_id 映射，用于把装备区的句柄翻译成物品 */
  gaItemCount: number;
  /**
   * 锚点之后的结构（物品表 / 背包 / 装备区）是否被解析。
   * false 表示该存档版本超出已验证范围，界面应如实说明"暂不支持"，
   * 而不是显示空列表让人误以为"没有物品"。
   */
  afterAnchorSupported: boolean;
  diagnostics: string[];
}

export type SlotParseResult =
  | { ok: true; character: RawCharacter }
  | { ok: false; error: string; diagnostics: string[] };

/**
 * 在槽位里定位 PlayerGameData 锚点。
 *
 * ⚠️ 三个实测修正，全部来自真实存档，每一个都曾导致"找不到任何有效角色槽位"：
 *
 *  1. 格式文档说锚点是"MagicPattern 重复 4 次"，真实存档里却重复了 **13 次**
 *     （0xc6a9…0xc769）。起点仍是第一个匹配位置，但"恰好 4 次"的假设不成立。
 *
 *  2. **不能要求"相邻迭代都匹配"来判定连续。** 循环步长 1、模式每 16 字节出现，
 *     中间 15 个偏移必然不匹配并把计数器清零，于是 runLength 永远到不了 4。
 *     症状极具迷惑性：matchCount、首个匹配位置全都正确，就是没有候选。
 *
 *  3. **也不能简单改成步长 16。** 匹配位于 0xc6a9（mod 16 = 9），而步长 16 的
 *     循环若从 0x20 起步（mod 16 = 0），相位不同 —— 一个匹配都扫不到。
 *
 * 正确做法：**步长 1 扫描（保证不遗漏），但用"间距是否恰为 16"判断连续**，
 * 这样既不受中间不匹配位置影响，也不依赖起始相位。
 *
 * 定位策略：找出所有"间距 16 的匹配连段"，再用**属性 + 等级公式**
 * （等级 == 八项属性之和 − 79）挑出真正的 PlayerGameData 锚点。
 * 该判据已在真实存档上验证成立，比模式匹配可靠得多。
 */
function findMagicOffset(slot: Buffer, diagnostics: string[]): number {
  const candidates: number[] = [];

  let runLength = 0;
  let runStart = -1;
  let prevMatch = -1;

  const closeRun = () => {
    if (runStart >= 0 && runLength >= 4) candidates.push(runStart);
    runLength = 0;
    runStart = -1;
  };

  for (let i = GAITEMS_START; i + 16 <= slot.length; i++) {
    if (!slot.subarray(i, i + 16).equals(MAGIC_PATTERN)) continue;

    if (prevMatch >= 0 && i - prevMatch === 16) {
      runLength++; // 与上一个匹配相距恰好 16 字节 => 同一连段
    } else {
      closeRun();
      runStart = i;
      runLength = 1;
    }
    prevMatch = i;
  }
  closeRun();

  if (candidates.length === 0) return -1;

  for (const candidate of candidates) {
    if (looksLikePlayerData(slot, candidate)) {
      if (candidates.length > 1) {
        diagnostics.push(
          `MagicPattern 有 ${candidates.length} 段候选，已用"等级 = 属性之和 − 79"选定 0x${candidate.toString(16)}。`,
        );
      }
      return candidate;
    }
  }

  diagnostics.push(
    `MagicPattern 找到 ${candidates.length} 段候选，但没有一段能通过"等级 = 属性之和 − 79"校验；` +
      `暂用第一段 0x${candidates[0].toString(16)}，属性与背包数据可能不可信。`,
  );
  return candidates[0];
}

/** 用属性范围 + 等级公式判断这个位置是否真的是 PlayerGameData */
function looksLikePlayerData(slot: Buffer, anchor: number): boolean {
  const base = anchor + OFF_VIGOR;
  if (!inBounds(slot, base, 4 * 8)) return false;

  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const v = i32(slot, base + i * 4);
    if (v < 1 || v > 99) return false;
    sum += v;
  }

  const levelAt = anchor + OFF_LEVEL;
  if (!inBounds(slot, levelAt, 4)) return false;

  const level = i32(slot, levelAt);
  return level >= 1 && level <= 713 && level === sum - 79;
}

/** 读 UTF-16LE 字符串并裁掉结尾的 0 */
function readUtf16Name(slot: Buffer, offset: number, bytes: number): string {
  const raw = slot.subarray(offset, offset + bytes);
  let end = raw.length;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if (raw.readUInt16LE(i) === 0) {
      end = i;
      break;
    }
  }
  return raw.subarray(0, end).toString('utf16le').trim();
}

/**
 * 名字合理性检查。
 * 如果 MagicOffset 找错了，名字字段几乎必然是乱码 —— 用它来兜底验证偏移。
 */
function isPlausibleName(name: string): boolean {
  if (name.length === 0 || name.length > 16) return false;
  // 允许中日韩文字、拉丁字母、数字、常见符号
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z0-9 .'\-_]+$/u.test(
    name,
  );
}

/**
 * 解析物品表（GaItems）。
 *
 * 按**固定条数**读取，而不是"扫到 MagicOffset 为止"。
 * 后者会把垃圾字节误判成记录，导致记录长度错位、所有后续数据崩掉 ——
 * 这是社区文档中明确记录过的经典 bug，必须避免。
 */
function parseGaItems(slot: Buffer, version: number, diagnostics: string[]): Map<number, RawGaItem> {
  const expectedCount = version > 81 ? GAITEM_COUNT_NEW : GAITEM_COUNT_OLD;
  const map = new Map<number, RawGaItem>();

  let pos = GAITEMS_START;
  let parsed = 0;

  for (let i = 0; i < expectedCount; i++) {
    if (!inBounds(slot, pos, 8)) {
      diagnostics.push(`物品表在第 ${i} 条处越界（预期 ${expectedCount} 条），提前停止。`);
      break;
    }

    const handle = u32(slot, pos);
    const itemId = u32(slot, pos + 4);
    const size = recordSizeForHandle(handle);

    if (handle !== HANDLE_INVALID && handle !== 0 && itemId !== HANDLE_INVALID) {
      map.set(handle, { handle, itemId, category: categoryFromItemId(itemId) });
    }

    pos += size;
    parsed++;
  }

  if (parsed !== expectedCount) {
    diagnostics.push(`物品表只解析到 ${parsed}/${expectedCount} 条。`);
  }

  return map;
}

/**
 * 解析背包列表（held 或 storage）。
 * 布局：count(u32) + 固定容量条记录，每条 12 字节。
 * 空槽用 handle == 0 / 0xFFFFFFFF 标识，**不能遇到第一个空槽就停**
 * （社区文档记录的另一个 bug：稀疏空槽会丢物品）。
 */
function parseInventoryList(
  slot: Buffer,
  listOffset: number,
  commonCapacity: number,
  keyCapacity: number,
  gaItems: Map<number, RawGaItem>,
  inStorage: boolean,
  diagnostics: string[],
): { entries: RawInventoryEntry[]; nextOffset: number } {
  const entries: RawInventoryEntry[] = [];
  let pos = listOffset;

  const readGroup = (capacity: number) => {
    if (!inBounds(slot, pos, 4)) {
      diagnostics.push('背包列表越界，停止解析该段。');
      return;
    }
    // count 只作为参考，真实遍历始终按固定容量走，避免稀疏数据被截断
    pos += 4;
    for (let i = 0; i < capacity; i++) {
      if (!inBounds(slot, pos, INV_RECORD_SIZE)) return;
      const handle = u32(slot, pos);
      const quantity = u32(slot, pos + 4);
      const index = u32(slot, pos + 8);
      pos += INV_RECORD_SIZE;

      if (handle === 0 || handle === HANDLE_INVALID) continue;
      if (index < INV_EQUIP_RESERVED_MAX) continue; // 装备保留位，不属于背包

      const ga = gaItems.get(handle);
      if (!ga) continue;

      entries.push({
        handle,
        itemId: ga.itemId,
        quantity,
        index,
        category: ga.category,
        inStorage,
      });
    }
  };

  readGroup(commonCapacity);
  readGroup(keyCapacity);

  return { entries, nextOffset: pos };
}

/** 读槽位内记录的 SteamID64 */
function readSlotSteamId(slot: Buffer): string {
  if (!inBounds(slot, OFF_STEAM_ID, 8)) return '';
  const value = slot.readBigUInt64LE(OFF_STEAM_ID);
  return value === 0n ? '' : value.toString();
}

/* ------------------------------------------------------------------ *
 * 主解析入口
 * ------------------------------------------------------------------ */

/**
 * 解析一个槽位。
 * @param slotBytes 恰好 0x280000 字节的槽位数据
 */
export function parseSlot(slotBytes: Buffer, slotIndex: number): SlotParseResult {
  const diagnostics: string[] = [];

  const slot = slotBytes;
  if (slot.length !== SLOT_SIZE) {
    return {
      ok: false,
      error: `槽位数据长度异常：期望 ${SLOT_SIZE} 字节，实际 ${slot.length} 字节。`,
      diagnostics,
    };
  }

  const version = u32(slot, 0);
  if (version === 0) {
    return { ok: false, error: '空槽位。', diagnostics };
  }
  diagnostics.push(`槽位 version = ${version}。`);

  const magicOffset = findMagicOffset(slot, diagnostics);
  if (magicOffset < 0) {
    return {
      ok: false,
      error: '在这个槽位里找不到 PlayerGameData 锚点（MagicPattern），无法定位属性与背包。',
      diagnostics,
    };
  }
  diagnostics.push(`MagicOffset = 0x${magicOffset.toString(16)}。`);

  // ── 属性 ────────────────────────────────────────────────
  const statAt = (rel: number): number => {
    const abs = magicOffset + rel;
    if (!inBounds(slot, abs, 4)) return 0;
    return i32(slot, abs);
  };

  const stats = {
    vigor: statAt(OFF_VIGOR),
    mind: statAt(OFF_MIND),
    endurance: statAt(OFF_ENDURANCE),
    strength: statAt(OFF_STRENGTH),
    dexterity: statAt(OFF_DEXTERITY),
    intelligence: statAt(OFF_INTELLIGENCE),
    faith: statAt(OFF_FAITH),
    arcane: statAt(OFF_ARCANE),
  };

  // 合理性校验：属性应在 1..99（锚点定位已用它做过验证，这里再确认一次）
  const statValues = Object.values(stats);
  const statsSane = statValues.every((v) => v >= 1 && v <= 99);
  const level = statAt(OFF_LEVEL);
  const runes = statAt(OFF_RUNES);

  if (!statsSane) {
    diagnostics.push(
      `警告：属性值超出正常范围（${statValues.join(', ')}），存档可能来自其它版本或偏移已变化。`,
    );
  } else if (level !== statValues.reduce((a, b) => a + b, 0) - 79) {
    diagnostics.push(
      `警告：等级 ${level} 与属性之和 − 79 = ${statValues.reduce((a, b) => a + b, 0) - 79} 不一致，` +
        '说明锚点可能不准，属性仅供参考。',
    );
  } else {
    diagnostics.push(`等级 ${level} 与属性之和 − 79 一致，锚点可信。`);
  }

  // ── 名字 ────────────────────────────────────────────────
  // 逐个候选偏移尝试，取第一个读出来像人名的。
  // 即使全部失败也**不丢弃整个槽位** —— 属性、等级、背包可能都是好的，
  // 只因为名字读不出来就丢掉整份数据，是实测踩过的坑。
  let name = '';
  let usedNameOffset: number | null = null;
  const nameAttempts: string[] = [];

  for (const candidate of NAME_OFFSET_CANDIDATES) {
    const at = magicOffset + candidate;
    if (!inBounds(slot, at, OFF_NAME_BYTES)) continue;
    const value = readUtf16Name(slot, at, OFF_NAME_BYTES);
    if (isPlausibleName(value)) {
      name = value;
      usedNameOffset = candidate;
      break;
    }
    if (value) nameAttempts.push(`${candidate}→"${value}"`);
  }

  if (usedNameOffset !== null) {
    diagnostics.push(`角色名「${name}」（相对锚点偏移 ${usedNameOffset}）。`);
  } else {
    diagnostics.push(
      `未能读出可信的角色名（试过偏移 ${NAME_OFFSET_CANDIDATES.join(', ')}` +
        (nameAttempts.length ? `，读到：${nameAttempts.join(' / ')}` : '') +
        '）。属性与背包数据仍按锚点读取，但请留意是否合理。',
    );
  }

  // ── 锚点之后的结构 ──────────────────────────────────────
  //
  // 这一整块（物品表 → 背包 → 储物箱 → 装备区）依赖"锚点 + 固定偏移"的推算，
  // 而物品表是**变长记录**：一旦第一条读歪，后面整条链全部失准。
  // 真实存档（version 260）上实测就是这种情况，因此按版本门控：
  // 未经验证的版本只交付锚点之前的字段，不输出可疑的物品/装备数据。
  let inventory: RawInventoryEntry[] = [];
  const equippedItemIds: number[] = [];
  let gaItemCount = 0;
  let afterAnchorSupported = true;

  if (version <= VERIFIED_MAX_VERSION) {
    const gaItems = parseGaItems(slot, version, diagnostics);
    gaItemCount = gaItems.size;
    diagnostics.push(`物品表解析出 ${gaItems.size} 条有效记录。`);

    const inventoryOffset = magicOffset + DYN_INVENTORY_HELD;
    const held = parseInventoryList(
      slot,
      inventoryOffset,
      HELD_COMMON_CAPACITY,
      HELD_KEY_CAPACITY,
      gaItems,
      false,
      diagnostics,
    );

    const storageOffset = inventoryOffset + HELD_SECTION_BYTES;
    let storage: { entries: RawInventoryEntry[]; nextOffset: number } = {
      entries: [],
      nextOffset: storageOffset,
    };

    if (
      inBounds(slot, storageOffset, 4) &&
      inventoryOffset + HELD_SECTION_BYTES + 4 + STORAGE_COMMON_CAPACITY * INV_RECORD_SIZE <=
        slot.length
    ) {
      storage = parseInventoryList(
        slot,
        storageOffset,
        STORAGE_COMMON_CAPACITY,
        STORAGE_KEY_CAPACITY,
        gaItems,
        true,
        diagnostics,
      );
    } else {
      diagnostics.push('储物箱区间越界，已跳过（存档版本或偏移可能不同）。');
    }

    inventory = [...held.entries, ...storage.entries];

    const equipIdOffset = magicOffset + DYN_EQUIP_ID;
    if (inBounds(slot, equipIdOffset, EQUIP_SLOT_COUNT * 4)) {
      for (let i = 0; i < EQUIP_SLOT_COUNT; i++) {
        equippedItemIds.push(u32(slot, equipIdOffset + i * 4));
      }
    } else {
      diagnostics.push('装备区越界，未读取装备列表。');
    }
  } else {
    afterAnchorSupported = false;
    diagnostics.push(
      `槽位版本 ${version} 高于已验证版本 ${VERIFIED_MAX_VERSION}：` +
        '本槽位只输出已用真实存档验证过的字段（角色名、等级、卢恩、八项属性）。' +
        '物品表、背包、装备区的偏移在更高版本上未经证实，为避免显示错误数据已跳过。',
    );
  }

  return {
    ok: true,
    character: {
      slotIndex,
      version,
      name: name || `(未命名槽位 ${slotIndex})`,
      level,
      runes,
      stats,
      slotSteamId: readSlotSteamId(slot),
      inventory,
      equippedItemIds,
      gaItemCount,
      afterAnchorSupported,
      diagnostics,
    },
  };
}

/** 供上层拼接槽位数据时使用 */
export { SLOT_SIZE };
