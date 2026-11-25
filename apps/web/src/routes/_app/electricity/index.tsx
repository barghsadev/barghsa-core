import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

const ElectricityIndexPage = lazyRouteComponent(
  () => import('../../../pages/ElectricityIndexPage.js')
);

export const Route = createFileRoute('/_app/electricity/')({
  component: ElectricityIndexPage,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
