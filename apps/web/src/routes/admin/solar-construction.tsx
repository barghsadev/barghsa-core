import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  solarConstructionQueryOptions,
  solarConstructionSearch,
} from '../../lib/solar-construction-query.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(
  () => import('../../pages/AdminSolarConstructionPage.js'),
  'AdminSolarConstructionPage'
);
function ConstructionRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(solarConstructionQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => solarConstructionSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return (
    <Page
      queries={queries}
      selected={typeof search.requestId === 'string' ? search.requestId : null}
      onSelect={(id) => {
        void navigate({
          search: (raw) => solarConstructionSearch({ ...raw, requestId: id }),
          resetScroll: false,
        });
      }}
    />
  );
}
export const Route = createFileRoute('/admin/solar-construction')({
  validateSearch: solarConstructionSearch,
  component: ConstructionRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
