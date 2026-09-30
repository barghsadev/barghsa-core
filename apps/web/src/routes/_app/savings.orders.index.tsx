import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { parseStatusFilter, SAVING_ORDER_STATUSES } from '@barghsa/shared/validation';

const SavingOrdersPage = lazyRouteComponent(
  () => import('../../pages/SavingOrdersPage.js'),
  'SavingOrdersPage'
);

function SavingOrdersRoute() {
  const { status, statuses } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SavingOrdersPage
      pendingOnly={status === 'pending'}
      statuses={parseStatusFilter(statuses, SAVING_ORDER_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({ search: { status: undefined, statuses: selected.join(',') || undefined } })
      }
    />
  );
}

export const Route = createFileRoute('/_app/savings/orders/')({
  validateSearch: (search: Record<string, unknown>) => ({
    status: search.status === 'pending' ? ('pending' as const) : undefined,
    statuses: parseStatusFilter(search.statuses, SAVING_ORDER_STATUSES)?.join(',') || undefined,
  }),
  component: SavingOrdersRoute,
});
