import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 端口可用环境变量覆盖，避免与其他本地项目抢 5173 / 8787。
// 注意：改端口后 .dev.vars 里的 BETTER_AUTH_URL 要改成 http://localhost:<WEB_PORT>。
const webPort = Number(process.env.WEB_PORT ?? 5173)
const workerPort = Number(process.env.WORKER_PORT ?? 8787)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    port: webPort,
    strictPort: true,
    // 开发时由 Vite 提供登录页，/api 反代到本机 Worker；生产环境同源，无需代理。
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${workerPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
