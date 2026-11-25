import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { addressReturnSearch } from '../../../lib/address-return.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';

const Addresses = lazyRouteComponent(
  () => import('../../../pages/AddressWorkspace.js'),
  'AddressWorkspace'
);
export const Route = createFileRoute('/_app/settings/addresses')({
  validateSearch: addressReturnSearch,
  component: AddressRoute,
  pendingComponent: () => <RouteSkeleton />,
});

function AddressRoute() {
  return <Addresses view={{ kind: 'list' }} returnTo={Route.useSearch().returnTo} />;
}
