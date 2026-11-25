import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  solarConstructionQueryOptions,
  solarConstructionQueueSearch,
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
    <Page queries={queries} selected={null} queueSearch={solarConstructionQueueSearch(search)} />
  );
}
export const Route = createFileRoute('/admin/solar-construction')({
  validateSearch: solarConstructionSearch,
  beforeLoad: ({ search }) => {
    if (typeof search.requestId === 'string')
      throw redirect({
        to: '/admin/solar-requests/$requestId/construction/{-$operation}',
        params: { requestId: search.requestId },
        search: solarConstructionQueueSearch(search),
        replace: true,
      });
  },
  component: ConstructionRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
