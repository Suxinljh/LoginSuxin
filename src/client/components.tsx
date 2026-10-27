import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
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

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">S</span>
      <span className="brand-name">Suxin</span>
    </div>
  )
}

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="auth-page">
      <div className="auth-atmosphere" aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
      </div>
      <main className="auth-card">
        <Brand />
        <div className="auth-heading">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {children}
      </main>
      <footer className="auth-footer">{footer ?? '一个账号，登录所有应用。'}</footer>
    </div>
  )
}

export function Alert({ kind = 'info', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
}

export function TextField({ label, hint, id, ...props }: TextFieldProps) {
  const inputId = id || `field-${label.replace(/\s+/g, '-')}`
  return (
    <label className="field" htmlFor={inputId}>
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      <input id={inputId} {...props} />
    </label>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  variant?: 'primary' | 'secondary'
}

export function Button({ loading, variant = 'primary', className = '', children, ...props }: ButtonProps) {
  return (
    <button
      className={`button ${variant === 'secondary' ? 'secondary' : ''} ${className}`.trim()}
      {...props}
      disabled={props.disabled || loading}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

export function Divider() {
  return (
    <div className="divider" role="separator">
      <span>或</span>
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
      <div className="social-row">
        {providers.github && (
          <button type="button" className="social-button" onClick={() => signIn('github')} disabled={loading !== null}>
            {loading === 'github' ? <Spinner /> : <GithubIcon />}
            GitHub
          </button>
        )}
        {providers.google && (
          <button type="button" className="social-button" onClick={() => signIn('google')} disabled={loading !== null}>
            {loading === 'google' ? <Spinner /> : <GoogleIcon />}
            Google
          </button>
        )}
      </div>
    </>
  )
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.88-3c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  )
}
