import { createFileRoute, notFound } from '@tanstack/react-router';
import { DocumentTemplateRouteWorkspace } from '../../components/DocumentTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { documentTemplatesSearch } from '../../lib/template-catalogue-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

export const Route = createFileRoute('/admin/document-templates/$templateId/edit')({
  validateSearch: documentTemplatesSearch,
  component: DocumentTemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function DocumentTemplatesRoute() {
  const search = Route.useSearch();
  const templateId = adminEditorId(Route.useParams().templateId);
  if (!templateId) throw notFound();
  return <DocumentTemplateRouteWorkspace view="edit" templateId={templateId} search={search} />;
}
