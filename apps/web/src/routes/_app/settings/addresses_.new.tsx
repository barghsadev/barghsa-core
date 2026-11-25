import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { addressReturnSearch } from '../../../lib/address-return.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';

const Addresses = lazyRouteComponent(
  () => import('../../../pages/AddressWorkspace.js'),
  'AddressWorkspace'
);
export const Route = createFileRoute('/_app/settings/addresses_/new')({
  validateSearch: addressReturnSearch,
  component: AddressRoute,
  pendingComponent: () => <RouteSkeleton />,
});

function AddressRoute() {
  return <Addresses view={{ kind: 'new' }} returnTo={Route.useSearch().returnTo} />;
}
