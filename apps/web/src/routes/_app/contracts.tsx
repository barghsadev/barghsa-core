import { removeHistoryFilter } from '../../lib/history-filter-state.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  parseStatusFilter,
  parseDateRangeFilter,
  parseContractListQuery,
  CUSTOMER_CONTRACT_STATUSES,
  DEFAULT_CONTRACT_LIST_SORT,
} from '@barghsa/shared/validation';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const ContractsPage = lazyRouteComponent(() => import('../../pages/ContractsPage.js'));
function ContractsRoute() {
  const { state, statuses, from, to, q, sort, serviceType } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ContractsPage
      activeOnly={state === 'Active'}
      history={{
        onRemoveFilter: (key, value) =>
          void navigate({ search: (current) => removeHistoryFilter(current, key, value) }),
        onClear: () =>
          void navigate({
            search: (current) => ({
              ...current,
              q: undefined,
              serviceType: undefined,
              statuses: undefined,
              from: undefined,
              to: undefined,
            }),
          }),
        query: { q: q ?? '', sort: sort ?? DEFAULT_CONTRACT_LIST_SORT, serviceType },
        statuses: statuses?.split(',') ?? [],
        dateRange: { from, to },
        onQueryChange: (query) =>
          void navigate({
            search: (current) => ({
              ...current,
              q: query.q || undefined,
              serviceType: query.serviceType,
              sort: query.sort === DEFAULT_CONTRACT_LIST_SORT ? undefined : query.sort,
            }),
          }),
        onStatusesChange: (selected) =>
          void navigate({
            search: (current) => ({ ...current, statuses: selected.join(',') || undefined }),
          }),
        onDateRangeChange: (range) =>
          void navigate({ search: (current) => ({ ...current, from: range.from, to: range.to }) }),
      }}
    />
  );
}

export const Route = createFileRoute('/_app/contracts')({
  validateSearch: (search: Record<string, unknown>) => {
    const query = parseContractListQuery(search.q, search.sort, search.serviceType) ?? {
      q: '',
      sort: DEFAULT_CONTRACT_LIST_SORT,
      serviceType: undefined,
    };
    return {
      state: search.state === 'Active' ? ('Active' as const) : undefined,
      statuses:
        parseStatusFilter(search.statuses, CUSTOMER_CONTRACT_STATUSES)?.join(',') || undefined,
      ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
      q: query.q || undefined,
      sort: query.sort === DEFAULT_CONTRACT_LIST_SORT ? undefined : query.sort,
      serviceType: query.serviceType,
      contractId:
        typeof search.contractId === 'string' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(search.contractId)
          ? search.contractId
          : undefined,
    };
  },
  component: ContractsRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
