import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const Page = lazyRouteComponent(
  () => import('../../pages/AdminElectricityPriceAdjustmentsPage.js')
);

function PriceProposalRoute() {
  const { contractId } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <Page
      key={contractId}
      routeContractId={contractId}
      view="new"
      onPublished={(adjustmentId) =>
        void navigate({
          to: '/admin/electricity-price-adjustments/$contractId/$adjustmentId/{-$decision}',
          params: { contractId, adjustmentId },
          replace: true,
        })
      }
    />
  );
}

export const Route = createFileRoute('/admin/electricity-price-adjustments/$contractId/new')({
  beforeLoad: ({ params }) => {
    const contractId = staffOrderId(params.contractId).toLowerCase();
    if (!contractId) throw notFound();
    if (params.contractId !== contractId)
      throw redirect({
        to: '/admin/electricity-price-adjustments/$contractId/new',
        params: { contractId },
        replace: true,
      });
  },
  component: PriceProposalRoute,
  pendingComponent: StaffRecordLoading,
});
