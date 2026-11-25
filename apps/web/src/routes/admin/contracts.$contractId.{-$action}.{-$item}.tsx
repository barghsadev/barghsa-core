import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffContractFilters } from '../../lib/record-list-query.js';
import { contractRecordBeforeLoad } from '../../lib/staff-contract-route.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';
import { contractAttachmentRole } from '../../lib/contract-attachments.js';
import ContractAttachmentPage from '../../pages/ContractAttachmentPage.js';

const Record = lazyRouteComponent(() => import('../../pages/AdminContractRecordPage.js'));
const Cancellation = lazyRouteComponent(() => import('../../pages/ContractCancellationPage.js'));

function ContractRoute() {
  const { contractId, action, item } = Route.useParams();
  const search = Route.useSearch();
  const role = contractAttachmentRole(action);
  const versionId = staffOrderId(item).toLowerCase();
  if ((action === 'signature-request' || action === 'record-signature') && versionId)
    return <Record entry={{ mode: action, contractId, versionId }} search={search} />;
  if (action === 'request-changes' && versionId)
    return <Record entry={{ mode: 'request-changes', contractId, versionId }} search={search} />;
  if (role && versionId)
    return (
      <ContractAttachmentPage
        contractId={contractId}
        versionId={versionId}
        attachmentRole={role}
        staff
        search={search}
      />
    );
  if ((!action || action === 'edit' || action === 'service-dates') && !item)
    return <Record entry={{ mode: action || 'detail', contractId }} search={search} />;
  if (action === 'amendments' && item === 'new')
    return <Record entry={{ mode: 'amendment', contractId }} search={search} />;
  if ((action === 'cancel' || action === 'reject') && !item)
    return <Cancellation contractId={contractId} view={{ action }} search={search} />;
  if (
    (action === 'review-cancellation' || action === 'decline-cancellation') &&
    item &&
    staffOrderId(item)
  )
    return (
      <Cancellation
        contractId={contractId}
        view={{ action, requestId: item.toLowerCase() }}
        search={search}
      />
    );
  throw notFound();
}

export const Route = createFileRoute('/admin/contracts/$contractId/{-$action}/{-$item}')({
  validateSearch: (search): Record<string, unknown> => ({
    ...staffContractFilters(search),
    versionId: staffOrderId(search.versionId).toLowerCase() || undefined,
  }),
  beforeLoad: contractRecordBeforeLoad,
  component: ContractRoute,
  pendingComponent: StaffRecordLoading,
});
