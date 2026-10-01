import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  notificationTemplateQueryOptions,
  notificationTemplatesSearch,
} from '../../lib/template-catalogue-query.js';
import {
  previewQueryOptions,
  failedNotificationQueryOptions,
} from '../../lib/notification-panel-query.js';
import { deliveryHistoryQueryOptions } from '../../lib/operations-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminNotificationsPage.js'));
function NotificationTemplatesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(notificationTemplateQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => notificationTemplatesSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const navigatePanel = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) => {
    void navigate({
      search: (raw) => notificationTemplatesSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  };
  const previewQueries = useListQuery(previewQueryOptions, search, navigatePanel);
  const failedQueries = useListQuery(failedNotificationQueryOptions, search, navigatePanel);
  const historyQueries = useListQuery(deliveryHistoryQueryOptions, search, navigatePanel);
  return (
    <Page
      queries={queries}
      previewQueries={previewQueries}
      failedQueries={failedQueries}
      historyQueries={historyQueries}
    />
  );
}

export const Route = createFileRoute('/admin/notifications')({
  validateSearch: notificationTemplatesSearch,
  component: NotificationTemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
