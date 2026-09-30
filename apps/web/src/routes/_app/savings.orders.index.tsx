import { removeHistoryFilter } from '../../lib/history-filter-state.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseDateRangeFilter,
  parseHistoryQuery,
  DEFAULT_HISTORY_SORT,
  parseStatusFilter,
  SAVING_ORDER_STATUSES,
} from '@barghsa/shared/validation';

const SavingOrdersPage = lazyRouteComponent(
  () => import('../../pages/SavingOrdersPage.js'),
  'SavingOrdersPage'
);

function SavingOrdersRoute() {
  const { status, statuses, from, to, q, sort } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SavingOrdersPage
      onRemoveFilter={(key, value) =>
        void navigate({ search: (current) => removeHistoryFilter(current, key, value) })
      }
      onClearFilters={() =>
        void navigate({
          search: (current) => ({
            ...current,
            q: undefined,
            statuses: undefined,
            from: undefined,
            to: undefined,
          }),
        })
      }
      query={{ q: q ?? '', sort: sort ?? DEFAULT_HISTORY_SORT }}
      onQueryChange={(query) =>
        void navigate({
          search: (current) => ({
            ...current,
            q: query.q || undefined,
            sort: query.sort === DEFAULT_HISTORY_SORT ? undefined : query.sort,
          }),
        })
      }
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
  validateSearch: (search: Record<string, unknown>) => {
    const query = parseHistoryQuery(search.q, search.sort) ?? { q: '', sort: DEFAULT_HISTORY_SORT };
    return {
      q: query.q || undefined,
      sort: query.sort === DEFAULT_HISTORY_SORT ? undefined : query.sort,
      ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
      status: search.status === 'pending' ? ('pending' as const) : undefined,
      statuses: parseStatusFilter(search.statuses, SAVING_ORDER_STATUSES)?.join(',') || undefined,
    };
  },
  component: SavingOrdersRoute,
});
