import { createFileRoute, notFound } from '@tanstack/react-router';
import { NotificationTemplateRouteWorkspace } from '../../components/NotificationTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { notificationTemplatesSearch } from '../../lib/template-catalogue-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

export const Route = createFileRoute('/admin/notifications/$templateId/')({
  validateSearch: notificationTemplatesSearch,
  component: TemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function TemplatesRoute() {
  const search = Route.useSearch();
  const templateId = adminEditorId(Route.useParams().templateId);
  if (!templateId) throw notFound();
  return (
    <NotificationTemplateRouteWorkspace view="detail" templateId={templateId} search={search} />
  );
}
