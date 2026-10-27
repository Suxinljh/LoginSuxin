/**
 * 邮件模板。只放纯 HTML/文本，不依赖 Worker 或 Better Auth，
 * 方便用 `pnpm preview:email` 单独预览。
 *
 * 修改时注意：
 * - 邮件客户端普遍不支持外部 CSS / 字体，样式只能内联；
 * - 宽度控制在 600px 以内，移动端才不会被裁切；
 * - 同时返回 text 版本，有助于送达率，也给纯文本客户端兜底。
 */

const BRAND = 'Suxin Account'
const FOOTER = '此邮件由 login.ljhsu.xin 发送。如果不是你本人操作，可以忽略。'
const ACCENT = '#1f6f5c'
const ACCENT_STRONG = '#165746'
const PAGE = '#f6f4ef'
const INK = '#1e2420'
const MUTED = '#4c554e'
const SOFT = '#7b837c'
const LINE = '#e4e0d6'

export type EmailContent = { html: string; text: string }

export type EmailTemplateInput = {
  title: string
  description: string
  action: string
  url: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function renderEmail({ title, description, action, url }: EmailTemplateInput): EmailContent {
  const safeTitle = escapeHtml(title)
  const safeDescription = escapeHtml(description)
  const safeAction = escapeHtml(action)
  const safeUrl = escapeHtml(url)

  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:${PAGE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:${INK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:18px;padding:36px;">
          <tr><td>
            <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6b736c;margin-bottom:18px;">${BRAND}</div>
            <h1 style="margin:0 0 12px;font-size:26px;line-height:1.3;">${safeTitle}</h1>
            <p style="margin:0 0 26px;font-size:15px;line-height:1.75;color:${MUTED};">${safeDescription}</p>
            <a href="${safeUrl}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 24px;border-radius:10px;">${safeAction}</a>
            <p style="margin:26px 0 0;font-size:13px;line-height:1.7;color:${SOFT};">如果按钮无法打开，请复制以下链接到浏览器：<br><span style="word-break:break-all;color:${ACCENT_STRONG};">${safeUrl}</span></p>
          </td></tr>
        </table>
        <p style="max-width:520px;margin:18px auto 0;font-size:12px;line-height:1.7;color:#8b938c;text-align:center;">${FOOTER}</p>
      </td></tr>
    </table>
  </body>
</html>`

  // 纯文本版本：部分客户端只显示 text，也有助于降低垃圾邮件评分。
  const text = `${title}

${description}

${action}：${url}

${FOOTER}`

  return { html, text }
}
