import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(
  () => import('../../../pages/CrmProfileDetail.js'),
  'CrmProfileEditor'
);

function EditProfileAddressRoute() {
  const { profileId, addressId } = Route.useParams();
  return <Page profileId={profileId} editor={{ kind: 'address', addressId }} />;
}

export const Route = createFileRoute('/admin/crm/profiles/$profileId_/addresses/$addressId/edit')({
  component: EditProfileAddressRoute,
  pendingComponent: StaffRecordLoading,
});
