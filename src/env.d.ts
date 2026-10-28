export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  ACCOUNT: DurableObjectNamespace
  EMAIL?: SendEmail
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  TRUSTED_ORIGINS: string
  REQUIRE_EMAIL_VERIFICATION?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  EMAIL_FROM?: string
  /** Turnstile 公开 site key；与 secret 同时配置才会在登录/注册/找回密码启用。 */
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  /** JSON：{ "echomind": "<app-key>" }，应用服务端扣减/入账用。 */
  APP_API_KEYS?: string
  /** 脚本/管理员令牌，用于导入、审核、平台原因退款；也可用 admin 角色会话。 */
  CREDITS_ADMIN_TOKEN?: string
  /** 当前付费订单所属应用的原路退款接口（EchoMind 支付宝退款）。 */
  ECHOMIND_REFUND_URL?: string
  ECHOMIND_PAY_ADMIN_TOKEN?: string
}
