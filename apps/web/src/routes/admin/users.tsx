import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { staffDirectoryQueryOptions, staffDirectorySearch } from '../../lib/staff-access-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminStaffUsersPage.js'));
function StaffUsersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(staffDirectoryQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => staffDirectorySearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}
export const Route = createFileRoute('/admin/users')({
  validateSearch: staffDirectorySearch,
  component: StaffUsersRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
