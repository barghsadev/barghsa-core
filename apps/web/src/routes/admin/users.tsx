import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { useListQuery } from '../../hooks/useListQuery.js';
import { staffDirectoryQueryOptions, staffDirectorySearch } from '../../lib/staff-access-query.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminStaffUsersPage.js'));

function staffAddress(raw: Record<string, unknown>) {
  const id = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
  return {
    ...staffDirectorySearch(raw),
    roleEditor: id(raw.roleEditor),
    permissionView: id(raw.permissionView),
  };
}

function StaffUsersRoute() {
  const search = staffAddress(Route.useSearch());
  const navigate = Route.useNavigate();
  const queries = useListQuery(staffDirectoryQueryOptions, search, (update, options) => {
    void navigate({
      search: (raw) => staffAddress(update(raw)),
      replace: options?.replace ?? false,
      resetScroll: false,
    });
  });
  const setAddress = useCallback(
    (patch: { roleEditor?: string | null; permissionView?: string | null }, replace = false) => {
      void navigate({
        search: (raw) => staffAddress({ ...raw, ...patch }),
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  return (
    <Page
      queries={queries}
      workspace={{
        roles: {
          id: search.roleEditor ?? null,
          set: (id, replace) => setAddress({ roleEditor: id }, replace),
        },
        permissions: {
          id: search.permissionView ?? null,
          set: (id, replace) => setAddress({ permissionView: id }, replace),
        },
        clear: () => setAddress({ roleEditor: null, permissionView: null }, true),
      }}
    />
  );
}
export const Route = createFileRoute('/admin/users')({
  validateSearch: staffDirectorySearch,
  component: StaffUsersRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
