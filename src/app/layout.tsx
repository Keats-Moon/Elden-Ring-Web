import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '艾尔登法环 Steam 数据追踪',
  description:
    '读取你自己 Steam 账号上的艾尔登法环成就进度、追忆 Boss 击杀记录与游玩时长，并可选择性解析本地存档获得完整的武器与装备收集清单。',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-neutral-950 text-neutral-200">{children}</body>
    </html>
  );
}
