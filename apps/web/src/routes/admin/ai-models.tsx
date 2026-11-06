import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminAiModelsPage.js'));
export const Route = createFileRoute('/admin/ai-models')({
  component: () => (
    <AdminAiSections section="/admin/ai-models">
      <Page />
    </AdminAiSections>
  ),
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
