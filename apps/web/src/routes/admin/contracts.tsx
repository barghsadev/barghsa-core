import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import { staffContractQueryOptions, staffContractsSearch } from '../../lib/record-list-query.js';
import { createFileRoute } from '@tanstack/react-router';
import AdminContractsPage from '../../pages/AdminContractsPage.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
function ContractsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (raw) => staffContractsSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(staffContractQueryOptions, search, change);
  return (
    <AdminContractsPage
      queries={{
        queue,
        selected: typeof search.contractId === 'string' ? search.contractId : null,
        select: (id, options = {}) =>
          change(
            (raw) => ({
              ...raw,
              contractId: id ?? undefined,
              ...(options.resetCursor ? { cursor: undefined } : {}),
            }),
            options
          ),
        apply: (text, filters) =>
          change((raw) => ({
            ...writeListQuery(raw, staffContractQueryOptions, { search: text, filters }),
            contractId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/contracts')({
  validateSearch: staffContractsSearch,
  component: ContractsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
