import type { Env } from './env'

/**
 * D1 固定窗口限流（认证接口用）。
 *
 * 先读后写：超限时只读不写，避免被刷时把 D1 写入配额放大成每个请求一次写。
 * 计数按 (scope, bucket) 一行，窗口按 windowMs 对齐；过期窗口由每日任务顺带清理。
 */
export async function allowRequest(
  env: Env,
  scope: string,
  bucket: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs
  try {
    const current = await env.DB.prepare('select window_start, count from rate_limit where scope = ? and bucket = ?')
      .bind(scope, bucket)
      .first<{ window_start: number; count: number }>()
    const used = current && current.window_start === windowStart ? current.count : 0
    if (used >= limit) return false
    await env.DB.prepare(
      `insert into rate_limit (scope, bucket, window_start, count) values (?, ?, ?, ?)
       on conflict(scope, bucket) do update set count = excluded.count, window_start = excluded.window_start`,
    ).bind(scope, bucket, windowStart, used + 1).run()
    return true
  } catch (error) {
    // 计数表不可用时不要阻断登录，但要能在日志里看到。
    console.error('[rate-limit] 计数失败', scope, error)
    return true
  }
}

/** 清理一天前的窗口计数，避免表无限增长。 */
export async function cleanupRateLimit(env: Env, now = Date.now()): Promise<void> {
  try {
    await env.DB.prepare('delete from rate_limit where window_start < ?').bind(now - 24 * 60 * 60 * 1000).run()
  } catch (error) {
    console.error('[rate-limit] 清理失败', error)
  }
}
