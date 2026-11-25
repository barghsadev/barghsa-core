import { createFileRoute, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { buttonVariants, PageHeader } from '@barghsa/ui';
import { useLocale } from '../../../hooks/useLocale.js';

function PrivacySettingsPage() {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <PageHeader title={t('settings.privacy.title', locale)} />
      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{t('settings.privacy.preferences', locale)}</h2>
        <Link
          to="/settings"
          hash="analytics-consent"
          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
        >
          {t('settings.privacy.manageConsent', locale)}
        </Link>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{t('settings.privacy.profileRequests', locale)}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.privacy.intro', locale)}</p>
        <Link
          to="/settings/privacy/requests"
          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
        >
          {t('settings.privacy.manageRequests', locale)}
        </Link>
      </section>
    </div>
  );
}

export const Route = createFileRoute('/_app/settings/privacy')({
  component: PrivacySettingsPage,
});
