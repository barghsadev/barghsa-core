import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  reconciliationQueueQueryOptions,
  reconciliationQueueSearch,
} from '../../lib/decision-queue-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminReconciliationPage.js'));
function QueueRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(reconciliationQueueQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => reconciliationQueueSearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return (
    <Page key={JSON.stringify(queries.query.filters)} queries={queries} recordSearch={search} />
  );
}
export const Route = createFileRoute('/admin/reconciliation/')({
  validateSearch: reconciliationQueueSearch,
  component: QueueRoute,
  pendingComponent: StaffRecordLoading,
});
