import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { MaintenanceBoundary } from '../../components/MaintenanceNotice.js';

const SavingOrderForm = lazyRouteComponent(
  () => import('../../pages/SavingsOrderPage.js'),
  'SavingsOrderPage'
);

export const Route = createFileRoute('/_app/savings/order')({
  validateSearch: (search: Record<string, unknown>) => ({ step: search.step }),
  component: () => (
    <MaintenanceBoundary capability="saving_orders">
      <SavingOrderForm />
    </MaintenanceBoundary>
  ),
});
