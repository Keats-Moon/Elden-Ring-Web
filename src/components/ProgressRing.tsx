import { formatPercent } from '@/lib/format';

/** 环形进度条（纯 SVG，无第三方依赖） */
export default function ProgressRing({
  percent,
  size = 116,
  label,
  sublabel,
}: {
  percent: number;
  size?: number;
  label?: string;
  sublabel?: string;
}) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dash = (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      {/* 用相对容器 + 绝对居中来叠文字，比负 margin 稳，不受字号变化影响 */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="-rotate-90"
          role="img"
          aria-label={`成就完成度 ${formatPercent(clamped)}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-neutral-800"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            className="text-amber-400 transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-amber-300">
            {formatPercent(clamped)}
          </span>
          {label ? <span className="text-[11px] text-neutral-400">{label}</span> : null}
        </div>
      </div>
      {sublabel ? <div className="mt-2 text-xs text-neutral-400">{sublabel}</div> : null}
    </div>
  );
}
