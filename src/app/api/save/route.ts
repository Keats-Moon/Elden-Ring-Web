import { NextResponse } from 'next/server';
import { MAX_SAVE_BYTES, parseSave } from '@/lib/er/save';
import { getSessionSteamId } from '@/lib/steam/session';

export const dynamic = 'force-dynamic';

/**
 * 接收用户上传的 ER0000.sl2 并做**只读**解析。
 *
 * 隐私约定：
 *  - 文件只在内存里解析，不写磁盘、不入库、不缓存。
 *  - 解析结果只回给当前登录用户自己。
 *  - 绝不提供任何"写回/修改存档"的能力。
 */
export async function POST(req: Request) {
  const steamId = await getSessionSteamId();
  if (!steamId) {
    return NextResponse.json({ error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const candidate = form.get('save');
    if (candidate instanceof File) file = candidate;
  } catch (err) {
    return NextResponse.json(
      { error: `无法读取上传内容：${(err as Error).message}`, stage: 'upload', diagnostics: [] },
      { status: 400 },
    );
  }

  if (!file) {
    return NextResponse.json(
      { error: '请求里没有找到名为 save 的文件字段。', stage: 'upload', diagnostics: [] },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { error: '上传的文件是空的。', stage: 'upload', diagnostics: [] },
      { status: 400 },
    );
  }

  if (file.size > MAX_SAVE_BYTES) {
    return NextResponse.json(
      {
        error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB）。ER0000.sl2 通常在 28.9 MB 左右，请确认上传的不是别的东西。`,
        stage: 'upload',
        diagnostics: [],
      },
      { status: 413 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: `读取文件内容失败：${(err as Error).message}`, stage: 'upload', diagnostics: [] },
      { status: 400 },
    );
  }

  // 传入当前登录账号，用于核对"这份存档是不是你自己的"
  const result = parseSave(buffer, steamId);

  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }

  return NextResponse.json(result);
}
