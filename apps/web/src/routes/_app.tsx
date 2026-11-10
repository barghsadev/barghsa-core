import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { DashboardLayout } from '../pages/DashboardLayout.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { NavigationProvider } from '../hooks/useNavigation.js';
import { readSessionContext, isAccountSettingsPath } from '../lib/session-role.js';
import { rememberSessionEnded } from '../lib/session-ended-notice.js';

const StaffLayout = lazy(() => import('../pages/AdminLayout.js'));

function AppLayout() {
  const { isStaff, userId, navigation, navigationRevision } = Route.useRouteContext();
  return (
    <AccountUserProvider value={userId}>
      <NavigationProvider configuration={navigation} revision={navigationRevision}>
        {isStaff ? (
          <Suspense fallback={<RouteSkeleton layout="admin" />}>
            <StaffLayout />
          </Suspense>
        ) : (
          <DashboardLayout />
        )}
      </NavigationProvider>
    </AccountUserProvider>
  );
}

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ abortController, location, context, preload }) => {
    const session = context.appSession ?? (await readSessionContext(abortController.signal));
    if (session === null) {
      rememberSessionEnded(preload);
      throw redirect({ to: '/login', replace: true });
    }
    const isStaff = session.operatingContext === 'staff';
    if (isStaff && location.pathname !== '/app' && !isAccountSettingsPath(location.pathname))
      throw redirect({ to: '/app', replace: true });
    return {
      isStaff,
      userId: session.userId ?? null,
      navigation: session.navigation ?? null,
      navigationRevision: session.navigationRevision ?? 0,
    };
  },
  component: AppLayout,
  pendingComponent: () => <RouteSkeleton />,
  // Reveal the workspace as soon as the fresh session read succeeds.
  pendingMinMs: 0,
});
