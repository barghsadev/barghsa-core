import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { readSessionContext } from '../lib/session-role.js';

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async ({ abortController }) => {
    const session = await readSessionContext(abortController.signal);
    if (session === null) throw redirect({ to: '/login', replace: true });
    if (session.operatingContext === 'staff') throw redirect({ to: '/app', replace: true });
  },
  component: Outlet,
});
