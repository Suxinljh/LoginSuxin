# LoginSuxin

Suxin 的统一账号、登录、积分与退款中心，部署在 **https://account.ljhsu.xin**（旧 `login.ljhsu.xin` 保留并 308 跳转）。

所有子项目（EchoMind、WeChatHot 等）共用这一套账号：用户注册一次，之后通过 OIDC 授权登录各个应用。各应用保持独立部署、独立数据库，只保存用户的 `sub`（用户 ID）和自己的业务数据。**积分归属账号而不是单个应用**，可在接入的平台通用；余额、用量和退款都在账号中心处理，充值跳转到持有支付商户号的接入应用完成（目前是 EchoMind）。

- 前端与服务端同源，运行在 Cloudflare Workers（Static Assets + D1）
- 认证由 [Better Auth](https://www.better-auth.com/) 实现，OIDC 由 `@better-auth/oauth-provider` 提供
- 支持邮箱 + 密码、GitHub / Google 第三方登录、邮箱验证与找回密码
- 账号积分：余额、充值入口（跳转 EchoMind 充值页）、跨应用用量、退款申请、管理员审核与原路退款
- 安全：登录/注册/找回密码等凭据接口按 IP 限流（D1 固定窗口）；管理员操作写入 `admin_audit`；每日对账余额与台账
- 每个账号一个 Durable Object，串行化消费/退款，避免计费延迟下的并发退款
- 登录态 Cookie 仅作用于 `account.ljhsu.xin`，不下发到父域

## 技术栈

| 层 | 选择 |
| --- | --- |
| 运行时 | Cloudflare Workers（`nodejs_compat`） |
| 数据库 | Cloudflare D1（Better Auth 经 Drizzle；积分/退款用原生 D1） |
| 并发 | Durable Objects（`AccountDO`，每账号一个，串行化消费/退款） |
| 认证 | Better Auth 1.7 + `@better-auth/oauth-provider` + `admin` / `jwt` 插件 |
| 前端 | React 19 + React Router 7 + Vite 6 + TypeScript 5 + Tailwind CSS 4 + HeroUI v3 |
| 邮件 | Cloudflare Email Sending（`send_email` 绑定，发件域名 `mail.ljhsu.xin`） |

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/auth.ts` | Better Auth 实例：D1、邮箱密码、社交登录、JWT/admin/OIDC 插件、邮件 |
| `src/auth.cli.ts` | 仅供 Better Auth CLI 生成数据库 schema 使用，不参与运行时 |
| `src/worker.ts` | Worker 入口：认证、账号积分、退款、管理员审核、应用扣减、静态资源 |
| `src/credits.ts` | 积分查询、退款预估、原路退款适配器 |
| `src/accountDO.ts` | 每账号一个 Durable Object：消费/退款申请/审核串行化 |
| `src/db/schema.ts` | 由 Better Auth CLI 生成的 Drizzle schema（物理表名 snake_case） |
| `src/client/*` | 登录、注册、找回密码、账户、积分、退款、退款规则、管理员审核、授权确认、更新日志 |
| `src/client/theme.css` | HeroUI 品牌主题变量（颜色、圆角、字体） |
| `public/brand/*` | 亮色/暗色 logo 与站点图标 |
| `scripts/create-client.mjs` | 以管理员身份创建 OAuth 客户端并输出 `client_id` / `client_secret` |
| `migrations/` | D1 SQL 迁移（`0000` Better Auth，`0001` 积分/退款） |
| `docs/client-integration.md` | 给各应用看的 OIDC 与积分扣减接入说明 |

## 本地开发

要求：Node.js 20+、pnpm 10+。

```bash
pnpm install --frozen-lockfile

cp .dev.vars.example .dev.vars
# 用 openssl rand -base64 32 生成 BETTER_AUTH_SECRET 填进 .dev.vars

pnpm db:migrate:local   # 初始化本地 D1
pnpm dev                # 同时启动 wrangler dev (:8787) 和 Vite (:5173)
```

打开 http://localhost:5173/ 注册第一个账号。

- `pnpm dev` 不是热更新服务：改了 `src/worker.ts`、`src/auth.ts` 会自动重载；改 `.dev.vars` 需要重启。
- 端口被占用时：`WEB_PORT=5183 WORKER_PORT=8788 pnpm dev`，同时把 `.dev.vars` 的 `BETTER_AUTH_URL` 改成 `http://localhost:5183`。
- `TRUSTED_ORIGINS` 里的 `http://account.ljhsu.xin` 是 wrangler 对 `routes` 自定义域名重写后的来源，本地也不要删，否则登录会返回 `Invalid origin`。

### 把账号设为管理员

只有管理员能创建 OAuth 客户端、审核退款：

```bash
pnpm exec wrangler d1 execute login-suxin --local \
  --command "update user set role='admin' where email='you@example.com'"
```

远程数据库把 `--local` 换成 `--remote`，改完刷新页面（必要时重新登录）即可生效。

### 审核退款

管理员登录后打开 **https://account.ljhsu.xin/admin/refunds**（也可从 `/account` → 「充值积分」→ `/credits` → 「申请退款」旁边的入口进入）：

- 列表按状态筛选、分页，可展开每个申请的订单级明细（订单号、渠道单号、失败原因）；
- 「通过并退款」会弹出金额确认，提交后按审核时余额重算最终金额，12 个月内的订单自动原路退款，超过 12 个月转人工；
- 部分失败可对同一申请重试失败项，已退款/转人工的不会重复处理；
- 页面顶部显示最近一次对账结果，可点「立即对账」手动跑一次（每天 11:23 也会自动跑）。

### 创建 OAuth 客户端

```bash
AUTH_URL=http://localhost:5173 \
ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD=your-password \
CLIENT_NAME=EchoMind \
CLIENT_REDIRECT_URIS=https://echomind.ljhsu.xin/auth/callback \
pnpm create-client
```

可选变量：

| 变量 | 说明 |
| --- | --- |
| `CLIENT_POST_LOGOUT_REDIRECT_URIS` | 允许的登出后跳转地址，逗号分隔 |
| `CLIENT_BACKCHANNEL_LOGOUT_URI` | OIDC Back-channel Logout 回调 |
| `SKIP_CONSENT=false` | 保留首次授权确认页（默认跳过，实现静默 SSO） |

输出里的 `client_secret` 只显示一次，请立刻存进应用端的 secrets。

## 部署到 Cloudflare

```bash
# 1. 创建 D1，把输出的 database_id 填进 wrangler.jsonc
pnpm exec wrangler d1 create login-suxin

# 2. 执行远程迁移（0000 Better Auth + 0001 积分/退款）
pnpm db:migrate:remote

# 3. 只设置真正的密钥（其余非敏感配置在 wrangler.jsonc 的 vars 里）
pnpm exec wrangler secret put BETTER_AUTH_SECRET      # openssl rand -base64 32
pnpm exec wrangler secret put APP_API_KEYS           # {"echomind":"<app-key>"}
pnpm exec wrangler secret put CREDITS_ADMIN_TOKEN    # 脚本导入/审核用
pnpm exec wrangler secret put ECHOMIND_PAY_ADMIN_TOKEN # EchoMind 的 PAY_ADMIN_TOKEN
# 可选：GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET

# 4. 构建并部署（wrangler.jsonc 已声明 account.ljhsu.xin 与 login.ljhsu.xin 自定义域名）
pnpm run deploy
```

部署前需要在 Cloudflare 为 `account.ljhsu.xin` 添加自定义域名/DNS，并保留 `login.ljhsu.xin` 路由（Worker 会 308 到 account）。首次部署会创建 `AccountDO` 的 Durable Object 迁移；`ECHOMIND_REFUND_URL` 默认指向 `https://echomind.ljhsu.xin/api/pay/admin/refund`。

OIDC issuer 会从 `https://login.ljhsu.xin/api/auth` 变为 `https://account.ljhsu.xin/api/auth`。EchoMind 需要更新 `OIDC_ISSUER` secret；其他接入应用也要同步 issuer、发现文档和回调白名单。旧 `login` 会话在 host-only Cookie 下不会带到 account，用户需要重新登录。

> 注意用 `pnpm run deploy`：`pnpm deploy` 是 pnpm 自己的 workspace 命令，会直接报错。

部署后检查：

```bash
curl -s https://account.ljhsu.xin/api/health
curl -s https://account.ljhsu.xin/api/auth/ok
curl -s https://account.ljhsu.xin/api/auth/.well-known/openid-configuration | head -c 400
```

`wrangler.jsonc` 的 `vars` 已包含生产值：`BETTER_AUTH_URL=https://account.ljhsu.xin`、`TRUSTED_ORIGINS=https://account.ljhsu.xin`、`REQUIRE_EMAIL_VERIFICATION=false`、`EMAIL_FROM`。需要额外的浏览器来源时改 `TRUSTED_ORIGINS`。

> `REQUIRE_EMAIL_VERIFICATION` 已在生产环境开启（`"true"`）：新注册用户必须点邮件里的链接验证后才能登录。开启前请确认 Email Sending 能正常投递，并把已有账号的 `email_verified` 置为 1，否则老用户会被挡在登录之外。

### 邮件发送

验证邮件和找回密码邮件走 Cloudflare Email Sending，不需要第三方 API Key：

```jsonc
"send_email": [
  { "name": "EMAIL", "allowed_sender_addresses": ["login@mail.ljhsu.xin"] }
]
```

- 发件域名必须先在 **Compute → Email Service → Email Sending** 里启用（当前为 `mail.ljhsu.xin`，`wrangler email sending list` 可查）。
- 发件地址由 `vars.EMAIL_FROM` 决定，必须属于已启用域名且在上面的 `allowed_sender_addresses` 里。
- 本地 `wrangler dev` 会模拟发送：不发真实邮件，内容写入控制台和临时文件；线上才是真实投递。
- 查看额度与投递结果：仪表盘 Email Sending 的 Activity / Metrics。

### 自定义邮件模板

模板在 `src/emailTemplate.ts`（`renderVerificationEmail` / `renderPasswordResetEmail`，600px 白底卡片，纯 HTML + 纯文本，不依赖 Worker），改完用：

```bash
pnpm preview:email
# 生成 .wrangler/email-preview/verify.html 与 reset-password.html
```

在浏览器里打开预览文件即可，不需要发真实邮件。改完 `pnpm run deploy` 生效；标题和正文文案在 `src/auth.ts` 的 `sendResetPassword` / `sendVerificationEmail` 调用处。发件人由 `vars.EMAIL_FROM` 决定，且必须出现在 `send_email` 的 `allowed_sender_addresses` 里。

### GitHub / Google 登录

- GitHub OAuth App 回调地址：`https://account.ljhsu.xin/api/auth/callback/github`
- Google OAuth Client 回调地址：`https://account.ljhsu.xin/api/auth/callback/google`

填好密钥并部署后，登录页会自动显示对应按钮；两个都没配时不显示社交登录区域。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `BETTER_AUTH_URL` | 是 | 服务自身的对外地址，决定 cookie、issuer 和回调 |
| `BETTER_AUTH_SECRET` | 是 | 会话与令牌签名密钥，`openssl rand -base64 32` |
| `TRUSTED_ORIGINS` | 是 | 逗号分隔的可信来源 |
| `REQUIRE_EMAIL_VERIFICATION` | 否 | `true` 时注册后必须验证邮箱 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 否 | 留空则不启用 GitHub 登录 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 否 | 留空则不启用 Google 登录 |
| `EMAIL_FROM` | 否 | 发件人，默认 `Suxin Account <login@mail.ljhsu.xin>` |
| `APP_API_KEYS` | 否 | JSON `{"echomind":"<app-key>"}`，应用服务端扣减/入账/余额查询凭证；未配置时应用接口 401 |
| `CREDITS_ADMIN_TOKEN` | 否 | 脚本导入、审核、平台原因退款令牌；也可用 `admin` 角色会话 |
| `ECHOMIND_REFUND_URL` | 否 | EchoMind 支付宝原路退款接口，默认生产地址 |
| `ECHOMIND_PAY_ADMIN_TOKEN` | 否 | 与 EchoMind `PAY_ADMIN_TOKEN` 一致，用于调用原路退款 |

## 本地数据

- D1 状态在 `.wrangler/state/`，删掉它即可清空本地账号；也可以 `rm -rf .wrangler` 后重新迁移。
- `.dev.vars`、`.wrangler/`、`dist/` 都不进 Git。

## 安全说明

- 密码使用 Better Auth 默认的 scrypt 哈希，明文永不落库。
- 会话 Cookie 为 host-only + `HttpOnly` + `SameSite=Lax`，生产环境 `Secure`；父域其他子域读不到。
- OIDC 强制 Authorization Code + PKCE（S256），客户端密钥只用于服务端换 token。
- OAuth 客户端只能由管理员创建，普通用户没有 `clientPrivileges`。
- 用户信息只返回 `sub`、`name`、`email`、`email_verified` 等基础字段，不含密码与业务数据。
- 登出一键完成：Worker 在处理 `/api/auth/oauth2/end-session` 时直接调用 Better Auth 的 `signOut` 结束当前会话并清 Cookie，再 302 回客户端登记过的 `post_logout_redirect_uri`；不再显示 Better Auth 的二次确认页（避免确认 Cookie 过期或重复提交时报 “The logout confirmation is invalid or expired”）。未登记的跳转地址退回 `/account`，防止开放重定向。

## 已知限制

- 尚未接入 Turnstile、登录限流、Passkey / 2FA。
- Cloudflare Email Sending 仍是 open beta，日发送额度随账号信誉调整；高频发送前先看仪表盘额度。
- 目前只有 `account.ljhsu.xin` 一个环境（`login` 仅 308 兼容），没有独立 staging 域名。
- 各应用自行保存会话，登出应用不会自动踢掉 IdP 登录态（可用 OIDC `end_session_endpoint` 实现）。
- 退款：超过 12 个月的支付宝订单无法自动原路退回，审核后标记为人工，由客服邮箱跟进；当前付费订单通过 EchoMind 的支付宝商户退款接口退回，账号中心后续可换成自己的支付适配器。
- 当前不存在赠送积分；如果以后加入赠送，需要重新定义可退积分与消耗顺序。
- 退款按**审核时**计算 12 个月与最终金额；申请页的金额是预估值，审核期间新计费会从最终退款中扣减。
- 处理中的退款申请超过 14 天未审核会自动失效（用户可重新提交），避免一笔无人审核的申请把账号永久锁住。
- 部分订单退款失败时申请标记为 `failed`，可对同一申请重试：已退款/转人工的订单会跳过，只重试失败项。

## 已接入应用

| 应用 | 回调地址 | 状态 |
| --- | --- | --- |
| EchoMind | `https://echomind.ljhsu.xin/auth/callback` | 已接入，开始练习前必须登录（未配置 OIDC 时退回本地练习）；积分走账号中心 |

## 接入文档

- [docs/client-integration.md](docs/client-integration.md)：应用侧 OIDC 与积分扣减接入步骤
- 端点发现：`https://account.ljhsu.xin/api/auth/.well-known/openid-configuration`

## 更新日志

见 [/changelog](https://account.ljhsu.xin/changelog)。
