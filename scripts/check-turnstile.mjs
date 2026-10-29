#!/usr/bin/env node
/**
 * 检查某个账号中心环境的 Turnstile 配置是否按预期生效。
 *
 * 用法：node scripts/check-turnstile.mjs [https://staging.ljhsu.xin]
 * 依次检查：/api/providers 是否下发 site key、密码登录与社交登录在无 token / 伪造 token 下的结果。
 */
const base = (process.argv[2] || 'https://staging.ljhsu.xin').replace(/\/$/, '')

const post = async (headers = {}) => {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify({ email: 'turnstile-check@example.com', password: 'not-a-real-password' }),
  })
  const text = await response.text()
  return { status: response.status, text }
}

const postSocial = async (headers = {}) => {
  const response = await fetch(`${base}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify({ provider: 'github', callbackURL: `${base}/account` }),
  })
  const text = await response.text()
  return { status: response.status, text }
}

const providers = await fetch(`${base}/api/providers`).then(r => r.json()).catch(() => null)
const siteKey = providers?.turnstile ?? null
console.log('providers:', JSON.stringify(providers))

if (!siteKey) {
  console.log('未启用 Turnstile：前端不渲染 widget，服务端也不校验（登录流程与未接入时一致）')
  const plain = await post()
  console.log('无 token 提交:', plain.status, plain.text.slice(0, 120))
  console.log(plain.status === 429 ? '\n结论：被登录限流拦下，稍后再试' : '\n结论：符合“未启用”预期')
  process.exit(0)
}

console.log(`site key 已下发：${siteKey}`)
const noToken = await post()
console.log('无 token 提交:', noToken.status, noToken.text.slice(0, 120))
const dummy = await post({ 'x-turnstile-token': 'XXXX.DUMMY.TOKEN.XXXX' })
console.log('伪造 token 提交:', dummy.status, dummy.text.slice(0, 120))
const social = await postSocial()
console.log('社交登录无 token:', social.status, social.text.slice(0, 120))

const noTokenBlocked = noToken.status === 400 && noToken.text.includes('人机验证')
const dummyRejected = dummy.status === 400 && dummy.text.includes('人机验证')
const dummyAccepted = dummy.status === 401 || dummy.status === 200
const socialBlocked = social.status === 400 && social.text.includes('人机验证')
if (!noTokenBlocked) console.log('\n✗ 无 token 没有被拒：检查是否配置了 SECRET、以及请求是否带 Origin')
else if (!socialBlocked) console.log('\n✗ 社交登录没有被拦：检查 /api/auth/sign-in/social 是否在 TURNSTILE_PROTECTED_PATHS 里')
else if (dummyRejected) console.log('\n结论：校验生效且拒绝伪造 token')
else if (dummyAccepted) console.log('\n结论：校验生效；伪造 token 被放行说明用的是官方 always-pass 测试 secret')
else console.log('\n结论：结果与预期不同，请检查 secret 与 site key 是否属于同一个 widget')
