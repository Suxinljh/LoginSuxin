import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Card, Chip, Description, Input, Label, Link, Separator, Spinner, TextField } from '@heroui/react'
import { authClient } from './auth-client'

export function errorText(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return '操作失败，请稍后重试。'
}

export function Brand() {
  return (
    <div className="flex items-center">
      <img src="/brand/logo-name.png" alt="Suxin" className="h-8 w-auto dark:hidden" />
      <img src="/brand/logo-name-white.png" alt="Suxin" className="hidden h-8 w-auto dark:block" />
    </div>
  )
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  wide = false,
  wider = false,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  wider?: boolean
}) {
  const width = wider ? 'max-w-[860px]' : wide ? 'max-w-[520px]' : 'max-w-[420px]'
  return (
    <div className="auth-page flex min-h-dvh flex-col items-center justify-center gap-5 px-4 py-10">
      <Card className={`w-full ${width} gap-0 p-7 sm:p-8`}>
        <Brand />
        <div className="mt-6 mb-6">
          <h1 className="text-[26px] leading-tight font-bold tracking-tight sm:text-[27px]">{title}</h1>
          {description && <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>}
        </div>
        {children}
      </Card>
      <p className="text-center text-xs leading-relaxed text-muted">{footer ?? 'Suxin 统一账号 · account.ljhsu.xin'}</p>
    </div>
  )
}

export function Notice({ kind = 'accent', children }: { kind?: 'accent' | 'success' | 'danger' | 'warning'; children: ReactNode }) {
  return (
    <Alert status={kind}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
    </Alert>
  )
}

export function FormField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  name,
  placeholder,
  autoComplete,
  minLength,
  isRequired = true,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  type?: string
  name?: string
  placeholder?: string
  autoComplete?: string
  minLength?: number
  isRequired?: boolean
}) {
  return (
    <TextField
      className="w-full"
      name={name}
      type={type}
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      autoComplete={autoComplete}
      minLength={minLength}
    >
      <Label>{label}</Label>
      <Input placeholder={placeholder} />
      {hint && <Description>{hint}</Description>}
    </TextField>
  )
}

export function SubmitButton({ loading, children, variant = 'primary' }: { loading?: boolean; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Button type="submit" fullWidth variant={variant} isPending={loading}>
      {({ isPending }) => (
        <>
          {isPending ? <Spinner color="current" size="sm" /> : null}
          {children}
        </>
      )}
    </Button>
  )
}

export function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted">
      <Separator className="flex-1" />
      <span>或</span>
      <Separator className="flex-1" />
    </div>
  )
}

export function SocialButtons({ onError }: { onError: (message: string) => void }) {
  const [loading, setLoading] = useState<'github' | 'google' | null>(null)
  const [providers, setProviders] = useState<{ github: boolean; google: boolean } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/providers', { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (data) setProviders(data as { github: boolean; google: boolean })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  async function signIn(provider: 'github' | 'google') {
    setLoading(provider)
    onError('')
    try {
      const { data, error } = await authClient.signIn.social({ provider })
      if (error) {
        onError(errorText(error))
        setLoading(null)
        return
      }
      if (data?.url) window.location.href = data.url
    } catch (error) {
      onError(errorText(error))
      setLoading(null)
    }
  }

  if (!providers || (!providers.github && !providers.google)) return null

  return (
    <>
      <Divider />
      <div className="grid grid-cols-2 gap-2.5">
        {providers.github && (
          <Button variant="outline" fullWidth onPress={() => signIn('github')} isDisabled={loading !== null}>
            {loading === 'github' ? <Spinner color="current" size="sm" /> : <GithubIcon />}
            GitHub
          </Button>
        )}
        {providers.google && (
          <Button variant="outline" fullWidth onPress={() => signIn('google')} isDisabled={loading !== null}>
            {loading === 'google' ? <Spinner color="current" size="sm" /> : <GoogleIcon />}
            Google
          </Button>
        )}
      </div>
    </>
  )
}

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (id?: string) => void
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let turnstileLoader: Promise<TurnstileApi | null> | null = null

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (!turnstileLoader) {
    turnstileLoader = new Promise<TurnstileApi | null>(resolve => {
      const existing = (window as { turnstile?: TurnstileApi }).turnstile
      if (existing) { resolve(existing); return }
      const script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT
      script.async = true
      script.defer = true
      script.onload = () => resolve((window as { turnstile?: TurnstileApi }).turnstile ?? null)
      // 被拦截或加载失败时不阻塞提交：服务端校验失败会给明确提示。
      script.onerror = () => resolve(null)
      document.head.appendChild(script)
    })
  }
  return turnstileLoader
}

/** 拉取 Turnstile site key；未配置（null）时不渲染 widget，也不带 token。 */
export function useTurnstileSiteKey(): string | null {
  const [siteKey, setSiteKey] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/providers', { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        const value = (data as { turnstile?: unknown } | null)?.turnstile
        if (typeof value === 'string' && value) setSiteKey(value)
      })
      .catch(() => { /* 拿不到 site key 时按未启用处理。 */ })
    return () => controller.abort()
  }, [])
  return siteKey
}

export function TurnstileWidget({ siteKey, onToken }: { siteKey: string | null; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement | null>(null)
  const callback = useRef(onToken)
  useEffect(() => { callback.current = onToken }, [onToken])

  useEffect(() => {
    if (!siteKey || !container.current) return
    let widgetId: string | undefined
    let cancelled = false
    void loadTurnstile().then(api => {
      if (!api || cancelled || !container.current) return
      widgetId = api.render(container.current, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible',
        callback: (token: string) => callback.current(token),
        'expired-callback': () => callback.current(''),
        'error-callback': () => callback.current(''),
      })
    })
    return () => {
      cancelled = true
      if (widgetId) (window as { turnstile?: TurnstileApi }).turnstile?.remove(widgetId)
    }
  }, [siteKey])

  if (!siteKey) return null
  return <div ref={container} className="flex justify-center" />
}

export function StatusChip({ verified }: { verified: boolean }) {
  return <Chip color={verified ? 'success' : 'warning'}>{verified ? '邮箱已验证' : '邮箱未验证'}</Chip>
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href}>{children}</Link>
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.88-3c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  )
}
