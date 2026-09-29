import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { readSessionRole } from '../lib/session-role.js';

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async ({ abortController }) => {
    const isStaff = await readSessionRole(abortController.signal);
    if (isStaff === null) throw redirect({ to: '/login', replace: true });
    if (isStaff) throw redirect({ to: '/app', replace: true });
  },
  component: Outlet,
});
