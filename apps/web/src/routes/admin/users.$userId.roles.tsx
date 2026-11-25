import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffAccountId, staffDirectorySearch } from '../../lib/staff-access-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminStaffUsersPage.js'));

function RoleEditorRoute() {
  const { userId } = Route.useParams();
  return <Page key={userId} userId={userId} mode="roles" search={Route.useSearch()} />;
}

export const Route = createFileRoute('/admin/users/$userId/roles')({
  validateSearch: staffDirectorySearch,
  beforeLoad: ({ params }) => {
    if (!staffAccountId(params.userId)) throw notFound();
  },
  component: RoleEditorRoute,
  pendingComponent: StaffRecordLoading,
});
