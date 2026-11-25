import { createFileRoute, lazyRouteComponent, useLocation } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Branding = lazyRouteComponent(() => import('../../pages/AdminBrandingConfig.js'));

function BrandingRoute() {
  const editing = useLocation({
    select: (location) => location.pathname.replace(/\/$/, '') === '/admin/branding/edit',
  });
  const navigate = Route.useNavigate();
  const onEditingChange = useCallback(
    (open: boolean) => void navigate({ to: open ? '/admin/branding/edit' : '/admin/branding' }),
    [navigate]
  );
  return <Branding routeEditing={editing} onEditingChange={onEditingChange} />;
}

export const Route = createFileRoute('/admin/branding')({
  component: BrandingRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
