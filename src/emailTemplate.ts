/**
 * 邮件模板。纯 HTML / 纯文本，不依赖 Worker 或 Better Auth，
 * 方便用 `pnpm preview:email` 单独预览。
 *
 * 设计稿：验证邮件（1686×429）与重置密码邮件，均为 600px 白底卡片。
 * 邮件客户端普遍不支持外部 CSS、字体和 oklch 颜色，所以：
 * - 只写内联样式，颜色用十六进制；
 * - 宽度 600px，手机上不会被裁切；
 * - 同时提供纯文本版本。
 */

const LOGO_URL = 'https://login.ljhsu.xin/brand/logo-name.png'
const SITE_URL = 'https://login.ljhsu.xin'
const ACCENT = '#2563eb'
const INK = '#111827'
const BODY = '#4b5563'
const MUTED = '#6b7280'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

export type EmailContent = { html: string; text: string }

type LayoutInput = {
  /** 邮件标题，例如「重置密码：」；留空则不显示标题行。 */
  title?: string
  /** 标题上方的灰色小字，例如「请验证你的邮箱：」。 */
  eyebrow?: string
  /** 主按钮文字。 */
  action: string
  /** 主按钮链接。 */
  url: string
  /** 按钮下方的说明段落。 */
  paragraphs: string[]
  /** 是否在正文里展示完整的备用链接。 */
  showRawUrl?: boolean
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function renderLayout({ title, eyebrow, action, url, paragraphs, showRawUrl = false }: LayoutInput): EmailContent {
  const safeUrl = escapeHtml(url)
  const paragraphsHtml = paragraphs
    .map(text => `<p style="margin:0 0 10px;font-size:13px;line-height:1.8;color:${BODY};">${escapeHtml(text)}</p>`)
    .join('')

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${escapeHtml(title || action)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
      <tr>
        <td align="center" style="padding:28px 16px 40px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">
            <tr>
              <td style="padding:0 0 26px;">
                <img src="${LOGO_URL}" width="112" height="26" alt="Suxin" style="display:block;width:112px;height:26px;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>
            <tr>
              <td>
                ${eyebrow ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${MUTED};">${escapeHtml(eyebrow)}</p>` : ''}
                ${title ? `<h1 style="margin:0 0 12px;font-size:17px;line-height:1.5;font-weight:700;color:${INK};">${escapeHtml(title)}</h1>` : ''}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
                  <tr>
                    <td align="center" bgcolor="${ACCENT}" style="border-radius:4px;background-color:${ACCENT};">
                      <a href="${safeUrl}" style="display:inline-block;padding:10px 18px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1.4;color:#ffffff;text-decoration:none;border-radius:4px;">${escapeHtml(action)}</a>
                    </td>
                  </tr>
                </table>
                <div style="font-family:${FONT};">
                  ${paragraphsHtml}
                </div>
                ${showRawUrl ? `<div style="margin-top:18px;font-family:${FONT};">
                  <p style="margin:0 0 6px;font-size:12px;line-height:1.7;color:${MUTED};">如果按钮无法打开，请复制以下链接到浏览器：</p>
                  <p style="margin:0;font-size:12px;line-height:1.7;word-break:break-all;">
                    <a href="${safeUrl}" style="color:${ACCENT};text-decoration:underline;">${safeUrl}</a>
                  </p>
                </div>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 0 0;">
                <p style="margin:0;text-align:right;font-size:12px;line-height:1.6;">
                  <a href="${SITE_URL}/sign-in" style="color:${ACCENT};text-decoration:none;font-weight:500;">登录 Suxin</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const textParts = [
    title || eyebrow || action,
    ...paragraphs,
    `${action}：${url}`,
    showRawUrl ? '如果按钮无法打开，请复制上面的链接到浏览器。' : '',
    `登录 Suxin：${SITE_URL}/sign-in`,
  ].filter(Boolean)

  return { html, text: textParts.join('\n\n') }
}

export function renderVerificationEmail({ url }: { url: string }): EmailContent {
  return renderLayout({
    eyebrow: '请验证你的邮箱：',
    action: '验证邮箱',
    url,
    paragraphs: [
      '点击按钮完成电子邮件验证（链接 1 小时内有效）。如果没有请求获取验证邮件，可以忽略这封电子邮件。',
    ],
  })
}

export function renderPasswordResetEmail({ url }: { url: string }): EmailContent {
  return renderLayout({
    title: '重置密码：',
    action: '点击重置',
    url,
    paragraphs: [
      '我们收到了重置密码的请求。点击下面的按钮设置新密码，链接 1 小时内有效。',
      '如果你没有请求重置，请不要担心，你可以安全地忽略此电子邮件。',
    ],
    showRawUrl: true,
  })
}
