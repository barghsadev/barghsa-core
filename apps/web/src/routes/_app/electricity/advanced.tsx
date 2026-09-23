import { createFileRoute } from '@tanstack/react-router';
import { AdvancedElectricityOrderPage } from '../../../pages/AdvancedElectricityOrderPage.js';

export const Route = createFileRoute('/_app/electricity/advanced')({
  component: AdvancedElectricityOrderPage,
});
