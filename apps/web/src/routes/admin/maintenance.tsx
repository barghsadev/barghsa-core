import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminMaintenancePage.js'));
function MaintenanceRoute() {
  const raw: Record<string, unknown> = Route.useSearch();
  const id =
    typeof raw.selected === 'string' && /^[a-z0-9_-]{1,128}$/.test(raw.selected)
      ? raw.selected
      : null;
  const navigate = Route.useNavigate();
  const set = useCallback(
    (id: string | null, replace = false) => {
      void navigate({ search: { selected: id ?? undefined }, replace, resetScroll: false });
    },
    [navigate]
  );
  return <Page selection={{ id, set }} />;
}

export const Route = createFileRoute('/admin/maintenance')({
  component: MaintenanceRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
