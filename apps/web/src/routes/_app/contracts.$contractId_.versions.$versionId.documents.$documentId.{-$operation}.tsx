import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { customerContractSearch } from '../../lib/customer-contract-search.js';

export const Route = createFileRoute(
  '/_app/contracts/$contractId_/versions/$versionId/documents/$documentId/{-$operation}'
)({
  validateSearch: customerContractSearch,
  component: lazyRouteComponent(
    () => import('../../pages/ContractDocumentPage.js'),
    'CustomerContractDocumentPage'
  ),
});
