import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminStaffTeamsPage.js'));

export const Route = createFileRoute('/admin/staff-teams/new')({
  component: () => <Page mode="create" />,
  pendingComponent: StaffRecordLoading,
});
