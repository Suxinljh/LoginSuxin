import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { createAuth } from './auth'
import { parseUriList, renderLogoutPage, safeCancelUrl } from './logoutPage'
import type { Env } from './env'

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
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

/**
 * 登出确认页自带英文纯文本样式。这里保留 Set-Cookie（确认状态），
 * 只把 HTML 换成与登录页一致的品牌页面；提交仍走官方 confirm 端点。
 */
async function handleEndSession(request: Request, env: Env): Promise<Response> {
  const auth = createAuth(env)
  const response = await auth.handler(request)
  if (request.method !== 'GET' || response.status !== 200) return response
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response

  const html = await response.text()
  if (!html.includes('data-oidc-logout-confirmation')) {
    // 成功页或错误页保持原样；正文已读取，需要重新包装响应。
    return new Response(html, { status: response.status, headers: new Headers(response.headers) })
  }

  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id') || ''
  let appName = '应用'
  let cancelUrl = '/account'
  if (clientId) {
    try {
      const client = await env.DB.prepare('select name, post_logout_redirect_uris from oauth_client where client_id = ?')
        .bind(clientId)
        .first<{ name: string | null; post_logout_redirect_uris: string | null }>()
      if (client?.name) appName = client.name
      cancelUrl = safeCancelUrl(parseUriList(client?.post_logout_redirect_uris ?? null), url.searchParams.get('post_logout_redirect_uri'))
    } catch {
      // 查询失败时退回默认文案，不影响退出。
    }
  }

  const headers = new Headers(response.headers)
  headers.set('content-type', 'text/html; charset=utf-8')
  headers.set('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  headers.delete('content-length')
  return new Response(renderLogoutPage({ appName, cancelUrl }), { status: 200, headers })
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

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
