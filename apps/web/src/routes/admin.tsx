import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.js';
import { readSessionRole } from '../lib/session-role.js';

/**
 * Admin layout — renders sidebar navigation with lazy-loaded child routes.
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ abortController }) => {
    const isStaff = await readSessionRole(abortController.signal);
    if (isStaff === null) throw redirect({ to: '/login', replace: true });
    if (!isStaff) throw redirect({ to: '/app', replace: true });
    return { isStaff };
  },
  component: lazyRouteComponent(() => import('../pages/AdminLayout.js')),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
