import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/app/crm/')({
  validateSearch: (search: Record<string, unknown>) => ({
    verification: typeof search.verification === 'string' ? search.verification : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/admin/crm/', search, replace: true });
  },
});
