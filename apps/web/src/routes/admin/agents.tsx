import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminAiAgentsPage.js'));
export const Route = createFileRoute('/admin/agents')({
  component: () => (
    <AdminAiSections section="/admin/agents">
      <Page />
    </AdminAiSections>
  ),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
