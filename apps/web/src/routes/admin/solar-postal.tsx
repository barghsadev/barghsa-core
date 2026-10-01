import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import { solarPostalQueryOptions, solarPostalSearch } from '../../lib/solar-staff-query.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(
  () => import('../../pages/AdminSolarPostalPage.js'),
  'AdminSolarPostalPage'
);
function PostalRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(solarPostalQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => solarPostalSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}
export const Route = createFileRoute('/admin/solar-postal')({
  validateSearch: solarPostalSearch,
  component: PostalRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
