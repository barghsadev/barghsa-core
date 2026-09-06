import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
export const Route = createFileRoute('/admin/policies')({
  component: lazyRouteComponent(() => import('../../pages/AdminAiPoliciesPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
