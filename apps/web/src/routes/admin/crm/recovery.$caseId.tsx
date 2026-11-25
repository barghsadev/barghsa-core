import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';
import { isInvoiceUuid } from '../../../lib/invoice-uuid.js';

const Page = lazyRouteComponent(() => import('../../../pages/AccountRecoveryPage.js'));

function RecoveryRecordRoute() {
  const { caseId } = Route.useParams();
  return <Page entry={{ mode: 'record', id: caseId }} />;
}

export const Route = createFileRoute('/admin/crm/recovery/$caseId')({
  beforeLoad: ({ params }) => {
    const caseId = params.caseId.trim().toLowerCase();
    if (!isInvoiceUuid(caseId)) throw notFound();
    if (caseId !== params.caseId) {
      throw redirect({ to: '/admin/crm/recovery/$caseId', params: { caseId }, replace: true });
    }
  },
  component: RecoveryRecordRoute,
  pendingComponent: StaffRecordLoading,
});
