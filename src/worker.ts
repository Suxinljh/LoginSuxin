import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { createAuth } from './auth'
import { REFUND_PENDING_TTL_MS, getBalance, getRefundEstimate } from './credits'
import { allowRequest, cleanupRateLimit } from './rateLimit'
import { TURNSTILE_PROTECTED_PATHS, turnstileEnabled, turnstileSiteKey, verifyTurnstile } from './turnstile'
import type { Env } from './env'

export { AccountDO } from './accountDO'

type SessionUser = { id: string; email?: string; name?: string; role?: string }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

function methodNotAllowed(): Response {
  return new Response('Method not allowed', { status: 405 })
}

function errorMessage(error: unknown): { status: number; message: string } {
  if (typeof error === 'object' && error !== null) {
    const statusCode = (error as { statusCode?: unknown }).statusCode
    const status = typeof statusCode === 'number' ? statusCode : 500
    const body = (error as { body?: { message?: unknown; error_description?: unknown } }).body
    if (typeof body?.message === 'string' && body.message) return { status, message: body.message }
    if (typeof body?.error_description === 'string' && body.error_description) return { status, message: body.error_description }
  }
  return { status: 500, message: error instanceof Error ? error.message : '请求失败，请稍后重试。' }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return !origin || origin === new URL(request.url).origin
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

/**
 * 凭据类接口限流（按 IP）。只列出需要防着抄的 POST 接口，
 * 不包含 `/api/auth/oauth2/token|userinfo|introspect`：那些是接入应用服务端的调用，
 * 来源 IP 集中在 Cloudflare 出口，按 IP 限流会误伤正常登录。
 */
const AUTH_RATE_LIMITS: { path: string; limit: number; windowMs: number }[] = [
  { path: '/api/auth/sign-in/email', limit: 15, windowMs: 10 * 60_000 },
  { path: '/api/auth/sign-up/email', limit: 10, windowMs: 10 * 60_000 },
  { path: '/api/auth/forget-password', limit: 5, windowMs: 10 * 60_000 },
  { path: '/api/auth/reset-password', limit: 5, windowMs: 10 * 60_000 },
  { path: '/api/auth/send-verification-email', limit: 5, windowMs: 10 * 60_000 },
  { path: '/api/auth/change-email', limit: 5, windowMs: 10 * 60_000 },
  { path: '/api/auth/delete-user', limit: 5, windowMs: 10 * 60_000 },
]

async function limitAuth(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const rule = AUTH_RATE_LIMITS.find(item => item.path === pathname)
  if (!rule) return null
  const client = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (await allowRequest(env, 'auth', `${rule.path}:${client}`, rule.limit, rule.windowMs)) return null
  return Response.json(
    { error: '尝试过于频繁，请稍后再试' },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '600' } },
  )
}

function appKey(env: Env, appId: string): string {
  try {
    const keys = JSON.parse(env.APP_API_KEYS || '{}') as Record<string, unknown>
    const value = keys[appId]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

function bearer(request: Request): string {
  const value = request.headers.get('authorization') || ''
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

function isAdmin(env: Env, request: Request, user: SessionUser | null): boolean {
  if (env.CREDITS_ADMIN_TOKEN && safeEqual(request.headers.get('x-credits-admin') || '', env.CREDITS_ADMIN_TOKEN)) return true
  return user?.role === 'admin'
}

async function requireUser(request: Request, env: Env): Promise<SessionUser | null> {
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  return (session?.user as SessionUser | undefined) ?? null
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function accountOp(env: Env, userId: string, body: Record<string, unknown>): Promise<Response> {
  const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(userId))
  return stub.fetch('https://account.internal/op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, userId }),
  })
}

async function handleConsentInfo(request: Request, env: Env): Promise<Response> {
  const auth = createAuth(env)
  const { secret } = await auth.$context
  const query = new URL(request.url).search.slice(1)
  if (!(await verifyOAuthQueryParams(query, secret))) {
    return json({ error: '授权请求已失效，请回到应用重试。' }, 400)
  }
  const params = new URLSearchParams(query)
  return json({
    client_id: params.get('client_id'),
    scope: params.get('scope'),
    claims: params.get('claims'),
  })
}

/**
 * 管理员创建 OAuth 客户端。Better Auth 的对应端点标记为 server-only，
 * 不会通过 /api/auth 暴露，所以在这里做会话和角色校验后转发。
 * 只有这条路径能设置 skip_consent（静默 SSO）和 enable_end_session。
 */
async function handleAdminCreateClient(request: Request, env: Env): Promise<Response> {
  const auth = createAuth(env)
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return json({ error: '请先登录管理员账号。' }, 401)
  if ((session.user as { role?: string }).role !== 'admin') {
    return json({ error: '只有管理员可以创建 OAuth 客户端。' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: '请求体必须是 JSON。' }, 400)
  }

  try {
    const data = await auth.api.adminCreateOAuthClient({
      body: body as NonNullable<Parameters<typeof auth.api.adminCreateOAuthClient>[0]>['body'],
      headers: request.headers,
    })
    return json(data, 201)
  } catch (error) {
    console.error('[admin] 创建 OAuth 客户端失败', error)
    const { status, message } = errorMessage(error)
    return json({ error: message || '创建 OAuth 客户端失败。' }, status)
  }
}

/** 把数据库里可能被多层 JSON 编码的 URI 列表还原成数组。 */
function parseUriList(raw: string | null): string[] {
  if (!raw) return []
  let value: unknown = raw
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 一键退出。
 *
 * 旧实现依赖 Better Auth 的登出确认页：页面停留超过 5 分钟、确认页被重复提交，
 * 或会话在另一个标签页刷新后，confirm 端点会报 “The logout confirmation is invalid or expired”。
 * 这里直接用 signOut 删除当前会话（并带回清 Cookie），再按登记过的
 * post_logout_redirect_uri 跳回应用，不再需要二次确认。
 */
async function handleEndSession(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id') || ''
  const requested = url.searchParams.get('post_logout_redirect_uri')
  const state = url.searchParams.get('state')

  // 只跳到该客户端登记过的地址，避免开放重定向；未知客户端退回账号首页。
  let target = '/account'
  if (clientId && requested) {
    try {
      const client = await env.DB.prepare('select post_logout_redirect_uris from oauth_client where client_id = ?')
        .bind(clientId)
        .first<{ post_logout_redirect_uris: string | null }>()
      if (parseUriList(client?.post_logout_redirect_uris ?? null).includes(requested)) target = requested
    } catch {
      // 查询失败时退回账号首页，不影响退出。
    }
  }
  if (state && target !== '/account') {
    try {
      const redirect = new URL(target)
      redirect.searchParams.set('state', state)
      target = redirect.toString()
    } catch {
      target = '/account'
    }
  }

  const headers = new Headers({ Location: target, 'Cache-Control': 'no-store' })
  try {
    // 内部 API 会走 origin 校验；GET 登出请求默认没有 Origin，这里补上服务自身的 origin。
    const signOutHeaders = new Headers(request.headers)
    if (!signOutHeaders.has('origin')) signOutHeaders.set('origin', new URL(env.BETTER_AUTH_URL).origin)
    const response = await createAuth(env).api.signOut({ headers: signOutHeaders, asResponse: true })
    for (const cookie of response.headers.getSetCookie()) headers.append('Set-Cookie', cookie)
  } catch (error) {
    // 即使删除会话失败也完成跳转，避免用户卡在登出页。
    console.error('[logout] signOut failed', error)
  }
  return new Response(null, { status: 302, headers })
}

async function handleAccountCredits(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!user) return json({ error: '请先登录' }, 401)
  const estimate = await getRefundEstimate(env, user.id)
  const usage = await env.DB.prepare(
    'select id, app_id, delta, reason, ref, created_at from credit_ledger where user_id = ? order by created_at desc limit 20',
  ).bind(user.id).all()
  return json({
    balance: estimate.balance,
    refundable_credits: estimate.refundable_credits,
    estimated_cents: estimate.estimated_cents,
    pending: estimate.pending,
    usage: usage.results ?? [],
  })
}

async function handleAccountUsage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!user) return json({ error: '请先登录' }, 401)
  const rows = await env.DB.prepare(
    'select id, app_id, delta, reason, ref, created_at from credit_ledger where user_id = ? order by created_at desc limit 50',
  ).bind(user.id).all()
  return json({ logs: rows.results ?? [] })
}

async function handleAccountEstimate(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!user) return json({ error: '请先登录' }, 401)
  return json(await getRefundEstimate(env, user.id))
}

async function handleAccountRefunds(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if (!user) return json({ error: '请先登录' }, 401)
  if (request.method === 'POST') {
    if (!sameOrigin(request)) return json({ error: '跨站请求被拒绝' }, 403)
    return accountOp(env, user.id, { op: 'apply' })
  }
  if (request.method !== 'GET') return methodNotAllowed()
  const rows = await env.DB.prepare(
    'select * from refund_request where user_id = ? order by created_at desc limit 50',
  ).bind(user.id).all()
  return json({ requests: rows.results ?? [] })
}

async function handleAdminRefunds(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  const url = new URL(request.url)
  const status = (url.searchParams.get('status') || '').trim()
  if (status && !/^[a-z]+$/.test(status)) return json({ error: '状态筛选无效' }, 400)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const where = status ? 'where r.status = ?' : ''
  const countStatement = env.DB.prepare(`select count(*) as total from refund_request r ${where}`)
  const totalRow = await (status ? countStatement.bind(status) : countStatement).first<{ total: number }>()
  const listStatement = env.DB.prepare(
    `select r.*, u.email as user_email, u.name as user_name
     from refund_request r left join user u on u.id = r.user_id
     ${where}
     order by case r.status when 'pending' then 0 when 'reviewing' then 1 else 2 end, r.created_at desc
     limit ? offset ?`,
  )
  const rows = await (status ? listStatement.bind(status, limit, offset) : listStatement.bind(limit, offset)).all()
  const counts = await env.DB.prepare('select status, count(*) as total from refund_request group by status').all<{ status: string; total: number }>()
  return json({
    requests: rows.results ?? [],
    total: totalRow?.total ?? 0,
    limit,
    offset,
    counts: Object.fromEntries((counts.results ?? []).map(row => [row.status, row.total])),
  })
}

async function handleAdminRefundDetail(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  const requestRow = await env.DB.prepare(
    `select r.*, u.email as user_email, u.name as user_name
     from refund_request r left join user u on u.id = r.user_id where r.id = ?`,
  ).bind(id).first()
  if (!requestRow) return json({ error: '退款申请不存在' }, 404)
  const items = await env.DB.prepare(
    `select i.*, l.order_id, l.app_id, l.paid_at, l.credits as lot_credits, l.amount_cents as lot_amount
     from refund_item i join credit_lot l on l.id = i.lot_id where i.refund_id = ? order by i.created_at asc`,
  ).bind(id).all()
  return json({ request: requestRow, items: items.results ?? [] })
}

type AuditEntry = { actor: string; action: string; target: string; detail?: unknown }

/** 管理员操作审计：写失败不影响主流程，但会打日志。 */
async function recordAudit(env: Env, entry: AuditEntry): Promise<void> {
  try {
    await env.DB.prepare('insert into admin_audit (id, actor, action, target, detail, created_at) values (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), entry.actor, entry.action, entry.target, JSON.stringify(entry.detail ?? null), Date.now())
      .run()
  } catch (error) {
    console.error('[audit] 写入失败', entry.action, error)
  }
}

async function handleAdminAudit(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 50))
  const rows = await env.DB.prepare('select * from admin_audit order by created_at desc limit ?').bind(limit).all<{
    id: string
    actor: string
    action: string
    target: string | null
    detail: string | null
    created_at: number
  }>()
  return json({
    entries: (rows.results ?? []).map(row => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      target: row.target,
      detail: (() => { try { return row.detail ? JSON.parse(row.detail) : null } catch { return null } })(),
      createdAt: row.created_at,
    })),
  })
}

/** 存量订单更正（导入后发现 remaining / 金额 / 支付时间不对）。 */
async function handleAdminCorrect(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  if (!sameOrigin(request)) return json({ error: '跨站请求被拒绝' }, 403)
  const body = await readJson(request)
  if (!body) return json({ error: '请求体必须是 JSON' }, 400)
  if (typeof body.userId !== 'string' || !body.userId) return json({ error: '缺少用户标识' }, 400)
  if (typeof body.appId !== 'string' || !body.appId) return json({ error: '缺少应用标识' }, 400)
  if (typeof body.orderId !== 'string' || !body.orderId) return json({ error: '缺少订单号' }, 400)
  const actor = user?.email || 'admin-token'
  const response = await accountOp(env, body.userId, {
    op: 'correctLot',
    appId: body.appId,
    orderId: body.orderId,
    remaining: body.remaining,
    amountCents: body.amountCents,
    paidAt: body.paidAt,
  })
  const data = await response.json().catch(() => null)
  if (response.ok) {
    await recordAudit(env, {
      actor,
      action: 'credits.correct',
      target: `${body.appId}:${body.orderId}`,
      detail: { userId: body.userId, changed: (data as { changed?: unknown } | null)?.changed },
    })
  }
  return json(data ?? { error: '更正失败' }, response.status)
}

async function handleAdminReview(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  if (!sameOrigin(request)) return json({ error: '跨站请求被拒绝' }, 403)
  const body = await readJson(request)
  if (!body) return json({ error: '请求体必须是 JSON' }, 400)
  const requestRow = await env.DB.prepare('select user_id from refund_request where id = ?').bind(id).first<{ user_id: string }>()
  if (!requestRow) return json({ error: '退款申请不存在' }, 404)
  const actor = user?.email || 'admin-token'
  const response = await accountOp(env, requestRow.user_id, {
    op: 'review',
    refundId: id,
    action: body.action,
    note: body.note,
    admin: actor,
  })
  const data = await response.json().catch(() => null) as { request?: { status?: string; final_cents?: number }; error?: string } | null
  if (response.ok) {
    await recordAudit(env, {
      actor,
      action: body.action === 'reject' ? 'refund.reject' : 'refund.approve',
      target: id,
      detail: { userId: requestRow.user_id, status: data?.request?.status, finalCents: data?.request?.final_cents, note: body.note },
    })
    return json(data, response.status)
  }
  return json(data ?? { error: '审核失败' }, response.status)
}

type ReconcileResult = {
  id: string
  createdAt: number
  trigger: string
  usersChecked: number
  expiredRefunds: number
  skippedItems: number
  mismatches: number
  balanceMismatches: { userId: string; balance: number; ledger: number }[]
  invalidLots: { userId: string; lotId: string; credits: number; remaining: number }[]
}

/**
 * 对账：每天定时跑一次，也可由管理员手动触发。
 * 1) 主动失效超过 14 天仍未审核的申请（不依赖用户重新提交）；
 * 2) 校验每个账号 `sum(credit_lot.remaining)` 与 `sum(credit_ledger.delta)` 是否相等，
 *    以及 `remaining` 是否越界（所有余额变动都会写台账，两个汇总理应一致）；
 * 3) 结果写 `reconcile_report`，不一致时打 error 日志供告警。
 */
async function runReconcile(env: Env, trigger: string): Promise<ReconcileResult> {
  const now = Date.now()
  const expired = await env.DB.prepare(
    "update refund_request set status = 'expired', completed_at = ?, note = ? where status in ('pending','reviewing') and created_at < ?",
  ).bind(now, '超过 14 天未审核，申请已自动失效；可重新提交。', now - REFUND_PENDING_TTL_MS).run()
  const skipped = await env.DB.prepare(
    "update refund_item set status = 'skipped', message = ? where status = 'pending' and refund_id in (select id from refund_request where status = 'expired')",
  ).bind('退款申请已失效').run()

  const users = await env.DB.prepare('select count(distinct user_id) as total from credit_lot').first<{ total: number }>()
  const balanceMismatches = await env.DB.prepare(
    `select l.user_id as userId, sum(l.remaining) as balance,
            coalesce((select sum(g.delta) from credit_ledger g where g.user_id = l.user_id), 0) as ledger
     from credit_lot l group by l.user_id
     having sum(l.remaining) <> coalesce((select sum(g.delta) from credit_ledger g where g.user_id = l.user_id), 0)
     limit 50`,
  ).all<{ userId: string; balance: number; ledger: number }>()
  const invalidLots = await env.DB.prepare(
    'select user_id as userId, id as lotId, credits, remaining from credit_lot where remaining < 0 or remaining > credits limit 50',
  ).all<{ userId: string; lotId: string; credits: number; remaining: number }>()

  const result: ReconcileResult = {
    id: crypto.randomUUID(),
    createdAt: now,
    trigger,
    usersChecked: users?.total ?? 0,
    expiredRefunds: expired.meta?.changes ?? 0,
    skippedItems: skipped.meta?.changes ?? 0,
    mismatches: (balanceMismatches.results ?? []).length + (invalidLots.results ?? []).length,
    balanceMismatches: balanceMismatches.results ?? [],
    invalidLots: invalidLots.results ?? [],
  }

  await env.DB.prepare(
    'insert into reconcile_report (id, created_at, users_checked, mismatches, expired_refunds, skipped_items, detail) values (?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    result.id,
    now,
    result.usersChecked,
    result.mismatches,
    result.expiredRefunds,
    result.skippedItems,
    JSON.stringify({ trigger, balanceMismatches: result.balanceMismatches, invalidLots: result.invalidLots }),
  ).run()
  // 只保留最近 30 次报告，避免表无限增长。
  await env.DB.prepare(
    'delete from reconcile_report where id not in (select id from reconcile_report order by created_at desc limit 30)',
  ).run()

  if (result.mismatches > 0) console.error('[reconcile] 余额与台账不一致', JSON.stringify(result))
  else console.log('[reconcile] 对账通过', JSON.stringify({ usersChecked: result.usersChecked, expiredRefunds: result.expiredRefunds }))
  return result
}

async function handleAdminReconcile(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  if (request.method === 'POST') {
    if (!sameOrigin(request)) return json({ error: '跨站请求被拒绝' }, 403)
    const result = await runReconcile(env, 'manual')
    await recordAudit(env, {
      actor: user?.email || 'admin-token',
      action: 'reconcile.run',
      target: result.id,
      detail: { usersChecked: result.usersChecked, mismatches: result.mismatches, expiredRefunds: result.expiredRefunds },
    })
    return json(result)
  }
  if (request.method !== 'GET') return methodNotAllowed()
  const row = await env.DB.prepare('select * from reconcile_report order by created_at desc limit 1').first<{
    id: string
    created_at: number
    users_checked: number
    mismatches: number
    expired_refunds: number
    skipped_items: number
    detail: string | null
  }>()
  if (!row) return json({ report: null })
  let detail: unknown = null
  try { detail = row.detail ? JSON.parse(row.detail) : null } catch { detail = null }
  return json({
    report: {
      id: row.id,
      createdAt: row.created_at,
      usersChecked: row.users_checked,
      mismatches: row.mismatches,
      expiredRefunds: row.expired_refunds,
      skippedItems: row.skipped_items,
      detail,
    },
  })
}

async function handleAdminImport(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  const body = await readJson(request)
  if (!body) return json({ error: '请求体必须是 JSON' }, 400)
  const appId = typeof body.appId === 'string' ? body.appId : ''
  const lots = Array.isArray(body.lots) ? body.lots : []
  if (!appId || lots.length === 0 || lots.length > 2000) return json({ error: '导入参数无效' }, 400)

  const groups = new Map<string, unknown[]>()
  for (const raw of lots) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const userId = typeof item.userId === 'string' ? item.userId : ''
    if (!userId) continue
    const list = groups.get(userId) ?? []
    list.push(item)
    groups.set(userId, list)
  }

  // 单次 AccountDO 导入上限 500 条；这里分片，避免超过上限时整批被拒且调用方不知情。
  const chunkSize = 500
  let imported = 0
  let duplicates = 0
  const skipped: { userId: string; orderId: string; reason: string }[] = []
  const failed: { userId: string; error: string }[] = []
  /** 导入后每个账号的余额，供迁移脚本对账。 */
  const balances: Record<string, number> = {}
  for (const [userId, userLots] of groups) {
    for (let index = 0; index < userLots.length; index += chunkSize) {
      const response = await accountOp(env, userId, { op: 'import', appId, lots: userLots.slice(index, index + chunkSize) })
      const data = await response.json().catch(() => ({})) as {
        imported?: number
        duplicates?: number
        skipped?: { orderId?: string; reason?: string }[]
        balance?: number
        error?: string
      }
      if (!response.ok) {
        failed.push({ userId, error: data.error || `导入失败（HTTP ${response.status}）` })
        continue
      }
      imported += data.imported ?? 0
      duplicates += data.duplicates ?? 0
      if (typeof data.balance === 'number') balances[userId] = data.balance
      for (const item of data.skipped ?? []) {
        if (skipped.length >= 100) break
        skipped.push({ userId, orderId: item.orderId ?? '', reason: item.reason ?? '字段无效' })
      }
    }
  }
  await recordAudit(env, {
    actor: user?.email || 'admin-token',
    action: 'credits.import',
    target: appId,
    detail: { users: groups.size, imported, duplicates, skipped: skipped.length, failed: failed.length },
  })
  return json({ imported, duplicates, skipped, failed, users: groups.size, balances })
}

async function handleAdminPlatformRefund(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  if (!sameOrigin(request)) return json({ error: '跨站请求被拒绝' }, 403)
  const body = await readJson(request)
  if (!body || typeof body.userId !== 'string' || !body.userId) return json({ error: '缺少用户标识' }, 400)
  return accountOp(env, body.userId, {
    op: 'platformRefund',
    reason: body.reason,
    admin: user?.email || 'admin-token',
  })
}

async function handleAppCredits(request: Request, env: Env, appId: string, action: string): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const key = appKey(env, appId)
  if (!key || !safeEqual(bearer(request), key)) return json({ error: '应用凭证无效' }, 401)
  const body = await readJson(request)
  if (!body || typeof body.userId !== 'string' || !body.userId) return json({ error: '缺少用户标识' }, 400)
  if (action === 'consume') {
    return accountOp(env, body.userId, {
      op: 'consume',
      appId,
      requestId: body.requestId,
      credits: body.credits,
    })
  }
  return accountOp(env, body.userId, {
    op: 'credit',
    appId,
    orderId: body.orderId,
    credits: body.credits,
    amountCents: body.amountCents,
    paidAt: body.paidAt,
  })
}

/**
 * 应用只读余额：应用服务端用 app key 查询余额和本应用最近台账，供自己的界面展示。
 * 只返回本应用的台账，避免把其他应用的订单号/请求号泄露给接入方。
 */
async function handleAppCreditsRead(request: Request, env: Env, appId: string): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const key = appKey(env, appId)
  if (!key || !safeEqual(bearer(request), key)) return json({ error: '应用凭证无效' }, 401)
  const userId = (new URL(request.url).searchParams.get('userId') || '').trim()
  if (!userId || userId.length > 128) return json({ error: '缺少用户标识' }, 400)
  const user = await env.DB.prepare('select 1 as ok from user where id = ?').bind(userId).first<{ ok: number }>()
  if (!user) return json({ error: '用户不存在' }, 404)
  const rows = await env.DB.prepare(
    'select id, app_id, delta, reason, ref, created_at from credit_ledger where user_id = ? and app_id = ? order by created_at desc limit 20',
  ).bind(userId, appId).all<{ id: string; app_id: string | null; delta: number; reason: string; ref: string | null; created_at: number }>()
  return json({
    userId,
    appId,
    balance: await getBalance(env, userId),
    usage: (rows.results ?? []).map(row => ({
      id: row.id,
      appId: row.app_id,
      delta: row.delta,
      reason: row.reason,
      ref: row.ref,
      createdAt: row.created_at,
    })),
  })
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // 旧域名兼容：login.ljhsu.xin → account.ljhsu.xin（308 保留方法与请求体）。
    if (url.hostname === 'login.ljhsu.xin') {
      return Response.redirect(`https://account.ljhsu.xin${url.pathname}${url.search}`, 308)
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true })
    }

    if (url.pathname === '/api/providers') {
      return json({
        github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        // 前端据此渲染 Turnstile widget；未配置时为 null。
        turnstile: turnstileEnabled(env) ? turnstileSiteKey(env) : null,
      })
    }

    if (url.pathname === '/api/consent-info') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
      return handleConsentInfo(request, env)
    }

    if (url.pathname === '/api/admin/oauth-clients') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
      return handleAdminCreateClient(request, env)
    }

    if (url.pathname === '/api/account/credits') return handleAccountCredits(request, env)
    if (url.pathname === '/api/account/credits/usage') return handleAccountUsage(request, env)
    if (url.pathname === '/api/account/refunds/estimate') return handleAccountEstimate(request, env)
    if (url.pathname === '/api/account/refunds') return handleAccountRefunds(request, env)

    if (url.pathname === '/api/admin/refunds') return handleAdminRefunds(request, env)
    if (url.pathname === '/api/admin/reconcile') return handleAdminReconcile(request, env)
    if (url.pathname === '/api/admin/audit') return handleAdminAudit(request, env)
    if (url.pathname === '/api/admin/credits/correct') return handleAdminCorrect(request, env)
    if (url.pathname === '/api/admin/refunds/platform') return handleAdminPlatformRefund(request, env)
    if (url.pathname === '/api/admin/credits/import') return handleAdminImport(request, env)
    const reviewMatch = /^\/api\/admin\/refunds\/([^/]+)\/review$/.exec(url.pathname)
    if (reviewMatch) return handleAdminReview(request, env, decodeURIComponent(reviewMatch[1]))
    const detailMatch = /^\/api\/admin\/refunds\/([^/]+)$/.exec(url.pathname)
    if (detailMatch) return handleAdminRefundDetail(request, env, decodeURIComponent(detailMatch[1]))

    const appMatch = /^\/api\/apps\/([^/]+)\/credits\/(consume|credit)$/.exec(url.pathname)
    if (appMatch) return handleAppCredits(request, env, decodeURIComponent(appMatch[1]), appMatch[2])
    const appCreditsMatch = /^\/api\/apps\/([^/]+)\/credits$/.exec(url.pathname)
    if (appCreditsMatch) return handleAppCreditsRead(request, env, decodeURIComponent(appCreditsMatch[1]))

    if (url.pathname === '/api/auth/oauth2/end-session') {
      return handleEndSession(request, env)
    }

    if (url.pathname.startsWith('/api/auth/')) {
      // 凭据类接口按 IP 限流，避免在线猜密码/刷验证邮件；其余（OAuth token/userinfo 等）直通。
      if (request.method === 'POST') {
        const limited = await limitAuth(request, env, url.pathname)
        if (limited) return limited
        if (turnstileEnabled(env) && TURNSTILE_PROTECTED_PATHS.has(url.pathname)) {
          const token = request.headers.get('x-turnstile-token') || ''
          if (!token) return json({ error: '请先完成人机验证' }, 400)
          const client = request.headers.get('cf-connecting-ip') || undefined
          if (!(await verifyTurnstile(env, token, client))) return json({ error: '人机验证未通过，请重试' }, 400)
        }
      }
      // Better Auth 在 Workers 上需要按请求创建实例，不能放在模块顶层复用。
      return createAuth(env).handler(request)
    }

    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Not found', { status: 404 })
  },

  /** Cron（每天）：主动失效超时退款申请 + 余额/台账对账。 */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await runReconcile(env, 'cron')
    await cleanupRateLimit(env)
  },
} satisfies ExportedHandler<Env>
