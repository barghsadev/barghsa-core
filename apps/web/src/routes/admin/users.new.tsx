import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffDirectorySearch } from '../../lib/staff-access-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminStaffUsersPage.js'));

function CreateStaffRoute() {
  return <Page mode="create" search={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/users/new')({
  validateSearch: staffDirectorySearch,
  component: CreateStaffRoute,
  pendingComponent: StaffRecordLoading,
});
