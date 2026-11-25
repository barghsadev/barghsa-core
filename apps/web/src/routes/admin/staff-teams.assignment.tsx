import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminStaffTeamsPage.js'));

export const Route = createFileRoute('/admin/staff-teams/assignment')({
  component: () => <Page mode="assignment" />,
  pendingComponent: StaffRecordLoading,
});
