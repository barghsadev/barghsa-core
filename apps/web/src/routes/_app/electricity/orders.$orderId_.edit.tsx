import { createFileRoute } from '@tanstack/react-router';
import { ElectricityOrderDetailsPage } from '../../../pages/ElectricityOrderDetailsPage.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/_app/electricity/orders/$orderId_/edit')({
  component: OrderEditRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});

function OrderEditRoute() {
  const { orderId } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <ElectricityOrderDetailsPage
      orderId={orderId}
      edit
      onCorrectionComplete={() => {
        void navigate({ to: '/electricity/orders/$orderId', params: { orderId }, replace: true });
      }}
    />
  );
}
