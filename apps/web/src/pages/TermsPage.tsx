import { Icon } from '../components/Icon.js';
import { Button, SkeletonText } from '@barghsa/ui';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { timezoneDisplayText } from '@barghsa/i18n/timezone-display';
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router';
import { useEffect, useState, lazy, Suspense } from 'react';
import { t, type Locale } from '@barghsa/i18n';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { BrandMark } from '../components/BrandMark.js';
import { brandName, useBrandConfig } from '../providers/BrandThemeProvider.js';
import { PublishedTermsHistory } from '../components/PublishedTermsHistory.js';
import { readWithDeadline } from '../lib/server-query-client.js';

function termsLink(locale: Locale, version?: string) {
  return version
    ? { to: '/terms/$version' as const, params: { version }, search: { lang: locale } }
    : { to: '/terms' as const, search: { lang: locale } };
}
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

export function TermsPage({
  locale = 'fa',
  version,
}: {
  locale?: Locale;
  version?: string | undefined;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { brandConfig } = useBrandConfig();
  const name = brandName(brandConfig, locale);
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
        const data: unknown = await readWithDeadline(controller.signal, async (signal) => {
          const res = await fetch(`/api/tos/current?${query}`, {
            signal,
            credentials: 'omit',
            cache: 'no-store',
          });
          if (!res.ok) throw new Error('Terms unavailable');
          return res.json();
        });
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
  if (tos?.publishedAt) {
    try {
      // Public terms are unauthenticated and use the product's default timezone.
      formattedDate = formatInTimezone(tos.publishedAt, 'Asia/Tehran', locale, {
        dateStyle: 'long',
      });
    } catch {
      formattedDate = timezoneDisplayText('display.invalid', locale);
    }
  }

  return (
    <div
      className="flex min-h-dvh flex-col print:min-h-0 print:bg-white print:text-black"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <header className="border-b px-5 py-3 print:hidden" data-toast-anchor>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link to="/" className="inline-flex min-h-11 items-center rounded-md" aria-label={name}>
            <BrandMark />
          </Link>
          {canGoBack && (
            <Button variant="outline" type="button" onClick={() => router.history.back()}>
              <BackIcon className="size-4" aria-hidden="true" />
              {t('tos.page.back', locale)}
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-start justify-center px-4 py-6 md:p-8 print:block print:p-0"
      >
        <div className="w-full max-w-3xl print:max-w-none">
          <nav
            aria-label={t('tos.page.language', locale)}
            className="mb-6 flex flex-wrap gap-4 print:hidden"
          >
            <Link
              {...termsLink('fa', version)}
              lang="fa"
              aria-current={locale === 'fa' ? 'page' : undefined}
              className="touch-action justify-center underline underline-offset-4"
            >
              فارسی
            </Link>
            <Link
              {...termsLink('en', version)}
              lang="en"
              aria-current={locale === 'en' ? 'page' : undefined}
              className="touch-action justify-center underline underline-offset-4"
            >
              English
            </Link>
          </nav>
          {/* Loading state */}
          {loading && (
            <div
              role="status"
              aria-label={t('tos.page.loading', locale)}
              data-slot="record-detail-skeleton"
              className="space-y-6 rounded-xl border bg-card p-4 sm:p-6"
            >
              <span className="sr-only">{t('tos.page.loading', locale)}</span>
              <SkeletonText lines={2} className="w-1/2" />
              <SkeletonText lines={4} className="border-t pt-4" />
              <SkeletonText lines={3} />
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
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-foreground underline underline-offset-4 hover:decoration-2"
              >
                <Icon icon={ArrowLeftIcon} className="h-3.5 w-3.5" aria-hidden="true" />
                {t('tos.page.backToHome', locale)}
              </Link>
            </div>
          )}

          {/* TOS content */}
          {tos && !loading && !error && (
            <article className="prose prose-sm dark:prose-invert max-w-none">
              <header className="not-prose mb-6 space-y-3 border-b pb-5">
                <h1 className="text-3xl leading-snug font-semibold">
                  {t('tos.page.title', locale)}
                </h1>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground">
                    <bdi className="font-semibold text-foreground">{tos.versionId}</bdi>
                    {formattedDate && (
                      <span>
                        {t('tos.page.published', locale).replace('{date}', formattedDate)}
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="print:hidden"
                    onClick={() => window.print()}
                  >
                    {t('tos.page.print', locale)}
                  </Button>
                </div>
              </header>

              <Suspense fallback={<p role="status">{t('tos.page.loading', locale)}</p>}>
                <TosContent content={tos.content} language={locale} headingLinks />
              </Suspense>
            </article>
          )}
          {tos && !loading && !error && (
            <PublishedTermsHistory
              key={`${locale}:${version ?? ''}`}
              locale={locale}
              currentId={tos.id}
            />
          )}
        </div>
      </main>

      {/* Footer with back link */}
      <footer className="border-t border-border py-6 px-4 md:px-8 print:hidden">
        <div className="mx-auto max-w-3xl">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline underline-offset-4 hover:decoration-2"
          >
            <BackIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t('tos.page.backToHome', locale)}
          </Link>
        </div>
      </footer>
    </div>
  );
}
