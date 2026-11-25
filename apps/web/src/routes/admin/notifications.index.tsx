import { createFileRoute, redirect } from '@tanstack/react-router';
import { NotificationTemplateRouteWorkspace } from '../../components/NotificationTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { notificationTemplatesSearch } from '../../lib/template-catalogue-query.js';
import {
  deliveryHistoryWorkspaceSearch,
  failedNotificationPageSearch,
} from '../../lib/notification-panel-query.js';

export const Route = createFileRoute('/admin/notifications/')({
  validateSearch: notificationTemplatesSearch,
  beforeLoad: ({ search }) => {
    if (search.history_mode === 'all')
      throw redirect({
        to: '/admin/failed-notifications/history',
        search: deliveryHistoryWorkspaceSearch(search),
        replace: true,
      });
    if (search.history_mode === 'target')
      throw redirect({
        to: '/admin/failed-notifications',
        search: failedNotificationPageSearch(search),
        replace: true,
      });
  },
  component: TemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function TemplatesRoute() {
  return <NotificationTemplateRouteWorkspace view="list" search={Route.useSearch()} />;
}
