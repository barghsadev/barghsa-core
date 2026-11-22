import AdminAiSections from '../../components/AdminAiSections.js';
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { useCallback } from 'react';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
const Page = lazyRouteComponent(() => import('../../pages/AdminAiModelsPage.js'));
function ModelsRoute() {
  const raw: Record<string, unknown> = Route.useSearch();
  const id =
    typeof raw.selected === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw.selected)
      ? raw.selected
      : null;
  const navigate = Route.useNavigate();
  const set = useCallback(
    (key: string | null, replace = false) => {
      const [mode, selected] = key?.split(':') ?? [];
      void navigate({
        search: { selected, mode: mode === 'budget' ? 'budget' : undefined },
        replace,
        resetScroll: false,
      });
    },
    [navigate]
  );
  return (
    <AdminAiSections section="/admin/ai-models">
      <Page
        selection={{ id: id ? `${raw.mode === 'budget' ? 'budget' : 'model'}:${id}` : null, set }}
      />
    </AdminAiSections>
  );
}
export const Route = createFileRoute('/admin/ai-models')({
  component: ModelsRoute,
  pendingComponent: () => <RouteSkeleton layout="admin" />,
  errorComponent: RouteErrorBoundary,
});
