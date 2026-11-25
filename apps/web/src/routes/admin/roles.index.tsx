import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { roleComparisonSearch } from '../../lib/staff-access-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminRolesPage.js'));

export const Route = createFileRoute('/admin/roles/')({
  validateSearch: roleComparisonSearch,
  beforeLoad: ({ search }) => {
    if (search.module) throw redirect({ to: '/admin/roles/compare', search, replace: true });
  },
  component: () => <Page variant="catalogue" />,
  pendingComponent: StaffRecordLoading,
});
