import { lazy, Suspense } from 'react';
const RecoveryContactForm = lazy(() => import('../components/RecoveryContactForm.js'));
import { createFileRoute, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/auth';
import { useLocale } from '../hooks/useLocale.js';
import { BrandMark } from '../components/BrandMark.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.js';
import { brandName, useBrandConfig } from '../providers/BrandThemeProvider.js';
import { buttonVariants, Card, CardContent } from '@barghsa/ui';
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
  const emailSubject = reference
    ? `?subject=${encodeURIComponent(`${feedbackText('reference', locale)}: ${reference}`)}`
    : '';

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
        className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 md:py-10"
      >
        <header className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('auth.support.title', locale)}
          </h1>
          <p className="text-sm text-muted-foreground">{t('auth.support.subtitle', locale)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a href="#recovery-support-contact" className={buttonVariants()}>
              {t('auth.support.contactLink', locale)}
            </a>
            <a
              href="#recovery-contact-verification"
              className={buttonVariants({
                variant: 'outline',
                className: 'h-auto min-h-11 whitespace-normal',
              })}
            >
              {t('auth.support.verifyContactLink', locale)}
            </a>
          </div>
        </header>

        <div className="grid items-start gap-4 md:grid-cols-2 md:grid-rows-[max-content_1fr]">
          <section
            id="recovery-support-contact"
            aria-labelledby="support-contact-heading"
            tabIndex={-1}
            className="min-w-0 scroll-mt-4 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <Card className="py-0">
              <CardContent className="min-w-0 space-y-4 p-4 sm:p-5">
                <h2 id="support-contact-heading" className="font-semibold">
                  {t('auth.support.contactLink', locale)}
                </h2>
                <dl className="divide-y">
                  {[
                    {
                      label: t('auth.support.contactEmail', locale),
                      value: brandConfig.supportEmail,
                      href: `mailto:${brandConfig.supportEmail}${emailSubject}`,
                      Icon: MailIcon,
                    },
                    {
                      label: t('auth.support.contactPhone', locale),
                      value: displayPhone(brandConfig.supportPhone),
                      href: phoneHref(brandConfig.supportPhone),
                      Icon: PhoneIcon,
                    },
                    {
                      label: t('auth.support.contactMobile', locale),
                      value: displayPhone(brandConfig.supportMobile),
                      href: phoneHref(brandConfig.supportMobile),
                      Icon: PhoneIcon,
                    },
                  ].map(({ label, value, href, Icon }) =>
                    value ? (
                      <div key={label} className="min-w-0 py-1.5">
                        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                          {label}
                        </dt>
                        <dd className="min-w-0 ps-6">
                          <a
                            href={href}
                            className="touch-action inline-flex min-h-9 items-center text-sm font-medium text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
                          >
                            <bdi dir="ltr">{value}</bdi>
                          </a>
                        </dd>
                      </div>
                    ) : null
                  )}
                </dl>
                {reference && (
                  <dl className="space-y-1 rounded-lg bg-muted/45 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">
                      {feedbackText('reference', locale)}
                    </dt>
                    <dd className="font-mono text-xs [overflow-wrap:anywhere]">
                      <bdi dir="ltr">{reference}</bdi>
                    </dd>
                  </dl>
                )}
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {t('auth.support.responseTime', locale)}
                </p>
              </CardContent>
            </Card>
          </section>

          <section
            id="recovery-contact-verification"
            tabIndex={-1}
            className="min-w-0 scroll-mt-4 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:col-start-2 md:row-span-2 md:row-start-1"
          >
            <Card className="py-0">
              <CardContent className="min-w-0 space-y-4 p-4 sm:p-5">
                <Suspense fallback={<p role="status">{loadingText('loading', locale)}</p>}>
                  <RecoveryContactForm />
                </Suspense>
                <p className="border-t pt-3 text-sm leading-relaxed text-muted-foreground">
                  {t('auth.support.steps', locale)}
                </p>
              </CardContent>
            </Card>
          </section>

          <div className="min-w-0 md:col-start-1 md:row-start-2">
            <PublicKnowledgeAssistant locale={locale} />
          </div>
        </div>

        <Link
          to="/login"
          className="touch-action inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4"
        >
          <BackIcon className="size-4" aria-hidden="true" />
          {t('auth.support.backToLogin', locale)}
        </Link>
      </main>
    </div>
  );
}
