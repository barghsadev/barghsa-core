import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { savingOrderFilters } from '../../lib/staff-order-list-query.js';

const Order = lazyRouteComponent(
  () => import('../../pages/AdminSavingOrdersPage.js'),
  'SavingOrderRecord'
);

export const Route = createFileRoute('/admin/saving-orders/$orderId/{-$operation}/{-$upgradeId}')({
  validateSearch: savingOrderFilters,
  component: Order,
});
