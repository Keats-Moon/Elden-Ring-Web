# 艾尔登法环 Steam 数据追踪站
突发奇想做的工具，可能没什么用
它可以：
读取**你自己** Steam 账号上的《艾尔登法环》游戏数据：成就进度、追忆 Boss 击杀记录、游玩时长，并可选择性解析本地存档，获得完整的武器 / 防具 / 护符 / 道具收集清单。

---

## 一、能得到什么

这一点决定了整个项目的形态，请先读完这一节。

**FromSoftware / 万代南梦宫没有开放任何官方 API。** Steam 官方也只公开它自己托管的那一层数据：

| 想要的数据 | 能否拿到 | 从哪来 |
|---|---|---|
| 成就（含解锁时间） | ✅ | Steam 官方 Web API |
| 全局完成率（多少人解锁了某成就） | ✅ | Steam 官方 Web API |
| 游玩时长 / 最后运行时间 | ✅ | Steam 官方 Web API |
| 是否拥有该游戏 | ✅ | Steam 官方 Web API |
| 追忆 Boss 击杀记录 | ✅ 部分 | 由成就反推（只有被做成成就的 Boss） |
| 武器 / 防具 / 护符 / 道具清单 | ❌ Steam 没有 | **只能解析本地存档** |
| 全部 Boss 击杀记录 | ❌ Steam 没有 | 成就系统未覆盖非追忆 Boss |
| 赐福点、等级、属性 | ❌ Steam 没有 | **只能解析本地存档** |

所以本项目采用**双层数据**，界面上用角标如实标注每条数据的来源：

- **Steam 官方**（蓝色角标）—— 权威数据，但只有成就与时长
- **存档解析**（琥珀色角标）—— 完整数据，但属于逆向工程的推断结果

> 注意：**非追忆 Boss 不在 Steam 成就系统内**。像大树守卫、蒙格温王朝的蒙格这类 Boss 没有任何成就，因此「Boss 与结局」页里不会出现它们。

---

## 二、需要哪些权限与凭证

| 项 | 用途 | 谁提供 |
|---|---|---|
| `STEAM_API_KEY` | 调 Steam Web API | **你**申请一次，填在服务端 `.env.local` |
| `SESSION_SECRET` | 给登录 Cookie 签名 | 你生成一个随机串 |
| 使用者本人的 Steam 账号 | OpenID 登录 | 每个使用者自己 |
| 使用者 Steam 隐私 → **游戏详情 = 公开** | 否则 Steam 拒绝返回成就 | 每个使用者自己设置 |
| 使用者的 `ER0000.sl2` | 完整收集清单 | 每个使用者自己上传（**仅 PC 版**） |

### 关于"不同用户各读自己的数据"

采用 **Steam OpenID 2.0** 登录：

1. 用户点「通过 Steam 登录」→ 跳转到 Steam 官方授权页
2. Steam 回调本站，带上 `openid.*` 签名参数
3. 本站把参数**原样回传 Steam 做 `check_authentication` 校验**（防止伪造登录）
4. 校验通过后取出该用户的 SteamID64，写入 HMAC 签名 + HttpOnly 的 Cookie
5. 之后所有请求都只读这个 SteamID 的数据


---

## 三、申请 Steam Web API Key（1 分钟）

1. 用你自己的 Steam 账号打开 https://steamcommunity.com/dev/apikey
2. **Domain Name** 随便填，本地开发填 `localhost` 即可（Steam 只登记用途，不校验所有权）
3. 勾选同意 → **Register**
4. 页面上会出现一串 32 位十六进制字符串，**这就是 API Key，复制走**（刷新后不再完整显示）

⚠️ 安全提醒：这个 Key 等同于你的账号权限。万一泄露，回到同一页面点 **Revoke** 立即作废重发。

---

## 四、本地运行

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
copy .env.local.example .env.local    # Windows
# cp .env.local.example .env.local    # macOS / Linux
# 然后编辑 .env.local，填入 STEAM_API_KEY 与 SESSION_SECRET

# 3. 启动开发服务器
npm run dev
```

打开 http://localhost:3000 ，点「通过 Steam 登录」。

生产构建：

```bash
npm run build
npm start
```

> 部署到线上时，把 `APP_ORIGIN` 设为你的公开域名（Steam 要求登录回调地址与请求时一致，反向代理下必须显式配置）。

> ⚠️ **改了 `.env.local` 之后必须重启服务器。**
> 实测：修改 `STEAM_API_KEY`（例如轮换 Key）后，Next 会在日志里打印 `Reload env: .env.local`，
> 但**已运行进程里的 `process.env` 并没有真正被替换**，服务端仍会用旧 Key 请求，
> 表现为所有接口返回 `Steam API 返回 HTTP 403`。
> 日志说"重载了"，实际没生效。改完请 `Ctrl+C` 后重新 `npm run dev`。

---

## 五、关于部署到公网

完整步骤见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。三条要点先说在前面：

1. **服务器不要放中国大陆。** 国内主机访问 Steam 不稳定，且境内公网网站需要 ICP 备案。
   选**香港 / 新加坡 / 日本**节点：延迟低、免备案、能直连 Steam。
2. **Vercel 不适用。** 它的 Serverless 请求体上限是 4.5MB，而存档约 28.9MB，
   上传会直接 413 失败。请用常驻 Node 服务的平台（Render / Fly.io / VPS）。
3. **`APP_ORIGIN` 必须与用户实际访问的地址完全一致**（协议、域名、端口，且不带尾部斜杠）。
   不一致会导致 Steam 拒绝登录 —— 这是部署时最常见的故障。

```bash
# 通用容器方式（任何支持 Docker 的平台或 VPS）
docker build -t elden-ring-tracker .
docker run -d -p 3000:3000 \
  -e STEAM_API_KEY=... -e SESSION_SECRET=... -e APP_ORIGIN=https://你的域名 \
  elden-ring-tracker
```

镜像里**不含任何密钥**（`.dockerignore` 已排除 `.env*`），全部由运行时注入。

---

## 六、导出成就语义映射表（推荐做一次）

Steam 只告诉你"有个成就叫某某某"，**不会告诉你它对应哪个 Boss**。这层语义由 `src/lib/er/er-achievement-map.json` 承载。

```bash
npm run dump:achievements
```

它会从真实 Steam 接口拉取全部成就定义并写入映射表。**导出后请人工过一遍** —— 机器只能给建议。

映射表已经预置好（从真实接口导出，42 条全覆盖）。空表也能跑，此时会退回名称兜底匹配。

> ⚠️ **两个实测教训，改这个文件前请先读**（`src/lib/er/achievements.ts` 里也有对应注释）：
>
> 1. **Boss 成就的显示名就是 Boss 名本身**（如「火焰巨人」「狮子混种」），**不含「击败」这类动词**。
>    早期版本用"名称含击败 → 判为 Boss"的关键词匹配，结果 **30 个 Boss 成就全被误判成 other**。
>    所以 Boss 判定必须走 apiName 映射表，不能靠名称模式。
> 2. **语言会影响显示名**。Steam 的 `l` 参数决定返回中文还是英文名（不带 `l` 时返回
>    `Shardbearer Godrick` 这种英文名）。映射表按中文名建立，因此：
>    - 拉取 schema 必须带 `l=schinese`
>    - 分类逻辑只依赖 apiName（语言无关），并有回归测试锁死这一性质

---

## 七、网络代理（中国大陆环境通常必需）

实测：本机**直连 `api.steampowered.com` 间歇性超时、`steamcommunity.com` 直接 `ECONNRESET`**；
走本机代理（`127.0.0.1:7897`）则稳定成功。如果你的环境直连没问题，可跳过本节。

在 `.env.local` 里配置：

```bash
HTTPS_PROXY=http://127.0.0.1:7897
HTTP_PROXY=http://127.0.0.1:7897
NO_PROXY=localhost,127.0.0.1,::1
```

**但光配这几个变量是不够的**，原因值得说明白：

- Node 的 fetch 基于 undici，而 undici **只在模块加载那一刻**读取代理设置。
  Next 把 `.env.local` 载入 `process.env` 发生在那之后 ——
  所以进程里明明能看到 `HTTPS_PROXY`，请求却依然直连超时（实测服务器日志确认为此现象）。
- 把 `--use-env-proxy` 写在 `node` 命令行上也**不够**：Next 会再 fork 子进程，
  实测服务器进程的 `process.execArgv` 为空，标志没传下去。

**解决办法已内置**：`npm run dev` / `npm start` 会经由 `scripts/dev-with-proxy.mjs` 启动，
该脚本读取 `.env.local`，把 `NODE_OPTIONS=--use-env-proxy`（可继承，覆盖整个进程树）
与 `NO_PROXY` 组装好再拉起 Next。你只需正常执行 `npm run dev`。

**`NO_PROXY` 是必须的**：否则连访问自己的 `localhost:3000` 都会被塞进代理，
拿回代理的错误页（形如 `{"status":"failed","retcode":1401,"wording":"unauthorized"}`），
而不是本站响应 —— 这个现象实测踩过，很容易被误判成"登录失败"。

---

## 八、存档解析说明与限制

### 支持范围

- ✅ **PC 明文 BND4 存档**（`ER0000.sl2`，约 28.9 MB）
- ✅ **PC 上被 Steam 外层 AES-128-CBC 加密的存档**（自动识别并解密）
- ❌ PS5 / Xbox 存档 —— 无法从主机导出，且外层格式不同，检测到会明确报错
- ❌ **绝不支持写入** —— 写回存档有损坏存档与触发 EAC 反作弊的风险，本项目只读

### 存档位置

```
%APPDATA%\EldenRing\<你的SteamID64>\ER0000.sl2
```

### 隐私设计

- 文件**只在服务端内存中解析**，不写磁盘、不入库、不缓存
- 解析完立即丢弃原始字节
- 结果只返回给当前登录用户本人
- 只读解析，因此不可能损坏存档、不可能触发反作弊

### 已用真实存档验证的字段（可放心使用）

在玩家的真实存档（槽位版本 **252 / 260**）上逐项核对通过：

| 字段 | 验证依据 |
|---|---|
| 容器识别、BND4 入口表 | 入口 0「USER_DATA000」offset=`0x300`，与本地布局假设一致 |
| 槽位偏移 `0x310 + N×0x280010` | 10 个槽位的 MD5 校验和**全部匹配** |
| 存档归属 SteamID | 与登录账号一致 |
| `MagicPattern` 锚点 | 自动定位 + 属性校验 |
| **八项属性 / 等级** | `等级 == 属性之和 − 79` **精确吻合**（Lv253、Lv10） |
| **角色名** | 读到「Keats」，偏移 `锚点−286` |

> 关于名字偏移：社区文档写的是 `-283`，实测正确值是 **`-286`**（与 ER-Save-Lib 源码的
> `PlayerGameData + 0xB8` 一致）。用 `-283` 会读到错位内容、被合理性校验判为乱码，
> 进而**整个槽位被丢弃** —— 这个 bug 真实发生过，症状是"找不到任何有效角色槽位"。

### 尚未支持的字段（如实说明）

**背包物品清单、装备区、已激活赐福**在较新的存档版本上**尚未解析**。

原因：锚点**之后**的解析链是「物品表 → 背包 → 储物箱 → 装备区」，全部依赖固定偏移推算。
而**物品表是变长记录**（武器 21 字节 / 防具 16 字节 / 其余 8 字节）—— 一旦第一条读错，
后面整条链全部失准。实测该结构在槽位版本 260 上与社区文档记载的不一致。

（顺带一个勘误：文档给出的背包偏移 `0x9010`、储物箱 `0x6010` 已被证实**不正确**；
按 ER-Save-Lib 源码逐字段推算应为 `0x954` / `0x962C`，但用真实数据验证后这两者同样不成立。
无论哪一套都无法在该版本上读到自洽的背包数据。）

**本项目的处理方式**：解析器按版本门控（`VERIFIED_MAX_VERSION = 81`）。
高于该版本时**只输出已验证字段**，背包与装备留空，并在界面上明确写出
"该版本暂不支持，这并不表示该角色没有物品" —— 宁可少给数据，也不显示可疑数据。

### 调试与诊断

```bash
npm run analyze:save -- <存档路径>        # 只看容器与槽位结构
node --import ./scripts/ts-alias-loader.mjs scripts/parse-save.mjs <存档路径>   # 跑完整解析器
```

`analyze-save` 会打印 BND4 入口表、各槽位起始字节、MD5 校验结果与 MagicPattern 候选位置；
`parse-save` 直接调用应用内的解析器并输出全部诊断。两者都**只读**。

> 存档路径也可以用相对项目根目录的路径，例如先把文件拷成 `ER0000.sl2`
> （该文件名已在 `.gitignore` 中，不会被提交）。

如果解析结果明显不对，请把「解析诊断」内容反馈出来。

---

## 九、验证

```bash
npm run typecheck              # TypeScript 类型检查
npm run lint                   # ESLint
npm run build                  # 生产构建
npm run selftest               # 全部自测（存档容器层 + 成就分类管线）
npm run selftest:save          # 存档解析器自测（18 项）
npm run selftest:achievements  # 成就分类自测（17 项）
npm run verify:steam -- <SteamID64>   # 用真实 Steam 数据做端到端验证
```

> `verify:steam` 经 `scripts/run-with-env.mjs` 启动，会在**进程启动前**注入代理配置
> （脚本内部运行时再设 `process.env` 是无效的，实测过）。它会访问你本机的
> `localhost:3000`，因此需要开发服务器已在运行。

**`selftest:save`** 覆盖**存档容器层**：PC 明文 BND4 识别、槽位偏移公式（`0x310 + N×0x280010`）、
MD5 校验和、空槽位判定、版本号决定物品表条数（5118 / 5120）、PS4 存档识别、Steam 外层 AES-128-CBC 解密。

它**无法**覆盖槽位内部的字段偏移（那需要真实存档）—— 脚本结尾会明确列出这些未覆盖项，不会假装测过。
真实存档的验证方式是上传后查看界面上的「解析诊断」。

**`selftest:achievements`** 覆盖**成就分类管线**，直接 import 应用里的真实模块（不是复刻规则），
用实测导出的 42 个成就逐个校验分类结果、Boss 名提取、记录排序与未知成就的兜底行为。

**`verify:steam`** 需要外网 + 已配置的 API Key + 正在运行的开发服务器。它会校验 Key 有效性、
拉取成就定义与全局完成率，并对一个**公开档案**的账号跑通 `/api/achievements` 与官方接口的
**逐项比对**（解锁状态 + 时间戳）。用法：`npm run verify:steam -- <公开档案的SteamID64>`。

### 已实测确认的事实

- 艾尔登法环共 **42 个成就**，其中 **30 个是 Boss 讨伐**、5 个结局、5 个收集类、2 个主线里程碑
- 成就 apiName 为 `ACH00`–`ACH41`；`l=schinese` 生效时返回中文名，不带 `l` 返回英文名
- **Boss 成就的显示名就是 Boss 名本身**（如「火焰巨人」「狮子混种」），**不含「击败」这类动词**，
  且全部为隐藏成就。这一点直接决定了分类不能用关键词匹配 —— 详见 `src/lib/er/achievements.ts` 的注释
- 玩家「游戏详情」非公开时，官方接口返回 `success=false, error="Profile is not public"`，
  本站据此给出可操作提示（403）而不是干巴巴报错
- `GetOwnedGames` 的 **`appids_filter` 参数不生效**（传单个 AppID 仍返回整个游戏库，实测 76 个游戏），
  必须自己过滤
- `GetGlobalAchievementPercentagesForApp` 返回的 `percent` 是**字符串**（如 `"36.2"`），
  按数字处理会运行时崩溃
- **代理环境变量必须在 Node 启动前就存在**：写进 `.env.local` 无效，写在 `node` 命令行上
  也传不到 Next 的子进程，必须用可继承的 `NODE_OPTIONS`（详见第七节）
- 对真实账号的端到端比对结果：**本站与官方接口 42/42 条成就的解锁状态与解锁时间戳完全一致**

> 附带一个格式文档的勘误：社区流传的 `.sl2` 格式文档正文声称实测总长为 28,967,888 字节，
> 但这与它自己的行偏移表矛盾（表里最后一个字节落在 0x1BA03C0 = 28,967,872）。
> 28,967,888 的十六进制其实是 0x1BA03D0。本项目以**自洽的行布局**为准 ——
> 解析器实际依赖的只有行布局，不受该笔误影响。

---

## 十、物品名称映射表（未完成项，需要你补）

**这是本项目唯一的未完结部分，原因需要说清楚。**

存档里只存**物品 ID**（如 `0x003D0900`），不存名称。"ID → 名称"的权威来源是游戏本体的 `regulation.bin`（需本地装有游戏，自行解包生成），而社区流传的物品名称表多来自来源或授权不明的地方。**本项目不从来源不明处整包搬运数据表。**

当前的处理方式：

- 解析器与名称表**完全解耦**
- 未命中名称表时，界面**如实显示物品 ID**（社区通用的 `0xXXXXXXXX` 格式），而不是编造假名字
- 搜索能按 ID 匹配，方便你对照社区资料自查
- 想补全名称，只需给 `src/lib/er/items/` 加映射文件并在 `toSaveCharacter()` 里查表即可

这属于**数据来源问题，不是解析失败** —— 收集清单里有多少件物品、各自是什么类别，都已经准确读出来了。

---

## 十一、项目结构

```
src/
├─ app/
│  ├─ page.tsx                     首页：判断登录态 → 引导页 or 主面板
│  ├─ login/route.ts               跳转 Steam 授权页
│  ├─ logout/route.ts
│  ├─ auth/steam/return/route.ts   OpenID 回调 + 签名校验
│  └─ api/
│     ├─ me/route.ts               玩家摘要 + 游戏库
│     ├─ achievements/route.ts     成就定义 + 玩家解锁状态
│     ├─ save/route.ts             接收 .sl2 并只读解析
│     └─ img/route.ts              Steam 图片代理（白名单域名，防 SSRF）
├─ components/                     界面组件（引导页 / 主面板 / 成就 / Boss / 存档）
├─ lib/
│  ├─ steam/{api,openid,session}.ts   Steam API 封装、OpenID 校验、会话签名
│  ├─ er/achievements.ts              成就 → Boss / 结局 语义映射
│  └─ er/save/{bnd4,parse,index}.ts   容器解析、槽位解析、编排入口
└─ types/er.ts                     共享类型
```

---

## 十二、速率限制与缓存

Steam 未公布速率限制，实测约每分钟 100 次会返回 `429`。本项目：

- 成就定义缓存 1 小时、玩家成就 15 分钟、玩家摘要 5 分钟（全部在服务端内存）
- 对 `429` 做指数退避重试（最多 3 次）
- 界面上的「刷新数据」按钮可绕过缓存强制重拉

---

## 十三、法律与归属

- 本站为非官方工具。《艾尔登法环》相关商标与内容归 FromSoftware / 万代南梦宫所有。
- 使用 Steam Web API 需遵守 [Steam Web API 使用条款](https://steamcommunity.com/dev/apiterms)。
- 请只读取**你自己**账号与存档的数据。读取他人数据需得到对方明确同意。
