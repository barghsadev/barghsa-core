import { createFileRoute } from '@tanstack/react-router';
import { SavingOrderEditPage } from '../../pages/SavingOrderDetailPage.js';

export const Route = createFileRoute('/_app/savings/orders/$orderId_/edit')({
  component: SavingOrderEditPage,
});
