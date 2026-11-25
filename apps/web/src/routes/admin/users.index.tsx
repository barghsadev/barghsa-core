import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import {
  staffAccountId,
  staffDirectoryQueryOptions,
  staffDirectorySearch,
} from '../../lib/staff-access-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminStaffUsersPage.js'));

function StaffUsersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queries = useListQuery(staffDirectoryQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => staffDirectorySearch(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  return <Page mode="directory" queries={queries} search={search} />;
}

export const Route = createFileRoute('/admin/users/')({
  validateSearch: (raw) => ({
    ...staffDirectorySearch(raw),
    roleEditor: staffAccountId(raw.roleEditor),
    permissionView: staffAccountId(raw.permissionView),
  }),
  beforeLoad: ({ search }) => {
    const userId = search.roleEditor ?? search.permissionView;
    if (userId) {
      throw redirect({
        to: search.roleEditor ? '/admin/users/$userId/roles' : '/admin/users/$userId/permissions',
        params: { userId },
        search: staffDirectorySearch(search),
        replace: true,
      });
    }
  },
  component: StaffUsersRoute,
  pendingComponent: StaffRecordLoading,
});
