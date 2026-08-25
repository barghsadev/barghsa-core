import { createFileRoute, Link } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { Card, CardContent } from '@barghsa/ui'
import { MailIcon, PhoneIcon, ClockIcon, ArrowLeftIcon } from 'lucide-react'

export const Route = createFileRoute('/support')({
  component: SupportPage,
})

function SupportPage() {
  const locale: Locale = 'fa' // TODO: read from user preference / locale context
  const isRtl = locale === 'fa'

  return (
    <div
      className="flex min-h-dvh flex-col"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Mobile header with brand */}
      <div className="flex md:hidden flex-col items-center py-8 px-4 border-b border-border bg-gradient-to-b from-primary/5 to-background">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xl font-bold text-primary no-underline"
          aria-label={t('auth.brand.logo.alt', locale)}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <path
              d="M18 6L9 18h5l-1 8 9-12h-5l1-8z"
              fill="var(--primary-foreground)"
            />
          </svg>
          <span>{t('auth.brand.title', locale)}</span>
        </Link>
      </div>

      {/* Desktop sidebar with brand */}
      <aside className="hidden md:flex flex-col items-center justify-center py-16 px-8 border-b border-border bg-gradient-to-b from-primary/5 to-background">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-2xl font-bold text-primary no-underline"
          aria-label={t('auth.brand.logo.alt', locale)}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <path
              d="M18 6L9 18h5l-1 8 9-12h-5l1-8z"
              fill="var(--primary-foreground)"
            />
          </svg>
          <span>{t('auth.brand.title', locale)}</span>
        </Link>
      </aside>

      <main className="flex flex-1 items-center justify-center p-4 md:p-8 lg:p-12">
        <Card className="w-full max-w-lg">
          <CardContent className="pt-6">
            <div className="space-y-6">
              {/* Title */}
              <div className="space-y-1.5">
                <h1 className="text-xl font-semibold tracking-tight">
                  {t('auth.support.title', locale)}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('auth.support.subtitle', locale)}
                </p>
              </div>

              {/* Recovery process */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <p className="text-sm leading-relaxed">
                  {t('auth.support.steps', locale)}
                </p>
              </div>

              {/* Contact methods */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {t('auth.support.contactEmail', locale)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('auth.support.emailAddress', locale)}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <PhoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {t('auth.support.contactPhone', locale)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('auth.support.phoneNumber', locale)}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <ClockIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <p className="text-sm text-muted-foreground">
                      {t('auth.support.responseTime', locale)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>

          {/* Footer */ }
          <div className="px-(--card-spacing) pb-(--card-spacing)">
            <Link
              to="/forgot-password"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
              aria-label={t('auth.support.backToLogin', locale)}
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {t('auth.support.backToLogin', locale)}
            </Link>
          </div>
        </Card>
      </main>
    </div>
  )
}