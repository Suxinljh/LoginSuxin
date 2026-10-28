# 应用接入 LoginSuxin（OIDC）

各应用是 LoginSuxin 的 OIDC 客户端：身份由 `account.ljhsu.xin` 负责，应用只保存用户的 `sub` 和业务数据。应用可以继续使用自己的数据库、自己的会话 Cookie，不共享父域 Cookie。

## 基本参数

| 项目 | 值 |
| --- | --- |
| Issuer | `https://account.ljhsu.xin/api/auth` |
| 发现文档 | `https://account.ljhsu.xin/api/auth/.well-known/openid-configuration` |
| 授权端点 | `https://account.ljhsu.xin/api/auth/oauth2/authorize` |
| Token 端点 | `https://account.ljhsu.xin/api/auth/oauth2/token` |
| UserInfo | `https://account.ljhsu.xin/api/auth/oauth2/userinfo` |
| JWKS | `https://account.ljhsu.xin/api/auth/jwks` |
| 登出端点 | `https://account.ljhsu.xin/api/auth/oauth2/end-session` |

流程：**Authorization Code + PKCE（S256）**，客户端认证方式 `client_secret_basic`（密钥只放在应用服务端）。

## 1. 注册客户端

在 LoginSuxin 仓库执行（需要管理员账号）：

```bash
AUTH_URL=https://account.ljhsu.xin \
ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD=your-password \
CLIENT_NAME=EchoMind \
CLIENT_REDIRECT_URIS=https://echomind.ljhsu.xin/auth/callback \
CLIENT_POST_LOGOUT_REDIRECT_URIS=https://echomind.ljhsu.xin/ \
pnpm create-client
```

拿到 `client_id` / `client_secret` 后写进应用的 secrets：

```bash
pnpm exec wrangler secret put OIDC_CLIENT_ID
pnpm exec wrangler secret put OIDC_CLIENT_SECRET
pnpm exec wrangler secret put OIDC_ISSUER          # https://account.ljhsu.xin/api/auth
```

回调地址必须与注册时完全一致（含协议、端口、路径，不能带 query）。

## 2. 发起登录

应用生成 `state` 和 PKCE `code_verifier`，把 verifier 放进短期 Cookie（`HttpOnly`、`SameSite=Lax`、10 分钟），然后让浏览器整页跳转到授权端点：

```ts
const ISSUER = 'https://account.ljhsu.xin/api/auth'

function randomString(bytes = 32) {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buffer)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function login(request: Request) {
  const origin = new URL(request.url).origin
  const state = randomString()
  const verifier = randomString(48)
  const challenge = await sha256Base64Url(verifier)

  const url = new URL(`${ISSUER}/oauth2/authorize`)
  url.search = new URLSearchParams({
    client_id: process.env.OIDC_CLIENT_ID!,
    redirect_uri: `${origin}/auth/callback`,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()

  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      'set-cookie': [
        `oidc_state=${state}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        `oidc_verifier=${verifier}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      ].join(', '),
    },
  })
}
```

登录页由 LoginSuxin 提供，应用不需要实现密码表单。已登录 IdP 的用户会被直接放行（静默 SSO）；未登录时跳转 `https://account.ljhsu.xin/sign-in`，登录完成后自动回到授权流程。

## 3. 处理回调

LoginSuxin 会重定向到 `redirect_uri?code=...&state=...&iss=...`。应用需要：

1. 校验 `state` 与 Cookie 一致；
2. 用 code + verifier 在**服务端**换 token；
3. 校验 `id_token` 的签名（JWKS）、`iss`、`aud`、`exp`；
4. 用 `sub` 查找或创建本应用的用户，写入本应用自己的会话。

```ts
export async function callback(request: Request) {
  const url = new URL(request.url)
  const cookie = request.headers.get('cookie') ?? ''
  const expectedState = /(?:^|;\s*)oidc_state=([^;]+)/.exec(cookie)?.[1]
  const verifier = /(?:^|;\s*)oidc_verifier=([^;]+)/.exec(cookie)?.[1]
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')

  if (url.searchParams.get('error')) {
    return new Response(`登录失败：${url.searchParams.get('error_description') ?? url.searchParams.get('error')}`, { status: 400 })
  }
  if (!code || !state || state !== expectedState || !verifier) {
    return new Response('授权回调无效', { status: 400 })
  }

  const basic = btoa(`${process.env.OIDC_CLIENT_ID}:${process.env.OIDC_CLIENT_SECRET}`)
  const response = await fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${url.origin}/auth/callback`,
      code_verifier: verifier,
    }),
  })
  if (!response.ok) return new Response('换取令牌失败', { status: 502 })

  const tokens = await response.json<{ id_token: string; access_token: string }>()
  // 用 jose 校验签名与 claim：
  // const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(`${ISSUER}/jwks`)), {
  //   issuer: ISSUER,
  //   audience: process.env.OIDC_CLIENT_ID!,
  // })
  // 然后以 payload.sub 作为本应用用户的唯一标识。
  ...
}
```

`id_token` 默认只包含 `sub`、`iss`、`aud`、`exp`、`iat`、`sid` 等标准声明。需要姓名和邮箱时，用 `Authorization: Bearer <access_token>` 调 `${ISSUER}/oauth2/userinfo`：

```json
{ "sub": "YC0c...", "name": "Demo", "email": "demo@example.com", "email_verified": false }
```

> 以 `sub` 作为主键，不要用邮箱关联账号：用户可能换邮箱，`sub` 对同一账号永远不变。

## 4. 登出

只清应用自己的会话不会影响 IdP 登录态。若希望"退出应用时也退出统一账号"，直接跳转（GET，一键完成，不再显示确认页）：

```
https://account.ljhsu.xin/api/auth/oauth2/end-session
  ?client_id=<应用 client_id>
  &post_logout_redirect_uri=https://echomind.ljhsu.xin/
  &state=<可选>
```

账号中心会结束当前浏览器会话、清除 Cookie，然后 302 回登记的 `post_logout_redirect_uri`；未登记的地址会退回 `/account`。`post_logout_redirect_uri` 必须在注册客户端时登记（`CLIENT_POST_LOGOUT_REDIRECT_URIS`）。`id_token_hint` 可选，当前实现不依赖它。

## 5. 静默 SSO 与 `prompt`

- 默认（`skip_consent` 客户端）：已登录 IdP 的用户访问 `/oauth2/authorize` 会直接带 code 跳回应用，不显示任何页面。
- 需要强制重新登录时加 `prompt=login`；需要"无交互检查"时加 `prompt=none`，未登录会以 `error=login_required` 重定向回来，适合在应用里做"用统一账号登录"的静默探测。
- 首次授权若未跳过 consent，用户会看到一次性的授权确认页，之后同 scope 不再询问。

## 6. 常见错误

| 现象 | 原因 |
| --- | --- |
| `Invalid origin` | 请求的 `Origin` 不在 IdP 的 `TRUSTED_ORIGINS`；本地开发时通常是漏了 `http://account.ljhsu.xin` |
| `invalid_client` | `client_id` / `client_secret` 不匹配，或把密钥放在了表单而不是 Basic 认证里（以 `token_endpoint_auth_method` 为准） |
| `invalid_grant` | code 已用过 / 过期，或 `code_verifier` 与 `code_challenge` 不匹配，或 `redirect_uri` 与注册值不一致 |
| 回调 400 `unexpected "state"` | state Cookie 丢失（`Path`、`SameSite`、跨站跳转设置不对） |
| userinfo 401 | access token 缺失或过期，重新走授权流程 |

## 7. 账号积分（应用接入）

账号中心是积分的唯一事实来源；应用不保存余额，只通过服务端调用账号中心。

1. 在账号中心的 `APP_API_KEYS` 里登记 `appId` 和 key（key 只放应用服务端）。
2. 扣减（幂等）：

```http
POST https://account.ljhsu.xin/api/apps/<appId>/credits/consume
Authorization: Bearer <app-key>
Content-Type: application/json

{ "userId": "<OIDC sub>", "requestId": "<应用内幂等 ID>", "credits": 30 }
```

同一 `(appId, userId, requestId)` 只扣一次；余额不足返回 402。`userId` 使用 OIDC `sub`，不要用邮箱。

- `requestId` 由**应用服务端**生成，并带上用户维度（如 `${sub}:${本地 requestId}`）。不要把客户端传来的值直接透传，否则不同用户撞到同一 ID 时会互相顶掉（第二个人不扣费）。
- 数值字段必须是 JSON number 整数：`credits` 1～100000；字符串（如 `"30"`）、小数、越界都会返回 400，不会按默认值兜底。

3. 查询余额（只读，供应用展示，不能作为扣费依据）：

```http
GET https://account.ljhsu.xin/api/apps/<appId>/credits?userId=<OIDC sub>
Authorization: Bearer <app-key>
```

```json
{
  "userId": "<sub>",
  "appId": "echomind",
  "balance": 120,
  "usage": [
    { "id": "...", "appId": "echomind", "delta": -30, "reason": "consume", "ref": "...", "createdAt": 1790000000000 }
  ]
}
```

`usage` 是该账号在**本应用**的最近 20 条台账（不返回其他应用的记录）；未知用户返回 404。需要 token/模型等明细时，应用仍应使用自己的用量表。

4. 付费订单入账（幂等）：

```http
POST https://account.ljhsu.xin/api/apps/<appId>/credits/credit
Authorization: Bearer <app-key>
Content-Type: application/json

{ "userId": "<OIDC sub>", "orderId": "<原支付订单号>", "credits": 100, "amountCents": 100, "paidAt": 1790000000000 }
```

同一 `(appId, orderId)` 只入账一次；`paidAt` 是支付成功时间（毫秒）。管理员批量导入（`POST /api/admin/credits/import`）同样是只插入语义：重复订单不覆盖，若积分/剩余/金额/支付时间/归属账号与已有记录不一致，会在 `skipped` 里返回差异说明。

5. 用户页面：`https://account.ljhsu.xin/credits`（余额、充值入口、用量）、`/refunds`、`/terms/refund`。应用只链接，不代理退款申请。充值只能由持有支付商户号的接入应用发起，所以 `/credits` 的充值按钮跳转到应用的充值页（目前为 `https://echomind.ljhsu.xin/?recharge=<积分>`），金额由应用按 1 积分 = ¥0.01 重算。
6. 退款按**审核时**计算 12 个月与最终金额；一个账号同一时间一笔处理中退款（超过 14 天未审核自动失效，可重新提交）；超过 12 个月的支付宝订单转人工处理。
7. 管理员在 `https://account.ljhsu.xin/admin/refunds` 审核（需要 `user.role='admin'`）：可按状态筛选、分页、展开订单级明细，顶部显示每日对账结果（`reconcile_report`），并支持「立即对账」。
8. 审核状态：`pending` → `completed`（全部成功）/ `failed`（部分失败，可对同一申请重试失败项）/ `rejected`（拒绝或金额不足 0.01 元）/ `expired`（超时失效）；订单级明细在管理员界面可展开查看渠道单号与失败原因。

## 8. 给 EchoMind 的建议接法

EchoMind 目前是本地优先的练习工具。接入时建议：

- 录音、转写、报告仍在本机处理；开始练习前要求登录 Suxin 账号（EchoMind 已这样实现），练习历史写入应用自己的 D1 并同步到账号；
- 登录只上传语义稿与报告，不上传音频；
- 本应用只存 `sub`、昵称和同步状态，密码与邮箱验证都交给 `account.ljhsu.xin`；
- 积分由账号中心统一管理；平台模型调用通过 `/api/apps/echomind/credits/consume` 扣减，EchoMind 不保存钱包；
- 账号中心提供 `/credits`、`/refunds`、`/terms/refund`，EchoMind 只链接；
- EchoMind 的 OIDC issuer 改为 `https://account.ljhsu.xin/api/auth`，`OIDC_ISSUER` secret 同步更新；
- 在设置页提供"退出登录"，并说明退出只清除 EchoMind 的会话。
