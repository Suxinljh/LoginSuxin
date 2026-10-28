import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { createAuth } from './auth'
import { getBalance, getRefundEstimate } from './credits'
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
  const rows = await env.DB.prepare(
    `select r.*, u.email as user_email, u.name as user_name
     from refund_request r left join user u on u.id = r.user_id
     order by case r.status when 'pending' then 0 when 'reviewing' then 1 else 2 end, r.created_at desc
     limit 100`,
  ).all()
  return json({ requests: rows.results ?? [] })
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

async function handleAdminReview(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const user = await requireUser(request, env)
  if (!isAdmin(env, request, user)) return json({ error: '无权限' }, 403)
  if (!sameOrigin(request)) return json({ error: '跨站请求被拒绝' }, 403)
  const body = await readJson(request)
  if (!body) return json({ error: '请求体必须是 JSON' }, 400)
  const requestRow = await env.DB.prepare('select user_id from refund_request where id = ?').bind(id).first<{ user_id: string }>()
  if (!requestRow) return json({ error: '退款申请不存在' }, 404)
  return accountOp(env, requestRow.user_id, {
    op: 'review',
    refundId: id,
    action: body.action,
    note: body.note,
    admin: user?.email || 'admin-token',
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
      // Better Auth 在 Workers 上需要按请求创建实例，不能放在模块顶层复用。
      return createAuth(env).handler(request)
    }

    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
