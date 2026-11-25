import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffContractFilters } from '../../lib/record-list-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminContractRecordPage.js'));

function NewContractRoute() {
  return <Page entry={{ mode: 'new' }} search={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/contracts/new')({
  validateSearch: staffContractFilters,
  component: NewContractRoute,
  pendingComponent: StaffRecordLoading,
});
