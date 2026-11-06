import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminAgentSlotsPage.js'));
export const Route = createFileRoute('/admin/agent-slots')({
  component: () => (
    <AdminAiSections section="/admin/agent-slots">
      <Page />
    </AdminAiSections>
  ),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
