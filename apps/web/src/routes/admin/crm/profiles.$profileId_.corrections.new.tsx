import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';
import { crmCorrectionSearch } from '../../../lib/crm-correction-query.js';
import { isInvoiceUuid } from '../../../lib/invoice-uuid.js';

const Page = lazyRouteComponent(() => import('../../../pages/CrmCorrectionsPage.js'));

function NewCorrectionRoute() {
  const { profileId } = Route.useParams();
  return <Page newProfileId={profileId} recordSearch={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/crm/profiles/$profileId_/corrections/new')({
  validateSearch: (raw) => ({ fieldName: crmCorrectionSearch(raw).fieldName }),
  beforeLoad: ({ params, search }) => {
    const profileId = params.profileId.trim().toLowerCase();
    if (!isInvoiceUuid(profileId)) throw notFound();
    if (profileId !== params.profileId) {
      throw redirect({
        to: '/admin/crm/profiles/$profileId/corrections/new',
        params: { profileId },
        search,
        replace: true,
      });
    }
  },
  component: NewCorrectionRoute,
  pendingComponent: StaffRecordLoading,
});
