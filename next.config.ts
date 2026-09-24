import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * 产出 standalone 构建（`.next/standalone`）。
   *
   * 为什么需要：它只把**运行时真正用到的**文件和依赖复制出来，
   * 让 Docker 镜像从约 1GB 降到约 200MB。
   *
   * ⚠️ standalone 产出的 server.js **不会**自动带上 `.next/static`
   * 与 `public/`，Dockerfile 里必须手动拷贝这两处，否则页面的 CSS/JS 全部 404。
   */
  output: 'standalone',

  /**
   * 注意：这里**没有**设置 `experimental.serverActions.bodySizeLimit`。
   *
   * 存档上传走的是 Route Handler（`/api/save` 里的 `req.formData()`），
   * 而 `bodySizeLimit` 只作用于 Server Action（见 Next 文档原文
   * "the request body sent to a Server Action"），对 Route Handler 无效。
   * 实测 28.9MB 的存档可以正常上传。
   *
   * 真正的体积限制在应用层：`MAX_SAVE_BYTES = 64MB`（lib/er/save/index.ts），
   * 会在解析前拒绝超大文件并给出明确提示。
   *
   * ⚠️ 但托管平台可能另有请求体上限，部署前务必确认 ——
   * 例如 Vercel 的 Serverless 函数限制为 4.5MB，会导致存档上传直接 413。
   * 详见 docs/DEPLOY.md。
   */
};

export default nextConfig;
