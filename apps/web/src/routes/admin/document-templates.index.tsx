import { createFileRoute, redirect } from '@tanstack/react-router';
import { DocumentTemplateRouteWorkspace } from '../../components/DocumentTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { documentTemplatesSearch } from '../../lib/template-catalogue-query.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

import { documentTemplateRoutes } from '../../lib/template-catalogue-routes.js';

export const Route = createFileRoute('/admin/document-templates/')({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...documentTemplatesSearch(raw),
    selected: raw.selected === 'new' ? 'new' : adminEditorId(raw.selected),
    mode: raw.mode === 'edit' ? 'edit' : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.selected === 'new')
      throw redirect({
        to: documentTemplateRoutes.new,
        search: documentTemplatesSearch(search),
        replace: true,
      });
    if (search.selected)
      throw redirect({
        to: search.mode === 'edit' ? documentTemplateRoutes.edit : documentTemplateRoutes.detail,
        params: { templateId: search.selected },
        search: documentTemplatesSearch(search),
        replace: true,
      });
  },
  component: DocumentTemplatesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function DocumentTemplatesRoute() {
  return <DocumentTemplateRouteWorkspace view="list" search={Route.useSearch()} />;
}
