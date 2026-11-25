import { createFileRoute, Link } from '@tanstack/react-router';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { NotificationDeliveryHistory } from '../../components/NotificationDeliveryHistory.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { useLocale } from '../../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../../hooks/useCatalogueResource.js';
import { Alert, Button, LoadingStatus } from '@barghsa/ui';
import { deliveryHistoryWorkspaceSearch } from '../../lib/notification-panel-query.js';
import { deliveryHistoryQueryOptions } from '../../lib/operations-list-query.js';

export const Route = createFileRoute('/admin/failed-notifications_/history')({
  validateSearch: deliveryHistoryWorkspaceSearch,
  component: HistoryRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function HistoryRoute() {
  const locale = useLocale();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(deliveryHistoryQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => deliveryHistoryWorkspaceSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const scope = useCatalogueScope();
  const access = useCatalogueResource(
    scope,
    '/api/admin/failed-notifications/access',
    isDeliveryAccess
  );
  const denied = scope.denied || access.data?.canView === false;
  return (
    <section className="min-w-0 space-y-4">
      <Link
        to="/admin/failed-notifications"
        search={search}
        className="touch-action text-sm text-primary underline underline-offset-4"
      >
        {t('admin.notifications.deadLetter.title', locale)}
      </Link>
      <h1 className="text-2xl font-semibold">{t('admin.notifications.history.title', locale)}</h1>
      {denied ? (
        <Alert variant="destructive">
          {t('admin.notifications.deadLetter.accessDenied', locale)}
        </Alert>
      ) : access.error ? (
        <Alert variant="destructive">
          {t('admin.notifications.history.loadFailed', locale)}
          <Button type="button" variant="outline" onClick={access.retry}>
            {t('admin.jobs.reload', locale)}
          </Button>
        </Alert>
      ) : access.loading ? (
        <LoadingStatus>{t('admin.notifications.history.loading', locale)}</LoadingStatus>
      ) : (
        access.data?.canView && (
          <NotificationDeliveryHistory
            standalone
            locale={locale}
            queries={queries}
            onDenied={scope.deny}
          />
        )
      )}
    </section>
  );
}

function isDeliveryAccess(value: unknown): value is { canView: boolean } {
  return (
    !!value && typeof value === 'object' && 'canView' in value && typeof value.canView === 'boolean'
  );
}
