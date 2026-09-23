import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/savings/orders/$orderId')({
  component: lazyRouteComponent(
    () => import('../../pages/SavingOrderDetailPage.js'),
    'SavingOrderDetailPage'
  ),
});
