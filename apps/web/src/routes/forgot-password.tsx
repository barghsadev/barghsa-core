import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { Button, Input, Label, Alert, AlertDescription } from '@barghsa/ui'
import { AuthLayout } from '../components/AuthLayout.js'
import { PasswordField } from '../components/PasswordField.js'
import { useLocale } from '../hooks/useLocale.js'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage })

// ─── Iranian mobile number helpers ──────────────────────────────────────

/** Regex: starts with 09, followed by exactly 9 digits (11 total) */
const IRANIAN_MOBILE_RE = /^09\d{9}$/

/** Regex: basic email validation */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Regex: loose E.164 — starts with +, 7-15 digits */
const E164_RE = /^\+[1-9]\d{6,14}$/

type UsernameType = 'email' | 'mobile' | 'international' | null

interface NormalizationResult {
  type: UsernameType
  normalized: string
  formatted: string | null
}

/**
 * Detect the type of the raw input and normalize it.
 * Returns { type, normalized, formatted }.
 * - type=null means invalid/unrecognised.
 * - formatted is the display-friendly version (e.g. "+98 912 123 4567").
 */
function normalizeUsername(raw: string): NormalizationResult {
  const trimmed = raw.trim()

  // Iranian mobile: 09121234567 → +989****4567
  if (IRANIAN_MOBILE_RE.test(trimmed)) {
    const e164 = `+98${trimmed.slice(1)}`
    const groups = e164.match(/^(\+\d{2})(\d{3})(\d{3})(\d{4})$/)
    const formatted = groups
      ? `${groups[1]} ${groups[2]} ${groups[3]} ${groups[4]}`
      : e164
    return { type: 'mobile', normalized: e164, formatted }
  }

  // International (already E.164)
  if (trimmed.startsWith('+')) {
    if (E164_RE.test(trimmed)) {
      return { type: 'international', normalized: trimmed, formatted: null }
    }
    return { type: null, normalized: trimmed, formatted: null }
  }

  // Email
  if (EMAIL_RE.test(trimmed)) {
    return { type: 'email', normalized: trimmed.toLowerCase(), formatted: null }
  }

  return { type: null, normalized: trimmed, formatted: null }
}

/** Mask a destination for display (e.g. m***@example.com or +98***4567) */
function maskDestination(destination: string): string {
  if (destination.startsWith('+')) {
    // Phone: show +98 *** 4567
    const parts = destination.match(/^(\+\d{2,3})(\d*)(\d{4})$/)
    if (parts) {
      return `${parts[1]} *** ${parts[3]}`
    }
    return destination.replace(/.(?=.{4})/g, '*')
  }
  // Email: m***@example.com
  const parts = destination.split('@')
  if (parts.length === 2) {
    const name = parts[0]!
    return `${name[0]!}***@${parts[1]}`
  }
  return destination.replace(/.(?=.{4})/g, '*')
}

function ForgotPasswordPage() {
  const locale = useLocale()
  const [username, setUsername] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [complete, setComplete] = useState(false)
  const normalized = normalizeUsername(username)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function request(path: string, payload: unknown): Promise<Record<string, unknown> | null> {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (response.ok) return body
    const raw = body.error
    const code = typeof raw === 'string' ? raw : (raw as { code?: string } | undefined)?.code
    const messages: Record<string, string> = {
      'AUTH:OTP:INVALID': 'auth.otp.error.invalid',
      'AUTH:OTP:EXPIRED': 'auth.otp.error.expired',
      'AUTH:OTP:CONSUMED': 'auth.otp.error.consumed',
      'AUTH:OTP:MAX_ATTEMPTS': 'auth.otp.error.maxAttempts',
      'AUTH:REGISTER:WEAK_PASSWORD': 'auth.register.passwordRequirements',
      'AUTH:LOGIN:PASSWORD_REUSED': 'auth.login.error.passwordReused',
      'AUTH:DELIVERY:UNAVAILABLE': 'auth.otp.error.deliveryUnavailable',
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'))
      setCooldown(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60)
      setError(t('auth.forgotPassword.error.rateLimited', locale))
    } else {
      setError(t(messages[code ?? ''] ?? 'auth.forgotPassword.error.generic', locale))
    }
    return null
  }

  async function start(event?: FormEvent) {
    event?.preventDefault()
    if (busy || cooldown > 0 || !normalized.type) return
    setBusy(true)
    setError(null)
    try {
      const body = await request('forgot-password', { username: normalized.normalized })
      if (!body) return
      if (typeof body.challengeId !== 'string' || !body.challengeId) throw new Error('Missing challenge')
      setChallengeId(body.challengeId)
      setOtp('')
      setCooldown(60)
    } catch { setError(t('auth.forgotPassword.error.generic', locale)) }
    finally { setBusy(false) }
  }

  async function reset(event: FormEvent) {
    event.preventDefault()
    if (busy || !/^\d{6}$/.test(otp)) return
    if (password !== confirmation) { setError(t('auth.resetPassword.mismatch', locale)); return }
    setBusy(true)
    setError(null)
    try {
      const body = await request('reset-password', { challengeId, otp, newPassword: password })
      if (!body) return
      setOtp('')
      setPassword('')
      setConfirmation('')
      setChallengeId('')
      setComplete(true)
    } catch { setError(t('auth.forgotPassword.error.generic', locale)) }
    finally { setBusy(false) }
  }

  const validPassword = password.length >= 8 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
  return (
    <AuthLayout locale={locale} footer={<Link to="/login" className="text-sm text-primary underline">{t('auth.forgotPassword.backToLogin', locale)}</Link>}>
      <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <h1 className="text-xl font-semibold">{t(complete ? 'auth.resetPassword.success' : challengeId ? 'auth.resetPassword.title' : 'auth.forgotPassword.title', locale)}</h1>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {complete ? <p role="status">{t('auth.resetPassword.signIn', locale)}</p> : challengeId ? (
          <form onSubmit={reset} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('auth.forgotPassword.sent', locale)}</p>
            <p className="text-sm" dir="ltr">{maskDestination(normalized.normalized)}</p>
            <div className="space-y-2">
              <Label htmlFor="reset-otp">{t('auth.otp.inputLabel', locale)}</Label>
              <Input id="reset-otp" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} autoFocus
                value={otp} onChange={event => setOtp(event.target.value.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/\D/g, ''))} disabled={busy} />
            </div>
            <PasswordField id="new-password" label={t('auth.resetPassword.newPassword', locale)} locale={locale} value={password} onChange={setPassword} disabled={busy} />
            <PasswordField id="confirm-password" label={t('auth.resetPassword.confirmPassword', locale)} locale={locale} value={confirmation} onChange={setConfirmation} showStrength={false} disabled={busy} />
            <Button type="submit" className="w-full" disabled={busy || otp.length !== 6 || !validPassword || !confirmation}>
              {t(busy ? 'auth.resetPassword.submitting' : 'auth.resetPassword.submit', locale)}
            </Button>
            <Button type="button" variant="ghost" className="w-full" disabled={busy || cooldown > 0} onClick={() => void start()}>
              {cooldown > 0 ? t('auth.otp.resendTimer', locale).replace('{seconds}', String(cooldown)) : t('auth.otp.resend', locale)}
            </Button>
          </form>
        ) : (
          <form onSubmit={start} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('auth.register.emailLabel', locale)}</Label>
              <Input id="username" autoComplete="username" autoFocus maxLength={255} value={username} onChange={event => setUsername(event.target.value)} disabled={busy} />
            </div>
            <Button type="submit" className="w-full" disabled={busy || !normalized.type || cooldown > 0}>
              {t(busy ? 'auth.forgotPassword.submitting' : 'auth.forgotPassword.submit', locale)}
            </Button>
            {cooldown > 0 && <p role="status">{t('auth.otp.resendTimer', locale).replace('{seconds}', String(cooldown))}</p>}
          </form>
        )}
      </div>
    </AuthLayout>
  )
}
