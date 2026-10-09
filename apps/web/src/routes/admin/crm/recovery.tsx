import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
export const Route = createFileRoute('/admin/crm/recovery')({
  component: lazyRouteComponent(() => import('../../../pages/AccountRecoveryPage.js'), 'default'),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
