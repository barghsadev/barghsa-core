import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { MaintenanceBoundary } from '../../../components/MaintenanceNotice.js';

const SimpleElectricityOrderPage = lazyRouteComponent(
  () => import('../../../pages/SimpleElectricityOrderPage.js'),
  'SimpleElectricityOrderPage'
);

export const Route = createFileRoute('/_app/electricity/orders/new')({
  validateSearch: (search): { step?: unknown } => ({ step: search.step }),
  codeSplitGroupings: [['errorComponent'], ['pendingComponent']],
  component: () => (
    <MaintenanceBoundary capability="electricity_checkout">
      <SimpleElectricityOrderPage />
    </MaintenanceBoundary>
  ),
});
