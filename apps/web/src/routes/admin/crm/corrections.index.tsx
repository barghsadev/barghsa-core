import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';
import { crmCorrectionSearch } from '../../../lib/crm-correction-query.js';
export const Route = createFileRoute('/admin/crm/corrections/')({
  validateSearch: crmCorrectionSearch,
  beforeLoad: ({ search }) => {
    if (search.profileId && search.fieldName) {
      throw redirect({
        to: '/admin/crm/profiles/$profileId/corrections/new',
        params: { profileId: search.profileId },
        search: { fieldName: search.fieldName },
        replace: true,
      });
    }
  },
  component: lazyRouteComponent(
    () => import('../../../pages/CrmCorrectionsPage.js'),
    'CrmCorrectionsRoutePage'
  ),
  pendingComponent: StaffRecordLoading,
});
