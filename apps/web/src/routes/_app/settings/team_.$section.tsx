import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { TeamRoute } from './team.js';

function TeamSectionRoute() {
  const { section } = Route.useParams();
  if (
    section !== 'invitations' &&
    section !== 'roles' &&
    section !== 'invite' &&
    section !== 'transfers'
  )
    throw notFound();
  return <TeamRoute section={section} />;
}

export const Route = createFileRoute('/_app/settings/team_/$section')({
  beforeLoad: ({ params }) => {
    if (params.section === 'members') throw redirect({ to: '/settings/team', replace: true });
  },
  component: TeamSectionRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
