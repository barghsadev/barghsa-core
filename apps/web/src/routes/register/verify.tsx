import { useState, useCallback, useRef, useEffect } from 'react'
import { createFileRoute, Link, useRouter, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@barghsa/ui'
import { AuthLayout } from '../../components/AuthLayout.js'
import { OtpInput } from '../../components/OtpInput.js'

export const Route = createFileRoute('/register/verify')({
  validateSearch: (search: Record<string, unknown>) => ({
    challengeId: String(search?.challengeId ?? ''),
    destination: String(search?.destination ?? ''),
  }),
  component: OtpVerifyPage,
})

/** Resend countdown in seconds */
const RESEND_COOLDOWN = 60
/** Maximum resend attempts before blocking */
// const MAX_RESENDS = 3

function OtpVerifyPage() {
  const router = useRouter()
  const { challengeId, destination } = useSearch({ from: '/register/verify' })
  const locale: Locale = 'fa' // TODO: read from user preference / locale context

  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendTimer, setResendTimer] = useState(RESEND_COOLDOWN)
  const [canResend, setCanResend] = useState(false)
  const otpRef = useRef<{ reset: () => void } | null>(null)

  // Countdown timer for resend
  useEffect(() => {
    if (canResend) return

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
  }, [canResend])

  // Redirect if no challengeId (user navigated directly)
  useEffect(() => {
    if (!challengeId) {
      router.navigate({ to: '/register' })
    }
  }, [challengeId, router])

  const handleOtpComplete = useCallback(
    async (code: string) => {
      setOtp(code)
      setOtpError(null)
      setVerifying(true)

      try {
        const response = await fetch('/api/auth/register/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId, otp: code }),
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
              // On expiry, redirect back to registration
              setTimeout(() => {
                toast.error(t('auth.otp.expired', locale))
                router.navigate({ to: '/register' })
              }, 500)
              break
            case 'AUTH:OTP:MAX_ATTEMPTS':
              msg = t('auth.otp.error.maxAttempts', locale)
              break
            default:
              msg = t('auth.otp.error.generic', locale)
          }

          setOtpError(msg)
          // Clear OTP input on error and shake
          if (otpRef.current?.reset) {
            otpRef.current.reset()
          }
          return
        }

        // Success — user created, session set
        toast.success(t('auth.register.success', locale))
        // Redirect to app (will check for profile)
        router.navigate({ to: '/' })
      } catch {
        setOtpError(t('auth.otp.error.generic', locale))
        if (otpRef.current?.reset) {
          otpRef.current.reset()
        }
      } finally {
        setVerifying(false)
      }
    },
    [challengeId, locale, router],
  )

  const handleResend = useCallback(async () => {
    if (!canResend || resending) return

    setResending(true)
    setOtpError(null)

    try {
      const response = await fetch('/api/auth/register/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId }),
      })

      if (!response.ok) {
        toast.error(t('auth.otp.error.resend', locale))
        return
      }

      // Reset timer
      setResendTimer(RESEND_COOLDOWN)
      setCanResend(false)
      setOtp('')
      if (otpRef.current?.reset) {
        otpRef.current.reset()
      }
      toast.success(t('auth.otp.sentTo', locale).replace('{destination}', destination))
    } catch {
      toast.error(t('auth.otp.error.resend', locale))
    } finally {
      setResending(false)
    }
  }, [challengeId, canResend, resending, locale, destination])

  const handleClearError = useCallback(() => {
    setOtpError(null)
  }, [])

  return (
    <AuthLayout
      locale={locale}
      footer={
        <div className="space-y-2">
          <p className="text-center text-sm">
            <Link
              to="/register"
              className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
              aria-label={t('auth.otp.backToRegister', locale)}
            >
              {t('auth.otp.backToRegister', locale)}
            </Link>
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('auth.otp.title', locale)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('auth.otp.sentTo', locale).replace('{destination}', destination)}
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
            onClearError={handleClearError}
          />

          {/* Verify button (disabled when OTP not yet entered) */}
          <Button
            type="button"
            className="w-full"
            disabled={!otp || verifying}
            onClick={() => otp && handleOtpComplete(otp)}
          >
            {verifying ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t('auth.otp.verifying', locale)}
              </>
            ) : (
              t('auth.otp.title', locale)
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