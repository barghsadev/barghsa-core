import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const Page = lazyRouteComponent(
  () => import('../../pages/AdminElectricityPriceAdjustmentsPage.js')
);

function PriceHistoryRoute() {
  const { contractId } = Route.useParams();
  return <Page key={contractId} routeContractId={contractId} view="history" />;
}

export const Route = createFileRoute('/admin/electricity-price-adjustments/$contractId/')({
  beforeLoad: ({ params }) => {
    const contractId = staffOrderId(params.contractId).toLowerCase();
    if (!contractId) throw notFound();
    if (params.contractId !== contractId)
      throw redirect({
        to: '/admin/electricity-price-adjustments/$contractId',
        params: { contractId },
        replace: true,
      });
  },
  component: PriceHistoryRoute,
  pendingComponent: StaffRecordLoading,
});
