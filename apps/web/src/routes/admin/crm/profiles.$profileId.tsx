import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../../pages/CrmProfileDetail.js'));

function CrmProfileRoute() {
  return <Page initialTab={Route.useSearch().section ?? 'overview'} />;
}

export const Route = createFileRoute('/admin/crm/profiles/$profileId')({
  validateSearch: (raw) => ({
    section: raw.section === 'details' || raw.section === 'addresses' ? raw.section : undefined,
  }),
  component: CrmProfileRoute,
  pendingComponent: StaffRecordLoading,
});
