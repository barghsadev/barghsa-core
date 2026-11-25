import { createFileRoute } from '@tanstack/react-router';
import { ElectricityOrderDetailsPage } from '../../../pages/ElectricityOrderDetailsPage.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/_app/electricity/orders/$orderId_/increases/new')({
  component: OrderIncreaseRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});

function OrderIncreaseRoute() {
  const { orderId } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <ElectricityOrderDetailsPage
      orderId={orderId}
      onIncreaseRequestComplete={() => {
        void navigate({ to: '/electricity/orders/$orderId', params: { orderId }, replace: true });
      }}
    />
  );
}
