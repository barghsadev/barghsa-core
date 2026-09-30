import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseDateRangeFilter,
  parseStatusFilter,
  SAVING_ORDER_STATUSES,
} from '@barghsa/shared/validation';

const SavingOrdersPage = lazyRouteComponent(
  () => import('../../pages/SavingOrdersPage.js'),
  'SavingOrdersPage'
);

function SavingOrdersRoute() {
  const { status, statuses, from, to } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SavingOrdersPage
      dateRange={{ from, to }}
      onDateRangeChange={(range) =>
        void navigate({
          search: (current) => ({ ...current, ...range, from: range.from, to: range.to }),
        })
      }
      pendingOnly={status === 'pending'}
      statuses={parseStatusFilter(statuses, SAVING_ORDER_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({
          search: (current) => ({
            ...current,
            status: undefined,
            statuses: selected.join(',') || undefined,
          }),
        })
      }
    />
  );
}

export const Route = createFileRoute('/_app/savings/orders/')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
    status: search.status === 'pending' ? ('pending' as const) : undefined,
    statuses: parseStatusFilter(search.statuses, SAVING_ORDER_STATUSES)?.join(',') || undefined,
  }),
  component: SavingOrdersRoute,
});
