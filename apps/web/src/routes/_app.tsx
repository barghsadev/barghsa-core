import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { DashboardLayout } from '../pages/DashboardLayout.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { readSessionContext, isAccountSettingsPath } from '../lib/session-role.js';

const StaffLayout = lazy(() => import('../pages/AdminLayout.js'));

function AppLayout() {
  const { isStaff, userId } = Route.useRouteContext();
  return (
    <AccountUserProvider value={userId}>
      {isStaff ? (
        <Suspense fallback={<RouteSkeleton layout="admin" />}>
          <StaffLayout />
        </Suspense>
      ) : (
        <DashboardLayout />
      )}
    </AccountUserProvider>
  );
}

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ abortController, location }) => {
    const session = await readSessionContext(abortController.signal);
    if (session === null) throw redirect({ to: '/login', replace: true });
    const isStaff = session.operatingContext === 'staff';
    if (isStaff && location.pathname !== '/app' && !isAccountSettingsPath(location.pathname))
      throw redirect({ to: '/app', replace: true });
    return { isStaff, userId: session.userId ?? null };
  },
  component: AppLayout,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
