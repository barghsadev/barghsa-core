import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Verification = lazyRouteComponent(() => import('../../pages/AdminVerificationConfig.js'));

export const Route = createFileRoute('/admin/verification')({
  component: () => <Verification section="mode" />,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
