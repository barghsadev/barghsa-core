import { useState, useCallback, useRef, useEffect } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import { Loader2Icon, CheckCircle2Icon } from 'lucide-react'
import { Button, Checkbox, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'
import { AuthLayout } from '../components/AuthLayout.js'
import { PasswordField, evaluateStrength } from '../components/PasswordField.js'
import { OtpInput } from '../components/OtpInput.js'
import { setCsrfToken } from '../lib/csrf.js'

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

  // ── Login form state ──────────────────────────────────
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameType, setUsernameType] = useState<UsernameType>(null)
  const [formattedHint, setFormattedHint] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  // Submission state
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // ── OTP step state ─────────────────────────────────────
  const [otpStep, setOtpStep] = useState(false)
  const [challengeId, setChallengeId] = useState('')
  const [otpDestination, setOtpDestination] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendTimer, setResendTimer] = useState(60)
  const [canResend, setCanResend] = useState(false)
  const otpRef = useRef<{ reset: () => void } | null>(null)

  // ── Password change step state (T-02.01.04) ──────────────
  const [passwordChangeStep, setPasswordChangeStep] = useState(false)
  const [passwordChangeToken, setPasswordChangeToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)

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
      setFormError(t('auth.login.error.invalidCredentials', locale))
      return
    }

    setSubmitting(true)

    try {
      const deviceFingerprint = navigator.userAgent

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalized.normalized,
          password,
          deviceInfo: {
            userAgent: deviceFingerprint,
            fingerprint: deviceFingerprint,
          },
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

      // ── Check if password change is required (T-02.01.04) ──
      if (body?.mustChangePassword) {
        const token = body?.passwordChangeToken as string | undefined
        if (!token) {
          const msg = t('auth.login.error.generic', locale)
          setFormError(msg)
          toast.error(msg)
          return
        }
        setPasswordChangeToken(token)
        setPasswordChangeStep(true)
        setNewPassword('')
        setConfirmPassword('')
        setChangeError(null)
        return
      }

      // ── Check if OTP step-up is required ──────────────────
      if (body?.requiresOtp) {
        const cid = body?.challengeId as string | undefined
        if (!cid) {
          const msg = t('auth.login.error.generic', locale)
          setFormError(msg)
          toast.error(msg)
          return
        }
        setChallengeId(cid)
        setOtpDestination(normalized.formatted ?? normalized.normalized)
        setOtpStep(true)
        setResendTimer(60)
        setCanResend(false)
        return
      }

      // ── Success (direct login) ────────────────────────────
      const csrfToken = body?.csrfToken as string | undefined
      if (csrfToken) {
        setCsrfToken(csrfToken)
      }

      const msg = t('auth.login.success', locale)
      toast.success(msg)

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

  // ── Password change handlers (T-02.01.04) ─────────────────────────────

  const handleForceChange = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setChangeError(null)

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setChangeError(t('auth.register.error.passwordsDoNotMatch', locale))
      return
    }

    // Check strength
    const strength = evaluateStrength(newPassword)
    if (strength.score < 40) {
      setChangeError(t('auth.register.error.weakPassword', locale))
      return
    }

    setChangingPassword(true)

    try {
      const response = await fetch('/api/auth/force-change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passwordChangeToken,
          newPassword,
        }),
      })

      if (!response.ok) {
        const body: Record<string, unknown> =
          await response.json().catch(() => ({}))
        const errorCode = typeof body?.error === 'string'
          ? body.error
          : String(body?.error ?? '')

        if (errorCode === 'AUTH:LOGIN:PASSWORD_REUSED') {
          setChangeError(t('auth.login.error.passwordReused', locale))
        } else {
          setChangeError(t('auth.login.error.passwordChangeFailed', locale))
        }
        return
      }

      // Success — redirect back to login with message
      toast.success(t('auth.login.passwordChanged', locale))
      setPasswordChangeStep(false)
      setPassword('')
      setFormError(null)
    } catch {
      setChangeError(t('auth.login.error.generic', locale))
    } finally {
      setChangingPassword(false)
    }
  }, [newPassword, confirmPassword, passwordChangeToken, locale])

  // ── OTP verification callbacks ──────────────────────────────────────────

  const handleOtpComplete = useCallback(
    async (code: string) => {
      setOtpCode(code)
      setOtpError(null)
      setVerifying(true)

      try {
        const response = await fetch('/api/auth/login/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId, otp: code, trustDevice }),
        })

        const body: Record<string, unknown> =
          await response.json().catch(() => ({}))

        if (!response.ok) {
          const errorCode = typeof body?.error === 'string'
            ? body.error
            : (body?.error as Record<string, unknown>)?.code as string | undefined

          let msg: string
          switch (errorCode) {
            case 'AUTH:OTP:INVALID':
              msg = t('auth.otp.error.invalid', locale)
              break
            case 'AUTH:OTP:EXPIRED':
              msg = t('auth.otp.error.expired', locale)
              // On expiry, transition back to login form
              setTimeout(() => {
                toast.error(t('auth.login.otpExpired', locale))
                setOtpStep(false)
                setFormError(t('auth.login.otpExpired', locale))
              }, 500)
              break
            case 'AUTH:OTP:MAX_ATTEMPTS':
              msg = t('auth.otp.error.maxAttempts', locale)
              break
            default:
              msg = t('auth.otp.error.generic', locale)
          }

          setOtpError(msg)
          setOtpCode('')
          if (otpRef.current?.reset) {
            otpRef.current.reset()
          }
          return
        }

        // ── Success — OTP verified, session set ─────────────────
        const csrfToken = body?.csrfToken as string | undefined
        if (csrfToken) {
          setCsrfToken(csrfToken)
        }

        toast.success(t('auth.login.otpSuccess', locale))
        router.navigate({ to: '/' })
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
    [challengeId, trustDevice, locale, router],
  )

  const handleResend = useCallback(async () => {
    if (!canResend || resending) return

    setResending(true)
    setOtpError(null)

    try {
      const response = await fetch('/api/auth/login/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId }),
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

  const handleBackToLoginFromChange = useCallback(() => {
    setPasswordChangeStep(false)
    setChangeError(null)
    setFormError(null)
    setPassword('')
  }, [])

  const handleOtpClearError = useCallback(() => {
    setOtpError(null)
  }, [])

  const isFormReady = isUsernameValid && password.length > 0 && !submitting

  return (
    <AuthLayout
      locale={locale}
      footer={
        otpStep ? (
          <div className="space-y-2">
            <p className="text-center text-sm">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                aria-label={t('auth.login.otpBackToLogin', locale)}
              >
                {t('auth.login.otpBackToLogin', locale)}
              </button>
            </p>
          </div>
        ) : passwordChangeStep ? (
          <div className="space-y-2">
            <p className="text-center text-sm">
              <button
                type="button"
                onClick={handleBackToLoginFromChange}
                className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                aria-label={t('auth.login.backToLogin', locale)}
              >
                {t('auth.login.backToLogin', locale)}
              </button>
            </p>
          </div>
        ) : (
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
        )
      }
    >
      {otpStep ? (
        // ── OTP verification step ─────────────────────────────
        <div className="space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {t('auth.login.otpTitle', locale)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('auth.login.otpSentTo', locale).replace('{destination}', otpDestination)}
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

            {/* Trust this device checkbox */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="trust-device"
                checked={trustDevice}
                onCheckedChange={(checked) => setTrustDevice(checked === true)}
                disabled={verifying}
              />
              <Label htmlFor="trust-device" className="text-sm text-muted-foreground">
                {t('auth.login.trustDevice', locale)}
              </Label>
            </div>

            {/* Verify button */}
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
      ) : passwordChangeStep ? (
        // ── Password change form (T-02.01.04) ─────────────────
        <div className="space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">
              {t('auth.login.forceChangeTitle', locale)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('auth.login.forceChangeDescription', locale)}
            </p>
          </div>

          <form
            onSubmit={handleForceChange}
            className="space-y-4"
            noValidate
          >
            {/* Form-level alert for server errors */}
            {changeError && (
              <Alert variant="destructive" role="alert">
                <AlertTitle className="sr-only">Error</AlertTitle>
                <AlertDescription>{changeError}</AlertDescription>
              </Alert>
            )}

            {/* New password with strength meter */}
            <PasswordField
              id="new-password"
              label={t('auth.register.newPasswordLabel', locale)}
              locale={locale}
              autoFocus={true}
              value={newPassword}
              onChange={setNewPassword}
              disabled={changingPassword}
              showStrength={true}
              autoComplete="new-password"
            />

            {/* Confirm password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password">
                {t('auth.register.confirmPasswordLabel', locale)}
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={changingPassword}
                aria-invalid={confirmPassword.length > 0 && newPassword !== confirmPassword}
                aria-describedby={
                  confirmPassword.length > 0 && newPassword !== confirmPassword
                    ? 'confirm-password-error'
                    : undefined
                }
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p
                  id="confirm-password-error"
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {t('auth.register.error.passwordsDoNotMatch', locale)}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={
                !newPassword ||
                !confirmPassword ||
                newPassword !== confirmPassword ||
                changingPassword
              }
            >
              {changingPassword ? (
                <>
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('auth.login.changingPassword', locale)}
                </>
              ) : (
                t('auth.login.changePasswordButton', locale)
              )}
            </Button>
          </form>
        </div>
      ) : (
        // ── Login form ────────────────────────────────────────
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
      )}
    </AuthLayout>
  )
}