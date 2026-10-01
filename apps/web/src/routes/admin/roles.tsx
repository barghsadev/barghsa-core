import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
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
  return <Page queries={queries} />;
}
export const Route = createFileRoute('/admin/roles')({
  validateSearch: roleComparisonSearch,
  component: RolesRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
