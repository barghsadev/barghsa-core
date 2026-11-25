import { createFileRoute, notFound } from '@tanstack/react-router';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { TeamRoute } from './team.js';

function TeamRecordRoute() {
  const { section, recordId, action } = Route.useParams();
  if (
    (section !== 'members' && section !== 'invitations') ||
    !/^[a-z0-9_-]{1,100}$/i.test(recordId) ||
    (action && (action !== 'edit' || section !== 'members'))
  )
    throw notFound();
  return <TeamRoute section={section} recordId={recordId} edit={action === 'edit'} />;
}

export const Route = createFileRoute('/_app/settings/team_/$section_/$recordId/{-$action}')({
  component: TeamRecordRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
