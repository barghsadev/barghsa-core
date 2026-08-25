import { createFileRoute } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
})

function OnboardingPage() {
  const locale: Locale = 'fa' // TODO: read from user preference / locale context
  const isRtl = locale === 'fa'

  return (
    <div
      className="container mx-auto flex min-h-screen items-center justify-center p-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-2xl font-bold">
          {t('onboarding.welcome.title', locale)}
        </h1>
        <p className="mb-6 text-muted-foreground">
          {t('onboarding.welcome.subtitle', locale)}
        </p>
        <p className="text-sm text-muted-foreground" lang="en">
          {t('onboarding.welcome.subtitleEn', locale)}
        </p>
        <div className="mt-8 flex flex-col gap-4">
          <div className="rounded-lg border p-4 text-left">
            <h2 className="mb-2 text-lg font-semibold">
              {t('onboarding.profile.individual', locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('onboarding.profile.individualDesc', locale)}
            </p>
            <p className="text-xs text-muted-foreground" lang="en">
              {t('onboarding.profile.individualDescEn', locale)}
            </p>
          </div>
          <div className="rounded-lg border p-4 text-left opacity-50">
            <h2 className="mb-2 text-lg font-semibold">
              {t('onboarding.profile.legal', locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('onboarding.profile.legalDesc', locale)}
            </p>
            <p className="text-xs text-muted-foreground" lang="en">
              {t('onboarding.profile.legalDescEn', locale)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}