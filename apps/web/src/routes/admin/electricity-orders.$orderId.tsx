import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { electricityOrderFilters } from '../../lib/staff-order-list-query.js';

const Order = lazyRouteComponent(
  () => import('../../pages/AdminElectricityOrdersPage.js'),
  'ElectricityOrderRecord'
);

export const Route = createFileRoute('/admin/electricity-orders/$orderId')({
  validateSearch: electricityOrderFilters,
  component: Order,
  pendingComponent: StaffRecordLoading,
});
