import { createFileRoute, redirect } from '@tanstack/react-router';
import { ContractTemplateRouteWorkspace } from '../../components/ContractTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { adminEditorId } from '../../lib/admin-editor-search.js';

import { contractTemplateRoutes } from '../../lib/template-catalogue-routes.js';

export const Route = createFileRoute('/admin/contract-templates/')({
  validateSearch: (raw: Record<string, unknown>) => ({
    selected: raw.selected === 'new' ? 'new' : adminEditorId(raw.selected),
  }),
  beforeLoad: ({ search }) => {
    if (search.selected === 'new')
      throw redirect({ to: contractTemplateRoutes.new, replace: true });
    if (search.selected)
      throw redirect({
        to: contractTemplateRoutes.edit,
        params: { templateId: search.selected },
        replace: true,
      });
  },
  component: TemplateRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function TemplateRoute() {
  return <ContractTemplateRouteWorkspace view="list" />;
}
