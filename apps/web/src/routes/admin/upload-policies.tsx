import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
export const Route = createFileRoute('/admin/upload-policies')({
  component: lazyRouteComponent(() => import('../../pages/AdminUploadPoliciesPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
