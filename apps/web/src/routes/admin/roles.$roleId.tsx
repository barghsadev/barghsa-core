import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminRolesPage.js'));

function RoleRoute() {
  const { roleId } = Route.useParams();
  return <Page key={roleId} roleId={roleId} />;
}

export const Route = createFileRoute('/admin/roles/$roleId')({
  beforeLoad: ({ params }) => {
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(params.roleId)) throw notFound();
  },
  component: RoleRoute,
  pendingComponent: StaffRecordLoading,
});
