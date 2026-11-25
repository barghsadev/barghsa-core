import { lazy, Suspense } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { LoadingStatus } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { useLocale } from '../../../hooks/useLocale.js';
import { usePreferenceSettingsOwner } from '../../../hooks/usePreferenceSettingsForm.js';

const TelegramLinkPanel = lazy(() => import('../../../components/TelegramLinkPanel.js'));

function TelegramSettingsPage() {
  const locale = useLocale();
  const scope = usePreferenceSettingsOwner();
  return (
    <div className="mx-auto w-full max-w-xl space-y-4 p-4">
      <Link
        to="/settings/security"
        className="text-sm font-medium text-primary hover:underline"
        disabled={scope.locked}
      >
        {t('settings.security.title', locale)}
      </Link>
      {scope.denied && <p role="alert">{securitySettingsText('denied', locale)}</p>}
      {scope.isCurrent() && (
        <Suspense
          fallback={
            <LoadingStatus>{securitySettingsText('loadingTelegram', locale)}</LoadingStatus>
          }
        >
          <TelegramLinkPanel scope={scope} standalone />
        </Suspense>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/settings/security_/telegram')({
  component: TelegramSettingsPage,
});
