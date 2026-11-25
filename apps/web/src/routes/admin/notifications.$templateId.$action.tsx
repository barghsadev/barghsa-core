import { createFileRoute, notFound } from '@tanstack/react-router';
import { NotificationTemplateRouteWorkspace } from '../../components/NotificationTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';
import { notificationTemplatesSearch } from '../../lib/template-catalogue-query.js';
import { notificationTemplateActions } from '../../lib/template-catalogue-routes.js';

export const Route = createFileRoute('/admin/notifications/$templateId/$action')({
  validateSearch: notificationTemplatesSearch,
  component: NotificationActionRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function NotificationActionRoute() {
  const search = Route.useSearch();
  const { templateId: rawId, action } = Route.useParams();
  const templateId = adminEditorId(rawId);
  const view = (
    Object.keys(notificationTemplateActions) as (keyof typeof notificationTemplateActions)[]
  ).find((key) => notificationTemplateActions[key] === action);
  if (!templateId || !view) throw notFound();
  return <NotificationTemplateRouteWorkspace view={view} templateId={templateId} search={search} />;
}
