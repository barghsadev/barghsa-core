import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(
  () => import('../../../pages/CrmProfileDetail.js'),
  'CrmProfileEditor'
);

function EditLegalProfileRoute() {
  return <Page profileId={Route.useParams().profileId} editor={{ kind: 'legal' }} />;
}

export const Route = createFileRoute('/admin/crm/profiles/$profileId_/legal/edit')({
  component: EditLegalProfileRoute,
  pendingComponent: StaffRecordLoading,
});
