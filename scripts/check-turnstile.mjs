#!/usr/bin/env node
/**
 * 检查某个账号中心环境的 Turnstile 配置是否按预期生效。
 *
 * 用法：node scripts/check-turnstile.mjs [https://staging.ljhsu.xin]
 * 依次检查：/api/providers 是否下发 site key、无 token 是否被拒、伪造 token 是否被拒。
 */
const base = (process.argv[2] || 'https://staging.ljhsu.xin').replace(/\/$/, '')
const origin = base

const post = (path, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...headers },
    body: JSON.stringify({ email: 'turnstile-check@example.com', password: 'not-a-real-password' }),
  })

const providers = await fetch(base + '/api/providers').then(r => r.json()).catch(() => null)
const siteKey = providers?.turnstile ?? null
console.log('providers:', JSON.stringify(providers))
console.log(siteKey ? `site key 已下发：${siteKey}` : '未启用 Turnstile（前端不渲染 widget，登录不校验）')

const noToken = await post('/api/auth/sign-in/email')
console.log('无 token 提交:', noToken.status, (await noToken.text()).slice(0, 120))

const badToken = await post('/api/auth/sign-in/email', { 'x-turnstile-token': 'XXXX.DUMMY.TOKEN.XXXX' })
console.log('伪造 token 提交:', badToken.status, (await badToken.text()).slice(0, 120))

const expectedReject = ['400', '403']
const ok = siteKey
  ? expectedReject.includes(String(noToken.status)) && expectedReject.includes(String(badToken.status))
  : noToken.status !== 429 && String(noToken.status).startsWith('4')
console.log(ok ? '\n结论：配置符合预期' : '\n结论：与预期不符，请检查 TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY')
