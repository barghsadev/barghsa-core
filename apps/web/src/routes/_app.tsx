import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { DashboardLayout } from '../pages/DashboardLayout.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.js';
import { readSessionRole } from '../lib/session-role.js';

const StaffLayout = lazy(() => import('../pages/AdminLayout.js'));

function AppLayout() {
  const { isStaff } = Route.useRouteContext();
  if (!isStaff) return <DashboardLayout />;
  return (
    <Suspense fallback={<RouteSkeleton layout="admin" />}>
      <StaffLayout />
    </Suspense>
  );
}

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ abortController, location }) => {
    const isStaff = await readSessionRole(abortController.signal);
    if (isStaff === null) throw redirect({ to: '/login', replace: true });
    if (isStaff && location.pathname !== '/app') throw redirect({ to: '/app', replace: true });
    return { isStaff };
  },
  component: AppLayout,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
