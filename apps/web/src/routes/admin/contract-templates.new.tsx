import { createFileRoute } from '@tanstack/react-router';
import { ContractTemplateRouteWorkspace } from '../../components/ContractTemplateRouteWorkspace.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/admin/contract-templates/new')({
  component: TemplateRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});

function TemplateRoute() {
  return <ContractTemplateRouteWorkspace view="new" />;
}
