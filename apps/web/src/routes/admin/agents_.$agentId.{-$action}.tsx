import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminAiAgentsPage.js'));

function AgentRoute() {
  const { agentId, action } = Route.useParams();
  const navigate = Route.useNavigate();
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(agentId) ||
    (action && (action !== 'edit' || agentId === 'new'))
  )
    throw notFound();
  const showRecord = (id: string, replace = false) =>
    void navigate({
      to: '/admin/agents/$agentId/{-$action}',
      params: { agentId: id, action: undefined },
      replace,
    });
  const showList = () => void navigate({ to: '/admin/agents' });
  return (
    <AdminAiSections section="/admin/agents">
      <Page
        key={`${agentId}/${action ?? ''}`}
        workspace={
          agentId === 'new'
            ? { view: 'create', showRecord, showList }
            : { view: action === 'edit' ? 'edit' : 'detail', agentId, showRecord, showList }
        }
      />
    </AdminAiSections>
  );
}

export const Route = createFileRoute('/admin/agents_/$agentId/{-$action}')({
  component: AgentRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
