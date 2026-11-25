import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Storage = lazyRouteComponent(() => import('../../pages/AdminStorageConfig.js'));

function StorageRoute() {
  const { section } = Route.useParams();
  if (section !== 'edit' && section !== 'cleanup') throw notFound();
  return <Storage key={section} section={section} />;
}

export const Route = createFileRoute('/admin/storage_/$section')({
  component: StorageRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
