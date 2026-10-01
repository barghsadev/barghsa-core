import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  notificationInboxQueryOptions,
  notificationInboxSearch,
} from '../../lib/notification-inbox-query.js';
const Page = lazyRouteComponent(() => import('../../pages/StaffNotificationCenterPage.js'));
function InboxRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(notificationInboxQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => notificationInboxSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}

export const Route = createFileRoute('/admin/inbox')({
  validateSearch: notificationInboxSearch,
  component: InboxRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
