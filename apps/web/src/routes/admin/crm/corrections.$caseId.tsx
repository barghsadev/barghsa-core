import {
  createFileRoute,
  lazyRouteComponent,
  notFound,
  redirect,
  useLocation,
} from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';
import { crmCorrectionSearch } from '../../../lib/crm-correction-query.js';
import { isInvoiceUuid } from '../../../lib/invoice-uuid.js';

const Page = lazyRouteComponent(() => import('../../../pages/CrmCorrectionsPage.js'));

function CorrectionRoute() {
  const { caseId } = Route.useParams();
  const expectedProfileId = useLocation({ select: ({ state }) => state.crmCorrectionProfileId });
  return (
    <Page
      caseId={caseId}
      recordSearch={Route.useSearch()}
      {...(expectedProfileId ? { expectedProfileId } : {})}
    />
  );
}

export const Route = createFileRoute('/admin/crm/corrections/$caseId')({
  validateSearch: crmCorrectionSearch,
  beforeLoad: ({ params, search }) => {
    const caseId = params.caseId.trim().toLowerCase();
    if (!isInvoiceUuid(caseId)) throw notFound();
    if (caseId !== params.caseId) {
      throw redirect({
        to: '/admin/crm/corrections/$caseId',
        params: { caseId },
        search,
        replace: true,
      });
    }
  },
  component: CorrectionRoute,
  pendingComponent: StaffRecordLoading,
});
