import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { addressReturnSearch } from '../../../lib/address-return.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';

const Addresses = lazyRouteComponent(
  () => import('../../../pages/AddressWorkspace.js'),
  'AddressWorkspace'
);
export const Route = createFileRoute('/_app/settings/addresses_/$addressId_/edit')({
  validateSearch: addressReturnSearch,
  component: AddressRoute,
  pendingComponent: () => <RouteSkeleton />,
});

function AddressRoute() {
  const addressId = Route.useParams().addressId.toLowerCase();
  return (
    <Addresses
      key={addressId}
      view={{ kind: 'edit', addressId }}
      returnTo={Route.useSearch().returnTo}
    />
  );
}
