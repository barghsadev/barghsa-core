import { createFileRoute } from '@tanstack/react-router';
import { SavingOrdersPage } from '../../pages/SavingOrdersPage.js';

function SavingOrdersRoute() {
  const { status } = Route.useSearch();
  return <SavingOrdersPage key={status ?? 'all'} pendingOnly={status === 'pending'} />;
}

export const Route = createFileRoute('/_app/savings/orders/')({
  validateSearch: (search: Record<string, unknown>) => ({
    status: search.status === 'pending' ? ('pending' as const) : undefined,
  }),
  component: SavingOrdersRoute,
});
