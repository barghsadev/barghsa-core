import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import { readSessionContext } from '../lib/session-role.js';
import { rememberSessionEnded } from '../lib/session-ended-notice.js';

/**
 * Admin layout — renders sidebar navigation with lazy-loaded child routes.
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ abortController, preload }) => {
    const session = await readSessionContext(abortController.signal);
    if (session === null) {
      rememberSessionEnded(preload);
      throw redirect({ to: '/login', replace: true });
    }
    if (session.operatingContext !== 'staff') throw redirect({ to: '/app', replace: true });
    return {
      isStaff: true,
      userId: session.userId ?? null,
      navigation: session.navigation ?? null,
      navigationRevision: session.navigationRevision ?? 0,
    };
  },
  component: lazyRouteComponent(() => import('../pages/AdminLayout.js'), 'AdminContextLayout'),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
});
