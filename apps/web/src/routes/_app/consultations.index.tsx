import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseDateRangeFilter,
  parseHistoryQuery,
  DEFAULT_HISTORY_SORT,
  parseStatusFilter,
  CONSULTATION_REQUEST_STATUSES,
} from '@barghsa/shared/validation';

const ConsultationsPage = lazyRouteComponent(
  () => import('../../pages/ConsultationsPage.js'),
  'ConsultationsPage'
);
function ConsultationsRoute() {
  const { statuses, from, to, q, sort } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ConsultationsPage
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
      statuses={parseStatusFilter(statuses, CONSULTATION_REQUEST_STATUSES) ?? []}
      onStatusesChange={(selected) =>
        void navigate({
          search: (current) => ({ ...current, statuses: selected.join(',') || undefined }),
        })
      }
    />
  );
}

export const Route = createFileRoute('/_app/consultations/')({
  validateSearch: (search: Record<string, unknown>) => {
    const query = parseHistoryQuery(search.q, search.sort) ?? { q: '', sort: DEFAULT_HISTORY_SORT };
    return {
      q: query.q || undefined,
      sort: query.sort === DEFAULT_HISTORY_SORT ? undefined : query.sort,
      ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
      statuses:
        parseStatusFilter(search.statuses, CONSULTATION_REQUEST_STATUSES)?.join(',') || undefined,
    };
  },
  component: ConsultationsRoute,
});
