import { createFileRoute, lazyRouteComponent, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/admin-ui';
import { loginFormText } from '@barghsa/i18n/login-forms';
import { Alert } from '@barghsa/ui';
import { useState } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useLocale } from '../../hooks/useLocale.js';
import { notificationTemplatesSearch } from '../../lib/template-catalogue-query.js';

const Settings = lazyRouteComponent(() => import('../../components/DeliveryWindowConfigPanel.js'));

export const Route = createFileRoute('/admin/notifications/settings')({
  validateSearch: notificationTemplatesSearch,
  component: DeliverySettingsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function DeliverySettingsRoute() {
  const locale = useLocale();
  const search = Route.useSearch();
  const [sessionEnded, setSessionEnded] = useState(false);
  if (sessionEnded)
    return (
      <Alert variant="destructive">
        <p>{loginFormText('sessionEnded', locale)}</p>
        <Link to="/login" className="underline">
          {loginFormText('restart', locale)}
        </Link>
      </Alert>
    );
  return (
    <section className="mx-auto w-full min-w-0 max-w-3xl space-y-3">
      <Link
        to="/admin/notifications"
        search={search}
        className="touch-action text-sm text-primary underline underline-offset-4"
      >
        {t('admin.notifications.title', locale)}
      </Link>
      <Settings uiLocale={locale} headingLevel={1} onSessionEnded={() => setSessionEnded(true)} />
    </section>
  );
}
