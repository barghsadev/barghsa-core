import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})

type ProfileType = 'INDIVIDUAL' | 'LEGAL'

function OnboardingPage() {
  const locale: Locale = 'fa' // TODO: read from user preference / locale context
  const isRtl = locale === 'fa'
  const router = useRouter()

  const [selectedType, setSelectedType] = useState<ProfileType | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleContinue() {
    if (!selectedType) {
      setError(
        isRtl
          ? t('onboarding.type.error.required', 'fa') ?? 'لطفاً نوع پروفایل را انتخاب کنید'
          : t('onboarding.type.error.required', 'en') ?? 'Please select a profile type',
      )
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/onboarding/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileType: selectedType }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message ?? `HTTP ${response.status}`)
      }

      const body = await response.json() as { profileId: string }

      // Navigate to the appropriate profile form
      if (selectedType === 'INDIVIDUAL') {
        router.navigate({
          to: '/onboarding/individual/$profileId',
          params: { profileId: body.profileId },
          replace: true,
        })
      } else {
        // Legal profile — will be handled in T-03.02.03
        router.navigate({ to: '/', replace: true })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="container mx-auto flex min-h-screen items-center justify-center p-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="max-w-lg">
        <h1 className="mb-2 text-center text-2xl font-bold">
          {t('onboarding.welcome.title', locale)}
        </h1>
        <p className="mb-2 text-center text-muted-foreground">
          {t('onboarding.welcome.subtitle', locale)}
        </p>
        <p className="mb-6 text-center text-sm text-muted-foreground" lang="en">
          {t('onboarding.welcome.subtitleEn', locale)}
        </p>

        <p className="mb-4 text-base font-medium">
          {t('onboarding.type.prompt', locale)}
        </p>

        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Individual card */}
          <button
            type="button"
            onClick={() => {
              setSelectedType('INDIVIDUAL')
              setError(null)
            }}
            className={`flex flex-1 flex-col items-center rounded-lg border-2 p-6 text-center transition-colors ${
              selectedType === 'INDIVIDUAL'
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border hover:border-muted-foreground/40'
            }`}
            aria-pressed={selectedType === 'INDIVIDUAL'}
          >
            <span className="mb-2 text-3xl" aria-hidden="true">
              👤
            </span>
            <h2 className="mb-1 text-lg font-semibold">
              {t('onboarding.profile.individual', locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('onboarding.profile.individualDesc', locale)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground" lang="en">
              {t('onboarding.type.individualHintEn', locale)}
            </p>
          </button>

          {/* Legal card */}
          <button
            type="button"
            onClick={() => {
              setSelectedType('LEGAL')
              setError(null)
            }}
            className={`flex flex-1 flex-col items-center rounded-lg border-2 p-6 text-center transition-colors ${
              selectedType === 'LEGAL'
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border hover:border-muted-foreground/40'
            }`}
            aria-pressed={selectedType === 'LEGAL'}
          >
            <span className="mb-2 text-3xl" aria-hidden="true">
              🏢
            </span>
            <h2 className="mb-1 text-lg font-semibold">
              {t('onboarding.profile.legal', locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('onboarding.profile.legalDesc', locale)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground" lang="en">
              {t('onboarding.type.legalHintEn', locale)}
            </p>
          </button>
        </div>

        {error && (
          <p className="mt-4 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!selectedType || submitting}
          className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting
            ? '…'
            : t('onboarding.type.continue', locale)}
        </button>
      </div>
    </div>
  )
}