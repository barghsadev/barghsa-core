import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminRolesPage.js'));

export const Route = createFileRoute('/admin/roles/effective')({
  component: () => <Page variant="effective" />,
  pendingComponent: StaffRecordLoading,
});
