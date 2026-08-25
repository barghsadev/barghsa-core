import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { t, type Locale } from '@barghsa/i18n'
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'

interface CurrentTosResponse {
  content: string
  versionId: string
  updatedAt: string
  publishedAt: string
}

export const Route = createFileRoute('/terms')({
  component: TermsPage,
  validateSearch: (search: Record<string, unknown>): { lang?: 'fa' | 'en' } => ({
    ...(search.lang === 'en' ? { lang: 'en' as const } : {}),
  }),
})

function TermsPage() {
  const { lang } = useSearch({ from: '/terms' })
  const locale: Locale = lang ?? 'fa'
  const isRtl = locale === 'fa'
  const BackIcon = isRtl ? ArrowRightIcon : ArrowLeftIcon

  const [tos, setTos] = useState<CurrentTosResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function fetchTos() {
      try {
        setLoading(true)
        setError(false)
        const res = await fetch(`/api/tos/current?locale=${locale}`, {
          signal: controller.signal,
          credentials: 'omit',
        })
        if (!res.ok) {
          if (!cancelled) setError(true)
          return
        }
        const data: CurrentTosResponse = await res.json()
        if (!cancelled) setTos(data)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchTos()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [locale])

  const formattedDate = tos?.updatedAt
    ? new Date(tos.updatedAt).toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

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

      {/* Content */}
      <main className="flex flex-1 items-start justify-center p-4 md:p-8 lg:p-12">
        <div className="w-full max-w-3xl">
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="mt-4 text-sm text-muted-foreground">
                {t('tos.page.loading', locale)}
              </p>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-destructive">
                {t('tos.page.error', locale)}
              </p>
              <Link
                to="/"
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {t('tos.page.backToHome', locale)}
              </Link>
            </div>
          )}

          {/* TOS content */}
          {tos && !loading && (
            <article className="prose prose-sm dark:prose-invert max-w-none">
              <header className="mb-8 not-prose">
                <h1 className="text-2xl font-bold tracking-tight">
                  {t('tos.page.title', locale)}
                </h1>
                {formattedDate && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('tos.page.lastUpdated', locale).replace('{date}', formattedDate)}
                  </p>
                )}
              </header>

              <div
                className="whitespace-pre-wrap leading-relaxed text-foreground/90"
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {tos.content}
              </div>
            </article>
          )}
        </div>
      </main>

      {/* Footer with back link */}
      <footer className="border-t border-border py-6 px-4 md:px-8">
        <div className="mx-auto max-w-3xl">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            <BackIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t('tos.page.backToHome', locale)}
          </Link>
        </div>
      </footer>
    </div>
  )
}