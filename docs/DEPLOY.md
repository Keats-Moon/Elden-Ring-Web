# 部署指南

目标：让互联网上的任何人都能访问这个站点，**不需要你的电脑一直开机**。

---

## 0. 先读这一节：选址决策

**服务器不要放在中国大陆。** 两个硬原因：

1. **国内服务器访问 Steam 极不稳定**（`steamcommunity.com` 常被重置连接）。而本站服务端必须能调
   `api.steampowered.com` 与 `steamcommunity.com`，放国内就得在服务器上再套一层代理，复杂且脆弱。
2. **境内公网网站需要 ICP 备案**（域名 + 境内主机），个人办理周期以周计，未备案会被拦截。

**正确选择：香港 / 新加坡 / 日本节点。**
- 中国大陆访问延迟低（香港通常 30–60ms）
- 属境外主机，**不需要 ICP 备案**
- 能直连 Steam，**不需要配代理**

### 各平台对比

| 平台 | 免费额度 | 常驻 | 大请求体（28.9MB 存档） | 中国大陆访问 | 结论 |
|---|---|---|---|---|---|
| **Render** | 有（实例闲置 15 分钟休眠） | ⚠️ 会休眠，冷启动 30–60s | ✅ 支持 | 一般 | **验证阶段推荐** |
| **Fly.io** | 有（需绑卡） | ✅ 常驻 | ✅ 支持 | 一般（可选香港/新加坡） | 可用 |
| **Railway** | 试用额度 | ✅ 常驻 | ✅ 支持 | 一般 | 可用 |
| **香港 VPS**（阿里云/腾讯云国际/Vultr） | 无 | ✅ 常驻 | ✅ 支持 | ✅ 最好 | **正式上线推荐** |
| **Vercel** | 有 | ✅ | ❌ **请求体上限 4.5MB → 存档上传必失败** | 差 | ❌ **不适用** |

> Vercel 的限制见官方文档：请求体上限 4.5MB。
> 除非放弃存档功能，否则本项目无法部署在 Vercel 上。

---

## 1. 必须配置的环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `STEAM_API_KEY` | ✅ | 申请：https://steamcommunity.com/dev/apikey |
| `SESSION_SECRET` | ✅ | 登录 Cookie 的签名密钥，**至少 16 位随机字符** |
| `APP_ORIGIN` | ✅ | 用户实际访问的完整地址，**必须完全一致**（见 §4） |
| `PORT` | ❌ | 平台通常自动注入 |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | ❌ | 仅当服务器无法直连 Steam 时才需要 |

生成 `SESSION_SECRET`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

**安全提醒**：`.env*` 已加入 `.gitignore`，`.dockerignore` 也排除了密钥文件 ——
**镜像里不含任何密钥**，全部在运行时由平台注入。这是刻意的设计，请勿把密钥写进镜像。

---

## 2. 用 Docker 部署（通用，适用于任何容器平台或 VPS）

### 构建与运行

```bash
docker build -t elden-ring-tracker .

docker run -d --name ert \
  -p 3000:3000 \
  -e STEAM_API_KEY=你的key \
  -e SESSION_SECRET=你的随机串 \
  -e APP_ORIGIN=https://你的域名 \
  elden-ring-tracker
```

镜像特点：
- 多阶段构建，只含 standalone 产物 + 运行时依赖（约 200MB，不含源码与 devDependencies）
- 以非 root 用户运行
- 内置健康检查（探测 `/` 返回 200）

### 如果需要代理

境外主机通常直连 Steam，**不需要**代理。若你的服务器确实需要：

```bash
docker run -d --name ert -p 3000:3000 \
  -e STEAM_API_KEY=... -e SESSION_SECRET=... -e APP_ORIGIN=https://你的域名 \
  -e HTTPS_PROXY=http://你的代理:端口 \
  -e HTTP_PROXY=http://你的代理:端口 \
  -e NO_PROXY=127.0.0.1,localhost \
  elden-ring-tracker
```

启动脚本会检测到代理并自动加 `--use-env-proxy`（**必须在进程启动前生效**，
写在 `.env` 里为时已晚 —— 原因见 `src/lib/net/proxy.ts` 的注释）。

### VPS 上建议配 Nginx + HTTPS

Steam 登录在 HTTPS 下最稳，且 `SESSION_SECRET` 签发的 Cookie 在生产模式下带 `Secure` 标记。

```nginx
server {
    listen 443 ssl http2;
    server_name 你的域名;

    ssl_certificate     /etc/letsencrypt/live/你的域名/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/你的域名/privkey.pem;

    # 存档约 28.9MB，必须放开请求体上限，否则上传会被 Nginx 挡掉
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # 这几行让应用能推断出正确的对外地址
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
    }
}
```

证书用 certbot 免费签发：`certbot --nginx -d 你的域名`

> ⚠️ `client_max_body_size` 必须调大，Nginx 默认只有 1MB，会直接返回 413。

---

## 3. 用 Render 免费实例验证（推荐先走这条路）

1. 注册 https://render.com ，把本项目推到 GitHub
2. **New → Web Service**，连接仓库
3. 关键配置：
   - **Environment**：`Docker`（用本仓库的 Dockerfile）
   - **Region**：`Singapore`（离中国大陆最近）
   - **Instance Type**：`Free`
4. 在 **Environment Variables** 里加上 §1 的三项（`APP_ORIGIN` 填 Render 分给你的
   `https://xxx.onrender.com`，**注意不带尾部斜杠**）
5. Deploy

**免费实例的已知限制**：闲置 15 分钟会休眠，之后第一次访问需要 30–60 秒冷启动。
用于验证完全够用；正式对外建议升级或迁到 VPS。

### 关于免费子域名

Steam 登录**不校验域名所有权**，只要求 `return_to` 可访问且前后一致 ——
所以 `xxx.onrender.com` 这类免费子域名可以正常跑通登录，**不必先买域名**。

但长期建议买一个域名（几十元/年）：免费平台子域名会变，一改 `APP_ORIGIN` 登录就可能断；
而且申请 API Key 时登记的域名与实际情况不符，是**违反 Steam Web API 使用条款**的。

---

## 4. 最容易踩的坑：`APP_ORIGIN` 必须完全一致

Steam OpenID 要求登录请求里的 `openid.return_to` 与授权后回传的地址一致。
地址不一致时表现为 **Steam 报错或登录后在首页循环跳回未登录状态**。

必须完全一致的部分：协议、域名、端口、路径，且**不要带尾部斜杠**。

| 用户实际访问 | 正确的 `APP_ORIGIN` | 错误示例 |
|---|---|---|
| `https://ert.example.com` | `https://ert.example.com` | `https://ert.example.com/`（尾斜杠） |
| `https://xxx.onrender.com` | `https://xxx.onrender.com` | `http://xxx.onrender.com`（协议错） |
| `http://192.168.1.23:3000` | `http://192.168.1.23:3000` | `http://localhost:3000` |

**本项目已验证**：设置 `APP_ORIGIN=https://example.com` 后，
登录跳转里的 `openid.return_to` 与 `openid.realm` 都会被正确改写为该地址
（可用 `npm run selftest:standalone` 复现此验证）。

---

## 5. 部署后的验收清单

```bash
# 1. 首页可访问、有样式
curl -sI https://你的域名/ | head -1        # 期望 200

# 2. 未登录时 API 返回 401（而不是 500）
curl -s https://你的域名/api/me             # 期望 {"error":"未登录","code":"UNAUTHORIZED"}

# 3. 登录跳转指向 Steam，且回调地址是你的域名
curl -sI https://你的域名/login | grep -i location

# 4. 浏览器实测：完整走一遍 Steam 登录，确认能看到自己的成就
```

`curl` 第 3 步的输出里，`openid.return_to` 必须是**你的域名**，不能是 `localhost` 或内网 IP。

---

## 6. 故障排查

| 现象 | 原因与处理 |
|---|---|
| 页面没样式、CSS 404 | Dockerfile 漏了 `COPY .next/static` 或 `COPY public`（standalone 产物不含它们） |
| 登录后仍显示未登录 | `APP_ORIGIN` 与实际访问地址不一致，见 §4 |
| 点登录后 Steam 报错 | 同上；或反向代理没传 `X-Forwarded-Host` / `X-Forwarded-Proto` |
| 首页显示"服务端还没配置好" | `STEAM_API_KEY` 或 `SESSION_SECRET` 未注入到运行时环境 |
| 所有接口 502 / 超时 | 服务器连不上 Steam。境外主机通常直连即可；若确实不通，按 §2 配代理 |
| 存档上传 413 | 反向代理的请求体上限太小，调大 `client_max_body_size` |
| 存档上传 500 | 见 §7，可能是存档版本超出已验证范围 |
| 成就读不到 | 用户的 Steam「游戏详情」不是公开的。这是 Steam 的规则，界面上已有提示 |

---

## 7. 当前功能边界（部署前请知悉）

| 功能 | 状态 |
|---|---|
| Steam 登录（多用户各读自己的数据） | ✅ 已验证 |
| 成就进度 / Boss 击杀 / 时长 | ✅ 与官方接口逐项一致 |
| 存档上传：角色名、等级、八项属性 | ✅ 已用真实存档验证 |
| **存档上传：背包物品、装备** | ❌ **当前存档版本（252/260）上不可用**，界面会如实标注"暂不支持" |

背包区在锚点之后、依赖固定偏移推算，其中物品表是**变长记录**，一旦首条读错则整条链失准。
解析器已按版本门控（`VERIFIED_MAX_VERSION`），**读不出就不显示**，不会给用户看可疑数据。

部署给他人使用前请留意：用户如果期待看到"收集了哪些武器"，会看到"暂不支持"的说明。

---

## 8. 相关脚本

```bash
npm run build                # 生产构建（产出 standalone）
npm run selftest:standalone  # 本地复现容器流程并验证（无需 Docker）
npm run verify:steam -- <SteamID64>   # 用真实 Steam 数据验证接口
```
