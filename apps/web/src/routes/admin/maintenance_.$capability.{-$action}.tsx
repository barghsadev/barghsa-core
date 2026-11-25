import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { isMaintenanceCapability } from '../../lib/maintenance-capabilities.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminMaintenancePage.js'));

function ServiceMaintenanceRoute() {
  const { capability, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (!isMaintenanceCapability(capability) || (action && action !== 'edit')) throw notFound();
  return (
    <Page
      key={`${capability}/${action ?? ''}`}
      workspace={{
        capability,
        view: action === 'edit' ? 'editor' : 'detail',
        showDetail: (replace = false) =>
          void navigate({
            to: '/admin/maintenance/$capability/{-$action}',
            params: { capability, action: undefined },
            replace,
          }),
      }}
    />
  );
}

export const Route = createFileRoute('/admin/maintenance_/$capability/{-$action}')({
  component: ServiceMaintenanceRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
