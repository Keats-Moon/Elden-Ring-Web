/**
 * 艾尔登法环数据追踪站 —— 共享类型定义
 *
 * 数据有两个来源，所有对外结构都带 source 标记，UI 必须如实展示来源：
 *  - "steam" : Steam 官方 Web API（成就、时长、游戏库）
 *  - "save"  : 用户上传的 ER0000.sl2 存档本地解析结果
 */

/** 艾尔登法环在 Steam 上的 AppID */
export const ELDEN_RING_APPID = 1245620;

export type DataSource = 'steam' | 'save';

/* ------------------------------------------------------------------ *
 * Steam 层
 * ------------------------------------------------------------------ */

export interface PlayerSummary {
  steamId: string;
  personaName: string;
  profileUrl: string;
  avatar: string;
  avatarMedium: string;
  avatarFull: string;
  /** 0 离线 1 在线 2 忙碌 3 离开 4 打盹 5 想交易 6 想玩游戏 */
  personaState: number;
  visibility: number;
}

export interface OwnedGameInfo {
  appId: number;
  name?: string;
  playtimeForeverMinutes: number;
  playtimeTwoWeeksMinutes: number;
  /** Unix 秒 */
  lastPlayed?: number;
}

export type AchievementCategory =
  | 'boss' // 追忆 Boss
  | 'ending' // 结局
  | 'progression' // 主线推进
  | 'collection' // 收集类（传说武器/护符/骨灰/法术）
  | 'other';

export interface AchievementDef {
  /** Steam 内部 API 名称，如 ACHIEVEMENT_0 */
  apiName: string;
  /** 显示名（Steam 返回为多语言，取中文优先） */
  displayName: string;
  description: string;
  hidden: boolean;
  /** 全局解锁百分比，0-100 */
  globalPercent: number;
  icon: string;
  iconGray: string;
  /** 我方补充的语义分类与关联 Boss 名 */
  category: AchievementCategory;
  bossName?: string;
}

export interface PlayerAchievement {
  apiName: string;
  achieved: boolean;
  /** Unix 秒，未解锁为 0 */
  unlockTime: number;
}

export interface AchievementView extends AchievementDef {
  achieved: boolean;
  unlockTime: number;
}

export interface AchievementProgress {
  total: number;
  unlocked: number;
  percent: number;
  achievements: AchievementView[];
  /** 数据来源 */
  source: DataSource;
}

/* ------------------------------------------------------------------ *
 * 存档层（ER0000.sl2）
 * ------------------------------------------------------------------ */

export interface CharacterStats {
  vigor?: number;
  mind?: number;
  endurance?: number;
  strength?: number;
  dexterity?: number;
  intelligence?: number;
  faith?: number;
  arcane?: number;
}

export interface EquippedItem {
  /** 装备槽位名（右手1/左手1/头部……） */
  slot: string;
  itemId: number;
  /** 物品名称；名称映射表未命中时为空字符串，UI 需回退显示 itemId */
  name: string;
  /** 强化等级，未强化为 0；当前未解析该字段时为 undefined */
  upgrade?: number;
}

export interface InventoryItem {
  itemId: number;
  /** 物品名称；名称映射表未命中时为空字符串 */
  name: string;
  quantity: number;
  /** 物品大类：weapon / armor / talisman / goods / ash_of_war …… */
  category: string;
}

export interface SaveCharacter {
  /** 槽位序号 0-9 */
  slot: number;
  name: string;
  level: number;
  runes: number;
  /** 槽位格式版本；越高表示存档越新，也越可能超出我们已验证的偏移范围 */
  version: number;
  /** 游戏内累计游玩秒数 */
  playtimeSeconds: number;
  stats: CharacterStats;
  equipped: EquippedItem[];
  inventory: InventoryItem[];
  /** 已激活赐福点数量（若能解析） */
  gracesActivated?: number;
  /**
   * 锚点之后的结构（背包 / 装备）是否被解析。
   *
   * false 时 equipped 与 inventory 必定为空，且**不代表该角色没有物品** ——
   * 而是这份存档的格式版本超出已验证范围。界面必须据此如实说明，
   * 不能把"解析不了"显示成"一件都没有"。
   */
  afterAnchorSupported: boolean;
}

export interface SaveParseResult {
  ok: true;
  source: 'save';
  /** 存档所属 SteamID64（来自存档路径/头部），用于与登录账号核对 */
  steamId: string;
  slotCount: number;
  characters: SaveCharacter[];
  /** 校验结果 */
  checksumsValid: boolean;
  /** 解析过程中的诊断信息，便于排查偏移问题 */
  diagnostics: string[];
}

export interface SaveParseError {
  ok: false;
  error: string;
  /** 若解析在某个阶段失败，给出阶段名 */
  stage: string;
  diagnostics: string[];
}

/* ------------------------------------------------------------------ *
 * 组合视图
 * ------------------------------------------------------------------ */

export interface BossRecord {
  name: string;
  defeated: boolean;
  /** Unix 秒 */
  defeatedAt: number;
  /** 关联成就的显示名 */
  achievementName: string;
  /**
   * 该 Boss 是否被 Steam 成就系统追踪。
   * 非追忆 Boss 不在成就系统内 —— 此处恒为 true，保留字段用于未来扩展。
   */
  trackedByAchievement: boolean;
}

export interface MeResponse {
  player: PlayerSummary;
  game: OwnedGameInfo | null;
  ownsGame: boolean;
  /**
   * 游戏库读取失败时的原因。
   * 读取失败与"确实没有这个游戏"是两回事，不能混为一谈 ——
   * 前者通常是隐私设置问题，需要明确告诉用户去改设置。
   */
  libraryWarning?: string;
}

export interface AchievementsResponse {
  progress: AchievementProgress;
  bosses: BossRecord[];
  /** 档案不公开等情况下给出可操作提示 */
  warning?: string;
}
