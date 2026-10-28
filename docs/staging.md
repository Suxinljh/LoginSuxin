# Staging 环境

线上：**https://staging.ljhsu.xin**（Worker `login-suxin-staging`，独立 D1 `login-suxin-staging`）

用途：在不碰生产数据、不给真实用户发信的前提下，验证只能在真实域名/真实回调里测试的东西——D1 迁移、OAuth 回调与 Cookie 域、邮件模板、积分与退款流程、Turnstile 配置。本地 `wrangler dev --local` 仍然是主力，staging 只补“真实域名”这一段。

## 与生产的区别

| 项 | 生产 | staging |
| --- | --- | --- |
| 域名 | `account.ljhsu.xin`（`login` 仅 308） | `staging.ljhsu.xin` |
| Worker / D1 | `login-suxin` | `login-suxin-staging` |
| `BETTER_AUTH_SECRET` | 生产独立值 | 独立值（见 `.local-secrets.json`，不进 Git） |
| 邮箱验证 | `true` | `false`（可直接注册测试账号） |
| 原路退款 | 已配置 EchoMind 退款接口 | **故意不配置**：审核会停在“原路退款通道尚未配置”，不会真的退钱 |
| 数据 | 真实用户 | 一次性，可随时清空 |

## 命令

```bash
# 部署（先构建 dist，再用 staging 配置上传）
pnpm deploy:staging

# 应用迁移（只动 staging 数据库）
pnpm db:migrate:staging

# 看日志
pnpm tail:staging
```

密钥用 `wrangler secret put <NAME> -c wrangler.staging.jsonc` 写入（`BETTER_AUTH_SECRET`、`APP_API_KEYS`、`CREDITS_ADMIN_TOKEN`；按需再加第三方登录与 Turnstile）。

## 要让 staging 完整可用，还需要在控制台做的几件事

1. **OAuth 回调**：GitHub OAuth App 与 Google OAuth Client 各加一条
   `https://staging.ljhsu.xin/api/auth/callback/github` / `.../google`（可以复用生产的 client id/secret，
   再把它们作为 `wrangler secret put GITHUB_CLIENT_ID ... -c wrangler.staging.jsonc` 等写入；
   也可以为 staging 单独申请一套，更干净）。
2. **Turnstile**：在 Cloudflare Turnstile 里新建 widget，把 `staging.ljhsu.xin`（生产再加
   `account.ljhsu.xin`）加进允许的域名列表，然后：
   ```bash
   # site key 是公开值，放 vars 即可
   pnpm exec wrangler deploy -c wrangler.staging.jsonc --var TURNSTILE_SITE_KEY:<site-key>
   # secret 用 secret
   pnpm exec wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.staging.jsonc
   ```
3. **EchoMind staging（可选）**：另建一个 EchoMind Worker（例如 `staging-echomind.ljhsu.xin`），
   把 `OIDC_ISSUER` 指向 `https://staging.ljhsu.xin/api/auth`、`CREDITS_API_URL` 指向
   `https://staging.ljhsu.xin`，并在 staging 账号中心用 `scripts/create-client.mjs` 建一个 OAuth client。
   这样端到端的登录/计价都能在 staging 跑通。

## 验收顺序（每次改账号中心后）

1. `pnpm db:migrate:staging` 确认新迁移能在独立的库上跑通；
2. `pnpm deploy:staging`；
3. 冒烟：注册 → 会话 → `GET /api/account/credits`（余额 0）→ 用 staging 应用 key 入账 100 → 消费 30 →
   再消费同一 `requestId` 应返回 `duplicate` → `GET /api/apps/echomind/credits?userId=`
   余额 70 → `GET /api/admin/refunds` 需要管理员令牌（无令牌 403）；
4. 需要复现退款时，先给 staging 配上退款通道（或指向一个 mock），验证完再撤掉；
5. 清空 staging 数据：`wrangler d1 execute login-suxin-staging --remote -c wrangler.staging.jsonc --command "..."`
   （用户、`session`、`account`、积分、审计、限流表都可清）。
