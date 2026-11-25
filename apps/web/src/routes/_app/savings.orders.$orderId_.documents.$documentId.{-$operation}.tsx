import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_app/savings/orders/$orderId_/documents/$documentId/{-$operation}'
)({
  component: lazyRouteComponent(
    () => import('../../pages/SavingOrderDocumentPage.js'),
    'SavingOrderDocumentPage'
  ),
});
