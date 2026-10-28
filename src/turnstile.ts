import type { Env } from './env'

/**
 * Cloudflare Turnstile 人机验证。
 *
 * 只在配置了 `TURNSTILE_SECRET_KEY` 时启用；没配置时完全不改变现有登录流程。
 * 校验通过与否只看 `siteverify` 的 `success`；校验服务本身不可用（超时/网络错误）
 * 时放行并打日志，避免整站登录被外部依赖拖死，此时仍有按 IP 的登录限流兜底。
 */
// 只保护密码/注册/忘记密码三个表单；`send-verification-email` 留在 /account 页，
// 没有 widget 时会被直接拒掉，所以它只靠按 IP 限流。
export const TURNSTILE_PROTECTED_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/forget-password',
])

export function turnstileEnabled(env: Env): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY)
}

/** 前端渲染 widget 用的公开 site key；没配置时前端不渲染。 */
export function turnstileSiteKey(env: Env): string | null {
  return env.TURNSTILE_SITE_KEY || null
}

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(env: Env, token: string, remoteIp?: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)
  try {
    const response = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5_000) })
    const data = await response.json().catch(() => ({})) as { success?: boolean; 'error-codes'?: string[] }
    if (!data.success) console.error('[turnstile] 校验未通过', data['error-codes'] ?? [])
    return Boolean(data.success)
  } catch (error) {
    console.error('[turnstile] 校验服务不可用，按放行处理', error)
    return true
  }
}
