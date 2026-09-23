import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/admin/saving-orders')({
  component: lazyRouteComponent(() => import('../../pages/AdminSavingOrdersPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
