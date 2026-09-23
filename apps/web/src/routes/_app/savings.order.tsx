import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/savings/order')({
  component: lazyRouteComponent(
    () => import('../../pages/SavingsOrderPage.js'),
    'SavingsOrderPage'
  ),
});
