import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminOperationalRetentionPage.js'));

export const Route = createFileRoute('/admin/operational-retention')({
  component: () => <Page view="overview" />,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
