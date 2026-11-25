import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(
  () => import('../../../pages/CrmProfileDetail.js'),
  'CrmProfileEditor'
);

function EditProfileRoute() {
  const { profileId, operation } = Route.useParams();
  if (operation === 'edit') return <Page profileId={profileId} editor={{ kind: 'contact' }} />;
  if (operation === 'verification') {
    return <Page profileId={profileId} editor={{ kind: 'verification' }} />;
  }
  if (
    operation === 'archive' ||
    operation === 'force-password-change' ||
    operation === 'expire-sessions'
  ) {
    return <Page profileId={profileId} editor={{ kind: 'action', action: operation }} />;
  }
  throw notFound();
}

export const Route = createFileRoute('/admin/crm/profiles/$profileId_/$operation')({
  component: EditProfileRoute,
  pendingComponent: StaffRecordLoading,
});
