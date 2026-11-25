import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { savingOrderFilters } from '../../lib/staff-order-list-query.js';

export const Route = createFileRoute(
  '/admin/saving-orders/$orderId/documents/$documentId/{-$operation}'
)({
  validateSearch: savingOrderFilters,
  component: lazyRouteComponent(
    () => import('../../pages/SavingOrderDocumentPage.js'),
    'SavingOrderDocumentRecord'
  ),
});
