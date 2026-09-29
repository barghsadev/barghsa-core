import { createFileRoute, redirect } from '@tanstack/react-router';
import { readSessionRole } from '../lib/session-role.js';

export const Route = createFileRoute('/')({
  beforeLoad: async ({ abortController }) => {
    if ((await readSessionRole(abortController.signal)) === null)
      throw redirect({ to: '/login', replace: true });
    throw redirect({ to: '/app', replace: true });
  },
});
