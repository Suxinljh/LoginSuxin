import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { authClient } from './auth-client'
import { Alert, AuthShell, Button, SocialButtons, Spinner, TextField, errorText } from './components'

function useOAuthFlow(): boolean {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.has('oauth_query') || params.has('client_id')
  }, [])
}

export function Home() {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) {
    return (
      <AuthShell title="Suxin 登录">
        <div className="loading-box"><Spinner /> 正在读取登录状态…</div>
      </AuthShell>
    )
  }
  return <Navigate to={session ? '/account' : '/sign-in'} replace />
}

export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const oauthFlow = useOAuthFlow()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.signIn.email({ email, password })
    setLoading(false)
    if (error) {
      setError(errorText(error))
      return
    }
    // OAuth 流程由 oauthProviderClient 自动继续；普通登录回到账户页。
    if (!oauthFlow) navigate('/account', { replace: true })
  }

  return (
    <AuthShell title="登录 Suxin" description="一个账号，登录所有应用。">
      <form className="auth-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <TextField
          label="邮箱"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="至少 8 位"
        />
        <div className="form-between">
          <span />
          <Link to="/forgot-password">忘记密码？</Link>
        </div>
        <Button type="submit" loading={loading}>登录</Button>
      </form>
      <SocialButtons onError={setError} />
      <p className="auth-switch">
        还没有账号？<Link to="/sign-up">创建一个</Link>
      </p>
    </AuthShell>
  )
}

export function SignUp() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const oauthFlow = useOAuthFlow()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('两次输入的密码不一致。')
      return
    }
    setLoading(true)
    const { error } = await authClient.signUp.email({ email, password, name })
    setLoading(false)
    if (error) {
      setError(errorText(error))
      return
    }
    setDone(true)
    if (!oauthFlow) {
      const session = await authClient.getSession()
      if (session.data) navigate('/account', { replace: true })
    }
  }

  if (done) {
    return (
      <AuthShell title="注册成功" description="如果开启了邮箱验证，请先查收验证邮件。">
        <Alert kind="success">账号已创建。验证邮箱后即可登录所有应用。</Alert>
        <p className="auth-switch"><Link to="/sign-in">返回登录</Link></p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="创建 Suxin 账号" description="注册一次，之后用它登录所有应用。">
      <form className="auth-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <TextField
          label="名字"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="怎么称呼你"
        />
        <TextField
          label="邮箱"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="至少 8 位"
        />
        <TextField
          label="确认密码"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={event => setConfirm(event.target.value)}
          placeholder="再输入一次"
        />
        <Button type="submit" loading={loading}>创建账号</Button>
      </form>
      <SocialButtons onError={setError} />
      <p className="auth-switch">
        已经有账号？<Link to="/sign-in">直接登录</Link>
      </p>
    </AuthShell>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (error) {
      setError(errorText(error))
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <AuthShell title="邮件已发送" description="如果这个邮箱已注册，你会收到一封重置密码的邮件。">
        <Alert kind="success">请查收邮件，并点击其中的链接设置新密码。链接 1 小时内有效。</Alert>
        <p className="auth-switch"><Link to="/sign-in">返回登录</Link></p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="找回密码" description="输入注册邮箱，我们会发送重置链接。">
      <form className="auth-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <TextField
          label="邮箱"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <Button type="submit" loading={loading}>发送重置邮件</Button>
      </form>
      <p className="auth-switch"><Link to="/sign-in">返回登录</Link></p>
    </AuthShell>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('两次输入的密码不一致。')
      return
    }
    setLoading(true)
    const { error } = await authClient.resetPassword({ newPassword: password, token })
    setLoading(false)
    if (error) {
      setError(errorText(error))
      return
    }
    setDone(true)
  }

  if (!token) {
    return (
      <AuthShell title="链接无效" description="重置链接缺少必要参数。">
        <Alert kind="error">请重新申请一封重置密码邮件。</Alert>
        <p className="auth-switch"><Link to="/forgot-password">重新申请</Link></p>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="密码已更新" description="现在可以用新密码登录了。">
        <Alert kind="success">密码修改成功。</Alert>
        <p className="auth-switch"><Link to="/sign-in">去登录</Link></p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="设置新密码" description="请输入一个至少 8 位的新密码。">
      <form className="auth-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <TextField
          label="新密码"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="至少 8 位"
        />
        <TextField
          label="确认新密码"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={event => setConfirm(event.target.value)}
          placeholder="再输入一次"
        />
        <Button type="submit" loading={loading}>更新密码</Button>
      </form>
    </AuthShell>
  )
}

export function Account() {
  const { data: session, isPending } = authClient.useSession()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const navigate = useNavigate()

  if (isPending) {
    return (
      <AuthShell title="正在读取登录状态">
        <div className="loading-box"><Spinner /> 请稍候…</div>
      </AuthShell>
    )
  }
  if (!session) return <Navigate to="/sign-in" replace />

  const user = session.user

  async function signOut() {
    await authClient.signOut()
    navigate('/sign-in', { replace: true })
  }

  async function resendVerification() {
    setSending(true)
    setError('')
    const { error } = await authClient.sendVerificationEmail({
      email: user.email,
      callbackURL: '/account',
    })
    setSending(false)
    if (error) {
      setError(errorText(error))
      return
    }
    setNotice('验证邮件已发送，请查收。')
  }

  return (
    <AuthShell title={`你好，${user.name || '朋友'}`} description="你已登录 Suxin 统一账号。">
      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <div className="account-card">
        <div className="account-row"><span>邮箱</span><strong>{user.email}</strong></div>
        <div className="account-row"><span>状态</span><strong>{user.emailVerified ? '邮箱已验证' : '邮箱未验证'}</strong></div>
        <div className="account-row"><span>用户 ID</span><code>{user.id}</code></div>
      </div>
      {!user.emailVerified && (
        <div className="account-actions">
          <Button variant="secondary" loading={sending} onClick={resendVerification}>重新发送验证邮件</Button>
        </div>
      )}
      <div className="account-actions">
        <Button variant="secondary" onClick={signOut}>退出登录</Button>
      </div>
      <p className="auth-switch"><Link to="/">返回首页</Link></p>
    </AuthShell>
  )
}

type ConsentInfo = {
  client_id?: string
  scope?: string
  claims?: string
}

export function Consent() {
  const [info, setInfo] = useState<ConsentInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/consent-info${window.location.search}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json() as ConsentInfo & { error?: string }
        if (!response.ok) throw new Error(data.error || '授权请求无效')
        setInfo(data)
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setError(error instanceof Error ? error.message : '授权请求无效')
      })
    return () => controller.abort()
  }, [])

  async function decide(accept: boolean) {
    setLoading(true)
    setError('')
    const { error } = await authClient.oauth2.consent({ accept })
    setLoading(false)
    if (error) setError(errorText(error))
  }

  const scopes = info?.scope?.split(' ').filter(Boolean) ?? []

  return (
    <AuthShell title="授权登录" description="一个应用正在请求访问你的 Suxin 账号。">
      {error && <Alert kind="error">{error}</Alert>}
      {info ? (
        <>
          <div className="account-card">
            <div className="account-row"><span>应用</span><strong>{info.client_id || '未知应用'}</strong></div>
            <div className="account-row"><span>请求范围</span><strong>{scopes.length ? scopes.join('、') : '基础账号信息'}</strong></div>
          </div>
          <p className="consent-note">授权后，应用只会拿到你的用户 ID、姓名和邮箱，不会拿到密码。</p>
          <div className="consent-actions">
            <Button variant="secondary" onClick={() => decide(false)} disabled={loading}>拒绝</Button>
            <Button onClick={() => decide(true)} loading={loading}>允许</Button>
          </div>
        </>
      ) : !error ? (
        <div className="loading-box"><Spinner /> 正在验证授权请求…</div>
      ) : null}
    </AuthShell>
  )
}

export function NotFound() {
  return (
    <AuthShell title="页面不存在" description="你访问的地址可能已经失效。">
      <p className="auth-switch"><Link to="/">回到首页</Link></p>
    </AuthShell>
  )
}

const CHANGELOG = [
  {
    version: 'v0.1.0',
    date: '2026-10-27',
    items: [
      '统一账号服务首次上线：邮箱 + 密码注册、登录、找回密码。',
      '支持 GitHub / Google 第三方登录（配置对应密钥后自动显示）。',
      '实现 OIDC Authorization Code + PKCE，各应用通过 login.ljhsu.xin 完成授权。',
      '管理员可通过脚本创建 OAuth 客户端，支持跳过授权确认页的静默 SSO。',
      '账户页展示邮箱验证状态，可重新发送验证邮件。',
    ],
  },
]

export function Changelog() {
  return (
    <AuthShell title="更新日志" description="Suxin 统一账号的版本记录。">
      <div className="changelog">
        {CHANGELOG.map(entry => (
          <section key={entry.version} className="changelog-entry">
            <header>
              <strong>{entry.version}</strong>
              <span>{entry.date}</span>
            </header>
            <ul>
              {entry.items.map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
      <p className="auth-switch"><Link to="/">返回首页</Link></p>
    </AuthShell>
  )
}

