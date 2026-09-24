import { createFileRoute } from '@tanstack/react-router';
import { AdvancedElectricityOrderPage } from '../../../pages/AdvancedElectricityOrderPage.js';
import { MaintenanceBoundary } from '../../../components/MaintenanceNotice.js';

export const Route = createFileRoute('/_app/electricity/advanced')({
  component: () => (
    <MaintenanceBoundary capability="electricity_checkout">
      <AdvancedElectricityOrderPage />
    </MaintenanceBoundary>
  ),
});
