import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { approvalQueueFilters } from '../../lib/decision-queue-query.js';

const Settings = lazyRouteComponent(() => import('../../pages/AdminFinancialLimitPage.js'));

function ApprovalThresholdsRoute() {
  const { view } = Route.useParams();
  return <Settings key={view} kind="threshold" viewParam={view} search={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/approval-requests/thresholds/{-$view}')({
  validateSearch: approvalQueueFilters,
  component: ApprovalThresholdsRoute,
  pendingComponent: StaffRecordLoading,
});
