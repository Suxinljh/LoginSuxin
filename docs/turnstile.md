# Turnstile 接入与开关流程

Turnstile 是 Cloudflare 的人机验证，用来挡撞库、批量注册和刷找回密码邮件。代码已经接好，**默认关闭**：只有 `TURNSTILE_SITE_KEY`（vars）和 `TURNSTILE_SECRET_KEY`（secret）同时存在才启用。

- 保护范围：`/api/auth/sign-in/email`、`/api/auth/sign-in/social`（GitHub/Google）、`/api/auth/sign-up/email`、`/api/auth/forget-password`。
- **不**保护：`send-verification-email`（在 `/account` 页没有 widget，那条只靠按 IP 限流）、OAuth `token`/`userinfo`（服务端调用）、第三方回调 `/api/auth/callback/*`（用户已在提供商那边完成身份验证）。
- 前端行为：widget 平时**不可见**（`appearance: 'interaction-only'` + `execution: 'execute'`），只有用户点“登录 / 创建账号 / 发送重置邮件 / GitHub / Google”时才跑挑战；需要点击验证时才会就地展开，不需要就自动通过。
- 不重复挑战：挑战在跑时再点按钮只会等同一次（不会各起一个）；token 拿到但还没被用掉时会缓存复用，所以用户慢慢点完验证也不会被要求再验证一遍；连点两次只会发一次请求。
- 为什么不在“密码验证完”之后再验证：Turnstile 必须在校验密码之前完成，否则机器人可以先免费试一次密码（还能借此枚举账号），再多一步“半登录”状态反而更复杂。放在提交时校验，用户看到的仍然是“平时没有 widget”。
- 校验顺序：按 IP 限流 → Turnstile 校验 → 交给 Better Auth。所以被 Turnstile 拒掉的请求不会消耗密码尝试额度，也不会写登录失败。
- 容错：`siteverify` 自身超时/网络错误时**放行并打日志**（避免 Cloudflare 故障导致整站无法登录），此时仍有登录限流兜底；只有 `success:false` 才拒绝。

## 为什么顺序不能反

| 已配置 | 前端 widget | 服务端校验 | 结果 |
| --- | --- | --- | --- |
| 都没有 | 不渲染 | 不校验 | 现状，登录正常 |
| 只有 site key | 不渲染 | 不校验 | 等于没开 |
| 只有 secret | 不渲染 | **要求 token** | 登录全部失败 ← 危险 |
| 两个都有 | 渲染 | 校验 | 启用 |

代码里 `turnstileEnabled` 要求两个 key 同时存在，所以顺序是 **先 site key，再 secret**，任何一步中间状态都是“未启用”。

## 第一步：建 widget（Cloudflare 控制台）

1. Cloudflare Dashboard → **Turnstile** → **Add widget**。
2. Widget name：`suxin-account`。
3. Hostnames 填两个域名（一行一个）：
   - `account.ljhsu.xin`
   - `staging.ljhsu.xin`
4. Widget Mode 选 **Managed**（推荐：多数用户无感，可疑流量才出挑战）；想要完全不可见可选 Non-interactive，但拦截效果弱一些。
5. Pre-clearance 保持关闭。
6. 创建后记下 **Site Key**（公开，形如 `0x4AAAAAAA…`）和 **Secret Key**（只显示一次）。

## 第二步：先在 staging 打开

```bash
cd /Users/suxin/Suxin/code/app/LoginSuxin

# 1) site key 是公开值，写进 wrangler.staging.jsonc 的 vars 里（推荐，能进 Git 且每次部署都带上）
#    编辑文件： "vars": { ..., "TURNSTILE_SITE_KEY": "0x4AAAAAAA..." }

# 2) secret 用 secret put，交互式粘贴（不回显、不进历史）
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.staging.jsonc

# 3) 让新的 vars 生效
pnpm deploy:staging

# 4) 一键校验
node scripts/check-turnstile.mjs https://staging.ljhsu.xin
```

（不想改配置文件也可以 `pnpm exec wrangler deploy -c wrangler.staging.jsonc --var TURNSTILE_SITE_KEY:0x4AAAAAAA...`，但**下次不带这个参数部署就会丢**，所以只适合临时试。）

校验脚本会打印 `/api/providers`、无 token 提交、伪造 token 提交三次结果。staging 期望：

```
providers: {"github":true,"google":true,"turnstile":"0x4AAAAAAA..."}
无 token 提交: 400 {"error":"请先完成人机验证"}
伪造 token 提交: 400 {"error":"人机验证未通过，请重试"}
结论：配置符合预期
```

再用浏览器过一遍（staging）：

1. `https://staging.ljhsu.xin/sign-in` 打开时**看不到** widget（这是正常的：`execution: 'execute'`）；
2. 点“登录” → 按钮转圈期间跑挑战（需要交互时才就地展开勾选），验证通过后才发出登录请求；
   密码错误会提示并重新挂一个 widget，下一次提交拿新 token；
3. 点 GitHub / Google → 同样先跑挑战再跳转授权页（这两个按钮受 `/api/auth/sign-in/social` 保护）；
4. `sign-up`、`forgot-password` 同样检查；
5. 手机/无痕窗口各试一次（窄屏下挑战框应自适应）。

想先看 UI 又不想建正式 widget 时，可以用官方测试 key（只用于本地/staging 联调）：

| 用途 | site key | secret |
| --- | --- | --- |
| 永远通过 | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| 永远失败 | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| 强制交互 | `3x00000000000000000000FF` | `3x0000000000000000000000000000000AA` |

注意 secret 是 **35 个字符**（`1x` + 30 个 0 + `AA`）。写成 32 位的相近串会被
`siteverify` 判为 `invalid-input-secret`，表现就是「配了 secret 但所有 token 都校验失败」。

**staging 现在已切到真实 widget**（`suxin-account`，site key `0x4AAAAAAFpgENXLi7yiW6ti`，Managed 模式，域名白名单含 `account.ljhsu.xin` 与 `staging.ljhsu.xin`）：`site key` 与 `secret` 都以 `wrangler secret put` 写入 staging Worker，不写进配置文件。换 key（或换成测试 key）时用：

```bash
printf '%s' '<真实 site key>' | pnpm exec wrangler secret put TURNSTILE_SITE_KEY -c wrangler.staging.jsonc
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.staging.jsonc
node scripts/check-turnstile.mjs https://staging.ljhsu.xin   # 期望：伪造 token 被拒
```

注意：真实 widget 下 `siteverify` 会拿 token 校验，用 `always-pass` 测试 secret 时伪造 token 会被放行
（走到 Better Auth 返回 401），所以校验脚本会提示“用的是测试 secret”；只有换成真实 secret 才会看到
`400 人机验证未通过`。

## 第三步：确认没问题后再开生产

> 2026-10-29：生产已按此步骤启用（site key 在 `wrangler.jsonc`，secret 在 Worker），
> `node scripts/check-turnstile.mjs https://account.ljhsu.xin` 通过。回滚删 secret 即可。

```bash
# 1) wrangler.jsonc 的 vars 加 TURNSTILE_SITE_KEY
# 2) pnpm exec wrangler secret put TURNSTILE_SECRET_KEY     # 不带 -c 才是生产
# 3) pnpm exec wrangler deploy
# 4) node scripts/check-turnstile.mjs https://account.ljhsu.xin
```

生产开启后额外确认：

- 管理员/普通账号各登录一次；
- 用 `pnpm tail:staging` 或生产 `wrangler tail login-suxin` 看有没有 `[turnstile] 校验未通过` 的异常量（正常应该只有机器人）；
- `/credits`、`/refunds`、OAuth 回调登录不受影响（它们不走这些受保护接口）。

## 回滚

不需要改代码、不需要改前端：

```bash
# 只关 staging
pnpm exec wrangler secret delete TURNSTILE_SECRET_KEY -c wrangler.staging.jsonc
# 关生产
pnpm exec wrangler secret delete TURNSTILE_SECRET_KEY
```

删掉 secret 后 `turnstileEnabled` 即为 false：widget 不再下发、服务端不再校验，登录立刻回到原状（site key 留着也没影响）。

只删 site key（从 vars 移除再 deploy）效果相同。

## 排查

| 现象 | 原因 |
| --- | --- |
| 页面看不到 widget | 正常：widget 是 `execution: 'execute'`，只在点提交/社交登录时跑。若 `/api/providers` 的 `turnstile` 是 null，才是两个 key 没配齐或改了 vars 没重新 deploy |
| 点登录后提示「人机验证未完成…」 | 挑战没拿到 token：`challenges.cloudflare.com` 被扩展/网络拦截，或 widget 域名单里没有当前域名（面板会显示 `110200`） |
| 一提交就 400「请先完成人机验证」 | token 没带上：检查是否走了受保护接口之一（`sign-in/email`、`sign-in/social`、`sign-up/email`、`forget-password`） |
| 社交登录跳过了验证 | 用旧的前端缓存（带 hash 的文件会随部署更新）；确认 `/api/auth/sign-in/social` 已在保护列表里 |
| 要验证两次才能登录 | 旧版本问题（12 秒超时后重挂 widget 并重新挑战），已改为缓存复用与单挑战；刷新页面拿新前端即可 |
| 点登录后提示「人机验证未完成…」 | 45 秒内没拿到 token：先完成上方挑战再点一次即可（不会重新挑战）；一直失败见上一条域名/拦截排查 |
| 一直 400「人机验证未通过」 | secret 与 site key 不是同一个 widget；或 widget 域名单里没有当前域名 |
| 日志里大量 `[turnstile] 校验服务不可用` | `siteverify` 请求异常（网络/超时），此时按放行处理，属预期降级 |
| 老用户被频繁挑战 | widget 模式太严格（改 Managed）或 IP 信誉差；Turnstile 面板可看 challenge 比例 |
