import { formatInTimezone } from '@barghsa/i18n/date-time';
import { timezoneText } from '@barghsa/i18n/timezone';
import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useEffect, useState, lazy, Suspense } from 'react';
import { t, type Locale } from '@barghsa/i18n';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';

const TosContent = lazy(() => import('../components/TosContent.js'));

interface CurrentTosResponse {
  id?: string;
  content: string;
  versionId: string;
  updatedAt: string;
  publishedAt: string;
}

function isCurrentTos(value: unknown): value is CurrentTosResponse {
  if (!value || typeof value !== 'object') return false;
  const terms = value as Partial<CurrentTosResponse>;
  const validDate = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value));
  return (
    (terms.id === undefined || typeof terms.id === 'string') &&
    typeof terms.content === 'string' &&
    !!terms.content.trim() &&
    typeof terms.versionId === 'string' &&
    !!terms.versionId.trim() &&
    validDate(terms.updatedAt) &&
    validDate(terms.publishedAt)
  );
}

export const Route = createFileRoute('/terms')({
  component: TermsPage,
  validateSearch: (search: Record<string, unknown>): { lang?: 'fa' | 'en'; version?: string } => ({
    ...(search.lang === 'en' ? { lang: 'en' as const } : {}),
    ...(search.version === undefined
      ? {}
      : { version: typeof search.version === 'string' ? search.version : '' }),
  }),
});

function TermsPage() {
  const { lang, version } = useSearch({ from: '/terms' });
  const locale: Locale = lang ?? 'fa';
  const isRtl = locale === 'fa';
  const BackIcon = isRtl ? ArrowRightIcon : ArrowLeftIcon;

  const [tos, setTos] = useState<CurrentTosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function fetchTos() {
      try {
        setLoading(true);
        setTos(null);
        setError(false);
        const query = new URLSearchParams({ locale });
        if (version !== undefined) query.set('versionId', version);
        const res = await fetch(`/api/tos/current?${query}`, {
          signal: controller.signal,
          credentials: 'omit',
        });
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const data: unknown = await res.json();
        if (!isCurrentTos(data)) throw new Error('Invalid terms response');
        if (version !== undefined && data.id?.toLowerCase() !== version.toLowerCase())
          throw new Error('Mismatched terms version');
        if (!cancelled) setTos(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTos();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [locale, version, attempt]);

  let formattedDate: string | null = null;
  if (tos?.updatedAt) {
    try {
      // Public terms are unauthenticated and use the product's default timezone.
      formattedDate = formatInTimezone(tos.updatedAt, 'Asia/Tehran', locale, { dateStyle: 'long' });
    } catch {
      formattedDate = timezoneText('display.invalid', locale);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col" dir={isRtl ? 'rtl' : 'ltr'}>
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
            <path d="M18 6L9 18h5l-1 8 9-12h-5l1-8z" fill="var(--primary-foreground)" />
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
            <path d="M18 6L9 18h5l-1 8 9-12h-5l1-8z" fill="var(--primary-foreground)" />
          </svg>
          <span>{t('auth.brand.title', locale)}</span>
        </Link>
      </aside>

      {/* Content */}
      <main className="flex flex-1 items-start justify-center p-4 md:p-8 lg:p-12">
        <div className="w-full max-w-3xl">
          <nav aria-label={t('tos.page.language', locale)} className="mb-6 flex flex-wrap gap-4">
            <Link
              to="/terms"
              search={{ lang: 'fa', version }}
              lang="fa"
              aria-current={locale === 'fa' ? 'page' : undefined}
              className="underline underline-offset-4"
            >
              فارسی
            </Link>
            <Link
              to="/terms"
              search={{ lang: 'en', version }}
              lang="en"
              aria-current={locale === 'en' ? 'page' : undefined}
              className="underline underline-offset-4"
            >
              English
            </Link>
          </nav>
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="mt-4 text-sm text-muted-foreground">{t('tos.page.loading', locale)}</p>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p role="alert" className="text-sm text-destructive">
                {t('tos.page.error', locale)}
              </p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="mt-4 rounded border border-border px-4 py-2 text-sm font-medium"
              >
                {t('tos.page.retry', locale)}
              </button>
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
          {tos && !loading && !error && (
            <article className="prose prose-sm dark:prose-invert max-w-none">
              <header className="mb-8 not-prose">
                <h1 className="text-2xl font-bold tracking-tight">{t('tos.page.title', locale)}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{tos.versionId}</p>
                {formattedDate && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('tos.page.lastUpdated', locale).replace('{date}', formattedDate)}
                  </p>
                )}
              </header>

              <Suspense fallback={<p role="status">{t('tos.page.loading', locale)}</p>}>
                <TosContent content={tos.content} language={locale} />
              </Suspense>
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
  );
}
