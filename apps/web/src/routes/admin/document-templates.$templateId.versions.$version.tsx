import { createFileRoute, notFound } from '@tanstack/react-router';
import { DocumentTemplateRouteWorkspace } from '../../components/DocumentTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { documentTemplatesSearch } from '../../lib/template-catalogue-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

export const Route = createFileRoute('/admin/document-templates/$templateId/versions/$version')({
  validateSearch: documentTemplatesSearch,
  component: DocumentTemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function DocumentTemplatesRoute() {
  const search = Route.useSearch();
  const { templateId: id, version } = Route.useParams();
  const templateId = adminEditorId(id);
  const versionId = adminEditorId(version);
  if (!templateId || (version !== 'new' && !versionId)) throw notFound();
  return versionId ? (
    <DocumentTemplateRouteWorkspace
      view="version"
      templateId={templateId}
      versionId={versionId}
      search={search}
    />
  ) : (
    <DocumentTemplateRouteWorkspace view="publish" templateId={templateId} search={search} />
  );
}
