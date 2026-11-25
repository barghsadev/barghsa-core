import { createFileRoute } from '@tanstack/react-router';
import { NotificationTemplateRouteWorkspace } from '../../components/NotificationTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { notificationTemplatesSearch } from '../../lib/template-catalogue-query.js';

export const Route = createFileRoute('/admin/notifications/new')({
  validateSearch: notificationTemplatesSearch,
  component: TemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function TemplatesRoute() {
  return <NotificationTemplateRouteWorkspace view="new" search={Route.useSearch()} />;
}
