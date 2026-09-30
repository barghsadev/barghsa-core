import { removeHistoryFilter } from '../../lib/history-filter-state.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseDateRangeFilter,
  parseHistoryQuery,
  DEFAULT_HISTORY_SORT,
  parseStatusFilter,
  SOLAR_REQUEST_STATUSES,
} from '@barghsa/shared/validation';
const SolarRequestsPage = lazyRouteComponent(
  () => import('../../pages/SolarRequestsPage.js'),
  'SolarRequestsPage'
);
function SolarRequestsRoute() {
  const { statuses, from, to, q, sort } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SolarRequestsPage
      onApplyFilters={(selection) =>
        void navigate({
          search: (current) => ({
            ...current,
            q: selection.query.q.trim() || undefined,
            sort: selection.query.sort === DEFAULT_HISTORY_SORT ? undefined : selection.query.sort,
            statuses: selection.statuses.join(',') || undefined,
            from: selection.dateRange.from,
            to: selection.dateRange.to,
          }),
        })
      }
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
      statuses={parseStatusFilter(statuses, SOLAR_REQUEST_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({
          search: (current) => ({ ...current, statuses: selected.join(',') || undefined }),
        })
      }
    />
  );
}
export const Route = createFileRoute('/_app/solar/requests/')({
  validateSearch: (search: Record<string, unknown>) => {
    const query = parseHistoryQuery(search.q, search.sort) ?? { q: '', sort: DEFAULT_HISTORY_SORT };
    return {
      q: query.q || undefined,
      sort: query.sort === DEFAULT_HISTORY_SORT ? undefined : query.sort,
      ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
      statuses: parseStatusFilter(search.statuses, SOLAR_REQUEST_STATUSES)?.join(',') || undefined,
    };
  },
  component: SolarRequestsRoute,
});
