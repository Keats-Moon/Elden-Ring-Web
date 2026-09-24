/**
 * 数据来源角标。
 * 这个组件存在的意义：本项目的两类数据可靠性不同 ——
 * Steam 官方成就接口是权威数据，存档解析是逆向工程的推断数据。
 * 必须在界面上如实区分，不能让用户混淆。
 */
export default function SourceBadge({ source }: { source: 'steam' | 'save' }) {
  if (source === 'steam') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300"
        title="来自 Steam 官方 Web API（GetPlayerAchievements / GetSchemaForGame），是权威数据"
      >
        <span aria-hidden>◆</span>
        Steam 官方
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"
      title="来自你上传的 ER0000.sl2 存档的本地解析结果。基于社区公开的二进制格式分析，字段偏移可能随游戏版本变化"
    >
      <span aria-hidden>◇</span>
      存档解析
    </span>
  );
}
