import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { isMaintenanceCapability } from '../../lib/maintenance-capabilities.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminMaintenancePage.js'));
export const Route = createFileRoute('/admin/maintenance')({
  validateSearch: (raw: Record<string, unknown>) => ({
    selected: isMaintenanceCapability(raw.selected) ? raw.selected : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.selected)
      throw redirect({
        to: '/admin/maintenance/$capability/{-$action}',
        params: { capability: search.selected, action: 'edit' },
        replace: true,
      });
  },
  component: () => <Page workspace={{ view: 'list' }} />,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
