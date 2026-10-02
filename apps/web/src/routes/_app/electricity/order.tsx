import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { MaintenanceBoundary } from '../../../components/MaintenanceNotice.js';
export type { PriceQuote } from '../../../pages/SimpleElectricityOrderPage.js';

const SimpleElectricityOrderPage = lazyRouteComponent(
  () => import('../../../pages/SimpleElectricityOrderPage.js'),
  'SimpleElectricityOrderPage'
);

export const Route = createFileRoute('/_app/electricity/order')({
  validateSearch: (search): { step?: unknown } => ({ step: search.step }),
  component: () => (
    <MaintenanceBoundary capability="electricity_checkout">
      <SimpleElectricityOrderPage />
    </MaintenanceBoundary>
  ),
});
