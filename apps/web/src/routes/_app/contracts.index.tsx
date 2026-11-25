import { removeHistoryFilter } from '../../lib/history-filter-state.js';
import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { DEFAULT_CONTRACT_LIST_SORT } from '@barghsa/shared/validation';
import { customerContractId, customerContractSearch } from '../../lib/customer-contract-search.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const ContractsPage = lazyRouteComponent(() => import('../../pages/ContractsPage.js'));
function ContractsRoute() {
  const search = Route.useSearch();
  const { state, statuses, from, to, q, sort, serviceType } = search;
  const navigate = Route.useNavigate();
  return (
    <ContractsPage
      activeOnly={state === 'Active'}
      recordSearch={customerContractSearch(search)}
      history={{
        onApply: (selection) =>
          void navigate({
            search: (current) => ({
              ...current,
              q: selection.query.q.trim() || undefined,
              sort:
                selection.query.sort === DEFAULT_CONTRACT_LIST_SORT
                  ? undefined
                  : selection.query.sort,
              serviceType: selection.query.serviceType,
              statuses: selection.statuses.join(',') || undefined,
              from: selection.dateRange.from,
              to: selection.dateRange.to,
            }),
          }),
        onRemoveFilter: (key, value) =>
          void navigate({ search: (current) => removeHistoryFilter(current, key, value) }),
        onClearStatuses: () =>
          void navigate({
            search: (current) => ({ ...current, state: undefined, statuses: undefined }),
          }),
        onClear: () =>
          void navigate({
            search: (current) => ({
              ...current,
              q: undefined,
              serviceType: undefined,
              state: undefined,
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

export const Route = createFileRoute('/_app/contracts/')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...customerContractSearch(search),
    contractId: customerContractId(search.contractId),
  }),
  beforeLoad: ({ search }) => {
    if (search.contractId)
      throw redirect({
        to: '/contracts/$contractId/{-$action}',
        params: { contractId: search.contractId },
        search: customerContractSearch(search),
        replace: true,
      });
  },
  component: ContractsRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
