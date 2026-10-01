import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { failedJobQueryOptions, failedJobsSearch } from '../../lib/operations-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminFailedJobsPage.js'));
function FailedJobsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(failedJobQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => failedJobsSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}

export const Route = createFileRoute('/admin/failed-jobs')({
  validateSearch: failedJobsSearch,
  component: FailedJobsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
