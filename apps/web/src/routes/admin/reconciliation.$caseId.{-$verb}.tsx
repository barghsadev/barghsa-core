import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { reconciliationQueueSearch } from '../../lib/decision-queue-query.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminReconciliationPage.js'));

function RecordRoute() {
  const { caseId, verb } = Route.useParams();
  if (verb && verb !== 'resolve' && verb !== 'close') throw notFound();
  return <Page recordId={caseId} recordVerb={verb} recordSearch={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/reconciliation/$caseId/{-$verb}')({
  validateSearch: reconciliationQueueSearch,
  beforeLoad: ({ params, search }) => {
    const caseId = params.caseId.trim().toLowerCase();
    if (!isInvoiceUuid(caseId)) throw notFound();
    if (caseId !== params.caseId)
      throw redirect({
        to: '/admin/reconciliation/$caseId/{-$verb}',
        params: { caseId, verb: params.verb },
        search,
        replace: true,
      });
  },
  component: RecordRoute,
  pendingComponent: StaffRecordLoading,
});
