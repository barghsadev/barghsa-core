import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { electricityIncreaseSearch } from '../../lib/electricity-change-query.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminElectricityIncreasesPage.js'));

function IncreaseRecordRoute() {
  const { requestId, decision } = Route.useParams();
  if (decision && decision !== 'approve' && decision !== 'reject') throw notFound();
  return (
    <Page
      key={requestId}
      recordId={requestId}
      recordDecision={decision}
      queueSearch={Route.useSearch()}
    />
  );
}

export const Route = createFileRoute('/admin/electricity-increases/$requestId/{-$decision}')({
  validateSearch: electricityIncreaseSearch,
  beforeLoad: ({ params, search }) => {
    const requestId = staffOrderId(params.requestId).toLowerCase();
    if (!requestId) throw notFound();
    if (params.requestId !== requestId)
      throw redirect({
        to: '/admin/electricity-increases/$requestId/{-$decision}',
        params: { ...params, requestId },
        search,
        replace: true,
      });
  },
  component: IncreaseRecordRoute,
  pendingComponent: StaffRecordLoading,
});
