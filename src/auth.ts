import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './db/schema'
import type { Env } from './env'

function trustedOrigins(env: Env): string[] {
  return (env.TRUSTED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
}

function socialProviders(env: Env) {
  return {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function emailLayout(title: string, description: string, action: string, url: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1e2420;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e0d6;border-radius:18px;padding:36px;">
          <tr><td>
            <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6b736c;margin-bottom:18px;">Suxin Account</div>
            <h1 style="margin:0 0 12px;font-size:26px;line-height:1.3;">${escapeHtml(title)}</h1>
            <p style="margin:0 0 26px;font-size:15px;line-height:1.75;color:#4c554e;">${escapeHtml(description)}</p>
            <a href="${escapeHtml(url)}" style="display:inline-block;background:#1f6f5c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:10px;">${escapeHtml(action)}</a>
            <p style="margin:26px 0 0;font-size:13px;line-height:1.7;color:#7b837c;">如果按钮无法打开，请复制以下链接到浏览器：<br><span style="word-break:break-all;color:#1f6f5c;">${escapeHtml(url)}</span></p>
          </td></tr>
        </table>
        <p style="max-width:520px;margin:18px auto 0;font-size:12px;line-height:1.7;color:#8b938c;text-align:center;">此邮件由 login.ljhsu.xin 发送。如果不是你本人操作，可以忽略。</p>
      </td></tr>
    </table>
  </body>
</html>`
}

async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  const from = env.EMAIL_FROM || 'Suxin Login <login@ljhsu.xin>'
  if (!env.RESEND_API_KEY) {
    // 本地开发没有邮件服务时，把链接打到 Worker 控制台，方便直接点开。
    console.log(`[email:dev] to=${to}\nsubject=${subject}\n${html}`)
    return
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })
  if (!response.ok) {
    throw new Error(`发送邮件失败：HTTP ${response.status} ${await response.text()}`)
  }
}

export function createAuth(env: Env) {
  const requireVerification = env.REQUIRE_EMAIL_VERIFICATION === 'true'

  return betterAuth({
    appName: 'Suxin Login',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // D1 通过 drizzle 适配器访问：schema.ts 里的物理表名/列名是 snake_case，
    // Better Auth 的模型字段名是 camelCase，适配器负责两者之间的映射。
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: 'sqlite',
      schema,
    }),
    trustedOrigins: trustedOrigins(env),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: requireVerification,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          '重置你的 Suxin 登录密码',
          emailLayout('重置登录密码', '我们收到了重置密码的请求。点击下面的按钮设置新密码，链接 1 小时内有效。', '重置密码', url),
        )
      },
    },
    emailVerification: {
      sendOnSignUp: requireVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          '验证你的 Suxin 邮箱',
          emailLayout('验证邮箱', '点击下面的按钮完成邮箱验证，之后就可以用这个账号登录所有应用。', '验证邮箱', url),
        )
      },
    },
    socialProviders: socialProviders(env),
    plugins: [
      jwt(),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      oauthProvider({
        loginPage: '/sign-in',
        consentPage: '/consent',
        allowDynamicClientRegistration: false,
        // 只有管理员能创建/修改 OAuth 客户端；普通用户只能用已有应用登录。
        clientPrivileges: ({ user }) => (user as { role?: string } | undefined)?.role === 'admin',
      }),
    ],
  })
}
