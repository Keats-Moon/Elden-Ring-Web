/**
 * 未登录 / 未配置 API Key 时的引导页。
 * 这里必须把"需要哪些权限、为什么需要"讲清楚 —— 用户授权前有权知道。
 */
export default function Landing({
  hasApiKey,
  hasSecret,
  errorDetail,
}: {
  hasApiKey: boolean;
  hasSecret: boolean;
  errorDetail?: string;
}) {
  const ready = hasApiKey && hasSecret;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-400/70">Elden Ring Tracker</p>
        <h1 className="text-3xl font-semibold leading-tight text-neutral-100 sm:text-4xl">
          读取你在 Steam 上的<span className="text-amber-300">艾尔登法环</span>游戏数据
        </h1>
        <p className="text-sm leading-relaxed text-neutral-400">
          用 Steam 账号登录后，本站会读取你自己的成就进度、追忆 Boss 击杀记录与游玩时长，
          也可以叠加解析你的本地存档，得到完整的武器、装备与道具收集清单。
        </p>
      </header>

      {errorDetail ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
          登录未完成：{errorDetail}
        </div>
      ) : null}

      {!ready ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-200">
          <p className="font-medium">服务端还没配置好，暂时无法登录。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200/90">
            {!hasApiKey ? <li>缺少 <code>STEAM_API_KEY</code> —— 见 README 的申请步骤（1 分钟，免费）。</li> : null}
            {!hasSecret ? <li>缺少 <code>SESSION_SECRET</code> —— 用于给登录 Cookie 签名。</li> : null}
          </ul>
        </div>
      ) : (
        <a
          href="/login"
          className="inline-flex w-fit items-center gap-3 rounded-md bg-[#171a21] px-6 py-3 text-base font-medium text-white ring-1 ring-neutral-700 transition hover:bg-[#1f242c] hover:ring-amber-400/50"
        >
          {/* Steam 官方登录按钮样式（纯文字版，不引入外部图片来源） */}
          <span aria-hidden className="text-xl leading-none">🎮</span>
          通过 Steam 登录
        </a>
      )}

      <section className="space-y-4 border-t border-neutral-800 pt-6">
        <h2 className="text-sm font-medium text-neutral-300">本站会用到哪些权限</h2>
        <dl className="space-y-3 text-xs leading-relaxed">
          <div>
            <dt className="font-medium text-neutral-200">Steam OpenID 登录（只验证身份）</dt>
            <dd className="text-neutral-500">
              只用来确认「你是这个 SteamID64 的主人」。Steam 不会把密码交给本站，本站也无法代替你操作账号。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-200">读取你的公开成就与游戏库</dt>
            <dd className="text-neutral-500">
              通过 Steam 官方 Web API 读取。因此你的 Steam 隐私设置里「游戏详情」必须是<strong className="text-neutral-300">公开</strong>状态，
              否则 Steam 会拒绝返回数据。随时改回私密即可立即失效，本站不保留历史副本。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-200">读取你上传的存档（可选）</dt>
            <dd className="text-neutral-500">
              完整武器／装备清单只存在于本地存档 <code>ER0000.sl2</code> 里。上传后仅在服务器内存中<strong className="text-neutral-300">只读</strong>解析，
              不写磁盘、不入库、绝不修改你的存档。主机版存档无法导出，因此该功能仅 PC 可用。
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
