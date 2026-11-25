import { useListQuery, writeListQuery } from '../../hooks/useListQuery.js';
import {
  staffContractFilters,
  staffContractQueryOptions,
  staffContractsSearch,
} from '../../lib/record-list-query.js';
import { createFileRoute } from '@tanstack/react-router';
import { redirectLegacyContract } from '../../lib/staff-contract-route.js';
import AdminContractsPage from '../../pages/AdminContractsPage.js';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
function ContractsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const change = (
    update: (raw: Record<string, unknown>) => Record<string, unknown>,
    options?: { replace?: boolean }
  ) =>
    void navigate({
      search: (raw) => staffContractFilters(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  const queue = useListQuery(staffContractQueryOptions, search, change);
  return (
    <AdminContractsPage
      recordSearch={staffContractFilters(search)}
      queries={{
        queue,
        selected: null,
        select: (contractId, options = {}) => {
          if (!contractId) return;
          void navigate({
            to: '/admin/contracts/$contractId/{-$action}/{-$item}',
            params: { contractId },
            search: staffContractFilters({
              ...search,
              ...(options.resetCursor ? { cursor: undefined } : {}),
            }),
            replace: options.replace ?? false,
          });
        },
        apply: (text, filters) =>
          change((raw) => ({
            ...writeListQuery(raw, staffContractQueryOptions, { search: text, filters }),
            contractId: undefined,
          })),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/contracts/')({
  validateSearch: staffContractsSearch,
  beforeLoad: ({ search, location }) => redirectLegacyContract(search, location.hash),
  component: ContractsRoute,
  pendingComponent: StaffRecordLoading,
});
