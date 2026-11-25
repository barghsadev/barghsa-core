import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Storage = lazyRouteComponent(() => import('../../pages/AdminStorageConfig.js'));

export const Route = createFileRoute('/admin/storage')({
  component: () => <Storage section="overview" />,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
