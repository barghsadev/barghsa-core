import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  notificationTemplateQueryOptions,
  notificationTemplatesSearch,
} from '../../lib/template-catalogue-query.js';

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
  return <Page queries={queries} />;
}

export const Route = createFileRoute('/admin/notifications')({
  validateSearch: notificationTemplatesSearch,
  component: NotificationTemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
