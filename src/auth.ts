import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './db/schema'
import { renderEmail, type EmailContent } from './emailTemplate'
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

async function sendEmail(env: Env, to: string, subject: string, content: EmailContent): Promise<void> {
  // 发件域名必须是在 Cloudflare Email Sending 中已启用的域名（当前为 mail.ljhsu.xin）。
  const from = env.EMAIL_FROM || 'Suxin Login <login@mail.ljhsu.xin>'
  if (!env.EMAIL) {
    // 未绑定 send_email 时的兜底：把内容打到控制台，方便本地排查。
    console.log(`[email:no-binding] to=${to}\nsubject=${subject}\n${content.text}`)
    return
  }
  // 本地 wrangler dev 会模拟发送并把内容写入日志/临时文件；线上才会真正投递。
  await env.EMAIL.send({ from, to, subject, ...content })
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
          renderEmail({ title: '重置登录密码', description: '我们收到了重置密码的请求。点击下面的按钮设置新密码，链接 1 小时内有效。', action: '重置密码', url }),
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
          renderEmail({ title: '验证邮箱', description: '点击下面的按钮完成邮箱验证，之后就可以用这个账号登录所有应用。', action: '验证邮箱', url }),
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
