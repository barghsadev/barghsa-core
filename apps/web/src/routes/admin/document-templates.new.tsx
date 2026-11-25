import { createFileRoute } from '@tanstack/react-router';
import { DocumentTemplateRouteWorkspace } from '../../components/DocumentTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { documentTemplatesSearch } from '../../lib/template-catalogue-query.js';

export const Route = createFileRoute('/admin/document-templates/new')({
  validateSearch: documentTemplatesSearch,
  component: DocumentTemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function DocumentTemplatesRoute() {
  return <DocumentTemplateRouteWorkspace view="new" search={Route.useSearch()} />;
}
