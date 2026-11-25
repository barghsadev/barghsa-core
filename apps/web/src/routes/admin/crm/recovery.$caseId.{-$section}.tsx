import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';
import { isInvoiceUuid } from '../../../lib/invoice-uuid.js';

const recoveryRoute = '/admin/crm/recovery/$caseId/{-$section}';
const Page = lazyRouteComponent(() => import('../../../pages/AccountRecoveryPage.js'));

function RecoveryRecordRoute() {
  const { caseId, section } = Route.useParams();
  const navigate = Route.useNavigate();
  const openCase = (id: string) =>
    void navigate({ to: recoveryRoute, params: { caseId: id, section: undefined }, replace: true });
  if (caseId === 'new' && !section) return <Page entry={{ mode: 'create', openCase }} />;
  if (section && section !== 'review' && section !== 'complete') throw notFound();
  return (
    <Page entry={{ mode: 'record', id: caseId, section, openDetails: () => openCase(caseId) }} />
  );
}

export const Route = createFileRoute('/admin/crm/recovery/$caseId/{-$section}')({
  beforeLoad: ({ params }) => {
    if (params.caseId === 'new' && !params.section) return;
    const caseId = params.caseId.trim().toLowerCase();
    if (!isInvoiceUuid(caseId)) throw notFound();
    if (caseId !== params.caseId) {
      throw redirect({
        to: recoveryRoute,
        params: { caseId, section: params.section },
        replace: true,
      });
    }
  },
  component: RecoveryRecordRoute,
  pendingComponent: StaffRecordLoading,
});
