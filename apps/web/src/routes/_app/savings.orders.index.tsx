import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/savings/orders/')({
  component: lazyRouteComponent(
    () => import('../../pages/SavingOrdersPage.js'),
    'SavingOrdersPage'
  ),
});
