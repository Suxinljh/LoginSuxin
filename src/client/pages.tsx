import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Chip, Spinner } from '@heroui/react'
import { authClient } from './auth-client'
import { AuthShell, FormField, Notice, SocialButtons, StatusChip, SubmitButton, TextLink, TurnstileWidget, errorText, useTurnstileSiteKey } from './components'

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
  const siteKey = useTurnstileSiteKey()
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (siteKey && !turnstileToken) {
      setError('请先完成人机验证。')
      return
    }
    setLoading(true)
    const { error } = await authClient.signIn.email({
      email,
      password,
      fetchOptions: turnstileToken ? { headers: { 'x-turnstile-token': turnstileToken } } : undefined,
    })
    setLoading(false)
    if (error) {
      setError(errorText(error))
      // 验证 token 一次性，失败后必须换新的 widget。
      setTurnstileToken('')
      setTurnstileNonce(value => value + 1)
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
        <TurnstileWidget key={`signin-${turnstileNonce}`} siteKey={siteKey} onToken={setTurnstileToken} />
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
  const siteKey = useTurnstileSiteKey()
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('两次输入的密码不一致。')
      return
    }
    if (siteKey && !turnstileToken) {
      setError('请先完成人机验证。')
      return
    }
    setLoading(true)
    const { error } = await authClient.signUp.email({
      email,
      password,
      name,
      fetchOptions: turnstileToken ? { headers: { 'x-turnstile-token': turnstileToken } } : undefined,
    })
    setLoading(false)
    if (error) {
      setError(errorText(error))
      setTurnstileToken('')
      setTurnstileNonce(value => value + 1)
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
        <TurnstileWidget key={`signup-${turnstileNonce}`} siteKey={siteKey} onToken={setTurnstileToken} />
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
  const siteKey = useTurnstileSiteKey()
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (siteKey && !turnstileToken) {
      setError('请先完成人机验证。')
      return
    }
    setLoading(true)
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
      fetchOptions: turnstileToken ? { headers: { 'x-turnstile-token': turnstileToken } } : undefined,
    })
    setLoading(false)
    if (error) {
      setError(errorText(error))
      setTurnstileToken('')
      setTurnstileNonce(value => value + 1)
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
        <TurnstileWidget key={`forgot-${turnstileNonce}`} siteKey={siteKey} onToken={setTurnstileToken} />
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
  const [balance, setBalance] = useState<number | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!session) { setBalance(null); return }
    const controller = new AbortController()
    fetch('/api/account/credits', { signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { balance?: number }
        if (response.ok && typeof data.balance === 'number') setBalance(data.balance)
      })
      .catch(() => { /* 余额读取失败时显示—，不影响其它账户信息。 */ })
    return () => controller.abort()
  }, [session])

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
          <InfoRow label="积分">
            <span className="inline-flex items-center gap-2">
              <span>{balance === null ? '—' : balance}</span>
              <button
                type="button"
                aria-label="查看积分与用量"
                title="积分与用量"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted"
                onClick={() => navigate('/credits')}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </span>
          </InfoRow>
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
        <Button variant="secondary" fullWidth onPress={() => navigate('/credits')}>充值积分</Button>
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
            <Button variant="outline" fullWidth onPress={() => decide(false)} isDisabled={loading}>拒绝</Button>
            <Button fullWidth onPress={() => decide(true)} isPending={loading}>
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
    version: 'v0.2.0',
    date: '2026-10-28',
    items: [
      '账号中心迁至 account.ljhsu.xin；login.ljhsu.xin 保留并 308 跳转。',
      '退出登录改为一键完成，不再显示二次确认页；修复确认页过期或重复提交时报 “The logout confirmation is invalid or expired” 的问题。',
      '新增账号积分：余额、跨应用用量、退款申请与退款规则页面。',
      '新增《服务协议与政策》页面：隐私政策、用户协议与积分退款规则合并；客服邮箱以「客服邮箱」四个字作为超链接，不直接展示地址。',
      '积分归属账号而不是单个应用；消费/退款按账号串行，避免计费延迟下的并发退款。',
      '退款按审核时计算 12 个月与最终金额；超过 12 个月的支付宝订单转人工处理。',
      '充值入口：套餐 100/1000/5000 积分或自定义 50～1,000,000 积分，跳转到 EchoMind 充值页；账户页的积分改为一行入口。',
      '退款审核页支持状态筛选、分页、订单级明细与金额确认；每天自动对账并在页面显示结果。',
      '登录、注册、找回密码等凭据接口按 IP 限流；管理员操作（审核、导入、更正、对账）记入审计。',
      '可选开启 Cloudflare Turnstile 人机验证（登录、注册、找回密码），未配置时行为不变。',
      '新增 staging 环境 https://staging.ljhsu.xin，用于验证迁移与回调，不接触生产数据。',
    ],
  },
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

type UsageRow = { id: string; app_id: string | null; delta: number; reason: string; ref: string | null; created_at: number }
type RefundSummary = {
  id: string
  kind: string
  status: string
  estimated_cents: number
  final_cents: number
  manual_cents: number
  created_at: number
  completed_at: number | null
  note: string | null
}
type EstimateLot = {
  id: string
  app_id: string
  order_id: string
  credits: number
  remaining: number
  amount_cents: number
  paid_at: number
  refund_cents: number
  over_12m: boolean
}
type RefundEstimate = {
  balance: number
  refundable_credits: number
  estimated_cents: number
  lots: EstimateLot[]
  pending: RefundSummary | null
}
type CreditsInfo = {
  balance: number
  refundable_credits: number
  estimated_cents: number
  pending: RefundSummary | null
  usage: UsageRow[]
}
type AdminRefund = RefundSummary & { user_id: string; user_email: string | null; user_name: string | null }
type AdminRefundItem = {
  id: string
  order_id: string
  app_id: string
  paid_at: number
  credits: number
  amount_cents: number
  final_credits: number
  final_cents: number
  status: string
  refund_no: string | null
  provider_ref: string | null
  message: string | null
}
type AdminRefundDetail = { request: AdminRefund; items: AdminRefundItem[] }
type AdminReconcileReport = {
  id: string
  createdAt: number
  usersChecked: number
  mismatches: number
  expiredRefunds: number
  skippedItems: number
  detail?: {
    trigger?: string
    balanceMismatches?: { userId: string; balance: number; ledger: number }[]
    invalidLots?: { userId: string; lotId: string; credits: number; remaining: number }[]
  } | null
}
type AdminAuditEntry = {
  id: string
  actor: string
  action: string
  target: string | null
  detail: Record<string, unknown> | null
  createdAt: number
}
const AUDIT_LABELS: Record<string, string> = {
  'refund.approve': '通过退款',
  'refund.reject': '拒绝退款',
  'credits.import': '导入积分',
  'credits.correct': '更正积分',
  'reconcile.run': '手动对账',
}
const PAGE_SIZE = 30
const REFUND_FILTERS: [string, string][] = [
  ['', '全部'],
  ['pending', '待审核'],
  ['completed', '已完成'],
  ['failed', '部分失败'],
  ['rejected', '已拒绝'],
  ['expired', '已失效'],
]

const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`
/**
 * 充值只能由持有支付商户号的接入应用发起：账号中心本身没有支付宝商户号。
 * 目前唯一接入了收款的应用是 EchoMind，它的模型设置里有充值入口。
 */
const RECHARGE_APP = { name: 'EchoMind', base: 'https://echomind.ljhsu.xin/' }
const RECHARGE_PRESETS = [100, 1000, 5000]
/** 1 积分 = ¥0.01；自定义额度与服务端 worker/alipay.ts 的 customPackage 保持一致。 */
const MIN_CUSTOM_CREDITS = 50
const MAX_CUSTOM_CREDITS = 1_000_000
const rechargeHref = (credits: number) => `${RECHARGE_APP.base}?recharge=${credits}`
const shortDate = (ms: number) => new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const REFUND_STATUS: Record<string, string> = {
  pending: '待审核',
  reviewing: '审核中',
  approved: '已通过',
  completed: '已完成',
  rejected: '已拒绝',
  failed: '部分失败',
  expired: '已失效',
}
const REFUND_ITEM_STATUS: Record<string, string> = {
  pending: '待处理',
  processing: '退款中',
  refunded: '已退款',
  manual: '转人工',
  failed: '失败',
  skipped: '已跳过',
}
const LEDGER_REASON: Record<string, string> = {
  consume: '模型调用',
  refund: '退款',
  recharge: '充值',
  import: '导入',
  adjust: '调整',
}

export function Credits() {
  const { data: session, isPending } = authClient.useSession()
  const [info, setInfo] = useState<CreditsInfo | null>(null)
  const [error, setError] = useState('')
  const [customCredits, setCustomCredits] = useState('')
  const navigate = useNavigate()
  const customValue = Number(customCredits.trim())
  const customValid = customCredits.trim() !== '' && Number.isSafeInteger(customValue) && customValue >= MIN_CUSTOM_CREDITS && customValue <= MAX_CUSTOM_CREDITS
  const goRecharge = (credits: number) => { window.location.href = rechargeHref(credits) }

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    fetch('/api/account/credits', { signal: controller.signal })
      .then(async response => {
        const data = await response.json() as CreditsInfo & { error?: string }
        if (!response.ok) throw new Error(data.error || '读取积分失败')
        setInfo(data)
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '读取积分失败') })
    return () => controller.abort()
  }, [session])

  if (isPending) {
    return (
      <AuthShell title="正在读取积分">
        <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted"><Spinner size="sm" /> 请稍候…</div>
      </AuthShell>
    )
  }
  if (!session) return <Navigate to="/sign-in" replace />

  return (
    <AuthShell title="账号积分" description="积分跟随 Suxin 账号，可在接入的平台通用。" wide>
      <div className="grid gap-4">
        {error && <Notice kind="danger">{error}</Notice>}
        {info ? (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-surface-secondary">
              <InfoRow label="可用积分">{info.balance}</InfoRow>
              <InfoRow label="可退付费积分">{info.refundable_credits}</InfoRow>
              <InfoRow label="预估可退">{money(info.estimated_cents)}</InfoRow>
              <InfoRow label="退款状态">{info.pending ? REFUND_STATUS[info.pending.status] || info.pending.status : '无处理中退款'}</InfoRow>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Button variant="secondary" fullWidth onPress={() => navigate('/refunds')}>申请退款</Button>
              <Button variant="outline" fullWidth onPress={() => navigate('/terms/refund')}>服务协议与政策</Button>
            </div>
            <section className="rounded-xl border border-border bg-surface-secondary p-4">
              <h2 className="text-sm font-semibold">充值</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                1 积分 = ¥0.01。积分进入本账号后可在所有已接入的应用使用；充值由 {RECHARGE_APP.name} 的支付宝商户号收款，支付成功后自动入账。
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {RECHARGE_PRESETS.map(credits => (
                  <Button key={credits} variant="outline" fullWidth onPress={() => goRecharge(credits)}>
                    {credits} 积分 · {money(credits)}
                  </Button>
                ))}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <label className="flex-1 text-xs text-muted">
                  自定义积分
                  <input
                    type="number"
                    inputMode="numeric"
                    min={MIN_CUSTOM_CREDITS}
                    max={MAX_CUSTOM_CREDITS}
                    step={1}
                    value={customCredits}
                    placeholder={`${MIN_CUSTOM_CREDITS} ~ ${MAX_CUSTOM_CREDITS}`}
                    className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm"
                    onChange={event => setCustomCredits(event.target.value)}
                  />
                </label>
                <Button variant="secondary" isDisabled={!customValid} onPress={() => { if (customValid) goRecharge(customValue) }}>
                  {customValid ? `充值 ${money(customValue)}` : '充值'}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted">
                最低 {MIN_CUSTOM_CREDITS} 积分（{money(MIN_CUSTOM_CREDITS)}），最高 {MAX_CUSTOM_CREDITS.toLocaleString('zh-CN')} 积分（{money(MAX_CUSTOM_CREDITS)}），金额按积分动态计算。跳转后会打开 {RECHARGE_APP.name} 的充值页，未登录时需先用同一个 Suxin 账号登录。
              </p>
            </section>
            <section className="rounded-xl border border-border bg-surface-secondary p-4">
              <h2 className="mb-2 text-sm font-semibold">最近用量</h2>
              {info.usage.length === 0 ? <p className="text-sm text-muted">暂无用量记录。</p> : (
                <div className="grid gap-2">
                  {info.usage.map(row => (
                    <div key={row.id} className="flex items-center justify-between gap-3 border-b border-separator pb-2 text-sm last:border-b-0 last:pb-0">
                      <div><strong>{LEDGER_REASON[row.reason] || row.reason}</strong><small className="ml-2 text-xs text-muted">{row.app_id || '账号'}</small></div>
                      <div className="text-right"><span className="font-medium">{row.delta > 0 ? `+${row.delta}` : row.delta}</span><small className="ml-2 text-xs text-muted">{shortDate(row.created_at)}</small></div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <p className="text-center text-sm text-muted"><TextLink href="/account">返回账户</TextLink></p>
          </>
        ) : !error ? (
          <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted"><Spinner size="sm" /> 正在读取…</div>
        ) : null}
      </div>
    </AuthShell>
  )
}

export function Refunds() {
  const { data: session, isPending } = authClient.useSession()
  const [estimate, setEstimate] = useState<RefundEstimate | null>(null)
  const [history, setHistory] = useState<RefundSummary[]>([])
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  async function load(signal?: AbortSignal) {
    const [estimateResponse, historyResponse] = await Promise.all([
      fetch('/api/account/refunds/estimate', { signal }),
      fetch('/api/account/refunds', { signal }),
    ])
    const estimateData = await estimateResponse.json() as RefundEstimate & { error?: string }
    const historyData = await historyResponse.json() as { requests?: RefundSummary[]; error?: string }
    if (!estimateResponse.ok) throw new Error(estimateData.error || '读取退款信息失败')
    if (!historyResponse.ok) throw new Error(historyData.error || '读取退款记录失败')
    setEstimate(estimateData)
    setHistory(historyData.requests ?? [])
  }

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    void load(controller.signal).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '读取退款信息失败')
    })
    return () => controller.abort()
  }, [session])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!checked) { setError('请先阅读并同意服务协议与政策。'); return }
    setLoading(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/account/refunds', { method: 'POST' })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(data.error || '提交失败')
      setNotice('退款申请已提交。审核期间如有新的计费记录，最终退款金额会相应扣减。')
      setChecked(false)
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  if (isPending) {
    return (
      <AuthShell title="正在读取退款信息">
        <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted"><Spinner size="sm" /> 请稍候…</div>
      </AuthShell>
    )
  }
  if (!session) return <Navigate to="/sign-in" replace />
  const pending = estimate?.pending

  return (
    <AuthShell title="申请退款" description="仅退还未消耗的付费积分；审核时重新计算最终金额。" wide>
      <div className="grid gap-4">
        {error && <Notice kind="danger">{error}</Notice>}
        {notice && <Notice kind="success">{notice}</Notice>}
        {estimate ? (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-surface-secondary">
              <InfoRow label="可用积分">{estimate.balance}</InfoRow>
              <InfoRow label="可退付费积分">{estimate.refundable_credits}</InfoRow>
              <InfoRow label="预估可退金额">{money(estimate.estimated_cents)}</InfoRow>
            </div>
            <Notice kind="warning">
              <strong>关于预估金额</strong>
              <br />
              可退金额为截至当前的预估。审核期间如有新的计费记录，最终退款金额将按审核完成时的计费结果扣减。积分一经消耗不予退款；赠送积分不适用退款。一个账号同一时间仅允许一笔处理中的退款申请。
            </Notice>
            {estimate.lots.some(lot => lot.over_12m) && (
              <Notice kind="warning">
                部分订单已超过 12 个月，审核后无法自动原路退回，将转人工处理。请联系<a href="mailto:support@ljhsu.xin">客服邮箱</a>。
              </Notice>
            )}
            {pending ? (
              <Notice kind="accent">
                你有一笔退款正在处理中（{REFUND_STATUS[pending.status] || pending.status}，预估 {money(pending.estimated_cents)}）。完成前不能提交新的申请。
              </Notice>
            ) : (
              <form className="grid gap-3" onSubmit={submit}>
                <label className="flex items-start gap-2 text-xs leading-relaxed text-muted">
                  <input type="checkbox" className="mt-0.5" checked={checked} onChange={event => setChecked(event.target.checked)} />
                  <span>我已阅读并同意<TextLink href="/terms/refund">《服务协议与政策》</TextLink>，并理解可退金额为预估，审核期间新计费会从最终退款中扣减。</span>
                </label>
                <Button type="submit" fullWidth isDisabled={!checked || loading} isPending={loading}>
                  {({ isPending }) => <>{isPending ? <Spinner color="current" size="sm" /> : null}提交退款申请</>}
                </Button>
              </form>
            )}
            <p className="text-center text-sm text-muted">
              <TextLink href="/terms/refund">查看《服务协议与政策》</TextLink> · <TextLink href="/credits">返回积分</TextLink>
            </p>
            <section className="rounded-xl border border-border bg-surface-secondary p-4">
              <h2 className="mb-2 text-sm font-semibold">退款记录</h2>
              {history.length === 0 ? <p className="text-sm text-muted">暂无退款记录。</p> : (
                <div className="grid gap-2">
                  {history.map(item => (
                    <div key={item.id} className="border-b border-separator pb-2 text-sm last:border-b-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <strong>{REFUND_STATUS[item.status] || item.status}</strong>
                        <span className="text-xs text-muted">{shortDate(item.created_at)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        预估 {money(item.estimated_cents)} · 最终 {money(item.final_cents)}
                        {item.manual_cents > 0 ? ` · 人工 ${money(item.manual_cents)}` : ''}
                      </p>
                      {item.note && <p className="mt-1 text-xs text-muted">{item.note}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
            {estimate.lots.length > 0 && (
              <details className="text-sm text-muted">
                <summary className="cursor-pointer">查看可退订单</summary>
                <div className="mt-2 grid gap-2">
                  {estimate.lots.map(lot => (
                    <div key={lot.id} className="flex items-center justify-between gap-3 border-b border-separator pb-2 text-xs last:border-b-0 last:pb-0">
                      <span>{lot.app_id} · {lot.order_id}</span>
                      <span>{lot.remaining} 积分 · {money(lot.refund_cents)}{lot.over_12m ? ' · 超 12 个月' : ''}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        ) : !error ? (
          <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted"><Spinner size="sm" /> 正在读取…</div>
        ) : null}
      </div>
    </AuthShell>
  )
}

export function AdminRefunds() {
  const { data: session, isPending } = authClient.useSession()
  const [requests, setRequests] = useState<AdminRefund[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [statusFilter, setStatusFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [details, setDetails] = useState<Record<string, AdminRefundDetail>>({})
  const [openId, setOpenId] = useState('')
  const [detailLoading, setDetailLoading] = useState('')
  const [confirming, setConfirming] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [reconcile, setReconcile] = useState<AdminReconcileReport | null>(null)
  const [reconcileBusy, setReconcileBusy] = useState(false)
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]) 

  async function load(signal?: AbortSignal) {
    const query = new URLSearchParams()
    if (statusFilter) query.set('status', statusFilter)
    query.set('limit', String(PAGE_SIZE))
    query.set('offset', String(offset))
    const response = await fetch(`/api/admin/refunds?${query}`, { signal })
    const data = await response.json() as { requests?: AdminRefund[]; total?: number; counts?: Record<string, number>; error?: string }
    if (!response.ok) throw new Error(data.error || '读取退款申请失败')
    setRequests(data.requests ?? [])
    setTotal(data.total ?? 0)
    setCounts(data.counts ?? {})
  }

  async function loadReconcile(signal?: AbortSignal) {
    const response = await fetch('/api/admin/reconcile', { signal })
    const data = await response.json() as { report?: AdminReconcileReport | null; error?: string }
    if (!response.ok) throw new Error(data.error || '读取对账结果失败')
    setReconcile(data.report ?? null)
  }

  async function runReconcile() {
    setReconcileBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/admin/reconcile', { method: 'POST' })
      const data = await response.json().catch(() => ({})) as { mismatches?: number; expiredRefunds?: number; error?: string }
      if (!response.ok) throw new Error(data.error || '对账失败')
      setNotice(`对账完成：检查 ${data.expiredRefunds ?? 0} 条超时申请，${(data.mismatches ?? 0) === 0 ? '余额与台账一致' : `${data.mismatches} 处不一致`}。`)
      await Promise.all([loadReconcile(), load()])
    } catch (error) {
      setError(error instanceof Error ? error.message : '对账失败')
    } finally {
      setReconcileBusy(false)
    }
  }

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    void load(controller.signal).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '读取退款申请失败')
    })
    return () => controller.abort()
  }, [session, statusFilter, offset])

  async function loadAudit(signal?: AbortSignal) {
    const response = await fetch('/api/admin/audit?limit=20', { signal })
    const data = await response.json() as { entries?: AdminAuditEntry[]; error?: string }
    if (!response.ok) throw new Error(data.error || '读取审计记录失败')
    setAudit(data.entries ?? [])
  }

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    void loadReconcile(controller.signal).catch(() => { /* 对账结果只是辅助信息，失败不阻断列表。 */ })
    void loadAudit(controller.signal).catch(() => { /* 审计记录同理。 */ })
    return () => controller.abort()
  }, [session])

  async function toggleDetail(id: string) {
    if (openId === id) { setOpenId(''); return }
    setOpenId(id)
    if (details[id]) return
    setDetailLoading(id)
    setError('')
    try {
      const response = await fetch(`/api/admin/refunds/${encodeURIComponent(id)}`)
      const data = await response.json() as AdminRefundDetail & { error?: string }
      if (!response.ok) throw new Error(data.error || '读取退款明细失败')
      setDetails(current => ({ ...current, [id]: data }))
    } catch (error) {
      setOpenId('')
      setError(error instanceof Error ? error.message : '读取退款明细失败')
    } finally {
      setDetailLoading('')
    }
  }

  function startConfirm(id: string, action: 'approve' | 'reject') {
    setConfirming({ id, action })
    setNote('')
    setError('')
    setNotice('')
  }

  async function review() {
    if (!confirming) return
    const { id, action } = confirming
    if (action === 'reject' && !note.trim()) { setError('请填写拒绝原因。'); return }
    setBusy(id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/admin/refunds/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim() }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string; request?: { status?: string; final_cents?: number } }
      if (!response.ok) throw new Error(data.error || '审核失败')
      const status = data.request?.status || ''
      const amount = typeof data.request?.final_cents === 'number' ? money(data.request.final_cents) : ''
      if (action === 'reject') setNotice('已拒绝该退款申请。')
      else if (status === 'failed') setNotice('审核已完成，但有订单退款失败。可修复后再次点击「通过并退款」重试失败项，已退款项不会重复处理。')
      else if (status === 'rejected') setNotice('审核完成：可退金额不足 0.01 元，已拒绝并关闭本次申请。')
      else setNotice(`审核已提交，退款 ${amount} 已处理；超过 12 个月的订单转人工跟进。`)
      setConfirming(null)
      setNote('')
      setDetails(current => { const next = { ...current }; delete next[id]; return next })
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : '审核失败')
    } finally {
      setBusy('')
    }
  }

  if (isPending) {
    return (
      <AuthShell title="正在读取退款审核">
        <div className="flex items-center justify-center gap-2.5 py-6 text-sm text-muted"><Spinner size="sm" /> 请稍候…</div>
      </AuthShell>
    )
  }
  if (!session) return <Navigate to="/sign-in" replace />
  if ((session.user as { role?: string }).role !== 'admin') {
    return (
      <AuthShell title="无权限" description="只有管理员可以审核退款。">
        <p className="text-center text-sm text-muted"><TextLink href="/account">返回账户</TextLink></p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="退款审核" description="按审核时余额计算最终退款金额；金额确认后不可撤销。" wide>
      <div className="grid gap-3">
        {error && <Notice kind="danger">{error}</Notice>}
        {notice && <Notice kind="success">{notice}</Notice>}
        <section className="rounded-xl border border-border bg-surface-secondary p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">对账</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {reconcile
                  ? `上次对账 ${shortDate(reconcile.createdAt)}（${reconcile.detail?.trigger === 'manual' ? '手动' : '定时'}）：检查 ${reconcile.usersChecked} 个账号，${reconcile.mismatches === 0 ? '余额与台账一致' : `${reconcile.mismatches} 处不一致`}，失效申请 ${reconcile.expiredRefunds} 条`
                  : '还没有对账记录，每天 11:23 自动跑一次。'}
              </p>
            </div>
            <Button variant="outline" isDisabled={reconcileBusy} isPending={reconcileBusy} onPress={() => void runReconcile()}>立即对账</Button>
          </div>
          {reconcile && reconcile.mismatches > 0 && (
            <div className="mt-2 grid gap-1 border-t border-separator pt-2 text-xs text-muted">
              {(reconcile.detail?.balanceMismatches ?? []).map(row => (
                <p key={row.userId}>账号 {row.userId.slice(0, 8)}…：余额 {row.balance} ≠ 台账 {row.ledger}</p>
              ))}
              {(reconcile.detail?.invalidLots ?? []).map(row => (
                <p key={row.lotId}>订单 {row.lotId.slice(0, 8)}…：剩余 {row.remaining} / 总额 {row.credits}</p>
              ))}
            </div>
          )}
        </section>
        <div className="flex flex-wrap gap-2">
          {REFUND_FILTERS.map(([value, label]) => (
            <Button
              key={value || 'all'}
              variant={statusFilter === value ? 'secondary' : 'outline'}
              onPress={() => { setStatusFilter(value); setOffset(0) }}
            >
              {label}{value ? ` ${counts[value] ?? 0}` : ` ${Object.values(counts).reduce((sum, count) => sum + count, 0)}`}
            </Button>
          ))}
        </div>
        {requests.length === 0 ? <p className="text-sm text-muted">暂无退款申请。</p> : requests.map(item => {
          const detail = details[item.id]
          const isOpen = openId === item.id
          const confirmingThis = confirming?.id === item.id ? confirming.action : null
          const userLabel = item.user_email || item.user_name || `已注销账号 ${item.user_id.slice(0, 8)}…`
          return (
            <section key={item.id} className="rounded-xl border border-border bg-surface-secondary p-4">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-sm">{userLabel}</strong>
                  <p className="mt-1 text-xs text-muted">{shortDate(item.created_at)} · {item.kind === 'platform' ? '平台原因' : '用户申请'}</p>
                </div>
                <Chip size="sm" color={item.status === 'completed' ? 'success' : ['failed', 'rejected', 'expired'].includes(item.status) ? 'danger' : 'warning'}>
                  {REFUND_STATUS[item.status] || item.status}
                </Chip>
              </header>
              <p className="mt-2 text-xs text-muted">
                预估 {money(item.estimated_cents)} · 最终 {money(item.final_cents)}
                {item.manual_cents > 0 ? ` · 人工 ${money(item.manual_cents)}` : ''}
              </p>
              {item.note && <p className="mt-1 text-xs text-muted">{item.note}</p>}
              {['pending', 'reviewing', 'failed'].includes(item.status) && (
                <div className="mt-3 grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" fullWidth isDisabled={!!busy} onPress={() => void toggleDetail(item.id)} isPending={detailLoading === item.id}>
                      {isOpen ? '收起明细' : '查看明细'}
                    </Button>
                    <Button variant="secondary" fullWidth isDisabled={!!busy} onPress={() => startConfirm(item.id, 'approve')}>
                      {item.status === 'failed' ? '重试失败项' : '通过并退款'}
                    </Button>
                  </div>
                  <Button variant="outline" fullWidth isDisabled={!!busy} onPress={() => startConfirm(item.id, 'reject')}>拒绝</Button>
                </div>
              )}
              {isOpen && (
                <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                  <h3 className="mb-2 text-xs font-semibold">订单明细</h3>
                  {!detail ? (
                    <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted"><Spinner size="sm" /> 正在读取…</div>
                  ) : detail.items.length === 0 ? (
                    <p className="text-xs text-muted">没有可退订单明细。</p>
                  ) : (
                    <div className="grid gap-2">
                      {detail.items.map(line => (
                        <div key={line.id} className="border-b border-separator pb-2 text-xs last:border-b-0 last:pb-0">
                          <div className="flex items-center justify-between gap-2">
                            <strong>{line.app_id} · {line.order_id}</strong>
                            <span className="text-muted">{REFUND_ITEM_STATUS[line.status] || line.status}</span>
                          </div>
                          <p className="mt-1 text-muted">
                            支付 {shortDate(line.paid_at)} · 原 {line.credits} 积分 / {money(line.amount_cents)}
                            {' · '}本次 {line.final_credits} 积分 / {money(line.final_cents)}
                          </p>
                          {line.provider_ref && <p className="mt-0.5 text-muted">渠道单号 {line.provider_ref}</p>}
                          {line.message && <p className="mt-0.5 text-muted">{line.message}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {confirmingThis && (
                <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                  <p className="text-xs leading-relaxed">
                    {confirmingThis === 'approve'
                      ? `确认对 ${userLabel} 发起退款？最终金额会在提交后按审核时的余额重算（预估 ${money(item.estimated_cents)}，可能因期间新计费而减少），超过 12 个月的订单转人工处理。`
                      : `确认拒绝 ${userLabel} 的退款申请？拒绝后该申请不可恢复。`}
                  </p>
                  <label className="mt-2 block text-xs text-muted">
                    {confirmingThis === 'approve' ? '审核备注（可选）' : '拒绝原因（必填）'}
                    <textarea
                      className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm"
                      rows={2}
                      value={note}
                      onChange={event => setNote(event.target.value)}
                      placeholder={confirmingThis === 'approve' ? '例如：用户申请全额退款' : '例如：积分已消耗，不符合退款条件'}
                    />
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button variant="secondary" fullWidth isDisabled={!!busy} isPending={busy === item.id} onPress={() => void review()}>
                      {confirmingThis === 'approve' ? '确认退款' : '确认拒绝'}
                    </Button>
                    <Button variant="outline" fullWidth isDisabled={!!busy} onPress={() => { setConfirming(null); setNote('') }}>取消</Button>
                  </div>
                </div>
              )}
            </section>
          )
        })}
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span>共 {total} 条，当前第 {total === 0 ? 0 : Math.floor(offset / PAGE_SIZE) + 1} 页</span>
          <div className="flex gap-2">
            <Button variant="outline" isDisabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
            <Button variant="outline" isDisabled={offset + PAGE_SIZE >= total} onPress={() => setOffset(offset + PAGE_SIZE)}>下一页</Button>
          </div>
        </div>
        <details className="rounded-xl border border-border bg-surface-secondary p-4 text-sm">
          <summary className="cursor-pointer text-sm font-semibold">操作审计（最近 20 条）</summary>
          {audit.length === 0 ? <p className="mt-2 text-xs text-muted">暂无记录。</p> : (
            <div className="mt-2 grid gap-1.5 text-xs text-muted">
              {audit.map(entry => (
                <p key={entry.id}>
                  {shortDate(entry.createdAt)} · {AUDIT_LABELS[entry.action] || entry.action} · {entry.target || '—'} · {entry.actor}
                </p>
              ))}
            </div>
          )}
        </details>
        <p className="mt-2 text-center text-sm text-muted"><TextLink href="/account">返回账户</TextLink></p>
      </div>
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

