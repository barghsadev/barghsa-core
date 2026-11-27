import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { ElectricityCheckoutBoundary } from '../../../components/ElectricityCheckoutBoundary.js';

const SimpleElectricityOrderPage = lazyRouteComponent(
  () => import('../../../pages/SimpleElectricityOrderPage.js'),
  'SimpleElectricityOrderPage'
);

export const Route = createFileRoute('/_app/electricity/orders/new')({
  validateSearch: (search): { step?: unknown } => ({ step: search.step }),
  codeSplitGroupings: [['errorComponent'], ['pendingComponent']],
  component: () => (
    <ElectricityCheckoutBoundary>
      <SimpleElectricityOrderPage />
    </ElectricityCheckoutBoundary>
  ),
});
