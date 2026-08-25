import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'

interface VerificationStatusResponse {
  activeProfileId: string | null
  profileStatus: string | null
  isVerified: boolean
  verificationRequired: boolean
  verificationMethod: 'api' | 'manual'
  canAutoVerify: boolean
}

/**
 * VerificationBanner (T-03.01.02).
 *
 * Fetches the profile verification status from the API and shows a
 * dismissible banner when the active profile is not verified and the
 * system requires verification. Includes an auto-verify button when
 * the verification method is 'api'.
 *
 * Renders nothing when:
 * - The user is not authenticated (API returns 401)
 * - The profile is already verified
 * - Verification is not required by the system
 */
export function VerificationBanner() {
  const [status, setStatus] = useState<VerificationStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const locale: Locale = 'fa' // TODO: read from locale context
  const isRtl = locale === 'fa'

  useEffect(() => {
    let cancelled = false

    async function fetchStatus() {
      try {
        const response = await fetch('/api/profiles/verification-status', {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })

        // Not authenticated — no banner
        if (response.status === 401) {
          if (!cancelled) setLoading(false)
          return
        }

        if (!response.ok) {
          if (!cancelled) setLoading(false)
          return
        }

        const data: VerificationStatusResponse = await response.json()
        if (!cancelled) {
          setStatus(data)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    fetchStatus()

    return () => {
      cancelled = true
    }
  }, [])

  // Don't render anything while loading, or if no status data, or if dismissed
  if (loading || !status || dismissed) return null

  // Don't render if profile is verified or verification is not required
  if (status.isVerified || !status.verificationRequired) return null

  // Don't render if no active profile at all. Capture the non-null status
  // for use inside the handleAutoVerify closure, which TypeScript cannot
  // narrow across function boundaries.
  if (!status.activeProfileId) return null
  const currentStatus = status

  async function handleAutoVerify() {
    if (!currentStatus.activeProfileId) return
    setVerifying(true)
    setError(null)

    try {
      const response = await fetch(`/api/profiles/${currentStatus.activeProfileId}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })

      if (response.ok) {
        setVerified(true)
        // Refresh the page after a brief delay to reflect the new status
        setTimeout(() => {
          router.invalidate()
        }, 1500)
      } else {
        setVerifying(false)
        setError(t('verification.banner.error', locale))
      }
    } catch {
      setVerifying(false)
      setError(t('verification.banner.error', locale))
    }
  }

  if (verified) {
    return (
      <div
        className="bg-green-50 border-green-200 border px-4 py-3 text-sm text-green-800"
        role="alert"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span>{t('verification.banner.verified', locale)}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="bg-amber-50 border-amber-200 border-b px-4 py-3 text-sm text-amber-800"
      role="alert"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex flex-col gap-1">
          <span>{t('verification.banner.title', locale)}</span>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
        <div className="flex items-center gap-3">
          {currentStatus.canAutoVerify && (
            <button
              onClick={handleAutoVerify}
              disabled={verifying}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {verifying
                ? t('verification.banner.verifying', locale)
                : t('verification.banner.verify', locale)}
            </button>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="text-amber-600 hover:text-amber-800"
            aria-label={t('verification.banner.dismiss', locale)}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}