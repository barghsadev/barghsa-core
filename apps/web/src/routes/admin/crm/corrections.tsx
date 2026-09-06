import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
export const Route = createFileRoute('/admin/crm/corrections')({
  validateSearch: (search: Record<string, unknown>) => ({
    profileId: typeof search.profileId === 'string' ? search.profileId : undefined,
  }),
  component: lazyRouteComponent(() => import('../../../pages/CrmCorrectionsPage.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
