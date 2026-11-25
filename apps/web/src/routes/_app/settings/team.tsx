import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { teamRecordLink, type TeamSection } from '../../../lib/team-workspace.js';

const Page = lazyRouteComponent(() => import('../../../pages/TeamPage.js'), 'TeamPage');

export function TeamRoute({
  section,
  recordId,
  edit,
}: {
  section: TeamSection;
  recordId?: string;
  edit?: boolean;
}) {
  const navigate = Route.useNavigate();
  return (
    <Page
      key={`${section}/${recordId ?? ''}/${edit ?? ''}`}
      workspace={{
        section,
        recordId,
        edit,
        navigate: (target, id, editRoles, replace = false) => {
          if (id && (target === 'members' || target === 'invitations')) {
            void navigate({ ...teamRecordLink(target, id, editRoles), replace });
          } else if (target === 'members') {
            void navigate({ to: '/settings/team', replace });
          } else {
            void navigate({ to: '/settings/team/$section', params: { section: target }, replace });
          }
        },
      }}
    />
  );
}

export const Route = createFileRoute('/_app/settings/team')({
  component: () => <TeamRoute section="members" />,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
