import { lazy, Suspense } from 'react';
const RecoveryContactForm = lazy(() => import('../components/RecoveryContactForm.js'));
import { createFileRoute, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/auth';
import { useLocale } from '../hooks/useLocale.js';
import { BrandMark } from '../components/BrandMark.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.js';
import { brandName, useBrandConfig } from '../providers/BrandThemeProvider.js';
import { Card, CardContent } from '@barghsa/ui';
import { MailIcon, PhoneIcon, ClockIcon, ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { PublicKnowledgeAssistant } from '../components/PublicKnowledgeAssistant.js';
import { feedbackText } from '@barghsa/i18n/feedback';
import { loadingText } from '@barghsa/i18n/loading-feedback';

export const Route = createFileRoute('/support')({
  validateSearch: (search: Record<string, unknown>): { reference?: string } =>
    typeof search.reference === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search.reference)
      ? { reference: search.reference }
      : {},
  component: SupportPage,
});

function SupportPage() {
  const locale = useLocale();
  const { reference } = Route.useSearch();
  const { brandConfig } = useBrandConfig();
  const name = brandName(brandConfig, locale);
  const phoneHref = (value: string) => {
    const digits = value.replace(/\D/g, '');
    return `tel:${digits.startsWith('0') ? `+98${digits.slice(1)}` : value.startsWith('+') ? `+${digits}` : digits}`;
  };
  const displayPhone = (value: string) =>
    locale === 'fa' ? value.replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!) : value;
  const isRtl = locale === 'fa';
  const BackIcon = isRtl ? ArrowRightIcon : ArrowLeftIcon;

  return (
    <div className="flex min-h-dvh flex-col" dir={isRtl ? 'rtl' : 'ltr'}>
      <header
        className="flex items-center justify-between gap-3 border-b px-5 py-3 sm:px-9"
        data-toast-anchor
      >
        <Link to="/" className="inline-flex min-h-11 items-center rounded-md" aria-label={name}>
          <BrandMark />
        </Link>
        <LanguageSwitcher />
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-start justify-center px-4 py-6 md:px-8 md:py-10"
      >
        <Card className="w-full max-w-xl">
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-6">
              {/* Title */}
              <div className="space-y-1.5">
                <h1 className="text-xl font-semibold tracking-tight">
                  {t('auth.support.title', locale)}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('auth.support.subtitle', locale)}
                </p>
                <a
                  href="#recovery-support-contact"
                  className="touch-action inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
                >
                  {t('auth.support.contactLink', locale)}
                </a>
              </div>

              {reference && (
                <p className="break-all text-sm">
                  {feedbackText('reference', locale)}: <bdi>{reference}</bdi>
                </p>
              )}

              <Suspense fallback={<p role="status">{loadingText('loading', locale)}</p>}>
                <RecoveryContactForm />
              </Suspense>
              {/* Recovery process */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <p className="text-sm leading-relaxed">{t('auth.support.steps', locale)}</p>
              </div>

              {/* Contact methods */}
              <div
                id="recovery-support-contact"
                tabIndex={-1}
                className="space-y-4 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                {brandConfig.supportEmail && (
                  <div className="flex items-start gap-3">
                    <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('auth.support.contactEmail', locale)}
                      </p>
                      <a
                        href={`mailto:${brandConfig.supportEmail}${reference ? `?subject=${encodeURIComponent(`${feedbackText('reference', locale)}: ${reference}`)}` : ''}`}
                        className="touch-action text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {brandConfig.supportEmail}
                      </a>
                    </div>
                  </div>
                )}

                {brandConfig.supportPhone && (
                  <div className="flex items-start gap-3">
                    <PhoneIcon
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('auth.support.contactPhone', locale)}
                      </p>
                      <a
                        href={phoneHref(brandConfig.supportPhone)}
                        dir="ltr"
                        className="touch-action text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {displayPhone(brandConfig.supportPhone)}
                      </a>
                    </div>
                  </div>
                )}

                {brandConfig.supportMobile && (
                  <div className="flex items-start gap-3">
                    <PhoneIcon
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t('auth.support.contactMobile', locale)}
                      </p>
                      <a
                        href={phoneHref(brandConfig.supportMobile)}
                        dir="ltr"
                        className="touch-action text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {displayPhone(brandConfig.supportMobile)}
                      </a>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <ClockIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="space-y-0.5">
                    <p className="text-sm text-muted-foreground">
                      {t('auth.support.responseTime', locale)}
                    </p>
                  </div>
                </div>
              </div>
              <PublicKnowledgeAssistant locale={locale} />
            </div>
          </CardContent>

          {/* Footer */}
          <div className="px-(--card-spacing) pb-(--card-spacing)">
            <Link
              to="/login"
              className="touch-action inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
              aria-label={t('auth.support.backToLogin', locale)}
            >
              <BackIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {t('auth.support.backToLogin', locale)}
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
