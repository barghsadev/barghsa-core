import { useState, useCallback, useRef, useEffect } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import { Loader2Icon } from 'lucide-react'
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'
import { AuthLayout } from '../components/AuthLayout.js'
import { OtpInput } from '../components/OtpInput.js'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
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

// ─── Error code → i18n key mapping ────────────────────────────────────

const ERROR_CODE_I18N_MAP: Record<string, string> = {
  'RATE_LIMIT:EXCEEDED': 'auth.forgotPassword.error.rateLimited',
  'INTERNAL:UNEXPECTED': 'auth.forgotPassword.error.generic',
  'INTERNAL:SERVER_ERROR': 'auth.forgotPassword.error.generic',
}

function resolveErrorMessage(errorCode: string | undefined, locale: Locale): string {
  if (errorCode && ERROR_CODE_I18N_MAP[errorCode]) {
    return t(ERROR_CODE_I18N_MAP[errorCode], locale)
  }
  return t('auth.forgotPassword.error.generic', locale)
}

// ─── Page component ──────────────────────────────────────────────────────

function ForgotPasswordPage() {
  const router = useRouter()
  const locale: Locale = 'fa' // TODO: read from user preference / locale context

  // ── Forgot-password form state ──────────────────────────
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameType, setUsernameType] = useState<UsernameType>(null)
  const [formattedHint, setFormattedHint] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // ── OTP step state ─────────────────────────────────────
  const [otpStep, setOtpStep] = useState(false)
  const [challengeId, setChallengeId] = useState('')
  const [otpDestination, setOtpDestination] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendTimer, setResendTimer] = useState(60)
  const [canResend, setCanResend] = useState(false)
  const otpRef = useRef<{ reset: () => void } | null>(null)

  // Countdown timer for resend
  useEffect(() => {
    if (!otpStep || canResend) return

    const interval = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          setCanResend(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [otpStep, canResend])

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
      setFormError(t('auth.forgotPassword.error.generic', locale))
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalized.normalized,
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

      // ── Generic success — show OTP input ─────────────────────────
      const destination = normalized.normalized.startsWith('+')
        ? normalized.formatted || normalized.normalized
        : normalized.normalized

      setOtpDestination(maskDestination(destination))

      // Show OTP step — the challengeId is not returned from the
      // forgot-password API (it's always generic), so we wait for
      // the user to receive the OTP and then enter it.
      // The OTP verification happens via the /register/verify or
      // dedicated reset-password endpoint (T-02.03.02).
      // For T-02.03.01, we show the OTP input inline and the
      // auto-submit will navigate to the reset-password page.
      toast.success(t('auth.forgotPassword.sent', locale))
      setOtpStep(true)
      setResendTimer(60)
      setCanResend(false)

      // We store the normalized username to pass to the reset page
      setChallengeId(normalized.normalized)
    } catch (_err) {
      // Network error or unexpected failure
      const msg = t('auth.forgotPassword.error.generic', locale)
      setFormError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }, [username, locale])

  // ── OTP verification callbacks ──────────────────────────────────────────

  const handleOtpComplete = useCallback(
    async (code: string) => {
      setOtpCode(code)
      setOtpError(null)
      setVerifying(true)

      try {
        // Navigate to the reset-password page with challenge info
        // The actual OTP verification happens in T-02.03.02
        const destination = otpDestination

        router.navigate({
          to: '/reset-password',
          search: {
            username: challengeId,
            otp: code,
            destination,
          },
        })
      } catch {
        setOtpError(t('auth.otp.error.generic', locale))
        setOtpCode('')
        if (otpRef.current?.reset) {
          otpRef.current.reset()
        }
      } finally {
        setVerifying(false)
      }
    },
    [challengeId, otpDestination, locale, router],
  )

  const handleResend = useCallback(async () => {
    if (!canResend || resending) return

    setResending(true)
    setOtpError(null)

    try {
      // Re-submit the forgot-password request (same endpoint)
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: challengeId,
        }),
      })

      if (!response.ok) {
        toast.error(t('auth.otp.error.resend', locale))
        return
      }

      // Reset timer
      setResendTimer(60)
      setCanResend(false)
      setOtpCode('')
      if (otpRef.current?.reset) {
        otpRef.current.reset()
      }
      toast.success(t('auth.otp.sentTo', locale).replace('{destination}', otpDestination))
    } catch {
      toast.error(t('auth.otp.error.resend', locale))
    } finally {
      setResending(false)
    }
  }, [challengeId, canResend, resending, locale, otpDestination])

  const handleBackToLogin = useCallback(() => {
    setOtpStep(false)
    setOtpError(null)
    setFormError(null)
  }, [])

  const handleOtpClearError = useCallback(() => {
    setOtpError(null)
  }, [])

  const isFormReady = isUsernameValid && !submitting

  // ── Render: OTP step ─────────────────────────────────────────────────────

  if (otpStep) {
    return (
      <AuthLayout
        locale={locale}
        footer={
          <div className="space-y-2">
            <p className="text-center text-sm">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                aria-label={t('auth.forgotPassword.backToLogin', locale)}
              >
                {t('auth.forgotPassword.backToLogin', locale)}
              </button>
            </p>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {t('auth.forgotPassword.otpTitle', locale)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('auth.forgotPassword.otpSentTo', locale).replace('{destination}', otpDestination)}
            </p>
          </div>

          <div className="space-y-6">
            {/* OTP Input */}
            <OtpInput
              ref={otpRef}
              locale={locale}
              disabled={verifying}
              error={otpError}
              onComplete={handleOtpComplete}
              onClearError={handleOtpClearError}
            />

            {/* Verify button (disabled when OTP not yet entered) */}
            <Button
              type="button"
              className="w-full"
              disabled={!otpCode || verifying}
              onClick={() => otpCode && handleOtpComplete(otpCode)}
            >
              {verifying ? (
                <>
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('auth.otp.verifying', locale)}
                </>
              ) : (
                t('auth.otp.verifyButton', locale)
              )}
            </Button>

            {/* Resend section */}
            <div className="text-center">
              {canResend ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={resending}
                  onClick={handleResend}
                >
                  {resending ? (
                    <>
                      <Loader2Icon className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" />
                      {t('auth.otp.resending', locale)}
                    </>
                  ) : (
                    t('auth.otp.resend', locale)
                  )}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('auth.otp.resendTimer', locale).replace('{seconds}', String(resendTimer))}
                </p>
              )}
            </div>
          </div>
        </div>
      </AuthLayout>
    )
  }

  // ── Render: Forgot-password form ─────────────────────────────────────────

  return (
    <AuthLayout
      locale={locale}
      footer={
        <div className="space-y-2">
          <p className="text-center text-sm">
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
              aria-label={t('auth.forgotPassword.backToLogin', locale)}
            >
              {t('auth.forgotPassword.backToLogin', locale)}
            </Link>
          </p>
          <p className="text-center text-sm">
            <Link
              to="/"
              className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
              aria-label={t('auth.forgotPassword.helpLink', locale)}
            >
              {t('auth.forgotPassword.helpLink', locale)}
            </Link>
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('auth.forgotPassword.title', locale)}
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

          <Button
            type="submit"
            className="w-full"
            disabled={!isFormReady}
          >
            {submitting ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t('auth.forgotPassword.submitting', locale)}
              </>
            ) : (
              t('auth.forgotPassword.submit', locale)
            )}
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}
