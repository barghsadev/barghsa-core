import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { approvalQueueFilters, redirectToApprovalRequest } from '../../lib/decision-queue-query.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminApprovalRequestsPage.js'));

function ApprovalRequestRoute() {
  const { requestId, decision } = Route.useParams();
  if (decision && decision !== 'reject') throw notFound();
  return <Page requestId={requestId} decision={decision} recordSearch={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/approval-requests/$requestId/{-$decision}')({
  validateSearch: approvalQueueFilters,
  beforeLoad: ({ params, search }) => {
    const requestId = params.requestId.trim().toLowerCase();
    if (!isInvoiceUuid(requestId)) throw notFound();
    if (requestId !== params.requestId) redirectToApprovalRequest({ ...params, requestId }, search);
  },
  component: ApprovalRequestRoute,
  pendingComponent: StaffRecordLoading,
});
