import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Chip, Spinner } from '@heroui/react'
import { authClient } from './auth-client'
import { AuthShell, FormField, Notice, SocialButtons, StatusChip, SubmitButton, TextLink, errorText } from './components'

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
        <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted">
          <Spinner size="sm" /> 正在读取登录状态…
        </div>
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
      <form className="grid gap-4" onSubmit={submit}>
        {error && <Notice kind="danger">{error}</Notice>}
        <FormField label="邮箱" type="email" autoComplete="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <FormField label="密码" type="password" autoComplete="current-password" value={password} onChange={setPassword} placeholder="至少 8 位" />
        <div className="-mt-1 flex justify-end text-sm">
          <TextLink href="/forgot-password">忘记密码？</TextLink>
        </div>
        <SubmitButton loading={loading}>登录</SubmitButton>
      </form>
      <SocialButtons onError={setError} />
      <p className="mt-5 text-center text-sm text-muted">
        还没有账号？<TextLink href="/sign-up">创建一个</TextLink>
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
        <Notice kind="success">账号已创建。验证邮箱后即可登录所有应用。</Notice>
        <p className="mt-5 text-center text-sm text-muted"><TextLink href="/sign-in">返回登录</TextLink></p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="创建 Suxin 账号" description="注册一次，之后用它登录所有应用。">
      <form className="grid gap-4" onSubmit={submit}>
        {error && <Notice kind="danger">{error}</Notice>}
        <FormField label="名字" autoComplete="name" value={name} onChange={setName} placeholder="怎么称呼你" />
        <FormField label="邮箱" type="email" autoComplete="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <FormField label="密码" type="password" autoComplete="new-password" minLength={8} value={password} onChange={setPassword} placeholder="至少 8 位" />
        <FormField label="确认密码" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={setConfirm} placeholder="再输入一次" />
        <SubmitButton loading={loading}>创建账号</SubmitButton>
      </form>
      <SocialButtons onError={setError} />
      <p className="mt-5 text-center text-sm text-muted">
        已经有账号？<TextLink href="/sign-in">直接登录</TextLink>
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
        <Notice kind="success">请查收邮件，并点击其中的链接设置新密码。链接 1 小时内有效。</Notice>
        <p className="mt-5 text-center text-sm text-muted"><TextLink href="/sign-in">返回登录</TextLink></p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="找回密码" description="输入注册邮箱，我们会发送重置链接。">
      <form className="grid gap-4" onSubmit={submit}>
        {error && <Notice kind="danger">{error}</Notice>}
        <FormField label="邮箱" type="email" autoComplete="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <SubmitButton loading={loading}>发送重置邮件</SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm text-muted"><TextLink href="/sign-in">返回登录</TextLink></p>
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
        <Notice kind="danger">请重新申请一封重置密码邮件。</Notice>
        <p className="mt-5 text-center text-sm text-muted"><TextLink href="/forgot-password">重新申请</TextLink></p>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="密码已更新" description="现在可以用新密码登录了。">
        <Notice kind="success">密码修改成功。</Notice>
        <p className="mt-5 text-center text-sm text-muted"><TextLink href="/sign-in">去登录</TextLink></p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="设置新密码" description="请输入一个至少 8 位的新密码。">
      <form className="grid gap-4" onSubmit={submit}>
        {error && <Notice kind="danger">{error}</Notice>}
        <FormField label="新密码" type="password" autoComplete="new-password" minLength={8} value={password} onChange={setPassword} placeholder="至少 8 位" />
        <FormField label="确认新密码" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={setConfirm} placeholder="再输入一次" />
        <SubmitButton loading={loading}>更新密码</SubmitButton>
      </form>
    </AuthShell>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-separator px-4 py-3 text-sm last:border-b-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="text-right font-medium break-all">{children}</span>
    </div>
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
        <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted">
          <Spinner size="sm" /> 请稍候…
        </div>
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
      <div className="grid gap-4">
        {notice && <Notice kind="success">{notice}</Notice>}
        {error && <Notice kind="danger">{error}</Notice>}
        <div className="overflow-hidden rounded-xl border border-border bg-surface-secondary">
          <InfoRow label="邮箱">{user.email}</InfoRow>
          <InfoRow label="状态"><StatusChip verified={user.emailVerified} /></InfoRow>
          <InfoRow label="用户 ID"><code className="font-mono text-xs font-normal text-muted">{user.id}</code></InfoRow>
        </div>
        {!user.emailVerified && (
          <Button variant="secondary" fullWidth onPress={resendVerification} isPending={sending}>
            {({ isPending }) => (
              <>
                {isPending ? <Spinner color="current" size="sm" /> : null}
                重新发送验证邮件
              </>
            )}
          </Button>
        )}
        <Button variant="outline" fullWidth onPress={signOut}>退出登录</Button>
        <p className="text-center text-sm text-muted"><TextLink href="/">返回首页</TextLink></p>
      </div>
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
      {error && <Notice kind="danger">{error}</Notice>}
      {info ? (
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-xl border border-border bg-surface-secondary">
            <InfoRow label="应用">{info.client_id || '未知应用'}</InfoRow>
            <InfoRow label="请求范围">
              {scopes.length ? (
                <span className="flex flex-wrap justify-end gap-1.5">
                  {scopes.map(scope => <Chip key={scope} size="sm" color="accent">{scope}</Chip>)}
                </span>
              ) : '基础账号信息'}
            </InfoRow>
          </div>
          <p className="text-xs leading-relaxed text-muted">授权后，应用只会拿到你的用户 ID、姓名和邮箱，不会拿到密码。</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline" onPress={() => decide(false)} isDisabled={loading}>拒绝</Button>
            <Button onPress={() => decide(true)} isPending={loading}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : null}
                  允许
                </>
              )}
            </Button>
          </div>
        </div>
      ) : !error ? (
        <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted">
          <Spinner size="sm" /> 正在验证授权请求…
        </div>
      ) : null}
    </AuthShell>
  )
}

const CHANGELOG = [
  {
    version: 'v0.1.1',
    date: '2026-10-27',
    items: [
      '登录、注册、找回密码、账户与授权页改用 HeroUI v3 组件与 Tailwind CSS 4。',
      '新增自定义品牌主题（src/client/theme.css），跟随系统自动切换亮色/暗色。',
      '表单校验、加载状态与提示改用组件化的 Alert / Spinner / Button。',
    ],
  },
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
      <div className="grid gap-4">
        {CHANGELOG.map(entry => (
          <section key={entry.version} className="rounded-xl border border-border bg-surface-secondary p-4">
            <header className="mb-2.5 flex items-baseline justify-between gap-3">
              <strong className="text-sm">{entry.version}</strong>
              <span className="text-xs text-muted">{entry.date}</span>
            </header>
            <ul className="grid list-disc gap-1.5 pl-4 text-[13px] leading-relaxed text-muted">
              {entry.items.map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-5 text-center text-sm text-muted"><TextLink href="/">返回首页</TextLink></p>
    </AuthShell>
  )
}

export function NotFound() {
  return (
    <AuthShell title="页面不存在" description="你访问的地址可能已经失效。">
      <p className="text-center text-sm text-muted"><TextLink href="/">回到首页</TextLink></p>
    </AuthShell>
  )
}

