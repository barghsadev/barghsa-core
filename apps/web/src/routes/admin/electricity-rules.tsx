import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminElectricityRulesPage.js'));
export const Route = createFileRoute('/admin/electricity-rules')({
  component: () => <Page section="rules" view="overview" />,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
