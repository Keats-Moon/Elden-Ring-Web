# ─────────────────────────────────────────────────────────────
# 多阶段构建：安装依赖 → 构建 → 只保留运行时所需文件
# 最终镜像不含源码、devDependencies 与构建缓存
# ─────────────────────────────────────────────────────────────

# ── 阶段 1：安装依赖 ──
FROM node:24-alpine AS deps
WORKDIR /app
# 只拷贝清单文件，让这一层能被 Docker 缓存复用
COPY package.json package-lock.json ./
RUN npm ci

# ── 阶段 2：构建 ──
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不需要真实密钥：所有密钥都在运行时从环境变量读取
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 阶段 3：运行时 ──
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 以非 root 用户运行
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone 产物：server.js + 运行时依赖
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# ⚠️ 这两处 standalone 不会自带，漏掉会导致页面 CSS/JS 全部 404
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 容器启动脚本：镜像里是 standalone 产物，没有 next CLI，
# 必须直接 `node server.js`；该脚本还会在有代理时条件性注入 --use-env-proxy。
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-start.mjs ./scripts/docker-start.mjs

USER nextjs
EXPOSE 3000

# 健康检查：首页能返回 200 即视为健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/docker-start.mjs"]
