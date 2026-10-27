import { createAuthClient } from 'better-auth/react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'

// 同源部署：开发时 Vite 把 /api 代理到本机 Worker，生产时由同一个 Worker 提供。
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
})
