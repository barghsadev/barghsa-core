import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { staffContractFilters } from '../../lib/record-list-query.js';

export const Route = createFileRoute(
  '/admin/contracts/$contractId/versions/$versionId/documents/$documentId/{-$operation}'
)({
  validateSearch: staffContractFilters,
  component: lazyRouteComponent(
    () => import('../../pages/ContractDocumentPage.js'),
    'StaffContractDocumentPage'
  ),
});
