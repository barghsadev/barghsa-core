import { removeHistoryFilter } from '../../../lib/history-filter-state.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseStatusFilter,
  parseDateRangeFilter,
  parseHistoryQuery,
  ELECTRICITY_ORDER_STATUSES,
  DEFAULT_HISTORY_SORT,
} from '@barghsa/shared/validation';

const ElectricityOrdersPage = lazyRouteComponent(
  () => import('../../../pages/ElectricityOrdersPage.js'),
  'ElectricityOrdersPage'
);

function ElectricityOrdersRoute() {
  const { status, statuses, from, to, q, sort } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ElectricityOrdersPage
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
      pendingOnly={status === 'pending'}
      statuses={statuses?.split(',') ?? []}
      onStatusesChange={(selected) =>
        void navigate({
          search: (current) => ({ ...current, statuses: selected.join(',') || undefined }),
        })
      }
      dateRange={{ from, to }}
      onDateRangeChange={(range) =>
        void navigate({ search: (current) => ({ ...current, from: range.from, to: range.to }) })
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
    />
  );
}

export const Route = createFileRoute('/_app/electricity/orders/')({
  validateSearch: (search: Record<string, unknown>) => {
    const query = parseHistoryQuery(search.q, search.sort) ?? { q: '', sort: DEFAULT_HISTORY_SORT };
    return {
      status: search.status === 'pending' ? ('pending' as const) : undefined,
      statuses:
        parseStatusFilter(search.statuses, ELECTRICITY_ORDER_STATUSES)?.join(',') || undefined,
      ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
      q: query.q || undefined,
      sort: query.sort === DEFAULT_HISTORY_SORT ? undefined : query.sort,
    };
  },
  component: ElectricityOrdersRoute,
});
