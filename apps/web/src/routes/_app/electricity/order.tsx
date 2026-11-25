import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/electricity/order')({
  validateSearch: (search: Record<string, unknown>): { step?: unknown } => ({
    step: search.step,
  }),
  beforeLoad: ({ search }) => {
    const step =
      search.step === undefined ? undefined : search.step === 5 || search.step === '5' ? 2 : 1;
    throw redirect({ to: '/electricity/orders/new', search: { step }, replace: true });
  },
});
