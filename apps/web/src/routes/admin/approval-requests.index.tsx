import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  approvalQueueFilters,
  approvalQueueQueryOptions,
  approvalQueueSearch,
  redirectToApprovalRequest,
} from '../../lib/decision-queue-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminApprovalRequestsPage.js'));
function QueueRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(approvalQueueQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => approvalQueueFilters(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page queries={queries} recordSearch={approvalQueueFilters(search)} />;
}
export const Route = createFileRoute('/admin/approval-requests/')({
  validateSearch: approvalQueueSearch,
  beforeLoad: ({ search }) => {
    if (!search.requestId) return;
    const { requestId } = search;
    redirectToApprovalRequest({ requestId, decision: undefined }, approvalQueueFilters(search));
  },
  component: QueueRoute,
  pendingComponent: StaffRecordLoading,
});
