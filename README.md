# LoginSuxin

Suxin 的统一账号与登录服务，部署在 **https://login.ljhsu.xin**。

所有子项目（EchoMind、WeChatHot 等）共用这一套账号：用户注册一次，之后通过 OIDC 授权登录各个应用。各应用保持独立部署、独立数据库，只保存用户的 `sub`（用户 ID）和自己的业务数据。

- 前端与服务端同源，运行在 Cloudflare Workers（Static Assets + D1）
- 认证由 [Better Auth](https://www.better-auth.com/) 实现，OIDC 由 `@better-auth/oauth-provider` 提供
- 支持邮箱 + 密码、GitHub / Google 第三方登录、邮箱验证与找回密码
- 登录态 Cookie 仅作用于 `login.ljhsu.xin`，不下发到父域

## 技术栈

| 层 | 选择 |
| --- | --- |
| 运行时 | Cloudflare Workers（`nodejs_compat`） |
| 数据库 | Cloudflare D1（经 Drizzle ORM 访问） |
| 认证 | Better Auth 1.7 + `@better-auth/oauth-provider` + `admin` / `jwt` 插件 |
| 前端 | React 19 + React Router 7 + Vite 6 + TypeScript 5 |
| 邮件 | Resend（未配置时把链接打印到 Worker 日志） |

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/auth.ts` | Better Auth 实例：D1、邮箱密码、社交登录、JWT/admin/OIDC 插件、邮件 |
| `src/auth.cli.ts` | 仅供 Better Auth CLI 生成数据库 schema 使用，不参与运行时 |
| `src/worker.ts` | Worker 入口：`/api/auth/*`、`/api/consent-info`、`/api/providers`、`/api/admin/oauth-clients`、静态资源 |
| `src/db/schema.ts` | 由 Better Auth CLI 生成的 Drizzle schema（物理表名 snake_case） |
| `src/client/*` | 登录、注册、找回密码、账户、授权确认、更新日志页面 |
| `scripts/create-client.mjs` | 以管理员身份创建 OAuth 客户端并输出 `client_id` / `client_secret` |
| `migrations/` | D1 SQL 迁移 |
| `docs/client-integration.md` | 给各应用看的 OIDC 接入说明 |

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
- `TRUSTED_ORIGINS` 里的 `http://login.ljhsu.xin` 是 wrangler 对 `routes` 自定义域名重写后的来源，本地也不要删，否则登录会返回 `Invalid origin`。

### 把账号设为管理员

只有管理员能创建 OAuth 客户端：

```bash
pnpm exec wrangler d1 execute login-suxin --local \
  --command "update user set role='admin' where email='you@example.com'"
```

远程数据库把 `--local` 换成 `--remote`。

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

# 2. 执行远程迁移
pnpm db:migrate:remote

# 3. 配置 secrets（每个都按提示粘贴）
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put BETTER_AUTH_URL          # https://login.ljhsu.xin
pnpm exec wrangler secret put TRUSTED_ORIGINS          # 见下方说明
pnpm exec wrangler secret put REQUIRE_EMAIL_VERIFICATION
# 可选：GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
# 可选：RESEND_API_KEY / EMAIL_FROM

# 4. 构建并部署（wrangler.jsonc 已声明 login.ljhsu.xin 自定义域名）
pnpm deploy
```

部署后检查：

```bash
curl -s https://login.ljhsu.xin/api/health
curl -s https://login.ljhsu.xin/api/auth/ok
curl -s https://login.ljhsu.xin/api/auth/.well-known/openid-configuration | head -c 400
```

生产环境 `TRUSTED_ORIGINS` 至少要包含 `https://login.ljhsu.xin`，以及需要在浏览器里直接调用认证接口的其他来源（通常不需要，各应用走服务端换 token）。

> `REQUIRE_EMAIL_VERIFICATION=true` 前请先配置 Resend，否则验证链接只会打印在 Worker 日志里，用户无法完成验证。

### GitHub / Google 登录

- GitHub OAuth App 回调地址：`https://login.ljhsu.xin/api/auth/callback/github`
- Google OAuth Client 回调地址：`https://login.ljhsu.xin/api/auth/callback/google`

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
| `RESEND_API_KEY` / `EMAIL_FROM` | 否 | 留空时邮件内容打印到 Worker 日志 |

## 本地数据

- D1 状态在 `.wrangler/state/`，删掉它即可清空本地账号；也可以 `rm -rf .wrangler` 后重新迁移。
- `.dev.vars`、`.wrangler/`、`dist/` 都不进 Git。

## 安全说明

- 密码使用 Better Auth 默认的 scrypt 哈希，明文永不落库。
- 会话 Cookie 为 host-only + `HttpOnly` + `SameSite=Lax`，生产环境 `Secure`；父域其他子域读不到。
- OIDC 强制 Authorization Code + PKCE（S256），客户端密钥只用于服务端换 token。
- OAuth 客户端只能由管理员创建，普通用户没有 `clientPrivileges`。
- 用户信息只返回 `sub`、`name`、`email`、`email_verified` 等基础字段，不含密码与业务数据。

## 已知限制

- 尚未接入 Turnstile、登录限流、Passkey / 2FA。
- 邮件依赖 Resend，未配置时验证与找回密码只能在本地日志里取链接。
- 目前只有 `login.ljhsu.xin` 一个环境，没有独立的 staging 域名。
- 各应用自行保存会话，登出应用不会自动踢掉 IdP 登录态（可用 OIDC `end_session_endpoint` 实现）。

## 接入文档

- [docs/client-integration.md](docs/client-integration.md)：应用侧 OIDC 接入步骤与示例代码
- 端点发现：`https://login.ljhsu.xin/api/auth/.well-known/openid-configuration`

## 更新日志

见 [/changelog](https://login.ljhsu.xin/changelog)。
