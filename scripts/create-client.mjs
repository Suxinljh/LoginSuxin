#!/usr/bin/env node
/**
 * 为某个应用创建一个 OAuth 客户端。
 *
 * 用法：
 *   AUTH_URL=http://localhost:5173 \
 *   ADMIN_EMAIL=you@example.com \
 *   ADMIN_PASSWORD=your-password \
 *   CLIENT_NAME=EchoMind \
 *   CLIENT_REDIRECT_URIS=https://echomind.ljhsu.xin/auth/callback \
 *   pnpm create-client
 *
 * 创建成功后，把 client_id / client_secret 放进应用 Worker 的 secrets。
 * client_secret 只显示这一次，请立即保存。
 */

const AUTH_URL = (process.env.AUTH_URL || 'http://localhost:5173').replace(/\/$/, '')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const CLIENT_NAME = process.env.CLIENT_NAME || ''
const REDIRECT_URIS = (process.env.CLIENT_REDIRECT_URIS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const POST_LOGOUT_URIS = (process.env.CLIENT_POST_LOGOUT_REDIRECT_URIS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const BACKCHANNEL_LOGOUT_URI = (process.env.CLIENT_BACKCHANNEL_LOGOUT_URI || '').trim()
const SKIP_CONSENT = process.env.SKIP_CONSENT !== 'false'

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

if (!ADMIN_EMAIL) fail('缺少 ADMIN_EMAIL')
if (!ADMIN_PASSWORD) fail('缺少 ADMIN_PASSWORD')
if (!CLIENT_NAME) fail('缺少 CLIENT_NAME')
if (!REDIRECT_URIS.length) fail('缺少 CLIENT_REDIRECT_URIS')

const origin = new URL(AUTH_URL).origin

const signInResponse = await fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin,
    referer: `${origin}/sign-in`,
  },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
})

const signInText = await signInResponse.text()
if (!signInResponse.ok) fail(`登录失败：HTTP ${signInResponse.status} ${signInText}`)

const setCookies = signInResponse.headers.getSetCookie?.() ?? []
const cookie = setCookies.map(value => value.split(';')[0]).join('; ')
if (!cookie) fail('登录成功但没有拿到会话 Cookie，无法继续创建客户端')

async function postClient(path, body) {
  const response = await fetch(`${AUTH_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      referer: `${origin}/account`,
      cookie,
    },
    body: JSON.stringify(body),
  })
  return { response, text: await response.text() }
}

const body = {
  client_name: CLIENT_NAME,
  redirect_uris: REDIRECT_URIS,
  token_endpoint_auth_method: 'client_secret_basic',
  require_pkce: true,
  ...(POST_LOGOUT_URIS.length ? { post_logout_redirect_uris: POST_LOGOUT_URIS } : {}),
  ...(BACKCHANNEL_LOGOUT_URI ? { backchannel_logout_uri: BACKCHANNEL_LOGOUT_URI } : {}),
  // 跳过授权确认页，实现静默 SSO；只有管理员才能设置。
  ...(SKIP_CONSENT ? { skip_consent: true, enable_end_session: true } : {}),
}

// 认证服务自带的 /api/admin/oauth-clients 会校验管理员角色。
const { response, text } = await postClient('/api/admin/oauth-clients', body)

if (!response.ok) {
  fail(`创建客户端失败：HTTP ${response.status} ${text}`)
}

let parsed
try {
  parsed = JSON.parse(text)
} catch {
  console.log(text)
  process.exit(0)
}

const client = parsed.client ?? parsed.data ?? parsed
const clientId = client.client_id ?? client.clientId
const clientSecret = client.client_secret ?? client.clientSecret

console.log('\n✔ OAuth 客户端创建成功\n')
console.log(`名称:          ${CLIENT_NAME}`)
console.log(`client_id:     ${clientId ?? '(见下方原始响应)'}`)
console.log(`client_secret: ${clientSecret ?? '(见下方原始响应)'}`)
console.log(`redirect:      ${REDIRECT_URIS.join(', ')}`)
console.log('授权模式：     Authorization Code + PKCE')
if (SKIP_CONSENT) console.log('consent:       已跳过（静默 SSO）')
console.log('\n请把 client_id / client_secret 保存为应用 Worker 的 secrets，secret 只显示这一次。\n')
console.log('原始响应：')
console.log(JSON.stringify(parsed, null, 2))

