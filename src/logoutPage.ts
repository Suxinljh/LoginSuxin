/**
 * 自定义的登出确认页。Better Auth 自带的确认页是英文纯文本，
 * 这里在 Worker 层拦截 `/api/auth/oauth2/end-session` 返回的 HTML 并替换外观，
 * Set-Cookie（确认状态）保持原样，提交地址仍是官方 confirm 端点。
 */

const CONFIRM_PATH = '/api/auth/oauth2/end-session/confirm'

export type LogoutPageInput = {
  appName: string
  cancelUrl: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function renderLogoutPage({ appName, cancelUrl }: LogoutPageInput): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>退出登录 · Suxin</title>
    <style>
      :root {
        --page: #f4f1e8;
        --surface: #fffefb;
        --ink: #1c231f;
        --muted: #69726a;
        --line: #e4dfd3;
        --accent: #1f6f5c;
        --accent-strong: #165746;
        --secondary: #f3f6f3;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --page: #111512;
          --surface: #1a201c;
          --ink: #eef2ed;
          --muted: #a4aea6;
          --line: #2c342e;
          --accent: #63c3a7;
          --accent-strong: #7fd6bb;
          --secondary: #202721;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 18px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 14% 10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 34%),
          radial-gradient(circle at 86% 82%, rgba(198, 151, 82, 0.14), transparent 38%),
          var(--page);
      }
      main {
        width: 100%;
        max-width: 420px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: 0 24px 70px rgba(36, 42, 37, 0.12), 0 2px 8px rgba(36, 42, 37, 0.05);
        padding: 32px;
      }
      .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
      .mark {
        width: 36px; height: 36px; border-radius: 11px;
        display: grid; place-items: center;
        background: linear-gradient(145deg, var(--accent), var(--accent-strong));
        color: #fff; font-size: 19px; font-weight: 800;
      }
      .brand span { font-size: 16px; font-weight: 700; }
      h1 { margin: 0 0 10px; font-size: 26px; line-height: 1.25; letter-spacing: -0.02em; }
      p { margin: 0 0 24px; font-size: 14px; line-height: 1.7; color: var(--muted); }
      .app { color: var(--ink); font-weight: 600; }
      .actions { display: grid; gap: 10px; }
      button, a {
        display: inline-flex; align-items: center; justify-content: center;
        min-height: 46px; padding: 0 18px;
        border-radius: 12px; font-size: 15px; font-weight: 600;
        text-decoration: none; cursor: pointer;
      }
      button { border: 1px solid transparent; background: var(--accent); color: #fff; }
      button:hover { background: var(--accent-strong); }
      a { border: 1px solid var(--line); background: var(--secondary); color: var(--ink); }
      a:hover { border-color: var(--accent); }
      .note { margin: 18px 0 0; font-size: 12px; line-height: 1.7; color: var(--muted); text-align: center; }
      @media (prefers-color-scheme: dark) {
        button { color: #0b1a14; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark" aria-hidden="true">S</span><span>Suxin</span></div>
      <h1>退出登录？</h1>
      <p>你将退出 Suxin 统一账号，并返回 <span class="app">${escapeHtml(appName)}</span>。退出后，其他应用需要重新登录。</p>
      <form method="post" action="${CONFIRM_PATH}">
        <input type="hidden" name="action" value="confirm" />
        <div class="actions">
          <button type="submit">退出登录</button>
          <a href="${escapeHtml(cancelUrl)}">取消</a>
        </div>
      </form>
      <p class="note">只退出当前浏览器；其他设备上的登录状态不受影响。</p>
    </main>
  </body>
</html>`
}

/** 把数据库里可能被多层 JSON 编码的 URI 列表还原成数组。 */
export function parseUriList(raw: string | null): string[] {
  if (!raw) return []
  let value: unknown = raw
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth++) {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 只有请求的登出跳转地址已在客户端登记时才用它，避免开放重定向。 */
export function safeCancelUrl(registered: string[], requested: string | null): string {
  if (requested && registered.includes(requested)) return requested
  return '/account'
}
