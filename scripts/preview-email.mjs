#!/usr/bin/env node
/**
 * 本地预览登录邮件。生成 HTML / 纯文本到 .wrangler/email-preview/，
 * 不发送真实邮件，也不依赖 Cloudflare 账号。
 *
 *   pnpm preview:email
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderEmail } from '../src/emailTemplate.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.wrangler', 'email-preview')

const samples = [
  {
    file: 'verify',
    title: '验证邮箱',
    description: '点击下面的按钮完成邮箱验证，之后就可以用这个账号登录所有应用。',
    action: '验证邮箱',
    url: 'https://login.ljhsu.xin/api/auth/verify-email?token=preview-token',
  },
  {
    file: 'reset-password',
    title: '重置登录密码',
    description: '我们收到了重置密码的请求。点击下面的按钮设置新密码，链接 1 小时内有效。',
    action: '重置密码',
    url: 'https://login.ljhsu.xin/api/auth/reset-password/preview-token?callbackURL=https%3A%2F%2Flogin.ljhsu.xin%2Freset-password',
  },
]

await mkdir(outDir, { recursive: true })
for (const sample of samples) {
  const { html, text } = renderEmail(sample)
  await writeFile(join(outDir, `${sample.file}.html`), html, 'utf8')
  await writeFile(join(outDir, `${sample.file}.txt`), text, 'utf8')
}

console.log(`已生成邮件预览：\n  ${outDir}/verify.html\n  ${outDir}/reset-password.html\n\n纯文本版本：*.txt\n`)
