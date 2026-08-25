import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { t, type Locale } from '@barghsa/i18n'

interface VerificationStatusResponse {
  activeProfileId: string | null
  profileStatus: string | null
  isVerified: boolean
  verificationRequired: boolean
  verificationMethod: 'api' | 'manual'
  canAutoVerify: boolean
}

function ElectricityOrderPage() {
  const [blocked, setBlocked] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)
  const locale: Locale = 'fa' // TODO: read from locale context

  useEffect(() => {
    let cancelled = false

    async function checkVerification() {
      try {
        const response = await fetch('/api/profiles/verification-status', {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })

        if (response.status === 401) {
          // Not authenticated — don't block (auth guard will redirect)
          if (!cancelled) setBlocked(false)
          return
        }

        if (!response.ok) {
          if (!cancelled) setBlocked(false)
          return
        }

        const data: VerificationStatusResponse = await response.json()

        // Block if verification is required AND profile is not verified
        if (data.verificationRequired && !data.isVerified) {
          if (!cancelled) setBlocked(true)
        } else {
          if (!cancelled) setBlocked(false)
        }
      } catch {
        if (!cancelled) setBlocked(false)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    checkVerification()

    return () => {
      cancelled = true
    }
  }, [])

  if (checking) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (blocked) {
    return (
      <div
        className="container mx-auto flex min-h-[50vh] items-center justify-center p-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="max-w-md text-center">
          <div className="mb-4 text-4xl">⚠️</div>
          <h1 className="mb-4 text-2xl font-bold">
            {t('verification.order.blocked.title', locale)}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {t('verification.order.blocked.description', locale)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('verification.order.blocked.support', locale)}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Place Order</h1>
      <p className="text-gray-600">Complete your electricity purchase.</p>
    </div>
  )
}

export const Route = createFileRoute('/_app/electricity/order')({
  component: ElectricityOrderPage,
})