import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { roleComparisonQueryOptions, roleComparisonSearch } from '../../lib/staff-access-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminRolesPage.js'));
function RolesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(roleComparisonQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => roleComparisonSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page variant="compare" queries={queries} />;
}
export const Route = createFileRoute('/admin/roles/compare')({
  validateSearch: roleComparisonSearch,
  component: RolesRoute,
  pendingComponent: StaffRecordLoading,
});
