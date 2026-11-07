import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { readSessionContext } from '../lib/session-role.js';
import { rememberSessionEnded } from '../lib/session-ended-notice.js';

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async ({ abortController, preload }) => {
    const session = await readSessionContext(abortController.signal);
    if (session === null) {
      rememberSessionEnded(preload);
      throw redirect({ to: '/login', replace: true });
    }
    if (session.operatingContext === 'staff') throw redirect({ to: '/app', replace: true });
    return { onboardingUserId: session.userId };
  },
  component: () => (
    <main id="main-content" tabIndex={-1}>
      <Outlet />
    </main>
  ),
});
