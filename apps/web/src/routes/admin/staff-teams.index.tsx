import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffAccountId } from '../../lib/staff-access-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminStaffTeamsPage.js'));

export const Route = createFileRoute('/admin/staff-teams/')({
  validateSearch: (raw) => ({ selected: staffAccountId(raw.selected) }),
  beforeLoad: ({ search }) => {
    if (search.selected) {
      throw redirect({
        to: '/admin/staff-teams/$teamId/edit',
        params: { teamId: search.selected },
        replace: true,
      });
    }
  },
  component: () => <Page mode="directory" />,
  pendingComponent: StaffRecordLoading,
});
