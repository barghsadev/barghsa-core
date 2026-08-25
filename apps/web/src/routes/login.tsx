import { useState, useCallback } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import { Loader2Icon } from 'lucide-react'
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'
import { AuthLayout } from '../components/AuthLayout.js'
import { PasswordField } from '../components/PasswordField.js'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

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

// ─── Error code → i18n key mapping ────────────────────────────────────

const ERROR_CODE_I18N_MAP: Record<string, string> = {
  'AUTH:LOGIN:INVALID_CREDENTIALS': 'auth.login.error.invalidCredentials',
  'RATE_LIMIT:EXCEEDED': 'auth.register.error.rateLimited',
  'INTERNAL:UNEXPECTED': 'auth.login.error.internal',
  'INTERNAL:SERVER_ERROR': 'auth.login.error.internal',
}

function resolveErrorMessage(errorCode: string | undefined, locale: Locale): string {
  if (errorCode && ERROR_CODE_I18N_MAP[errorCode]) {
    return t(ERROR_CODE_I18N_MAP[errorCode], locale)
  }
  return t('auth.login.error.generic', locale)
}

// ─── Page component ──────────────────────────────────────────────────────

function LoginPage() {
  const router = useRouter()
  const locale: Locale = 'fa' // TODO: read from user preference / locale context

  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameType, setUsernameType] = useState<UsernameType>(null)
  const [formattedHint, setFormattedHint] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // Submission state
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const isUsernameValid = touched && usernameError === null && usernameType !== null

  const handleBlur = useCallback(() => {
    setTouched(true)
    const result = normalizeUsername(username)

    if (!username.trim()) {
      setUsernameError(t('error.validation.input.missing', locale))
      setUsernameType(null)
      setFormattedHint(null)
      return
    }

    if (result.type === null) {
      setUsernameError(t('auth.register.invalidUsername', locale))
      setUsernameType(null)
      setFormattedHint(null)
      return
    }

    if (result.type === 'email' && !EMAIL_RE.test(result.normalized)) {
      setUsernameError(t('auth.register.invalidEmail', locale))
      setUsernameType(null)
      setFormattedHint(null)
      return
    }

    // Valid
    setUsernameError(null)
    setUsernameType(result.type)
    setFormattedHint(result.formatted)
  }, [username, locale])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val.length > 255) return
    setUsername(val)
    if (touched) {
      // Re-validate on change after first blur
      const result = normalizeUsername(val)
      if (!val.trim()) {
        setUsernameError(t('error.validation.input.missing', locale))
        setUsernameType(null)
        setFormattedHint(null)
      } else if (result.type === null) {
        setUsernameError(t('auth.register.invalidUsername', locale))
        setUsernameType(null)
        setFormattedHint(null)
      } else {
        setUsernameError(null)
        setUsernameType(result.type)
        setFormattedHint(result.formatted)
      }
    }
  }, [touched, locale])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    // ── Normalize username for the API ───────────────────────────────
    const normalized = normalizeUsername(username)
    if (!normalized.type) {
      setFormError(t('auth.login.error.invalidCredentials', locale))
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalized.normalized,
          password,
        }),
      })

      const body: Record<string, unknown> =
        await response.json().catch(() => ({}))

      if (!response.ok) {
        const rawError = body?.error
        const errorCode = typeof rawError === 'string' ? rawError : (rawError as Record<string, unknown>)?.code as string | undefined
        const msg = resolveErrorMessage(errorCode, locale)
        setFormError(msg)
        toast.error(msg)
        return
      }

      // ── Success ─────────────────────────────────────────────
      const msg = t('auth.login.success', locale)
      toast.success(msg)

      // TODO: Navigate to app dashboard once route exists
      router.navigate({ to: '/' })
    } catch (_err) {
      // Network error or unexpected failure
      const msg = t('auth.login.error.generic', locale)
      setFormError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }, [username, password, locale, router])

  const isFormReady = isUsernameValid && password.length > 0 && !submitting

  return (
    <AuthLayout
      locale={locale}
      footer={
        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.login.registerLink', locale)}{' '}
            <Link
              to="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
              aria-label={t('auth.login.registerLinkLabel', locale)}
            >
              {t('auth.login.registerLinkLabel', locale)}
            </Link>
          </p>
          <p className="text-center text-sm">
            <Link
              to="/forgot-password"
              className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
              aria-label={t('auth.register.forgotPasswordLabel', locale)}
            >
              {t('auth.register.forgotPasswordLink', locale)}
            </Link>
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('auth.login.title', locale)}
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          noValidate
        >
          {/* Form-level alert for server errors */}
          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertTitle className="sr-only">Error</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {/* Unified username field */}
          <div className="space-y-2">
            <Label htmlFor="username">
              {t('auth.register.emailLabel', locale)}
            </Label>
            <Input
              id="username"
              type="text"
              placeholder={t('auth.register.usernamePlaceholder', locale)}
              autoComplete="username"
              autoFocus
              maxLength={255}
              value={username}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={submitting}
              aria-invalid={touched && usernameError !== null}
              aria-describedby={
                usernameError
                  ? 'username-error'
                  : formattedHint
                    ? 'username-hint'
                    : undefined
              }
            />
            {/* Error message */}
            {touched && usernameError && (
              <p
                id="username-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {usernameError}
              </p>
            )}
            {/* Formatted mobile hint */}
            {touched && !usernameError && formattedHint && (
              <p
                id="username-hint"
                className="text-sm text-muted-foreground"
              >
                {formattedHint}
              </p>
            )}
          </div>

          {/* Password field with visibility toggle (no strength meter) */}
          {isUsernameValid && (
            <PasswordField
              id="password"
              label={t('auth.register.passwordLabel', locale)}
              locale={locale}
              autoFocus={false}
              value={password}
              onChange={setPassword}
              disabled={submitting}
              showStrength={false}
              autoComplete="current-password"
            />
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={!isFormReady}
          >
            {submitting ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t('auth.login.submitting', locale)}
              </>
            ) : (
              t('auth.login.submit', locale)
            )}
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}