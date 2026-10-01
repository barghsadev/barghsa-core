import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  failedNotificationQueryOptions,
  failedNotificationsSearch,
} from '../../lib/notification-panel-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminFailedNotificationsPage.js'));
function FailedNotificationsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(failedNotificationQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => failedNotificationsSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}
export const Route = createFileRoute('/admin/failed-notifications')({
  validateSearch: failedNotificationsSearch,
  component: FailedNotificationsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
