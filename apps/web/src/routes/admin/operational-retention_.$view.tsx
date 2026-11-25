import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary, RouteNotFound } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminOperationalRetentionPage.js'));

function SettingsView() {
  const { view } = Route.useParams();
  if (view !== 'edit' && view !== 'history') return <RouteNotFound />;
  return <Page key={view} view={view} />;
}

export const Route = createFileRoute('/admin/operational-retention_/$view')({
  component: SettingsView,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
