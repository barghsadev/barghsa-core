import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/electricity/advanced')({
  validateSearch: (search): { step?: unknown } => ({ step: search.step }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/electricity/orders/new/advanced', search, replace: true });
  },
});
