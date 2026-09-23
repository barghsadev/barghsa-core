import { createFileRoute } from '@tanstack/react-router';
import { ElectricityOrderDetailsPage } from '../../../pages/ElectricityOrderDetailsPage.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

export const Route = createFileRoute('/_app/electricity/orders/$orderId')({
  component: OrderDetailsRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});

function OrderDetailsRoute() {
  const { orderId } = Route.useParams();
  return <ElectricityOrderDetailsPage orderId={orderId} />;
}
