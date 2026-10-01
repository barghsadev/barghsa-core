import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { approvalQueueQueryOptions, approvalQueueSearch } from '../../lib/decision-queue-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminApprovalRequestsPage.js'));
function QueueRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(approvalQueueQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => approvalQueueSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} />;
}
export const Route = createFileRoute('/admin/approval-requests')({
  validateSearch: approvalQueueSearch,
  component: QueueRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
