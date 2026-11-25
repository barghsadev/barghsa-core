import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const Page = lazyRouteComponent(
  () => import('../../pages/AdminElectricityPriceAdjustmentsPage.js')
);

function PriceAdjustmentRoute() {
  const { contractId, adjustmentId, decision } = Route.useParams();
  const navigate = Route.useNavigate();
  if (decision && decision !== 'finalize' && decision !== 'cancel') throw notFound();
  return (
    <Page
      key={`${adjustmentId}:${decision ?? ''}`}
      routeContractId={contractId}
      adjustmentId={adjustmentId}
      view={decision || 'adjustment'}
      onDecisionRecorded={() =>
        void navigate({
          to: '/admin/electricity-price-adjustments/$contractId/$adjustmentId/{-$decision}',
          params: { contractId, adjustmentId },
          replace: true,
        })
      }
    />
  );
}

export const Route = createFileRoute(
  '/admin/electricity-price-adjustments/$contractId/$adjustmentId/{-$decision}'
)({
  beforeLoad: ({ params }) => {
    const contractId = staffOrderId(params.contractId).toLowerCase();
    const adjustmentId = staffOrderId(params.adjustmentId).toLowerCase();
    if (!contractId || !adjustmentId) throw notFound();
    if (params.contractId !== contractId || params.adjustmentId !== adjustmentId)
      throw redirect({
        to: '/admin/electricity-price-adjustments/$contractId/$adjustmentId/{-$decision}',
        params: { contractId, adjustmentId, decision: params.decision },
        replace: true,
      });
  },
  component: PriceAdjustmentRoute,
  pendingComponent: StaffRecordLoading,
});
