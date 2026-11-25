import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { staffAccountId } from '../../lib/staff-access-query.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminStaffTeamsPage.js'));

function TeamEditorRoute() {
  const { teamId } = Route.useParams();
  return <Page key={teamId} mode="edit" teamId={teamId} />;
}

export const Route = createFileRoute('/admin/staff-teams/$teamId/edit')({
  beforeLoad: ({ params }) => {
    if (!staffAccountId(params.teamId)) throw notFound();
  },
  component: TeamEditorRoute,
  pendingComponent: StaffRecordLoading,
});
