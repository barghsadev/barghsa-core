import { createFileRoute } from '@tanstack/react-router';
import { AdvancedElectricityOrderPage } from '../../../pages/AdvancedElectricityOrderPage.js';
import { ElectricityCheckoutBoundary } from '../../../components/ElectricityCheckoutBoundary.js';

export const Route = createFileRoute('/_app/electricity/orders/new_/advanced')({
  validateSearch: (search): { step?: unknown } => ({ step: search.step }),
  component: () => (
    <ElectricityCheckoutBoundary>
      <AdvancedElectricityOrderPage />
    </ElectricityCheckoutBoundary>
  ),
});
