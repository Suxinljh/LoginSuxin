import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { admin, jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'

// 这个文件只给 Better Auth CLI 生成数据库 schema 用，不参与 Worker 运行时。
// 它与 src/auth.ts 的插件、社交登录和字段配置保持一致；改配置时两边都要改。
export const auth = betterAuth({
  appName: 'Suxin Login',
  baseURL: 'http://localhost:5173',
  secret: 'cli-only-secret-00000000000000000000000000000000',
  database: memoryAdapter({}),
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: { clientId: 'cli', clientSecret: 'cli' },
    google: { clientId: 'cli', clientSecret: 'cli' },
  },
  plugins: [
    jwt(),
    admin(),
    oauthProvider({
      loginPage: '/sign-in',
      consentPage: '/consent',
      allowDynamicClientRegistration: false,
    }),
  ],
})
