import { createFileRoute, notFound } from '@tanstack/react-router';
import { ContractTemplateRouteWorkspace } from '../../components/ContractTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

export const Route = createFileRoute('/admin/contract-templates/$templateId/')({
  component: TemplateRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function TemplateRoute() {
  const templateId = adminEditorId(Route.useParams().templateId);
  if (!templateId) throw notFound();
  return <ContractTemplateRouteWorkspace view="detail" templateId={templateId} />;
}
