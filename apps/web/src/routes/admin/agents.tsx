import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminAiAgentsPage.js'));
export const Route = createFileRoute('/admin/agents')({
  validateSearch: (raw: Record<string, unknown>) => ({
    selected:
      typeof raw.selected === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw.selected)
        ? raw.selected
        : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.selected)
      throw redirect({
        to: '/admin/agents/$agentId/{-$action}',
        params: {
          agentId: search.selected,
          action: search.selected === 'new' ? undefined : 'edit',
        },
        replace: true,
      });
  },
  component: () => (
    <AdminAiSections section="/admin/agents">
      <Page workspace={{ view: 'list' }} />
    </AdminAiSections>
  ),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
