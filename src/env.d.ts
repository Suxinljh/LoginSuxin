export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  TRUSTED_ORIGINS: string
  REQUIRE_EMAIL_VERIFICATION?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
}
